// Shared tag syntax — pure, no DOM or vscode imports so both the extension
// host and the webview bundle can consume it (same cross-bundle pattern as
// `frontmatterYaml.ts` / `imageDisplayPath.ts`).
//
// A tag is `#` followed by one or more `/`-separated segments of
// [A-Za-z0-9_-]. It must NOT be preceded by a word char, `/`, `#`, or `&`
// (so it won't fire inside URLs, `##` sequences, or HTML entities) and must
// contain at least one letter (so pure numbers like `#1234` aren't tags).
// Inline tags that look like hex colors (`#2563eb`, `#ffffff`, `#f0f`) are
// skipped too; frontmatter `tags:` entries are explicit, so they aren't.
// Nested tags use slashes: `#project/active`.

const SEGMENT = '[A-Za-z0-9_-]+';
const TAG_SOURCE = `(?<![\\w/#&])#(${SEGMENT}(?:/${SEGMENT})*)`;

/** Fresh global regex each call (global regexes carry mutable lastIndex). */
export function inlineTagRegex(): RegExp {
  return new RegExp(TAG_SOURCE, 'g');
}

/** A tag is only valid if it contains at least one letter. */
export function isValidTag(tag: string): boolean {
  return /[A-Za-z]/.test(tag);
}

/** Normalize a tag for indexing/matching: strip a leading `#`, lowercase. */
export function normalizeTag(raw: string): string | null {
  const t = raw.trim().replace(/^#+/, '').toLowerCase();
  if (!t || !isValidTag(t)) return null;
  return t;
}

/** Hex-color-like tokens: any all-hex run containing a digit (`#0f`,
 *  `#2563eb`), or 6/8 hex letters (`#ffffff`). All-letter words such as
 *  `#bad`, `#cafe`, `#face` still count as tags. */
export function looksLikeHexColor(tag: string): boolean {
  if (!/^[0-9a-f]+$/i.test(tag)) return false;
  return /[0-9]/.test(tag) || tag.length === 6 || tag.length === 8;
}

export interface InlineTagMatch {
  /** The tag without its leading `#`, original case. */
  tag: string;
  /** Offset of the `#` within the scanned string. */
  index: number;
  /** Length of the full `#tag` token. */
  length: number;
}

/** Find every inline `#tag` token in a single string. */
export function findInlineTags(text: string): InlineTagMatch[] {
  const re = inlineTagRegex();
  const out: InlineTagMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!isValidTag(m[1]) || looksLikeHexColor(m[1])) continue;
    out.push({ tag: m[1], index: m.index, length: m[0].length });
  }
  return out;
}
