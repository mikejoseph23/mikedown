/**
 * Markdown text escaping (issue #5).
 *
 * tiptap-markdown's built-in `text` node serializer runs every plain-text run
 * through `escapeHTML()`, which rewrites `<` → `&lt;` and `>` → `&gt;`
 * unconditionally — so typing `jobs/<job>/<slug>` and saving produced
 * `jobs/&lt;job&gt;/&lt;slug&gt;` on disk. That is wrong twice over: HTML
 * entities are not markdown escaping, and with `html: false` (MikeDown's mode)
 * a bare `<` is never consumed as a tag anyway.
 *
 * This module replaces both that step and prosemirror-markdown's `esc()` with a
 * single pass that:
 *   • escapes `<` with a backslash ONLY where a CommonMark parser would really
 *     eat it — a URI/email autolink, or (in html mode) a raw HTML tag;
 *   • escapes `&` only when it starts a character reference that would
 *     otherwise decode on the next parse;
 *   • escapes `|` inside table cells so a literal pipe can't split the row;
 *   • otherwise keeps prosemirror-markdown's escape set byte-for-byte, so no
 *     round-trip that worked before starts failing.
 *
 * Pure functions — unit tested by test/unit/markdownEscape.test.ts.
 */

/** `<scheme:...>` — CommonMark URI autolink. Parsed even with html: false. */
const AUTOLINK_URI = /^<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>/;

/** `<user@host>` — CommonMark email autolink. Parsed even with html: false. */
const AUTOLINK_EMAIL =
  /^<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*>/;

/**
 * Raw-HTML openers: open/close tag, comment, processing instruction,
 * declaration, CDATA. Only relevant when the parser has html enabled.
 */
const HTML_OPENER = /^<(?:[A-Za-z][A-Za-z0-9-]*[\s/>]|\/[A-Za-z][A-Za-z0-9-]*[\s>]|!--|![A-Za-z]|!\[CDATA\[|\?)/;

/** Named / decimal / hex character reference, e.g. `&amp;` `&#60;` `&#x3C;`. */
const ENTITY = /^&(?:#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;

export interface MarkdownEscapeOptions {
  /** Apply the escapes that only matter at the start of a line (`- `, `> `, `# `, `1. `). */
  startOfLine?: boolean;
  /** The parser's `html` option. When true, raw-HTML openers need escaping too. */
  html?: boolean;
  /** Inside a GFM table cell — a bare `|` would end the cell. */
  inTable?: boolean;
}

/** True when the `<` at `index` would be consumed as an autolink or raw HTML. */
export function needsLessThanEscape(text: string, index: number, html: boolean): boolean {
  const rest = text.slice(index);
  if (AUTOLINK_URI.test(rest) || AUTOLINK_EMAIL.test(rest)) return true;
  return html === true && HTML_OPENER.test(rest);
}

/** True when the `&` at `index` starts a character reference the parser would decode. */
export function needsAmpersandEscape(text: string, index: number): boolean {
  return ENTITY.test(text.slice(index));
}

/**
 * Escape a single line of plain text for embedding in markdown.
 *
 * `line` must not contain a newline — callers split first so `startOfLine` can
 * be decided per line.
 */
export function escapeMarkdownText(line: string, opts: MarkdownEscapeOptions = {}): string {
  const html = opts.html === true;
  let out = '';

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    switch (ch) {
      case '`':
      case '*':
      case '\\':
      case '~':
      case '[':
      case ']':
        out += '\\' + ch;
        break;
      case '_':
        // CommonMark: intra-word `_` can neither open nor close emphasis, so
        // snake_case survives unescaped. Same carve-out prosemirror-markdown makes.
        out +=
          i > 0 && i + 1 < line.length && /\w/.test(line[i - 1]) && /\w/.test(line[i + 1])
            ? ch
            : '\\_';
        break;
      case '<':
        out += needsLessThanEscape(line, i, html) ? '\\<' : ch;
        break;
      case '&':
        out += needsAmpersandEscape(line, i) ? '\\&' : ch;
        break;
      case '|':
        out += opts.inTable ? '\\|' : ch;
        break;
      default:
        out += ch;
    }
  }

  if (opts.startOfLine) {
    out = out
      .replace(/^(\+[ ]|[-*>])/, '\\$&')
      .replace(/^(\s*)(#{1,6})(\s|$)/, '$1\\$2$3')
      .replace(/^(\s*\d+)\.\s/, '$1\\. ');
  }

  return out;
}

/** Escape a whole text run. Every line after the first is at the start of a line. */
export function escapeMarkdownRun(text: string, opts: MarkdownEscapeOptions = {}): string {
  return text
    .split('\n')
    .map((line, i) => escapeMarkdownText(line, { ...opts, startOfLine: i === 0 ? opts.startOfLine : true }))
    .join('\n');
}
