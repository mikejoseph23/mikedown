import { describe, it, expect, afterEach } from 'vitest';
import { bootWebview, type Harness } from '../harness/webviewHarness';

/**
 * End-to-end tests for issue #5 that drive the real webview bundle in jsdom:
 * the same TipTap editor, the same CodeMirror instance, the same message
 * handler the extension host talks to. Messages in are what
 * markdownEditorProvider posts; `edit` messages out are what would be written
 * to the file.
 */

let harness: Harness | null = null;

/** Let the message handler, ProseMirror, and CodeMirror settle. */
const settle = () => new Promise(r => setTimeout(r, 30));

async function boot(content: string): Promise<Harness> {
  harness = await bootWebview();
  harness.send({ type: 'update', content });
  await settle();
  harness.clear();
  return harness;
}

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe('source mode round-trip (issue #5)', () => {
  it('keeps a source edit that was saved before toggling back to WYSIWYG', async () => {
    const onDisk = '# Title\n\nbody\n';
    const edited = '# Title\n\nbody edited in source\n';
    const h = await boot(onDisk);

    h.send({ type: 'toggleSource' });
    await settle();
    expect(h.inSourceMode()).toBe(true);
    expect(h.sourceView().state.doc.toString()).toBe(onDisk);

    h.typeInSource(edited);
    await settle();
    expect(h.last('edit')?.content).toBe(edited);

    // What the host does on Cmd+S: applyEdit, save, then echo the saved text
    // back. This is the message that used to rebaseline the comparison and make
    // the edit look like a no-op.
    h.send({ type: 'saved', content: edited });
    await settle();

    h.send({ type: 'toggleSource' });
    await settle();
    expect(h.inSourceMode()).toBe(false);
    expect(h.wysiwygText()).toContain('body edited in source');
    expect(h.wysiwygText()).not.toBe('Titlebody');
  }, 30000);

  it('does not write a stale document back over the file after that toggle', async () => {
    // The consequence of the bug: TipTap kept the pre-edit document, so the
    // next WYSIWYG keystroke serialized it straight over the saved edit.
    const h = await boot('# Title\n\nbody\n');

    h.send({ type: 'toggleSource' });
    await settle();
    h.typeInSource('# Title\n\nbody edited in source\n');
    await settle();
    h.send({ type: 'saved', content: '# Title\n\nbody edited in source\n' });
    await settle();
    h.send({ type: 'toggleSource' });
    await settle();
    h.clear();

    h.send({ type: 'command', command: 'toggleBulletList' });
    await settle();

    const written = h.last('edit')?.content ?? '';
    expect(written).toContain('body edited in source');
  }, 30000);

  it('leaves the document alone on a toggle with no source edits', async () => {
    const onDisk = '# Title\n\nbody\n';
    const h = await boot(onDisk);

    h.send({ type: 'toggleSource' });
    await settle();
    h.send({ type: 'toggleSource' });
    await settle();

    expect(h.inSourceMode()).toBe(false);
    expect(h.wysiwygText()).toContain('body');
    // A no-op toggle must not dirty the file.
    expect(h.ofType('edit').filter(m => m.content !== onDisk)).toEqual([]);
  }, 30000);

  it('picks up a source edit that was never saved', async () => {
    const h = await boot('# Title\n\nbody\n');

    h.send({ type: 'toggleSource' });
    await settle();
    h.typeInSource('# Title\n\nunsaved source edit\n');
    await settle();
    h.send({ type: 'toggleSource' });
    await settle();

    expect(h.wysiwygText()).toContain('unsaved source edit');
  }, 30000);
});

describe('serialization through the real webview (issue #5)', () => {
  it('writes angle brackets back to the host verbatim', async () => {
    const h = await boot('plain <job> and <slug> text\n');

    // Any real edit makes the webview serialize and post the whole document.
    h.send({ type: 'command', command: 'toggleBulletList' });
    await settle();

    const written = h.last('edit')?.content ?? '';
    expect(written).not.toContain('&lt;');
    expect(written).not.toContain('&gt;');
    expect(written).toContain('<job>');
    expect(written).toContain('<slug>');
  }, 30000);

  it('does not add a trailing backslash to soft-wrapped lines', async () => {
    const h = await boot('line one\nline two\n');

    h.send({ type: 'command', command: 'toggleBulletList' });
    await settle();

    const written = h.last('edit')?.content ?? '';
    expect(written).not.toMatch(/\\\n/);
    expect(written).toContain('line one');
    expect(written).toContain('line two');
  }, 30000);
});
