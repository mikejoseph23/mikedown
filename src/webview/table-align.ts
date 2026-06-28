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
//      cells, header cells in the body, multi-block cells).
// ============================================================================

import { Editor, getHTMLFromFragment } from '@tiptap/core';
import { Fragment, Node as PMNode } from '@tiptap/pm/model';
import { selectionCell, TableMap } from '@tiptap/pm/tables';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';

export type ColumnAlign = 'left' | 'center' | 'right';

const alignAttribute = {
  textAlign: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) =>
      el.style.textAlign || el.getAttribute('align') || null,
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs.textAlign ? { style: `text-align: ${attrs.textAlign}` } : {},
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

// Mirror of tiptap-markdown's internal `isMarkdownSerializable`: a GFM pipe
// table requires a header-only first row, no header cells in the body, no
// spans, and single-block cells. Anything else must fall back to raw HTML.
function isMarkdownSerializable(node: PMNode): boolean {
  const rows = tableChildren(node);
  const firstRow = rows[0];
  if (!firstRow) return false;
  const bodyRows = rows.slice(1);
  if (
    tableChildren(firstRow).some(
      (cell) => cell.type.name !== 'tableHeader' || hasSpan(cell) || cell.childCount > 1,
    )
  ) {
    return false;
  }
  if (
    bodyRows.some((row) =>
      tableChildren(row).some(
        (cell) => cell.type.name === 'tableHeader' || hasSpan(cell) || cell.childCount > 1,
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
    parent instanceof Fragment || (parent as PMNode).type?.name === schema.topNodeType.name;
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

export const TableAligned = Table.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: any, node: PMNode, parent: PMNode | Fragment) {
          if (!isMarkdownSerializable(node)) {
            state.write(serializeTableAsHTML(node, parent));
            if (node.isBlock) state.closeBlock(node);
            return;
          }
          state.inTable = true;
          const headerRow = node.firstChild;
          node.forEach((row: PMNode, _p: number, i: number) => {
            state.write('| ');
            row.forEach((col: PMNode, _p2: number, j: number) => {
              if (j) state.write(' | ');
              const cellContent = col.firstChild;
              if (cellContent && cellContent.textContent.trim()) {
                state.renderInline(cellContent);
              }
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
        },
      },
    };
  },
});

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
  if (!$cell) return false;

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
    if (cellNode) tr.setNodeMarkup(pos, undefined, { ...cellNode.attrs, textAlign: value });
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
