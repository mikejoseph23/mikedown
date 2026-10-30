// ============================================================================
// Padded pipe tables (`mikedown.tables.padColumns`).
//
// Pure helpers: display width of a cell and the layout of an aligned table.
// The serializer in table-align.ts renders each cell to text, then hands the
// rows here when the setting is on. Nothing here touches ProseMirror or the DOM.
// ============================================================================

// Code points that take two columns: East Asian wide and fullwidth blocks.
const WIDE_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals, Kangxi, CJK symbols and punctuation
  [0x3041, 0x33ff], // Hiragana, Katakana, Bopomofo, Hangul compat, CJK strokes
  [0x3400, 0x4dbf], // CJK extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe30, 0xfe6f], // CJK compatibility forms, small forms
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x20000, 0x3fffd], // CJK extensions B and up
];

const EMOJI_PRESENTATION = /^\p{Emoji_Presentation}/u;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const ZERO_WIDTH = /^[\p{M}\p{Cf}]/u;
const REGIONAL_INDICATOR = /^[\u{1f1e6}-\u{1f1ff}]/u;

function codePointWidth(ch: string): number {
  if (ZERO_WIDTH.test(ch)) {return 0;}
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x1100) {return 1;}
  if (WIDE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)) {return 2;}
  return EMOJI_PRESENTATION.test(ch) ? 2 : 1;
}

function graphemeWidth(g: string): number {
  const first = [...g][0] ?? '';
  // An emoji sequence (ZWJ family, keycap, text symbol + VS16) is one wide glyph.
  if (PICTOGRAPHIC.test(g) && (g.includes('‍') || g.includes('️'))) {return 2;}
  if (REGIONAL_INDICATOR.test(first)) {return 2;}
  return codePointWidth(first);
}

interface GraphemeSegmenter {
  segment(s: string): Iterable<{ segment: string }>;
}
let segmenter: GraphemeSegmenter | null | undefined;

function graphemes(text: string): string[] {
  if (segmenter === undefined) {
    const Seg = (Intl as unknown as {
      Segmenter?: new (locale?: string, options?: object) => GraphemeSegmenter;
    }).Segmenter;
    segmenter = Seg ? new Seg(undefined, { granularity: 'grapheme' }) : null;
  }
  if (segmenter) {return Array.from(segmenter.segment(text), (s) => s.segment);}
  return [...text];
}

/**
 * Columns a string takes in a monospace font: East Asian wide characters and
 * emoji count 2, combining marks and joiners 0, everything else 1.
 */
export function displayWidth(text: string): number {
  // Plain ASCII is the common case.
  if (/^[\x20-\x7e]*$/.test(text)) {return text.length;}
  let width = 0;
  for (const g of graphemes(text)) {width += graphemeWidth(g);}
  return width;
}

/** Narrowest column: a GFM delimiter cell is three characters (`---`, `:-:`). */
const MIN_COLUMN_WIDTH = 3;

function delimiterCell(align: string | null | undefined, width: number): string {
  switch (align) {
    case 'center':
      return `:${'-'.repeat(width - 2)}:`;
    case 'right':
      return `${'-'.repeat(width - 1)}:`;
    default:
      return '-'.repeat(width);
  }
}

/**
 * Lay out a table with every cell padded to its column's widest cell.
 * `rows` holds the serialized cell text (header row first); `aligns` is one
 * entry per column. Returns the table lines: header, delimiter row, body.
 */
export function padTableRows(rows: string[][], aligns: Array<string | null | undefined>): string[] {
  const columns = Math.max(aligns.length, ...rows.map((r) => r.length));
  const widths: number[] = [];
  for (let c = 0; c < columns; c++) {
    let w = MIN_COLUMN_WIDTH;
    for (const row of rows) {w = Math.max(w, displayWidth(row[c] ?? ''));}
    widths.push(w);
  }
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`;
  const padded = (row: string[]): string[] =>
    widths.map((w, c) => {
      const text = row[c] ?? '';
      return text + ' '.repeat(w - displayWidth(text));
    });
  const lines: string[] = [];
  rows.forEach((row, i) => {
    lines.push(line(padded(row)));
    if (!i) {lines.push(line(widths.map((w, c) => delimiterCell(aligns[c], w))));}
  });
  return lines;
}
