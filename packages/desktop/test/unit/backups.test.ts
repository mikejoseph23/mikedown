/**
 * Hot-exit backups (edge cases 7–8): the debounce, the keys and index
 * metadata, clearing on save/close, flush before quit, and the restore plan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backupKey, backupMeta, createBackupScheduler, planRestore, type BackupScheduler } from '../../src/documents/backups';
import { createDocumentRegistry, planOpen, type DocumentModel, type ReadInfo } from '../../src/documents/documentModel';
import type { BackupEntry, BackupMeta } from '../../src/documents/fsApi';
import { fakeHandle } from './helpers/app';

function info(text: string): ReadInfo {
  return { text, encoding: 'utf8', eol: 'lf', mtimeMs: 1, readOnly: false, size: text.length };
}

let writes: Array<{ key: string; text: string; meta: BackupMeta }>;
let removes: string[];
let scheduler: BackupScheduler;
let registry: ReturnType<typeof createDocumentRegistry>;

beforeEach(() => {
  vi.useFakeTimers();
  writes = [];
  removes = [];
  registry = createDocumentRegistry({ fs: { readText: async () => info(''), writeText: async (_p, text) => ({ mtimeMs: 2, size: text.length }) } });
  scheduler = createBackupScheduler({
    api: {
      backupWrite: async (key, text, meta) => { writes.push({ key, text, meta }); return 'hash'; },
      backupRemove: async (key) => { removes.push(key); },
    },
    folder: () => '/n',
    debounceMs: 1000,
  });
});

afterEach(() => {
  scheduler.dispose();
  vi.useRealTimers();
});

function openDoc(path = '/n/a.md', text = 'saved'): DocumentModel {
  const doc = registry.open(path, info(text), planOpen(path, info(text)));
  const h = fakeHandle();
  doc.attach(h);
  registry.onChange((d, e) => { if (e === 'text' || e === 'dirty') {scheduler.touch(d);} });
  return Object.assign(doc, { h }) as DocumentModel & { h: ReturnType<typeof fakeHandle> };
}

describe('keys and metadata', () => {
  it('uses the path for files and the id for untitled documents', () => {
    expect(backupKey({ id: 'file:/n/a.md', path: '/n/a.md' })).toBe('/n/a.md');
    expect(backupKey({ id: 'untitled:x1', path: null })).toBe('untitled:x1');
    expect(backupMeta({ id: 'file:/n/a.md', path: '/n/a.md' }, '/n')).toEqual({ path: '/n/a.md', untitledId: null, folder: '/n' });
    expect(backupMeta({ id: 'untitled:x1', path: null }, null)).toEqual({ path: null, untitledId: 'untitled:x1', folder: null });
  });
});

describe('scheduler', () => {
  it('writes about a second after the last edit, once', async () => {
    const doc = openDoc() as DocumentModel & { h: ReturnType<typeof fakeHandle> };
    doc.h.emitChange('saved 1');
    await vi.advanceTimersByTimeAsync(600);
    doc.h.emitChange('saved 12');
    await vi.advanceTimersByTimeAsync(600);
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(writes).toEqual([{ key: '/n/a.md', text: 'saved 12', meta: { path: '/n/a.md', untitledId: null, folder: '/n' } }]);
    expect(scheduler.written()).toEqual(['/n/a.md']);
  });

  it('a document that becomes clean again before the timer never writes, and an existing backup is removed', async () => {
    const doc = openDoc() as DocumentModel & { h: ReturnType<typeof fakeHandle> };
    doc.h.emitChange('x');
    doc.h.emitChange('saved', { pristine: true });
    await vi.advanceTimersByTimeAsync(1500);
    expect(writes).toEqual([]);
    expect(removes).toEqual([]);
    doc.h.emitChange('y');
    await vi.advanceTimersByTimeAsync(1500);
    expect(writes).toHaveLength(1);
    doc.h.emitChange('saved', { pristine: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(removes).toEqual(['/n/a.md']);
    expect(scheduler.written()).toEqual([]);
  });

  it('save clears the backup; close clears it too', async () => {
    const doc = openDoc() as DocumentModel & { h: ReturnType<typeof fakeHandle> };
    doc.h.emitChange('edited');
    await vi.advanceTimersByTimeAsync(1100);
    expect(writes).toHaveLength(1);
    await doc.save();
    await vi.advanceTimersByTimeAsync(0);
    expect(removes).toEqual(['/n/a.md']);
    // After another edit and a close, the clear is explicit.
    doc.h.emitChange('edited again');
    await vi.advanceTimersByTimeAsync(1100);
    expect(writes).toHaveLength(2);
    await scheduler.clear(doc);
    expect(removes).toEqual(['/n/a.md', '/n/a.md']);
  });

  it('flush writes every pending backup right away (before quit)', async () => {
    const a = openDoc('/n/a.md') as DocumentModel & { h: ReturnType<typeof fakeHandle> };
    const b = openDoc('/n/b.md') as DocumentModel & { h: ReturnType<typeof fakeHandle> };
    a.h.emitChange('A');
    b.h.emitChange('B');
    await scheduler.flush();
    expect(writes.map((w) => w.key).sort()).toEqual(['/n/a.md', '/n/b.md']);
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toHaveLength(2);
  });

  it('untitled documents are backed up under their id', async () => {
    const doc = registry.untitled();
    const h = fakeHandle();
    doc.attach(h);
    registry.onChange((d, e) => { if (e === 'text' || e === 'dirty') {scheduler.touch(d);} });
    h.emitChange('draft');
    await vi.advanceTimersByTimeAsync(1100);
    expect(writes).toEqual([{ key: doc.id, text: 'draft', meta: { path: null, untitledId: doc.id, folder: '/n' } }]);
  });

  it('a failed write is reported, not thrown', async () => {
    const errors: unknown[] = [];
    const failing = createBackupScheduler({
      api: { backupWrite: async () => { throw new Error('disk full'); }, backupRemove: async () => {} },
      folder: () => null,
      debounceMs: 10,
      onError: (e) => errors.push(e),
    });
    const doc = openDoc();
    (doc as DocumentModel & { h: ReturnType<typeof fakeHandle> }).h.emitChange('x');
    failing.touch(doc);
    await vi.advanceTimersByTimeAsync(50);
    expect(errors).toHaveLength(1);
    failing.dispose();
  });
});

describe('restore plan', () => {
  it('files restore into their document, untitled into new tabs, orphans are kept as untitled', () => {
    const entries: BackupEntry[] = [
      { key: 'h1', path: '/n/a.md', untitledId: null, folder: '/n', savedAt: 1, text: 'A edited' },
      { key: 'h2', path: null, untitledId: 'untitled:u1', folder: '/n', savedAt: 2, text: 'draft' },
      { key: 'abcdef0123', path: null, untitledId: null, folder: null, savedAt: 3, text: 'orphan' },
      { key: 'h4', path: null, untitledId: null, folder: null, savedAt: 4, text: '   ' },
    ];
    expect(planRestore(entries)).toEqual([
      { kind: 'file', path: '/n/a.md', text: 'A edited' },
      { kind: 'untitled', id: 'untitled:u1', text: 'draft' },
      { kind: 'untitled', id: 'untitled:recovered-abcdef01', text: 'orphan' },
    ]);
  });
});
