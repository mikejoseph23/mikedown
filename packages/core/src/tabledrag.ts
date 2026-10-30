import { Editor } from '@tiptap/core';
import { getPortal } from './portal';
import { appendColumn, appendRow, reorderColumns, reorderRows } from './table-structure';
import {
  ADD_STRIP_SIZE,
  boxIntersectsViewport,
  computeAddColumnStrip,
  computeAddRowStrip,
  computeHandlePosition,
  isAnchorVisible,
  isPointerNearBox,
  type Box,
} from './table-geometry';

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
let activeTablePos = -1;
/** Row and column count the current handles were built for. */
let activeShape = '';

// =============================================
// PUBLIC API
// =============================================

/**
 * Wire row and column drag handles and the hover "+" strips for one editor.
 * Returns a function that removes every listener this attached and the overlays.
 * Cell-range selection is prosemirror-tables' own `CellSelection` (Shift+click,
 * Shift+arrows, drag), which also handles Backspace/Delete and copy.
 *
 * Everything here is a portal overlay outside the ProseMirror DOM, placed from
 * the table's rectangles; nothing writes to the editor DOM.
 */
export function initTableDrag(editor: Editor, scrollContainer: HTMLElement): () => void {
  // Source mode hides the rich-text container; the overlays must not float over it.
  const inSourceMode = (): boolean => scrollContainer.style.display === 'none';

  const syncHandles = (): void => {
    if (inSourceMode()) {
      clearDragHandles();
      return;
    }
    updateDragHandles(editor);
  };
  const onUpdate = (): void => {
    syncHandles();
    positionAddStrips();
  };
  const onBlur = (): void => {
    setTimeout(() => clearDragHandles(), 200);
  };
  editor.on('selectionUpdate', syncHandles);
  // Typing changes row heights, and Enter adds lines: follow them.
  editor.on('update', onUpdate);
  editor.on('blur', onBlur);

  // Anything that moves the table on screen: the page or the editor container
  // scrolling, the table's own horizontal scroll (scroll events do not bubble,
  // so one capturing listener covers all of them), and a resize.
  const onMove = (): void => {
    if (handleOverlays.length > 0) {repositionHandles();}
    positionAddStrips();
  };
  window.addEventListener('scroll', onMove, { capture: true, passive: true });
  window.addEventListener('resize', onMove);

  // Global mouseup to end drags
  const onMouseUp = (): void => {
    if (dragState) {finalizeDrag(editor);}
  };
  document.addEventListener('mouseup', onMouseUp);

  // Global mousemove for drag tracking and for the hover "+" strips
  const onMouseMove = (e: MouseEvent): void => {
    if (dragState) {
      onDragMove(e, editor);
      return;
    }
    onPointerMoveForStrips(e, editor, inSourceMode());
  };
  document.addEventListener('mousemove', onMouseMove);

  // A keystroke hides the "+" strips until the pointer moves again.
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.key === 'Shift') {return;}
    hideAddStrips();
  };
  editor.view.dom.addEventListener('keydown', onKeyDown, true);

  return () => {
    editor.off('selectionUpdate', syncHandles);
    editor.off('update', onUpdate);
    editor.off('blur', onBlur);
    window.removeEventListener('scroll', onMove, { capture: true });
    window.removeEventListener('resize', onMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('mousemove', onMouseMove);
    editor.view.dom.removeEventListener('keydown', onKeyDown, true);
    clearDragHandles();
    hideAddStrips();
  };
}

export function clearDragHandles(): void {
  handleOverlays.forEach(el => el.remove());
  handleOverlays = [];
  activeTableEl = null;
  activeTablePos = -1;
  activeShape = '';
  document.body.classList.remove('td-handles-visible');
}

// =============================================
// FINDING TABLES
// =============================================

/** The table around the cursor: its outer DOM element (the scroll wrapper) and position. */
function findCursorTable(editor: Editor): { dom: HTMLElement; pos: number } | null {
  const { view } = editor;
  const { $from } = view.state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name !== 'table') {continue;}
    const pos = $from.before(d);
    try {
      const dom = view.nodeDOM(pos);
      if (dom instanceof HTMLElement) {return { dom, pos };}
    } catch { /* the view is mid-update */ }
    return null;
  }
  return null;
}

/** The position of the table whose outer DOM element is `dom`, or -1. */
function tablePosForDom(editor: Editor, dom: HTMLElement): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) {return false;}
    if (node.type.name === 'table') {
      try {
        if (editor.view.nodeDOM(pos) === dom) {found = pos;}
      } catch { /* ignore */ }
      return false;
    }
    return true;
  });
  return found;
}

function headerCellsOf(tableEl: HTMLElement): Element[] {
  const headerRow = tableEl.querySelector('thead tr, tr:first-child');
  return headerRow ? Array.from(headerRow.querySelectorAll('th, td')) : [];
}

/** The box handles are fixed against: the scrolling wrapper, else the table. */
function frameOf(tableEl: HTMLElement): Box {
  const wrapper = tableEl.classList.contains('tableWrapper') ? tableEl : tableEl.closest<HTMLElement>('.tableWrapper');
  return (wrapper ?? tableEl).getBoundingClientRect();
}

// =============================================
// DRAG HANDLES
// =============================================

function shapeOf(tableEl: HTMLElement): string {
  return `${tableEl.querySelectorAll('tr').length}x${headerCellsOf(tableEl).length}`;
}

function updateDragHandles(editor: Editor): void {
  if (!editor.isActive('table')) {
    clearDragHandles();
    return;
  }
  const found = findCursorTable(editor);
  if (!found) {
    clearDragHandles();
    return;
  }

  activeTablePos = found.pos;
  // Same table, same number of rows and columns: only the geometry can have
  // changed (typing, a wrapped line), so move the handles instead of rebuilding.
  if (found.dom === activeTableEl && shapeOf(found.dom) === activeShape) {
    repositionHandles();
    return;
  }

  clearDragHandles();
  activeTableEl = found.dom;
  activeTablePos = found.pos;
  activeShape = shapeOf(found.dom);
  document.body.classList.add('td-handles-visible');

  // Row drag handles (left of each non-header row)
  const rows = Array.from(found.dom.querySelectorAll('tr'));
  rows.forEach((_row, rowIdx) => {
    // Skip header row (rowIdx === 0)
    if (rowIdx === 0) {return;}
    const handle = createDragHandle('row', rowIdx);
    getPortal().appendChild(handle);
    handleOverlays.push(handle);

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startDrag('row', rowIdx, activeTablePos);
    });
  });

  // Column drag handles (above each column of the header row)
  headerCellsOf(found.dom).forEach((_cell, colIdx) => {
    const handle = createDragHandle('col', colIdx);
    getPortal().appendChild(handle);
    handleOverlays.push(handle);

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startDrag('col', colIdx, activeTablePos);
    });
  });

  repositionHandles();
}

/**
 * Put every handle at its anchor's current viewport position. Called after
 * edits, scrolls (the page, the editor, or the table's own horizontal scroll)
 * and resizes. A handle whose row or column has scrolled out of view hides.
 */
function repositionHandles(): void {
  if (!activeTableEl) {return;}
  const rows = Array.from(activeTableEl.querySelectorAll('tr'));
  const headerCells = headerCellsOf(activeTableEl);
  const frame = frameOf(activeTableEl);
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  handleOverlays.forEach(handle => {
    const type = handle.classList.contains('td-handle-row') ? 'row' : 'col';
    const idx = parseInt(handle.dataset.index || '0', 10);
    const anchorEl = type === 'row' ? rows[idx] : headerCells[idx];
    if (!anchorEl) {
      handle.style.visibility = 'hidden';
      return;
    }
    const anchor = anchorEl.getBoundingClientRect();
    const pos = computeHandlePosition(type, anchor, frame);
    handle.style.top = `${pos.top}px`;
    handle.style.left = `${pos.left}px`;
    handle.style.visibility = isAnchorVisible(type, anchor, frame, vw, vh) ? '' : 'hidden';
  });
}

// Six dots: two columns of three for a row, three columns of two for a column.
const GRIP_ROW = '<svg viewBox="0 0 10 14" width="10" height="14" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/><circle cx="3" cy="7" r="1.3"/><circle cx="7" cy="7" r="1.3"/><circle cx="3" cy="11" r="1.3"/><circle cx="7" cy="11" r="1.3"/></svg>';
const GRIP_COL = '<svg viewBox="0 0 14 10" width="14" height="10" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/><circle cx="11" cy="3" r="1.3"/><circle cx="3" cy="7" r="1.3"/><circle cx="7" cy="7" r="1.3"/><circle cx="11" cy="7" r="1.3"/></svg>';

function createDragHandle(type: 'row' | 'col', index: number): HTMLElement {
  const handle = document.createElement('div');
  handle.className = `td-handle td-handle-${type}`;
  handle.dataset.index = String(index);
  handle.innerHTML = type === 'row' ? GRIP_ROW : GRIP_COL;
  handle.setAttribute('role', 'button');
  handle.setAttribute(
    'aria-label',
    type === 'row'
      ? `Drag to reorder row ${index} (or use Move Row Up and Down in the right-click menu)`
      : `Drag to reorder column ${index + 1} (or use Move Column Left and Right in the right-click menu)`
  );
  handle.title = type === 'row' ? `Drag to reorder row ${index}` : `Drag to reorder column ${index + 1}`;
  return handle;
}

function startDrag(type: 'row' | 'col', sourceIndex: number, tablePos: number): void {
  const overlay = document.createElement('div');
  overlay.className = 'td-drag-overlay';
  getPortal().appendChild(overlay);

  const dropLine = document.createElement('div');
  dropLine.className = `td-drop-line td-drop-line-${type}`;
  getPortal().appendChild(dropLine);

  dragState = { type, sourceIndex, currentIndex: sourceIndex, tablePos, overlayEl: overlay, dropLineEl: dropLine };
  document.body.classList.add('td-dragging');
}

function onDragMove(e: MouseEvent, _editor: Editor): void {
  if (!dragState || !activeTableEl) {return;}
  const { type } = dragState;

  if (type === 'row') {
    const rows = Array.from(activeTableEl.querySelectorAll('tr'));
    // currentIndex is an insertion point: before row i, or after the last row (rows.length).
    let targetIdx = rows.length;
    for (let i = 1; i < rows.length; i++) { // skip header
      const rect = rows[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) { targetIdx = i; break; }
    }
    dragState.currentIndex = Math.max(1, Math.min(rows.length, targetIdx));

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
    const cols = headerCellsOf(activeTableEl);
    if (cols.length === 0) {return;}
    let targetIdx = cols.length;
    for (let i = 0; i < cols.length; i++) {
      const rect = cols[i].getBoundingClientRect();
      if (e.clientX < rect.left + rect.width / 2) { targetIdx = i; break; }
    }
    dragState.currentIndex = Math.max(0, Math.min(cols.length, targetIdx));

    if (dragState.dropLineEl) {
      const atEnd = dragState.currentIndex >= cols.length;
      const rect = (atEnd ? cols[cols.length - 1] : cols[dragState.currentIndex]).getBoundingClientRect();
      dragState.dropLineEl.style.left = `${atEnd ? rect.right : rect.left}px`;
      dragState.dropLineEl.style.top = `${rect.top}px`;
      dragState.dropLineEl.style.height = `${activeTableEl.getBoundingClientRect().height}px`;
      dragState.dropLineEl.style.display = 'block';
    }
  }
}

function finalizeDrag(editor: Editor): void {
  if (!dragState) {return;}
  const { type, sourceIndex, currentIndex, overlayEl, dropLineEl } = dragState;
  dragState = null;
  document.body.classList.remove('td-dragging');
  overlayEl?.remove();
  dropLineEl?.remove();

  // Dropping on the row or column itself, or just after it, changes nothing.
  if (currentIndex === sourceIndex || currentIndex === sourceIndex + 1) {return;}

  // The table may have shifted since the drag began; find it again.
  const tablePos = activeTableEl ? tablePosForDom(editor, activeTableEl) : -1;
  if (tablePos < 0) {return;}
  const { state } = editor.view;
  const tableNode = state.doc.nodeAt(tablePos);
  if (!tableNode || tableNode.type.name !== 'table') {return;}

  const tr = state.tr;
  if (type === 'row') {
    reorderRows(tr, tableNode, tablePos, sourceIndex, currentIndex);
  } else {
    reorderColumns(tr, tableNode, tablePos, sourceIndex, currentIndex);
  }
  // One transaction, one undo. The handles are rebuilt by the editor's update event.
  editor.view.dispatch(tr);
}

// =============================================
// HOVER "+" STRIPS (add a column / a row at the end)
// =============================================

const PLUS_ICON = '<svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="7" y1="2.5" x2="7" y2="11.5"/><line x1="2.5" y1="7" x2="11.5" y2="7"/></svg>';

let addStrips: { col: HTMLElement; row: HTMLElement } | null = null;
/** The table (outer DOM element) the strips belong to: the one under the pointer. */
let addTableEl: HTMLElement | null = null;

function createAddStrip(kind: 'col' | 'row', editor: Editor): HTMLElement {
  const el = document.createElement('div');
  el.className = `td-add td-add-${kind}`;
  el.setAttribute('role', 'button');
  const label = kind === 'col' ? 'Add column at the end' : 'Add row at the end';
  el.setAttribute('aria-label', label);
  el.title = label;
  el.innerHTML = PLUS_ICON;
  // mousedown must not move the cursor or focus; the click does the work.
  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  el.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = addTableEl ? tablePosForDom(editor, addTableEl) : -1;
    if (pos < 0) {return;}
    if (kind === 'col') {appendColumn(editor, pos);} else {appendRow(editor, pos);}
  });
  return el;
}

function showAddStrips(editor: Editor, tableEl: HTMLElement): void {
  if (addTableEl === tableEl && addStrips) {
    positionAddStrips();
    return;
  }
  hideAddStrips();
  addTableEl = tableEl;
  addStrips = { col: createAddStrip('col', editor), row: createAddStrip('row', editor) };
  getPortal().appendChild(addStrips.col);
  getPortal().appendChild(addStrips.row);
  positionAddStrips();
}

export function hideAddStrips(): void {
  addStrips?.col.remove();
  addStrips?.row.remove();
  addStrips = null;
  addTableEl = null;
}

/** The "+" strips' boxes for a table element: [add column, add row], or null if it has no rows. */
function addStripBoxes(tableEl: HTMLElement): [Box, Box] | null {
  const rows = tableEl.querySelectorAll('tr');
  if (rows.length === 0) {return null;}
  const table = (tableEl.querySelector('table') ?? tableEl).getBoundingClientRect();
  const frame = frameOf(tableEl);
  // The table may be wider than its scrolling wrapper: the right edge shown is the wrapper's.
  const visibleTable: Box = { left: table.left, right: Math.min(table.right, frame.right), top: table.top, bottom: table.bottom };
  return [
    computeAddColumnStrip(visibleTable, rows[0].getBoundingClientRect()),
    computeAddRowStrip(visibleTable, rows[rows.length - 1].getBoundingClientRect()),
  ];
}

function positionAddStrips(): void {
  if (!addStrips || !addTableEl) {return;}
  if (!addTableEl.isConnected) {
    hideAddStrips();
    return;
  }
  const boxes = addStripBoxes(addTableEl);
  if (!boxes) {
    hideAddStrips();
    return;
  }
  const [colBox, rowBox] = boxes;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const place = (el: HTMLElement, box: Box, maxLeft: number): void => {
    el.style.left = `${Math.min(box.left, maxLeft)}px`;
    el.style.top = `${box.top}px`;
    el.style.width = `${box.right - box.left}px`;
    el.style.height = `${box.bottom - box.top}px`;
    el.style.visibility = boxIntersectsViewport(box, vw, vh) ? '' : 'hidden';
  };
  place(addStrips.col, colBox, vw - ADD_STRIP_SIZE - 2);
  place(addStrips.row, rowBox, Number.POSITIVE_INFINITY);
}

/** Pointer moved: show the strips over a table (or near its edge), hide them elsewhere. */
function onPointerMoveForStrips(e: MouseEvent, editor: Editor, sourceMode: boolean): void {
  if (sourceMode || !editor.isEditable) {
    hideAddStrips();
    return;
  }
  const target = e.target instanceof Element ? e.target : null;
  if (target?.closest('.td-add')) {return;}

  const inEditor = target && editor.view.dom.contains(target);
  const hit = inEditor ? target.closest('table') : null;
  if (hit) {
    // ProseMirror's node for the table is the <table>, or the scroll wrapper around it.
    const outer = hit.closest<HTMLElement>('.tableWrapper') ?? hit;
    if (outer.isConnected) {
      showAddStrips(editor, outer);
      return;
    }
  }
  // Off the table: keep the strips while the pointer is on its way to one.
  if (addTableEl && addTableEl.isConnected) {
    const near: Box = addTableEl.getBoundingClientRect();
    if (isPointerNearBox(e.clientX, e.clientY, near)) {return;}
  }
  hideAddStrips();
}
