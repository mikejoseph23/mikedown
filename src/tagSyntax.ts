// Shared tag syntax — pure, no DOM or vscode imports so both the extension
// host and the webview bundle can consume it (same cross-bundle pattern as
// `frontmatterYaml.ts` / `imageDisplayPath.ts`).
//
// A tag is `#` followed by one or more `/`-separated segments of
// [A-Za-z0-9_-]. It must NOT be preceded by a word char, `/`, `#`, or `&`
// (so it won't fire inside URLs, `##` sequences, or HTML entities) and must
// contain at least one letter (so pure numbers like `#1234` aren't tags).
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
    if (!isValidTag(m[1])) continue;
    out.push({ tag: m[1], index: m.index, length: m[0].length });
  }
  return out;
}
