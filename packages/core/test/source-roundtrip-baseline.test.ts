/**
 * An unedited trip through source mode must leave the saved-state baseline
 * alone. It used to reset the baseline to the re-serialized text, so undoing
 * back to the saved state reported the edited text as the clean content.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle, type MikeDownHost } from '../src/index';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];
afterEach(() => {
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
});

function setup(initial: string) {
  const changes: Array<{ md: string; pristine: boolean }> = [];
  const host: MikeDownHost = Object.assign(new NoopHost(), {
    onChange: (md: string, meta: { pristine: boolean }) => { changes.push({ md, pristine: meta.pristine }); },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host, initialMarkdown: initial });
  mounted.push({ handle, el });
  return { handle, changes };
}

describe('unedited source-mode round trip', () => {
  it('keeps the original text as the clean baseline', () => {
    // `*` bullets re-serialize as `-`, so original and serialized differ.
    const original = '* item\n';
    const { handle, changes } = setup(original);

    handle.tiptap.commands.focus('end');
    handle.tiptap.commands.insertContent('A');
    handle.command('toggleSource');
    handle.command('toggleSource');
    changes.length = 0;

    handle.tiptap.commands.undo();
    const last = changes[changes.length - 1];
    expect(last.pristine).toBe(true);
    expect(last.md).toBe(original);
  });

  it('still reports a source-mode edit as dirty', () => {
    const { handle, changes } = setup('* item\n');
    handle.command('toggleSource');
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement);
    expect(view).toBeTruthy();
    view!.dispatch({ changes: { from: 0, insert: 'X' } });
    const last = changes[changes.length - 1];
    expect(last.pristine).toBe(false);
  });
});
