/**
 * Undo of a plain-text table paste: outside a table, the first undo turns the
 * table back into the pasted text (what paste without formatting makes) and the
 * second removes it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import { createMikeDownEditor, type MikeDownEditorHandle } from '../src/index';
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

function paste(h: MikeDownEditorHandle, data: Record<string, string>): void {
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', {
    value: { getData: (t: string) => data[t] ?? '', types: Object.keys(data), files: [], items: [] },
  });
  h.tiptap.view.dom.dispatchEvent(ev);
}

function placeCursor(h: MikeDownEditorHandle, pos: number): void {
  const { view } = h.tiptap;
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
}

const countTables = (h: MikeDownEditorHandle): number => {
  let n = 0;
  h.tiptap.state.doc.descendants((node) => {
    if (node.type.name === 'table') {n++;}
    return true;
  });
  return n;
};

const PIPE = '| Name | Qty |\n| --- | ---: |\n| Apples | 3 |';
const TSV = 'a\tb\n1\t2';

describe('Undoing a plain-text table paste', () => {
  it('first undo gives the pasted text as plain lines, second removes it', () => {
    const h = mount('Intro\n');
    placeCursor(h, 6);
    paste(h, { 'text/plain': PIPE });
    expect(countTables(h)).toBe(1);

    h.tiptap.commands.undo();
    expect(countTables(h)).toBe(0);
    expect(h.tiptap.state.doc.textContent).toContain('| Name | Qty |');
    expect(h.tiptap.state.doc.textContent).toContain('| Apples | 3 |');

    h.tiptap.commands.undo();
    expect(countTables(h)).toBe(0);
    expect(h.getMarkdown().trim()).toBe('Intro');
  });

  it('the text after the first undo is what paste without formatting makes', () => {
    const a = mount('Intro\n');
    placeCursor(a, 6);
    paste(a, { 'text/plain': PIPE });
    a.tiptap.commands.undo();

    const b = mount('Intro\n');
    placeCursor(b, 6);
    insertPlainText(b.tiptap.view, PIPE);

    expect(a.tiptap.state.doc.toJSON()).toEqual(b.tiptap.state.doc.toJSON());
  });

  it('redo brings the table back', () => {
    const h = mount('Intro\n');
    placeCursor(h, 6);
    paste(h, { 'text/plain': TSV });
    const withTable = h.getMarkdown();
    h.tiptap.commands.undo();
    h.tiptap.commands.redo();
    expect(countTables(h)).toBe(1);
    expect(h.getMarkdown()).toBe(withTable);
  });

  it('the table is the same one a single-step paste would make', () => {
    const h = mount('Intro\n');
    placeCursor(h, 6);
    paste(h, { 'text/plain': PIPE });
    expect(h.getMarkdown()).toContain('| Name | Qty |\n| --- | ---: |\n| Apples | 3 |');
    expect(h.getMarkdown().startsWith('Intro')).toBe(true);
  });

  it('replaces an empty paragraph and undoes cleanly to it', () => {
    const h = mount('');
    placeCursor(h, 1);
    paste(h, { 'text/plain': TSV });
    expect(h.getMarkdown().trim()).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
    h.tiptap.commands.undo();
    expect(countTables(h)).toBe(0);
    expect(h.tiptap.state.doc.textContent).toContain('a\tb');
    h.tiptap.commands.undo();
    expect(h.getMarkdown().trim()).toBe('');
  });

  it('works in the middle of a paragraph and between blocks', () => {
    const h = mount('Alpha beta\n\nGamma\n');
    const before = h.getMarkdown();
    placeCursor(h, 7); // after "Alpha b"
    paste(h, { 'text/plain': TSV });
    expect(countTables(h)).toBe(1);
    h.tiptap.commands.undo();
    expect(countTables(h)).toBe(0);
    h.tiptap.commands.undo();
    expect(h.getMarkdown()).toBe(before);
  });

  it('is not merged into typing just before the paste', () => {
    const h = mount('Intro\n');
    placeCursor(h, 6);
    const { view } = h.tiptap;
    view.dispatch(view.state.tr.insertText(' typed', 6));
    paste(h, { 'text/plain': TSV });
    h.tiptap.commands.undo(); // table back to text
    h.tiptap.commands.undo(); // text gone
    expect(h.tiptap.state.doc.textContent).toContain('Intro typed');
    expect(countTables(h)).toBe(0);
  });

  it('inside a table, one undo restores the table from before the paste', () => {
    const h = mount('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
    const before = h.getMarkdown();
    let cell = -1;
    h.tiptap.state.doc.descendants((node, pos) => {
      if (cell < 0 && node.type.name === 'tableHeader') {cell = pos + 2;}
      return cell < 0;
    });
    placeCursor(h, cell);
    paste(h, { 'text/plain': 'x\ty\nz\tw' });
    expect(h.getMarkdown()).not.toBe(before);
    h.tiptap.commands.undo();
    expect(h.getMarkdown()).toBe(before);
  });

  it('a paste that is not a table is untouched', () => {
    const h = mount('Intro\n');
    placeCursor(h, 6);
    paste(h, { 'text/plain': 'just words' });
    expect(countTables(h)).toBe(0);
    h.tiptap.commands.undo();
    expect(h.getMarkdown().trim()).toBe('Intro');
  });
});
