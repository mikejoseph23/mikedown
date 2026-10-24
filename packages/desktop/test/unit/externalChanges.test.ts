/**
 * M6 external changes (decision "as VS Code", edge case 9): the decision
 * table, then the whole path through the document controller with a fake
 * editor handle and a mocked IPC disk:
 *
 * - clean document, file changed → silent reload, cursor kept;
 * - dirty document, file changed → edits kept, `externallyChanged`, info bar;
 * - saving it → "changed on disk" with Compare / Revert / Overwrite;
 * - the window's own save is never an external change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentRegistry, planOpen, type DocumentModel, type ReadInfo } from '../../src/documents/documentModel';
import { createExternalChanges, decideExternalChange, needsRead } from '../../src/documents/externalChanges';
import { createTestApp, fakeHandle, flush, type FakeHandle, type TestApp } from './helpers/app';
import { installIpc, uninstallIpc, type IpcCall } from './helpers/ipc';

function info(text: string, mtimeMs = 1): ReadInfo {
  return { text, encoding: 'utf8', eol: 'lf', mtimeMs, readOnly: false, size: text.length };
}

describe('decision table', () => {
  it('reads only when the mtime moved and the file exists', () => {
    expect(needsRead({ mtimeMs: 5 }, { exists: true, mtimeMs: 5 })).toBe('none');
    expect(needsRead({ mtimeMs: 5 }, { exists: true, mtimeMs: 6 })).toBe('read');
    expect(needsRead({ mtimeMs: 5 }, { exists: false, mtimeMs: 0 })).toBe('gone');
    expect(needsRead({ mtimeMs: null }, { exists: true, mtimeMs: 6 })).toBe('read');
  });

  it('clean → reload, dirty → flag, disk caught up → adopt, only mtime → touch', () => {
    const doc = { dirty: false, text: 'saved', savedText: 'saved' };
    expect(decideExternalChange(doc, 'theirs')).toBe('reload');
    expect(decideExternalChange(doc, 'saved')).toBe('touch');
    const dirty = { dirty: true, text: 'mine', savedText: 'saved' };
    expect(decideExternalChange(dirty, 'theirs')).toBe('flag');
    expect(decideExternalChange(dirty, 'mine')).toBe('adopt');
    expect(decideExternalChange(dirty, 'saved')).toBe('touch');
  });
});

describe('createExternalChanges over a real registry', () => {
  function setup() {
    const disk = new Map<string, { text: string; mtimeMs: number }>();
    const registry = createDocumentRegistry({
      fs: {
        readText: async (p) => info(disk.get(p)!.text, disk.get(p)!.mtimeMs),
        writeText: async (p, text) => { disk.set(p, { text, mtimeMs: 99 }); return { mtimeMs: 99, size: text.length }; },
      },
    });
    const saving = new Set<DocumentModel>();
    const reloaded: string[] = [];
    const flagged: string[] = [];
    const cleared: string[] = [];
    const external = createExternalChanges({
      fs: {
        stat: async (p) => ({ exists: disk.has(p), mtimeMs: disk.get(p)?.mtimeMs ?? 0 }),
        readText: async (p) => info(disk.get(p)!.text, disk.get(p)!.mtimeMs),
      },
      docs: () => registry.all(),
      isSaving: (d) => saving.has(d),
      reload: (d, i) => { reloaded.push(d.path!); d.loadRead(i, planOpen(d.path!, i)); },
      flagged: (d) => flagged.push(d.path!),
      cleared: (d) => cleared.push(d.path!),
      dirname: (p) => p.slice(0, p.lastIndexOf('/')),
    });
    disk.set('/n/a.md', { text: 'one', mtimeMs: 1 });
    const doc = registry.open('/n/a.md', info('one', 1), planOpen('/n/a.md', info('one')));
    const handle = fakeHandle();
    doc.attach(handle);
    return { disk, registry, doc, handle, external, saving, reloaded, flagged, cleared };
  }

  it('a clean document reloads silently', async () => {
    const t = setup();
    t.disk.set('/n/a.md', { text: 'two', mtimeMs: 2 });
    expect(await t.external.check(t.doc)).toBe('reload');
    expect(t.doc.text).toBe('two');
    expect(t.doc.dirty).toBe(false);
    expect(t.handle.getMarkdown()).toBe('two');
    expect(t.reloaded).toEqual(['/n/a.md']);
  });

  it('a dirty document keeps its edits and is flagged', async () => {
    const t = setup();
    t.handle.emitChange('mine');
    t.disk.set('/n/a.md', { text: 'theirs', mtimeMs: 2 });
    expect(await t.external.check(t.doc)).toBe('flag');
    expect(t.doc.text).toBe('mine');
    expect(t.doc.dirty).toBe(true);
    expect(t.doc.externallyChanged).toBe(true);
    expect(t.doc.mtimeMs).toBe(2);
    expect(t.flagged).toEqual(['/n/a.md']);
    // Nothing new on disk: no second flag.
    expect(await t.external.check(t.doc)).toBe('none');
  });

  it('the disk catching up with the buffer makes the tab clean without a write', async () => {
    const t = setup();
    t.handle.emitChange('mine');
    t.disk.set('/n/a.md', { text: 'mine', mtimeMs: 3 });
    expect(await t.external.check(t.doc)).toBe('adopt');
    expect(t.doc.dirty).toBe(false);
    expect(t.doc.savedText).toBe('mine');
    expect(t.handle.saved).toEqual(['mine']);
  });

  it('a touch (same text, new mtime) clears an earlier flag', async () => {
    const t = setup();
    t.handle.emitChange('mine');
    t.disk.set('/n/a.md', { text: 'theirs', mtimeMs: 2 });
    await t.external.check(t.doc);
    t.disk.set('/n/a.md', { text: 'one', mtimeMs: 4 });
    expect(await t.external.check(t.doc)).toBe('touch');
    expect(t.doc.externallyChanged).toBe(false);
    expect(t.doc.dirty).toBe(true);
    expect(t.cleared).toEqual(['/n/a.md']);
  });

  it('skips documents mid-save and files that are gone', async () => {
    const t = setup();
    t.disk.set('/n/a.md', { text: 'two', mtimeMs: 2 });
    t.saving.add(t.doc);
    expect(await t.external.check(t.doc)).toBe('none');
    t.saving.clear();
    t.disk.delete('/n/a.md');
    expect(await t.external.check(t.doc)).toBe('gone');
    expect(t.doc.text).toBe('one');
  });

  it('watcher events for the file or its folder check the document once per burst', async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      t.disk.set('/n/a.md', { text: 'two', mtimeMs: 2 });
      t.external.handleFsChange({ kind: 'create', path: '/n/.a.md.mikedown-1.tmp', dir: '/n' });
      t.external.handleFsChange({ kind: 'rename', path: '/n/a.md', dir: '/n' });
      t.external.handleFsChange({ kind: 'modify', path: '/other/b.md', dir: '/other' });
      await vi.advanceTimersByTimeAsync(200);
      expect(t.reloaded).toEqual(['/n/a.md']);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── Through the controller (save → dialog) ──────────────────────────────────

const FILE = '/Users/mike/notes/a.md';
let disk: Map<string, { text: string; mtimeMs: number }>;
let calls: IpcCall[];
let app: TestApp;
let handle: FakeHandle;
let compareResult: 'overwrite' | 'revert' | null;
let compared: Array<{ diskText: string; buffer: string }>;

function ipc(cmd: string, args: any): unknown {
  switch (cmd) {
    case 'stat': {
      const f = disk.get(args.path);
      return f
        ? { exists: true, isFile: true, isDir: false, mtimeMs: f.mtimeMs, size: f.text.length, readOnly: false }
        : { exists: false, isFile: false, isDir: false, mtimeMs: 0, size: 0, readOnly: false };
    }
    case 'read_text': {
      const f = disk.get(args.path);
      if (!f) {throw new Error(`ENOENT ${args.path}`);}
      return info(f.text, f.mtimeMs);
    }
    case 'write_text': {
      const mtimeMs = (disk.get(args.path)?.mtimeMs ?? 0) + 100;
      disk.set(args.path, { text: args.text, mtimeMs });
      return { mtimeMs, size: args.text.length };
    }
    default:
      return null;
  }
}

function chooseDialog(): HTMLElement | null {
  return document.querySelector('.mdapp-modal--choose');
}

async function press(label: string): Promise<void> {
  for (let i = 0; i < 20 && !chooseDialog(); i++) {await flush();}
  const dialog = chooseDialog();
  if (!dialog) {throw new Error('no dialog');}
  const btn = [...dialog.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!btn) {throw new Error(`no button ${label}: ${[...dialog.querySelectorAll('button')].map((b) => b.textContent).join(', ')}`);}
  btn.click();
}

const writes = (): string[] => calls.filter((c) => c.cmd === 'write_text').map((c) => (c.args as { text: string }).text);

describe('external changes through the document controller', () => {
  beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    disk = new Map([[FILE, { text: '# A\n\nsaved\n', mtimeMs: 1 }]]);
    compareResult = null;
    compared = [];
    calls = installIpc(ipc);
    handle = fakeHandle();
    app = createTestApp(handle, {
      controller: {
        compareWithDisk: async ({ doc, diskText }) => {
          compared.push({ diskText, buffer: doc.text });
          return compareResult;
        },
      },
    });
    expect(await app.controller.openPath(FILE)).toBe(true);
  });

  afterEach(() => {
    document.querySelectorAll('.mdapp-modal-backdrop').forEach((n) => n.remove());
    app.dispose();
    uninstallIpc();
    vi.restoreAllMocks();
  });

  it('clean tab: the file changed on disk reloads silently, cursor kept', async () => {
    handle.viewState = { sourceMode: false, cursor: 4, scrollTop: 120 };
    const setViewState = vi.spyOn(handle, 'setViewState');
    disk.set(FILE, { text: '# A\n\nchanged elsewhere\n', mtimeMs: 2 });
    await app.controller.external.checkAll();
    expect(app.model.text).toBe('# A\n\nchanged elsewhere\n');
    expect(app.model.dirty).toBe(false);
    expect(handle.getMarkdown()).toBe('# A\n\nchanged elsewhere\n');
    expect(setViewState).toHaveBeenCalledWith({ cursor: 4, scrollTop: 120 });
    expect(chooseDialog()).toBeNull();
    expect(writes()).toEqual([]);
  });

  it('dirty tab: edits stay, the tab is flagged with an info bar', async () => {
    handle.emitChange('# A\n\nmine\n');
    disk.set(FILE, { text: '# A\n\ntheirs\n', mtimeMs: 2 });
    await app.controller.external.checkAll();
    expect(app.model.text).toBe('# A\n\nmine\n');
    expect(app.model.dirty).toBe(true);
    expect(app.model.externallyChanged).toBe(true);
    expect(app.model.notice?.text).toMatch(/changed on disk/);
    expect(app.model.notice?.action?.label).toBe('Compare');
  });

  it('saving a flagged tab asks; Overwrite writes the buffer', async () => {
    handle.emitChange('# A\n\nmine\n');
    disk.set(FILE, { text: '# A\n\ntheirs\n', mtimeMs: 2 });
    const saved = app.controller.save();
    await press('Overwrite');
    expect(await saved).toBe(true);
    expect(writes()).toEqual(['# A\n\nmine\n']);
    expect(disk.get(FILE)!.text).toBe('# A\n\nmine\n');
    expect(app.model.dirty).toBe(false);
    expect(app.model.externallyChanged).toBe(false);
    expect(app.model.notice).toBeNull();
  });

  it('the dialog offers Cancel, Compare, Revert, Overwrite; Revert reloads from disk without writing', async () => {
    handle.emitChange('# A\n\nmine\n');
    disk.set(FILE, { text: '# A\n\ntheirs\n', mtimeMs: 2 });
    const saved = app.controller.save();
    for (let i = 0; i < 20 && !chooseDialog(); i++) {await flush();}
    expect([...chooseDialog()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Cancel', 'Compare…', 'Revert', 'Overwrite']);
    expect(chooseDialog()!.textContent).toContain('“a.md” changed on disk.');
    await press('Revert');
    expect(await saved).toBe(true);
    expect(writes()).toEqual([]);
    expect(app.model.text).toBe('# A\n\ntheirs\n');
    expect(app.model.dirty).toBe(false);
    expect(handle.getMarkdown()).toBe('# A\n\ntheirs\n');
  });

  it('Compare shows the disk text against the buffer; its Overwrite writes', async () => {
    handle.emitChange('# A\n\nmine\n');
    disk.set(FILE, { text: '# A\n\ntheirs\n', mtimeMs: 2 });
    compareResult = 'overwrite';
    const saved = app.controller.save();
    await press('Compare…');
    expect(await saved).toBe(true);
    expect(compared).toEqual([{ diskText: '# A\n\ntheirs\n', buffer: '# A\n\nmine\n' }]);
    expect(writes()).toEqual(['# A\n\nmine\n']);
  });

  it('Compare closed without a choice, or Cancel, writes nothing and keeps the flag', async () => {
    handle.emitChange('# A\n\nmine\n');
    disk.set(FILE, { text: '# A\n\ntheirs\n', mtimeMs: 2 });
    let saved = app.controller.save();
    await press('Compare…');
    expect(await saved).toBe(false);
    saved = app.controller.save();
    await press('Cancel');
    expect(await saved).toBe(false);
    expect(writes()).toEqual([]);
    expect(app.model.dirty).toBe(true);
    expect(app.model.externallyChanged).toBe(true);
  });

  it('a plain save does not ask, and its own write is not an external change', async () => {
    handle.emitChange('# A\n\nmine\n');
    expect(await app.controller.save()).toBe(true);
    expect(chooseDialog()).toBeNull();
    expect(writes()).toEqual(['# A\n\nmine\n']);
    app.controller.external.handleFsChange({ kind: 'modify', path: FILE, dir: '/Users/mike/notes' });
    await new Promise((r) => setTimeout(r, 120));
    await app.controller.external.checkAll();
    expect(app.model.externallyChanged).toBe(false);
    expect(app.model.dirty).toBe(false);
  });
});
