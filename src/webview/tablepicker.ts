import { Editor } from '@tiptap/core';

// ================================================================
// TABLE GRID PICKER
// ================================================================

let pickerEl: HTMLElement | null = null;
let pickerHoverRows = 1;
let pickerHoverCols = 1;
const PICKER_ROWS = 8;
const PICKER_COLS = 10;

export function showTableGridPicker(
  editor: Editor,
  anchorEl: HTMLElement
): void {
  hideTableGridPicker();

  pickerEl = document.createElement('div');
  pickerEl.id = 'mikedown-table-picker';
  pickerEl.setAttribute('role', 'dialog');
  pickerEl.setAttribute('aria-label', 'Insert table');

  // Grid
  const grid = document.createElement('div');
  grid.className = 'tp-grid';
  grid.style.gridTemplateColumns = `repeat(${PICKER_COLS}, 1fr)`;

  for (let r = 1; r <= PICKER_ROWS; r++) {
    for (let c = 1; c <= PICKER_COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'tp-cell';
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      cell.addEventListener('mouseenter', () => {
        pickerHoverRows = r;
        pickerHoverCols = c;
        updateGridHighlight();
      });
      cell.addEventListener('mousedown', (e) => {
        e.preventDefault();
        hideTableGridPicker();
        editor.chain().focus().insertTable({
          rows: r,
          cols: c,
          withHeaderRow: true,
        }).run();
      });
      grid.appendChild(cell);
    }
  }

  // Dimension label
  const label = document.createElement('div');
  label.className = 'tp-label';
  label.id = 'tp-dimension-label';
  label.textContent = '1 × 1';

  // Manual input row
  const manualRow = document.createElement('div');
  manualRow.className = 'tp-manual';

  const rowInput = document.createElement('input');
  rowInput.type = 'number';
  rowInput.min = '1';
  rowInput.max = '50';
  rowInput.value = '3';
  rowInput.placeholder = 'Rows';
  rowInput.className = 'tp-input';
  rowInput.setAttribute('aria-label', 'Number of rows');

  const colInput = document.createElement('input');
  colInput.type = 'number';
  colInput.min = '1';
  colInput.max = '20';
  colInput.value = '3';
  colInput.placeholder = 'Cols';
  colInput.className = 'tp-input';
  colInput.setAttribute('aria-label', 'Number of columns');

  const okBtn = document.createElement('button');
  okBtn.textContent = 'OK';
  okBtn.className = 'tp-ok';
  okBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const r2 = Math.max(1, Math.min(50, parseInt(rowInput.value || '3', 10) || 3));
    const c2 = Math.max(1, Math.min(20, parseInt(colInput.value || '3', 10) || 3));
    hideTableGridPicker();
    editor.chain().focus().insertTable({
      rows: r2,
      cols: c2,
      withHeaderRow: true,
    }).run();
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
  document.body.appendChild(pickerEl);

  // Position below anchor
  const rect = anchorEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pickerRect = pickerEl.getBoundingClientRect();
  let left = rect.left;
  let top = rect.bottom + 4;
  if (left + pickerRect.width > vw - 8) left = vw - pickerRect.width - 8;
  if (top + pickerRect.height > vh - 8) top = rect.top - pickerRect.height - 4;
  pickerEl.style.left = `${Math.max(4, left)}px`;
  pickerEl.style.top = `${Math.max(4, top)}px`;

  pickerHoverRows = 1;
  pickerHoverCols = 1;
  updateGridHighlight();

  // Keyboard support
  pickerEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideTableGridPicker();
    if (e.key === 'Enter' && document.activeElement !== rowInput && document.activeElement !== colInput) {
      hideTableGridPicker();
      editor.chain().focus().insertTable({
        rows: pickerHoverRows,
        cols: pickerHoverCols,
        withHeaderRow: true,
      }).run();
    }
  });
}

function updateGridHighlight(): void {
  if (!pickerEl) return;
  const label = pickerEl.querySelector('#tp-dimension-label');
  if (label) label.textContent = `${pickerHoverRows} × ${pickerHoverCols}`;
  pickerEl.querySelectorAll('.tp-cell').forEach(cell => {
    const r = parseInt((cell as HTMLElement).dataset.row || '0', 10);
    const c = parseInt((cell as HTMLElement).dataset.col || '0', 10);
    cell.classList.toggle('tp-active', r <= pickerHoverRows && c <= pickerHoverCols);
  });
}

export function hideTableGridPicker(): void {
  if (pickerEl) {
    pickerEl.remove();
    pickerEl = null;
  }
}

// ================================================================
// TABLE CONTEXTUAL TOOLBAR
// ================================================================

let tableToolbarEl: HTMLElement | null = null;

interface TableToolbarButton {
  label: string;
  title: string;
  action: () => void;
  isActive?: () => boolean;
  isDisabled?: () => boolean;
}

export function showTableToolbar(editor: Editor, tableEl: HTMLElement): void {
  hideTableToolbar();

  tableToolbarEl = document.createElement('div');
  tableToolbarEl.id = 'mikedown-table-toolbar';
  tableToolbarEl.setAttribute('role', 'toolbar');
  tableToolbarEl.setAttribute('aria-label', 'Table toolbar');

  const buttons: TableToolbarButton[] = [
    {
      label: '↑+', title: 'Insert Row Above',
      action: () => editor.chain().focus().addRowBefore().run(),
    },
    {
      label: '↓+', title: 'Insert Row Below',
      action: () => editor.chain().focus().addRowAfter().run(),
    },
    {
      label: '↓−', title: 'Remove Row',
      action: () => editor.chain().focus().deleteRow().run(),
      isDisabled: () => !editor.can().deleteRow(),
    },
    { label: '|', title: '', action: () => {} }, // separator
    {
      label: '←+', title: 'Insert Column Left',
      action: () => editor.chain().focus().addColumnBefore().run(),
    },
    {
      label: '+→', title: 'Insert Column Right',
      action: () => editor.chain().focus().addColumnAfter().run(),
    },
    {
      label: '−|', title: 'Remove Column',
      action: () => editor.chain().focus().deleteColumn().run(),
      isDisabled: () => !editor.can().deleteColumn(),
    },
    { label: '|', title: '', action: () => {} }, // separator
    {
      label: '⬛L', title: 'Align Left',
      action: () => editor.chain().focus().setCellAttribute('textAlign', 'left').run(),
      isActive: () => false, // alignment detection is complex; skip active state for now
    },
    {
      label: '⬛C', title: 'Align Center',
      action: () => editor.chain().focus().setCellAttribute('textAlign', 'center').run(),
    },
    {
      label: '⬛R', title: 'Align Right',
      action: () => editor.chain().focus().setCellAttribute('textAlign', 'right').run(),
    },
    { label: '|', title: '', action: () => {} }, // separator
    {
      label: '🗑', title: 'Delete Table',
      action: () => {
        if (window.confirm('Delete this table?')) {
          editor.chain().focus().deleteTable().run();
        }
      },
    },
  ];

  buttons.forEach(btn => {
    if (btn.label === '|' && !btn.title) {
      const sep = document.createElement('div');
      sep.className = 'tt-sep';
      tableToolbarEl!.appendChild(sep);
      return;
    }
    const el = document.createElement('button');
    el.className = 'tt-btn';
    el.textContent = btn.label;
    el.title = btn.title;
    if (btn.isDisabled?.()) el.disabled = true;
    if (btn.isActive?.()) el.classList.add('tt-active');
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      btn.action();
    });
    tableToolbarEl!.appendChild(el);
  });

  document.body.appendChild(tableToolbarEl);
  positionTableToolbar(tableEl);
}

function positionTableToolbar(tableEl: HTMLElement): void {
  if (!tableToolbarEl) return;
  const rect = tableEl.getBoundingClientRect();
  const tbRect = tableToolbarEl.getBoundingClientRect();
  const vw = window.innerWidth;

  let left = rect.left;
  let top = rect.top - tbRect.height - 6;
  if (top < 4) top = rect.bottom + 6;
  if (left + tbRect.width > vw - 8) left = vw - tbRect.width - 8;
  tableToolbarEl.style.left = `${Math.max(4, left)}px`;
  tableToolbarEl.style.top = `${Math.max(4, top)}px`;
}

export function hideTableToolbar(): void {
  if (tableToolbarEl) {
    tableToolbarEl.remove();
    tableToolbarEl = null;
  }
}

export function updateTableToolbar(editor: Editor): void {
  // Called on editor selectionUpdate — show/hide the toolbar depending on whether
  // the cursor is in a table, and update disabled state of buttons.
  const isInTable = editor.isActive('table');
  if (!isInTable) {
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
      positionTableToolbar(tableNode);
    }
  }
}
