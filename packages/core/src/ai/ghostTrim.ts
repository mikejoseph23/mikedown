/**
 * Clean up a ghost-text suggestion as it streams in (decisions D5 and D6).
 * Pure string work, no DOM. The controller calls `trimGhostSuggestion` on
 * the accumulated raw text after every token, so every rule here must give a
 * stable answer for a partial string.
 */

/** A suggestion longer than this is cut at the end of its next sentence. */
export const GHOST_SENTENCE_CUT_CHARS = 120;
/** How many characters before the caret a suggestion may not repeat. */
export const GHOST_REPEAT_CHARS = 20;
/** Shortest repeated stretch that counts as "repeating the text" (a few letters could be chance). */
const GHOST_REPEAT_MIN_CHARS = 8;

export interface GhostTrimOptions {
  /** The caret is at the end of its text block (nothing after it in the block). */
  atBlockEnd: boolean;
  /** The text before the caret (only its tail is used). */
  before: string;
}

export interface GhostTrimResult {
  /** The suggestion to show; empty means show nothing. */
  text: string;
  /** A stop rule fired (blank line, newline, sentence cut) or the suggestion was discarded: more tokens cannot change it, so the request can abort. */
  stopped: boolean;
}

/** A sentence terminator (with closing quotes or brackets) followed by whitespace, so "3.14" streaming in is not a stop. */
const SENTENCE_END = /[.!?…。！？]["'’”)\]]*(?=\s)/g;

function stripFences(text: string): string {
  let t = text;
  const open = /^[ \t]*(`{3,}|~{3,})[^\n]*\n?/.exec(t);
  if (open) {t = t.slice(open[0].length);}
  t = t.replace(/\n?[ \t]*(`{3,}|~{3,})[ \t]*$/, '');
  return t;
}

/**
 * Apply the stop rules to `raw`: strip a stray code fence, cut at the first
 * blank line (and at the first newline when the caret is not at the end of
 * its block), cut after the first sentence that ends past 120 characters,
 * drop trailing whitespace, and discard a suggestion that is empty or starts
 * by repeating the last 20 characters before the caret. A space at the start
 * is dropped when the text before the caret already ends in whitespace.
 */
export function trimGhostSuggestionDetailed(raw: string, opts: GhostTrimOptions): GhostTrimResult {
  let text = stripFences(raw.replace(/\r\n?/g, '\n'));
  let stopped = false;

  const blank = /\n[ \t]*\n/.exec(text);
  if (blank) {
    text = text.slice(0, blank.index);
    stopped = true;
  }
  if (!opts.atBlockEnd) {
    const nl = text.indexOf('\n');
    if (nl >= 0) {
      text = text.slice(0, nl);
      stopped = true;
    }
  }

  if (text.length > GHOST_SENTENCE_CUT_CHARS) {
    SENTENCE_END.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SENTENCE_END.exec(text)) !== null) {
      const end = m.index + m[0].length;
      if (end > GHOST_SENTENCE_CUT_CHARS) {
        text = text.slice(0, end);
        stopped = true;
        break;
      }
    }
  }

  text = text.replace(/\s+$/, '');
  if (/[ \t]$/.test(opts.before) || opts.before === '') {text = text.replace(/^[ \t]+/, '');}

  if (text === '') {return { text: '', stopped };}

  const tail = opts.before.slice(-GHOST_REPEAT_CHARS);
  const core = tail.trim();
  if (core.length >= GHOST_REPEAT_MIN_CHARS && (text.startsWith(tail) || text.trimStart().startsWith(core))) {
    return { text: '', stopped: true };
  }
  return { text, stopped };
}

/** The suggestion to show for the raw model output so far. Empty means nothing. */
export function trimGhostSuggestion(raw: string, opts: GhostTrimOptions): string {
  return trimGhostSuggestionDetailed(raw, opts).text;
}

/**
 * The first word of `text` for "accept one word": its leading whitespace,
 * the word, and the one space or tab after it. The whole text when it has
 * no second word.
 */
export function ghostAcceptWord(text: string): string {
  const m = /^\s*\S+[ \t]?/.exec(text);
  return m ? m[0] : text;
}

/**
 * The user typed `typed` while `text` was showing: the rest of the
 * suggestion when `typed` is exactly its start (case-sensitive), else null
 * (dismiss). An empty result means the whole suggestion was typed.
 */
export function ghostPrefixMatch(text: string, typed: string): string | null {
  if (typed === '') {return text;}
  return text.startsWith(typed) ? text.slice(typed.length) : null;
}
