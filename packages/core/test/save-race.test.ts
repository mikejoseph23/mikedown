/**
 * Keystrokes typed right after a save must not be treated as pristine:
 * they used to join the saved undo group (History newGroupDelay 500 ms), so
 * the undo depth still matched the saved baseline and the next change was
 * reported pristine with the old content.
 */
import { afterEach, describe, expect, it } from 'vitest';
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

describe('typing right after a save', () => {
  it('is dirty with the new text, not pristine', () => {
    const changes: Array<{ md: string; pristine: boolean }> = [];
    const host: MikeDownHost = Object.assign(new NoopHost(), {
      onChange: (md: string, meta: { pristine: boolean }) => { changes.push({ md, pristine: meta.pristine }); },
    });
    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = createMikeDownEditor(el, { host, initialMarkdown: 'Hello\n' });
    mounted.push({ handle, el });

    handle.tiptap.commands.focus('end');
    handle.tiptap.commands.insertContent('A');
    handle.markSaved();
    changes.length = 0;

    // Well inside the 500 ms grouping window.
    handle.tiptap.commands.insertContent('B');

    const last = changes[changes.length - 1];
    expect(last.pristine).toBe(false);
    expect(last.md).toContain('AB');
  });
});
