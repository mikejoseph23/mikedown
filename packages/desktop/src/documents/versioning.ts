/**
 * Version snapshots (M6, edge cases 1–3). Every explicit save of a file
 * inside the window's open folder copies the saved bytes to
 * `.mikedown/versions/<relative/path/to/file.md>/<YYYYMMDDTHHMMSSZ>.md`,
 * unless versioning is off, the file is over `versioning.maxSizeMB`, or the
 * bytes match the newest snapshot; then the mirror is pruned to
 * `versioning.keep`. A lone-file window (no folder) never snapshots, and
 * `.mikedown/` is created by the first snapshot only (the Rust side creates
 * the folder when, and only when, it writes).
 *
 * Policy lives here (pure helpers below, unit-tested); the IO is
 * `src-tauri/src/commands/versions.rs`, which refuses anything that is not a
 * snapshot inside a mirror. Snapshots of one file are taken one at a time so
 * two quick saves can never pick the same name.
 */
import type { PathOps } from '@mikedown/core/shared/imagePaste';
import type { VersioningSettings } from '../settings/desktopSettings';
import { isInside, versionsPathFor } from '../tree/treeLogic';

export interface VersionSnapshot {
  /** `20261023T120000Z.md`. */
  name: string;
  path: string;
  size: number;
  /** When the snapshot was taken (from its name), ms since the epoch. */
  timeMs: number;
}

export type SnapshotOutcome = 'created' | 'identical' | 'tooLarge';

/** The Rust commands (`fsApi.ts#versionsApi`). */
export interface VersionsApi {
  /** Snapshots in a mirror folder, oldest first; a missing folder is empty. */
  list(dir: string): Promise<Array<{ name: string; path: string; size: number }>>;
  snapshot(file: string, dir: string, name: string, newest: string | null, maxBytes: number): Promise<SnapshotOutcome>;
  prune(dir: string, names: string[]): Promise<number>;
  /** Move a mirror, merging into one that already exists at `to`. */
  move(from: string, to: string): Promise<void>;
}

export type SkipReason = 'disabled' | 'no-folder' | 'untitled' | 'outside' | 'internal' | 'too-large';

export interface SnapshotResult {
  status: SnapshotOutcome | SkipReason | 'failed';
  /** The new snapshot's path when `status` is `created`. */
  path?: string;
  /** Snapshots removed by pruning. */
  pruned?: number;
}

const NAME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.md$/;

/** `YYYYMMDDTHHMMSSZ.md` for a UTC instant (seconds resolution). */
export function snapshotName(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z.md`;
}

/** The instant a snapshot name encodes, or null for anything else. */
export function parseSnapshotName(name: string): number | null {
  const m = NAME_RE.exec(name);
  if (!m) {return null;}
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  return snapshotName(ms) === name ? ms : null;
}

/**
 * The name for a snapshot taken at `nowMs`, strictly after every existing
 * name so the folder always sorts chronologically: two saves in the same
 * second, or a clock that stepped back, move the new name one second past the
 * newest.
 */
export function nextSnapshotName(nowMs: number, existing: readonly string[]): string {
  let newest: number | null = null;
  for (const n of existing) {
    const t = parseSnapshotName(n);
    if (t !== null && (newest === null || t > newest)) {newest = t;}
  }
  const now = Math.floor(nowMs / 1000) * 1000;
  return snapshotName(newest !== null && now <= newest ? newest + 1000 : now);
}

/** The oldest names to delete so `keep` remain. `names` sorted oldest first. */
export function pruneList(names: readonly string[], keep: number): string[] {
  const k = Math.max(1, Math.floor(keep));
  return names.length > k ? names.slice(0, names.length - k) : [];
}

export function maxBytesFor(maxSizeMB: number): number {
  return Math.floor(Math.max(0, maxSizeMB) * 1024 * 1024);
}

/** Why a save does not snapshot, or null when it should (size known). */
export function skipReason(
  input: { settings: VersioningSettings; root: string | null; file: string | null; size?: number },
  path: PathOps,
): SkipReason | null {
  const { settings, root, file } = input;
  if (!settings.enabled) {return 'disabled';}
  if (!root) {return 'no-folder';}
  if (!file) {return 'untitled';}
  if (!isInside(root, file, path) || path.relative(root, file) === '') {return 'outside';}
  if (!versionsPathFor(root, file, path)) {return 'internal';}
  if (input.size !== undefined && input.size > maxBytesFor(settings.maxSizeMB)) {return 'too-large';}
  return null;
}

export interface VersioningDeps {
  api: VersionsApi;
  path: PathOps;
  settings(): VersioningSettings;
  /** The window's open folder, or null (lone-file window). */
  root(): string | null;
  /** Read a snapshot's text (`\n` line endings, no BOM). */
  readText(path: string): Promise<{ text: string }>;
  now?(): number;
}

export interface Versioning {
  /** The mirror folder for a file, or null when it has none (outside the folder, lone file). */
  dirFor(file: string): string | null;
  /** A save of `file` succeeded (`size`: bytes written, when known). */
  onSaved(file: string, size?: number): Promise<SnapshotResult>;
  /** Snapshots of `file`, newest first. */
  list(file: string): Promise<VersionSnapshot[]>;
  read(snapshot: VersionSnapshot | string): Promise<string>;
  /** Text of the newest snapshot, or null (the diff baseline). */
  newestText(file: string): Promise<string | null>;
  /** A file or folder moved inside the folder: carry its mirror along (edge case 3). */
  moved(from: string, to: string): Promise<void>;
  /** Snapshots of a file appeared or went (new snapshot, prune, move). */
  onChange(fn: (file: string) => void): () => void;
}

export function createVersioning(deps: VersioningDeps): Versioning {
  const { api, path } = deps;
  const now = deps.now ?? (() => Date.now());
  const queues = new Map<string, Promise<unknown>>();
  const listeners = new Set<(file: string) => void>();

  function emit(file: string): void {
    for (const fn of listeners) {
      try { fn(file); } catch (err) { console.error('MikeDown: versions listener failed', err); }
    }
  }

  function dirFor(file: string): string | null {
    const root = deps.root();
    if (!root) {return null;}
    return versionsPathFor(root, file, path);
  }

  /** Run `job` after any earlier job for the same mirror. */
  function serial<T>(key: string, job: () => Promise<T>): Promise<T> {
    const prev = queues.get(key) ?? Promise.resolve();
    const next = prev.then(job, job);
    const tail = next.catch(() => undefined);
    queues.set(key, tail);
    void tail.then(() => { if (queues.get(key) === tail) {queues.delete(key);} });
    return next;
  }

  async function snapshot(file: string, dir: string, settings: VersioningSettings): Promise<SnapshotResult> {
    const existing = (await api.list(dir)).map((s) => s.name).filter((n) => parseSnapshotName(n) !== null).sort();
    const newest = existing.length ? existing[existing.length - 1] : null;
    const name = nextSnapshotName(now(), existing);
    const outcome = await api.snapshot(file, dir, name, newest, maxBytesFor(settings.maxSizeMB));
    if (outcome !== 'created') {return { status: outcome };}
    const doomed = pruneList([...existing, name], settings.keep);
    let pruned = 0;
    if (doomed.length) {
      try { pruned = await api.prune(dir, doomed); } catch (err) { console.warn('MikeDown: could not prune versions', dir, err); }
    }
    return { status: 'created', path: path.join(dir, name), pruned };
  }

  async function list(file: string): Promise<VersionSnapshot[]> {
    const dir = dirFor(file);
    if (!dir) {return [];}
    const rows = await api.list(dir);
    const out: VersionSnapshot[] = [];
    for (const r of rows) {
      const timeMs = parseSnapshotName(r.name);
      if (timeMs !== null) {out.push({ ...r, timeMs });}
    }
    return out.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  }

  async function read(snapshot: VersionSnapshot | string): Promise<string> {
    const p = typeof snapshot === 'string' ? snapshot : snapshot.path;
    return (await deps.readText(p)).text;
  }

  return {
    dirFor,
    async onSaved(file, size) {
      const settings = deps.settings();
      const reason = skipReason({ settings, root: deps.root(), file, size }, path);
      if (reason) {return { status: reason };}
      const dir = dirFor(file)!;
      try {
        const res = await serial(dir, () => snapshot(file, dir, settings));
        if (res.status === 'created') {emit(file);}
        return res;
      } catch (err) {
        // Never in the way of a save: the file is already written.
        console.warn('MikeDown: snapshot failed', file, err);
        return { status: 'failed' };
      }
    },
    list,
    read,
    async newestText(file) {
      const [newest] = await list(file);
      return newest ? read(newest) : null;
    },
    async moved(from, to) {
      const a = dirFor(from);
      const b = dirFor(to);
      if (!a || !b || a === b) {return;}
      await serial(a, () => api.move(a, b));
      emit(from);
      emit(to);
    },
    onChange(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}
