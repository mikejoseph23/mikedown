/**
 * Fit a markdown document to a model's context window by whole sections, and
 * say how much of it fit (never a silent cut). Used by `/summary`, `/title`
 * and Properties suggestions. Pure, no DOM.
 *
 * The kept text is always a prefix of the document: the frontmatter and the
 * opening sections, ending on a heading boundary. If even the first section
 * is too big it is cut on a blank line between blocks. A fenced code block is
 * never split, so a fence that opens inside the kept text also closes in it.
 */

/** Characters per token the budget assumes (a little pessimistic for English). */
export const CHARS_PER_TOKEN = 3.5;

export interface DocumentBudgetOptions {
  /** The model's context window in tokens. */
  contextTokens: number;
  /** Tokens the answer may use. */
  outputTokens: number;
  /** Tokens for the system prompt, instructions and slack. */
  reserveTokens: number;
}

export interface BudgetedDocument {
  /** The markdown to send: frontmatter plus the leading sections that fit. */
  text: string;
  /** Share of the document in `text`, 0 to 1 (1 when nothing was cut). */
  coverage: number;
  truncated: boolean;
  /** Sections in `text` (a partly kept first section counts as one). */
  sectionsIncluded: number;
  sectionsTotal: number;
}

export interface HeadingOutlineEntry {
  /** 1 to 6. */
  level: number;
  text: string;
}

interface Line {
  text: string;
  start: number;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
/**
 * An ATX heading line: `^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*$`, walked by hand so a
 * long run of blanks cannot make it quadratic (a regex with a lazy group before
 * `[ \t]*$` retries at every blank). `.` does not match `\r`, U+2028 or U+2029,
 * so a line holding one after the blanks is not a heading. `raw` is the text with
 * the blanks around it removed and the closing `#`s still on.
 */
function parseHeadingLine(line: string): { level: number; raw: string } | null {
  let i = 0;
  while (i < 3 && line.charCodeAt(i) === 0x20) {i++;}
  let j = i;
  while (j < line.length && line.charCodeAt(j) === 0x23) {j++;}
  const level = j - i;
  if (level < 1 || level > 6) {return null;}
  let k = j;
  while (k < line.length && (line.charCodeAt(k) === 0x20 || line.charCodeAt(k) === 0x09)) {k++;}
  if (k === j) {return null;}
  for (let p = k; p < line.length; p++) {
    const c = line.charCodeAt(p);
    if (c === 0x0d || c === 0x2028 || c === 0x2029) {return null;}
  }
  let end = line.length;
  while (end > k && (line.charCodeAt(end - 1) === 0x20 || line.charCodeAt(end - 1) === 0x09)) {end--;}
  return { level, raw: line.slice(k, end) };
}

/** `raw.replace(/[ \t]+#+$/, '').trim()`: the closing `#`s (after a blank) removed. */
function headingText(raw: string): string {
  let e = raw.length;
  while (e > 0 && raw.charCodeAt(e - 1) === 0x23) {e--;}
  let text = raw;
  if (e < raw.length && e > 0 && (raw.charCodeAt(e - 1) === 0x20 || raw.charCodeAt(e - 1) === 0x09)) {
    while (e > 0 && (raw.charCodeAt(e - 1) === 0x20 || raw.charCodeAt(e - 1) === 0x09)) {e--;}
    text = raw.slice(0, e);
  }
  return text.trim();
}
const FRONTMATTER = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

function frontmatterEnd(markdown: string): number {
  const m = FRONTMATTER.exec(markdown);
  return m ? m[0].length : 0;
}

function splitLines(markdown: string, from: number): Line[] {
  const lines: Line[] = [];
  let pos = from;
  while (pos < markdown.length) {
    const nl = markdown.indexOf('\n', pos);
    const end = nl < 0 ? markdown.length : nl;
    lines.push({ text: markdown.slice(pos, end).replace(/\r$/, ''), start: pos });
    pos = nl < 0 ? markdown.length : nl + 1;
  }
  return lines;
}

/** Per line: true when the line is inside a fenced code block (fence lines included). */
function fenceMask(lines: readonly Line[]): boolean[] {
  const mask: boolean[] = [];
  let fence: { char: string; len: number } | null = null;
  for (const line of lines) {
    if (!fence) {
      const m = FENCE_OPEN.exec(line.text);
      if (m) {
        fence = { char: m[1][0], len: m[1].length };
        mask.push(true);
      } else {
        mask.push(false);
      }
      continue;
    }
    mask.push(true);
    const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line.text);
    if (close && close[1][0] === fence.char && close[1].length >= fence.len) {fence = null;}
  }
  return mask;
}

export interface HeadingWithOffsets extends HeadingOutlineEntry {
  /** Offset of the heading line's first character. */
  start: number;
  /** Offset just past the heading line's end of line (the next line's start, or the text length). */
  end: number;
}

/**
 * Heading levels, texts and line offsets, skipping frontmatter and fenced code.
 * `limit` stops after that many headings (the documentation index keeps 1000).
 */
export function headingsWithOffsets(markdown: string, limit: number = Infinity): HeadingWithOffsets[] {
  const lines = splitLines(markdown, frontmatterEnd(markdown));
  const mask = fenceMask(lines);
  const out: HeadingWithOffsets[] = [];
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    if (mask[i]) {continue;}
    const m = parseHeadingLine(lines[i].text);
    if (!m) {continue;}
    const text = headingText(m.raw);
    if (text) {out.push({ level: m.level, text, start: lines[i].start, end: i + 1 < lines.length ? lines[i + 1].start : markdown.length });}
  }
  return out;
}

/** Heading levels and texts, skipping frontmatter and fenced code. `limit` as in `headingsWithOffsets`. */
export function headingsOutline(markdown: string, limit: number = Infinity): HeadingOutlineEntry[] {
  return headingsWithOffsets(markdown, limit).map(({ level, text }) => ({ level, text }));
}

/** Offset just past the leading frontmatter block (0 when there is none). */
export function frontmatterEndOffset(markdown: string): number {
  return frontmatterEnd(markdown);
}

/** Offsets where each section starts; the first is always 0 (frontmatter and any preamble belong to it). */
function sectionStarts(markdown: string, lines: readonly Line[], mask: readonly boolean[]): number[] {
  const starts = [0];
  const bodyStart = lines.length > 0 ? lines[0].start : markdown.length;
  lines.forEach((line, i) => {
    if (mask[i] || parseHeadingLine(line.text) === null) {return;}
    // A heading with nothing before it (apart from frontmatter) opens section 0.
    if (markdown.slice(bodyStart, line.start).trim() === '') {return;}
    starts.push(line.start);
  });
  return starts;
}

/** Offsets where a block starts: a non-blank line after a blank one that is not inside a fence. */
function blockStarts(lines: readonly Line[], mask: readonly boolean[]): number[] {
  const starts: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].text.trim() === '') {continue;}
    if (lines[i - 1].text.trim() === '' && !mask[i - 1]) {starts.push(lines[i].start);}
  }
  return starts;
}

/**
 * Keep the frontmatter and as many whole leading sections as fit in
 * `contextTokens - outputTokens - reserveTokens` (at `CHARS_PER_TOKEN`
 * characters a token). A first section bigger than the budget is cut on a
 * block boundary instead, and the first block is kept whatever the budget.
 */
export function budgetDocument(markdown: string, opts: DocumentBudgetOptions): BudgetedDocument {
  const total = markdown.length;
  const budgetTokens = opts.contextTokens - opts.outputTokens - opts.reserveTokens;
  const budgetChars = Math.max(0, Math.floor(budgetTokens * CHARS_PER_TOKEN));
  const fmEnd = frontmatterEnd(markdown);
  const lines = splitLines(markdown, fmEnd);
  const mask = fenceMask(lines);
  const starts = sectionStarts(markdown, lines, mask);
  const sectionsTotal = starts.length;

  if (total <= budgetChars || total === 0) {
    return { text: markdown, coverage: 1, truncated: false, sectionsIncluded: sectionsTotal, sectionsTotal };
  }

  // Cut points are section starts after the first section (and the end).
  let cut = 0;
  let sectionsIncluded = 0;
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] > budgetChars) {break;}
    cut = starts[i];
    sectionsIncluded = i;
  }

  if (cut === 0) {
    // The first section alone is over budget: whole blocks of it, at least the first.
    const firstEnd = starts.length > 1 ? starts[1] : total;
    const blocks = blockStarts(lines, mask).filter((s) => s < firstEnd);
    cut = blocks.length > 0 ? blocks[0] : firstEnd;
    for (const s of blocks) {
      if (s > budgetChars) {break;}
      cut = Math.max(cut, s);
    }
    sectionsIncluded = 1;
  }

  if (cut >= total) {
    return { text: markdown, coverage: 1, truncated: false, sectionsIncluded: sectionsTotal, sectionsTotal };
  }
  const text = markdown.slice(0, cut).trimEnd();
  return {
    text,
    coverage: Math.min(0.999, Math.max(0.001, cut / total)),
    truncated: true,
    sectionsIncluded,
    sectionsTotal,
  };
}
