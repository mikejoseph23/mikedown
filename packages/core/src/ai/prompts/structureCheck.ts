/**
 * Markdown structure post-check. Pure: counts the structural pieces of a
 * passage and compares the original with a model's result, so translate and
 * tone rewrites can show a warning line before Accept when something was
 * dropped. A warning only; it never blocks Accept.
 */

export interface StructureCounts {
  /** Headings by level, index 0 is level 1. */
  headings: [number, number, number, number, number, number];
  fencedCodeBlocks: number;
  inlineCodeSpans: number;
  /** URL of every link (inline, reference definition, autolink), in order. */
  links: string[];
  /** URL of every image, in order. */
  images: string[];
  listItems: number;
  tableRows: number;
  wikilinks: number;
  footnoteReferences: number;
}

export interface StructureMismatch {
  kind: 'heading' | 'fencedCodeBlock' | 'inlineCode' | 'link' | 'image' | 'listItem' | 'tableRow' | 'wikilink' | 'footnote';
  original: number;
  result: number;
  /** A human sentence such as "2 links in the original, 1 in the result". */
  message: string;
}

export interface StructureDiff {
  /** True when nothing differs. */
  ok: boolean;
  mismatches: StructureMismatch[];
  /** `mismatches[].message`, ready to show. */
  messages: string[];
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]|$)/;
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const TABLE_DELIMITER = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const FOOTNOTE_DEFINITION = /^ {0,3}\[\^[^\]\s]+\]:/;
const URL_PART = String.raw`<?((?:[^()\s<>]|\([^()\s]*\))+)>?`;
const LINK_TEXT = String.raw`\[(?:[^\[\]]|\[[^\[\]]*\])*\]`;
const INLINE_IMAGE = new RegExp(String.raw`!${LINK_TEXT}\(\s*${URL_PART}(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)`, 'g');
const INLINE_LINK = new RegExp(String.raw`(?<!!)${LINK_TEXT}\(\s*${URL_PART}(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)`, 'g');
const REFERENCE_DEFINITION = /^ {0,3}\[(?!\^)[^\]]+\]:[ \t]*<?(\S+?)>?(?:[ \t]+["'(].*)?$/gm;
const AUTOLINK = /<([a-z][a-z0-9+.-]*:[^\s<>]+)>/gi;
const WIKILINK = /\[\[[^\]\n]+\]\]/g;
const FOOTNOTE_REFERENCE = /\[\^[^\]\s]+\]/g;

/** Split the lines into prose lines and the number of fenced blocks (an unclosed fence runs to the end). */
function splitFences(markdown: string): { prose: string[]; fenced: number } {
  const prose: string[] = [];
  let fenced = 0;
  let open: { char: string; length: number } | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    if (open) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === open.char && close[1].length >= open.length) {open = null;}
      continue;
    }
    const m = FENCE_OPEN.exec(line);
    if (m && !(m[1][0] === '`' && line.slice(m[0].length).includes('`'))) {
      open = { char: m[1][0], length: m[1].length };
      fenced++;
      continue;
    }
    prose.push(line);
  }
  return { prose, fenced };
}

/** Remove inline code spans (they can hold link-like text) and return how many there were. */
function stripInlineCode(text: string): { text: string; count: number } {
  let count = 0;
  const out = text.replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, () => {
    count++;
    return '';
  });
  return { text: out, count };
}

function tableRowCount(lines: string[]): number {
  let rows = 0;
  for (let i = 1; i < lines.length; i++) {
    const header = lines[i - 1];
    if (!lines[i].includes('|') || !lines[i].includes('-') || !TABLE_DELIMITER.test(lines[i]) || !header.includes('|')) {continue;}
    // Header row above, then every following line that still looks like a row.
    rows++;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== '' && lines[j].includes('|')) {
      rows++;
      j++;
    }
    i = j - 1;
  }
  return rows;
}

function collect(re: RegExp, text: string): string[] {
  const urls: string[] = [];
  for (const m of text.matchAll(re)) {urls.push(m[1]);}
  return urls;
}

export function countMarkdownStructure(markdown: string): StructureCounts {
  const { prose, fenced } = splitFences(markdown);
  const headings: StructureCounts['headings'] = [0, 0, 0, 0, 0, 0];
  let listItems = 0;
  for (const line of prose) {
    const h = HEADING.exec(line);
    if (h) {headings[h[1].length - 1]++;}
    else if (LIST_ITEM.test(line)) {listItems++;}
  }
  const tableRows = tableRowCount(prose);
  const code = stripInlineCode(prose.map((l) => l.replace(FOOTNOTE_DEFINITION, '')).join('\n'));
  const images = collect(INLINE_IMAGE, code.text);
  const withoutImages = code.text.replace(INLINE_IMAGE, '');
  const links = [
    ...collect(INLINE_LINK, withoutImages),
    ...collect(REFERENCE_DEFINITION, withoutImages),
    ...collect(AUTOLINK, withoutImages),
  ];
  return {
    headings,
    fencedCodeBlocks: fenced,
    inlineCodeSpans: code.count,
    links,
    images,
    listItems,
    tableRows,
    wikilinks: (code.text.match(WIKILINK) ?? []).length,
    footnoteReferences: (code.text.match(FOOTNOTE_REFERENCE) ?? []).length,
  };
}

function noun(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function countMessage(original: number, result: number, singular: string, plural?: string): string {
  return `${noun(original, singular, plural)} in the original, ${result} in the result`;
}

/** URLs in `from` that `against` does not account for (multiset difference). */
function missingUrls(from: string[], against: string[]): string[] {
  const left = new Map<string, number>();
  for (const u of against) {left.set(u, (left.get(u) ?? 0) + 1);}
  const missing: string[] = [];
  for (const u of from) {
    const n = left.get(u) ?? 0;
    if (n > 0) {left.set(u, n - 1);}
    else {missing.push(u);}
  }
  return missing;
}

const URL_LIST_CAP = 3;

function urlList(urls: string[]): string {
  const shown = urls.slice(0, URL_LIST_CAP).join(', ');
  return urls.length > URL_LIST_CAP ? `${shown} and ${urls.length - URL_LIST_CAP} more` : shown;
}

function urlMismatch(kind: 'link' | 'image', original: string[], result: string[]): StructureMismatch | null {
  const missing = missingUrls(original, result);
  const extra = missingUrls(result, original);
  if (original.length === result.length && !missing.length) {return null;}
  const plural = `${kind}s`;
  let message: string;
  if (original.length !== result.length) {
    message = countMessage(original.length, result.length, kind, plural);
    if (missing.length) {message += ` (missing: ${urlList(missing)})`;}
  } else {
    message = `${noun(original.length, kind, plural)} point somewhere else in the result (missing: ${urlList(missing)}; unexpected: ${urlList(extra)})`;
  }
  return { kind, original: original.length, result: result.length, message };
}

/**
 * Compare the structure of a rewritten passage with the original. Zero
 * mismatches means every counted piece survived; a mismatch is a sentence for
 * the warning line, not an error.
 */
export function checkMarkdownStructure(original: string, result: string): StructureDiff {
  const a = countMarkdownStructure(original);
  const b = countMarkdownStructure(result);
  const mismatches: StructureMismatch[] = [];
  const count = (kind: StructureMismatch['kind'], x: number, y: number, singular: string, plural?: string): void => {
    if (x !== y) {mismatches.push({ kind, original: x, result: y, message: countMessage(x, y, singular, plural) });}
  };

  a.headings.forEach((n, i) => count('heading', n, b.headings[i], `level ${i + 1} heading`));
  count('fencedCodeBlock', a.fencedCodeBlocks, b.fencedCodeBlocks, 'fenced code block');
  count('inlineCode', a.inlineCodeSpans, b.inlineCodeSpans, 'inline code span');
  for (const m of [urlMismatch('link', a.links, b.links), urlMismatch('image', a.images, b.images)]) {
    if (m) {mismatches.push(m);}
  }
  count('listItem', a.listItems, b.listItems, 'list item');
  count('tableRow', a.tableRows, b.tableRows, 'table row');
  count('wikilink', a.wikilinks, b.wikilinks, 'wikilink');
  count('footnote', a.footnoteReferences, b.footnoteReferences, 'footnote reference');

  return { ok: mismatches.length === 0, mismatches, messages: mismatches.map((m) => m.message) };
}
