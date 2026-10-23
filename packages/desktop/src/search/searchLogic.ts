/**
 * Folder search, the parts without a DOM (M7): the controller that debounces
 * typing, cancels the run it replaces and folds streamed batches into
 * per-file groups under a result cap, plus the pure helpers the panel uses
 * for keyboard navigation and snippet highlighting. The matching itself is
 * Rust (`src-tauri/src/commands/search.rs`); this module only talks to it
 * through `SearchApi` (`documents/fsApi.ts`).
 */

export interface SearchMatch {
  path: string;
  /** 1-based. */
  line: number;
  /** 1-based, UTF-16 units into the line. */
  column: number;
  snippet: string;
  /** UTF-16 offsets into `snippet`. */
  matchStart: number;
  matchEnd: number;
}

export interface SearchSummary {
  matches: number;
  filesSearched: number;
  filesMatched: number;
  skippedLarge: number;
  truncated: boolean;
  cancelled: boolean;
  elapsedMs: number;
  firstResultMs: number | null;
}

export interface SearchRequestOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  showHidden: boolean;
  limit: number;
}

export interface SearchApi {
  start(id: number, root: string, query: string, options: SearchRequestOptions): Promise<void>;
  cancel(id: number): Promise<void>;
  onBatch(handler: (e: { id: number; matches: SearchMatch[] }) => void): Promise<() => void>;
  onDone(handler: (e: { id: number; summary: SearchSummary }) => void): Promise<() => void>;
}

export interface FileGroup {
  path: string;
  matches: SearchMatch[];
}

export interface SearchState {
  status: 'idle' | 'pending' | 'searching' | 'done' | 'error';
  query: string;
  groups: FileGroup[];
  total: number;
  /** The cap was hit (client or Rust side): show "refine your search". */
  truncated: boolean;
  summary: SearchSummary | null;
  error: string | null;
}

export const SEARCH_DEBOUNCE_MS = 250;
export const SEARCH_LIMIT = 2000;

export interface SearchControllerDeps {
  api: SearchApi;
  /** The opened folder, or null when none is open. */
  root(): string | null;
  showHidden(): boolean;
  debounceMs?: number;
  limit?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface SearchController {
  state(): SearchState;
  subscribe(listener: (state: SearchState) => void): () => void;
  /** Typing: debounced; an empty query clears at once. */
  setQuery(query: string): void;
  setOptions(options: { caseSensitive?: boolean; wholeWord?: boolean }): void;
  options(): { caseSensitive: boolean; wholeWord: boolean };
  /** Enter, or the folder / show-hidden changed: run now without the debounce. */
  searchNow(): void;
  /** Stop the run in flight and forget the results. */
  clear(): void;
  dispose(): void;
}

function emptyState(query = ''): SearchState {
  return { status: 'idle', query, groups: [], total: 0, truncated: false, summary: null, error: null };
}

export function createSearchController(deps: SearchControllerDeps): SearchController {
  const debounceMs = deps.debounceMs ?? SEARCH_DEBOUNCE_MS;
  const limit = deps.limit ?? SEARCH_LIMIT;
  const setT = deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>));
  const listeners = new Set<(s: SearchState) => void>();
  const opts = { caseSensitive: false, wholeWord: false };
  let st: SearchState = emptyState();
  let timer: unknown = null;
  /** Id of the run whose events count; 0 when none. */
  let current = 0;
  let nextId = Math.floor(Date.now() % 1_000_000) * 1000;
  let groupIndex = new Map<string, FileGroup>();
  let unlisten: Array<() => void> | null = null;
  let listening: Promise<void> | null = null;
  let disposed = false;

  function emit(): void {
    for (const l of listeners) {l(st);}
  }

  function set(patch: Partial<SearchState>): void {
    st = { ...st, ...patch };
    emit();
  }

  function ensureListening(): Promise<void> {
    listening ??= Promise.all([
      deps.api.onBatch((e) => onBatch(e.id, e.matches)),
      deps.api.onDone((e) => onDone(e.id, e.summary)),
    ]).then((u) => {
      if (disposed) {u.forEach((f) => f());} else {unlisten = u;}
    });
    return listening;
  }

  function stopRun(): void {
    const id = current;
    current = 0;
    if (id) {void deps.api.cancel(id).catch(() => { /* already finished */ });}
  }

  function onBatch(id: number, matches: SearchMatch[]): void {
    if (id !== current) {return;}
    let total = st.total;
    let truncated = st.truncated;
    for (const m of matches) {
      if (total >= limit) {truncated = true; break;}
      let g = groupIndex.get(m.path);
      if (!g) {
        g = { path: m.path, matches: [] };
        groupIndex.set(m.path, g);
        st.groups.push(g);
      }
      g.matches.push(m);
      total++;
    }
    st = { ...st, groups: st.groups, total, truncated };
    if (truncated) {
      stopRun();
      st = { ...st, status: 'done' };
    }
    emit();
  }

  function onDone(id: number, summary: SearchSummary): void {
    if (id !== current) {return;}
    current = 0;
    set({ status: 'done', summary, truncated: st.truncated || summary.truncated });
  }

  async function run(): Promise<void> {
    timer = null;
    const query = st.query;
    const root = deps.root();
    stopRun();
    groupIndex = new Map();
    if (!query || !root) {
      st = emptyState(query);
      emit();
      return;
    }
    const id = ++nextId;
    current = id;
    st = { ...emptyState(query), status: 'searching' };
    emit();
    try {
      await ensureListening();
      if (current !== id) {return;}
      await deps.api.start(id, root, query, { ...opts, showHidden: deps.showHidden(), limit });
    } catch (err) {
      if (current !== id) {return;}
      current = 0;
      set({ status: 'error', error: String((err as Error)?.message ?? err) });
    }
  }

  function schedule(): void {
    if (timer !== null) {clearT(timer);}
    timer = null;
    // The old run is no use once the query changed; free the CPU now and
    // leave its partial results on screen until the new run starts.
    stopRun();
    if (!st.query) {
      groupIndex = new Map();
      st = emptyState();
      emit();
      return;
    }
    if (st.status !== 'pending') {set({ status: 'pending' });}
    timer = setT(() => { void run(); }, debounceMs);
  }

  return {
    state: () => st,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setQuery(query) {
      if (query === st.query && st.status !== 'idle') {return;}
      st = { ...st, query };
      schedule();
    },
    setOptions(patch) {
      const next = { ...opts, ...patch };
      if (next.caseSensitive === opts.caseSensitive && next.wholeWord === opts.wholeWord) {return;}
      Object.assign(opts, next);
      if (st.query) {schedule();}
    },
    options: () => ({ ...opts }),
    searchNow() {
      if (timer !== null) {clearT(timer);}
      timer = null;
      void run();
    },
    clear() {
      if (timer !== null) {clearT(timer);}
      timer = null;
      stopRun();
      groupIndex = new Map();
      st = emptyState();
      emit();
    },
    dispose() {
      disposed = true;
      if (timer !== null) {clearT(timer);}
      stopRun();
      unlisten?.forEach((f) => f());
      listeners.clear();
    },
  };
}

// ── Keyboard navigation ────────────────────────────────────────────────────

export type NavRow = { kind: 'file'; path: string } | { kind: 'match'; path: string; index: number };

/** The rows on screen, in order: each file, then its matches unless collapsed. */
export function visibleRows(groups: readonly FileGroup[], collapsed: ReadonlySet<string>): NavRow[] {
  const rows: NavRow[] = [];
  for (const g of groups) {
    rows.push({ kind: 'file', path: g.path });
    if (collapsed.has(g.path)) {continue;}
    g.matches.forEach((_, index) => rows.push({ kind: 'match', path: g.path, index }));
  }
  return rows;
}

export type NavAction =
  | { type: 'select'; row: number }
  | { type: 'toggle'; path: string; expand: boolean }
  | { type: 'open'; row: NavRow }
  | { type: 'close' }
  | { type: 'none' };

/**
 * What a key does in the results list. `current` is the selected row index
 * (-1 for none). Arrows move, Home / End jump, Left collapses a file (or
 * moves from a match to its file), Right expands, Enter opens a match or
 * toggles a file, Escape closes the panel.
 */
export function resolveKey(
  key: string,
  rows: readonly NavRow[],
  current: number,
  collapsed: ReadonlySet<string>,
): NavAction {
  const last = rows.length - 1;
  const row = current >= 0 && current <= last ? rows[current] : undefined;
  switch (key) {
    case 'ArrowDown': return last < 0 ? { type: 'none' } : { type: 'select', row: Math.min(last, current + 1) };
    case 'ArrowUp': return last < 0 ? { type: 'none' } : { type: 'select', row: Math.max(0, current - 1) };
    case 'Home': return last < 0 ? { type: 'none' } : { type: 'select', row: 0 };
    case 'End': return last < 0 ? { type: 'none' } : { type: 'select', row: last };
    case 'ArrowLeft':
      if (!row) {return { type: 'none' };}
      if (row.kind === 'file') {return collapsed.has(row.path) ? { type: 'none' } : { type: 'toggle', path: row.path, expand: false };}
      return { type: 'select', row: rows.findIndex((r) => r.kind === 'file' && r.path === row.path) };
    case 'ArrowRight':
      if (row?.kind === 'file' && collapsed.has(row.path)) {return { type: 'toggle', path: row.path, expand: true };}
      return { type: 'none' };
    case 'Enter':
      if (!row) {return { type: 'none' };}
      return row.kind === 'file' ? { type: 'toggle', path: row.path, expand: collapsed.has(row.path) } : { type: 'open', row };
    case 'Escape': return { type: 'close' };
    default: return { type: 'none' };
  }
}

/** Split a snippet around its match for highlighting; offsets are clamped. */
export function splitSnippet(snippet: string, start: number, end: number): { before: string; hit: string; after: string } {
  const s = Math.max(0, Math.min(snippet.length, start));
  const e = Math.max(s, Math.min(snippet.length, end));
  return { before: snippet.slice(0, s), hit: snippet.slice(s, e), after: snippet.slice(e) };
}

/** `dir/` relative to the folder root for a result file, '' at the root. */
export function relativeDir(root: string, filePath: string): string {
  const norm = (p: string): string => p.replace(/\\/g, '/');
  const r = norm(root).replace(/\/+$/, '');
  const f = norm(filePath);
  const rel = f.toLowerCase().startsWith(r.toLowerCase() + '/') ? f.slice(r.length + 1) : f;
  const cut = rel.lastIndexOf('/');
  return cut < 0 ? '' : rel.slice(0, cut);
}

export function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}
