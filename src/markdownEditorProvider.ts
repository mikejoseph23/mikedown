import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as cp from 'child_process';
import { getSettings } from './settings';
import { writeRenderedHtml, openRenderedInBrowser } from './export';
import {
  extensionFromMime,
  extractLocalImageRefs,
  formatInsertPath,
  isInsideManagedFolder,
  looksLikeAutoPastedImage,
  resolveAltText,
  resolveFilename,
  resolveLocalImagePaths,
  resolveTargetFolder,
  resizeSiblingPath,
} from './imagePaste';

/**
 * MikeDown custom text editor provider.
 *
 * Implements the VS Code CustomTextEditorProvider interface to render
 * Markdown files in a WYSIWYG webview panel.
 */
export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'mikedown.editor';

  /**
   * M3 — Tracks the currently active webview panel so that extension commands
   * (registered in extension.ts) can post messages to the active editor.
   * Updated whenever resolveCustomTextEditor is called and the panel gains focus.
   */
  public static activePanel: vscode.WebviewPanel | undefined = undefined;
  /** The document associated with the currently active panel. */
  public static activeDocument: vscode.TextDocument | undefined = undefined;
  /** All open MikeDown webview panels mapped to their document, for broadcasting messages (e.g. theme changes). */
  private static openPanels = new Map<vscode.WebviewPanel, vscode.TextDocument>();
  /** Tracks panels by file path — when 2+ panels share a path, it's a diff view. */
  private static panelsByPath = new Map<string, Set<{ panel: vscode.WebviewPanel; webview: vscode.Webview }>>();
  /** Tracks file paths with a pending diff redirect to prevent duplicate opens. */
  private static diffRedirectPending = new Set<string>();
  /** StatusBarManager (assigned by extension.ts) for word/char/reading-time stats. */
  public static statusBar: import('./statusBar').StatusBarManager | undefined = undefined;
  /** Last plain text received per panel — re-applied when the panel regains focus. */
  private static lastStatsByPanel = new WeakMap<vscode.WebviewPanel, string>();
  /** BacklinkProvider (assigned by extension.ts) — backs the sidebar Backlinks section. */
  public static backlinkProvider: import('./backlinkProvider').BacklinkProvider | undefined = undefined;

  /**
   * Broadcast the current backlink list to every open MikeDown panel. Called
   * by extension.ts whenever the workspace-wide index changes (save / create /
   * delete) so all visible sidebars stay in sync.
   */
  public static broadcastBacklinks(): void {
    if (!MarkdownEditorProvider.backlinkProvider) return;
    for (const [panel, doc] of MarkdownEditorProvider.openPanels) {
      MarkdownEditorProvider.sendBacklinksToWebview(panel.webview, doc);
    }
  }

  private static sendBacklinksToWebview(
    webview: vscode.Webview,
    document: vscode.TextDocument
  ): void {
    if (!MarkdownEditorProvider.backlinkProvider) return;
    const entries = MarkdownEditorProvider.backlinkProvider.getBacklinksFor(document.uri);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const items = entries.map(e => {
      const fsPath = e.sourceFile.fsPath;
      const displayPath = workspaceFolder
        ? path.relative(workspaceFolder.uri.fsPath, fsPath).split(path.sep).join('/')
        : path.basename(fsPath);
      // openLink resolves hrefs relative to the current document. We use the
      // source file's path relative to the current doc's directory so the
      // existing 'openLink' handler can navigate to it without a new code path.
      const fromDir = path.dirname(document.uri.fsPath);
      const rel = path.relative(fromDir, fsPath).split(path.sep).join('/');
      const href = rel.startsWith('.') ? rel : './' + rel;
      return {
        uri: href,
        displayPath,
        line: e.lineNumber,
        lineText: e.lineText,
      };
    });
    webview.postMessage({ type: 'backlinks', items });
  }

  /**
   * Per-document baselines for orphan-image cleanup. Keyed by document fsPath.
   *
   * `imagePathsBaseline` is the set of absolute on-disk image paths that were
   * referenced by the document at last save (or initial open). On each save we
   * compute what's currently referenced and delete anything that fell out of
   * the set — provided it's inside the configured imagePaste folder and no
   * other markdown file in the workspace references it.
   *
   * `sessionPastedAbsPaths` covers the paste-then-delete-before-save case:
   * images written this session that haven't been part of any saved baseline
   * yet, but should be cleaned up if the user removes them before saving.
   */
  private imagePathsBaseline = new Map<string, Set<string>>();
  private sessionPastedAbsPaths = new Map<string, Set<string>>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Called when VS Code opens a file with this custom editor.
   */
  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    // Configure the webview
    // M7 — Include the document's parent directory (and workspace folders) in
    // localResourceRoots so that relative image paths can be resolved and served.
    const workspaceFolderRoots = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri);
    const docDirUri = vscode.Uri.joinPath(document.uri, '..');
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, 'src', 'webview')),
        vscode.Uri.file(path.join(this.context.extensionPath, 'dist')),
        vscode.Uri.file(path.join(this.context.extensionPath, 'out', 'webview')),
        docDirUri,
        ...workspaceFolderRoots
      ]
    };

    // Set the initial HTML content
    webviewPanel.webview.html = this.getWebviewContent(webviewPanel.webview);

    // M3 — Track the active panel so extension commands can post messages to it.
    MarkdownEditorProvider.activePanel = webviewPanel;
    MarkdownEditorProvider.activeDocument = document;
    MarkdownEditorProvider.openPanels.set(webviewPanel, document);

    // Track panels by file path for diff detection.
    const fsPath = document.uri.fsPath;
    const entry = { panel: webviewPanel, webview: webviewPanel.webview };
    if (!MarkdownEditorProvider.panelsByPath.has(fsPath)) {
      MarkdownEditorProvider.panelsByPath.set(fsPath, new Set());
    }
    const pathPanels = MarkdownEditorProvider.panelsByPath.get(fsPath)!;
    pathPanels.add(entry);

    // Diff detection: non-file scheme (e.g. git: from Source Control) or
    // 2+ panels sharing the same path indicates VS Code opened a diff view.
    // Redirect to the source text diff for proper green/red line highlighting.
    if (document.uri.scheme !== 'file' || pathPanels.size > 1) {
      // Register dispose handler for cleanup before returning early
      webviewPanel.onDidDispose(() => {
        MarkdownEditorProvider.openPanels.delete(webviewPanel);
        if (MarkdownEditorProvider.activePanel === webviewPanel) {
          MarkdownEditorProvider.activePanel = undefined;
          MarkdownEditorProvider.activeDocument = undefined;
        }
        const panels = MarkdownEditorProvider.panelsByPath.get(fsPath);
        if (panels) {
          panels.delete(entry);
          if (panels.size === 0) {
            MarkdownEditorProvider.panelsByPath.delete(fsPath);
          }
        }
      });

      // Only trigger the source diff redirect once per file path
      if (!MarkdownEditorProvider.diffRedirectPending.has(fsPath)) {
        MarkdownEditorProvider.diffRedirectPending.add(fsPath);
        const fileUri = vscode.Uri.file(fsPath);
        setTimeout(async () => {
          MarkdownEditorProvider.diffRedirectPending.delete(fsPath);
          try {
            await vscode.commands.executeCommand('mikedown.showDiff', fileUri);
          } catch { /* git history unavailable */ }
          // Close the WYSIWYG diff panels since the source diff is now open
          const panels = MarkdownEditorProvider.panelsByPath.get(fsPath);
          if (panels) {
            for (const p of [...panels]) {
              p.panel.dispose();
            }
          }
        }, 0);
      }

      return; // Skip full WYSIWYG editor setup
    }
    webviewPanel.onDidChangeViewState(e => {
      if (e.webviewPanel.active) {
        MarkdownEditorProvider.activePanel = webviewPanel;
        MarkdownEditorProvider.activeDocument = document;
        // Re-show last-known stats for this panel
        const cached = MarkdownEditorProvider.lastStatsByPanel.get(webviewPanel);
        if (cached !== undefined && MarkdownEditorProvider.statusBar) {
          MarkdownEditorProvider.statusBar.update(cached);
        }
      } else if (MarkdownEditorProvider.activePanel === webviewPanel) {
        MarkdownEditorProvider.activePanel = undefined;
        MarkdownEditorProvider.activeDocument = undefined;
      }
    });

    // Send initial document content to the webview.
    // IMPORTANT: use document.getText() directly — no transformation that could trigger a change event.
    //
    // Dirty-flag guarantee chain:
    //   1. resolveCustomTextEditor sends 'update' with raw content (here via updateWebview)
    //   2. Webview sets isLoading = true, calls setContent, sets isLoading = false
    //   3. onUpdate is suppressed during load → no 'edit' message → no WorkspaceEdit → dirty flag stays clean
    this.updateWebview(document, webviewPanel.webview);
    this.sendThemeToWebview(webviewPanel.webview);
    this.sendSettingsToWebview(webviewPanel.webview, document);

    // Snapshot the set of images this doc references at open time. Orphan
    // cleanup compares against this baseline on save to figure out what was
    // removed. Subsequent saves replace it with the new set.
    if (!this.imagePathsBaseline.has(document.uri.fsPath)) {
      this.imagePathsBaseline.set(
        document.uri.fsPath,
        this.computeReferencedImagePaths(document.uri, document.getText())
      );
    }

    // Listen for configuration changes and broadcast to ALL open panels
    // so that e.g. toggling editor theme in one tab updates all tabs.
    const configListener = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('mikedown')) {
        for (const [panel, doc] of MarkdownEditorProvider.openPanels) {
          this.sendThemeToWebview(panel.webview);
          this.sendSettingsToWebview(panel.webview, doc);
          if (e.affectsConfiguration('mikedown.outline')) {
            this.sendOutlineStateToWebview(panel.webview, doc);
          }
        }
      }
    });
    this.context.subscriptions.push(configListener);

    // v1.6.0 — Watch image files in the document directory tree so the webview
    // can flag images as broken the moment their on-disk file is deleted (or
    // un-flag them when the file reappears). Without this, a deleted image
    // keeps rendering its last-loaded bytes until the document is reloaded.
    const imageWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(docDirUri, '**/*.{png,jpg,jpeg,gif,webp,svg,bmp,avif,ico,tiff,tif}')
    );
    console.log('MikeDown:DIAG-WATCHER-V1: created image watcher for docDir', docDirUri.fsPath);
    const broadcastImageStatus = (uri: vscode.Uri, exists: boolean): void => {
      const broadcastUri = webviewPanel.webview.asWebviewUri(uri).toString();
      console.log('MikeDown:DIAG-WATCHER-V1: broadcastImageStatus exists=', exists, 'fsPath=', uri.fsPath, 'broadcastUri=', broadcastUri);
      webviewPanel.webview.postMessage({
        type: exists ? 'imageFileFound' : 'imageFileMissing',
        uri: broadcastUri,
        fsPath: uri.fsPath,
      });
    };
    const imageWatcherDeleteSub = imageWatcher.onDidDelete(uri => {
      console.log('MikeDown:DIAG-WATCHER-V1: onDidDelete fired uri=', uri.fsPath);
      broadcastImageStatus(uri, false);
    });
    const imageWatcherCreateSub = imageWatcher.onDidCreate(uri => {
      console.log('MikeDown:DIAG-WATCHER-V1: onDidCreate fired uri=', uri.fsPath);
      broadcastImageStatus(uri, true);
    });

    // Track in-flight webview edits to suppress their change events.
    // Uses a counter of in-flight edits (not events): the guard stays up
    // for the entire duration of each applyEdit() call, so even if a single
    // WorkspaceEdit fires multiple onDidChangeTextDocument events (e.g.
    // delete + insert for a full-document replace), all of them are suppressed.
    let webviewEditsInFlight = 0;

    // Suppress change events triggered by VS Code's own save process (e.g.
    // trimTrailingWhitespace, insertFinalNewline) which fire
    // onDidChangeTextDocument while the document is still dirty.
    let isSaving = false;
    const willSaveSubscription = vscode.workspace.onWillSaveTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) {
        isSaving = true;
      }
    });
    const didSaveSubscription = vscode.workspace.onDidSaveTextDocument(savedDoc => {
      if (savedDoc.uri.toString() === document.uri.toString()) {
        // Delay clearing isSaving to the next event-loop tick so that any
        // onDidChangeTextDocument events dispatched asynchronously after the
        // save completes (e.g. file-watcher detecting the disk write, or
        // deferred save-participant changes) are still suppressed.
        setTimeout(() => { isSaving = false; }, 0);
        // Tell the webview to rebaseline its pristine-detection state to the
        // newly saved content. Without this, an undo after save would be
        // treated as "pristine" relative to the pre-load content and our
        // dirty-clearing save() would overwrite the real saved state on disk.
        // v1.6.0 — Send the resolved form so it matches the editor's serialized
        // output (image URIs are in webview-resolved form inside the editor).
        webviewPanel.webview.postMessage({
          type: 'saved',
          content: this.resolveImageUris(savedDoc.getText(), savedDoc.uri, webviewPanel.webview)
        });
        // 2.3.0 — Refresh the sidebar footer's "Modified X ago" so it reflects
        // the on-disk mtime that just changed.
        void this.sendDocMetaToWebview(webviewPanel.webview, document);
        // v1.6.0 — orphan-image cleanup: delete images that fell out of the
        // doc since last save (or were pasted this session and never linked),
        // gated to the configured imagePaste folder + a workspace-wide
        // reference check so we never delete an image still in use.
        void this.cleanupOrphanedImages(savedDoc).catch(err => {
          console.warn('MikeDown: orphan-image cleanup failed —', (err as Error).message);
        });
      }
    });

    // Listen for document changes — either from this WYSIWYG editor or an external source.
    //
    // Real-time sync guarantee:
    //   - WYSIWYG → text editor: when the webview sends 'edit', we apply a WorkspaceEdit.
    //     VS Code then updates the TextDocument and any standard text editor showing the same
    //     file sees the change automatically — no extra subscription needed.
    //   - Text editor → WYSIWYG: onDidChangeTextDocument fires; handleExternalChange sends
    //     an 'update' message to the webview so it reflects the latest content.
    const changeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() !== document.uri.toString()) {
        return; // Not our document
      }
      if (webviewEditsInFlight > 0) {
        return; // Change was triggered by our own WorkspaceEdit — ignore to prevent reload loop
      }
      if (isSaving) {
        return; // Change was triggered by VS Code's save (e.g. trim whitespace) — not external
      }

      this.handleExternalChange(document, webviewPanel, event);
    });

    // Clean up the listener when the panel is closed
    webviewPanel.onDidDispose(() => {
      changeSubscription.dispose();
      willSaveSubscription.dispose();
      didSaveSubscription.dispose();
      imageWatcherDeleteSub.dispose();
      imageWatcherCreateSub.dispose();
      imageWatcher.dispose();
      // M3 — Clear active panel reference when this panel is closed.
      MarkdownEditorProvider.openPanels.delete(webviewPanel);
      MarkdownEditorProvider.lastStatsByPanel.delete(webviewPanel);
      if (MarkdownEditorProvider.activePanel === webviewPanel) {
        MarkdownEditorProvider.activePanel = undefined;
        MarkdownEditorProvider.activeDocument = undefined;
        // Hide stats if no other MikeDown panel is taking over and no plain-text markdown editor is active.
        const activeEditor = vscode.window.activeTextEditor;
        const stillMarkdown = activeEditor && (
          activeEditor.document.languageId === 'markdown' ||
          activeEditor.document.fileName.endsWith('.md') ||
          activeEditor.document.fileName.endsWith('.markdown')
        );
        if (!stillMarkdown && MarkdownEditorProvider.statusBar) {
          MarkdownEditorProvider.statusBar.hide();
        }
      }
      // Drop per-doc orphan-cleanup state once no panel still has the doc open.
      let stillOpen = false;
      for (const otherDoc of MarkdownEditorProvider.openPanels.values()) {
        if (otherDoc.uri.fsPath === document.uri.fsPath) { stillOpen = true; break; }
      }
      if (!stillOpen) {
        this.imagePathsBaseline.delete(document.uri.fsPath);
        this.sessionPastedAbsPaths.delete(document.uri.fsPath);
      }
      // Clean up diff tracking; if only one panel remains, restore editability
      const panels = MarkdownEditorProvider.panelsByPath.get(fsPath);
      if (panels) {
        panels.delete(entry);
        if (panels.size === 1) {
          for (const e of panels) {
            e.webview.postMessage({ type: 'setReadOnly', readOnly: false });
          }
        }
        if (panels.size === 0) {
          MarkdownEditorProvider.panelsByPath.delete(fsPath);
        }
      }
    });

    // Handle messages from the webview
    webviewPanel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      switch (message.type) {
        case 'edit': {
          // M2d — Apply cleanup normalization before writing to disk.
          // Guard stays up for the entire async operation so all change
          // events fired by this WorkspaceEdit are suppressed.
          webviewEditsInFlight++;
          // v1.6.0 — Reverse the resolve step we applied on `update` so any
          // image whose src was rewritten to a webview URI for display goes
          // back to its on-disk relative path before saving.
          const incoming = this.unresolveImageUris(
            message.content ?? '',
            document.uri,
            webviewPanel.webview
          );
          // When pristine, skip applyCleanup so the TextDocument matches disk
          // exactly; when not pristine, normalize as usual.
          const cleaned = message.pristine ? incoming : this.applyCleanup(incoming);
          if (cleaned !== document.getText()) {
            await this.applyEdit(document, cleaned);
          }
          // VS Code's dirty flag is version-based, not content-based, so a
          // WorkspaceEdit that happens to make content match disk does NOT
          // clear dirty. Only save() or revert() can. When the webview
          // signals pristine (user has undone all changes), save() the doc
          // — it's a no-op write (content already matches disk) that bumps
          // the saved-version marker and clears the dot.
          if (message.pristine && document.isDirty) {
            await document.save();
          }
          // Defer decrement to the next tick — onDidChangeTextDocument events
          // from the WorkspaceEdit may be dispatched asynchronously after the
          // applyEdit promise resolves; the guard must stay up until they land.
          setTimeout(() => { webviewEditsInFlight--; }, 0);
          break;
        }
        case 'ready': {
          // Webview signals it is ready — send current content + settings
          this.updateWebview(document, webviewPanel.webview);
          this.sendThemeToWebview(webviewPanel.webview);
          this.sendSettingsToWebview(webviewPanel.webview, document);
          this.sendOutlineStateToWebview(webviewPanel.webview, document);
          MarkdownEditorProvider.sendBacklinksToWebview(webviewPanel.webview, document);
          void this.sendDocMetaToWebview(webviewPanel.webview, document);
          // Send initial git diff status so the toolbar diff button can be enabled/disabled
          if (document.uri.scheme === 'file') {
            this.sendDiffStatus(document, webviewPanel.webview);
          }
          break;
        }
        case 'stats': {
          const plainText = (message as { plainText?: string }).plainText ?? '';
          MarkdownEditorProvider.lastStatsByPanel.set(webviewPanel, plainText);
          if (MarkdownEditorProvider.activePanel === webviewPanel && MarkdownEditorProvider.statusBar) {
            MarkdownEditorProvider.statusBar.updateDebounced(plainText);
          }
          break;
        }
        case 'toggleSource':
          // M4 — The webview toolbar button posts this message; forward it back
          // as a 'toggleSource' message so the webview handles the toggle.
          webviewPanel.webview.postMessage({ type: 'toggleSource' });
          break;
        case 'requestDiff': {
          // Get HEAD version of this file from git and send it to the webview
          const filePath = document.uri.fsPath;
          const cwd = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
            ?? path.dirname(filePath);
          const relativePath = path.relative(cwd, filePath);
          try {
            const headContent = cp.execSync(
              `git show HEAD:"${relativePath}"`,
              { cwd, encoding: 'utf-8', timeout: 5000 }
            );
            webviewPanel.webview.postMessage({
              type: 'diffData',
              headContent,
              hasChanges: headContent !== document.getText(),
            });
          } catch {
            // File is untracked or no git repo
            webviewPanel.webview.postMessage({
              type: 'diffData',
              headContent: null,
              hasChanges: false,
            });
          }
          break;
        }
        case 'showDiff':
          // Webview requests to open the text-based git diff
          await vscode.commands.executeCommand('mikedown.showDiff');
          break;
        case 'toggleTheme': {
          const toggleSettings = getSettings();
          if (toggleSettings.themeToggleScope === 'vscode') {
            await vscode.commands.executeCommand('workbench.action.toggleLightDarkThemes');
          } else {
            // Editor-only: flip the persisted editorTheme setting and broadcast
            const config = vscode.workspace.getConfiguration('mikedown');
            const current = toggleSettings.editorTheme;
            // Determine effective current appearance to know what to flip to
            let newTheme: 'light' | 'dark';
            if (current === 'auto') {
              // Detect VS Code's current theme kind
              const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
                || vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
              newTheme = isDark ? 'light' : 'dark';
            } else {
              newTheme = current === 'dark' ? 'light' : 'dark';
            }
            await config.update('editorTheme', newTheme, vscode.ConfigurationTarget.Global);
            // Broadcast is handled by the onDidChangeConfiguration listener
          }
          break;
        }
        case 'exportHtml': {
          const suggestedName = document.fileName;
          await writeRenderedHtml(message.html ?? '', suggestedName);
          break;
        }
        case 'viewInBrowser': {
          await openRenderedInBrowser(message.html ?? '', document.uri.fsPath);
          break;
        }
        case 'printDocument': {
          await openRenderedInBrowser(message.html ?? '', document.uri.fsPath, { autoPrint: true });
          break;
        }
        case 'printReady':
          // Print is handled by the webview's window.print() call — no host action needed.
          console.log('MikeDown: printReady received');
          break;
        case 'copyRichText':
          // Copy-as-rich-text is handled entirely in the webview via Clipboard API.
          console.log('MikeDown: copyRichText handled in webview');
          break;
        case 'openLink': {
          // M6a — Navigate to a link from the WYSIWYG editor.
          const href = message.href as string;
          const settings = getSettings();

          if (!href) break;

          // Internal anchor link (#section-name)
          if (href.startsWith('#')) {
            // Post back to webview to scroll to anchor
            webviewPanel.webview.postMessage({ type: 'scrollToAnchor', anchor: href.slice(1) });
            break;
          }

          // External URL
          if (href.startsWith('http://') || href.startsWith('https://')) {
            vscode.env.openExternal(vscode.Uri.parse(href));
            break;
          }

          // Other URL schemes that should be handed to the OS (mail client,
          // dialer, etc.) rather than resolved as a relative file path.
          if (/^(mailto|tel|sms|ftp|ftps|news|nntp|magnet|irc|xmpp|skype|callto|geo|bitcoin):/i.test(href)) {
            vscode.env.openExternal(vscode.Uri.parse(href));
            break;
          }

          // Relative file link (may include anchor: ./other.md#section).
          // The href comes through verbatim from the markdown source, so percent-
          // encoded paths (e.g. `_SQL%20Files/...%28DEV%20DRAFT%29.sql`) must be
          // decoded before being handed to the filesystem, which has the literal
          // characters on disk.
          const [filePart, anchor] = href.split('#');
          const resolvedUri = vscode.Uri.joinPath(
            vscode.Uri.file(path.dirname(document.uri.fsPath)),
            decodePathPart(filePart)
          );

          // If the webview sent an explicit behavior override (e.g. from the
          // context menu), use that; otherwise fall back to the user setting.
          const effectiveBehavior = message.behavior ?? settings.linkClickBehavior;
          const viewColumn = effectiveBehavior === 'navigateCurrentTab'
            ? vscode.ViewColumn.Active
            : vscode.ViewColumn.Beside;

          await vscode.commands.executeCommand('vscode.open', resolvedUri, { viewColumn });

          // If anchor included, post a scrollToAnchor after a brief delay
          if (anchor) {
            setTimeout(() => {
              webviewPanel.webview.postMessage({ type: 'scrollToAnchor', anchor });
            }, 300);
          }
          break;
        }
        case 'checkLinks': {
          const links: Array<{ href: string; type: 'anchor' | 'file' | 'fileAnchor' }> = message.links || [];
          const currentFile = document.uri;
          const currentDir = path.dirname(currentFile.fsPath);
          const currentText = document.getText();

          // Get anchor IDs from current document
          const headingRegex = /^#{1,6}\s+(.+)$/gm;
          const anchorIds = new Set<string>();
          let m: RegExpExecArray | null;
          while ((m = headingRegex.exec(currentText)) !== null) {
            anchorIds.add(githubAnchorId(m[1]));
          }
          for (const id of collectHtmlAnchorIds(currentText)) anchorIds.add(id);

          const brokenLinks: string[] = [];

          for (const link of links) {
            if (link.type === 'anchor') {
              const anchor = link.href.slice(1); // remove '#'
              if (!anchorIds.has(anchor)) brokenLinks.push(link.href);
            } else if (link.type === 'file' || link.type === 'fileAnchor') {
              const [filePart, anchorPart] = link.href.split('#');
              const absPath = path.resolve(currentDir, decodePathPart(filePart));
              try {
                await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
                if (anchorPart && link.type === 'fileAnchor') {
                  // Check heading or HTML anchor exists in target file
                  const content = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(absPath))).toString('utf8');
                  const anchors = new Set<string>();
                  const re = /^#{1,6}\s+(.+)$/gm;
                  let r: RegExpExecArray | null;
                  while ((r = re.exec(content)) !== null) anchors.add(githubAnchorId(r[1]));
                  for (const id of collectHtmlAnchorIds(content)) anchors.add(id);
                  if (!anchors.has(anchorPart)) brokenLinks.push(link.href);
                }
              } catch {
                brokenLinks.push(link.href);
              }
            }
          }

          webviewPanel.webview.postMessage({ type: 'brokenLinks', hrefs: brokenLinks });
          break;
        }
        case 'getLinkSuggestions': {
          // M6b — Scan workspace for .md/.markdown files and current document headings.
          const currentFile = document.uri;
          const workspaceFolder = vscode.workspace.getWorkspaceFolder(currentFile);

          // Find all .md/.markdown files in workspace
          const mdFiles = await vscode.workspace.findFiles('**/*.{md,markdown}', '**/node_modules/**', 200);
          const suggestions: Array<{ label: string; href: string; type: 'file' | 'anchor'; level?: number }> = [];

          // Add file suggestions with relative paths
          for (const fileUri of mdFiles) {
            const fromDir = path.dirname(currentFile.fsPath);
            const rel = path.relative(fromDir, fileUri.fsPath).replace(/\\/g, '/');
            const href = rel.startsWith('.') ? rel : './' + rel;
            suggestions.push({ label: path.basename(fileUri.fsPath), href, type: 'file' });
          }

          // Add heading anchors for the current document with hierarchy level
          const text = document.getText();
          const headingRegex = /^(#{1,6})\s+(.+)$/gm;
          let m: RegExpExecArray | null;
          while ((m = headingRegex.exec(text)) !== null) {
            const level = m[1].length;
            const anchor = '#' + githubAnchorId(m[2]);
            suggestions.push({ label: m[2], href: anchor, type: 'anchor', level });
          }
          for (const id of collectHtmlAnchorIds(text)) {
            suggestions.push({ label: id, href: '#' + id, type: 'anchor' });
          }

          webviewPanel.webview.postMessage({ type: 'linkSuggestions', suggestions });
          break;
        }
        case 'getFileHeadings': {
          // M6b — Read headings from a specific markdown file (resolved relative to current doc).
          const targetPath = message.filePath as string;
          const currentDir = path.dirname(document.uri.fsPath);
          const absPath = path.resolve(currentDir, targetPath);
          try {
            const content = Buffer.from(
              await vscode.workspace.fs.readFile(vscode.Uri.file(absPath))
            ).toString('utf8');
            const headingRegex = /^(#{1,6})\s+(.+)$/gm;
            const anchors: Array<{ label: string; href: string; type: 'anchor'; level?: number }> = [];
            let m: RegExpExecArray | null;
            while ((m = headingRegex.exec(content)) !== null) {
              anchors.push({ label: m[2], href: '#' + githubAnchorId(m[2]), type: 'anchor', level: m[1].length });
            }
            for (const id of collectHtmlAnchorIds(content)) {
              anchors.push({ label: id, href: '#' + id, type: 'anchor' });
            }
            webviewPanel.webview.postMessage({ type: 'fileHeadings', filePath: targetPath, anchors });
          } catch { /* file not found — silently ignore */ }
          break;
        }
        case 'saveSettings': {
          const settings = (message as any).settings || {};
          const config = vscode.workspace.getConfiguration('mikedown');
          if (settings.fontSize) {
            config.update('fontSize', settings.fontSize, vscode.ConfigurationTarget.Global);
          }
          if (settings.fontFamily !== undefined) {
            config.update('fontFamily', settings.fontFamily, vscode.ConfigurationTarget.Global);
          }
          if (settings.headingFontFamily !== undefined) {
            config.update('headingFontFamily', settings.headingFontFamily, vscode.ConfigurationTarget.Global);
          }
          if (settings.imagePaste && typeof settings.imagePaste === 'object') {
            const ip = settings.imagePaste;
            const pairs: Array<[string, unknown]> = [
              ['imagePaste.enabled', ip.enabled],
              ['imagePaste.folder', ip.folder],
              ['imagePaste.folderRelativeTo', ip.folderRelativeTo],
              ['imagePaste.filenamePattern', ip.filenamePattern],
              ['imagePaste.pathStyle', ip.pathStyle],
              ['imagePaste.altText', ip.altText],
              ['imagePaste.maxSizeMB', ip.maxSizeMB],
              ['imagePaste.cleanupUnreferenced', ip.cleanupUnreferenced],
            ];
            for (const [key, value] of pairs) {
              if (value !== undefined) {
                config.update(key, value, vscode.ConfigurationTarget.Global);
              }
            }
          }
          if (settings.imageResize && typeof settings.imageResize === 'object') {
            const ir = settings.imageResize;
            if (ir.overwrite !== undefined) {
              config.update('imageResize.overwrite', ir.overwrite, vscode.ConfigurationTarget.Global);
            }
          }
          if (settings.outlineVisibility === 'always' || settings.outlineVisibility === 'never' || settings.outlineVisibility === 'remember') {
            config.update('outline.visibility', settings.outlineVisibility, vscode.ConfigurationTarget.Global);
          }
          if (settings.outlinePosition === 'left' || settings.outlinePosition === 'right') {
            config.update('outline.position', settings.outlinePosition, vscode.ConfigurationTarget.Global);
          }
          vscode.window.showInformationMessage('MikeDown settings saved.');
          break;
        }
        case 'outlineRequestState': {
          this.sendOutlineStateToWebview(webviewPanel.webview, document);
          break;
        }
        case 'outlineSetWidth': {
          const w = Math.max(160, Math.min(360, Math.round(Number((message as any).width) || 200)));
          await vscode.workspace.getConfiguration('mikedown').update('outline.width', w, vscode.ConfigurationTarget.Global);
          break;
        }
        case 'outlineSetVisible': {
          const visible = (message as any).visible === true;
          const key = 'mikedown.outline.rememberedVisible';
          const map = this.context.globalState.get<Record<string, boolean>>(key, {});
          map[document.uri.toString()] = visible;
          await this.context.globalState.update(key, map);
          break;
        }
        case 'sidebarSectionCollapsed': {
          const section = String((message as any).section ?? '');
          const collapsed = (message as any).collapsed === true;
          if (section) {
            const key = 'mikedown.sidebar.collapsedSections';
            const map = this.context.globalState.get<Record<string, string[]>>(key, {});
            const docKey = document.uri.toString();
            const set = new Set<string>(map[docKey] ?? []);
            if (collapsed) set.add(section); else set.delete(section);
            map[docKey] = [...set];
            await this.context.globalState.update(key, map);
          }
          break;
        }
        case 'savePastedImage': {
          await this.handleSavePastedImage(document, webviewPanel.webview, message);
          break;
        }
        case 'resizeImage': {
          await this.handleResizeImage(document, webviewPanel.webview, message);
          break;
        }
        default:
          console.warn(`MikeDown: unknown message type "${(message as { type: string }).type}"`);
      }
    });
  }

  /**
   * Send the current document text to the webview.
   *
   * M2d — IMPORTANT: send raw content without modification to prevent false
   * dirty flag on open. Do NOT apply any transformations (cleanup, normalization,
   * etc.) to the content before sending it to the webview. The webview uses the
   * raw text as the originalContent baseline for dirty-state detection.
   *
   * M7 — Image URIs are resolved to webview-accessible vscode-webview: URIs
   * before sending so that relative paths like ./image.png are rendered inline.
   */
  private updateWebview(document: vscode.TextDocument, webview: vscode.Webview): void {
    const resolvedContent = this.resolveImageUris(document.getText(), document.uri, webview);
    webview.postMessage({
      type: 'update',
      content: resolvedContent
    });
  }

  /**
   * M7 — Resolve relative image paths in markdown to webview-accessible URIs.
   *
   * Scans all `![alt](src)` patterns in the markdown and converts any relative
   * or absolute local paths to `vscode-webview:` URIs using `webview.asWebviewUri`.
   * External URLs (http/https), data URIs, and already-resolved vscode-webview
   * URIs are left untouched.
   */
  private resolveImageUris(markdown: string, documentUri: vscode.Uri, webview: vscode.Webview): string {
    return markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
      if (isExternalOrDataUri(src) || isWebviewResolvedUri(src)) {
        return match;
      }
      try {
        const docDir = vscode.Uri.joinPath(documentUri, '..');
        const imgUri = vscode.Uri.joinPath(docDir, src);
        const webviewUri = webview.asWebviewUri(imgUri);
        return `![${alt}](${webviewUri.toString()})`;
      } catch {
        return match;
      }
    });
  }

  /**
   * Reverse of `resolveImageUris`: converts webview-resolved image URIs back to
   * a path that's safe to write to disk (relative to the document directory,
   * or an absolute path if the file lives outside both the document tree and
   * any workspace folder). Applied to every `edit` payload before we hit
   * `applyCleanup` so a round-trip through the editor preserves the original
   * markdown source — without this, vscode-webview/vscode-cdn URIs leak into
   * saved files and break the next time the document is opened (the URIs are
   * session-scoped).
   */
  private unresolveImageUris(markdown: string, documentUri: vscode.Uri, webview: vscode.Webview): string {
    const { prefixes, docDirFs } = this.buildImagePathMappings(documentUri, webview);

    return markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
      // Skip true external/data URIs, but NOT webview-resolved URIs — those
      // start with https:// (modern VS Code emits https://*.vscode-cdn.net/...
      // from asWebviewUri) and are exactly what we're trying to reverse here.
      if (isExternalOrDataUri(src) && !isWebviewResolvedUri(src)) return match;
      // Strip cache-bust queries / fragments (added by the resize popover so
      // the browser re-fetches an overwritten file). They're meaningless on a
      // local-disk path and would otherwise leak into the saved markdown.
      const queryStart = src.search(/[?#]/);
      const cleanSrc = queryStart >= 0 ? src.slice(0, queryStart) : src;
      for (const { prefix, fsPath } of prefixes) {
        if (cleanSrc.startsWith(prefix + '/')) {
          const tail = decodePathPart(cleanSrc.slice(prefix.length + 1));
          const absPath = path.join(fsPath, tail);
          const rel = path.relative(docDirFs, absPath).split(path.sep).join('/');
          return `![${alt}](${rel})`;
        }
        if (cleanSrc === prefix) {
          return match;
        }
      }
      return match;
    });
  }

  /**
   * Build the prefix-to-fsPath mapping the webview needs to mirror
   * `unresolveImageUris`. Returned in posix form (forward-slash separators)
   * so the webview can do straight string operations regardless of host OS,
   * sorted longest-prefix-first so the more-specific docDir match wins.
   */
  private buildImagePathMappings(
    documentUri: vscode.Uri,
    webview: vscode.Webview
  ): { prefixes: Array<{ prefix: string; fsPath: string }>; docDirFs: string } {
    const docDir = vscode.Uri.joinPath(documentUri, '..');
    const toPosix = (p: string): string => p.split(path.sep).join('/');
    const docDirFs = toPosix(docDir.fsPath);
    const prefixes: Array<{ prefix: string; fsPath: string }> = [];

    const pushPrefix = (uri: vscode.Uri): void => {
      try {
        const resolved = webview.asWebviewUri(uri).toString();
        const trimmed = resolved.endsWith('/') ? resolved.slice(0, -1) : resolved;
        prefixes.push({ prefix: trimmed, fsPath: toPosix(uri.fsPath) });
      } catch { /* ignore */ }
    };

    pushPrefix(docDir);
    for (const wf of vscode.workspace.workspaceFolders ?? []) {
      pushPrefix(wf.uri);
    }
    prefixes.sort((a, b) => b.prefix.length - a.prefix.length);

    return { prefixes, docDirFs };
  }

  /**
   * Read mikedown font settings from VS Code configuration and push them to
   * the webview as a 'theme' message.  The webview applies the values as CSS
   * custom properties on the document root so they cascade to every element.
   */
  private sendThemeToWebview(webview: vscode.Webview): void {
    const config = vscode.workspace.getConfiguration('mikedown');
    const bodyFont = config.get<string>('fontFamily', '') || "Charter, 'Bitstream Charter', Cambria, Georgia, serif";
    const headingFont = config.get<string>('headingFontFamily', '') || "'Avenir Next', Avenir, 'Segoe UI', Calibri, sans-serif";
    webview.postMessage({
      type: 'theme',
      fontFamily: bodyFont,
      headingFontFamily: headingFont,
      fontSize: config.get<number>('fontSize', 15),
    });
  }

  /**
   * Check whether the file has uncommitted git changes and notify the webview.
   */
  private sendDiffStatus(document: vscode.TextDocument, webview: vscode.Webview): void {
    const filePath = document.uri.fsPath;
    const cwd = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
      ?? path.dirname(filePath);
    const relativePath = path.relative(cwd, filePath);
    try {
      const headContent = cp.execSync(
        `git show HEAD:"${relativePath}"`,
        { cwd, encoding: 'utf-8', timeout: 5000 }
      );
      webview.postMessage({
        type: 'diffStatus',
        hasChanges: headContent !== document.getText(),
      });
    } catch {
      webview.postMessage({ type: 'diffStatus', hasChanges: false });
    }
  }

  /**
   * Push user-facing settings (e.g. linkClickBehavior) to the webview so it
   * can adapt its click/context-menu behavior without round-tripping to host.
   */
  private sendSettingsToWebview(webview: vscode.Webview, document: vscode.TextDocument): void {
    const settings = getSettings();
    // Image-path mappings let the webview show on-disk relative paths (e.g.
    // `images/foo.png`) instead of session-scoped webview URIs in surfaces
    // like the image-edit popover. Trade-off: the webview only mirrors what
    // the host computes, so any new prefix added here must also update its
    // local copy via the next 'settings' broadcast.
    const { prefixes, docDirFs } = this.buildImagePathMappings(document.uri, webview);
    webview.postMessage({
      type: 'settings',
      linkClickBehavior: settings.linkClickBehavior,
      themeToggleScope: settings.themeToggleScope,
      editorTheme: settings.editorTheme,
      imagePaste: settings.imagePaste,
      imageResize: settings.imageResize,
      imagePastePathMappings: prefixes,
      docDirFs,
    });
  }

  private sendOutlineStateToWebview(webview: vscode.Webview, document: vscode.TextDocument): void {
    const config = vscode.workspace.getConfiguration('mikedown');
    const pref = config.get<'always' | 'never' | 'remember'>('outline.visibility', 'never');
    const width = config.get<number>('outline.width', 200);
    const position = config.get<'left' | 'right'>('outline.position', 'right');
    const remembered = this.context.globalState.get<Record<string, boolean>>('mikedown.outline.rememberedVisible', {});
    const rememberedVisible = remembered[document.uri.toString()] === true;
    const collapsedMap = this.context.globalState.get<Record<string, string[]>>('mikedown.sidebar.collapsedSections', {});
    const collapsedSections = collapsedMap[document.uri.toString()] ?? [];
    webview.postMessage({
      type: 'outlineState',
      pref,
      width,
      position,
      rememberedVisible,
      collapsedSections,
    });
  }

  /** Send modified-time + initial backlink list. Called on open and on save. */
  private async sendDocMetaToWebview(
    webview: vscode.Webview,
    document: vscode.TextDocument
  ): Promise<void> {
    let mtimeMs: number | null = null;
    if (document.uri.scheme === 'file') {
      try {
        const stat = await vscode.workspace.fs.stat(document.uri);
        mtimeMs = stat.mtime;
      } catch { /* untracked or missing — leave null */ }
    }
    webview.postMessage({ type: 'docMeta', mtimeMs });
  }

  /**
   * Apply a WorkspaceEdit to update the TextDocument with new content from the webview.
   */
  private async applyEdit(document: vscode.TextDocument, newContent: string): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      newContent
    );
    await vscode.workspace.applyEdit(edit);
  }

  /**
   * M2d — Apply markdown cleanup/normalization before writing to disk.
   *
   * Always applied:
   *   • Collapse 3+ consecutive blank lines to 2.
   *   • Trim trailing whitespace from each line (spaces/tabs that are not
   *     intentional two-space line breaks).
   *
   * Applied only when `mikedown.markdownNormalization` is set to 'normalize':
   *   • Bold marker:   ** → __ (if configured)
   *   • Italic marker: * → _  (if configured)
   *   • List marker:   - → * or + (if configured)
   */
  private applyCleanup(markdown: string): string {
    const config = vscode.workspace.getConfiguration('mikedown');
    const normalization = config.get<string>('markdownNormalization', 'preserve');

    // Always: normalize blank lines between blocks and trim trailing whitespace.
    let result = markdown
      .replace(/\n{3,}/g, '\n\n')   // collapse 3+ blank lines to 2
      .replace(/[ \t]+$/gm, '');     // trim trailing whitespace (not intentional line breaks)

    if (normalization === 'normalize') {
      const boldMarker = config.get<string>('normalizationStyle.boldMarker', '**');
      const italicMarker = config.get<string>('normalizationStyle.italicMarker', '*');
      const listMarker = config.get<string>('normalizationStyle.listMarker', '-');

      if (boldMarker === '__') {
        result = result.replace(/\*\*([^*]+)\*\*/g, '__$1__');
      }
      if (italicMarker === '_') {
        result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '_$1_');
      }
      if (listMarker !== '-') {
        result = result.replace(/^- /gm, `${listMarker} `);
      }
    }

    return result;
  }

  /**
   * Handle a change to the underlying TextDocument that was NOT triggered by
   * this WYSIWYG editor (i.e. external edits from another editor tab, a git
   * operation, file-system write, etc.).
   *
   * - If the document has no unsaved changes (not dirty) and the
   *   autoReloadUnmodifiedFiles setting is enabled, silently reload the webview.
   * - If the document is dirty, prompt the user to reload or keep their changes.
   */
  private async handleExternalChange(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _event: vscode.TextDocumentChangeEvent
  ): Promise<void> {
    const settings = getSettings();

    if (!document.isDirty) {
      // No unsaved changes — auto-reload if the setting allows it
      if (settings.autoReloadUnmodifiedFiles) {
        // Send fresh content to webview silently
        webviewPanel.webview.postMessage({
          type: 'update',
          content: this.resolveImageUris(document.getText(), document.uri, webviewPanel.webview)
        });

        // Show a brief status-bar notification
        vscode.window.setStatusBarMessage('$(refresh) Document auto-reloaded', 5000);
      }
      return;
    }

    // Document has unsaved changes — prompt the user
    const choice = await vscode.window.showInformationMessage(
      'The file has been modified externally. Do you want to reload it? Your unsaved changes will be lost.',
      { modal: false },
      'Reload',
      'Keep'
    );

    if (choice === 'Reload') {
      // VS Code has already updated the TextDocument from disk; send new content to webview
      webviewPanel.webview.postMessage({
        type: 'update',
        content: this.resolveImageUris(document.getText(), document.uri, webviewPanel.webview)
      });
    }
    // 'Keep' or dismissed: do nothing — leave the webview with the user's unsaved content
  }

  /**
   * Handle a 'savePastedImage' request from the webview: write the image bytes
   * to disk per `mikedown.imagePaste.*` settings and reply with the resolved
   * insert path, the webview-display URI, and the alt text.
   */
  private async handleSavePastedImage(
    document: vscode.TextDocument,
    webview: vscode.Webview,
    message: WebviewMessage
  ): Promise<void> {
    const requestId = message.requestId ?? '';
    const reply = (payload: Record<string, unknown>): void => {
      webview.postMessage({ type: 'pastedImageResult', requestId, ...payload });
    };

    const settings = getSettings().imagePaste;
    if (!settings.enabled) {
      reply({ error: 'imagePaste.enabled is false' });
      return;
    }

    if (document.uri.scheme !== 'file') {
      const pick = await vscode.window.showWarningMessage(
        'MikeDown: save the document before pasting an image so the file can be written next to it.',
        'Save As…',
        'Cancel'
      );
      if (pick === 'Save As…') {
        await vscode.commands.executeCommand('workbench.action.files.saveAs');
      }
      reply({ error: 'document not saved' });
      return;
    }

    const mime = (message.mime ?? '').toLowerCase();
    const ext = extensionFromMime(mime);
    if (!ext) {
      reply({ error: `unsupported MIME type: ${mime}` });
      return;
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(message.dataBase64 ?? '', 'base64');
    } catch (err) {
      reply({ error: 'invalid image data' });
      return;
    }

    if (buffer.length === 0) {
      reply({ error: 'empty image data' });
      return;
    }

    const sizeMB = buffer.length / (1024 * 1024);
    if (sizeMB > settings.maxSizeMB) {
      const msg = `Pasted image is ${sizeMB.toFixed(1)} MB, exceeds the ${settings.maxSizeMB} MB limit (mikedown.imagePaste.maxSizeMB).`;
      vscode.window.showErrorMessage(msg);
      reply({ error: msg });
      return;
    }

    const docPath = document.uri.fsPath;
    const docName = path.basename(docPath, path.extname(docPath));
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const workspaceRoot = workspaceFolder?.uri.fsPath;

    const targetFolder = resolveTargetFolder(settings, docPath, workspaceRoot);
    try {
      await fs.promises.mkdir(targetFolder, { recursive: true });
    } catch (err) {
      const msg = `Failed to create folder ${targetFolder}: ${(err as Error).message}`;
      vscode.window.showErrorMessage(msg);
      reply({ error: msg });
      return;
    }

    const data = new Uint8Array(buffer);
    const resolution = resolveFilename(
      settings.filenamePattern,
      targetFolder,
      { docName, extension: ext, data, timestamp: new Date() },
      (p: string) => fs.existsSync(p),
      (p: string) => sha1HexFile(p)
    );

    if (!resolution.reused) {
      try {
        await fs.promises.writeFile(resolution.absPath, buffer);
      } catch (err) {
        const msg = `Failed to write ${resolution.absPath}: ${(err as Error).message}`;
        vscode.window.showErrorMessage(msg);
        reply({ error: msg });
        return;
      }
    }

    // Track this paste so orphan-cleanup can remove it on save if the user
    // deletes the image before persisting (it wouldn't be in the open-time
    // baseline otherwise).
    const pastedSet = this.sessionPastedAbsPaths.get(docPath) ?? new Set<string>();
    pastedSet.add(resolution.absPath);
    this.sessionPastedAbsPaths.set(docPath, pastedSet);

    const insertPath = formatInsertPath(resolution.absPath, docPath, workspaceRoot, settings.pathStyle);
    const filenameNoExt = path.basename(resolution.absPath, path.extname(resolution.absPath));

    let alt = '';
    if (settings.altText === 'prompt') {
      const prompted = await vscode.window.showInputBox({
        prompt: 'Alt text for pasted image (leave empty for none)',
        value: '',
        placeHolder: 'Describe the image for screen readers',
      });
      alt = resolveAltText('prompt', filenameNoExt, prompted ?? '');
    } else {
      alt = resolveAltText(settings.altText, filenameNoExt, undefined);
    }

    const webviewUri = webview.asWebviewUri(vscode.Uri.file(resolution.absPath)).toString();

    reply({
      success: true,
      insertPath,
      webviewUri,
      alt,
      reused: resolution.reused,
    });
  }

  /**
   * Handle a 'resizeImage' request from the webview popover. The webview has
   * already downscaled the image bytes via canvas; here we just figure out
   * where on disk to write them (overwrite the original file or write a
   * sibling like `foo-50pct.png`) and reply with paths the webview can use.
   */
  private async handleResizeImage(
    document: vscode.TextDocument,
    webview: vscode.Webview,
    message: WebviewMessage
  ): Promise<void> {
    const requestId = message.requestId ?? '';
    const reply = (payload: Record<string, unknown>): void => {
      webview.postMessage({ type: 'resizeImageResult', requestId, ...payload });
    };

    if (document.uri.scheme !== 'file') {
      reply({ error: 'document is not a saved file' });
      return;
    }

    const currentSrc = (message.currentSrc ?? '').trim();
    if (!currentSrc) {
      reply({ error: 'currentSrc missing' });
      return;
    }

    const absImagePath = this.resolveSrcToAbsPath(currentSrc, document.uri, webview);
    if (!absImagePath) {
      reply({ error: 'cannot resolve image to a workspace file (external URLs and data URIs cannot be resized in place)' });
      return;
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(message.dataBase64 ?? '', 'base64');
    } catch {
      reply({ error: 'invalid image data' });
      return;
    }
    if (buffer.length === 0) {
      reply({ error: 'empty image data' });
      return;
    }

    const settings = getSettings().imageResize;
    const overwrite = settings.overwrite;
    const percent = Math.max(1, Math.min(200, Math.round(message.percent ?? 0)));
    const targetAbsPath = overwrite
      ? absImagePath
      : resizeSiblingPath(absImagePath, percent, (p) => fs.existsSync(p));

    let originalSize = 0;
    try {
      originalSize = (await fs.promises.stat(absImagePath)).size;
    } catch { /* original missing — still let the write proceed */ }

    try {
      await fs.promises.writeFile(targetAbsPath, buffer);
    } catch (err) {
      const msg = `Failed to write ${targetAbsPath}: ${(err as Error).message}`;
      vscode.window.showErrorMessage(msg);
      reply({ error: msg });
      return;
    }

    const docPath = document.uri.fsPath;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const workspaceRoot = workspaceFolder?.uri.fsPath;
    const insertPath = formatInsertPath(targetAbsPath, docPath, workspaceRoot, 'relative');
    const webviewUri = webview.asWebviewUri(vscode.Uri.file(targetAbsPath)).toString();

    const fmt = (n: number): string => `${(n / 1024).toFixed(1)} KB`;
    const savedKB = originalSize > 0 ? `${fmt(originalSize)} → ${fmt(buffer.length)}` : fmt(buffer.length);
    vscode.window.setStatusBarMessage(
      `MikeDown: resized to ${percent}% (${savedKB})`,
      4000
    );

    reply({
      success: true,
      insertPath,
      webviewUri,
      overwritten: overwrite,
    });
  }

  /**
   * Parse a markdown string for `![alt](src)` image links and resolve each
   * local-file `src` to an absolute path on disk. External URLs and data URIs
   * are skipped. Returns the set of absolute paths the document references.
   */
  private computeReferencedImagePaths(
    documentUri: vscode.Uri,
    markdownText: string
  ): Set<string> {
    const docDir = path.dirname(documentUri.fsPath);
    const wsRoot = vscode.workspace.getWorkspaceFolder(documentUri)?.uri.fsPath;
    const refs = extractLocalImageRefs(markdownText);
    const absPaths = resolveLocalImagePaths(refs, docDir, wsRoot);
    return new Set(absPaths.map(p => path.normalize(p)));
  }

  /**
   * Orphan-image cleanup pass triggered by every save. Diff the in-doc image
   * set against the open-time baseline (plus any session pastes the user
   * removed before saving), then delete files that:
   *
   *   1. live inside the configured imagePaste folder (default `images/`
   *      next to the document, or under the workspace root depending on
   *      `folderRelativeTo`);
   *   2. are no longer referenced by any markdown file in the workspace.
   *
   * Disabled via `mikedown.imagePaste.cleanupUnreferenced = false`.
   */
  private async cleanupOrphanedImages(savedDoc: vscode.TextDocument): Promise<void> {
    const settings = getSettings().imagePaste;
    if (!settings.cleanupUnreferenced) return;

    const docPath = savedDoc.uri.fsPath;
    const previous = this.imagePathsBaseline.get(docPath) ?? new Set<string>();
    const current = this.computeReferencedImagePaths(savedDoc.uri, savedDoc.getText());
    // Update the baseline immediately — even if cleanup fails for some files,
    // the doc has been saved and we don't want stale entries.
    this.imagePathsBaseline.set(docPath, current);

    const removed = new Set<string>();
    for (const p of previous) if (!current.has(p)) removed.add(p);
    const sessionPasted = this.sessionPastedAbsPaths.get(docPath);
    if (sessionPasted) {
      for (const p of sessionPasted) if (!current.has(p)) removed.add(path.normalize(p));
      // Anything that survived (= still referenced) is now part of the saved
      // baseline; anything else we're about to delete. Either way, drop it.
      this.sessionPastedAbsPaths.delete(docPath);
    }
    if (removed.size === 0) return;

    const wsRoot = vscode.workspace.getWorkspaceFolder(savedDoc.uri)?.uri.fsPath;
    const docName = path.basename(docPath, path.extname(docPath));
    const candidates: string[] = [];
    for (const absPath of removed) {
      if (!isInsideManagedFolder(absPath, settings, docPath, wsRoot)) continue;
      // Only auto-delete files that came from the paste pipeline. Files this
      // session pasted are known-ours; for older files we fall back to a
      // filename-shape match against the configured paste pattern. A
      // user-curated asset like `logo.png` won't match either check and is
      // left on disk untouched.
      const wasSessionPasted = sessionPasted?.has(absPath) ?? false;
      if (!wasSessionPasted) {
        const filename = path.basename(absPath);
        if (!looksLikeAutoPastedImage(filename, settings.filenamePattern, docName)) continue;
      }
      try {
        if (!fs.existsSync(absPath)) continue;
      } catch { continue; }
      candidates.push(absPath);
    }
    if (candidates.length === 0) return;

    // Workspace-wide cross-reference check. Skip the saved doc itself (we
    // already know its current refs are in `current`).
    const referencedElsewhere = await this.findImagesReferencedByOtherDocs(
      candidates,
      savedDoc.uri
    );

    let deletedCount = 0;
    for (const absPath of candidates) {
      if (referencedElsewhere.has(absPath)) continue;
      try {
        await fs.promises.unlink(absPath);
        deletedCount += 1;
      } catch (err) {
        console.warn(`MikeDown: failed to delete unreferenced image ${absPath} —`, (err as Error).message);
      }
    }
    if (deletedCount > 0) {
      vscode.window.setStatusBarMessage(
        `MikeDown: removed ${deletedCount} unreferenced image${deletedCount === 1 ? '' : 's'}`,
        4000
      );
    }
  }

  /**
   * Scan all `*.md` / `*.markdown` files in the workspace (excluding the
   * provided `excludeDoc`) and return the subset of `candidates` that are
   * still referenced somewhere.
   */
  private async findImagesReferencedByOtherDocs(
    candidates: string[],
    excludeDoc: vscode.Uri
  ): Promise<Set<string>> {
    const referenced = new Set<string>();
    if (candidates.length === 0) return referenced;
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      // No workspace — nothing else to check against.
      return referenced;
    }
    const candidateSet = new Set(candidates);
    const excludePath = path.normalize(excludeDoc.fsPath);
    // Cap at 2000 markdown files to avoid runaway scans on huge monorepos.
    const files = await vscode.workspace.findFiles(
      '**/*.{md,markdown}',
      '**/node_modules/**',
      2000
    );
    for (const fileUri of files) {
      if (path.normalize(fileUri.fsPath) === excludePath) continue;
      try {
        const bytes = await vscode.workspace.fs.readFile(fileUri);
        const text = Buffer.from(bytes).toString('utf8');
        const refs = extractLocalImageRefs(text);
        const fileDir = path.dirname(fileUri.fsPath);
        const wsRoot = vscode.workspace.getWorkspaceFolder(fileUri)?.uri.fsPath;
        const absRefs = resolveLocalImagePaths(refs, fileDir, wsRoot);
        for (const absRef of absRefs) {
          const norm = path.normalize(absRef);
          if (candidateSet.has(norm)) referenced.add(norm);
        }
        if (referenced.size === candidateSet.size) break; // all accounted for
      } catch {
        // Unreadable file — skip and continue. We bias toward NOT deleting
        // when in doubt, but a single read failure shouldn't block the rest
        // of the scan.
      }
    }
    return referenced;
  }

  /**
   * Reverse a webview src (typically `https://*.vscode-cdn.net/...`) back to
   * an absolute on-disk path using the same prefix table as
   * `unresolveImageUris`. Returns null when the src points outside any known
   * prefix (external URL, data URI, or just a relative path that the webview
   * forgot to resolve).
   */
  private resolveSrcToAbsPath(
    src: string,
    documentUri: vscode.Uri,
    webview: vscode.Webview
  ): string | null {
    // Strip the cache-bust query/fragment the webview appends after a resize.
    const queryStart = src.search(/[?#]/);
    const cleanSrc = queryStart >= 0 ? src.slice(0, queryStart) : src;
    const { prefixes, docDirFs } = this.buildImagePathMappings(documentUri, webview);
    if (isWebviewResolvedUri(cleanSrc)) {
      for (const { prefix, fsPath } of prefixes) {
        if (cleanSrc.startsWith(prefix + '/')) {
          const tail = decodePathPart(cleanSrc.slice(prefix.length + 1));
          return path.join(fsPath, tail);
        }
      }
      return null;
    }
    if (isExternalOrDataUri(cleanSrc)) return null;
    return path.resolve(docDirFs, cleanSrc);
  }

  /**
   * Build the full HTML string for the webview.
   */
  private getWebviewContent(webview: vscode.Webview): string {
    // CSS lives in the source webview directory (not compiled).
    // Each file gets its own <link> tag because CSS @import with relative
    // paths cannot resolve in the webview's vscode-webview: URI scheme.
    const cssDir = path.join(this.context.extensionPath, 'src', 'webview');
    const cssFiles = [
      'editor.css',
      'tables.css',
      'images.css',
      'codeblocks.css',
      'links.css',
      'findreplace.css',
      'contextmenu.css',
      'tablepicker.css',
      'tabledrag.css',
      'tasklist.css',
      'linkautocomplete.css',
      'toolbar-dropdown.css',
      'outline-sidebar.css',
      'emojipicker.css',
    ];
    const cssLinks = cssFiles.map(f => {
      const uri = webview.asWebviewUri(vscode.Uri.file(path.join(cssDir, f)));
      return `  <link rel="stylesheet" href="${uri}">`;
    }).join('\n');

    // The TipTap webview bundle is compiled by webpack to out/webview/editor-main.js
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'out', 'webview', 'editor-main.js'))
    );

    // Content Security Policy: fully offline, no external resources
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `script-src ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'unsafe-inline'`
    ].join('; ');

    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MikeDown Editor</title>
${cssLinks}
</head>
<body>
  <div id="toolbar" role="toolbar" aria-label="Formatting toolbar">
    <span class="toolbar-placeholder">MikeDown</span>
  </div>
  <aside id="mikedown-outline-sidebar" aria-label="Document sidebar" hidden></aside>
  <button type="button" id="mikedown-outline-toggle" aria-label="Show sidebar" title="Show sidebar" aria-expanded="false">
    <span aria-hidden="true">≡</span>
  </button>
  <!-- TipTap mounts directly into #editor-container -->
  <div id="editor-container" role="main" aria-label="Markdown editor"></div>
  <div id="source-container" style="display:none;"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

/**
 * Message shape sent from the webview to the extension host.
 */
interface WebviewMessage {
  type: 'edit' | 'ready' | 'stats' | 'toggleSource' | 'toggleTheme' | 'openLink' | 'exportHtml' | 'viewInBrowser' | 'printDocument' | 'printReady' | 'copyRichText' | 'checkLinks' | 'getLinkSuggestions' | 'getFileHeadings' | 'saveSettings' | 'outlineRequestState' | 'outlineSetWidth' | 'outlineSetVisible' | 'sidebarSectionCollapsed' | 'requestDiff' | 'showDiff' | 'savePastedImage' | 'resizeImage';
  content?: string;
  pristine?: boolean;
  plainText?: string;
  href?: string;
  html?: string;
  links?: Array<{ href: string; type: 'anchor' | 'file' | 'fileAnchor' }>;
  filePath?: string;
  /** Optional override for link navigation behavior (from context menu actions). */
  behavior?: 'navigateCurrentTab' | 'openNewTab';
  anchor?: string;
  /** savePastedImage / resizeImage payload — base64-encoded image bytes and metadata. */
  requestId?: string;
  mime?: string;
  dataBase64?: string;
  /** resizeImage: webview-resolved URI of the image being replaced. */
  currentSrc?: string;
  /** resizeImage: percentage of the original size, e.g. 50 means half-resolution. */
  percent?: number;
}


/**
 * M6c — Generate a GitHub-style anchor ID from a heading's text content.
 * Mirrors the same logic used in the webview (editor-main.ts).
 */
function githubAnchorId(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

/**
 * Collect fragment IDs from inline HTML anchor targets in raw markdown,
 * e.g. `<a id="top"></a>` and `<a name="top"></a>`. Mirrors the narrow
 * raw-HTML slice the HtmlAnchor node recognises — empty `<a>` tags with
 * `id` or `name` and no `href`.
 */
function collectHtmlAnchorIds(content: string): string[] {
  const ids: string[] = [];
  const re = /<a\s+([^>]*?)\s*\/?\s*>\s*(?:<\/a\s*>)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const attrs = m[1] || '';
    if (/\bhref\s*=/i.test(attrs)) continue;
    const idMatch = attrs.match(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const nameMatch = attrs.match(/\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const id = idMatch ? (idMatch[1] ?? idMatch[2]) : null;
    const name = nameMatch ? (nameMatch[1] ?? nameMatch[2]) : null;
    if (id) ids.push(id);
    else if (name) ids.push(name);
  }
  return ids;
}

/**
 * True for URIs that are not local filesystem references — http(s), data: URIs,
 * and other non-resolvable schemes. Used to skip image-URI rewriting.
 */
function isExternalOrDataUri(src: string): boolean {
  return src.startsWith('http://')
    || src.startsWith('https://')
    || src.startsWith('data:')
    || /^(mailto|tel|sms|ftp|ftps):/i.test(src);
}

/**
 * True for already-resolved webview URIs. Modern VS Code emits
 * `https://*.vscode-cdn.net/...` from `asWebviewUri`, but older builds use
 * `vscode-webview:` and `vscode-resource:` — accept all three.
 */
function isWebviewResolvedUri(src: string): boolean {
  return src.startsWith('vscode-webview:')
    || src.startsWith('vscode-resource:')
    || /^https:\/\/[^/]*\.vscode-(?:cdn|resource)\./i.test(src);
}

/** Decode percent-encoded path segments without choking on a malformed input. */
function decodePathPart(input: string): string {
  try { return decodeURI(input); } catch { return input; }
}

/**
 * Read an existing file from disk and return its SHA-1 hex digest.
 * Used by `resolveFilename` for the `${hash}` dedupe path. Returns an empty
 * string on read errors so the caller falls back to the collision-suffix path.
 */
function sha1HexFile(absPath: string): string {
  try {
    const data = fs.readFileSync(absPath);
    return crypto.createHash('sha1').update(data).digest('hex');
  } catch {
    return '';
  }
}

/**
 * Generate a random nonce for CSP.
 */
function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
