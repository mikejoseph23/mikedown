import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Export markdown content as a standalone HTML file.
 * The HTML file includes embedded CSS for a clean reading experience.
 */
export async function exportAsHtml(
  markdownContent: string,
  suggestedName: string
): Promise<void> {
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(suggestedName.replace(/\.md$/, '.html')),
    filters: { 'HTML Files': ['html'] },
    saveLabel: 'Export as HTML',
  });
  if (!uri) return;

  const html = buildHtmlExport(markdownContent);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(html, 'utf8'));
  vscode.window.showInformationMessage(`Exported to ${path.basename(uri.fsPath)}`);
}

/**
 * Build a standalone HTML string from markdown content.
 * Uses a simple but attractive style embedded in the file.
 */
function buildHtmlExport(markdownContent: string): string {
  // Escape the markdown for embedding — we'll use a simple marked-compatible approach
  // The HTML export embeds the raw markdown and renders it client-side using marked.js CDN
  // BUT: we must remain fully offline. So instead, we embed a minimal renderer.
  //
  // Approach: use the extension's own bundled rendering by requesting the webview
  // to provide rendered HTML. For now, wrap in a <pre> with basic styling as a safe fallback.
  // The real approach is to request rendered HTML from the webview (see markdownEditorProvider handler).
  // This function produces a minimal standalone HTML that displays the markdown as preformatted text
  // with a note that a proper render requires the extension.
  //
  // IMPLEMENTATION NOTE: A better approach is to have the webview send back its rendered innerHTML.
  // The `requestExport` flow in markdownEditorProvider handles this properly.
  // This function is used as a plain-text fallback.
  const escaped = markdownContent
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Exported Document</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; line-height: 1.6; }
  pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; }
</style>
</head>
<body>
<pre>${escaped}</pre>
</body>
</html>`;
}

/**
 * Export by triggering the browser's print dialog (PDF via system print-to-PDF).
 * Sends a message to the webview to trigger window.print().
 */
export function exportViaPrint(panel: vscode.WebviewPanel): void {
  panel.webview.postMessage({ type: 'triggerPrint' });
}

/**
 * Write rendered HTML export to disk.
 * Called after the webview sends back rendered HTML.
 */
export async function writeRenderedHtml(
  renderedHtml: string,
  suggestedName: string
): Promise<void> {
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(suggestedName.replace(/\.md$/, '.html')),
    filters: { 'HTML Files': ['html'] },
    saveLabel: 'Export as HTML',
  });
  if (!uri) return;

  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${path.basename(suggestedName, '.md')}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #24292e; line-height: 1.6; }
  h1, h2, h3, h4, h5, h6 { margin-top: 24px; margin-bottom: 16px; font-weight: 600; }
  h1 { font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
  code { background: #f6f8fa; padding: 0.2em 0.4em; border-radius: 3px; font-family: monospace; font-size: 85%; }
  pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 0; padding-left: 16px; border-left: 4px solid #dfe2e5; color: #6a737d; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
  th, td { border: 1px solid #dfe2e5; padding: 6px 13px; }
  th { background: #f6f8fa; font-weight: 600; }
  tr:nth-child(even) { background: #f6f8fa; }
  img { max-width: 100%; }
  a { color: #0366d6; }
  hr { border: none; border-top: 1px solid #eaecef; margin: 24px 0; }
  @media print {
    body { max-width: none; margin: 0; padding: 20px; }
  }
</style>
</head>
<body>
${renderedHtml}
</body>
</html>`;

  await vscode.workspace.fs.writeFile(uri, Buffer.from(fullHtml, 'utf8'));
  vscode.window.showInformationMessage(`Exported to ${path.basename(uri.fsPath)}`);
}
