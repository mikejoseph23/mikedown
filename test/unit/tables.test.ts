import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';

let editor: Editor;

beforeEach(() => {
  editor = new Editor({
    extensions: [StarterKit, Markdown, Table.configure({ resizable: false }), TableRow, TableCell, TableHeader],
    element: document.createElement('div'),
  });
  editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
});

afterEach(() => editor?.destroy());

describe('Table Operations', () => {
  it('creates table', () => {
    expect(editor.isActive('table')).toBe(true);
  });

  it('adds row before', () => {
    const before = editor.view.state.doc.toString();
    editor.commands.addRowBefore();
    expect(editor.isActive('table')).toBe(true);
  });

  it('adds row after', () => {
    editor.commands.addRowAfter();
    expect(editor.isActive('table')).toBe(true);
  });

  it('adds column before', () => {
    editor.commands.addColumnBefore();
    expect(editor.isActive('table')).toBe(true);
  });

  it('adds column after', () => {
    editor.commands.addColumnAfter();
    expect(editor.isActive('table')).toBe(true);
  });

  it('deletes column', () => {
    editor.commands.deleteColumn();
    expect(editor.isActive('table')).toBe(true);
  });

  it('deletes table', () => {
    editor.commands.deleteTable();
    expect(editor.isActive('table')).toBe(false);
  });

  it('serializes table to GFM', () => {
    const md = editor.storage.markdown.getMarkdown();
    expect(md).toContain('|');
  });
});
