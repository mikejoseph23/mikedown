// Pure delimiter logic for KaTeX math (see math.ts). Kept free of KaTeX and
// TipTap imports so markdownEscape.ts and unit tests can use it cheaply.

export interface InlineMathMatch {
  latex: string;
  /** Index just past the closing `$`. */
  end: number;
}

function isSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

/**
 * Match inline math whose opening `$` sits at `pos` in `src`. Returns null when
 * the `$` isn't a delimiter. Pure — shared by the markdown-it rule, the text
 * escaper, and unit tests.
 */
export function matchInlineMath(src: string, pos: number): InlineMathMatch | null {
  if (src[pos] !== '$') {return null;}
  // `$$` is display math (block rule) — never an inline opener.
  if (src[pos + 1] === '$') {return null;}
  if (pos + 1 >= src.length || isSpace(src[pos + 1])) {return null;}

  for (let i = pos + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\n') {return null;}
    if (ch === '\\') {
      // Skip the escaped char so `\$` inside the formula doesn't close it.
      i++;
      continue;
    }
    if (ch !== '$') {continue;}
    if (isSpace(src[i - 1]) || isDigit(src[i + 1])) {return null;}
    return { latex: src.slice(pos + 1, i), end: i + 1 };
  }
  return null;
}

/** Serialize display math. Single-line formulas stay on one line with the fences. */
export function serializeMathBlock(latex: string): string {
  const body = latex.replace(/^\n+|\n+$/g, '');
  return `$$\n${body}\n$$`;
}
