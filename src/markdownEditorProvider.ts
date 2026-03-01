import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getSettings } from './settings';

/**
 * MikeDown custom text editor provider.
 *
 * Implements the VS Code CustomTextEditorProvider interface to render
 * Markdown files in a WYSIWYG webview panel.
 */
export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'mikedown.editor';

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

    // Send initial document content to the webview.
    // IMPORTANT: use document.getText() directly — no transformation that could trigger a change event.
    //
    // Dirty-flag guarantee chain:
    //   1. resolveCustomTextEditor sends 'update' with raw content (here via updateWebview)
    //   2. Webview sets isLoading = true, calls setContent, sets isLoading = false
    //   3. onUpdate is suppressed during load → no 'edit' message → no WorkspaceEdit → dirty flag stays clean
    this.updateWebview(document, webviewPanel.webview);
    this.sendThemeToWebview(webviewPanel.webview);

    // Listen for configuration changes and push updated theme to the webview.
    const configListener = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('mikedown')) {
        this.sendThemeToWebview(webviewPanel.webview);
      }
    });
    this.context.subscriptions.push(configListener);

    // Track changes triggered by our own webview to avoid reload loops.
    // Set to true before applying a WorkspaceEdit; reset to false after the
    // resulting onDidChangeTextDocument fires.
    let ignoreNextChange = false;

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
      if (ignoreNextChange) {
        ignoreNextChange = false;
        return; // Change was triggered by our own WorkspaceEdit — ignore to prevent reload loop
      }

      this.handleExternalChange(document, webviewPanel, event);
    });

    // Clean up the listener when the panel is closed
    webviewPanel.onDidDispose(() => {
      changeSubscription.dispose();
    });

    // Handle messages from the webview
    webviewPanel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      switch (message.type) {
        case 'edit': {
          ignoreNextChange = true; // Set before applyEdit to suppress the resulting change event
          // M2d — Apply cleanup normalization before writing to disk.
          const cleaned = this.applyCleanup(message.content ?? '');
          await this.applyEdit(document, cleaned);
          break;
        }
        case 'ready':
          // Webview signals it is ready — send current content
          this.updateWebview(document, webviewPanel.webview);
          break;
        case 'stats':
          // M2d — Update status bar with plain text for word/character count.
          // The StatusBarManager is wired in extension.ts (M3/M14 hook).
          // For now we receive the plain text and can emit a status bar update
          // once StatusBarManager is accessible from this provider.
          // TODO: wire this to StatusBarManager when M3 (toolbar/status bar) is done.
          break;
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
      fontSize: config.get<number>('fontSize', 16),
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
    // CSS lives in the source webview directory (not compiled)
    const cssUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'src', 'webview', 'editor.css'))
    );

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
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div id="toolbar" role="toolbar" aria-label="Formatting toolbar">
    <!-- Toolbar buttons will be added in M2b -->
    <span class="toolbar-placeholder">MikeDown Editor</span>
  </div>
  <!-- TipTap mounts directly into #editor-container -->
  <div id="editor-container" role="main" aria-label="Markdown editor"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

/**
 * Message shape sent from the webview to the extension host.
 */
interface WebviewMessage {
  type: 'edit' | 'ready' | 'stats';
  content?: string;
  plainText?: string;
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
