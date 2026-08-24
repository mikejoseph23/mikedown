import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';

// Covers the editor-side behavior behind M2's toggleBulletList /
// toggleOrderedList / toggleTaskList command cases in editor-main.ts
// (~line 4681): `editor.chain().focus().toggle*List().run()` against the
// same extension set (StarterKit + TaskList/TaskItem) the real webview
// editor is built with. Mirrors the createTestEditor pattern in
// roundtrip.test.ts / spellcheck.test.ts since no pure logic was factored
// out for these commands to unit-test directly.

function createTestEditor(content = '') {
  return new Editor({
    extensions: [
      StarterKit,
      Markdown.configure({ html: false, tightLists: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content,
    element: document.createElement('div'),
  });
}

describe('List toggle commands', () => {
  it('toggleBulletList wraps a plain paragraph in a bullet list', () => {
    const editor = createTestEditor('Item one');
    expect(editor.isActive('bulletList')).toBe(false);

    editor.chain().focus().toggleBulletList().run();
    expect(editor.isActive('bulletList')).toBe(true);
    expect(editor.storage.markdown.getMarkdown()).toContain('- Item one');

    editor.destroy();
  });

  it('toggleBulletList unwraps an existing bullet list back to a paragraph', () => {
    const editor = createTestEditor('- Item one');
    expect(editor.isActive('bulletList')).toBe(true);

    editor.chain().focus().toggleBulletList().run();
    expect(editor.isActive('bulletList')).toBe(false);
    expect(editor.storage.markdown.getMarkdown()).not.toContain('- Item one');
    expect(editor.storage.markdown.getMarkdown()).toContain('Item one');

    editor.destroy();
  });

  it('toggleOrderedList wraps a plain paragraph in an ordered list', () => {
    const editor = createTestEditor('First');
    expect(editor.isActive('orderedList')).toBe(false);

    editor.chain().focus().toggleOrderedList().run();
    expect(editor.isActive('orderedList')).toBe(true);
    expect(editor.storage.markdown.getMarkdown()).toContain('1. First');

    editor.destroy();
  });

  it('toggleOrderedList unwraps an existing ordered list back to a paragraph', () => {
    const editor = createTestEditor('1. First');
    expect(editor.isActive('orderedList')).toBe(true);

    editor.chain().focus().toggleOrderedList().run();
    expect(editor.isActive('orderedList')).toBe(false);
    expect(editor.storage.markdown.getMarkdown()).not.toContain('1. First');

    editor.destroy();
  });

  it('toggleTaskList wraps a plain paragraph in a task list', () => {
    const editor = createTestEditor('Do the thing');
    expect(editor.isActive('taskList')).toBe(false);

    editor.chain().focus().toggleTaskList().run();
    expect(editor.isActive('taskList')).toBe(true);
    expect(editor.storage.markdown.getMarkdown()).toContain('- [ ] Do the thing');

    editor.destroy();
  });

  it('toggleTaskList unwraps an existing task list back to a paragraph', () => {
    const editor = createTestEditor('- [ ] Do the thing');
    expect(editor.isActive('taskList')).toBe(true);

    editor.chain().focus().toggleTaskList().run();
    expect(editor.isActive('taskList')).toBe(false);
    expect(editor.storage.markdown.getMarkdown()).not.toContain('[ ]');

    editor.destroy();
  });

  it('toggling bulletList on then off is idempotent (round-trips to original content)', () => {
    const editor = createTestEditor('Round trip');
    editor.chain().focus().toggleBulletList().run();
    editor.chain().focus().toggleBulletList().run();
    expect(editor.isActive('bulletList')).toBe(false);
    expect(editor.storage.markdown.getMarkdown().trim()).toBe('Round trip');
    editor.destroy();
  });
});
