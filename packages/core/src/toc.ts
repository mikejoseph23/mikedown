// Table of contents: pure generation, parsing and comparison.
//
// A TOC is a region between two HTML comment markers holding a nested list of
// `[Heading](#anchor)` links, the convention markdown-toc and similar tools
// use, so the saved file renders as a working TOC on GitHub and anywhere else:
//
//   <!-- toc -->
//
//   - [Setup](#setup)
//     - [Install](#install)
//
//   <!-- tocstop -->
//
// No DOM, ProseMirror or `vscode` imports: `toc-node.ts` feeds this the
// document's headings and writes the result back in a transaction.

import { githubAnchorId } from './shared/anchoring';

/** Opening marker. Also adopts doctoc's `<!-- START doctoc ... -->`. */
export const TOC_START_RE = /^<!--\s*(?:toc|START doctoc\b[^>]*?)\s*-->$/i;
/** Closing marker: `<!-- tocstop -->`, `<!-- /toc -->`, or doctoc's END. */
export const TOC_END_RE = /^<!--\s*(?:tocstop|\/toc|END doctoc\b[^>]*?)\s*-->$/i;

export const DEFAULT_TOC_OPEN = '<!-- toc -->';
export const DEFAULT_TOC_CLOSE = '<!-- tocstop -->';

/** A bullet or ordered list item line, the only content a TOC region may hold. */
const LIST_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;
const ENTRY_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+\[((?:\\.|[^\]\\])*)\]\(#([^)\s]*)\)\s*$/;

export interface TocHeading {
  level: number;
  text: string;
  /** False for headings that get an anchor but no entry (e.g. inside a callout). */
  listed: boolean;
}

export interface TocEntry {
  /** Nesting depth, 0 for the outermost entries. */
  depth: number;
  text: string;
  anchor: string;
}

/** Whether every non-blank line of a region body is a list item line. */
export function isTocBody(body: string): boolean {
  return body.split('\n').every((line) => !line.trim() || LIST_LINE_RE.test(line));
}

/**
 * TOC entries for `headings` in document order. Anchors use the same GitHub
 * slugs (with `-1`, `-2` suffixes for duplicates) as in-doc links, counted over
 * every heading, listed or not. Depth follows the heading outline, so a
 * skipped level (H2 straight to H4) nests one step, not two.
 */
export function buildTocEntries(headings: TocHeading[]): TocEntry[] {
  const seen = new Map<string, number>();
  const stack: number[] = [];
  const entries: TocEntry[] = [];
  for (const h of headings) {
    const base = githubAnchorId(h.text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const text = h.text.trim();
    if (!h.listed || !text) {continue;}
    while (stack.length && stack[stack.length - 1] >= h.level) {stack.pop();}
    entries.push({ depth: stack.length, text, anchor: count === 0 ? base : `${base}-${count}` });
    stack.push(h.level);
  }
  return entries;
}

const escapeLinkText = (text: string): string => text.replace(/[\\[\]]/g, '\\$&');
const unescapeLinkText = (text: string): string => text.replace(/\\(.)/g, '$1');

/** The markdown list for `entries`, two spaces per level, no trailing newline. */
export function renderTocList(entries: TocEntry[]): string {
  return entries
    .map((e) => `${'  '.repeat(e.depth)}- [${escapeLinkText(e.text)}](#${e.anchor})`)
    .join('\n');
}

/** A region body (the lines between the markers) for `entries`. */
export function renderTocBody(entries: TocEntry[]): string {
  return entries.length ? `\n${renderTocList(entries)}\n\n` : '\n';
}

/**
 * Parse a region body back into entries, or null when a line isn't a
 * `[text](#anchor)` item. Depth comes from indentation, ranked, so any indent
 * width (2, 3, 4 spaces) reads the same.
 */
export function parseTocBody(body: string): TocEntry[] | null {
  const entries: TocEntry[] = [];
  const indents: number[] = [];
  for (const line of body.split('\n')) {
    if (!line.trim()) {continue;}
    const m = ENTRY_RE.exec(line.replace(/\t/g, '    '));
    if (!m) {return null;}
    const indent = m[1].length;
    while (indents.length && indents[indents.length - 1] > indent) {indents.pop();}
    if (!indents.length || indents[indents.length - 1] < indent) {indents.push(indent);}
    entries.push({ depth: indents.length - 1, text: unescapeLinkText(m[2]).trim(), anchor: m[3] });
  }
  return entries;
}

/** Whether `body` already lists exactly `entries` (formatting aside). */
export function tocBodyMatches(body: string, entries: TocEntry[]): boolean {
  const parsed = parseTocBody(body);
  if (!parsed || parsed.length !== entries.length) {return false;}
  return parsed.every(
    (p, i) => p.depth === entries[i].depth && p.text === entries[i].text && p.anchor === entries[i].anchor,
  );
}
