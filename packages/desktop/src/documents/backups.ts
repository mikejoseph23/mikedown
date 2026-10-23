/**
 * Hot-exit backups (edge cases 7–8). Each dirty document's text is written
 * about a second after its last edit to `<app-data>/backups/<sha256 of
 * key>.md` through the `backup_write` command (Rust keeps `index.json`). The
 * backup goes away when the document is saved, closed or discarded, and the
 * leftovers are restored into dirty tabs on the next launch without a dialog.
 *
 * The scheduler is pure apart from the `AppDataApi` it is given, so the
 * debounce and the index bookkeeping are unit-tested with fake timers.
 */
import type { AppDataApi, BackupEntry, BackupMeta } from './fsApi';
import type { DocumentModel } from './documentModel';

export const BACKUP_DEBOUNCE_MS = 1000;

/** The backup key of a document: its path, or `untitled:<id>` (which `id` already is). */
export function backupKey(doc: Pick<DocumentModel, 'id' | 'path'>): string {
  return doc.path ?? doc.id;
}

export function backupMeta(doc: Pick<DocumentModel, 'id' | 'path'>, folder: string | null): BackupMeta {
  return {
    path: doc.path,
    untitledId: doc.path ? null : doc.id,
    folder,
  };
}

export interface BackupScheduler {
  /** The document's text or dirty flag changed: (re)schedule or clear its backup. */
  touch(doc: DocumentModel): void;
  /** The document was saved, closed or discarded: drop its backup now (whether or not this run wrote it). */
  clear(doc: Pick<DocumentModel, 'id' | 'path'>): Promise<void>;
  /** A backup from an earlier run was restored into this document: treat it as written. */
  noteWritten(doc: Pick<DocumentModel, 'id' | 'path'>): void;
  /** Write every pending backup right away (before a quit or close). */
  flush(): Promise<void>;
  /** Keys with a backup written and not yet cleared. */
  written(): string[];
  dispose(): void;
}

export interface BackupDeps {
  api: Pick<AppDataApi, 'backupWrite' | 'backupRemove'>;
  folder(): string | null;
  debounceMs?: number;
  onError?(err: unknown): void;
}

export function createBackupScheduler(deps: BackupDeps): BackupScheduler {
  const delay = deps.debounceMs ?? BACKUP_DEBOUNCE_MS;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, DocumentModel>();
  const written = new Set<string>();
  let disposed = false;

  function fail(err: unknown): void {
    if (deps.onError) {deps.onError(err);}
    else {console.warn('MikeDown: backup failed', err);}
  }

  async function write(doc: DocumentModel): Promise<void> {
    const key = backupKey(doc);
    pending.delete(key);
    if (!doc.dirty) {return;}
    try {
      await deps.api.backupWrite(key, doc.text, backupMeta(doc, deps.folder()));
      written.add(key);
    } catch (err) {
      fail(err);
    }
  }

  async function remove(key: string, force: boolean): Promise<void> {
    clearTimeout(timers.get(key));
    timers.delete(key);
    pending.delete(key);
    if (!force && !written.has(key)) {return;}
    written.delete(key);
    try {
      await deps.api.backupRemove(key);
    } catch (err) {
      fail(err);
    }
  }

  return {
    touch(doc) {
      if (disposed) {return;}
      const key = backupKey(doc);
      if (!doc.dirty) {
        void remove(key, false);
        return;
      }
      pending.set(key, doc);
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(() => {
        timers.delete(key);
        void write(doc);
      }, delay));
    },
    clear: (doc) => remove(backupKey(doc), true),
    noteWritten: (doc) => { written.add(backupKey(doc)); },
    async flush() {
      const docs = [...pending.values()];
      for (const t of timers.values()) {clearTimeout(t);}
      timers.clear();
      await Promise.all(docs.map(write));
    },
    written: () => [...written],
    dispose() {
      disposed = true;
      for (const t of timers.values()) {clearTimeout(t);}
      timers.clear();
      pending.clear();
    },
  };
}

/**
 * What to do with each leftover backup on launch (pure, for the tests):
 * a file backup restores into its document (opened from disk when the
 * session did not already), an unsaved one becomes a new Untitled tab.
 */
export type RestoreStep =
  | { kind: 'file'; path: string; text: string }
  | { kind: 'untitled'; id: string; text: string };

export function planRestore(entries: BackupEntry[]): RestoreStep[] {
  const steps: RestoreStep[] = [];
  for (const e of entries) {
    if (e.path) {steps.push({ kind: 'file', path: e.path, text: e.text });}
    else if (e.untitledId) {steps.push({ kind: 'untitled', id: e.untitledId, text: e.text });}
    else if (e.text.trim()) {
      // An index-less orphan (corrupt index): keep the text as an unsaved document.
      steps.push({ kind: 'untitled', id: `untitled:recovered-${e.key.slice(0, 8)}`, text: e.text });
    }
  }
  return steps;
}
