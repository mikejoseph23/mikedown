// ============================================================================
// Table structure edits that keep the cursor in the table
//
//   • reorderRows / reorderColumns: the transaction helpers behind the drag
//     handles and the right-click "Move Row Up" and friends.
//   • canMove / moveInTable: move the cursor's row or column one place.
//   • appendRow / appendColumn: grow the table from its edge (the hover "+").
//
// Each edit is one transaction, so one undo takes it back.
// ============================================================================

import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Selection, TextSelection, type Transaction } from '@tiptap/pm/state';
import { TableMap, addColumn, addRow, isInTable, selectedRect } from '@tiptap/pm/tables';

// ── Reordering ──────────────────────────────────────────────────────────────

/**
 * Move row `from` so it is inserted before row `to` (an index into the rows as
 * they are now, so moving down one place is `to = from + 2`). Row 0 is the
 * header and stays put: nothing moves to or from it.
 */
export function reorderRows(tr: Transaction, tableNode: PMNode, tablePos: number, from: number, to: number): void {
  const rows: PMNode[] = [];
  tableNode.forEach(row => rows.push(row));

  if (from < 1 || to < 1 || from >= rows.length || to > rows.length) {return;}
  if (from === to) {return;}

  const reordered = [...rows];
  const [moved] = reordered.splice(from, 1);
  const insertAt = to > from ? to - 1 : to;
  reordered.splice(insertAt, 0, moved);

  tr.replaceWith(tablePos, tablePos + tableNode.nodeSize, tableNode.type.create(tableNode.attrs, reordered));
}

/** Move column `from` so it is inserted before column `to`, in every row. */
export function reorderColumns(tr: Transaction, tableNode: PMNode, tablePos: number, from: number, to: number): void {
  const rows: PMNode[] = [];
  tableNode.forEach(row => rows.push(row));

  const newRows = rows.map(row => {
    const cells: PMNode[] = [];
    row.forEach(cell => cells.push(cell));
    if (from >= cells.length || to > cells.length) {return row;}
    const reordered = [...cells];
    const [moved] = reordered.splice(from, 1);
    const insertAt = to > from ? to - 1 : to;
    reordered.splice(insertAt, 0, moved);
    return row.type.create(row.attrs, reordered);
  });

  tr.replaceWith(tablePos, tablePos + tableNode.nodeSize, tableNode.type.create(tableNode.attrs, newRows));
}

interface TablePlace {
  tablePos: number;
  table: PMNode;
  rows: number;
  cols: number;
  /** The cursor's row and column. */
  row: number;
  col: number;
  /** The selection is one row / one column wide. */
  singleRow: boolean;
  singleCol: boolean;
  cellStart: number;
}

function tablePlace(editor: Editor): TablePlace | null {
  const { state } = editor;
  if (!isInTable(state)) {return null;}
  const rect = selectedRect(state);
  return {
    tablePos: rect.tableStart - 1,
    table: rect.table,
    rows: rect.map.height,
    cols: rect.map.width,
    row: rect.top,
    col: rect.left,
    singleRow: rect.bottom - rect.top === 1,
    singleCol: rect.right - rect.left === 1,
    cellStart: rect.tableStart + rect.map.map[rect.top * rect.map.width + rect.left],
  };
}

/** A text selection in cell (`row`, `col`) of the table at `tablePos`, `offset` into the cell. */
function selectionInCell(tr: Transaction, tablePos: number, row: number, col: number, offset: number): Selection | null {
  const table = tr.doc.nodeAt(tablePos);
  if (!table || table.type.name !== 'table') {return null;}
  const map = TableMap.get(table);
  if (row >= map.height || col >= map.width) {return null;}
  const cellStart = tablePos + 1 + map.map[row * map.width + col];
  const cell = tr.doc.nodeAt(cellStart);
  if (!cell) {return null;}
  const pos = cellStart + Math.min(Math.max(offset, 1), cell.nodeSize - 1);
  return TextSelection.near(tr.doc.resolve(pos));
}

export type MoveDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Whether the cursor's row (`up`/`down`) or column (`left`/`right`) can move
 * that way. The header row never moves and nothing moves above it, so the first
 * body row cannot go up.
 */
export function canMove(editor: Editor, dir: MoveDirection): boolean {
  const at = tablePlace(editor);
  if (!at) {return false;}
  switch (dir) {
    case 'up': return at.singleRow && at.row >= 2;
    case 'down': return at.singleRow && at.row >= 1 && at.row + 1 < at.rows;
    case 'left': return at.singleCol && at.col >= 1;
    case 'right': return at.singleCol && at.col + 1 < at.cols;
  }
}

/** Move the cursor's row or column one place, in one transaction, keeping the cursor in it. */
export function moveInTable(editor: Editor, dir: MoveDirection): boolean {
  if (!canMove(editor, dir)) {return false;}
  const at = tablePlace(editor)!;
  const { state, view } = editor;
  const tr = state.tr;
  const offset = state.selection.head - at.cellStart;
  let row = at.row;
  let col = at.col;
  if (dir === 'up' || dir === 'down') {
    row = dir === 'up' ? at.row - 1 : at.row + 1;
    reorderRows(tr, at.table, at.tablePos, at.row, dir === 'up' ? at.row - 1 : at.row + 2);
  } else {
    col = dir === 'left' ? at.col - 1 : at.col + 1;
    reorderColumns(tr, at.table, at.tablePos, at.col, dir === 'left' ? at.col - 1 : at.col + 2);
  }
  if (!tr.docChanged) {return false;}
  const sel = selectionInCell(tr, at.tablePos, row, col, offset);
  if (sel) {tr.setSelection(sel);}
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

// ── Growing from the edge ───────────────────────────────────────────────────

/**
 * Add a row at the end of the table at `tablePos`, or of the cursor's table.
 * The cursor goes to the new row, in the column it was in (the first column if
 * it was elsewhere), so a click on the strip keeps you in the table.
 */
export function appendRow(editor: Editor, tablePos?: number): boolean {
  return appendTo(editor, 'row', tablePos);
}

/** Add a column at the end of the table at `tablePos`, or of the cursor's table. */
export function appendColumn(editor: Editor, tablePos?: number): boolean {
  return appendTo(editor, 'col', tablePos);
}

function appendTo(editor: Editor, what: 'row' | 'col', tablePos?: number): boolean {
  const { state, view } = editor;
  const here = tablePlace(editor);
  const pos = tablePos ?? here?.tablePos ?? -1;
  const table = pos >= 0 ? state.doc.nodeAt(pos) : null;
  if (!table || table.type.name !== 'table') {return false;}
  const map = TableMap.get(table);
  const rect = { map, table, tableStart: pos + 1, left: 0, top: 0, right: map.width, bottom: map.height };
  const tr = state.tr;
  if (what === 'row') {addRow(tr, rect, map.height);} else {addColumn(tr, rect, map.width);}
  if (!tr.docChanged) {return false;}
  const inside = here !== null && here.tablePos === pos;
  const sel = what === 'row'
    ? selectionInCell(tr, pos, map.height, inside ? here.col : 0, 1)
    : selectionInCell(tr, pos, inside ? here.row : 0, map.width, 1);
  if (sel) {tr.setSelection(sel);}
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}
