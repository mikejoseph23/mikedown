import * as nodePath from 'path';
import {
  DOCS_KEYWORD_TOP,
  DOCS_MAX_FILES,
  DOCS_MAX_FILE_BYTES,
  DOCS_MAX_LINKS_PER_PAGE,
  buildDocsIndex,
  capSectionText,
  cmpCodePoints,
  createDocsLinkResolver,
  docsRootLabels,
  docsSectionId,
  frontmatterEndOffset,
  headingsOutline,
  generateAiId,
  parseDocBases,
  parseDocsId,
  rankKeywordSections,
  splitDocsSections,
  type AiDocBase,
  type AiDocBaseStatus,
  type AiDocRootStatus,
  type AiDocsIndex,
  type AiDocsLink,
  type AiDocsPage,
  type AiDocsSection,
  type AiDocsSectionRef,
  type DocsKeywordSection,
} from '@mikedown/core/ai';

/**
 * `host.docs` for VS Code (workspace RAG, M5): documentation bases read from
 * disk, with the containment the plan calls S1 to S3, S9 and S12.
 *
 * This file has no `vscode` import. The file system, the watcher and the
 * settings arrive through `DocsHostDeps`, so unit tests drive it with a fake
 * (`docsVsCode.ts` is the real wiring).
 *
 * The rules, all of them code:
 *  - Every entry point takes a base id and resolves the roots from the
 *    user-level configuration (`deps.readBases`). A root the configuration does
 *    not list can never be named; a disabled base is refused (A9).
 *  - `readSections` looks ids up in this host's own index (`parseDocsId`) and
 *    refuses anything else. A path is built from the index entry's `relPath`
 *    (which the walker read off the disk), never from id text (S1).
 *  - A read canonicalizes the root and the file (`realpath`), requires the file
 *    under the canonical root by whole path components, a `.md` / `.markdown`
 *    extension (any case), a regular file, and at most 1 MiB (S2).
 *  - The walker uses `readDirectory` entry kinds, skips symlinked folders and
 *    files, `node_modules` and hidden folders, and stops at 5,000 files (S3).
 *  - Read-only. No write, shell or network call exists here (S12). Section
 *    text is never logged.
 *  - One watcher per root, never a workspace-wide one (S9); disposed with the
 *    base.
 */

/** What a directory entry or a stat is, with the symlink bit already folded in (`docsVsCode.ts` does that for `vscode.FileType`, a bitmask). */
export type DocsEntryKind = 'file' | 'dir' | 'symlink' | 'other';

/** The file system the host reads through (injected: `vscode.workspace.fs` plus Node's `realpath` in the extension). */
export interface DocsFs {
  readDirectory(dir: string): Promise<Array<{ name: string; kind: DocsEntryKind }>>;
  /** Follows nothing the caller has not already canonicalized; `kind` is `symlink` when the path itself is a link. */
  stat(path: string): Promise<{ kind: DocsEntryKind; size: number }>;
  /** The file as UTF-8 text. */
  readFile(path: string): Promise<string>;
  /** The canonical path (symlinks resolved). Rejects when the path does not exist. */
  realpath(path: string): Promise<string>;
}

export interface DocsHostDeps {
  fs: DocsFs;
  /** The bases from the user-level configuration, validated (`getSettings().ai.docBases`). Read on every call. */
  readBases(): AiDocBase[];
  /** Persist validated bases, user level only. */
  writeBases?: (bases: AiDocBase[]) => PromiseLike<void>;
  /** A watcher on one root's markdown files; `onChange` fires on create, change and delete. */
  createWatcher?: (root: string, onChange: () => void) => { dispose(): void };
  /** The VS Code folder picker (`addWorkspaceFolder`). */
  pickWorkspaceFolder?(): Promise<string | null>;
  generateId?: (name: string) => string;
  now?(): number;
  /** An index older than this is walked again. Default 5 minutes. */
  ttlMs?: number;
  /** For path comparison: case-insensitive on `win32` only. Default `process.platform`. */
  platform?: string;
  /** Metadata-only log lines (counts and reasons, never paths or text). */
  log?(line: string): void;
}

export const DOCS_INDEX_TTL_MS = 5 * 60 * 1000;
/** Files read at once while walking. */
const WALK_CONCURRENCY = 16;
/** Ids one `readSections` call will look at. */
export const DOCS_MAX_IDS_PER_READ = 200;
/** Bases one `saveBases` call will accept. */
export const DOCS_MAX_BASES = 100;

// ── Pure helpers (exported for tests) ───────────────────────────────────────

/** True for a `.md` or `.markdown` name, any case. */
export function isMarkdownName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

/** The walker's skip rule for a folder name: hidden (`.x`) and `node_modules`. */
export function skipDocsDir(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules';
}

function pathParts(p: string, windows: boolean): string[] {
  return p.split(windows ? /[\\/]+/ : /\/+/).filter((s) => s !== '');
}

/**
 * Is `file` strictly inside `root`? Both must already be canonical. Compares
 * whole path components (`/docs-evil` is not under `/docs`); case-insensitive
 * on Windows only. The root itself is not "under" the root.
 */
export function isPathUnderRoot(root: string, file: string, platform: string = process.platform): boolean {
  const windows = platform === 'win32';
  const fold = (s: string): string => (windows ? s.toLowerCase() : s);
  const r = pathParts(root, windows).map(fold);
  const f = pathParts(file, windows).map(fold);
  if (f.length <= r.length) {return false;}
  for (let i = 0; i < r.length; i++) {
    if (r[i] !== f[i]) {return false;}
  }
  // A UNC or drive prefix must match too (`C:\a` vs `D:\a`, `\\s1\x` vs `\\s2\x`): the first parts above cover the drive and the server.
  return true;
}

/** Two canonical paths are the same file: equal by components, case-insensitive on Windows only. */
export function samePath(a: string, b: string, platform: string = process.platform): boolean {
  const windows = platform === 'win32';
  const fold = (s: string): string => (windows ? s.toLowerCase() : s);
  const pa = pathParts(a, windows).map(fold);
  const pb = pathParts(b, windows).map(fold);
  return pa.length === pb.length && pa.every((part, i) => part === pb[i]);
}

/**
 * The `title:` of a leading frontmatter block, or undefined. The contract
 * (`test/ai-fixtures/docs/titles.json`, shared with Desktop's
 * `docs/markdown.rs#frontmatter_title`): the first line of the block that is
 * `title`, optional blanks, `:`; its value trimmed (JavaScript `trim`), one pair
 * of matching quotes removed and the inside trimmed again. An empty value or a
 * block scalar (`|`, `>`) has no title; no multi-line values.
 */
export function frontmatterTitle(markdown: string): string | undefined {
  const end = frontmatterEndOffset(markdown);
  if (end === 0) {return undefined;}
  const m = /^title[ \t]*:(.*)$/m.exec(markdown.slice(0, end));
  if (!m) {return undefined;}
  let value = m[1].trim();
  if (value === '' || value.startsWith('|') || value.startsWith('>')) {return undefined;}
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    value = value.slice(1, -1).trim();
  }
  return value === '' ? undefined : value;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_LINK = /(!?)\[([^\]\n]{0,300})\]\(\s*(<[^>\n]*>|[^()\s]*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g;
const WIKILINK = /(!?)\[\[([^[\]\n]{1,300})\]\]/g;
/** Link text is clipped to this many code points. */
const LINK_TEXT_MAX = 120;

function clipLinkText(text: string): string {
  const trimmed = text.trim();
  const points = Array.from(trimmed);
  return points.length > LINK_TEXT_MAX ? points.slice(0, LINK_TEXT_MAX).join('') : trimmed;
}

/**
 * Links as written, for the index: `[text](target)` and `[[wikilink]]`, in
 * document order. The contract (`test/ai-fixtures/docs/links.json`, shared with
 * Desktop's `docs/markdown.rs#extract_links`):
 *  - frontmatter, fenced code, inline code spans and images (`![alt](x)`,
 *    `![[x]]`) are skipped;
 *  - a markdown link is `[text](dest "title")` with `dest` either `<...>` or a
 *    run without parentheses or blanks (so a destination with its own
 *    parentheses is not a link); the title is `"..."` or `'...'`;
 *  - external links (`https:`, `//x`) are kept, core marks them external; an
 *    empty target is dropped, `#fragment` alone is kept;
 *  - a wikilink is `[[inner]]` with no brackets inside; its target is `inner`
 *    trimmed, its text the alias after the first `|`, else the name before the
 *    first `#` or `|`; a wikilink with no name (`[[#x]]`, `[[|a]]`) is dropped;
 *  - text is trimmed and clipped to 120 code points;
 *  - on one line, links come in the order they are written.
 * Core resolves them (`docs/links.ts`).
 */
export function extractDocsLinks(markdown: string): AiDocsLink[] {
  const out: AiDocsLink[] = [];
  const body = markdown.slice(frontmatterEndOffset(markdown));
  let fence: { char: string; len: number } | null = null;
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!fence) {
      const open = FENCE_OPEN.exec(line);
      if (open) {
        fence = { char: open[1][0], len: open[1].length };
        continue;
      }
    } else {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) {fence = null;}
      continue;
    }
    const text = line.replace(/`[^`]*`/g, ' ');
    if (!text.includes('[')) {continue;}
    const found: Array<{ at: number; link: AiDocsLink }> = [];
    for (const m of text.matchAll(INLINE_LINK)) {
      if (m[1] === '!') {continue;}
      let target = m[3];
      if (target.startsWith('<') && target.endsWith('>')) {target = target.slice(1, -1);}
      target = target.trim();
      if (target === '') {continue;}
      found.push({ at: m.index ?? 0, link: { target, text: clipLinkText(m[2]), kind: 'markdown' } });
    }
    for (const m of text.matchAll(WIKILINK)) {
      if (m[1] === '!') {continue;}
      const inner = m[2];
      const name = inner.split(/[#|]/)[0].trim();
      if (name === '') {continue;}
      const bar = inner.indexOf('|');
      const alias = bar >= 0 ? inner.slice(bar + 1).trim() : '';
      found.push({ at: m.index ?? 0, link: { target: inner.trim(), text: clipLinkText(alias !== '' ? alias : name), kind: 'wikilink' } });
    }
    found.sort((a, b) => a.at - b.at);
    for (const f of found) {
      out.push(f.link);
      if (out.length >= DOCS_MAX_LINKS_PER_PAGE) {return out;}
    }
  }
  return out;
}

/**
 * Validate bases a webview sent before they are written (A2). They are parsed
 * the way settings are (roots checked, duplicates dropped, ids made). Throws
 * when nothing valid is left to write over something valid, so a malformed
 * message cannot wipe the user's bases.
 */
export function prepareBasesForSave(current: readonly AiDocBase[], incoming: unknown, genId?: (name: string) => string): { bases: AiDocBase[]; warnings: string[] } {
  if (!Array.isArray(incoming)) {throw new Error('Documentation bases must be a list.');}
  if (incoming.length > DOCS_MAX_BASES) {throw new Error(`At most ${DOCS_MAX_BASES} documentation bases.`);}
  const warnings: string[] = [];
  const bases = parseDocBases(incoming, genId ?? generateAiId, (m) => warnings.push(m));
  if (bases.length === 0 && incoming.length > 0 && current.length > 0) {
    throw new Error(`None of the documentation bases were valid, so nothing was saved: ${warnings[0] ?? 'unknown reason'}`);
  }
  return { bases, warnings };
}

// ── The host ────────────────────────────────────────────────────────────────

interface IndexedFile {
  pageId: string;
  /** Index into the base's configured `roots`. */
  rootIndex: number;
  relPath: string;
}

interface BuiltBase {
  index: AiDocsIndex;
  files: Map<string, IndexedFile>;
  rootStatuses: AiDocRootStatus[];
  fileCount: number;
  oversizeSkipped: number;
  capReached: boolean;
  brokenLinks: number;
  /** `found` per configured root, to notice a root appearing or disappearing. */
  foundSignature: string;
}

interface Entry {
  fingerprint: string;
  built?: BuiltBase;
  building?: Promise<BuiltBase>;
  builtAt: number;
  stale: boolean;
  watchers: Array<{ dispose(): void }>;
  watchedRoots: string[];
}

function fingerprintOf(base: AiDocBase): string {
  return JSON.stringify([base.enabled, base.roots, base.homeFile ?? '']);
}

export class DocsHost {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private disposed = false;

  constructor(private readonly deps: DocsHostDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private log(line: string): void {
    this.deps.log?.(line);
  }

  private get platform(): string {
    return this.deps.platform ?? process.platform;
  }

  // ── Bases ────────────────────────────────────────────────────────────────

  private bases(): AiDocBase[] {
    return this.deps.readBases();
  }

  /**
   * Drop the index and watchers of every base that was removed, disabled or
   * re-pointed. Called on every request and when the configuration changes.
   */
  reconcile(): void {
    const bases = this.bases();
    for (const [id, entry] of [...this.entries]) {
      const base = bases.find((b) => b.id === id);
      if (!base || !base.enabled || fingerprintOf(base) !== entry.fingerprint) {
        this.disposeEntry(id, entry);
      }
    }
  }

  private disposeEntry(id: string, entry: Entry): void {
    for (const w of entry.watchers) {
      try {w.dispose();} catch { /* already gone */ }
    }
    entry.watchers = [];
    this.entries.delete(id);
  }

  /** Stop every watcher (extension deactivate). */
  dispose(): void {
    this.disposed = true;
    for (const [id, entry] of [...this.entries]) {this.disposeEntry(id, entry);}
    this.listeners.clear();
  }

  /** Number of live watchers (tests, diagnostics). */
  watcherCount(): number {
    let n = 0;
    for (const e of this.entries.values()) {n += e.watchers.length;}
    return n;
  }

  /** Mark one base's index (or all) stale; the next use walks again. */
  invalidate(baseId?: string): void {
    for (const [id, entry] of this.entries) {
      if (baseId === undefined || id === baseId) {entry.stale = true;}
    }
  }

  watch(baseId: string, onChange: () => void): () => void {
    let set = this.listeners.get(baseId);
    if (!set) {
      set = new Set();
      this.listeners.set(baseId, set);
    }
    set.add(onChange);
    return () => {
      set?.delete(onChange);
    };
  }

  private notify(baseId: string): void {
    for (const cb of [...(this.listeners.get(baseId) ?? [])]) {
      try {cb();} catch { /* a listener must not break the watcher */ }
    }
  }

  // ── The walk ─────────────────────────────────────────────────────────────

  private async canonicalRoot(root: string): Promise<string | null> {
    try {
      const real = await this.deps.fs.realpath(root);
      const st = await this.deps.fs.stat(real);
      return st.kind === 'dir' ? real : null;
    } catch {
      return null;
    }
  }

  /** Markdown files under a canonical root: no symlinks, no `node_modules`, no hidden folders, at most `limit`. */
  private async walk(realRoot: string, limit: number): Promise<{ rels: string[]; capReached: boolean }> {
    const { fs } = this.deps;
    const rels: string[] = [];
    const stack: string[] = [''];
    while (stack.length > 0) {
      const rel = stack.pop() as string;
      const dir = rel === '' ? realRoot : nodePath.join(realRoot, ...rel.split('/'));
      let entries: Array<{ name: string; kind: DocsEntryKind }>;
      try {
        entries = await fs.readDirectory(dir);
      } catch {
        continue;
      }
      entries.sort((a, b) => cmpCodePoints(a.name, b.name));
      const dirs: string[] = [];
      for (const entry of entries) {
        if (entry.name === '' || entry.name === '.' || entry.name === '..' || entry.name.includes('/') || entry.name.includes('\\') || entry.name.includes('\0')) {continue;}
        // `kind` already folds the symlink bit in: a symlinked folder or file is neither 'dir' nor 'file' here.
        if (entry.kind === 'dir') {
          if (!skipDocsDir(entry.name)) {dirs.push(rel === '' ? entry.name : `${rel}/${entry.name}`);}
        } else if (entry.kind === 'file' && isMarkdownName(entry.name)) {
          rels.push(rel === '' ? entry.name : `${rel}/${entry.name}`);
          if (rels.length >= limit) {return { rels, capReached: true };}
        }
      }
      for (let i = dirs.length - 1; i >= 0; i--) {stack.push(dirs[i]);}
    }
    return { rels, capReached: false };
  }

  /** Read one file for the index: size check first, then headings, title, links. Null: skipped (oversize is counted by the caller). */
  private async indexFile(realRoot: string, rel: string, label: string): Promise<{ page?: Parameters<typeof buildDocsIndex>[0]['pages'][number]; oversize?: boolean }> {
    const abs = nodePath.join(realRoot, ...rel.split('/'));
    try {
      const st = await this.deps.fs.stat(abs);
      if (st.kind !== 'file') {return {};}
      if (st.size > DOCS_MAX_FILE_BYTES) {return { oversize: true };}
      const text = await this.deps.fs.readFile(abs);
      if (text.length > DOCS_MAX_FILE_BYTES) {return { oversize: true };}
      const title = frontmatterTitle(text);
      return {
        page: {
          root: label,
          relPath: rel,
          ...(title ? { title } : {}),
          headings: headingsOutline(text),
          links: extractDocsLinks(text),
          chars: text.length,
        },
      };
    } catch {
      return {};
    }
  }

  private async build(base: AiDocBase): Promise<BuiltBase> {
    const labels = docsRootLabels(base.roots);
    const reals = await Promise.all(base.roots.map((r) => this.canonicalRoot(r)));
    const pages: Parameters<typeof buildDocsIndex>[0]['pages'][number][] = [];
    const foundLabels: Array<{ label: string }> = [];
    const files = new Map<string, IndexedFile>();
    const perRoot: Array<{ oversize: number; capReached: boolean }> = base.roots.map(() => ({ oversize: 0, capReached: false }));
    let remaining = DOCS_MAX_FILES;
    let oversizeSkipped = 0;
    let truncated = false;

    for (let i = 0; i < base.roots.length; i++) {
      const real = reals[i];
      if (real === null) {continue;}
      foundLabels.push({ label: labels[i] });
      if (remaining <= 0) {
        perRoot[i].capReached = true;
        truncated = true;
        continue;
      }
      const walked = await this.walk(real, remaining);
      remaining -= walked.rels.length;
      if (walked.capReached) {
        perRoot[i].capReached = true;
        truncated = true;
      }
      for (let at = 0; at < walked.rels.length; at += WALK_CONCURRENCY) {
        const batch = walked.rels.slice(at, at + WALK_CONCURRENCY);
        const results = await Promise.all(batch.map((rel) => this.indexFile(real, rel, labels[i])));
        results.forEach((r, k) => {
          if (r.oversize) {
            perRoot[i].oversize++;
            oversizeSkipped++;
          } else if (r.page) {
            pages.push(r.page);
            files.set(`${labels[i]}/${batch[k]}`, { pageId: `${labels[i]}/${batch[k]}`, rootIndex: i, relPath: batch[k] });
          }
        });
      }
    }

    const index = buildDocsIndex({
      baseId: base.id,
      roots: foundLabels,
      ...(base.homeFile ? { homeFile: base.homeFile } : {}),
      pages,
      truncated,
      oversizeSkipped,
      builtAt: this.now(),
    });
    // The builder drops unsafe or repeated pages; keep only files the index knows.
    const known = new Set(index.pages.map((p) => p.id));
    for (const id of [...files.keys()]) {
      if (!known.has(id)) {files.delete(id);}
    }

    const countByLabel = new Map<string, number>();
    for (const p of index.pages) {countByLabel.set(p.root, (countByLabel.get(p.root) ?? 0) + 1);}
    const pageById = new Map<string, AiDocsPage>(index.pages.map((p) => [p.id, p]));
    const rootStatuses: AiDocRootStatus[] = base.roots.map((root, i) => {
      const found = reals[i] !== null;
      const status: AiDocRootStatus = {
        root,
        label: labels[i],
        found,
        fileCount: found ? countByLabel.get(labels[i]) ?? 0 : 0,
        oversizeSkipped: perRoot[i].oversize,
        capReached: perRoot[i].capReached,
      };
      if (found) {
        const home = index.homes.find((h) => h.root === labels[i]);
        if (home) {
          status.home = home.kind;
          const page = home.pageId ? pageById.get(home.pageId) : undefined;
          if (page) {status.homePath = page.relPath;}
        }
      }
      return status;
    });

    this.log(`Docs base ${base.id}: indexed ${index.pages.length} files in ${foundLabels.length} of ${base.roots.length} roots${truncated ? ' (file cap reached)' : ''}${oversizeSkipped ? `, ${oversizeSkipped} oversize skipped` : ''}`);
    return {
      index,
      files,
      rootStatuses,
      fileCount: index.pages.length,
      oversizeSkipped,
      capReached: perRoot.some((r) => r.capReached),
      brokenLinks: createDocsLinkResolver(index).countBroken(),
      foundSignature: reals.map((r) => (r === null ? '0' : '1')).join(''),
    };
  }

  /** The base's built index: cached while fresh, otherwise walked (deduped across concurrent callers). */
  private async ensureBuilt(base: AiDocBase, force = false): Promise<BuiltBase> {
    if (this.disposed) {throw new Error('Documentation bases are no longer available.');}
    this.reconcile();
    let entry = this.entries.get(base.id);
    if (!entry) {
      entry = { fingerprint: fingerprintOf(base), builtAt: 0, stale: true, watchers: [], watchedRoots: [] };
      this.entries.set(base.id, entry);
    }
    const fresh = entry.built && !entry.stale && this.now() - entry.builtAt < (this.deps.ttlMs ?? DOCS_INDEX_TTL_MS);
    if (fresh && !force) {return entry.built as BuiltBase;}
    if (entry.building && !force) {return entry.building;}

    entry.stale = false;
    const e = entry;
    const building = this.build(base).then(
      (built) => {
        e.built = built;
        e.builtAt = this.now();
        this.watchRoots(base, e, built);
        return built;
      },
      (err) => {
        e.stale = true;
        throw err;
      },
    );
    e.building = building;
    void building.then(() => { if (e.building === building) {e.building = undefined;} }, () => { if (e.building === building) {e.building = undefined;} });
    return building;
  }

  /** One watcher per found root; kept across re-walks while the roots are the same. */
  private watchRoots(base: AiDocBase, entry: Entry, built: BuiltBase): void {
    const deps = this.deps;
    if (!deps.createWatcher || this.disposed || this.entries.get(base.id) !== entry) {return;}
    const wanted = base.roots.filter((_, i) => built.rootStatuses[i].found);
    if (entry.watchers.length > 0 && JSON.stringify(entry.watchedRoots) === JSON.stringify(wanted)) {return;}
    for (const w of entry.watchers) {
      try {w.dispose();} catch { /* already gone */ }
    }
    entry.watchers = [];
    entry.watchedRoots = wanted;
    for (const root of wanted) {
      try {
        entry.watchers.push(deps.createWatcher(root, () => {
          entry.stale = true;
          this.notify(base.id);
        }));
      } catch (err) {
        this.log(`Docs base ${base.id}: could not watch a root (${err instanceof Error ? err.message : String(err)})`);
      }
    }
  }

  /** The configured base with this id, enabled and with at least one root found. Rejects otherwise (A9). */
  private async activeBase(baseId: string, force = false): Promise<{ base: AiDocBase; built: BuiltBase }> {
    const base = typeof baseId === 'string' ? this.bases().find((b) => b.id === baseId) : undefined;
    if (!base) {throw new Error('Unknown documentation base.');}
    if (!base.enabled) {throw new Error(`The documentation base "${base.name}" is turned off.`);}
    const built = await this.ensureBuilt(base, force);
    if (!built.rootStatuses.some((r) => r.found)) {throw new Error(`The documentation base "${base.name}" has no folder that can be read (Root not found).`);}
    return { base, built };
  }

  // ── MikeDownDocsHost ─────────────────────────────────────────────────────

  /**
   * Every base with its health. Enabled bases come from the cached index
   * while it is fresh; a root that appeared or went missing since, or `refresh`,
   * walks again. Disabled bases are not walked.
   */
  async listBases(opts: { refresh?: boolean } = {}): Promise<AiDocBaseStatus[]> {
    this.reconcile();
    const out: AiDocBaseStatus[] = [];
    for (const base of this.bases()) {
      const labels = docsRootLabels(base.roots);
      if (!base.enabled) {
        const reals = await Promise.all(base.roots.map((r) => this.canonicalRoot(r)));
        const roots: AiDocRootStatus[] = base.roots.map((root, i) => ({ root, label: labels[i], found: reals[i] !== null, fileCount: 0, oversizeSkipped: 0, capReached: false }));
        out.push({ base, active: false, roots, fileCount: 0, oversizeSkipped: 0, rootsMissing: roots.filter((r) => !r.found).length, capReached: false });
        continue;
      }
      let built: BuiltBase;
      try {
        const reals = await Promise.all(base.roots.map((r) => this.canonicalRoot(r)));
        const signature = reals.map((r) => (r === null ? '0' : '1')).join('');
        const cached = this.entries.get(base.id)?.built;
        built = await this.ensureBuilt(base, opts.refresh === true || (cached !== undefined && cached.foundSignature !== signature));
      } catch {
        const roots: AiDocRootStatus[] = base.roots.map((root, i) => ({ root, label: labels[i], found: false, fileCount: 0, oversizeSkipped: 0, capReached: false }));
        out.push({ base, active: false, roots, fileCount: 0, oversizeSkipped: 0, rootsMissing: roots.length, capReached: false });
        continue;
      }
      const found = built.rootStatuses.filter((r) => r.found).length;
      out.push({
        base,
        active: found > 0,
        roots: built.rootStatuses.map((r) => ({ ...r })),
        fileCount: built.fileCount,
        oversizeSkipped: built.oversizeSkipped,
        rootsMissing: built.rootStatuses.length - found,
        capReached: built.capReached,
        // Counted when this base was walked; a base with no readable folder was not.
        ...(found > 0 ? { brokenLinks: built.brokenLinks } : {}),
      });
    }
    return out;
  }

  async index(baseId: string): Promise<AiDocsIndex> {
    const { built } = await this.activeBase(baseId);
    return built.index;
  }

  /**
   * Read one indexed file, or say why not (S2). `rootIndex` picks the
   * configured root; both the root and the file are canonicalized now, not
   * trusted from index time.
   */
  private async readCanonical(base: AiDocBase, file: IndexedFile): Promise<{ text: string } | { refused: string }> {
    const { fs } = this.deps;
    const root = base.roots[file.rootIndex];
    if (root === undefined) {return { refused: 'root is not in the configuration' };}
    let realRoot: string;
    let realFile: string;
    try {
      realRoot = await fs.realpath(root);
    } catch {
      return { refused: 'root not found' };
    }
    try {
      realFile = await fs.realpath(nodePath.join(realRoot, ...file.relPath.split('/')));
    } catch {
      return { refused: 'file not found' };
    }
    if (!isPathUnderRoot(realRoot, realFile, this.platform)) {return { refused: 'outside the root' };}
    if (!isMarkdownName(realFile)) {return { refused: 'not a markdown file' };}
    // The file must still be exactly the one the walker listed: the canonical
    // root joined with the index's relPath. A file swapped for a link (even one
    // that points inside the root) and a parent folder swapped for a link both
    // resolve somewhere else and are refused here.
    if (!samePath(realFile, nodePath.join(realRoot, ...file.relPath.split('/')), this.platform)) {return { refused: 'not the file that was indexed' };}
    try {
      const st = await fs.stat(realFile);
      if (st.kind !== 'file') {return { refused: 'not a regular file' };}
      if (st.size > DOCS_MAX_FILE_BYTES) {return { refused: 'file is over the size limit' };}
      const text = await fs.readFile(realFile);
      if (text.length > DOCS_MAX_FILE_BYTES) {return { refused: 'file is over the size limit' };}
      return { text };
    } catch {
      return { refused: 'could not be read' };
    }
  }

  /** `readSections` plus the reason for each id that was left out (for tests and the log). */
  async readSectionsDetailed(baseId: string, ids: string[]): Promise<{ sections: AiDocsSection[]; refused: Array<{ id: string; reason: string }> }> {
    const { base, built } = await this.activeBase(baseId);
    const pagesById = new Map<string, AiDocsPage>(built.index.pages.map((p) => [p.id, p]));
    const sections: AiDocsSection[] = [];
    const refused: Array<{ id: string; reason: string }> = [];
    const wanted = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 2000).slice(0, DOCS_MAX_IDS_PER_READ) : [];
    const seen = new Set<string>();
    // Files read once per call, even when several sections of one page are asked for.
    const texts = new Map<string, Promise<{ text: string } | { refused: string }>>();
    for (const id of wanted) {
      if (seen.has(id)) {continue;}
      seen.add(id);
      const parsed = parseDocsId(id, (pageId) => built.files.has(pageId));
      const file = parsed ? built.files.get(parsed.pageId) : undefined;
      const page = parsed ? pagesById.get(parsed.pageId) : undefined;
      if (!parsed || !file || !page) {
        refused.push({ id, reason: 'not in the index' });
        continue;
      }
      let pending = texts.get(parsed.pageId);
      if (!pending) {
        pending = this.readCanonical(base, file);
        texts.set(parsed.pageId, pending);
      }
      const read = await pending;
      if ('refused' in read) {
        refused.push({ id, reason: read.refused });
        continue;
      }
      if (parsed.slug === undefined) {
        const capped = capSectionText(read.text);
        sections.push({ id, pageId: page.id, title: page.title, relPath: page.relPath, text: capped.text, truncated: capped.truncated });
        continue;
      }
      const part = splitDocsSections(read.text).find((s) => s.heading !== null && s.heading.slug === parsed.slug);
      if (!part || !part.heading) {
        refused.push({ id, reason: 'section not in the file any more' });
        continue;
      }
      const capped = capSectionText(part.text);
      sections.push({ id, pageId: page.id, title: page.title, relPath: page.relPath, heading: part.heading.text, text: capped.text, truncated: capped.truncated });
    }
    if (refused.length > 0) {
      this.log(`Docs base ${base.id}: ${refused.length} of ${seen.size} requested ids left out (${[...new Set(refused.map((r) => r.reason))].join('; ')})`);
    }
    return { sections, refused };
  }

  async readSections(baseId: string, ids: string[]): Promise<AiDocsSection[]> {
    return (await this.readSectionsDetailed(baseId, ids)).sections;
  }

  async keywordSearch(baseId: string, query: string): Promise<AiDocsSectionRef[]> {
    const { base, built } = await this.activeBase(baseId);
    if (typeof query !== 'string' || query.trim() === '') {return [];}
    const q = query.slice(0, 2000);
    const pages = built.index.pages;
    const merged: AiDocsSectionRef[] = [];
    for (let at = 0; at < pages.length; at += WALK_CONCURRENCY) {
      const batch = pages.slice(at, at + WALK_CONCURRENCY);
      const results = await Promise.all(batch.map(async (page) => {
        const file = built.files.get(page.id);
        if (!file) {return [];}
        const read = await this.readCanonical(base, file);
        if ('refused' in read) {return [];}
        const sections: DocsKeywordSection[] = splitDocsSections(read.text).map((s) => ({
          id: s.heading ? docsSectionId(page.id, s.heading.slug) : page.id,
          pageId: page.id,
          title: page.title,
          relPath: page.relPath,
          ...(s.heading ? { heading: s.heading.text } : {}),
          text: s.text,
        }));
        // A page with no headings and no preamble text has no sections; nothing to rank.
        return rankKeywordSections(q, sections);
      }));
      for (const refs of results) {merged.push(...refs);}
      // Keep the pool small: the global top 20 is inside the union of each file's top 20.
      if (merged.length > 400) {
        merged.sort((a, b) => b.score - a.score || cmpCodePoints(a.id, b.id));
        merged.length = 100;
      }
    }
    merged.sort((a, b) => b.score - a.score || cmpCodePoints(a.id, b.id));
    return merged.slice(0, DOCS_KEYWORD_TOP);
  }

  async saveBases(incoming: unknown): Promise<void> {
    const deps = this.deps;
    if (!deps.writeBases) {throw new Error('Saving documentation bases is not available.');}
    const { bases } = prepareBasesForSave(this.bases(), incoming, deps.generateId);
    await deps.writeBases(bases);
    this.reconcile();
  }

  async addWorkspaceFolder(): Promise<string | null> {
    return this.deps.pickWorkspaceFolder ? this.deps.pickWorkspaceFolder() : null;
  }
}
