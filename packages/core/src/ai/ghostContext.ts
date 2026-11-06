/**
 * The text a ghost-text request sends (decision D3): the text around the
 * cursor. Pure: given the document's markdown and the caret's offset in it,
 * return the last `GHOST_BEFORE_CHARS` characters before the caret verbatim
 * (a few paragraphs), a capped slice of the text after it, and, when the
 * document runs longer than that tail, a note listing the headings of
 * everything earlier so the model still knows where in the document it is.
 * The earlier text itself is never sent, however large the context window.
 * A small window shrinks the tail (never below 200 characters). Frontmatter
 * is never part of `before`.
 */

import { CHARS_PER_TOKEN, frontmatterEndOffset, headingsOutline } from './documentBudget';

/** Characters before the caret that are always sent verbatim. */
export const GHOST_BEFORE_CHARS = 2400;
/** Characters after the caret that are sent as the suffix. */
export const GHOST_AFTER_CHARS = 600;
/** Tokens set aside for the system prompt, the tags and slack. */
export const GHOST_RESERVE_TOKENS = 400;
/** Most headings listed for the sections left out. */
export const GHOST_OUTLINE_MAX_ITEMS = 40;
/** Characters set aside for the list of headings left out. */
export const GHOST_OUTLINE_MAX_CHARS = 1000;
/** Window assumed when a route reports none. */
export const GHOST_DEFAULT_CONTEXT_TOKENS = 4096;

export interface GhostContext {
  before: string;
  after: string;
}

export interface GhostContextOptions {
  /** Tokens the answer may use (the `maxTokens` setting). Default 48. */
  outputTokens?: number;
}

function outlineNote(omitted: string, maxChars: number): string {
  const headings = headingsOutline(omitted);
  const shown: string[] = [];
  let used = 0;
  for (const h of headings.slice(0, GHOST_OUTLINE_MAX_ITEMS)) {
    const line = `${'  '.repeat(Math.max(0, h.level - 1))}- ${h.text}`;
    if (used + line.length + 1 > maxChars) {break;}
    shown.push(line);
    used += line.length + 1;
  }
  if (headings.length > shown.length) {shown.push(`(${headings.length - shown.length} more headings)`);}
  return shown.length > 0
    ? `[Part of the document is left out here. Its headings, in order:\n${shown.join('\n')}\n]`
    : '[Part of the document is left out here.]';
}

/**
 * `before` and `after` for a caret at `caretOffset` in `markdown`. A caret
 * inside the frontmatter yields nothing (both empty), since there is nothing
 * to continue there. An `after` that is only whitespace is returned empty.
 */
export function ghostContext(markdown: string, caretOffset: number, contextTokens: number, opts: GhostContextOptions = {}): GhostContext {
  const caret = Math.min(markdown.length, Math.max(0, Math.floor(Number.isFinite(caretOffset) ? caretOffset : 0)));
  if (caret < frontmatterEndOffset(markdown)) {return { before: '', after: '' };}

  const afterRaw = markdown.slice(caret, caret + GHOST_AFTER_CHARS);
  const after = afterRaw.trim() === '' ? '' : afterRaw;

  const window = Number.isFinite(contextTokens) && contextTokens > 0 ? contextTokens : GHOST_DEFAULT_CONTEXT_TOKENS;
  const outputTokens = opts.outputTokens ?? 48;
  const budgetChars = Math.max(0, Math.floor((window - outputTokens - GHOST_RESERVE_TOKENS) * CHARS_PER_TOKEN) - after.length);

  // The frontmatter's YAML is not prose to continue, so `before` starts after it.
  const fullBefore = markdown.slice(frontmatterEndOffset(markdown), caret);
  // A small window shrinks the verbatim tail, but never below a couple of sentences.
  // A large one changes nothing: the tail stops at GHOST_BEFORE_CHARS.
  const tailChars = Math.min(GHOST_BEFORE_CHARS, Math.max(200, budgetChars));
  if (fullBefore.length <= tailChars) {return { before: fullBefore, after };}

  const tail = fullBefore.slice(fullBefore.length - tailChars);
  const head = fullBefore.slice(0, fullBefore.length - tailChars);
  const outlineChars = Math.min(GHOST_OUTLINE_MAX_CHARS, Math.max(0, budgetChars - tailChars));
  return { before: `${outlineNote(head, outlineChars)}\n\n${tail}`, after };
}
