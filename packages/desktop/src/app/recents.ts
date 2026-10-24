/**
 * Recent folders and files (M8, edge case 18), kept in
 * `<app-data>/recents.json` through `src-tauri/src/commands/recents.rs`.
 *
 * Two lists, newest first, capped at `RECENTS_CAP`. An entry whose path is
 * gone stays listed (greyed, with a remove "×") and counts the launches it
 * was missing on; the third such launch prunes it. Finding it again resets
 * the count. Removing an entry persists. The same file remembers whether the
 * first-run welcome has been shown (`firstRunDone`).
 *
 * The pure functions below hold the rules; `createRecentsStore` does the IO.
 * Every write re-reads the file first, so two windows adding entries do not
 * drop each other's.
 */
import { invoke } from '@tauri-apps/api/core';

export const RECENTS_CAP = 10;
/** Launches an entry may be missing on before it is pruned. */
export const MISSING_LAUNCH_LIMIT = 3;

export type RecentKind = 'folder' | 'file';

export interface RecentEntry {
  path: string;
  /** Consecutive launches the path was missing on. */
  missingCount: number;
  /** Unix milliseconds. */
  lastOpened: number;
}

export interface RecentsData {
  version: 1;
  firstRunDone: boolean;
  folders: RecentEntry[];
  files: RecentEntry[];
}

export function emptyRecents(): RecentsData {
  return { version: 1, firstRunDone: false, folders: [], files: [] };
}

function entries(raw: unknown): RecentEntry[] {
  if (!Array.isArray(raw)) {return [];}
  const out: RecentEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') {continue;}
    const r = e as Record<string, unknown>;
    if (typeof r.path !== 'string' || !r.path) {continue;}
    out.push({
      path: r.path,
      missingCount: typeof r.missingCount === 'number' && r.missingCount > 0 ? Math.floor(r.missingCount) : 0,
      lastOpened: typeof r.lastOpened === 'number' ? r.lastOpened : 0,
    });
  }
  return out;
}

/** Parse the file. Missing (null) is a first run; a corrupt file starts over but counts as not-first-run. */
export function parseRecents(text: string | null): RecentsData {
  if (text === null) {return emptyRecents();}
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ...emptyRecents(), firstRunDone: true };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {return { ...emptyRecents(), firstRunDone: true };}
  const r = raw as Record<string, unknown>;
  return {
    version: 1,
    firstRunDone: r.firstRunDone === true,
    folders: entries(r.folders).slice(0, RECENTS_CAP),
    files: entries(r.files).slice(0, RECENTS_CAP),
  };
}

export function serializeRecents(data: RecentsData): string {
  return JSON.stringify(data, null, 2);
}

/** Comparison key: trailing separators dropped; case folded where the file system usually ignores it. */
export function samePath(a: string, b: string, caseInsensitive: boolean): boolean {
  const norm = (p: string) => {
    const t = p.length > 1 ? p.replace(/[\\/]+$/, '') : p;
    return caseInsensitive ? t.toLowerCase() : t;
  };
  return norm(a) === norm(b);
}

function listOf(data: RecentsData, kind: RecentKind): RecentEntry[] {
  return kind === 'folder' ? data.folders : data.files;
}

function withList(data: RecentsData, kind: RecentKind, list: RecentEntry[]): RecentsData {
  return kind === 'folder' ? { ...data, folders: list } : { ...data, files: list };
}

/** Put `path` first (deduped), found again, capped. */
export function addRecent(data: RecentsData, kind: RecentKind, path: string, now: number, caseInsensitive = false): RecentsData {
  const rest = listOf(data, kind).filter((e) => !samePath(e.path, path, caseInsensitive));
  return withList(data, kind, [{ path, missingCount: 0, lastOpened: now }, ...rest].slice(0, RECENTS_CAP));
}

export function removeRecent(data: RecentsData, kind: RecentKind, path: string, caseInsensitive = false): RecentsData {
  return withList(data, kind, listOf(data, kind).filter((e) => !samePath(e.path, path, caseInsensitive)));
}

export function clearRecents(data: RecentsData): RecentsData {
  return { ...data, folders: [], files: [] };
}

/**
 * Once per app launch: entries in `missing` count one more missing launch
 * (pruned at `MISSING_LAUNCH_LIMIT`), the others reset to zero.
 */
export function applyLaunchCheck(data: RecentsData, missing: ReadonlySet<string>): RecentsData {
  const step = (list: RecentEntry[]) => list
    .map((e) => (missing.has(e.path) ? { ...e, missingCount: e.missingCount + 1 } : { ...e, missingCount: 0 }))
    .filter((e) => e.missingCount < MISSING_LAUNCH_LIMIT);
  return { ...data, folders: step(data.folders), files: step(data.files) };
}

export interface RecentItemView {
  kind: RecentKind;
  path: string;
  /** Last path segment. */
  name: string;
  /** The folder it sits in (shown dimmed). */
  parent: string;
  missing: boolean;
}

export function baseName(p: string): string {
  const t = p.length > 1 ? p.replace(/[\\/]+$/, '') : p;
  return t.split(/[\\/]/).pop() || t;
}

export function parentOf(p: string): string {
  const t = p.length > 1 ? p.replace(/[\\/]+$/, '') : p;
  const cut = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'));
  if (cut < 0) {return '';}
  return cut === 0 ? t.slice(0, 1) : t.slice(0, cut);
}

/** `~/…` for paths under the home folder, as recents lists usually show them. */
export function tildify(p: string, home: string | null): string {
  if (!home) {return p;}
  const h = home.replace(/[\\/]+$/, '');
  if (p === h) {return '~';}
  if (p.startsWith(h + '/') || p.startsWith(h + '\\')) {return '~' + p.slice(h.length);}
  return p;
}

export function recentsView(data: RecentsData, missing: ReadonlySet<string>): { folders: RecentItemView[]; files: RecentItemView[] } {
  const view = (kind: RecentKind) => (e: RecentEntry): RecentItemView => ({
    kind,
    path: e.path,
    name: baseName(e.path),
    parent: parentOf(e.path),
    missing: missing.has(e.path),
  });
  return { folders: data.folders.map(view('folder')), files: data.files.map(view('file')) };
}

// ── IO ─────────────────────────────────────────────────────────────────────

export interface RecentsFileInfo {
  text: string | null;
  /** Listed paths that do not exist right now. */
  missing: string[];
}

export interface RecentsApi {
  read(): Promise<RecentsFileInfo>;
  write(text: string): Promise<void>;
  /** Extend the fs scope to a listed entry so it can open after a restart. */
  allow(path: string): Promise<boolean>;
  /** Path of the welcome document (copied from the bundle into app data). */
  welcomeFile(): Promise<string | null>;
}

export const recentsApi: RecentsApi = {
  read: () => invoke<RecentsFileInfo>('recents_read'),
  write: (text) => invoke<void>('recents_write', { text }),
  allow: (path) => invoke<boolean>('recents_allow', { path }),
  welcomeFile: () => invoke<string | null>('welcome_file'),
};

export interface RecentsStore {
  /** Read the file (and which entries are missing now). */
  load(): Promise<void>;
  /** The once-per-launch missing count step (main window at boot). */
  launchCheck(): Promise<void>;
  add(kind: RecentKind, path: string): Promise<void>;
  remove(kind: RecentKind, path: string): Promise<void>;
  clear(): Promise<void>;
  markFirstRunDone(): Promise<void>;
  /** False only when the file did not exist at the last load (a fresh install). */
  firstRunDone(): boolean;
  data(): RecentsData;
  missing(): ReadonlySet<string>;
  view(): { folders: RecentItemView[]; files: RecentItemView[] };
  onChange(listener: () => void): () => void;
}

export function createRecentsStore(deps: { api: RecentsApi; caseInsensitive: boolean; now?: () => number }): RecentsStore {
  const now = deps.now ?? (() => Date.now());
  let data = emptyRecents();
  let missing = new Set<string>();
  let loaded = false;
  const listeners = new Set<() => void>();
  let chain: Promise<unknown> = Promise.resolve();

  const notify = () => { for (const l of listeners) {l();} };

  async function read(): Promise<void> {
    const info = await deps.api.read();
    data = parseRecents(info.text);
    missing = new Set(info.missing);
    loaded = true;
  }

  /** Serialised read-modify-write. */
  function mutate(fn: (d: RecentsData) => RecentsData): Promise<void> {
    const run = chain.then(async () => {
      try { await read(); } catch { /* keep what we have */ }
      data = fn(data);
      await deps.api.write(serializeRecents(data));
      notify();
    });
    chain = run.catch(() => { /* next mutation still runs */ });
    return run;
  }

  return {
    async load() {
      await read();
      notify();
    },
    launchCheck: () => mutate((d) => {
      const next = applyLaunchCheck(d, missing);
      const kept = new Set([...next.folders, ...next.files].map((e) => e.path));
      missing = new Set([...missing].filter((p) => kept.has(p)));
      return next;
    }),
    add: (kind, path) => mutate((d) => {
      missing.delete(path);
      return addRecent(d, kind, path, now(), deps.caseInsensitive);
    }),
    remove: (kind, path) => mutate((d) => removeRecent(d, kind, path, deps.caseInsensitive)),
    clear: () => mutate((d) => clearRecents(d)),
    markFirstRunDone: () => mutate((d) => ({ ...d, firstRunDone: true })),
    firstRunDone: () => !loaded || data.firstRunDone,
    data: () => data,
    missing: () => missing,
    view: () => recentsView(data, missing),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
