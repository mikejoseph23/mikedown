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
} from '../../src/webview/table-align';

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
