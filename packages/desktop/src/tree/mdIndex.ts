/**
 * The folder `.md` index behind the knowledge-base host methods (edge case
 * 13): link suggestions, `file.md#` heading completion, name-based
 * `[[wikilink]]` resolution with a nearest-match rule and an ambiguity count,
 * creating a wikilink's file next to the current document, and broken-link
 * detection.
 *
 * The file list comes from the Rust walker (`list_markdown`, which skips
 * `.mikedown/`, hidden folders and `node_modules`). It is read lazily on the
 * first question, not when the folder opens (a 10,000-file folder must open
 * in under a second), dropped whenever the watcher reports a change, and
 * re-read after a short TTL so changes in folders nobody expanded (and so
 * nobody watches) still show up. Headings are read from the file each time
 * they are asked for; they are only needed for `#` completion and link checks.
 *
 * Lone-file windows have no index: TauriHost leaves these methods absent.
 */
import type { LinkSuggestion, WikilinkResolution } from '@mikedown/core';
import { githubAnchorId } from '@mikedown/core/shared/anchoring';
import type { PathOps } from '@mikedown/core/shared/imagePaste';
import { relativeLinkHref } from './dropRouting';

export interface LinkCheck {
  href: string;
  type: 'anchor' | 'file' | 'fileAnchor';
}

export interface MdIndexDeps {
  path: PathOps;
  listMarkdown(root: string): Promise<string[]>;
  readText(path: string): Promise<{ text: string }>;
  exists(path: string): Promise<boolean>;
  /** Create the file with this content; fails when it exists. */
  createFile(path: string, content: string): Promise<void>;
  /** Milliseconds; injectable for tests. */
  now?: () => number;
  /** How long a file list is trusted without a watcher event. */
  ttlMs?: number;
}

// ── Pure helpers ───────────────────────────────────────────────────────────

const MD_EXT = /\.(md|markdown)$/i;

/** `Note` for `/notes/Note.md`: the name a `[[wikilink]]` matches. */
export function wikilinkName(file: string, path: PathOps): string {
  return path.basename(file).replace(MD_EXT, '');
}

/** ATX headings outside fenced code, with GitHub's duplicate suffixes. */
export function extractHeadings(text: string): Array<{ text: string; level: number; slug: string }> {
  const out: Array<{ text: string; level: number; slug: string }> = [];
  const seen = new Map<string, number>();
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) {fence = f[1][0];}
      else if (f[1][0] === fence) {fence = null;}
      continue;
    }
    if (fence !== null) {continue;}
    const m = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) {continue;}
    const base = githubAnchorId(m[2]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({ text: m[2], level: m[1].length, slug: n === 0 ? base : `${base}-${n}` });
  }
  return out;
}

/** `<a id="x">` / `<a name="x">` and `{#x}`-free HTML anchors a link may target. */
export function htmlAnchorIds(text: string): string[] {
  const ids: string[] = [];
  const re = /<a\s[^>]*\b(?:id|name)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {ids.push(m[1]);}
  return ids;
}

export function anchorSet(text: string): Set<string> {
  return new Set([...extractHeadings(text).map((h) => h.slug), ...htmlAnchorIds(text)]);
}

export function headingSuggestions(text: string): LinkSuggestion[] {
  return [
    ...extractHeadings(text).map((h) => ({ label: h.text, href: `#${h.slug}`, type: 'anchor' as const, level: h.level })),
    ...htmlAnchorIds(text).map((id) => ({ label: id, href: `#${id}`, type: 'anchor' as const })),
  ];
}

/**
 * Rank basename matches by proximity to `fromDir` (the VS Code extension's
 * rule, `src/wikilinkResolve.ts`): same folder first, then fewest directory
 * hops, then the shorter path, then lexicographic.
 */
export function rankCandidates(files: readonly string[], fromDir: string, path: PathOps): string[] {
  const hops = (file: string): number => {
    const rel = path.relative(fromDir, file);
    return rel ? rel.split(/[\\/]/).filter(Boolean).length : 0;
  };
  const sameDir = (file: string): number => (path.relative(fromDir, path.dirname(file)) === '' ? 0 : 1);
  return [...files].sort((a, b) =>
    sameDir(a) - sameDir(b)
    || hops(a) - hops(b)
    || a.length - b.length
    || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Files a wikilink target names: `[[Note]]` matches any `Note.md` (case
 * insensitive); `[[sub/Note]]` matches a file whose path, relative to the
 * root, ends with `sub/Note.md`.
 */
export function matchTarget(target: string, files: readonly string[], root: string, path: PathOps): string[] {
  const want = target.trim().replace(/\\/g, '/').replace(MD_EXT, '').toLowerCase();
  if (!want) {return [];}
  if (!want.includes('/')) {
    return files.filter((f) => wikilinkName(f, path).toLowerCase() === want);
  }
  const tail = want.replace(/^\/+/, '');
  return files.filter((f) => {
    const rel = path.relative(root, f).replace(/\\/g, '/').replace(MD_EXT, '').toLowerCase();
    return rel === tail || rel.endsWith(`/${tail}`);
  });
}

/** Resolve wikilink targets for the document at `fromDoc`. */
export function resolveTargets(
  targets: readonly string[],
  files: readonly string[],
  root: string,
  fromDoc: string,
  path: PathOps,
): WikilinkResolution[] {
  const fromDir = path.dirname(fromDoc);
  return targets.map((target) => {
    const matches = matchTarget(target, files, root, path);
    if (matches.length === 0) {return { target, href: null, count: 0 };}
    const best = rankCandidates(matches, fromDir, path)[0];
    return { target, href: relativeLinkHref(fromDoc, best, path), count: matches.length };
  });
}

/** Where `[[target]]`'s new file goes (next to the current document), or a reason it cannot. */
export function wikilinkFilePath(target: string, fromDoc: string, path: PathOps): { path: string; heading: string } | { error: string } {
  const raw = target.trim();
  if (!raw) {return { error: 'The wikilink has no target.' };}
  const segs = raw.split(/[\\/]/);
  if (segs.some((s) => s === '..' || s === '.') || path.isAbsolute(raw)) {
    return { error: `Cannot create “${raw}”: a wikilink names a note, not a path outside this folder.` };
  }
  const name = MD_EXT.test(raw) ? raw : `${raw}.md`;
  return { path: path.join(path.dirname(fromDoc), ...name.split(/[\\/]/)), heading: segs[segs.length - 1].replace(MD_EXT, '') };
}

function splitHref(href: string): { file: string; anchor: string | null } {
  const hash = href.indexOf('#');
  let file = hash >= 0 ? href.slice(0, hash) : href;
  const anchor = hash >= 0 ? href.slice(hash + 1) : null;
  const q = file.indexOf('?');
  if (q >= 0) {file = file.slice(0, q);}
  try { file = decodeURIComponent(file); } catch { /* keep raw */ }
  return { file, anchor };
}

// ── The index ──────────────────────────────────────────────────────────────

export interface MdIndex {
  readonly root: string;
  /** Drop the cached file list (a watcher event, a tree operation). */
  invalidate(): void;
  files(): Promise<string[]>;
  linkSuggestions(docPath: string | null, docText: string): Promise<LinkSuggestion[]>;
  /** `filePath` as typed in the link, relative to the current document. */
  fileHeadings(docPath: string | null, filePath: string): Promise<LinkSuggestion[]>;
  resolveWikilinks(docPath: string | null, targets: string[]): Promise<WikilinkResolution[]>;
  /** Create the target next to the current document; returns its path and the resolution. */
  createWikilink(docPath: string | null, target: string): Promise<{ path: string; created: boolean; resolution: WikilinkResolution }>;
  checkLinks(docPath: string | null, docText: string, links: LinkCheck[]): Promise<string[]>;
}

export function createMdIndex(root: string, deps: MdIndexDeps): MdIndex {
  const { path } = deps;
  const now = deps.now ?? (() => Date.now());
  const ttl = deps.ttlMs ?? 15_000;
  let cached: { files: string[]; at: number } | null = null;
  let pending: Promise<string[]> | null = null;
  let generation = 0;

  async function files(): Promise<string[]> {
    if (cached && now() - cached.at < ttl) {return cached.files;}
    if (pending) {return pending;}
    const gen = generation;
    pending = deps.listMarkdown(root).then((list) => {
      if (gen === generation) {cached = { files: list, at: now() };}
      pending = null;
      return list;
    }, (err: unknown) => {
      pending = null;
      throw err;
    });
    return pending;
  }

  function invalidate(): void {
    generation++;
    cached = null;
    pending = null;
  }

  async function readOrNull(p: string): Promise<string | null> {
    try {
      return (await deps.readText(p)).text;
    } catch {
      return null;
    }
  }

  return {
    root,
    invalidate,
    files,
    async linkSuggestions(docPath, docText) {
      const list = await files();
      const from = docPath ?? path.join(root, 'Untitled.md');
      const fileItems: LinkSuggestion[] = list
        .filter((f) => f !== docPath)
        .map((f) => ({ label: path.basename(f), href: relativeLinkHref(from, f, path), type: 'file' as const }));
      return [...fileItems, ...headingSuggestions(docText)];
    },
    async fileHeadings(docPath, filePath) {
      const { file } = splitHref(filePath);
      const base = docPath ? path.dirname(docPath) : root;
      const abs = path.isAbsolute(file) ? path.normalize(file) : path.resolve(base, file);
      const text = await readOrNull(abs);
      return text === null ? [] : headingSuggestions(text);
    },
    async resolveWikilinks(docPath, targets) {
      const list = await files();
      return resolveTargets(targets, list, root, docPath ?? path.join(root, 'Untitled.md'), path);
    },
    async createWikilink(docPath, target) {
      if (!docPath) {throw new Error('Save the document first so the new note has a folder.');}
      const plan = wikilinkFilePath(target, docPath, path);
      if ('error' in plan) {throw new Error(plan.error);}
      let created = false;
      if (!(await deps.exists(plan.path))) {
        await deps.createFile(plan.path, `# ${plan.heading}\n`);
        created = true;
      }
      invalidate();
      return { path: plan.path, created, resolution: { target, href: relativeLinkHref(docPath, plan.path, path), count: 1 } };
    },
    async checkLinks(docPath, docText, links) {
      const broken: string[] = [];
      const own = anchorSet(docText);
      const anchorsOf = new Map<string, Set<string> | null>();
      for (const link of links) {
        if (link.type === 'anchor') {
          if (!own.has(link.href.slice(1))) {broken.push(link.href);}
          continue;
        }
        // Relative links need a document to be relative to.
        if (!docPath) {continue;}
        const { file, anchor } = splitHref(link.href);
        if (!file) {continue;}
        const abs = path.isAbsolute(file) ? path.normalize(file) : path.resolve(path.dirname(docPath), file);
        if (!(await deps.exists(abs))) {
          broken.push(link.href);
          continue;
        }
        if (link.type === 'fileAnchor' && anchor && MD_EXT.test(abs)) {
          if (!anchorsOf.has(abs)) {
            const text = await readOrNull(abs);
            anchorsOf.set(abs, text === null ? null : anchorSet(text));
          }
          const set = anchorsOf.get(abs);
          if (!set || !set.has(anchor)) {broken.push(link.href);}
        }
      }
      return broken;
    },
  };
}
