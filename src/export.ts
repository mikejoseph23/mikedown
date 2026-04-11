import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';

/**
 * Build a standalone HTML document around the given rendered body HTML.
 * Shared by "Export as HTML" and "View in Browser" so styles stay in sync.
 */
export function buildFullHtml(renderedHtml: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
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
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Rewrite relative src/href attribute values in an HTML string so that
 * they resolve against `baseDir`. Absolute URLs, anchors, and data: URIs
 * are left untouched.
 */
export function rewriteRelativeUrls(html: string, baseDir: string): string {
  const isAbsolute = (v: string): boolean =>
    /^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//') || v.startsWith('#') || v.startsWith('data:');
  return html.replace(/(\s(?:src|href)=)(["'])([^"']*)\2/gi, (match, attr, quote, value) => {
    if (!value || isAbsolute(value)) return match;
    const resolved = vscode.Uri.file(path.resolve(baseDir, value)).toString();
    return `${attr}${quote}${resolved}${quote}`;
  });
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

  const title = path.basename(suggestedName, path.extname(suggestedName));
  const fullHtml = buildFullHtml(renderedHtml, title);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(fullHtml, 'utf8'));
  vscode.window.showInformationMessage(`Exported to ${path.basename(uri.fsPath)}`);
}

/**
 * Write rendered HTML to a temp file and open it in the system browser.
 * Relative image/link URLs are rewritten to absolute file:// URLs so they
 * resolve from the temp location.
 */
export async function openRenderedInBrowser(
  renderedHtml: string,
  sourceDocPath: string
): Promise<void> {
  const baseDir = path.dirname(sourceDocPath);
  const rewritten = rewriteRelativeUrls(renderedHtml, baseDir);
  const title = path.basename(sourceDocPath, path.extname(sourceDocPath));
  const fullHtml = buildFullHtml(rewritten, title);

  const safeName = title.replace(/[^a-z0-9-_]/gi, '_') || 'mikedown';
  const tmpPath = path.join(os.tmpdir(), `mikedown-preview-${safeName}-${Date.now()}.html`);
  const tmpUri = vscode.Uri.file(tmpPath);
  await vscode.workspace.fs.writeFile(tmpUri, Buffer.from(fullHtml, 'utf8'));
  await vscode.env.openExternal(tmpUri);
}
