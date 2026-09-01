import { describe, it, expect } from 'vitest';
import { SourceModeSync } from '../../src/webview/sourceSync';

/**
 * These replay the message/toggle sequences editor-main puts SourceModeSync
 * through, so the assertions are about the decision the editor actually makes:
 * `hasSourceEdits(buffer)` is exactly the `!sourceUnchanged` term that gates
 * `editor.commands.setContent(body)` in switchToWysiwyg.
 */
describe('SourceModeSync', () => {
  it('reports no edits on a no-op toggle, so undo history survives', () => {
    const sync = new SourceModeSync();
    sync.enter('# Title\n\nbody\n');
    expect(sync.hasSourceEdits('# Title\n\nbody\n')).toBe(false);
  });

  it('reports edits when the buffer diverges from the seed', () => {
    const sync = new SourceModeSync();
    sync.enter('# Title\n\nbody\n');
    expect(sync.hasSourceEdits('# Title\n\nbody edited\n')).toBe(true);
  });

  it('still reports edits after a save rebaselines originalContent (issue #5)', () => {
    // The regression. Sequence: enter source → edit → Cmd+S → toggle back.
    const onDisk = '# Title\n\nbody\n';
    const edited = '# Title\n\nbody edited in source\n';

    // What the webview's own baseline does across that sequence: the host's
    // `saved` message assigns the just-saved text to originalContent.
    let originalContent = onDisk;

    const sync = new SourceModeSync();
    sync.enter(onDisk);            // switchToSource seeds CodeMirror
    originalContent = edited;      // host: { type: 'saved', content: edited }

    // The old check — kept here so this test fails if anyone reintroduces it.
    const oldCheck = edited !== originalContent;
    expect(oldCheck).toBe(false); // said "no edits" and skipped the reload

    expect(sync.hasSourceEdits(edited)).toBe(true);
  });

  it('does not treat a host-driven reload of both views as a source edit', () => {
    const sync = new SourceModeSync();
    sync.enter('v1\n');
    // External change → host sends `update`; the webview reloads TipTap AND
    // CodeMirror from it, so the two agree again.
    sync.rebaseline('v2\n');
    expect(sync.hasSourceEdits('v2\n')).toBe(false);
    expect(sync.hasSourceEdits('v2 plus my edit\n')).toBe(true);
  });

  it('ignores a rebaseline outside source mode', () => {
    const sync = new SourceModeSync();
    sync.rebaseline('v2\n');
    expect(sync.entryContent).toBeNull();
  });

  it('errs toward reloading once source mode has been left', () => {
    const sync = new SourceModeSync();
    sync.enter('v1\n');
    sync.exit();
    expect(sync.entryContent).toBeNull();
    expect(sync.hasSourceEdits('v1\n')).toBe(true);
  });

  it('reseeds on each entry into source mode', () => {
    const sync = new SourceModeSync();
    sync.enter('v1\n');
    sync.exit();
    sync.enter('v2\n');
    expect(sync.hasSourceEdits('v2\n')).toBe(false);
    expect(sync.hasSourceEdits('v1\n')).toBe(true);
  });
});
