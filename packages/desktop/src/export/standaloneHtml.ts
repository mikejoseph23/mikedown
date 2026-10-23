/**
 * Standalone HTML for export and print (M9, edge case 24). Pure string work, no
 * DOM and no Tauri, so it is unit-tested directly. The logic mirrors the VS
 * Code extension's `src/export.ts` (heading ids, internal links) but is copied
 * here: that file imports Node and `vscode`, which the desktop bundle never
 * does.
 *
 * The page is the editor's own rendered HTML (`handle.getHtml()`) wrapped in
 * the same `.mikedown-root > .mikedown-editor-container > .ProseMirror`
 * structure, with core's stylesheet inlined, so tokens, callouts, code
 * highlighting, KaTeX and mermaid SVG look as they do in the editor (always
 * the light theme). Local images become `data:` URIs, or files copied beside
 * the export (the sidecar option); remote images stay remote and are reported.
 */
import { githubAnchorId } from '@mikedown/core/shared/anchoring';

export type ImageMode = 'inline' | 'sidecar';

export interface ResolvedImage {
  /** `image/png`, `image/svg+xml`, … */
  mime: string;
  bytes: Uint8Array;
}

export interface ImageHooks {
  /** Bytes for a document-relative or absolute image path; null when unreadable. */
  load(rawSrc: string): Promise<ResolvedImage | null>;
}

export interface StandaloneOptions {
  /** Editor HTML (`getHtml()`), after `prepareImages`. */
  bodyHtml: string;
  /** Document path or name, for the title fallback. */
  fileName: string | null;
  /** Core's stylesheet text, already free of remote URLs (`exportCss.ts`). */
  css: string;
  /** Replaces the first-H1/filename title when set. */
  title?: string;
}

export interface SidecarFile {
  /** Path relative to the exported .html, e.g. `notes_files/a.png`. */
  relPath: string;
  bytes: Uint8Array;
}

export interface PreparedBody {
  html: string;
  /** Files to write beside the export (sidecar mode only). */
  sidecar: SidecarFile[];
  /** Remote (http/https) images that were left as they are. */
  remoteImages: number;
  /** Local images that could not be read. */
  missingImages: number;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

/** Title: the first H1's text, else the file name without its extension, else "Untitled". */
export function extractTitle(html: string, fileName: string | null): string {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1) {
    const text = decodeEntities(h1[1].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    if (text) {return text;}
  }
  if (fileName) {
    const base = fileName.split(/[\\/]/).pop() ?? '';
    const stem = base.replace(/\.[^.]+$/, '');
    if (stem) {return stem;}
  }
  return 'Untitled';
}

/** Add `id`s to headings so `#anchor` links resolve (same slugs as the editor). */
export function addHeadingIds(html: string): string {
  const seen = new Map<string, number>();
  return html.replace(
    /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (match: string, level: string, attrs: string, inner: string) => {
      if (/\sid\s*=/i.test(attrs)) {return match;}
      const base = githubAnchorId(decodeEntities(inner.replace(/<[^>]*>/g, '')));
      if (!base) {return match;}
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count}`;
      return `<h${level}${attrs} id="${escapeHtml(id)}">${inner}</h${level}>`;
    },
  );
}

/** Same-document `#anchor` links must not open a new tab. */
export function fixInternalLinks(html: string): string {
  return html.replace(/<a\s([^>]*)>/gi, (match: string, attrs: string) => {
    const href = /\shref\s*=\s*(["'])(.*?)\1/i.exec(` ${attrs}`);
    if (!href || !href[2].startsWith('#')) {return match;}
    const cleaned = attrs
      .replace(/\s*target\s*=\s*(["']).*?\1/gi, '')
      .replace(/\s*rel\s*=\s*(["']).*?\1/gi, '')
      .trim();
    return `<a ${cleaned}>`;
  });
}

/** Editing-only attributes and ProseMirror's separator images have no place in a static page. */
export function stripEditorArtifacts(html: string): string {
  return html
    .replace(/<img\b[^>]*class="[^"]*ProseMirror-separator[^"]*"[^>]*>/gi, '')
    .replace(/\s(?:contenteditable|draggable)\s*=\s*(["'])[^"']*\1/gi, '');
}

const IMG_TAG = /<img\b[^>]*>/gi;

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag);
  return m ? decodeEntities(m[2]) : null;
}

function setAttr(tag: string, name: string, value: string): string {
  const re = new RegExp(`(\\s${name}\\s*=\\s*)(["'])(.*?)\\2`, 'i');
  const enc = escapeHtml(value);
  if (re.test(tag)) {return tag.replace(re, (_m, pre: string) => `${pre}"${enc}"`);}
  return tag.replace(/^<img\b/i, `<img ${name}="${enc}"`);
}

function removeAttr(tag: string, name: string): string {
  return tag.replace(new RegExp(`\\s${name}\\s*=\\s*(["']).*?\\1`, 'i'), '');
}

const REMOTE = /^(?:https?:)?\/\//i;
const DATA = /^data:/i;

/**
 * The editor flags an image `broken-image` (with an "Image not found" tooltip)
 * when the webview failed to load it. Once the export has the bytes it is not.
 */
function markLoaded(tag: string): string {
  let out = tag.replace(/(\sclass\s*=\s*)(["'])(.*?)\2/i, (_m, pre: string, q: string, value: string) => {
    const kept = value.split(/\s+/).filter((c) => c && c !== 'broken-image').join(' ');
    return kept ? `${pre}${q}${kept}${q}` : '';
  });
  out = out.replace(/\stitle\s*=\s*(["'])Image not found:.*?\1/i, '');
  return out;
}

/** The path as the author wrote it: core records it in `data-mikedown-src` when it rendered a different URL. */
export function rawImageSrc(tag: string): string | null {
  return attr(tag, 'data-mikedown-src') ?? attr(tag, 'src');
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function decodeURIComponentSafe(s: string): string {
  try {return decodeURIComponent(s);} catch {return s;}
}

function sidecarName(raw: string, taken: Set<string>): string {
  const clean = decodeURIComponentSafe(raw.split(/[?#]/)[0]);
  const base = (clean.split(/[\\/]/).pop() || 'image').replace(/[<>:"|?*\u0000-\u001f]/g, '_');
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) {name = `${stem}-${n}${ext}`;}
  taken.add(name.toLowerCase());
  return name;
}

/**
 * Make every image self-contained. `inline`: `data:` URI. `sidecar`: a file
 * under `<folder>/` next to the export, referenced relatively. Identical
 * sources are loaded once. `data:` images are left alone, remote ones are
 * counted and left alone, unreadable ones are counted and keep their broken
 * state.
 */
export async function prepareImages(
  html: string,
  hooks: ImageHooks,
  mode: ImageMode,
  folder: string,
): Promise<PreparedBody> {
  const tags = html.match(IMG_TAG) ?? [];
  const results = new Map<string, string | null>(); // raw src -> replacement url
  const sidecar: SidecarFile[] = [];
  const taken = new Set<string>();
  let remoteImages = 0;
  let missingImages = 0;

  for (const tag of tags) {
    const raw = rawImageSrc(tag);
    if (!raw || DATA.test(raw) || results.has(raw)) {continue;}
    if (REMOTE.test(raw)) {
      results.set(raw, null);
      continue;
    }
    const img = await hooks.load(raw);
    if (!img) {
      results.set(raw, null);
      continue;
    }
    if (mode === 'inline') {
      results.set(raw, `data:${img.mime};base64,${bytesToBase64(img.bytes)}`);
    } else {
      const name = sidecarName(raw, taken);
      sidecar.push({ relPath: `${folder}/${name}`, bytes: img.bytes });
      results.set(raw, `${encodeURIComponent(folder)}/${encodeURIComponent(name)}`);
    }
  }

  const out = html.replace(IMG_TAG, (tag) => {
    const raw = rawImageSrc(tag);
    if (!raw || DATA.test(raw)) {return removeAttr(tag, 'data-mikedown-src');}
    if (REMOTE.test(raw)) {
      remoteImages++;
      return removeAttr(tag, 'data-mikedown-src');
    }
    const url = results.get(raw);
    if (!url) {
      missingImages++;
      return tag;
    }
    return markLoaded(removeAttr(setAttr(tag, 'src', url), 'data-mikedown-src'));
  });
  return { html: out, sidecar, remoteImages, missingImages };
}

/** Extra rules for the static page: no editor chrome, centered column, print-friendly breaks. */
export const EXPORT_CSS = `
html, body { margin: 0; padding: 0; background: #ffffff; }
.mikedown-root.mikedown-export { position: static; width: auto; height: auto; min-height: 0; overflow: visible; background: var(--mikedown-surface, #ffffff); }
.mikedown-export .mikedown-editor-container { position: static; height: auto; overflow: visible; padding: 40px 48px 80px; }
.mikedown-export .ProseMirror { max-width: var(--mikedown-content-width, 820px); margin: 0 auto; min-height: 0; }
.mikedown-export .ProseMirror img { max-width: 100%; height: auto; }
@media print {
  .mikedown-export .mikedown-editor-container { padding: 0; }
  .mikedown-export .ProseMirror pre { white-space: pre-wrap; word-break: break-word; }
  .mikedown-export .ProseMirror pre,
  .mikedown-export .ProseMirror blockquote,
  .mikedown-export .ProseMirror table,
  .mikedown-export .ProseMirror tr,
  .mikedown-export .ProseMirror img,
  .mikedown-export .ProseMirror svg,
  .mikedown-export .ProseMirror .mikedown-mermaid-preview,
  .mikedown-export .ProseMirror [data-callout],
  .mikedown-export .ProseMirror .katex-display { break-inside: avoid; page-break-inside: avoid; }
}
`;

/** The finished document. `bodyHtml` should already have been through `prepareImages`. */
export function buildStandaloneHtml(opts: StandaloneOptions): string {
  const title = opts.title ?? extractTitle(opts.bodyHtml, opts.fileName);
  const body = fixInternalLinks(addHeadingIds(stripEditorArtifacts(opts.bodyHtml)));
  return `<!DOCTYPE html>
<html lang="en" data-mikedown-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
${opts.css}
${EXPORT_CSS}
</style>
</head>
<body>
<div class="mikedown-root mikedown-export" data-mikedown-theme="light">
<div class="mikedown-editor-container">
<div class="ProseMirror">
${body}
</div>
</div>
</div>
</body>
</html>
`;
}

/** Remote resources (`src=` and CSS `url()`) the page would load; plain links do not count. */
export function remoteUrls(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/\ssrc\s*=\s*"((?:https?:)?\/\/[^"]+)"|url\(\s*['"]?((?:https?:)?\/\/[^)'"]+)/gi)) {
    found.add(m[1] ?? m[2]);
  }
  return [...found];
}

/** `notes.md` -> `notes.html`; untitled documents get `Untitled.html`. */
export function suggestedExportName(docPath: string | null, ext: 'html' | 'pdf'): string {
  const base = docPath ? (docPath.split(/[\\/]/).pop() ?? '') : '';
  const stem = base.replace(/\.[^.]+$/, '') || 'Untitled';
  return `${stem}.${ext}`;
}
