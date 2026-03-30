import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getSettings } from './settings';
import { writeRenderedHtml } from './export';

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
  /** All open MikeDown webview panels, for broadcasting messages (e.g. theme changes). */
  private static openPanels = new Set<vscode.WebviewPanel>();

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
    MarkdownEditorProvider.openPanels.add(webviewPanel);
    webviewPanel.onDidChangeViewState(e => {
      if (e.webviewPanel.active) {
        MarkdownEditorProvider.activePanel = webviewPanel;
      } else if (MarkdownEditorProvider.activePanel === webviewPanel) {
        MarkdownEditorProvider.activePanel = undefined;
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
    this.sendSettingsToWebview(webviewPanel.webview);

    // Listen for configuration changes and broadcast to ALL open panels
    // so that e.g. toggling editor theme in one tab updates all tabs.
    const configListener = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('mikedown')) {
        for (const panel of MarkdownEditorProvider.openPanels) {
          this.sendThemeToWebview(panel.webview);
          this.sendSettingsToWebview(panel.webview);
        }
      }
    });
    this.context.subscriptions.push(configListener);

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
        isSaving = false;
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
      // M3 — Clear active panel reference when this panel is closed.
      MarkdownEditorProvider.openPanels.delete(webviewPanel);
      if (MarkdownEditorProvider.activePanel === webviewPanel) {
        MarkdownEditorProvider.activePanel = undefined;
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
          const cleaned = this.applyCleanup(message.content ?? '');
          await this.applyEdit(document, cleaned);
          webviewEditsInFlight--;
          break;
        }
        case 'ready':
          // Webview signals it is ready — send current content + settings
          this.updateWebview(document, webviewPanel.webview);
          this.sendThemeToWebview(webviewPanel.webview);
          this.sendSettingsToWebview(webviewPanel.webview);
          break;
        case 'stats':
          // M2d — Update status bar with plain text for word/character count.
          // The StatusBarManager is wired in extension.ts (M3/M14 hook).
          // For now we receive the plain text and can emit a status bar update
          // once StatusBarManager is accessible from this provider.
          // TODO: wire this to StatusBarManager when M3 (toolbar/status bar) is done.
          break;
        case 'toggleSource':
          // M4 — The webview toolbar button posts this message; forward it back
          // as a 'toggleSource' message so the webview handles the toggle.
          webviewPanel.webview.postMessage({ type: 'toggleSource' });
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

          // Relative file link (may include anchor: ./other.md#section)
          const [filePart, anchor] = href.split('#');
          const resolvedUri = vscode.Uri.joinPath(
            vscode.Uri.file(path.dirname(document.uri.fsPath)),
            filePart
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

          const brokenLinks: string[] = [];

          for (const link of links) {
            if (link.type === 'anchor') {
              const anchor = link.href.slice(1); // remove '#'
              if (!anchorIds.has(anchor)) brokenLinks.push(link.href);
            } else if (link.type === 'file' || link.type === 'fileAnchor') {
              const [filePart, anchorPart] = link.href.split('#');
              const absPath = path.resolve(currentDir, filePart);
              try {
                await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
                if (anchorPart && link.type === 'fileAnchor') {
                  // Check heading exists in target file
                  const content = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(absPath))).toString('utf8');
                  const anchors = new Set<string>();
                  const re = /^#{1,6}\s+(.+)$/gm;
                  let r: RegExpExecArray | null;
                  while ((r = re.exec(content)) !== null) anchors.add(githubAnchorId(r[1]));
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
          vscode.window.showInformationMessage('MikeDown settings saved.');
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
      // Leave external URLs and data URIs alone
      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:') || src.startsWith('vscode-webview:')) {
        return match;
      }
      try {
        const docDir = vscode.Uri.joinPath(documentUri, '..');
        const imgUri = vscode.Uri.joinPath(docDir, src);
        const webviewUri = webview.asWebviewUri(imgUri);
        return `![${alt}](${webviewUri.toString()})`;
      } catch {
        return match; // Leave as-is on error
      }
    });
  }

  /**
   * Read mikedown font settings from VS Code configuration and push them to
   * the webview as a 'theme' message.  The webview applies the values as CSS
   * custom properties on the document root so they cascade to every element.
   */
  private sendThemeToWebview(webview: vscode.Webview): void {
    const config = vscode.workspace.getConfiguration('mikedown');
    webview.postMessage({
      type: 'theme',
      fontFamily: config.get<string>('fontFamily', ''),
      fontSize: config.get<number>('fontSize', 15),
    });
  }

  /**
   * Push user-facing settings (e.g. linkClickBehavior) to the webview so it
   * can adapt its click/context-menu behavior without round-tripping to host.
   */
  private sendSettingsToWebview(webview: vscode.Webview): void {
    const settings = getSettings();
    webview.postMessage({
      type: 'settings',
      linkClickBehavior: settings.linkClickBehavior,
      themeToggleScope: settings.themeToggleScope,
      editorTheme: settings.editorTheme,
    });
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
      'linkautocomplete.css',
      'toolbar-dropdown.css',
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
      `img-src ${webview.cspSource} data:`,
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
  <!-- TipTap mounts directly into #editor-container -->
  <div id="editor-container" role="main" aria-label="Markdown editor"></div>
  <div id="source-container" style="display:none; height:100%;"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

/**
 * Message shape sent from the webview to the extension host.
 */
interface WebviewMessage {
  type: 'edit' | 'ready' | 'stats' | 'toggleSource' | 'toggleTheme' | 'openLink' | 'exportHtml' | 'printReady' | 'copyRichText' | 'checkLinks' | 'getLinkSuggestions' | 'getFileHeadings' | 'saveSettings';
  content?: string;
  plainText?: string;
  href?: string;
  html?: string;
  links?: Array<{ href: string; type: 'anchor' | 'file' | 'fileAnchor' }>;
  filePath?: string;
  /** Optional override for link navigation behavior (from context menu actions). */
  behavior?: 'navigateCurrentTab' | 'openNewTab';
}

/**
 * M6c — Generate a GitHub-style anchor ID from a heading's text content.
 * Mirrors the same logic used in the webview (editor-main.ts).
 */
function githubAnchorId(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
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
