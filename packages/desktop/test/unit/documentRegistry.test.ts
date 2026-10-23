/**
 * The document registry and pane binding (edge case 9): one model per path,
 * edits in one attached editor reach the others without an echo, dirty
 * state follows `savedText` across panes, and save / reload / external
 * change keep every editor in step.
 */
import { describe, expect, it } from 'vitest';
import { checkExternalChanges, createDocumentRegistry, planOpen, type ReadInfo } from '../../src/documents/documentModel';
import { fakeHandle } from './helpers/app';

function info(text: string, extra: Partial<ReadInfo> = {}): ReadInfo {
  return { text, encoding: 'utf8', eol: 'lf', mtimeMs: 1, readOnly: false, size: text.length, ...extra };
}

function makeRegistry() {
  const disk = new Map<string, string>();
  const writes: Array<{ path: string; text: string }> = [];
  const registry = createDocumentRegistry({
    fs: {
      readText: async (p) => {
        const t = disk.get(p);
        if (t === undefined) {throw new Error(`ENOENT ${p}`);}
        return info(t);
      },
      writeText: async (p, text) => {
        disk.set(p, text);
        writes.push({ path: p, text });
        return { mtimeMs: 2, size: text.length };
      },
    },
  });
  return { registry, disk, writes };
}

describe('document registry', () => {
  it('keys documents by path and reuses them', () => {
    const { registry } = makeRegistry();
    const a = registry.open('/n/a.md', info('# A\n'), planOpen('/n/a.md', info('# A\n')));
    const again = registry.open('/n/a.md', info('# A2\n'), planOpen('/n/a.md', info('# A2\n')));
    expect(again).toBe(a);
    expect(a.text).toBe('# A2\n');
    expect(registry.get('/n/a.md')).toBe(a);
    expect(registry.byId(a.id)).toBe(a);
    expect(registry.all()).toEqual([a]);
    registry.close(a);
    expect(registry.get('/n/a.md')).toBeUndefined();
    expect(registry.all()).toEqual([]);
  });

  it('untitled documents have their own ids and start clean', () => {
    const { registry } = makeRegistry();
    const u1 = registry.untitled();
    const u2 = registry.untitled();
    expect(u1.id).not.toBe(u2.id);
    expect(u1.path).toBeNull();
    expect(u1.dirty).toBe(false);
    const restored = registry.untitled({ id: 'untitled:abc', text: 'draft' });
    expect(restored.id).toBe('untitled:abc');
    expect(restored.dirty).toBe(true);
  });
});

describe('pane binding', () => {
  it('loads an attached editor and propagates edits to the others without echo', () => {
    const { registry } = makeRegistry();
    const doc = registry.open('/n/a.md', info('# A\n'), planOpen('/n/a.md', info('# A\n')));
    const h1 = fakeHandle();
    const h2 = fakeHandle();
    const events: string[] = [];
    doc.on('text', () => events.push('text'));
    doc.attach(h1);
    doc.attach(h2);
    expect(h1.getMarkdown()).toBe('# A\n');
    expect(h2.getMarkdown()).toBe('# A\n');

    h1.emitChange('# A\n\nedit from pane 1\n');
    expect(doc.text).toBe('# A\n\nedit from pane 1\n');
    expect(h2.getMarkdown()).toBe('# A\n\nedit from pane 1\n');
    // One text event: h2's setMarkdown(pristine:false) echo was ignored.
    expect(events).toEqual(['text']);
    expect(doc.dirty).toBe(true);

    h2.emitChange('# A\n\nedit from pane 2\n');
    expect(h1.getMarkdown()).toBe('# A\n\nedit from pane 2\n');
    expect(events).toEqual(['text', 'text']);
  });

  it('dirty follows savedText, not the editor pristine flag, in every pane', () => {
    const { registry } = makeRegistry();
    const doc = registry.open('/n/a.md', info('# A\n'), planOpen('/n/a.md', info('# A\n')));
    const h1 = fakeHandle();
    doc.attach(h1);
    h1.emitChange('# A\n\nx\n');
    expect(doc.dirty).toBe(true);
    // A second pane opens the dirty document: it is loaded as that editor's
    // baseline, with the saved text as its markSaved baseline.
    const h2 = fakeHandle();
    doc.attach(h2);
    expect(h2.getMarkdown()).toBe('# A\n\nx\n');
    expect(h2.saved).toEqual(['# A\n']);
    expect(doc.dirty).toBe(true);
    // Pane 1 undoes back to the saved text (pristine): clean everywhere.
    h1.emitChange('# A\n', { pristine: true });
    expect(doc.dirty).toBe(false);
    expect(h2.getMarkdown()).toBe('# A\n');
  });

  it('detach stops propagation to that editor', () => {
    const { registry } = makeRegistry();
    const doc = registry.open('/n/a.md', info('a'), planOpen('/n/a.md', info('a')));
    const h1 = fakeHandle();
    const h2 = fakeHandle();
    doc.attach(h1);
    const off = doc.attach(h2);
    off();
    h1.emitChange('b');
    expect(h2.getMarkdown()).toBe('a');
    expect(doc.attachedCount()).toBe(1);
    // And an edit from a detached editor is ignored.
    h2.emitChange('zzz');
    expect(doc.text).toBe('b');
  });

  it('save writes the model text, rebaselines every editor and clears dirty', async () => {
    const { registry, writes } = makeRegistry();
    const doc = registry.open('/n/a.md', info('a', { eol: 'crlf', encoding: 'utf8-bom' }), planOpen('/n/a.md', info('a')));
    const h1 = fakeHandle();
    const h2 = fakeHandle();
    doc.attach(h1);
    doc.attach(h2);
    const saved: string[] = [];
    doc.on('saved', () => saved.push(doc.text));
    h1.emitChange('ab');
    expect(await doc.save()).toBe(true);
    expect(writes).toEqual([{ path: '/n/a.md', text: 'ab' }]);
    expect(doc.dirty).toBe(false);
    expect(doc.savedText).toBe('ab');
    expect(doc.mtimeMs).toBe(2);
    expect(h1.saved.at(-1)).toBe('ab');
    expect(h2.saved.at(-1)).toBe('ab');
    expect(saved).toEqual(['ab']);
  });

  it('save as re-keys the document in the registry', async () => {
    const { registry } = makeRegistry();
    const doc = registry.untitled();
    const h = fakeHandle();
    doc.attach(h);
    h.emitChange('new text');
    const paths: Array<string | null> = [];
    registry.onChange((d, e) => { if (e === 'path') {paths.push(d.path);} });
    expect(await doc.save('/n/new.md')).toBe(true);
    expect(doc.path).toBe('/n/new.md');
    expect(doc.kind).toBe('markdown');
    expect(registry.get('/n/new.md')).toBe(doc);
    expect(paths).toEqual(['/n/new.md']);
    expect(doc.dirty).toBe(false);
  });

  it('save with no path and no target does nothing', async () => {
    const { registry, writes } = makeRegistry();
    const doc = registry.untitled();
    expect(await doc.save()).toBe(false);
    expect(writes).toEqual([]);
  });

  it('reload re-reads the disk into every pane as the clean baseline', async () => {
    const { registry, disk } = makeRegistry();
    disk.set('/n/a.md', 'v1');
    const doc = registry.open('/n/a.md', info('v1'), planOpen('/n/a.md', info('v1')));
    const h1 = fakeHandle();
    const h2 = fakeHandle();
    doc.attach(h1);
    doc.attach(h2);
    h1.emitChange('local edit');
    disk.set('/n/a.md', 'v2 from disk');
    await doc.reload();
    expect(doc.text).toBe('v2 from disk');
    expect(doc.savedText).toBe('v2 from disk');
    expect(doc.dirty).toBe(false);
    expect(h1.getMarkdown()).toBe('v2 from disk');
    expect(h2.getMarkdown()).toBe('v2 from disk');
  });

  it('markExternalChange records the new mtime for M6 and keeps the text', () => {
    const { registry } = makeRegistry();
    const doc = registry.open('/n/a.md', info('a'), planOpen('/n/a.md', info('a')));
    const states: boolean[] = [];
    doc.on('state', () => states.push(doc.externallyChanged));
    doc.markExternalChange(999);
    expect(doc.externallyChanged).toBe(true);
    expect(doc.mtimeMs).toBe(999);
    expect(doc.text).toBe('a');
    expect(states).toEqual([true]);
  });

  it('replaceText (backup restore) pushes to every pane and dirties by savedText', () => {
    const { registry } = makeRegistry();
    const doc = registry.open('/n/a.md', info('saved'), planOpen('/n/a.md', info('saved')));
    const h = fakeHandle();
    doc.attach(h);
    doc.replaceText('restored from backup');
    expect(h.getMarkdown()).toBe('restored from backup');
    expect(doc.dirty).toBe(true);
    doc.replaceText('saved');
    expect(doc.dirty).toBe(false);
  });

  it('a read-only document is saved as writable once Save As succeeds', async () => {
    const { registry } = makeRegistry();
    const ro = info('x', { readOnly: true });
    const doc = registry.open('/n/ro.md', ro, planOpen('/n/ro.md', ro));
    const h = fakeHandle();
    const readOnly: boolean[] = [];
    h.setReadOnly = (v: boolean) => { readOnly.push(v); };
    doc.attach(h);
    expect(readOnly).toEqual([true]);
    expect(await doc.save('/n/copy.md')).toBe(true);
    expect(doc.readOnly).toBe(false);
    expect(readOnly).toEqual([true, false]);
  });

  it('on focus, marks only files whose mtime moved since this window read or saved them (edge 6)', async () => {
    const { registry, disk } = makeRegistry();
    disk.set('/n/a.md', 'a');
    const a = registry.open('/n/a.md', info('a'), planOpen('/n/a.md', info('a')));
    const b = registry.open('/n/b.md', info('b'), planOpen('/n/b.md', info('b')));
    const c = registry.open('/n/c.md', info('c'), planOpen('/n/c.md', info('c')));
    await a.save();
    expect(a.mtimeMs).toBe(2);
    const mtimes: Record<string, { exists: boolean; mtimeMs: number }> = {
      '/n/a.md': { exists: true, mtimeMs: 2 },
      '/n/b.md': { exists: true, mtimeMs: 50 },
      '/n/c.md': { exists: false, mtimeMs: 0 },
    };
    const changed = await checkExternalChanges(registry.all(), async (p) => mtimes[p]);
    expect(changed).toEqual([b]);
    expect(b.externallyChanged).toBe(true);
    expect(b.mtimeMs).toBe(50);
    expect(a.externallyChanged).toBe(false);
    expect(c.externallyChanged).toBe(false);
    // Already marked: not reported twice.
    expect(await checkExternalChanges(registry.all(), async (p) => mtimes[p])).toEqual([]);
  });
});
