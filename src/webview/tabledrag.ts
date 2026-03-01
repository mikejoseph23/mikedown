import { Editor } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { Transaction } from '@tiptap/pm/state';

// =============================================
// DRAG HANDLE STATE
// =============================================

let dragState: {
  type: 'row' | 'col';
  sourceIndex: number;
  currentIndex: number;
  tablePos: number;
  overlayEl: HTMLElement | null;
  dropLineEl: HTMLElement | null;
} | null = null;

let handleOverlays: HTMLElement[] = [];
let activeTableEl: HTMLElement | null = null;

// =============================================
// MULTI-CELL SELECTION STATE
// =============================================

interface CellSelection {
  tableEl: HTMLElement;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

let cellSelection: CellSelection | null = null;
let isMouseDown = false;

// =============================================
// PUBLIC API
// =============================================

export function initTableDrag(editor: Editor): void {
  // Listen to selectionUpdate to show/hide drag handles
  editor.on('selectionUpdate', () => {
    updateDragHandles(editor);
  });
  editor.on('blur', () => {
    setTimeout(() => clearDragHandles(), 200);
  });

  // Global mouseup to end drags
  document.addEventListener('mouseup', () => {
    if (dragState) finalizeDrag(editor);
    isMouseDown = false;
  });

  // Global mousemove for drag tracking
  document.addEventListener('mousemove', (e) => {
    if (dragState) onDragMove(e, editor);
    if (isMouseDown && cellSelection) onCellSelectionMove(e);
  });

  // Keyboard: Delete/Backspace on cell selection
  document.addEventListener('keydown', (e) => {
    if (!cellSelection) return;
    if (e.key === 'Escape') { clearCellSelection(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      clearSelectedCellContents(editor);
    }
  });
}

export function clearDragHandles(): void {
  handleOverlays.forEach(el => el.remove());
  handleOverlays = [];
  activeTableEl = null;
}

export function clearCellSelection(): void {
  if (!cellSelection) return;
  cellSelection.tableEl.querySelectorAll('.mikedown-cell-selected, .mikedown-cell-border-top, .mikedown-cell-border-right, .mikedown-cell-border-bottom, .mikedown-cell-border-left')
    .forEach(el => el.classList.remove('mikedown-cell-selected', 'mikedown-cell-border-top', 'mikedown-cell-border-right', 'mikedown-cell-border-bottom', 'mikedown-cell-border-left'));
  cellSelection = null;
}

// =============================================
// DRAG HANDLES
// =============================================

function updateDragHandles(editor: Editor): void {
  const isInTable = editor.isActive('table');
  if (!isInTable) {
    clearDragHandles();
    clearCellSelection();
    return;
  }

  // Find the DOM table element
  const { view } = editor;
  const { $from } = view.state.selection;
  let tableDOM: HTMLElement | null = null;
  let tablePos = -1;
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'table') {
      tablePos = $from.before(d);
      try {
        tableDOM = view.nodeDOM(tablePos) as HTMLElement;
      } catch { /* ignore */ }
      break;
    }
  }
  if (!tableDOM || tableDOM === activeTableEl) return;

  clearDragHandles();
  activeTableEl = tableDOM;

  // Row drag handles (left of each non-header row)
  const rows = Array.from(tableDOM.querySelectorAll('tr'));
  rows.forEach((row, rowIdx) => {
    // Skip header row (rowIdx === 0)
    if (rowIdx === 0) return;
    const handle = createDragHandle('row', rowIdx, row as HTMLElement);
    document.body.appendChild(handle);
    handleOverlays.push(handle);

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startDrag('row', rowIdx, tablePos, handle);
    });
  });

  // Column drag handles (below each column in last header cell)
  const headerRow = tableDOM.querySelector('thead tr, tr:first-child');
  if (headerRow) {
    const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
    headerCells.forEach((cell, colIdx) => {
      const handle = createDragHandle('col', colIdx, cell as HTMLElement);
      document.body.appendChild(handle);
      handleOverlays.push(handle);

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startDrag('col', colIdx, tablePos, handle);
      });
    });
  }

  // Wire multi-cell selection on all cells
  wireCellSelection(tableDOM, tablePos);
}

function createDragHandle(type: 'row' | 'col', index: number, anchorEl: HTMLElement): HTMLElement {
  const handle = document.createElement('div');
  handle.className = `td-handle td-handle-${type}`;
  handle.dataset.index = String(index);
  handle.innerHTML = type === 'row' ? '⋮⋮' : '··';
  handle.title = type === 'row' ? `Drag to reorder row ${index}` : `Drag to reorder column ${index}`;

  // Position
  const rect = anchorEl.getBoundingClientRect();
  if (type === 'row') {
    handle.style.top = `${rect.top + window.scrollY + rect.height / 2 - 8}px`;
    handle.style.left = `${rect.left + window.scrollX - 20}px`;
  } else {
    handle.style.top = `${rect.bottom + window.scrollY + 2}px`;
    handle.style.left = `${rect.left + window.scrollX + rect.width / 2 - 8}px`;
  }

  return handle;
}

function startDrag(type: 'row' | 'col', sourceIndex: number, tablePos: number, handleEl: HTMLElement): void {
  const overlay = document.createElement('div');
  overlay.className = 'td-drag-overlay';
  document.body.appendChild(overlay);

  const dropLine = document.createElement('div');
  dropLine.className = `td-drop-line td-drop-line-${type}`;
  document.body.appendChild(dropLine);

  dragState = { type, sourceIndex, currentIndex: sourceIndex, tablePos, overlayEl: overlay, dropLineEl: dropLine };
  document.body.classList.add('td-dragging');
}

function onDragMove(e: MouseEvent, editor: Editor): void {
  if (!dragState || !activeTableEl) return;
  const { type, sourceIndex } = dragState;

  if (type === 'row') {
    const rows = Array.from(activeTableEl.querySelectorAll('tr'));
    let targetIdx = sourceIndex;
    for (let i = 1; i < rows.length; i++) { // skip header
      const rect = rows[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) { targetIdx = i; break; }
      targetIdx = i + 1;
    }
    dragState.currentIndex = Math.max(1, Math.min(rows.length - 1, targetIdx));

    // Position drop line
    if (dragState.dropLineEl) {
      const targetRow = rows[dragState.currentIndex - 1] || rows[rows.length - 1];
      const rect = targetRow.getBoundingClientRect();
      dragState.dropLineEl.style.top = `${rect.bottom}px`;
      dragState.dropLineEl.style.left = `${rect.left}px`;
      dragState.dropLineEl.style.width = `${rect.width}px`;
      dragState.dropLineEl.style.display = 'block';
    }
  } else {
    const headerRow = activeTableEl.querySelector('thead tr, tr:first-child');
    if (!headerRow) return;
    const cols = Array.from(headerRow.querySelectorAll('th, td'));
    let targetIdx = sourceIndex;
    for (let i = 0; i < cols.length; i++) {
      const rect = cols[i].getBoundingClientRect();
      if (e.clientX < rect.left + rect.width / 2) { targetIdx = i; break; }
      targetIdx = i + 1;
    }
    dragState.currentIndex = Math.max(0, Math.min(cols.length - 1, targetIdx));

    if (dragState.dropLineEl) {
      const targetCol = cols[dragState.currentIndex] || cols[cols.length - 1];
      const rect = targetCol.getBoundingClientRect();
      dragState.dropLineEl.style.left = `${rect.left}px`;
      dragState.dropLineEl.style.top = `${rect.top}px`;
      dragState.dropLineEl.style.height = `${activeTableEl.getBoundingClientRect().height}px`;
      dragState.dropLineEl.style.display = 'block';
    }
  }
}

function finalizeDrag(editor: Editor): void {
  if (!dragState) return;
  const { type, sourceIndex, currentIndex, tablePos, overlayEl, dropLineEl } = dragState;
  dragState = null;
  document.body.classList.remove('td-dragging');
  overlayEl?.remove();
  dropLineEl?.remove();

  if (sourceIndex === currentIndex) return;

  const { state } = editor.view;
  const tableNode = state.doc.nodeAt(tablePos);
  if (!tableNode || tableNode.type.name !== 'table') return;

  const tr = state.tr;
  if (type === 'row') {
    reorderRows(tr, tableNode, tablePos, sourceIndex, currentIndex);
  } else {
    reorderColumns(tr, tableNode, tablePos, sourceIndex, currentIndex);
  }
  editor.view.dispatch(tr);

  // Rebuild handles after reorder
  setTimeout(() => updateDragHandles(editor), 50);
}

function reorderRows(tr: Transaction, tableNode: PMNode, tablePos: number, from: number, to: number): void {
  // Collect rows: index 0 = first body row (header is index -1 conceptually)
  // The table node children are: tableHeader (optional), tableRow...
  // Actually TipTap tables: tableNode.content = [tableRow, tableRow, ...]
  // tableRow at index 0 is the header row (has tableHeader cells)
  const rows: PMNode[] = [];
  tableNode.forEach(row => rows.push(row));

  if (from < 1 || to < 1 || from >= rows.length || to > rows.length) return;
  if (from === to) return;

  const reordered = [...rows];
  const [moved] = reordered.splice(from, 1);
  const insertAt = to > from ? to - 1 : to;
  reordered.splice(insertAt, 0, moved);

  const newTable = tableNode.type.create(tableNode.attrs, reordered.map(r => r));
  tr.replaceWith(tablePos, tablePos + tableNode.nodeSize, newTable);
}

function reorderColumns(tr: Transaction, tableNode: PMNode, tablePos: number, from: number, to: number): void {
  const rows: PMNode[] = [];
  tableNode.forEach(row => rows.push(row));

  const newRows = rows.map(row => {
    const cells: PMNode[] = [];
    row.forEach(cell => cells.push(cell));
    if (from >= cells.length || to > cells.length) return row;
    const reordered = [...cells];
    const [moved] = reordered.splice(from, 1);
    const insertAt = to > from ? to - 1 : to;
    reordered.splice(insertAt, 0, moved);
    return row.type.create(row.attrs, reordered);
  });

  const newTable = tableNode.type.create(tableNode.attrs, newRows);
  tr.replaceWith(tablePos, tablePos + tableNode.nodeSize, newTable);
}

// =============================================
// MULTI-CELL SELECTION
// =============================================

function wireCellSelection(tableEl: HTMLElement, tablePos: number): void {
  const cells = Array.from(tableEl.querySelectorAll('td, th')) as HTMLElement[];
  cells.forEach(cell => {
    cell.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const { rowIdx, colIdx } = getCellIndices(cell, tableEl);
      clearCellSelection();
      isMouseDown = true;
      cellSelection = { tableEl, startRow: rowIdx, startCol: colIdx, endRow: rowIdx, endCol: colIdx };
      applySelectionHighlight();
    });

    cell.addEventListener('mouseenter', () => {
      if (!isMouseDown || !cellSelection || cellSelection.tableEl !== tableEl) return;
      const { rowIdx, colIdx } = getCellIndices(cell, tableEl);
      cellSelection.endRow = rowIdx;
      cellSelection.endCol = colIdx;
      applySelectionHighlight();
    });
  });
}

function onCellSelectionMove(_e: MouseEvent): void {
  // Movement is handled per-cell via mouseenter above
}

function getCellIndices(cell: HTMLElement, tableEl: HTMLElement): { rowIdx: number; colIdx: number } {
  const rows = Array.from(tableEl.querySelectorAll('tr'));
  for (let r = 0; r < rows.length; r++) {
    const cells = Array.from(rows[r].querySelectorAll('td, th'));
    for (let c = 0; c < cells.length; c++) {
      if (cells[c] === cell) return { rowIdx: r, colIdx: c };
    }
  }
  return { rowIdx: 0, colIdx: 0 };
}

function applySelectionHighlight(): void {
  if (!cellSelection) return;
  const { tableEl, startRow, startCol, endRow, endCol } = cellSelection;
  const minR = Math.min(startRow, endRow), maxR = Math.max(startRow, endRow);
  const minC = Math.min(startCol, endCol), maxC = Math.max(startCol, endCol);

  const rows = Array.from(tableEl.querySelectorAll('tr'));
  rows.forEach((row, r) => {
    const cells = Array.from(row.querySelectorAll('td, th')) as HTMLElement[];
    cells.forEach((cell, c) => {
      const inSel = r >= minR && r <= maxR && c >= minC && c <= maxC;
      cell.classList.toggle('mikedown-cell-selected', inSel);
      cell.classList.toggle('mikedown-cell-border-top', inSel && r === minR);
      cell.classList.toggle('mikedown-cell-border-bottom', inSel && r === maxR);
      cell.classList.toggle('mikedown-cell-border-left', inSel && c === minC);
      cell.classList.toggle('mikedown-cell-border-right', inSel && c === maxC);
    });
  });
}

function clearSelectedCellContents(editor: Editor): void {
  if (!cellSelection || !activeTableEl) return;
  const { state, dispatch } = editor.view;
  const tr = state.tr;
  let modified = false;

  const { minR, maxR, minC, maxC } = (() => {
    const { startRow, startCol, endRow, endCol } = cellSelection!;
    return { minR: Math.min(startRow, endRow), maxR: Math.max(startRow, endRow), minC: Math.min(startCol, endCol), maxC: Math.max(startCol, endCol) };
  })();

  // Find table pos
  const { view } = editor;
  const { $from } = view.state.selection;
  let tablePos = -1;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === 'table') { tablePos = $from.before(d); break; }
  }
  if (tablePos < 0) return;

  // Walk DOM cells in selection and clear them via PM
  const rows = Array.from(activeTableEl.querySelectorAll('tr'));
  for (let r = minR; r <= maxR; r++) {
    const cells = Array.from(rows[r]?.querySelectorAll('td, th') || []) as HTMLElement[];
    for (let c = minC; c <= maxC; c++) {
      const cell = cells[c];
      if (!cell) continue;
      try {
        const pos = view.posAtDOM(cell, 0);
        const pmNode = state.doc.nodeAt(pos - 1);
        if (pmNode && (pmNode.type.name === 'tableCell' || pmNode.type.name === 'tableHeader')) {
          const start = pos;
          const end = pos + pmNode.content.size;
          const emptyPara = state.schema.nodes.paragraph.create();
          tr.replaceWith(start, end, emptyPara);
          modified = true;
        }
      } catch { /* ignore */ }
    }
  }

  if (modified) dispatch(tr);
  clearCellSelection();
}
