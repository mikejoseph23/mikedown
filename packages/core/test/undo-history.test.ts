/**
 * The undo history is configured through StarterKit's `undoRedo` option
 * (v3 name; `history` is silently ignored). Verify the editor's history
 * extension carries our depth and grouping delay, and that edits closer
 * together than the delay undo as a single step.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host: new NoopHost() });
  mounted.push({ handle, el });
  const editor = (el.querySelector('.ProseMirror') as unknown as { editor: Editor }).editor;
  return { handle, editor };
}

afterEach(() => {
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
});

describe('undo history configuration', () => {
  it('registers the undoRedo extension with depth 100 and newGroupDelay 500', () => {
    const { editor } = mount();
    const ext = editor.extensionManager.extensions.find(e => e.name === 'undoRedo');
    expect(ext).toBeDefined();
    expect(ext!.options).toMatchObject({ depth: 100, newGroupDelay: 500 });
  });

  it('groups edits made within newGroupDelay into one undo step', () => {
    const { handle, editor } = mount();
    handle.setMarkdown('');
    editor.commands.insertContent('a');
    editor.commands.insertContent('b');
    editor.commands.insertContent('c');
    expect(editor.getText()).toBe('abc');
    editor.commands.undo();
    expect(editor.getText()).toBe('');
  });
});
