/**
 * External file changes (M6; plan decision "as VS Code", edge case 9). A
 * file open in this window changed on disk behind the editor: another app,
 * another MikeDown window (cross-window saves take the same path), a sync
 * client.
 *
 * Three triggers feed one check per document: the folder watcher's
 * `fs-changed` events (expanded directories only), the window gaining focus,
 * and a save (so a change the watcher could not see still asks before it is
 * overwritten). The check compares `mtimeMs`; when it moved it reads the file
 * and decides with `decideExternalChange`:
 *
 * | disk text            | document | action                                           |
 * |----------------------|----------|--------------------------------------------------|
 * | same as `savedText`  | any      | `touch`: only the mtime moved; clear any mark     |
 * | different            | clean    | `reload`: silent reload, cursor kept where it can |
 * | same as the buffer   | dirty    | `adopt`: the disk caught up; the tab is clean     |
 * | different            | dirty    | `flag`: keep the edits, mark `externallyChanged`  |
 *
 * A file that disappeared is left alone (the tree's delete path or the
 * next save handles it). Documents mid-save are skipped: the save's own write
 * is not an external change.
 */
import type { DocumentModel, ReadInfo } from './documentModel';
import type { FsChange, StatInfo } from './fsApi';

export type ExternalAction = 'none' | 'gone' | 'touch' | 'reload' | 'adopt' | 'flag';

/** The cheap half: does the file need a read at all? */
export function needsRead(
  doc: Pick<DocumentModel, 'mtimeMs'>,
  st: Pick<StatInfo, 'exists' | 'mtimeMs'>,
): 'none' | 'gone' | 'read' {
  if (!st.exists) {return 'gone';}
  if (doc.mtimeMs !== null && st.mtimeMs === doc.mtimeMs) {return 'none';}
  return 'read';
}

/** The decision table above, given the file's current text. */
export function decideExternalChange(
  doc: Pick<DocumentModel, 'dirty' | 'text' | 'savedText'>,
  diskText: string,
): Exclude<ExternalAction, 'none' | 'gone'> {
  if (diskText === doc.savedText) {return 'touch';}
  if (!doc.dirty) {return 'reload';}
  if (diskText === doc.text) {return 'adopt';}
  return 'flag';
}

export interface ExternalChangeDeps {
  fs: {
    stat(path: string): Promise<Pick<StatInfo, 'exists' | 'mtimeMs'>>;
    readText(path: string): Promise<ReadInfo>;
  };
  /** Every open document. */
  docs(): DocumentModel[];
  /** True while the controller is writing this document. */
  isSaving(doc: DocumentModel): boolean;
  /** Clean document, new text on disk: load it as the clean baseline (cursor kept). */
  reload(doc: DocumentModel, info: ReadInfo): void;
  /** Dirty document, different text on disk: the edits stay; tell the user. */
  flagged(doc: DocumentModel, info: ReadInfo): void;
  /** The mark went away (`touch` or `adopt` after a `flag`) or the tab became clean. */
  cleared?(doc: DocumentModel): void;
  /** Directory comparison for watcher events. */
  dirname(path: string): string;
  samePath?(a: string, b: string): boolean;
}

export interface ExternalChanges {
  /** Check one document now. Resolves with what was done. */
  check(doc: DocumentModel): Promise<ExternalAction>;
  /** Check every open document (window focus). */
  checkAll(): Promise<void>;
  /** A watcher event: check the open documents it may concern. */
  handleFsChange(change: FsChange): void;
}

/** Watcher events arrive in bursts (temp file, rename, modify): one check per document per burst. */
export const FS_EVENT_DEBOUNCE_MS = 80;

export function createExternalChanges(deps: ExternalChangeDeps): ExternalChanges {
  const same = deps.samePath ?? ((a: string, b: string) => a === b);
  const running = new Map<DocumentModel, Promise<ExternalAction>>();
  const rerun = new Set<DocumentModel>();
  const timers = new Map<DocumentModel, ReturnType<typeof setTimeout>>();

  function eligible(doc: DocumentModel): boolean {
    return !!doc.path && doc.kind !== 'image' && doc.state === 'ready' && !deps.isSaving(doc);
  }

  async function run(doc: DocumentModel): Promise<ExternalAction> {
    if (!eligible(doc)) {return 'none';}
    const path = doc.path!;
    let st;
    try { st = await deps.fs.stat(path); } catch { return 'none'; }
    // An answer without a stat (unknown command, odd mock) is "can't tell".
    if (!st || typeof st.exists !== 'boolean') {return 'none';}
    const first = needsRead(doc, st);
    if (first !== 'read') {return first;}
    let info: ReadInfo;
    try { info = await deps.fs.readText(path); } catch { return 'none'; }
    // The document may have been saved, renamed or closed meanwhile.
    if (doc.path !== path || !eligible(doc)) {return 'none';}
    if (info.encoding === 'unknown' && doc.encoding !== 'unknown' && doc.dirty) {
      // Not UTF-8 any more: never adopt or overwrite silently.
      doc.markExternalChange(info.mtimeMs);
      deps.flagged(doc, info);
      return 'flag';
    }
    const action = decideExternalChange(doc, info.text);
    const wasFlagged = doc.externallyChanged;
    switch (action) {
      case 'touch':
        doc.mtimeMs = info.mtimeMs;
        if (wasFlagged) {
          doc.externallyChanged = false;
          deps.cleared?.(doc);
        }
        break;
      case 'reload':
        deps.reload(doc, info);
        break;
      case 'adopt':
        // The disk now holds exactly the buffer: that is the new baseline.
        doc.adoptDisk(info.mtimeMs);
        deps.cleared?.(doc);
        break;
      case 'flag':
        doc.markExternalChange(info.mtimeMs);
        deps.flagged(doc, info);
        break;
    }
    return action;
  }

  function check(doc: DocumentModel): Promise<ExternalAction> {
    const busy = running.get(doc);
    if (busy) {
      rerun.add(doc);
      return busy;
    }
    const p = run(doc).finally(() => {
      running.delete(doc);
      if (rerun.delete(doc)) {void check(doc);}
    });
    running.set(doc, p);
    return p;
  }

  return {
    check,
    async checkAll() {
      await Promise.all(deps.docs().map((d) => check(d)));
    },
    handleFsChange(change) {
      for (const doc of deps.docs()) {
        if (!doc.path) {continue;}
        const hit = same(doc.path, change.path) || same(deps.dirname(doc.path), change.dir) || same(doc.path, change.dir);
        if (!hit) {continue;}
        clearTimeout(timers.get(doc));
        timers.set(doc, setTimeout(() => {
          timers.delete(doc);
          void check(doc);
        }, FS_EVENT_DEBOUNCE_MS));
      }
    },
  };
}
