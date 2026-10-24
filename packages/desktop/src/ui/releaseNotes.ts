/**
 * Release notes for the update window (U2): the plugin's `notes` (markdown,
 * from the signed manifest) rendered to HTML, then sanitized. Pure, so the
 * sanitizer can be tested on its own.
 *
 * markdown-it runs with `html: false`, so raw HTML in the notes comes out as
 * text. The sanitizer is the second wall and also takes HTML from any other
 * source: an element allowlist, no attributes except a few safe ones, links
 * limited to http(s) and mailto, and no remote images (only inline raster
 * `data:` images survive). Link clicks are routed to the browser by the
 * window, never followed in the webview.
 */
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false });

/** Kept with their content. */
const ALLOWED = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'strong', 'em', 'b', 'i', 'code', 'pre', 'blockquote', 'a', 'del', 's',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'span',
]);

/** Removed with everything inside them. Anything else unknown is unwrapped. */
const DROPPED = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input',
  'button', 'textarea', 'select', 'option', 'svg', 'math', 'link', 'meta', 'base', 'template',
  'noscript', 'audio', 'video', 'source', 'track', 'canvas', 'picture', 'portal', 'title', 'head',
]);

const ALLOWED_ATTRS: Record<string, readonly string[]> = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title'],
  ol: ['start'],
};

const SAFE_LINK = /^(https?:|mailto:)/i;
/** Inline raster images only: SVG can carry script, anything remote can track. */
const SAFE_IMAGE = /^data:image\/(png|gif|jpe?g|webp|avif);base64,/i;

/** True when an `href` may be opened (in the browser). */
export function isSafeLink(href: string | null | undefined): boolean {
  return !!href && SAFE_LINK.test(href.trim());
}

/** Sanitize HTML for the "What's new" area. Returns an HTML string. */
export function sanitizeNotesHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  clean(doc.body);
  return doc.body.innerHTML;
}

function clean(parent: Element): void {
  for (const node of [...parent.childNodes]) {
    if (node.nodeType === Node.COMMENT_NODE || node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
      node.remove();
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {continue;}
    const el = node as Element;
    const tag = el.localName;
    if (DROPPED.has(tag) || el.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
      el.remove();
      continue;
    }
    if (!ALLOWED.has(tag)) {
      clean(el);
      el.replaceWith(...el.childNodes);
      continue;
    }
    const keep = ALLOWED_ATTRS[tag] ?? [];
    for (const attr of [...el.attributes]) {
      if (!keep.includes(attr.name)) {el.removeAttribute(attr.name);}
    }
    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (!isSafeLink(href)) {el.removeAttribute('href');}
      else {el.setAttribute('rel', 'noopener noreferrer');}
    }
    if (tag === 'img' && !SAFE_IMAGE.test(el.getAttribute('src')?.trim() ?? '')) {
      // A remote image becomes its alt text (if any), so nothing is fetched.
      const alt = el.getAttribute('alt');
      if (alt) {el.replaceWith(el.ownerDocument.createTextNode(alt));}
      else {el.remove();}
      continue;
    }
    clean(el);
  }
}

/** Markdown notes to safe HTML; empty string when there are none. */
export function renderReleaseNotes(notes: string | null | undefined): string {
  const text = notes?.trim() ?? '';
  if (!text) {return '';}
  return sanitizeNotesHtml(md.render(text)).trim();
}
