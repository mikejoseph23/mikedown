import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';

let editor: Editor;

function createEditor() {
  editor = new Editor({
    extensions: [
      StarterKit,
      Markdown.configure({ html: false }),
      Link,
      Image,
      Table,
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: '<p>Hello world</p>',
    element: document.createElement('div'),
  });
}

afterEach(() => { editor?.destroy(); });

describe('Formatting Commands', () => {
  it('toggles bold', () => {
    createEditor();
    editor.commands.selectAll();
    editor.commands.toggleBold();
    const md = editor.storage.markdown.getMarkdown();
    expect(md).toContain('**');
    // Toggle off
    editor.commands.toggleBold();
    const md2 = editor.storage.markdown.getMarkdown();
    expect(md2).not.toContain('**');
  });

  it('toggles italic', () => {
    createEditor();
    editor.commands.selectAll();
    editor.commands.toggleItalic();
    const md = editor.storage.markdown.getMarkdown();
    expect(md).toMatch(/\*[^*]|_[^_]/);
  });

  it('toggles heading levels 1-3', () => {
    for (let level = 1; level <= 3; level++) {
      createEditor();
      editor.commands.setHeading({ level: level as 1 | 2 | 3 });
      expect(editor.isActive('heading', { level })).toBe(true);
    }
  });

  it('toggles bullet list', () => {
    createEditor();
    editor.commands.toggleBulletList();
    expect(editor.isActive('bulletList')).toBe(true);
  });

  it('toggles ordered list', () => {
    createEditor();
    editor.commands.toggleOrderedList();
    expect(editor.isActive('orderedList')).toBe(true);
  });

  it('toggles blockquote', () => {
    createEditor();
    editor.commands.toggleBlockquote();
    expect(editor.isActive('blockquote')).toBe(true);
  });

  it('inserts table', () => {
    createEditor();
    editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
    expect(editor.isActive('table')).toBe(true);
  });

  it('sets horizontal rule', () => {
    createEditor();
    editor.commands.setHorizontalRule();
    const md = editor.storage.markdown.getMarkdown();
    expect(md).toContain('---');
  });

  it('sets link', () => {
    createEditor();
    editor.commands.selectAll();
    editor.commands.setLink({ href: 'https://example.com' });
    expect(editor.isActive('link')).toBe(true);
  });
});
