/**
 * Pure helpers behind `handle.revealText(line, column, length)`: a host that
 * found a match in a document's markdown source (folder search) asks the
 * editor to show it. Source mode maps line/column straight onto CodeMirror.
 * The rich text view has no source map, so the match is found again in the
 * rendered text: the Nth occurrence of the matched string, where N is how
 * many identical occurrences precede it in the source.
 */
import type { Node as PmNode } from '@tiptap/pm/model';

export interface SourceTarget {
  /** The matched text (empty when `length` is 0). */
  text: string;
  /** How many identical occurrences precede it in the markdown. */
  occurrence: number;
  /** 0-based offset of the match in the markdown. */
  offset: number;
  /** 0..1 position of the line within the document, for the scroll fallback. */
  fraction: number;
}

/** Locate a 1-based `line` / `column` (UTF-16 units) of `markdown`. */
export function locateInSource(markdown: string, line: number, column: number, length: number): SourceTarget {
  const lines = markdown.split('\n');
  const lineIdx = Math.max(0, Math.min(lines.length - 1, Math.floor(line) - 1));
  let offset = 0;
  for (let i = 0; i < lineIdx; i++) {offset += lines[i].length + 1;}
  const col = Math.max(0, Math.min(lines[lineIdx].length, column - 1));
  offset += col;
  const text = length > 0 ? lines[lineIdx].substr(col, length) : '';
  let occurrence = 0;
  if (text) {
    let from = 0;
    for (;;) {
      const hit = markdown.indexOf(text, from);
      if (hit === -1 || hit >= offset) {break;}
      occurrence++;
      from = hit + 1;
    }
  }
  return { text, occurrence, offset, fraction: lines.length > 1 ? lineIdx / (lines.length - 1) : 0 };
}

/** ProseMirror range of the `occurrence`th (0-based) `text` in the rendered doc, or the first if there are fewer. */
export function findInDoc(doc: PmNode, text: string, occurrence: number): { from: number; to: number } | null {
  if (!text) {return null;}
  const found: Array<{ from: number; to: number }> = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) {return true;}
    // One string per textblock; `map[i]` is the doc position of char i.
    let str = '';
    const map: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) {
        const t = child.text ?? '';
        for (let i = 0; i < t.length; i++) {map.push(start + i);}
        str += t;
      } else {
        map.push(start);
        str += '\u0000';
      }
    });
    let from = 0;
    for (;;) {
      const hit = str.indexOf(text, from);
      if (hit === -1) {break;}
      found.push({ from: map[hit], to: map[hit + text.length - 1] + 1 });
      from = hit + 1;
    }
    return false;
  });
  return found[occurrence] ?? found[0] ?? null;
}
