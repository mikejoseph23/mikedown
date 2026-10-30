import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { TableRow } from '@tiptap/extension-table-row';
import { TableAligned, TableCellAligned, TableHeaderAligned } from '../src/table-align';
import { MarkdownText, MarkdownHardBreak } from '../src/markdownText';
import { displayWidth, padTableRows } from '../src/table-pad';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

function make(content: string, padColumns = false): Editor {
  const ed = new Editor({
    extensions: [
      StarterKit.configure({ text: false, hardBreak: false } as any),
      MarkdownText,
      MarkdownHardBreak,
      Markdown.configure({ html: false, breaks: true }),
      TableAligned.configure({ resizable: false }),
      TableRow,
      TableCellAligned,
      TableHeaderAligned,
    ],
    content,
    element: document.createElement('div'),
  });
  (ed.storage as any).table.padColumns = padColumns;
  editor = ed;
  return ed;
}

const md = (ed: Editor): string => ed.storage.markdown.getMarkdown();
const width = (s: string) => displayWidth(s);

/** Cell text per row, read from the parsed document (alignment included). */
function snapshot(ed: Editor): unknown {
  return ed.getJSON();
}

describe('displayWidth', () => {
  it('counts ASCII as one column per character', () => {
    expect(width('')).toBe(0);
    expect(width('abc 123')).toBe(7);
  });

  it('counts East Asian wide characters as two', () => {
    expect(width('日本語')).toBe(6);
    expect(width('한글')).toBe(4);
    expect(width('ＡＢ')).toBe(4);
    expect(width('a日b')).toBe(4);
  });

  it('counts emoji as two, including joined sequences', () => {
    expect(width('😀')).toBe(2);
    expect(width('👨‍👩‍👧')).toBe(2);
    expect(width('🇺🇸')).toBe(2);
    expect(width('❤️')).toBe(2);
  });

  it('counts combining marks as zero', () => {
    expect(width('é')).toBe(1);
  });
});

describe('padTableRows', () => {
  it('pads to the widest cell and keeps alignment colons', () => {
    const lines = padTableRows(
      [['Name', 'Qty', 'Price'], ['Apple', '3', '1.5']],
      [null, 'center', 'right'],
    );
    expect(lines).toEqual([
      '| Name  | Qty | Price |',
      '| ----- | :-: | ----: |',
      '| Apple | 3   | 1.5   |',
    ]);
  });

  it('measures wide characters as two columns', () => {
    const lines = padTableRows([['A', 'B'], ['日本', 'x']], [null, null]);
    expect(lines).toEqual(['| A    | B   |', '| ---- | --- |', '| 日本 | x   |']);
  });

  it('fills a ragged row with empty cells', () => {
    const lines = padTableRows([['A', 'B'], ['one']], [null, null]);
    expect(lines[2]).toBe('| one |     |');
  });
});

describe('padColumns off: output is unchanged', () => {
  const source = [
    '| Name | Qty | Price |',
    '| --- | :---: | ---: |',
    '| Apple | 3 | 1.5 |',
    '| Watermelon | 12 | 10.25 |',
  ].join('\n');

  it('writes each cell as is, byte for byte', () => {
    expect(md(make(source))).toBe(`${source}\n`);
  });

  it('is the default (storage flag starts false)', () => {
    const ed = new Editor({
      extensions: [StarterKit, Markdown, TableAligned, TableRow, TableCellAligned, TableHeaderAligned],
      element: document.createElement('div'),
    });
    expect((ed.storage as any).table.padColumns).toBe(false);
    ed.destroy();
  });

  it('matches the padded flag turned back off', () => {
    const ed = make(source, true);
    expect(md(ed)).not.toBe(md(make(source)));
    (ed.storage as any).table.padColumns = false;
    expect(md(ed)).toBe(md(make(source)));
  });
});

describe('padColumns on', () => {
  it('pads every cell and the delimiter row, keeping alignment', () => {
    const ed = make(
      ['| Name | Qty | Price |', '| --- | :---: | ---: |', '| Apple | 3 | 1.5 |', '| Watermelon | 12 | 10.25 |'].join('\n'),
      true,
    );
    expect(md(ed)).toBe(
      [
        '| Name       | Qty | Price |',
        '| ---------- | :-: | ----: |',
        '| Apple      | 3   | 1.5   |',
        '| Watermelon | 12  | 10.25 |',
      ].join('\n') + '\n',
    );
  });

  it('reparses to the same document', () => {
    const ed = make(
      ['| Name | Qty | Price |', '| --- | :---: | ---: |', '| Apple | 3 | 1.5 |', '| Watermelon | 12 | 10.25 |'].join('\n'),
      true,
    );
    const padded = md(ed);
    const again = make(padded, true);
    expect(snapshot(again)).toEqual(snapshot(ed));
    expect(md(again)).toBe(padded);
  });

  it('handles mixed alignment across five columns', () => {
    const src = ['| a | b | c | d | e |', '| --- | --- | :---: | ---: | --- |', '| 1 | 22 | 333 | 4444 | 55555 |'].join('\n');
    const ed = make(src, true);
    const padded = md(ed).trim().split('\n');
    expect(padded[1]).toBe('| --- | --- | :-: | ---: | ----- |');
    expect(snapshot(make(md(ed), true))).toEqual(snapshot(ed));
  });

  it('keeps escaped pipes and measures them as written', () => {
    const src = ['| A | B |', '| --- | --- |', '| a \\| b | `x\\|y` |', '| c | d |'].join('\n');
    const ed = make(src, true);
    const out = md(ed);
    expect(out).toContain('| a \\| b | `x\\|y` |');
    expect(out).toContain('| c      | d      |');
    expect(snapshot(make(out, true))).toEqual(snapshot(ed));
  });

  it('pads wide characters and emoji by display width', () => {
    const src = ['| Word | Note |', '| --- | --- |', '| 日本語 | ok |', '| a | 😀 |'].join('\n');
    const ed = make(src, true);
    const out = md(ed);
    expect(out).toContain('| Word   | Note |');
    expect(out).toContain('| 日本語 | ok   |');
    expect(out).toContain('| a      | 😀   |');
    expect(snapshot(make(out, true))).toEqual(snapshot(ed));
  });

  it('measures a cell with <br> by its serialized text', () => {
    const src = ['| A | B |', '| --- | --- |', '| one<br>two | x |'].join('\n');
    const ed = make(src, true);
    const out = md(ed);
    expect(out).toContain('| A          | B   |');
    expect(out).toContain('| one<br>two | x   |');
    expect(snapshot(make(out, true))).toEqual(snapshot(ed));
  });

  it('fills a ragged row and reparses to a full-width table', () => {
    const src = ['| A | B | C |', '| --- | --- | --- |', '| one |', '| x | y | z |'].join('\n');
    const ed = make(src, true);
    const out = md(ed);
    const lines = out.trim().split('\n');
    expect(lines).toHaveLength(4);
    for (const line of lines) {expect(line.length).toBe(lines[0].length);}
    expect(snapshot(make(out, true))).toEqual(snapshot(ed));
  });

  it('pads a table nested in a blockquote and a list', () => {
    const quote = make('> | A | B |\n> | --- | --- |\n> | long cell | x |', true);
    expect(md(quote).trim()).toBe('> | A         | B   |\n> | --------- | --- |\n> | long cell | x   |');
    const list = make('- item\n\n  | A | B |\n  | --- | --- |\n  | long cell | x |', true);
    expect(md(list)).toContain('  | long cell | x   |');
    expect(snapshot(make(md(list), true))).toEqual(snapshot(list));
  });

  it('leaves non-table text and a following paragraph alone', () => {
    const ed = make('Before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter', true);
    expect(md(ed)).toBe('Before\n\n| A   | B   |\n| --- | --- |\n| 1   | 2   |\n\nAfter');
  });
});

describe('mikedown.tables.padColumns in the full editor', () => {
  const source = '| A | B |\n| --- | --- |\n| long cell | x |\n';
  const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

  function mount(settings?: { tablePadColumns: boolean }) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = createMikeDownEditor(el, { host: new NoopHost(), initialMarkdown: source, settings });
    mounted.push({ handle, el });
    return handle;
  }

  afterEach(() => {
    while (mounted.length) {
      const { handle, el } = mounted.pop()!;
      try { handle.destroy(); } catch { /* already destroyed */ }
      el.remove();
    }
    document.querySelectorAll('[role="dialog"]').forEach(n => n.remove());
  });

  it('is off by default', () => {
    expect(mount().tiptap.storage.markdown.getMarkdown()).toBe(source);
  });

  it('pads when set at start, and follows updateSettings both ways', () => {
    const handle = mount({ tablePadColumns: true });
    const padded = '| A         | B   |\n| --------- | --- |\n| long cell | x   |\n';
    expect(handle.tiptap.storage.markdown.getMarkdown()).toBe(padded);
    handle.updateSettings({ tablePadColumns: false });
    expect(handle.tiptap.storage.markdown.getMarkdown()).toBe(source);
    handle.updateSettings({ tablePadColumns: true });
    expect(handle.tiptap.storage.markdown.getMarkdown()).toBe(padded);
  });

  it('has a row in the Settings modal that saves the value', () => {
    const saved: Array<Record<string, unknown>> = [];
    const host = Object.assign(new NoopHost(), { saveSettings: (p: Record<string, unknown>) => { saved.push(p); } });
    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = createMikeDownEditor(el, { host, initialMarkdown: source });
    mounted.push({ handle, el });
    handle.command('openSettings');
    const row = [...document.querySelectorAll('[role="dialog"] label, [role="dialog"] div')]
      .find(n => n.textContent?.trim().startsWith('Align table columns'));
    expect(row).toBeTruthy();
    const input = row!.closest('div')!.querySelector('input[type="checkbox"]') as HTMLInputElement
      ?? row!.parentElement!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.checked = true;
    const save = [...document.querySelectorAll('[role="dialog"] button')]
      .find(b => b.textContent?.trim() === 'Save to Settings') as HTMLButtonElement;
    save.click();
    expect(saved[0]?.tablePadColumns).toBe(true);
    expect(handle.tiptap.storage.markdown.getMarkdown()).toContain('| A         | B   |');
  });
});
