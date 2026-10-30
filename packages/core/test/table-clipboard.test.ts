/**
 * Tables on the clipboard: plain-text table paste (pipe tables and TSV), copy
 * as a markdown pipe table, and smart paste of merged and aligned HTML cells.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { undo } from '@tiptap/pm/history';
import { createMikeDownEditor, type MikeDownEditorHandle } from '../src/index';
import { buildTableMenu } from '../src/contextmenu';
import { detectTextTable, sliceToMarkdown, tableMarkdownAt } from '../src/table-clipboard';
import { insertPlainText } from '../src/plainpaste';
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

function cellTextPos(h: MikeDownEditorHandle, n: number): number {
  let i = 0;
  let found = -1;
  h.tiptap.state.doc.descendants((node, pos) => {
    if (found >= 0) {return false;}
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      if (i === n) {found = pos + 2;}
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

function countTables(h: MikeDownEditorHandle): number {
  let n = 0;
  h.tiptap.state.doc.descendants((node) => {
    if (node.type.name === 'table') {n++;}
    return true;
  });
  return n;
}

function paste(h: MikeDownEditorHandle, data: Record<string, string>): void {
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', {
    value: { getData: (t: string) => data[t] ?? '', types: Object.keys(data), files: [], items: [] },
  });
  h.tiptap.view.dom.dispatchEvent(ev);
}

/** Fire a copy event and return what ProseMirror put on the clipboard. */
function copy(h: MikeDownEditorHandle): Record<string, string> {
  const store: Record<string, string> = {};
  const ev = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', {
    value: {
      clearData: () => { for (const k of Object.keys(store)) {delete store[k];} },
      setData: (t: string, v: string) => { store[t] = v; },
      getData: (t: string) => store[t] ?? '',
    },
  });
  h.tiptap.view.dom.dispatchEvent(ev);
  return store;
}

// ── detectTextTable ─────────────────────────────────────────────────────────

describe('detectTextTable', () => {
  it('reads a pipe table with alignment', () => {
    const t = detectTextTable('| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n');
    expect(t).toEqual({ kind: 'pipe', rows: [['A', 'B', 'C'], ['1', '2', '3']], align: [null, 'center', 'right'] });
  });

  it('reads a pipe table without outer pipes and keeps escaped pipes', () => {
    const t = detectTextTable('A | B\n--- | ---\na\\|b | `x`');
    expect(t?.rows).toEqual([['A', 'B'], ['a\\|b', '`x`']]);
  });

  it('pads and trims ragged pipe body rows to the header width', () => {
    const t = detectTextTable('| A | B |\n| - | - |\n| 1 |\n| 1 | 2 | 3 |');
    expect(t?.rows).toEqual([['A', 'B'], ['1', ''], ['1', '2']]);
  });

  it('reads TSV with the first line as the header', () => {
    const t = detectTextTable('Name\tQty\nApples\t3\nPears\t\n');
    expect(t).toEqual({ kind: 'tsv', rows: [['Name', 'Qty'], ['Apples', '3'], ['Pears', '']], align: [null, null] });
  });

  it('accepts a single tab line only when asked (inside a table)', () => {
    expect(detectTextTable('a\tb', { singleRow: true })?.rows).toEqual([['a', 'b']]);
    expect(detectTextTable('| a | b |', { singleRow: true })).toBeNull();
  });

  it.each([
    ['a single tab line', 'a\tb'],
    ['a single line', 'hello world'],
    ['prose with pipes', 'this | that\nand | more'],
    ['a pipe row without a delimiter row', '| a | b |\n| 1 | 2 |'],
    ['a delimiter with the wrong cell count', '| a | b |\n| --- |\n| 1 | 2 |'],
    ['ragged TSV', 'a\tb\tc\n1\t2'],
    ['TSV with a blank line inside', 'a\tb\n\n1\t2'],
    ['tab-indented code', '\tfoo()\n\tbar()'],
    ['a pipe table followed by prose', '| a |\n| - |\n| 1 |\n\nAfter'],
    ['lines without tabs', 'a\nb'],
  ])('rejects %s', (_label, text) => {
    expect(detectTextTable(text)).toBeNull();
  });
});

// ── Plain-text paste ────────────────────────────────────────────────────────

describe('Pasting a plain-text table', () => {
  it('turns a pipe table into a table, keeping marks and alignment', () => {
    const h = mount('Intro\n');
    placeCursor(h, 6);
    paste(h, { 'text/plain': '| Name | Qty |\n| --- | ---: |\n| **Apples** | 3 |\n' });
    expect(countTables(h)).toBe(1);
    const md = h.getMarkdown();
    expect(md).toContain('| Name | Qty |\n| --- | ---: |\n| **Apples** | 3 |');
  });

  it('replaces an empty paragraph', () => {
    const h = mount('');
    placeCursor(h, 1);
    paste(h, { 'text/plain': 'a\tb\n1\t2' });
    expect(h.getMarkdown().trim()).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
  });

  it('turns TSV into a table with plain-text cells', () => {
    const h = mount('Intro\n');
    placeCursor(h, 6);
    paste(h, { 'text/plain': 'Name\tNote\n*a*\tx|y\n' });
    expect(countTables(h)).toBe(1);
    expect(h.getMarkdown()).toContain('| Name | Note |\n| --- | --- |\n| \\*a\\* | x\\|y |');
  });

  it('handles a pipe table copied from a text editor (HTML without a table)', () => {
    const h = mount('Intro\n');
    placeCursor(h, 6);
    paste(h, {
      'text/html': '<div><span>| A | B |</span></div><div><span>| - | - |</span></div><div><span>| 1 | 2 |</span></div>',
      'text/plain': '| A | B |\n| - | - |\n| 1 | 2 |',
    });
    expect(countTables(h)).toBe(1);
    expect(h.getMarkdown()).toContain('| A | B |\n| --- | --- |\n| 1 | 2 |');
  });

  it('lets an HTML table win over its TSV flavour (spreadsheets)', () => {
    const h = mount('Intro\n');
    placeCursor(h, 6);
    paste(h, {
      'text/html': '<table><tr><td><b>H1</b></td><td>H2</td></tr><tr><td>1</td><td>2</td></tr></table>',
      'text/plain': 'H1\tH2\n1\t2',
    });
    expect(countTables(h)).toBe(1);
    expect(h.getMarkdown()).toContain('| **H1** | H2 |');
  });

  it('fills cells from the cursor inside a table', () => {
    const h = mount('| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n');
    placeCursor(h, cellTextPos(h, 3));
    paste(h, { 'text/plain': 'x1\tx2\ny1\ty2' });
    expect(countTables(h)).toBe(1);
    const md = h.getMarkdown();
    expect(md).not.toContain('<table');
    expect(md).toContain('| x1 | x2 | 3 |');
    expect(md).toContain('| y1 | y2 | 6 |');
  });

  it('is undone in one step', () => {
    const before = 'Intro\n';
    const h = mount(before);
    const initial = h.getMarkdown();
    placeCursor(h, 6);
    paste(h, { 'text/plain': '| A | B |\n| - | - |\n| 1 | 2 |' });
    expect(countTables(h)).toBe(1);
    undo(h.tiptap.view.state, h.tiptap.view.dispatch);
    expect(countTables(h)).toBe(0);
    expect(h.getMarkdown()).toBe(initial);
  });

  it('is undone in one step inside a table', () => {
    const h = mount('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
    const initial = h.getMarkdown();
    placeCursor(h, cellTextPos(h, 2));
    paste(h, { 'text/plain': 'x\ty' });
    expect(h.getMarkdown()).toContain('| x | y |');
    expect(countTables(h)).toBe(1);
    undo(h.tiptap.view.state, h.tiptap.view.dispatch);
    expect(h.getMarkdown()).toBe(initial);
  });

  it('stays literal in a code block', () => {
    const h = mount('```\ncode\n```\n');
    placeCursor(h, 5);
    paste(h, { 'text/plain': 'a\tb\n1\t2' });
    expect(countTables(h)).toBe(0);
  });

  it('leaves prose with pipes alone', () => {
    const h = mount('Intro\n');
    placeCursor(h, 6);
    paste(h, { 'text/plain': 'this | that\nand | more' });
    expect(countTables(h)).toBe(0);
  });

  it('paste without formatting stays verbatim', () => {
    const h = mount('Intro\n');
    placeCursor(h, 6);
    insertPlainText(h.tiptap.view, '| A | B |\n| - | - |\n| 1 | 2 |');
    expect(countTables(h)).toBe(0);
    expect(h.tiptap.state.doc.textContent).toContain('| A | B |');
  });
});

// ── Copy ────────────────────────────────────────────────────────────────────

const TABLE = '| Name | Qty |\n| --- | ---: |\n| a\\|b | **3** |\n| c | 4 |\n';

describe('Copying a table', () => {
  it('puts a pipe table on the plain-text clipboard for a selected table', () => {
    const h = mount(`Intro\n\n${TABLE}`);
    placeCursor(h, cellTextPos(h, 0));
    const { view } = h.tiptap;
    const tablePos = cellTextPos(h, 0) - 4;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, tablePos)));
    const out = copy(h);
    expect(out['text/plain']).toBe('| Name | Qty |\n| --- | ---: |\n| a\\|b | **3** |\n| c | 4 |');
    expect(out['text/html']).toContain('<table');
  });

  it('copies a CellSelection of body cells with its first row as the header', () => {
    const h = mount(TABLE);
    const { view } = h.tiptap;
    view.focus();
    const sel = CellSelection.create(view.state.doc, cellTextPos(h, 2) - 2, cellTextPos(h, 5) - 2);
    view.dispatch(view.state.tr.setSelection(sel));
    const out = copy(h);
    expect(out['text/plain']).toBe('| a\\|b | **3** |\n| --- | ---: |\n| c | 4 |');
  });

  it('copies one column of cells', () => {
    const h = mount(TABLE);
    const { view } = h.tiptap;
    view.focus();
    view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellTextPos(h, 1) - 2, cellTextPos(h, 5) - 2)));
    expect(copy(h)['text/plain']).toBe('| Qty |\n| ---: |\n| **3** |\n| 4 |');
  });

  it('keeps paragraphs around a copied table as plain text', () => {
    const h = mount(`Intro **bold**\n\n${TABLE}\nAfter\n`);
    const { view } = h.tiptap;
    view.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1)));
    const text = copy(h)['text/plain'];
    expect(text.startsWith('Intro bold\n\n| Name | Qty |')).toBe(true);
    expect(text.endsWith('| c | 4 |\n\nAfter')).toBe(true);
  });

  it('leaves copies without a table to the default serializer', () => {
    const h = mount('One **two**\n\nThree\n');
    const { view } = h.tiptap;
    view.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1)));
    expect(copy(h)['text/plain']).toBe('One two\n\nThree');
    expect(sliceToMarkdown(h.tiptap, view.state.selection.content())).toBeNull();
  });

  it('copied text pastes back as the same table', () => {
    const h = mount(TABLE);
    const { view } = h.tiptap;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));
    const text = copy(h)['text/plain'];
    const target = mount('Start\n');
    placeCursor(target, 6);
    paste(target, { 'text/plain': text });
    expect(target.getMarkdown()).toContain(TABLE.trimEnd());
  });
});

describe('Copy Table as Markdown', () => {
  it('writes the whole table from a cursor in a cell', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const h = mount(`Intro\n\n${TABLE}`);
    placeCursor(h, cellTextPos(h, 3));
    expect(tableMarkdownAt(h.tiptap)).toBe(TABLE);
    const entry = buildTableMenu(h.tiptap).find((e) => 'label' in e && e.label === 'Copy Table as Markdown');
    expect(entry).toBeDefined();
    (entry as { action: () => void }).action();
    expect(writeText).toHaveBeenCalledWith(TABLE);
  });
});

// ── Smart paste: merged cells and alignment ─────────────────────────────────

describe('Smart paste of spreadsheet tables', () => {
  function pasteHtml(html: string): MikeDownEditorHandle {
    const h = mount('Intro\n');
    placeCursor(h, 6);
    paste(h, { 'text/html': html, 'text/plain': 'ignored' });
    return h;
  }

  it('gives a colspan empty cells instead of copies', () => {
    const h = pasteHtml(
      '<table><tr><td colspan="3">Q1 report</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>',
    );
    const md = h.getMarkdown();
    expect(md).not.toContain('<table');
    expect(md).toContain('| Q1 report |  |  |\n| --- | --- | --- |\n| a | b | c |');
  });

  it('expands a rowspan into empty cells below', () => {
    const h = pasteHtml(
      '<table><tr><td>Region</td><td>City</td></tr>'
      + '<tr><td rowspan="2">East</td><td>Boston</td></tr>'
      + '<tr><td>NYC</td></tr>'
      + '<tr><td>West</td><td>LA</td></tr></table>',
    );
    const md = h.getMarkdown();
    expect(md).not.toContain('<table');
    expect(md).toContain('| Region | City |\n| --- | --- |\n| East | Boston |\n|  | NYC |\n| West | LA |');
  });

  it('expands a rowspan in a middle column', () => {
    const h = pasteHtml(
      '<table><tr><th>A</th><th>B</th><th>C</th></tr>'
      + '<tr><td>1</td><td rowspan="2">m</td><td>3</td></tr>'
      + '<tr><td>4</td><td>6</td></tr></table>',
    );
    expect(h.getMarkdown()).toContain('| 1 | m | 3 |\n| 4 |  | 6 |');
  });

  it('carries Google Sheets cell alignment to the delimiter row', () => {
    const h = pasteHtml(
      '<meta charset="utf-8"><google-sheets-html-origin><table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border:none">'
      + '<colgroup><col width="100"><col width="100"><col width="100"></colgroup><tbody>'
      + '<tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;">Item</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;">Qty</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:center;">Status</td></tr>'
      + '<tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;">Apples</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:right;">3</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:center;">ok</td></tr>'
      + '<tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;">Pears</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:right;">12</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:center;">low</td></tr>'
      + '</tbody></table></google-sheets-html-origin>',
    );
    const md = h.getMarkdown();
    expect(md).toContain('| Item | Qty | Status |\n| --- | ---: | :---: |\n| Apples | 3 | ok |\n| Pears | 12 | low |');
  });

  it('reads Excel-style align attributes and merged headers', () => {
    const h = pasteHtml(
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"><body><!--StartFragment--><table border=0 cellpadding=0 cellspacing=0>'
      + '<tr height=20><td colspan=2 height=20 class=xl65 align=center>Totals</td><td></td></tr>'
      + '<tr height=20><td height=20>East</td><td align=right>10</td><td align=right>x</td></tr>'
      + '<tr height=20><td height=20>West</td><td align=right>20</td><td>y</td></tr>'
      + '</table><!--EndFragment--></body></html>',
    );
    const md = h.getMarkdown();
    expect(md).not.toContain('<table');
    // The merged header doesn't vote, so column 1 stays left and column 2 is right.
    expect(md).toContain('| Totals |  |  |\n| --- | ---: | ---: |\n| East | 10 | x |\n| West | 20 | y |');
  });
});
