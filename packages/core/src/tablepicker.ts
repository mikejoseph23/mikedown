import { Editor } from '@tiptap/core';
import { setColumnAlign, getColumnAlign } from './table-align';
import { getPortal } from './portal';
import { boxIntersectsViewport, computeToolbarPosition, type Box } from './table-geometry';

// ================================================================
// TABLE GRID PICKER
// ================================================================

let pickerEl: HTMLElement | null = null;
let pickerHoverRows = 3;
let pickerHoverCols = 3;
const PICKER_ROWS = 8;
const PICKER_COLS = 10;
/** The size the grid starts on, and the manual inputs' default. */
const PICKER_DEFAULT = 3;

/**
 * The grid size after an arrow key, kept inside the grid (1 up to `maxRows` by
 * `maxCols`). Null for any other key. Home and End jump to the first and last
 * column, so a keyboard user never needs more than a few presses.
 */
export function moveGridSize(
  rows: number,
  cols: number,
  key: string,
  maxRows: number = PICKER_ROWS,
  maxCols: number = PICKER_COLS
): { rows: number; cols: number } | null {
  const clampTo = (n: number, max: number): number => Math.max(1, Math.min(max, n));
  switch (key) {
    case 'ArrowUp': return { rows: clampTo(rows - 1, maxRows), cols };
    case 'ArrowDown': return { rows: clampTo(rows + 1, maxRows), cols };
    case 'ArrowLeft': return { rows, cols: clampTo(cols - 1, maxCols) };
    case 'ArrowRight': return { rows, cols: clampTo(cols + 1, maxCols) };
    case 'Home': return { rows, cols: 1 };
    case 'End': return { rows, cols: maxCols };
    default: return null;
  }
}

interface AnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface TableGridPickerOptions {
  /** Overrides the default `insertTable` when set (the slash `/table`
   *  command uses this to remove `/query` and insert the table in one
   *  action, rather than inserting at whatever the selection happens to be). */
  onInsert?: (rows: number, cols: number) => void;
  /** Fires when the picker closes WITHOUT a table having been committed
   *  (Escape or click-away) — never after a real commit. */
  onClosed?: () => void;
}

let pendingOpts: TableGridPickerOptions | undefined;
let gridPickerCommitted = false;

function commitTable(editor: Editor, rows: number, cols: number, opts: TableGridPickerOptions | undefined): void {
  gridPickerCommitted = true;
  if (opts?.onInsert) {
    opts.onInsert(rows, cols);
  } else {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
  }
}

export function showTableGridPicker(
  editor: Editor,
  anchor: HTMLElement | AnchorRect,
  opts?: TableGridPickerOptions
): void {
  hideTableGridPicker();
  pendingOpts = opts;
  gridPickerCommitted = false;

  pickerEl = document.createElement('div');
  pickerEl.id = 'mikedown-table-picker';
  pickerEl.setAttribute('role', 'dialog');
  pickerEl.setAttribute('aria-label', 'Insert table');

  // Grid. Focusable, so the arrow keys pick the size; the cells are for the mouse.
  const grid = document.createElement('div');
  grid.className = 'tp-grid';
  grid.tabIndex = 0;
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Table size: arrow keys change it, Enter inserts');
  grid.setAttribute('aria-describedby', 'tp-dimension-label');
  grid.style.gridTemplateColumns = `repeat(${PICKER_COLS}, 1fr)`;

  for (let r = 1; r <= PICKER_ROWS; r++) {
    for (let c = 1; c <= PICKER_COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'tp-cell';
      cell.setAttribute('aria-hidden', 'true');
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      cell.addEventListener('mouseenter', () => {
        pickerHoverRows = r;
        pickerHoverCols = c;
        updateGridHighlight();
      });
      cell.addEventListener('mousedown', (e) => {
        e.preventDefault();
        commitTable(editor, r, c, opts);
        hideTableGridPicker();
      });
      grid.appendChild(cell);
    }
  }

  // Dimension label
  const label = document.createElement('div');
  label.className = 'tp-label';
  label.id = 'tp-dimension-label';
  // Announced as the size changes; "rows by columns" reads better than the symbol.
  label.setAttribute('aria-live', 'polite');
  label.textContent = `${PICKER_DEFAULT} × ${PICKER_DEFAULT}`;

  // Manual input row
  const manualRow = document.createElement('div');
  manualRow.className = 'tp-manual';

  const rowInput = document.createElement('input');
  rowInput.type = 'number';
  rowInput.min = '1';
  rowInput.max = '50';
  rowInput.value = String(PICKER_DEFAULT);
  rowInput.placeholder = 'Rows';
  rowInput.className = 'tp-input';
  rowInput.setAttribute('aria-label', 'Number of rows');

  const colInput = document.createElement('input');
  colInput.type = 'number';
  colInput.min = '1';
  colInput.max = '20';
  colInput.value = String(PICKER_DEFAULT);
  colInput.placeholder = 'Cols';
  colInput.className = 'tp-input';
  colInput.setAttribute('aria-label', 'Number of columns');

  const commitManual = (): void => {
    const r2 = Math.max(1, Math.min(50, parseInt(rowInput.value || String(PICKER_DEFAULT), 10) || PICKER_DEFAULT));
    const c2 = Math.max(1, Math.min(20, parseInt(colInput.value || String(PICKER_DEFAULT), 10) || PICKER_DEFAULT));
    commitTable(editor, r2, c2, opts);
    hideTableGridPicker();
  };

  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.textContent = 'OK';
  okBtn.className = 'tp-ok';
  // The click does the work so Enter and Space on the focused button do too.
  okBtn.addEventListener('mousedown', (e) => e.preventDefault());
  okBtn.addEventListener('click', (e) => {
    e.preventDefault();
    commitManual();
  });

  manualRow.appendChild(rowInput);
  const sep = document.createElement('span');
  sep.textContent = '×';
  sep.className = 'tp-sep';
  manualRow.appendChild(sep);
  manualRow.appendChild(colInput);
  manualRow.appendChild(okBtn);

  pickerEl.appendChild(grid);
  pickerEl.appendChild(label);
  pickerEl.appendChild(manualRow);
  getPortal().appendChild(pickerEl);

  // Position below anchor
  const rect = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pickerRect = pickerEl.getBoundingClientRect();
  let left = rect.left;
  let top = rect.bottom + 4;
  if (left + pickerRect.width > vw - 8) {left = vw - pickerRect.width - 8;}
  if (top + pickerRect.height > vh - 8) {top = rect.top - pickerRect.height - 4;}
  pickerEl.style.left = `${Math.max(4, left)}px`;
  pickerEl.style.top = `${Math.max(4, top)}px`;

  pickerHoverRows = PICKER_DEFAULT;
  pickerHoverCols = PICKER_DEFAULT;
  updateGridHighlight();

  // Keyboard: arrows size the grid, Enter inserts, Escape closes and puts the
  // cursor back where it was, Tab walks grid > rows > columns > OK and wraps.
  const tabStops: HTMLElement[] = [grid, rowInput, colInput, okBtn];
  pickerEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hideTableGridPicker();
      if (!editor.isDestroyed) {editor.chain().focus().run();}
      return;
    }
    const target = e.target as HTMLElement;
    if (e.key === 'Tab') {
      // Wrap at the ends so Tab never leaves the picker; the order between is the browser's own.
      const at = tabStops.indexOf(target);
      if (e.shiftKey && at === 0) {
        e.preventDefault();
        tabStops[tabStops.length - 1].focus();
      } else if (!e.shiftKey && at === tabStops.length - 1) {
        e.preventDefault();
        tabStops[0].focus();
      }
      return;
    }
    if (target === grid) {
      const moved = moveGridSize(pickerHoverRows, pickerHoverCols, e.key);
      if (moved) {
        e.preventDefault();
        pickerHoverRows = moved.rows;
        pickerHoverCols = moved.cols;
        updateGridHighlight();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        commitTable(editor, pickerHoverRows, pickerHoverCols, opts);
        hideTableGridPicker();
      }
      return;
    }
    if (e.key === 'Enter' && (target === rowInput || target === colInput)) {
      e.preventDefault();
      commitManual();
    }
  });

  grid.focus({ preventScroll: true });
}

function updateGridHighlight(): void {
  if (!pickerEl) {return;}
  const label = pickerEl.querySelector('#tp-dimension-label');
  if (label) {label.textContent = `${pickerHoverRows} × ${pickerHoverCols}`;}
  pickerEl.querySelectorAll('.tp-cell').forEach(cell => {
    const r = parseInt((cell as HTMLElement).dataset.row || '0', 10);
    const c = parseInt((cell as HTMLElement).dataset.col || '0', 10);
    cell.classList.toggle('tp-active', r <= pickerHoverRows && c <= pickerHoverCols);
  });
}

export function hideTableGridPicker(): void {
  const wasOpen = pickerEl !== null;
  if (pickerEl) {
    pickerEl.remove();
    pickerEl = null;
  }
  const opts = pendingOpts;
  const committed = gridPickerCommitted;
  pendingOpts = undefined;
  gridPickerCommitted = false;
  if (wasOpen && !committed) {
    opts?.onClosed?.();
  }
}

// ================================================================
// TABLE CONTEXTUAL TOOLBAR
// ================================================================

let tableToolbarEl: HTMLElement | null = null;
let tableToolbarAnchor: HTMLElement | null = null;
let tableToolbarEditor: Editor | null = null;
let tableToolbarScrollHandler: (() => void) | null = null;
let tableTooltipEl: HTMLElement | null = null;

interface TableToolbarButton {
  label: string;
  title: string;
  action: () => void;
  isActive?: () => boolean;
  isDisabled?: () => boolean;
}

// Live button registry so updateTableToolbar() can refresh active/disabled
// state as the selection moves between columns without rebuilding the toolbar.
let toolbarButtons: Array<{ el: HTMLButtonElement; def: TableToolbarButton }> = [];

function showTableTooltip(anchor: HTMLElement, text: string): void {
  if (!text) {return;}
  if (!tableTooltipEl) {
    tableTooltipEl = document.createElement('div');
    tableTooltipEl.id = 'mikedown-table-tooltip';
    getPortal().appendChild(tableTooltipEl);
  }
  tableTooltipEl.textContent = text;
  tableTooltipEl.style.visibility = 'hidden';
  tableTooltipEl.style.display = 'block';
  const a = anchor.getBoundingClientRect();
  const t = tableTooltipEl.getBoundingClientRect();
  let left = a.left + a.width / 2 - t.width / 2;
  left = Math.max(4, Math.min(left, window.innerWidth - t.width - 4));
  tableTooltipEl.style.left = `${left}px`;
  tableTooltipEl.style.top = `${a.bottom + 6}px`;
  tableTooltipEl.style.visibility = 'visible';
}

function hideTableTooltip(): void {
  if (tableTooltipEl) {tableTooltipEl.style.display = 'none';}
}

export function showTableToolbar(editor: Editor, tableEl: HTMLElement): void {
  hideTableToolbar();

  tableToolbarEl = document.createElement('div');
  tableToolbarEl.id = 'mikedown-table-toolbar';
  tableToolbarEl.setAttribute('role', 'toolbar');
  tableToolbarEl.setAttribute('aria-label', 'Table toolbar');

  // SVG icons for the table toolbar (drawn on a 14×14 grid, scaled up via CSS).
  const tsvg = (d: string) => `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const tIcons = {
    rowAbove: tsvg('<rect x="1" y="4" width="12" height="9" rx="1"/><line x1="1" y1="8" x2="13" y2="8"/><line x1="7" y1="4" x2="7" y2="8"/><line x1="7" y1="0.5" x2="7" y2="3"/><line x1="5.5" y1="1.5" x2="7" y2="0.5"/><line x1="8.5" y1="1.5" x2="7" y2="0.5"/>'),
    rowBelow: tsvg('<rect x="1" y="1" width="12" height="9" rx="1"/><line x1="1" y1="5.5" x2="13" y2="5.5"/><line x1="7" y1="5.5" x2="7" y2="10"/><line x1="7" y1="10.5" x2="7" y2="13.5"/><line x1="5.5" y1="12.5" x2="7" y2="13.5"/><line x1="8.5" y1="12.5" x2="7" y2="13.5"/>'),
    rowDel: tsvg('<rect x="1" y="3" width="12" height="8" rx="1"/><line x1="1" y1="7" x2="13" y2="7"/><line x1="3" y1="5" x2="11" y2="5" stroke="var(--mikedown-danger,#f44747)"/>'),
    colLeft: tsvg('<rect x="4" y="1" width="9" height="12" rx="1"/><line x1="8" y1="1" x2="8" y2="13"/><line x1="4" y1="7" x2="8" y2="7"/><line x1="0.5" y1="7" x2="3" y2="7"/><line x1="1.5" y1="5.5" x2="0.5" y2="7"/><line x1="1.5" y1="8.5" x2="0.5" y2="7"/>'),
    colRight: tsvg('<rect x="1" y="1" width="9" height="12" rx="1"/><line x1="5.5" y1="1" x2="5.5" y2="13"/><line x1="5.5" y1="7" x2="10" y2="7"/><line x1="10.5" y1="7" x2="13.5" y2="7"/><line x1="12.5" y1="5.5" x2="13.5" y2="7"/><line x1="12.5" y1="8.5" x2="13.5" y2="7"/>'),
    colDel: tsvg('<rect x="3" y="1" width="8" height="12" rx="1"/><line x1="7" y1="1" x2="7" y2="13"/><line x1="5" y1="3" x2="5" y2="11" stroke="var(--mikedown-danger,#f44747)"/>'),
    alignL: tsvg('<line x1="2" y1="3" x2="12" y2="3"/><line x1="2" y1="6.5" x2="9" y2="6.5"/><line x1="2" y1="10" x2="12" y2="10"/>'),
    alignC: tsvg('<line x1="2" y1="3" x2="12" y2="3"/><line x1="3.5" y1="6.5" x2="10.5" y2="6.5"/><line x1="2" y1="10" x2="12" y2="10"/>'),
    alignR: tsvg('<line x1="2" y1="3" x2="12" y2="3"/><line x1="5" y1="6.5" x2="12" y2="6.5"/><line x1="2" y1="10" x2="12" y2="10"/>'),
    trash: tsvg('<polyline points="2 4 3 12 11 12 12 4"/><line x1="1" y1="4" x2="13" y2="4"/><path d="M5 4V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V4"/>'),
  };

  const buttons: TableToolbarButton[] = [
    {
      label: tIcons.rowAbove, title: 'Insert row above',
      action: () => editor.chain().focus().addRowBefore().run(),
    },
    {
      label: tIcons.rowBelow, title: 'Insert row below',
      action: () => editor.chain().focus().addRowAfter().run(),
    },
    {
      label: tIcons.rowDel, title: 'Delete row',
      action: () => editor.chain().focus().deleteRow().run(),
      isDisabled: () => !editor.can().deleteRow(),
    },
    { label: '|', title: '', action: () => {} }, // separator
    {
      label: tIcons.colLeft, title: 'Insert column left',
      action: () => editor.chain().focus().addColumnBefore().run(),
    },
    {
      label: tIcons.colRight, title: 'Insert column right',
      action: () => editor.chain().focus().addColumnAfter().run(),
    },
    {
      label: tIcons.colDel, title: 'Delete column',
      action: () => editor.chain().focus().deleteColumn().run(),
      isDisabled: () => !editor.can().deleteColumn(),
    },
    { label: '|', title: '', action: () => {} }, // separator
    {
      label: tIcons.alignL, title: 'Align column left',
      action: () => setColumnAlign(editor, 'left'),
      isActive: () => {
        const a = getColumnAlign(editor);
        return a === 'left' || a == null;
      },
    },
    {
      label: tIcons.alignC, title: 'Align column center',
      action: () => setColumnAlign(editor, 'center'),
      isActive: () => getColumnAlign(editor) === 'center',
    },
    {
      label: tIcons.alignR, title: 'Align column right',
      action: () => setColumnAlign(editor, 'right'),
      isActive: () => getColumnAlign(editor) === 'right',
    },
    { label: '|', title: '', action: () => {} }, // separator
    {
      label: tIcons.trash, title: 'Delete table',
      action: () => editor.chain().focus().deleteTable().run(),
    },
  ];

  toolbarButtons = [];
  buttons.forEach(btn => {
    if (btn.label === '|' && !btn.title) {
      const sep = document.createElement('div');
      sep.className = 'tt-sep';
      tableToolbarEl!.appendChild(sep);
      return;
    }
    const el = document.createElement('button');
    el.className = 'tt-btn';
    el.innerHTML = btn.label;
    el.setAttribute('aria-label', btn.title);
    if (btn.isDisabled?.()) {el.disabled = true;}
    if (btn.isActive?.()) {el.classList.add('tt-active');}
    el.type = 'button';
    // mousedown keeps focus (and the cell cursor) in the editor; the action
    // runs on click so Enter and Space work on a focused button too.
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => {
      e.preventDefault();
      btn.action();
      refreshTableToolbarStates(editor);
    });
    el.addEventListener('mouseenter', () => showTableTooltip(el, btn.title));
    el.addEventListener('mouseleave', hideTableTooltip);
    toolbarButtons.push({ el, def: btn });
    tableToolbarEl!.appendChild(el);
  });

  getPortal().appendChild(tableToolbarEl);
  tableToolbarAnchor = tableEl;
  tableToolbarEditor = editor;
  positionTableToolbar(tableEl);

  // Reposition (or hide) on scroll/resize so the toolbar stays anchored to the
  // table instead of floating in the viewport while the user scrolls. It stays
  // while any part of the table shows: on a table taller than the window it
  // moves to the cursor's row.
  tableToolbarScrollHandler = () => {
    if (!tableToolbarAnchor) {return;}
    const rect = tableToolbarAnchor.getBoundingClientRect();
    if (!boxIntersectsViewport(rect, window.innerWidth, window.innerHeight)) {
      if (tableToolbarEl) {tableToolbarEl.style.visibility = 'hidden';}
    } else {
      if (tableToolbarEl) {tableToolbarEl.style.visibility = '';}
      positionTableToolbar(tableToolbarAnchor);
    }
  };
  window.addEventListener('scroll', tableToolbarScrollHandler, true);
  window.addEventListener('resize', tableToolbarScrollHandler);
}

/** The viewport box of the table row the cursor is in, or null. */
function cursorRowBox(editor: Editor): Box | null {
  try {
    const { $from } = editor.state.selection;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name !== 'tableRow') {continue;}
      const dom = editor.view.nodeDOM($from.before(d));
      if (dom instanceof HTMLElement) {return dom.getBoundingClientRect();}
      return null;
    }
  } catch {
    // The view is mid-update; the table box alone is enough.
  }
  return null;
}

function positionTableToolbar(tableEl: HTMLElement): void {
  if (!tableToolbarEl) {return;}
  const tbRect = tableToolbarEl.getBoundingClientRect();
  const pos = computeToolbarPosition({
    table: tableEl.getBoundingClientRect(),
    row: tableToolbarEditor ? cursorRowBox(tableToolbarEditor) : null,
    toolbar: { width: tbRect.width, height: tbRect.height },
    viewport: { width: window.innerWidth, height: window.innerHeight },
  });
  tableToolbarEl.style.left = `${pos.left}px`;
  tableToolbarEl.style.top = `${pos.top}px`;
}

export function hideTableToolbar(): void {
  if (tableToolbarScrollHandler) {
    window.removeEventListener('scroll', tableToolbarScrollHandler, true);
    window.removeEventListener('resize', tableToolbarScrollHandler);
    tableToolbarScrollHandler = null;
  }
  tableToolbarAnchor = null;
  tableToolbarEditor = null;
  hideTableTooltip();
  toolbarButtons = [];
  if (tableToolbarEl) {
    tableToolbarEl.remove();
    tableToolbarEl = null;
  }
}

// Re-evaluate active/disabled state for every button (e.g. alignment highlight
// when the cursor moves to a different column).
function refreshTableToolbarStates(_editor: Editor): void {
  toolbarButtons.forEach(({ el, def }) => {
    el.disabled = def.isDisabled?.() ?? false;
    el.classList.toggle('tt-active', def.isActive?.() ?? false);
  });
}

export function updateTableToolbar(editor: Editor): void {
  // Called on editor selectionUpdate — show/hide the toolbar depending on whether
  // the cursor is in a table, and update disabled state of buttons.
  const isInTable = editor.isActive('table');
  // Only while the user is working in the table: a document that ends with a
  // table leaves the cursor there on load, before anyone has focused it.
  const focusedHere = editor.view.hasFocus()
    || !!document.activeElement?.closest('#mikedown-table-toolbar');
  if (!isInTable || !focusedHere) {
    hideTableToolbar();
    return;
  }
  // Find the DOM table element at the cursor
  const { view } = editor;
  const { $from } = view.state.selection;
  let tableNode: HTMLElement | null = null;
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'table') {
      try {
        tableNode = view.nodeDOM($from.before(d)) as HTMLElement;
      } catch {
        // ignore
      }
      break;
    }
  }

  if (tableNode) {
    if (!tableToolbarEl) {
      showTableToolbar(editor, tableNode);
    } else {
      tableToolbarAnchor = tableNode;
      positionTableToolbar(tableNode);
      refreshTableToolbarStates(editor);
    }
  }
}
