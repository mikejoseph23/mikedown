/**
 * Table discoverability and accessibility in the full editor: the keyboard
 * table picker, the drag handles, Move Row/Column in the right-click menu, and
 * the hover "+" strips.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import { createMikeDownEditor, type MikeDownEditorHandle } from '../src/index';
import { buildTableMenu, type ContextMenuEntry, type ContextMenuItem } from '../src/contextmenu';
import { showTableGridPicker } from '../src/tablepicker';
import { canMove, moveInTable } from '../src/table-structure';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

afterEach(() => {
  for (const { handle, el } of mounted.splice(0)) {
    handle.destroy();
    el.remove();
  }
  document.querySelectorAll('.mikedown-portal').forEach(p => p.remove());
  vi.restoreAllMocks();
});

function mount(markdown: string): MikeDownEditorHandle {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host: { onChange() {} }, initialMarkdown: markdown });
  mounted.push({ handle, el });
  return handle;
}

const TABLE = '| A | B | C |\n| --- | --- | --- |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n| a3 | b3 | c3 |\n';

function cellTextPos(h: MikeDownEditorHandle, n: number, offset = 0): number {
  let i = 0;
  let found = -1;
  h.tiptap.state.doc.descendants((node, pos) => {
    if (found >= 0) {return false;}
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      if (i === n) {found = pos + 2 + offset;}
      i++;
      return false;
    }
    return true;
  });
  return found;
}

function placeCursor(h: MikeDownEditorHandle, pos: number): void {
  const { view } = h.tiptap;
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
}

/** Cursor in the cell at (row, col) of the 3 x 3 + header test table. */
function cursorIn(h: MikeDownEditorHandle, row: number, col: number, offset = 0): void {
  placeCursor(h, cellTextPos(h, row * 3 + col, offset));
}

const picker = () => document.getElementById('mikedown-table-picker');
const key = (target: Element, k: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
};

function tableShape(h: MikeDownEditorHandle): { rows: number; cols: number } {
  let shape = { rows: 0, cols: 0 };
  h.tiptap.state.doc.descendants((node) => {
    if (node.type.name === 'table') {
      shape = { rows: node.childCount, cols: node.firstChild?.childCount ?? 0 };
      return false;
    }
    return true;
  });
  return shape;
}

function bodyRows(h: MikeDownEditorHandle): string[] {
  const rows = h.getMarkdown().trim().split('\n').filter(l => l.startsWith('|'));
  return rows.map(r => r.split('|').slice(1, -1).map(c => c.trim()).join(','));
}

// ── 7. Keyboard-usable table picker ─────────────────────────────────────────

describe('Table picker from the keyboard', () => {
  function openPicker(h: MikeDownEditorHandle, opts?: Parameters<typeof showTableGridPicker>[2]): HTMLElement {
    showTableGridPicker(h.tiptap, { left: 10, right: 20, top: 10, bottom: 20 }, opts);
    return picker()!;
  }

  it('focuses the grid when it opens', () => {
    const h = mount('Hello\n');
    const p = openPicker(h);
    expect(document.activeElement).toBe(p.querySelector('.tp-grid'));
  });

  it('announces its size: a labelled dialog with a live size text', () => {
    const h = mount('Hello\n');
    const p = openPicker(h);
    expect(p.getAttribute('role')).toBe('dialog');
    expect(p.getAttribute('aria-label')).toBe('Insert table');
    const label = p.querySelector('#tp-dimension-label')!;
    expect(label.getAttribute('aria-live')).toBe('polite');
    expect(label.textContent).toBe('3 × 3');
    expect(p.querySelector('.tp-grid')!.getAttribute('aria-describedby')).toBe('tp-dimension-label');
  });

  it('arrow keys move the highlighted size and stay inside the grid', () => {
    const h = mount('Hello\n');
    const p = openPicker(h);
    const grid = p.querySelector('.tp-grid')!;
    const label = p.querySelector('#tp-dimension-label')!;
    key(grid, 'ArrowRight');
    key(grid, 'ArrowDown');
    expect(label.textContent).toBe('4 × 4');
    expect(p.querySelectorAll('.tp-cell.tp-active').length).toBe(16);
    for (let i = 0; i < 20; i++) {key(grid, 'ArrowUp'); key(grid, 'ArrowLeft');}
    expect(label.textContent).toBe('1 × 1');
    for (let i = 0; i < 20; i++) {key(grid, 'ArrowDown'); key(grid, 'ArrowRight');}
    expect(label.textContent).toBe('8 × 10');
  });

  it('Enter inserts a table of the highlighted size and closes the picker', () => {
    const h = mount('Hello\n');
    placeCursor(h, 6);
    const p = openPicker(h);
    const grid = p.querySelector('.tp-grid')!;
    key(grid, 'ArrowDown'); // 4 rows
    key(grid, 'ArrowLeft'); // 2 columns
    key(grid, 'Enter');
    expect(picker()).toBeNull();
    expect(tableShape(h)).toEqual({ rows: 4, cols: 2 });
  });

  it('Escape closes the picker and returns focus to the editor at the original cursor', async () => {
    const h = mount('Hello world\n');
    placeCursor(h, 4);
    const p = openPicker(h);
    expect(h.tiptap.view.hasFocus()).toBe(false);
    key(p.querySelector('.tp-grid')!, 'Escape');
    expect(picker()).toBeNull();
    await new Promise(r => setTimeout(r, 50)); // TipTap focuses on the next frame
    expect(h.tiptap.view.hasFocus()).toBe(true);
    expect(h.tiptap.state.selection.from).toBe(4);
    expect(tableShape(h)).toEqual({ rows: 0, cols: 0 });
  });

  it('Escape reports a close without a commit', () => {
    const h = mount('Hello\n');
    const onClosed = vi.fn();
    const onInsert = vi.fn();
    const p = openPicker(h, { onClosed, onInsert });
    key(p.querySelector('.tp-grid')!, 'Escape');
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onInsert).not.toHaveBeenCalled();
  });

  it('Enter reports the size to onInsert and not to onClosed', () => {
    const h = mount('Hello\n');
    const onClosed = vi.fn();
    const onInsert = vi.fn();
    const p = openPicker(h, { onClosed, onInsert });
    key(p.querySelector('.tp-grid')!, 'ArrowRight');
    key(p.querySelector('.tp-grid')!, 'Enter');
    expect(onInsert).toHaveBeenCalledWith(3, 4);
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('Tab walks grid, rows, columns and OK, then wraps', () => {
    const h = mount('Hello\n');
    const p = openPicker(h);
    const grid = p.querySelector<HTMLElement>('.tp-grid')!;
    const [rowsIn, colsIn] = Array.from(p.querySelectorAll<HTMLInputElement>('.tp-input'));
    const ok = p.querySelector<HTMLElement>('.tp-ok')!;
    // Every stop is reachable by Tab (none has tabindex -1).
    for (const el of [grid, rowsIn, colsIn, ok]) {expect(el.tabIndex).toBeGreaterThanOrEqual(0);}
    ok.focus();
    const forward = key(ok, 'Tab');
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(grid);
    const backward = key(grid, 'Tab', { shiftKey: true });
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(ok);
    // In the middle the browser's own order applies.
    expect(key(rowsIn, 'Tab').defaultPrevented).toBe(false);
  });

  it('the manual size inputs insert on Enter, clamped', () => {
    const h = mount('Hello\n');
    placeCursor(h, 6);
    const p = openPicker(h);
    const [rowsIn, colsIn] = Array.from(p.querySelectorAll<HTMLInputElement>('.tp-input'));
    rowsIn.value = '5';
    colsIn.value = '99';
    key(colsIn, 'Enter');
    expect(picker()).toBeNull();
    expect(tableShape(h)).toEqual({ rows: 5, cols: 20 });
  });

  it('OK acts on click, so Enter and Space on the focused button work', () => {
    const h = mount('Hello\n');
    placeCursor(h, 6);
    const p = openPicker(h);
    const [rowsIn, colsIn] = Array.from(p.querySelectorAll<HTMLInputElement>('.tp-input'));
    rowsIn.value = '2';
    colsIn.value = '2';
    p.querySelector<HTMLElement>('.tp-ok')!.click();
    expect(tableShape(h)).toEqual({ rows: 2, cols: 2 });
  });

  it('opens from the insertTable command with the grid focused', async () => {
    const h = mount('Hello\n');
    h.command('insertTable');
    await new Promise(r => setTimeout(r, 0));
    expect(document.activeElement).toBe(picker()!.querySelector('.tp-grid'));
    key(document.activeElement!, 'Enter');
    expect(tableShape(h)).toEqual({ rows: 3, cols: 3 });
  });

  it('the mouse still works: a cell click inserts that size', () => {
    const h = mount('Hello\n');
    placeCursor(h, 6);
    const p = openPicker(h);
    p.querySelector('.tp-cell[data-row="2"][data-col="4"]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(tableShape(h)).toEqual({ rows: 2, cols: 4 });
  });
});

// ── 10. Move row / column ───────────────────────────────────────────────────

describe('Move Row and Move Column', () => {
  const menuItem = (h: MikeDownEditorHandle, label: string): ContextMenuItem => {
    const entry = buildTableMenu(h.tiptap).find((e: ContextMenuEntry) => 'label' in e && e.label === label);
    expect(entry, label).toBeDefined();
    return entry as ContextMenuItem;
  };

  it('the table menu lists the four Move entries', () => {
    const h = mount(TABLE);
    cursorIn(h, 2, 1);
    const labels = buildTableMenu(h.tiptap).filter(e => 'label' in e).map(e => (e as ContextMenuItem).label);
    for (const l of ['Move Row Up', 'Move Row Down', 'Move Column Left', 'Move Column Right']) {
      expect(labels).toContain(l);
    }
  });

  it('Move Row Down swaps the row with the one below, in one undo step', () => {
    const h = mount(TABLE);
    cursorIn(h, 1, 0);
    menuItem(h, 'Move Row Down').action();
    expect(bodyRows(h)).toEqual(['A,B,C', '---,---,---', 'a2,b2,c2', 'a1,b1,c1', 'a3,b3,c3']);
    h.tiptap.commands.undo();
    expect(bodyRows(h)).toEqual(['A,B,C', '---,---,---', 'a1,b1,c1', 'a2,b2,c2', 'a3,b3,c3']);
  });

  it('Move Row Up moves the row above and the cursor goes with it', () => {
    const h = mount(TABLE);
    cursorIn(h, 3, 1, 1);
    menuItem(h, 'Move Row Up').action();
    expect(bodyRows(h)).toEqual(['A,B,C', '---,---,---', 'a1,b1,c1', 'a3,b3,c3', 'a2,b2,c2']);
    const { $from } = h.tiptap.state.selection;
    expect($from.parent.textContent).toBe('b3');
    expect($from.parentOffset).toBe(1);
  });

  it('Move Column Right and Left move the column in every row', () => {
    const h = mount(TABLE);
    cursorIn(h, 1, 0);
    menuItem(h, 'Move Column Right').action();
    expect(bodyRows(h)).toEqual(['B,A,C', '---,---,---', 'b1,a1,c1', 'b2,a2,c2', 'b3,a3,c3']);
    menuItem(h, 'Move Column Left').action();
    expect(bodyRows(h)).toEqual(['A,B,C', '---,---,---', 'a1,b1,c1', 'a2,b2,c2', 'a3,b3,c3']);
  });

  it('a column moves from the header row too', () => {
    const h = mount(TABLE);
    cursorIn(h, 0, 2);
    menuItem(h, 'Move Column Left').action();
    expect(bodyRows(h)[0]).toBe('A,C,B');
  });

  it('keeps column alignment with the column', () => {
    const h = mount('| A | B |\n| :---: | ---: |\n| 1 | 2 |\n| 3 | 4 |\n');
    // The header cell of the first column (cell index 0).
    placeCursor(h, cellTextPos(h, 0));
    moveInTable(h.tiptap, 'right');
    expect(h.getMarkdown()).toContain('| B | A |\n| ---: | :---: |');
  });

  it('is disabled at the edges', () => {
    const h = mount(TABLE);
    cursorIn(h, 1, 0); // first body row, first column
    expect(menuItem(h, 'Move Row Up').disabled).toBe(true);
    expect(menuItem(h, 'Move Row Down').disabled).toBeFalsy();
    expect(menuItem(h, 'Move Column Left').disabled).toBe(true);
    expect(menuItem(h, 'Move Column Right').disabled).toBeFalsy();

    cursorIn(h, 3, 2); // last body row, last column
    expect(menuItem(h, 'Move Row Up').disabled).toBeFalsy();
    expect(menuItem(h, 'Move Row Down').disabled).toBe(true);
    expect(menuItem(h, 'Move Column Left').disabled).toBeFalsy();
    expect(menuItem(h, 'Move Column Right').disabled).toBe(true);
  });

  it('the header row cannot move, and no row moves above it', () => {
    const h = mount(TABLE);
    cursorIn(h, 0, 1);
    expect(canMove(h.tiptap, 'up')).toBe(false);
    expect(canMove(h.tiptap, 'down')).toBe(false);
    expect(moveInTable(h.tiptap, 'down')).toBe(false);
    cursorIn(h, 1, 1);
    expect(canMove(h.tiptap, 'up')).toBe(false);
    expect(bodyRows(h)[2]).toBe('a1,b1,c1');
  });

  it('a disabled entry does nothing when run', () => {
    const h = mount(TABLE);
    cursorIn(h, 3, 2);
    const before = h.getMarkdown();
    menuItem(h, 'Move Row Down').action();
    expect(h.getMarkdown()).toBe(before);
  });

  it('round-trips as markdown after moves', () => {
    const h = mount(TABLE);
    cursorIn(h, 2, 1);
    moveInTable(h.tiptap, 'down');
    moveInTable(h.tiptap, 'left');
    expect(bodyRows(h)).toEqual(['B,A,C', '---,---,---', 'b1,a1,c1', 'b3,a3,c3', 'b2,a2,c2']);
    const md = h.getMarkdown();
    expect(mount(md).getMarkdown()).toBe(md);
  });
});

// ── 10. Drag handles ────────────────────────────────────────────────────────

describe('Drag handles', () => {
  const handles = () => Array.from(document.querySelectorAll<HTMLElement>('.td-handle'));

  it('are buttons with a name and an SVG grip', () => {
    const h = mount(TABLE);
    cursorIn(h, 1, 1);
    const hs = handles();
    expect(hs.filter(x => x.classList.contains('td-handle-row')).length).toBe(3); // body rows only
    expect(hs.filter(x => x.classList.contains('td-handle-col')).length).toBe(3);
    for (const el of hs) {
      expect(el.getAttribute('role')).toBe('button');
      expect(el.getAttribute('aria-label')).toMatch(/reorder (row|column) \d/);
      expect(el.querySelector('svg')).not.toBeNull();
      expect(el.textContent).toBe('');
    }
  });

  it('go away when the cursor leaves the table', () => {
    const h = mount(`${TABLE}\nAfter\n`);
    cursorIn(h, 1, 1);
    expect(handles().length).toBeGreaterThan(0);
    placeCursor(h, h.tiptap.state.doc.content.size - 1);
    expect(handles().length).toBe(0);
  });

  it('are repositioned when the document changes, without being rebuilt', () => {
    const h = mount(TABLE);
    cursorIn(h, 1, 1);
    const first = handles().find(x => x.classList.contains('td-handle-row'))!;
    // The first body row "moves" down 30px (a wrapped line above it, say).
    let shift = 0;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const isRow = this.tagName === 'TR';
      const top = isRow ? 100 + shift : 0;
      return { left: 50, right: 450, top, bottom: top + 30, width: 400, height: 30, x: 50, y: top, toJSON: () => ({}) } as DOMRect;
    });
    h.tiptap.view.dispatch(h.tiptap.state.tr.insertText('x', cellTextPos(h, 3)));
    const before = parseFloat(first.style.top);
    shift = 30;
    h.tiptap.view.dispatch(h.tiptap.state.tr.insertText('y', cellTextPos(h, 3)));
    const after = parseFloat(handles().find(x => x.classList.contains('td-handle-row'))!.style.top);
    expect(after - before).toBe(30);
    // Same table and shape: the same element was moved.
    expect(handles().find(x => x.classList.contains('td-handle-row'))).toBe(first);
  });

  it('are rebuilt when a row is added', () => {
    const h = mount(TABLE);
    cursorIn(h, 1, 1);
    expect(handles().filter(x => x.classList.contains('td-handle-row')).length).toBe(3);
    h.tiptap.chain().focus().addRowAfter().run();
    expect(handles().filter(x => x.classList.contains('td-handle-row')).length).toBe(4);
  });

  it('follow the table when the window scrolls or resizes', () => {
    const h = mount(TABLE);
    cursorIn(h, 1, 1);
    let top = 100;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const t = this.tagName === 'TR' ? top : 0;
      return { left: 50, right: 450, top: t, bottom: t + 30, width: 400, height: 30, x: 50, y: t, toJSON: () => ({}) } as DOMRect;
    });
    window.dispatchEvent(new Event('resize'));
    const a = parseFloat(handles().find(x => x.classList.contains('td-handle-row'))!.style.top);
    top = 160;
    document.body.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    const b = parseFloat(handles().find(x => x.classList.contains('td-handle-row'))!.style.top);
    expect(b - a).toBe(60);
  });
});

// ── 8. Floating toolbar anchor ──────────────────────────────────────────────

describe('Floating table toolbar on a tall table', () => {
  it('stays inside the window, next to the cursor row, when the table is taller than the window', () => {
    const h = mount(TABLE);
    // Table spans 2500px with its top 800px above the window and its bottom below it; the cursor's row is at 300 to 340.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const r = (left: number, top: number, w: number, ht: number): DOMRect =>
        ({ left, top, right: left + w, bottom: top + ht, width: w, height: ht, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
      if (this.tagName === 'TABLE') {return r(100, -800, 600, 2500);}
      if (this.tagName === 'TR') {return r(100, 300, 600, 40);}
      if (this.id === 'mikedown-table-toolbar') {return r(0, 0, 400, 40);}
      return r(0, 0, 0, 0);
    });
    cursorIn(h, 2, 1);
    const tb = document.getElementById('mikedown-table-toolbar')!;
    expect(tb).not.toBeNull();
    const top = parseFloat(tb.style.top);
    expect(top).toBeGreaterThanOrEqual(4);
    expect(top + 40).toBeLessThanOrEqual(window.innerHeight);
    expect(top).toBe(346); // just under the 300 to 340 row
  });
});

// ── 11. Hover "+" strips ────────────────────────────────────────────────────

describe('Hover "+" strips', () => {
  const strips = () => ({
    col: document.querySelector<HTMLElement>('.td-add-col'),
    row: document.querySelector<HTMLElement>('.td-add-row'),
  });
  const hoverTable = (h: MikeDownEditorHandle): void => {
    const cell = h.tiptap.view.dom.querySelector('td')!;
    cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 10 }));
  };

  it('appear when the pointer is over a table, with names', () => {
    const h = mount(`Intro\n\n${TABLE}`);
    expect(strips().col).toBeNull();
    hoverTable(h);
    const { col, row } = strips();
    expect(col).not.toBeNull();
    expect(row).not.toBeNull();
    expect(col!.getAttribute('role')).toBe('button');
    expect(col!.getAttribute('aria-label')).toBe('Add column at the end');
    expect(row!.getAttribute('aria-label')).toBe('Add row at the end');
    expect(col!.querySelector('svg')).not.toBeNull();
  });

  it('are portal overlays, not part of the editor DOM', () => {
    const h = mount(TABLE);
    hoverTable(h);
    expect(h.tiptap.view.dom.querySelector('.td-add')).toBeNull();
    expect(strips().col!.closest('.mikedown-portal')).not.toBeNull();
  });

  it('hide when the pointer goes elsewhere', () => {
    const h = mount(`${TABLE}\nAfter paragraph\n`);
    hoverTable(h);
    expect(strips().col).not.toBeNull();
    const para = Array.from(h.tiptap.view.dom.querySelectorAll('p')).find(p => p.textContent === 'After paragraph')!;
    para.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 900, clientY: 900 }));
    expect(strips().col).toBeNull();
    expect(strips().row).toBeNull();
  });

  it('hide while typing and come back when the pointer moves', () => {
    const h = mount(TABLE);
    hoverTable(h);
    expect(strips().col).not.toBeNull();
    h.tiptap.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(strips().col).toBeNull();
    hoverTable(h);
    expect(strips().col).not.toBeNull();
  });

  it('stay hidden in source mode', () => {
    const h = mount(TABLE);
    h.command('toggleSource');
    hoverTable(h);
    expect(strips().col).toBeNull();
  });

  it('clicking the column strip adds a column at the end and keeps the cursor in the table', () => {
    const h = mount(TABLE);
    cursorIn(h, 2, 1);
    hoverTable(h);
    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    strips().col!.dispatchEvent(mousedown);
    expect(mousedown.defaultPrevented).toBe(true);
    strips().col!.click();
    expect(tableShape(h)).toEqual({ rows: 4, cols: 4 });
    expect(bodyRows(h)[0]).toBe('A,B,C,');
    expect(h.tiptap.isActive('table')).toBe(true);
    // The cursor stays in its row.
    expect(h.tiptap.state.selection.$from.parent.textContent).toBe('');
  });

  it('clicking the row strip adds a row at the end and keeps the cursor in the table', () => {
    const h = mount(TABLE);
    cursorIn(h, 1, 2);
    hoverTable(h);
    strips().row!.click();
    expect(tableShape(h)).toEqual({ rows: 5, cols: 3 });
    expect(h.tiptap.isActive('table')).toBe(true);
    // One undo takes the row back out.
    h.tiptap.commands.undo();
    expect(tableShape(h)).toEqual({ rows: 4, cols: 3 });
  });

  it('works on a table the cursor is not in', () => {
    const h = mount(`Intro\n\n${TABLE}`);
    placeCursor(h, 2);
    hoverTable(h);
    strips().row!.click();
    expect(tableShape(h)).toEqual({ rows: 5, cols: 3 });
    expect(h.tiptap.isActive('table')).toBe(true);
    expect(h.getMarkdown()).toMatch(/\| a3 \| b3 \| c3 \|\n\| {2}\| {2}\| {2}\|/);
  });

  it('the new row and column save as a GFM table', () => {
    const h = mount(TABLE);
    cursorIn(h, 1, 1);
    hoverTable(h);
    strips().row!.click();
    hoverTable(h);
    strips().col!.click();
    const md = h.getMarkdown();
    expect(md).not.toContain('<table');
    expect(mount(md).getMarkdown()).toBe(md);
  });
});
