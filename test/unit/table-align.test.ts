import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { TableRow } from '@tiptap/extension-table-row';
import {
  TableAligned,
  TableCellAligned,
  TableHeaderAligned,
  setColumnAlign,
  getColumnAlign,
} from '@mikedown/core/table-align';
import { MarkdownText, MarkdownHardBreak } from '@mikedown/core/markdownText';

let editor: Editor;

function makeEditor(content = '') {
  return new Editor({
    extensions: [
      StarterKit,
      Markdown,
      TableAligned.configure({ resizable: false }),
      TableRow,
      TableCellAligned,
      TableHeaderAligned,
    ],
    content,
    element: document.createElement('div'),
  });
}

afterEach(() => editor?.destroy());

describe('Per-column table alignment', () => {
  it('parses alignment markers from markdown into cell attrs', () => {
    const md = ['| L | C | R |', '| :--- | :---: | ---: |', '| a | b | c |'].join('\n');
    editor = makeEditor(md);
    const aligns: (string | null)[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'tableHeader') aligns.push(node.attrs.textAlign ?? null);
    });
    expect(aligns).toEqual(['left', 'center', 'right']);
  });

  it('serializes center/right markers and leaves left as plain ---', () => {
    const md = ['| L | C | R |', '| :--- | :---: | ---: |', '| a | b | c |'].join('\n');
    editor = makeEditor(md);
    const out = editor.storage.markdown.getMarkdown();
    // Left collapses to the default `---`; center/right keep their markers.
    expect(out).toContain('| --- | :---: | ---: |');
  });

  it('defaults to plain --- when no alignment is set', () => {
    editor = makeEditor();
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    const out = editor.storage.markdown.getMarkdown();
    expect(out).toContain('| --- | --- |');
    expect(out).not.toContain(':---');
  });

  it('setColumnAlign applies to every cell in the column', () => {
    editor = makeEditor();
    editor.commands.insertTable({ rows: 3, cols: 2, withHeaderRow: true });
    // Cursor lands in the first cell after insert.
    setColumnAlign(editor, 'right');
    const out = editor.storage.markdown.getMarkdown();
    // First column right-aligned, second untouched.
    expect(out).toContain('| ---: | --- |');
    expect(getColumnAlign(editor)).toBe('right');
  });

  it('round-trips a mixed-alignment table unchanged', () => {
    const md = [
      '| Name | Qty | Price |',
      '| --- | ---: | :---: |',
      '| Apple | 3 | 1.00 |',
      '| Pear | 12 | 2.50 |',
    ].join('\n');
    editor = makeEditor(md);
    const out = editor.storage.markdown.getMarkdown().trim();
    expect(out).toBe(md);
  });
});

describe('Line breaks in table cells (issue #9)', () => {
  function makeMikeDownEditor(content: string) {
    return new Editor({
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
  }

  const table = (cell: string) => ['| A | B |', '| --- | --- |', `| ${cell} | x |`].join('\n');

  it('parses <br> in a cell as a hard break even with html off', () => {
    editor = makeMikeDownEditor(table('one<br>two'));
    const types: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'hardBreak') types.push(node.type.name);
    });
    expect(types).toEqual(['hardBreak']);
    expect(editor.storage.markdown.getMarkdown()).toContain('| one<br>two | x |');
  });

  it('keeps a pipe table when a cell is split into paragraphs', () => {
    editor = makeMikeDownEditor(table('onetwo'));
    let pos = -1;
    editor.state.doc.descendants((node, p) => {
      if (node.isText && node.text === 'onetwo') pos = p + 3;
    });
    editor.commands.setTextSelection(pos);
    editor.commands.splitBlock();
    const out = editor.storage.markdown.getMarkdown();
    expect(out).not.toContain('<table');
    expect(out).toContain('| one<br>two | x |');
  });
});
