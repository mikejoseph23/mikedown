// ============================================================================
// Per-column table alignment — end-to-end.
//
// Markdown tables can only express alignment per *column* (via the delimiter
// row: `:---` left, `:---:` center, `---:` right). TipTap/ProseMirror stores
// attributes per *cell*. This module bridges the two:
//
//   1. `TableCellAligned` / `TableHeaderAligned` add a real `textAlign` schema
//      attribute that renders to an inline `text-align` style (so it shows in
//      the editor) and parses back from markdown-it's emitted style/`align`.
//   2. `setColumnAlign` applies an alignment to every cell in the current
//      column (the only granularity markdown can round-trip).
//   3. `TableAligned` overrides tiptap-markdown's table serializer so the
//      delimiter row reflects each column's alignment, while preserving the
//      library's HTML fallback for tables markdown can't represent (merged
//      cells, header cells in the body, non-paragraph blocks in cells).
//   4. Line breaks in cells (issue #9). A pipe-table row is one line, so GFM
//      writes cell breaks as `<br>`. Hard breaks already serialize that way;
//      a cell split into several paragraphs (Enter) joins them with `<br>`
//      too, and the parser turns `<br>` back into a hard break, even with
//      markdown-it's `html` option off.
// ============================================================================

import { Editor, getHTMLFromFragment } from '@tiptap/core';
import { Fragment, Node as PMNode } from '@tiptap/pm/model';
import { selectionCell, TableMap } from '@tiptap/pm/tables';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { padTableRows } from './table-pad';

export type ColumnAlign = 'left' | 'center' | 'right';

const alignAttribute = {
  textAlign: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) =>
      el.style.textAlign || el.getAttribute('align') || null,
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs.textAlign ? { style: `text-align: ${String(attrs.textAlign)}` } : {},
  },
};

export const TableCellAligned = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...alignAttribute };
  },
});

export const TableHeaderAligned = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...alignAttribute };
  },
});

// ── Markdown serialization ──────────────────────────────────────────────────

function tableChildren(node: PMNode): PMNode[] {
  return (node?.content as unknown as { content?: PMNode[] })?.content ?? [];
}

function hasSpan(node: PMNode): boolean {
  return node.attrs.colspan > 1 || node.attrs.rowspan > 1;
}

// A cell fits on one pipe-table line if it holds only paragraphs; extra
// paragraphs are joined with `<br>` on output.
function hasOnlyParagraphs(cell: PMNode): boolean {
  return tableChildren(cell).every((child) => child.type.name === 'paragraph');
}

// Mirror of tiptap-markdown's internal `isMarkdownSerializable`: a GFM pipe
// table requires a header-only first row, no header cells in the body, no
// spans, and paragraph-only cells. Anything else must fall back to raw HTML.
function isMarkdownSerializable(node: PMNode): boolean {
  const rows = tableChildren(node);
  const firstRow = rows[0];
  if (!firstRow) {return false;}
  const bodyRows = rows.slice(1);
  if (
    tableChildren(firstRow).some(
      (cell) => cell.type.name !== 'tableHeader' || hasSpan(cell) || !hasOnlyParagraphs(cell),
    )
  ) {
    return false;
  }
  if (
    bodyRows.some((row) =>
      tableChildren(row).some(
        (cell) => cell.type.name === 'tableHeader' || hasSpan(cell) || !hasOnlyParagraphs(cell),
      ),
    )
  ) {
    return false;
  }
  return true;
}

function delimiterFor(align: string | null | undefined): string {
  switch (align) {
    case 'center':
      return ':---:';
    case 'right':
      return '---:';
    default:
      // Left is the GFM default — emit plain `---` rather than the redundant `:---`.
      return '---';
  }
}

// Replicates tiptap-markdown's `serializeHTML`/`formatBlock` (not exported) so a
// non-serializable table still round-trips as HTML, same as upstream.
function serializeTableAsHTML(node: PMNode, parent: PMNode | Fragment): string {
  const schema = node.type.schema;
  const html = getHTMLFromFragment(Fragment.from(node), schema);
  const isTopLevel =
    parent instanceof Fragment || parent.type?.name === schema.topNodeType.name;
  if (node.isBlock && isTopLevel) {
    const dom = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
    const element = dom.firstElementChild as HTMLElement | null;
    if (element) {
      element.innerHTML = element.innerHTML.trim() ? `\n${element.innerHTML}\n` : '\n';
      return element.outerHTML;
    }
  }
  return html;
}

/**
 * Render each cell of a pipe table to its markdown text, for padding. Runs
 * before any real output: the sentinel keeps the cell off the start of a line
 * (so it escapes the way it will in the table), and `out` is restored after.
 */
function renderCellTexts(state: any, node: PMNode): string[][] {
  const start = state.out.length;
  const rows: string[][] = [];
  node.forEach((row: PMNode) => {
    const cells: string[] = [];
    row.forEach((col: PMNode) => {
      state.out += '| ';
      const cellStart = state.out.length;
      col.forEach((paragraph: PMNode, _p: number, k: number) => {
        if (k) {state.write('<br>');}
        if (paragraph.textContent.trim()) {state.renderInline(paragraph);}
      });
      cells.push(escapeCellPipes(state.out.slice(cellStart)));
      state.out = state.out.slice(0, start);
    });
    rows.push(cells);
  });
  return rows;
}

export const TableAligned = Table.extend({
  addStorage() {
    // `padColumns` mirrors `mikedown.tables.padColumns`; the editor sets it
    // through `editor.storage.table.padColumns`. (tiptap builds a fresh
    // storage object per read, so `serialize` reaches the live one through
    // the `this.editor` tiptap-markdown binds.)
    return {
      ...this.parent?.(),
      padColumns: false,
      markdown: {
        serialize(this: { editor?: Editor }, state: any, node: PMNode, parent: PMNode | Fragment) {
          if (!isMarkdownSerializable(node)) {
            state.write(serializeTableAsHTML(node, parent));
            if (node.isBlock) {state.closeBlock(node);}
            return;
          }
          if ((this.editor?.storage as { table?: { padColumns?: boolean } } | undefined)?.table?.padColumns) {
            // Flush the pending block break (and any quote/list prefix) first,
            // so the cell pass below sees the same line context as the output.
            state.write();
            // `inTable` makes hard breaks write `<br>`.
            state.inTable = true;
            const rows = renderCellTexts(state, node);
            const aligns: Array<string | null> = [];
            (node.firstChild as PMNode).forEach((col: PMNode) =>
              aligns.push((col.attrs.textAlign as string | null) ?? null),
            );
            for (const line of padTableRows(rows, aligns)) {
              state.write(line);
              state.ensureNewLine();
            }
            state.closeBlock(node);
            state.inTable = false;
            return;
          }
          state.inTable = true;
          const headerRow = node.firstChild;
          node.forEach((row: PMNode, _p: number, i: number) => {
            state.write('| ');
            row.forEach((col: PMNode, _p2: number, j: number) => {
              if (j) {state.write(' | ');}
              const cellStart = state.out.length;
              col.forEach((paragraph: PMNode, _p3: number, k: number) => {
                if (k) {state.write('<br>');}
                if (paragraph.textContent.trim()) {state.renderInline(paragraph);}
              });
              state.out = state.out.slice(0, cellStart) + escapeCellPipes(state.out.slice(cellStart));
            });
            state.write(' |');
            state.ensureNewLine();
            if (!i && headerRow) {
              const delimiters: string[] = [];
              headerRow.forEach((col: PMNode) =>
                delimiters.push(delimiterFor(col.attrs.textAlign as string | null)),
              );
              state.write(`| ${delimiters.join(' | ')} |`);
              state.ensureNewLine();
            }
          });
          state.closeBlock(node);
          state.inTable = false;
        },
        parse: {
          // Alignment arrives as inline `text-align` styles from markdown-it and
          // is captured by the cell `parseHTML` rules above.
          setup(md: any) {
            md.core.ruler.after('inline', 'mikedown_table_br', tableBreaksToHardBreaks);
          },
        },
      },
    };
  },
});

/**
 * Escape every `|` in a rendered cell that would otherwise split it. Text runs
 * already write `\|`; inline code (written raw), wikilink aliases and URLs do
 * not. Inside a code span every `|` gets a backslash, since GFM strips one
 * before the span is parsed; outside, `\x` pairs are already escapes.
 */
export function escapeCellPipes(cell: string): string {
  let out = '';
  let i = 0;
  while (i < cell.length) {
    const ch = cell[i];
    if (ch === '\\') {
      out += cell.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === '`') {
      let n = 1;
      while (cell[i + n] === '`') {n++;}
      const ticks = '`'.repeat(n);
      const close = findClosingTicks(cell, i + n, n);
      if (close < 0) {
        out += ticks;
        i += n;
        continue;
      }
      out += ticks + cell.slice(i + n, close).replace(/\|/g, '\\|') + ticks;
      i = close + n;
      continue;
    }
    out += ch === '|' ? '\\|' : ch;
    i++;
  }
  return out;
}

function findClosingTicks(s: string, from: number, n: number): number {
  let i = from;
  while (i < s.length) {
    if (s[i] !== '`') {
      i++;
      continue;
    }
    let m = 1;
    while (s[i + m] === '`') {m++;}
    if (m === n) {return i;}
    i += m;
  }
  return -1;
}

// With `html: false`, markdown-it leaves `<br>` in a cell as literal text.
// Split those text tokens so each `<br>` becomes a real hard break.
const BR_PATTERN = /<br\s*\/?>/i;
const BR_SPLIT = /<br\s*\/?>/gi;

function tableBreaksToHardBreaks(state: any): void {
  let inCell = false;
  for (const token of state.tokens) {
    if (token.type === 'td_open' || token.type === 'th_open') {inCell = true;}
    else if (token.type === 'td_close' || token.type === 'th_close') {inCell = false;}
    else if (inCell && token.type === 'inline' && token.children) {
      const children: any[] = [];
      for (const child of token.children) {
        if (child.type !== 'text' || !BR_PATTERN.test(child.content)) {
          children.push(child);
          continue;
        }
        child.content.split(BR_SPLIT).forEach((part: string, i: number) => {
          if (i) {children.push(new state.Token('hardbreak', 'br', 0));}
          if (part) {
            const text = new state.Token('text', '', 0);
            text.content = part;
            children.push(text);
          }
        });
      }
      token.children = children;
    }
  }
}

// ── Column alignment command ────────────────────────────────────────────────

/** Apply `align` to every cell in the column containing the current selection. */
export function setColumnAlign(editor: Editor, align: ColumnAlign): boolean {
  const { state } = editor;
  let $cell;
  try {
    $cell = selectionCell(state);
  } catch {
    return false;
  }
  if (!$cell) {return false;}

  const table = $cell.node(-1);
  const tableStart = $cell.start(-1);
  const map = TableMap.get(table);
  const col = map.colCount($cell.pos - tableStart);
  const cellRelPositions = map.cellsInRect({
    left: col,
    top: 0,
    right: col + 1,
    bottom: map.height,
  });

  // Left is the GFM default, so store it as null — keeps cell attrs and the
  // serialized delimiter (`---`) in sync for an exact round-trip.
  const value = align === 'left' ? null : align;
  const { tr } = state;
  // Attr-only markup changes don't shift positions, so original offsets stay valid.
  cellRelPositions.forEach((rel) => {
    const pos = tableStart + rel;
    const cellNode = tr.doc.nodeAt(pos);
    if (cellNode) {tr.setNodeMarkup(pos, undefined, { ...cellNode.attrs, textAlign: value });}
  });

  if (tr.docChanged) {
    editor.view.dispatch(tr);
    editor.view.focus();
  }
  return true;
}

/** Alignment of the column containing the current selection (null = default/left). */
export function getColumnAlign(editor: Editor): ColumnAlign | null {
  const { state } = editor;
  let $cell;
  try {
    $cell = selectionCell(state);
  } catch {
    return null;
  }
  const cell = $cell?.nodeAfter;
  return (cell?.attrs.textAlign as ColumnAlign | null) ?? null;
}
