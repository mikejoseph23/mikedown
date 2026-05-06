/**
 * Pure helper shared by host (markdownEditorProvider.ts) and webview
 * (editor-main.ts) to convert a webview-resolved image src back to its
 * on-disk relative form for display in the image-edit popover. Mirrors the
 * prefix-strip + relative-from-docDir logic in `unresolveImageUris` so the
 * popover shows the same path that gets written to the markdown file.
 *
 * No node:* imports — it must run in the browser webview bundle.
 */

export interface ImagePathPrefix {
  /** Webview-resolved URI prefix, no trailing slash (e.g. "https://abc.vscode-cdn.net/path/to/dir"). */
  prefix: string;
  /** Posix-style filesystem path that `prefix` maps to (e.g. "/Users/me/proj/dir"). */
  fsPath: string;
}

/**
 * If `src` lives under one of the known prefixes, return the path relative
 * to `docDirFs` in posix form. Otherwise return `src` unchanged.
 *
 * `prefixes` should already be sorted longest-first so the more-specific
 * docDir match wins over a workspace-folder root.
 */
export function unresolveSrcForDisplay(
  src: string,
  prefixes: ImagePathPrefix[],
  docDirFs: string
): string {
  // No early bail for http(s) — modern VS Code's `asWebviewUri` returns
  // `https://*.vscode-cdn.net/...`, so the prefix list itself starts with
  // `https://`. Non-vscode http(s) URLs and data: URIs simply won't match
  // any prefix and fall through unchanged. We only short-circuit data:
  // URIs to avoid scanning megabytes of base64 with `startsWith`.
  if (src.startsWith('data:')) return src;
  for (const { prefix, fsPath } of prefixes) {
    if (src.startsWith(prefix + '/')) {
      const tail = decodePathPart(src.slice(prefix.length + 1));
      const absPath = posixJoin(fsPath, tail);
      return posixRelative(docDirFs, absPath);
    }
    if (src === prefix) return src;
  }
  return src;
}

/**
 * Inverse of `unresolveSrcForDisplay` — convert a user-edited src (typically
 * the relative form shown in the image popover) back to a webview URI the
 * editor can render. Without this, hitting "Update" in the popover would
 * write the relative path into the image node and the inline preview would
 * break until the doc reloaded.
 *
 * Pass-through cases: data: URIs, http(s) URLs, and srcs that already start
 * with a known webview prefix. Anything else is resolved relative to
 * `docDirFs` and matched against the prefix list (longest-first) to pick the
 * webview prefix that owns it.
 */
export function resolveSrcForEditor(
  src: string,
  prefixes: ImagePathPrefix[],
  docDirFs: string
): string {
  if (!src) return src;
  if (src.startsWith('data:')) return src;
  if (/^https?:\/\//i.test(src)) return src;
  for (const { prefix } of prefixes) {
    if (src.startsWith(prefix + '/') || src === prefix) return src;
  }
  const absPath = src.startsWith('/')
    ? posixNormalize(src)
    : posixNormalize(posixJoin(docDirFs, src));
  for (const { prefix, fsPath } of prefixes) {
    if (absPath === fsPath) return prefix;
    if (absPath.startsWith(fsPath + '/')) {
      const tail = absPath.slice(fsPath.length + 1);
      return prefix + '/' + tail.split('/').map(encodeURIComponent).join('/');
    }
  }
  return src;
}

function decodePathPart(input: string): string {
  try { return decodeURI(input); } catch { return input; }
}

function posixJoin(base: string, tail: string): string {
  const trimmedBase = base.replace(/\/+$/, '');
  const trimmedTail = tail.replace(/^\/+/, '');
  return trimmedBase + '/' + trimmedTail;
}

/** Resolve `..` and `.` segments. Both inputs/outputs are posix, absolute. */
function posixNormalize(p: string): string {
  const isAbs = p.startsWith('/');
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return (isAbs ? '/' : '') + out.join('/');
}

/** Posix-only `path.relative`. Both inputs are absolute, forward-slash. */
function posixRelative(from: string, to: string): string {
  const fromSeg = from.split('/').filter(s => s.length > 0);
  const toSeg = to.split('/').filter(s => s.length > 0);
  let i = 0;
  while (i < fromSeg.length && i < toSeg.length && fromSeg[i] === toSeg[i]) i++;
  const up = fromSeg.length - i;
  const out: string[] = [];
  for (let j = 0; j < up; j++) out.push('..');
  for (let j = i; j < toSeg.length; j++) out.push(toSeg[j]);
  return out.length === 0 ? '.' : out.join('/');
}
