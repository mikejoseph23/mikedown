import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { githubAnchorId } from './anchoring';

/**
 * Build a standalone HTML document around the given rendered body HTML.
 * Shared by "Export as HTML" and "View in Browser" so styles stay in sync.
 */
export function buildFullHtml(renderedHtml: string, title: string): string {
  const body = fixInternalLinks(addHeadingIds(renderedHtml));
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
${body}
</body>
</html>`;
}

/**
 * Add `id` attributes to headings so in-document `#anchor` links resolve.
 * TipTap's HTML output has no ids; without these, tables of contents and
 * "back to top" links are dead in exported HTML and printed PDFs.
 *
 * Slugs come from the shared `githubAnchorId` so exported ids are byte-identical
 * to the anchors the editor and "Heading Rename → Fix Links" already generate.
 * Duplicates get a `-1`, `-2`, ... suffix, matching GitHub's encounter order.
 */
export function addHeadingIds(html: string): string {
  const seen = new Map<string, number>();
  return html.replace(
    /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (match: string, level: string, attrs: string, inner: string) => {
      if (/\sid\s*=/i.test(attrs)) return match;
      const text = inner.replace(/<[^>]*>/g, '');
      const base = githubAnchorId(decodeEntities(text));
      if (!base) return match;
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count}`;
      return `<h${level}${attrs} id="${escapeHtml(id)}">${inner}</h${level}>`;
    }
  );
}

/**
 * Strip `target="_blank"` / `rel` from same-document `#anchor` links.
 * TipTap's link mark stamps those on every link, which makes an anchor
 * open a blank tab instead of scrolling to its heading.
 */
export function fixInternalLinks(html: string): string {
  return html.replace(/<a\s([^>]*)>/gi, (match: string, attrs: string) => {
    const href = /\shref\s*=\s*(["'])(.*?)\1/i.exec(` ${attrs}`);
    if (!href || !href[2].startsWith('#')) return match;
    const cleaned = attrs
      .replace(/\s*target\s*=\s*(["']).*?\1/gi, '')
      .replace(/\s*rel\s*=\s*(["']).*?\1/gi, '')
      .trim();
    return `<a ${cleaned}>`;
  });
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
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
 * Request the rendered HTML from the webview so the extension host can
 * open it in the browser with an auto-print script injected.
 *
 * window.print() cannot be called directly from inside the webview: VS Code
 * sandboxes webviews without the `allow-modals` flag, so the browser blocks
 * the call. Instead we reuse the temp-file-then-openExternal flow used by
 * "View in Browser" and inject a small auto-print script.
 */
export function exportViaPrint(panel: vscode.WebviewPanel): void {
  panel.webview.postMessage({ type: 'requestPrint' });
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
 *
 * When `autoPrint` is true, an inline script is injected that calls
 * window.print() on load — this is how "Print / Export as PDF" works,
 * since webviews themselves can't pop a print dialog.
 */
export async function openRenderedInBrowser(
  renderedHtml: string,
  sourceDocPath: string,
  options: { autoPrint?: boolean } = {}
): Promise<void> {
  const baseDir = path.dirname(sourceDocPath);
  const rewritten = rewriteRelativeUrls(renderedHtml, baseDir);
  const title = path.basename(sourceDocPath, path.extname(sourceDocPath));
  let fullHtml = buildFullHtml(rewritten, title);

  if (options.autoPrint) {
    // Wait for images/fonts to settle before popping the print dialog.
    const script = `<script>window.addEventListener('load', function(){setTimeout(function(){window.print();}, 400);});</script>`;
    fullHtml = fullHtml.replace('</body>', `${script}\n</body>`);
  }

  const prefix = options.autoPrint ? 'mikedown-print' : 'mikedown-preview';
  const safeName = title.replace(/[^a-z0-9-_]/gi, '_') || 'mikedown';
  const tmpPath = path.join(os.tmpdir(), `${prefix}-${safeName}-${Date.now()}.html`);
  const tmpUri = vscode.Uri.file(tmpPath);
  await vscode.workspace.fs.writeFile(tmpUri, Buffer.from(fullHtml, 'utf8'));
  await vscode.env.openExternal(tmpUri);
}
