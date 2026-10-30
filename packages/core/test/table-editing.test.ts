/**
 * Table editing in the full editor: Backspace in a cell, pasting a table into
 * a table, `|` inside inline code, the row chords, and round trips.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { createMikeDownEditor, type MikeDownEditorHandle } from '../src/index';
import { buildTableMenu, buildTextMenu } from '../src/contextmenu';
import { escapeCellPipes } from '../src/table-align';
import { MIKEDOWN_TABLE_HOTKEYS } from '../src/hotkeys';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

afterEach(() => {
  for (const { handle, el } of mounted.splice(0)) {
    handle.destroy();
    el.remove();
  }
});

function mount(markdown: string): MikeDownEditorHandle {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host: { onChange() {} }, initialMarkdown: markdown });
  mounted.push({ handle, el });
  return handle;
}

const TABLE = '| A | B |\n| --- | --- |\n| hello | world |\n';

/** Position inside the nth cell (header cells count), `offset` chars into its text. */
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

function cellNodePos(h: MikeDownEditorHandle, n: number): number {
  return cellTextPos(h, n) - 2;
}

function placeCursor(h: MikeDownEditorHandle, pos: number): void {
  const { view } = h.tiptap;
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
}

/** Dispatch a keydown on the editor; if nothing handled a collapsed
 *  Backspace, do what the browser would (delete one character). */
function press(h: MikeDownEditorHandle, key: string, mods: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const { view } = h.tiptap;
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods });
  view.dom.dispatchEvent(ev);
  if (!ev.defaultPrevented && key === 'Backspace' && view.state.selection.empty) {
    const { from } = view.state.selection;
    view.dispatch(view.state.tr.delete(from - 1, from));
  }
  return ev;
}

function cellTexts(h: MikeDownEditorHandle): string[] {
  const out: string[] = [];
  h.tiptap.state.doc.descendants((node) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      out.push(node.textContent);
      return false;
    }
    return true;
  });
  return out;
}

function countTables(h: MikeDownEditorHandle): number {
  let n = 0;
  h.tiptap.state.doc.descendants((node) => {
    if (node.type.name === 'table') {n++;}
    return true;
  });
  return n;
}

function paste(h: MikeDownEditorHandle, html: string, text = ''): void {
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  const data: Record<string, string> = { 'text/html': html, 'text/plain': text };
  Object.defineProperty(ev, 'clipboardData', {
    value: { getData: (t: string) => data[t] ?? '', types: Object.keys(data), files: [], items: [] },
  });
  h.tiptap.view.dom.dispatchEvent(ev);
}

describe('Backspace in a table cell', () => {
  it('deletes one character after clicking into the cell twice', () => {
    const h = mount(TABLE);
    const pos = cellTextPos(h, 2, 5); // end of "hello"
    placeCursor(h, pos);
    const cell = h.tiptap.view.dom.querySelectorAll('td')[0];
    for (let i = 0; i < 2; i++) {
      cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      placeCursor(h, pos);
    }
    press(h, 'Backspace');
    expect(cellTexts(h)[2]).toBe('hell');
  });

  it('clears every cell of a CellSelection', () => {
    const h = mount(TABLE);
    const { view } = h.tiptap;
    view.focus();
    const sel = CellSelection.create(view.state.doc, cellNodePos(h, 2), cellNodePos(h, 3));
    view.dispatch(view.state.tr.setSelection(sel));
    expect(view.state.selection).toBeInstanceOf(CellSelection);
    press(h, 'Backspace');
    expect(cellTexts(h)).toEqual(['A', 'B', '', '']);
  });

  it('leaves no custom selection classes behind', () => {
    const h = mount(TABLE);
    placeCursor(h, cellTextPos(h, 2, 1));
    h.tiptap.view.dom.querySelectorAll('td')[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    expect(h.tiptap.view.dom.querySelector('.mikedown-cell-selected')).toBeNull();
  });
});

describe('Pasting a table inside a table', () => {
  const HTML_2x2 = '<table><tr><td>x1</td><td>x2</td></tr><tr><td>y1</td><td>y2</td></tr></table>';

  it('fills cells from the cursor instead of nesting a table', () => {
    const h = mount('| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n');
    placeCursor(h, cellTextPos(h, 3)); // first body cell
    paste(h, HTML_2x2);
    expect(countTables(h)).toBe(1);
    const md = h.getMarkdown();
    expect(md).not.toContain('<table');
    expect(md).toContain('| x1 | x2 | 3 |');
    expect(md).toContain('| y1 | y2 | 6 |');
  });

  it('keeps the header row GFM when pasting at the header', () => {
    const h = mount('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
    placeCursor(h, cellTextPos(h, 0));
    paste(h, HTML_2x2);
    const md = h.getMarkdown();
    expect(md).not.toContain('<table');
    expect(md).toContain('| x1 | x2 |\n| --- | --- |\n| y1 | y2 |');
  });

  it('still inserts a pasted table outside a table', () => {
    const h = mount('Intro\n');
    placeCursor(h, 6);
    paste(h, HTML_2x2);
    expect(countTables(h)).toBe(1);
    expect(h.getMarkdown()).toContain('| x1 | x2 |');
  });
});

describe('Pipes in inline code inside a cell', () => {
  it('round-trips `a\\|b` in a cell', () => {
    const md = '| A | B |\n| --- | --- |\n| `a\\|b` | c |\n';
    const h = mount(md);
    expect(cellTexts(h)).toEqual(['A', 'B', 'a|b', 'c']);
    const out = h.getMarkdown();
    expect(out).toContain('`a\\|b`');
    const again = mount(out);
    expect(cellTexts(again)).toEqual(['A', 'B', 'a|b', 'c']);
  });

  it('escapes a pipe in inline code typed into a cell', () => {
    const h = mount(TABLE);
    const { view } = h.tiptap;
    const pos = cellTextPos(h, 3);
    const code = view.state.schema.marks.code.create();
    view.dispatch(view.state.tr.insert(pos, view.state.schema.text('x|y', [code])));
    const out = h.getMarkdown();
    expect(out).toContain('`x\\|y`');
    const again = mount(out);
    expect(cellTexts(again)).toEqual(['A', 'B', 'hello', 'x|yworld']);
  });

  it('escapes bare pipes in a rendered cell, code spans included', () => {
    expect(escapeCellPipes('`a|b`')).toBe('`a\\|b`');
    expect(escapeCellPipes('`a\\|b`')).toBe('`a\\\\|b`');
    expect(escapeCellPipes('a \\| b')).toBe('a \\| b');
    expect(escapeCellPipes('[[Page|Alias]]')).toBe('[[Page\\|Alias]]');
    expect(escapeCellPipes('``a`|b`` c|d')).toBe('``a`\\|b`` c\\|d');
    expect(escapeCellPipes('\\`a|b')).toBe('\\`a\\|b');
  });

  it('round-trips a literal backslash-pipe in inline code', () => {
    const h = mount(TABLE);
    const { view } = h.tiptap;
    const code = view.state.schema.marks.code.create();
    view.dispatch(view.state.tr.insert(cellTextPos(h, 3), view.state.schema.text('x\\|y', [code])));
    const again = mount(h.getMarkdown());
    expect(cellTexts(again)[3]).toBe('x\\|yworld');
  });

  it('leaves pipes in inline code outside tables alone', () => {
    const h = mount('Use `a|b` here\n');
    expect(h.getMarkdown()).toContain('`a|b`');
  });
});

describe('Row chords', () => {
  const mod = { metaKey: true, ctrlKey: true };

  it('Mod-Enter adds a row below', () => {
    const h = mount(TABLE);
    placeCursor(h, cellTextPos(h, 2, 1));
    const ev = press(h, 'Enter', mod);
    expect(ev.defaultPrevented).toBe(true);
    expect(cellTexts(h)).toEqual(['A', 'B', 'hello', 'world', '', '']);
  });

  it('Mod-Enter puts the cursor in the new row, same column', () => {
    const h = mount(TABLE);
    placeCursor(h, cellTextPos(h, 3, 1)); // "world"
    press(h, 'Enter', mod);
    const { selection } = h.tiptap.state;
    expect(selection.from).toBe(cellTextPos(h, 5));
  });

  it('Mod-Shift-Enter puts the cursor in the new row above', () => {
    const h = mount(TABLE);
    placeCursor(h, cellTextPos(h, 2, 1));
    press(h, 'Enter', { ...mod, shiftKey: true });
    expect(h.tiptap.state.selection.from).toBe(cellTextPos(h, 2));
  });

  it('lists the chords in the Hotkeys data', () => {
    const labels = MIKEDOWN_TABLE_HOTKEYS.map(k => k.label);
    expect(labels).toEqual(expect.arrayContaining(['Insert Row Below', 'Insert Row Above', 'Delete Row']));
  });

  it('Mod-Shift-Enter adds a row above', () => {
    const h = mount(TABLE);
    placeCursor(h, cellTextPos(h, 2, 1));
    press(h, 'Enter', { ...mod, shiftKey: true });
    expect(cellTexts(h)).toEqual(['A', 'B', '', '', 'hello', 'world']);
  });

  it('Mod-Alt-Backspace deletes the row', () => {
    const h = mount('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n');
    placeCursor(h, cellTextPos(h, 2));
    press(h, 'Backspace', { ...mod, altKey: true });
    expect(cellTexts(h)).toEqual(['A', 'B', '3', '4']);
  });

  it('Mod-Enter outside a table leaves the table alone', () => {
    const h = mount('Para\n\n' + TABLE);
    placeCursor(h, 3);
    press(h, 'Enter', mod);
    expect(cellTexts(h)).toEqual(['A', 'B', 'hello', 'world']);
  });
});

describe('Tab, Escape and Backspace in cells', () => {
  it('Tab moves to the next cell and adds a row on the last cell', () => {
    const h = mount(TABLE);
    placeCursor(h, cellTextPos(h, 2));
    press(h, 'Tab');
    expect(h.tiptap.state.selection.$from.parent.textContent).toBe('world');
    press(h, 'Tab');
    expect(cellTexts(h)).toEqual(['A', 'B', 'hello', 'world', '', '']);
  });

  it('Shift-Tab moves to the previous cell', () => {
    const h = mount(TABLE);
    placeCursor(h, cellTextPos(h, 3));
    press(h, 'Tab', { shiftKey: true });
    expect(h.tiptap.state.selection.$from.parent.textContent).toBe('hello');
  });

  it('Escape leaves the table', () => {
    const h = mount(TABLE + '\nAfter\n');
    placeCursor(h, cellTextPos(h, 2));
    press(h, 'Escape');
    expect(h.tiptap.isActive('table')).toBe(false);
  });

  it('Backspace at the start of a cell keeps the cells', () => {
    const h = mount(TABLE);
    placeCursor(h, cellTextPos(h, 3));
    press(h, 'Backspace');
    expect(countTables(h)).toBe(1);
    expect(cellTexts(h)).toEqual(['A', 'B', 'hello', 'world']);
  });
});

describe('Table context menu', () => {
  it('Select Table selects the whole table as a node', () => {
    const h = mount(TABLE);
    placeCursor(h, cellTextPos(h, 2));
    const entry = buildTableMenu(h.tiptap).find(e => 'label' in e && e.label === 'Select Table');
    expect(entry).toBeDefined();
    (entry as { action: () => void }).action();
    const sel = h.tiptap.state.selection;
    expect(sel).toBeInstanceOf(NodeSelection);
    expect((sel as NodeSelection).node.type.name).toBe('table');
    press(h, 'Backspace');
    expect(countTables(h)).toBe(0);
  });

  it('has no header toggle or merge entries', () => {
    const h = mount(TABLE);
    placeCursor(h, cellTextPos(h, 2));
    const labels = buildTableMenu(h.tiptap).map(e => ('label' in e ? e.label : ''));
    expect(labels.some(l => /header/i.test(l))).toBe(false);
    expect(labels.some(l => /merge|split/i.test(l))).toBe(false);
  });
});

describe('Floating table toolbar', () => {
  const toolbarButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('#mikedown-table-toolbar button'));

  it('has no header toggle or merge buttons', () => {
    const h = mount(TABLE);
    placeCursor(h, cellTextPos(h, 2));
    const labels = toolbarButtons().map(b => b.getAttribute('aria-label') ?? '');
    expect(labels).toContain('Insert row below');
    expect(labels.some(l => /header|merge/i.test(l))).toBe(false);
  });

  it('runs a button on click (Enter or Space on a focused button), not on mousedown', () => {
    const h = mount(TABLE);
    placeCursor(h, cellTextPos(h, 2));
    const below = toolbarButtons().find(b => b.getAttribute('aria-label') === 'Insert row below')!;
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    below.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(cellTexts(h)).toHaveLength(4);
    below.click();
    expect(cellTexts(h)).toHaveLength(6);
  });
});

describe('Insert > Table', () => {
  it('opens the size picker instead of inserting a 3 x 3 table', async () => {
    const h = mount('Intro\n');
    placeCursor(h, 3);
    const insert = buildTextMenu(h.tiptap).find(e => 'label' in e && e.label === 'Insert') as { items: Array<{ label: string; action: () => void }> };
    insert.items.find(i => i.label.startsWith('Table'))!.action();
    expect(countTables(h)).toBe(0);
    await new Promise(r => setTimeout(r, 0));
    expect(document.getElementById('mikedown-table-picker')).not.toBeNull();
    document.getElementById('mikedown-table-picker')?.remove();
  });
});

describe('Table round trips', () => {
  const cases: Array<[string, string]> = [
    ['escaped pipes', '| A | B |\n| --- | --- |\n| a \\| b | c |\n'],
    ['inline marks', '| A | B |\n| --- | --- |\n| **bold** *it* | `code` ~~s~~ [l](https://x.y) |\n'],
    ['<br> cells', '| A | B |\n| --- | --- |\n| one<br>two | c |\n'],
    ['alignment', '| L | C | R |\n| --- | :---: | ---: |\n| a | b | c |\n'],
  ];
  for (const [name, md] of cases) {
    it(`keeps ${name}`, () => {
      const h = mount(md);
      expect(h.getMarkdown().trim()).toBe(md.trim());
    });
  }

  it('pads ragged rows to the header width and stays stable', () => {
    const h = mount('| A | B | C |\n| --- | --- | --- |\n| 1 |\n| 1 | 2 | 3 | 4 |\n');
    const out = h.getMarkdown();
    const reload = mount(out);
    expect(reload.getMarkdown()).toBe(out);
    for (const line of out.trim().split('\n')) {
      expect(line.split(/(?<!\\)\|/).length).toBe(5);
    }
  });
});
