import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

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
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, 'src', 'webview')),
        vscode.Uri.file(path.join(this.context.extensionPath, 'dist')),
        vscode.Uri.file(path.join(this.context.extensionPath, 'out', 'webview'))
      ]
    };

    // Set the initial HTML content
    webviewPanel.webview.html = this.getWebviewContent(webviewPanel.webview);

    // Send initial document content to the webview
    this.updateWebview(document, webviewPanel.webview);

    // Listen for document changes (e.g. from other editors)
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() === document.uri.toString()) {
        this.updateWebview(document, webviewPanel.webview);
      }
    });

    // Clean up the listener when the panel is closed
    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
    });

    // Handle messages from the webview
    webviewPanel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      switch (message.type) {
        case 'edit':
          await this.applyEdit(document, message.content ?? '');
          break;
        case 'ready':
          // Webview signals it is ready — send current content
          this.updateWebview(document, webviewPanel.webview);
          break;
        default:
          console.warn(`MikeDown: unknown message type "${(message as { type: string }).type}"`);
      }
    });
  }

  /**
   * Send the current document text to the webview.
   */
  private updateWebview(document: vscode.TextDocument, webview: vscode.Webview): void {
    webview.postMessage({
      type: 'update',
      content: document.getText()
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
  type: 'edit' | 'ready';
  content?: string;
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
