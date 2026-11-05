/**
 * Documentation-base index: root labels, page ids, heading slugs and the
 * builder hosts call. Pure, no DOM, no network.
 *
 * THE ID CONTRACT (A10). The VS Code host (TypeScript) and Desktop (Rust)
 * must produce byte-identical labels, ids and slugs; `test/ai-fixtures/docs/`
 * holds the cases both run. Nothing here uses a regex feature or Unicode table
 * Rust's standard library lacks.
 *
 * ROOT LABEL (`docsRootLabels`). A base has one or more root folders. Each
 * gets a label, the first segment of every id under it.
 *   1. Take the root path, split it on `/` and `\`, drop empty segments, take
 *      the last one (the folder name). A path with no segment gives `root`.
 *   2. Replace `#` and every control character (below U+0020, and U+007F)
 *      with `_`. A segment that is `.` or `..` becomes `root`.
 *   3. Make labels unique within the base, in configured order: the first
 *      root keeps its label; a later root whose label is already taken gets
 *      `-2`, `-3`, ... appended (the smallest suffix whose result is unused).
 *      So `/a/docs` and `/b/docs` are `docs` and `docs-2`; a third `docs`
 *      folder is `docs-3`. Comparison is exact (case-sensitive).
 * Labels are only unique inside one base. Ids from two bases can be equal, so
 * the loop always pairs an id with its base id.
 *
 * PAGE ID. `<root label>/<rel path>`, the path relative to the root with `/`
 * separators and exactly as the file system spells it (case kept), e.g.
 * `docs/guides/setup.md`. A rel path never starts with `/`, is never empty
 * and has no `.` or `..` segment (such a page is dropped from the index).
 *
 * SECTION ID. `<page id>#<slug>`, one per heading `headingsOutline` reports
 * (ATX headings outside frontmatter and fenced code, with non-empty text).
 * A bare page id means the whole page. File names can contain `#`, so
 * `parseDocsId` looks a full id up as a page first and only then splits at
 * the LAST `#` (slugs never contain `#`).
 *
 * HEADING SLUG (`docsSlug`, `docsSlugs`). From the heading text as
 * `headingsOutline` returns it (trimmed, closing `#`s removed):
 *   1. Walk the code points. ASCII `A-Z` become `a-z`. `a-z`, `0-9`, `_` and
 *      `-` are kept. Whitespace (ASCII space, tab, LF, VT, FF, CR, plus
 *      U+0085, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F,
 *      U+3000) becomes `-`, one `-` per whitespace code point (not collapsed,
 *      as GitHub does). Any other ASCII character is dropped. Every non-ASCII
 *      code point is kept unchanged (no lowercasing), so non-Latin headings
 *      still get a distinct slug.
 *   2. An empty result becomes `section`.
 *   3. Duplicates on one page, in document order: the first keeps its slug;
 *      a later heading with a taken slug gets `-1`, `-2`, ... appended (the
 *      smallest suffix whose result is unused, so `Setup`, `Setup`, `Setup 1`
 *      give `setup`, `setup-1`, `setup-1-1`).
 * This equals GitHub's anchor for ASCII headings without odd collisions. Link
 * fragments are also matched against GitHub's anchor (`links.ts`).
 *
 * ORDER. `buildDocsIndex` sorts pages by root order, then rel path by code
 * point, so the same files give the same index on both hosts.
 */

import { githubAnchorId } from '../../shared/anchoring';
import type { AiDocsHeading, AiDocsIndex, AiDocsLink, AiDocsPage } from '../types';
import {
  DOCS_MAX_FILES,
  DOCS_MAX_HEADINGS_PER_PAGE,
  DOCS_MAX_LINKS_PER_PAGE,
} from './caps';
import { chooseDocsHomes } from './home';
import { cmpCodePoints, foldAscii, isAsciiAlnum, isDocsSpace } from './util';

// ── Root labels ─────────────────────────────────────────────────────────────

function labelBase(root: string): string {
  const parts = root.split(/[\\/]/).filter((s) => s.length > 0);
  let name = parts.length > 0 ? parts[parts.length - 1] : 'root';
  if (name === '.' || name === '..') {name = 'root';}
  let out = '';
  for (const ch of name) {
    const cp = ch.codePointAt(0) as number;
    out += cp === 0x23 || cp < 0x20 || cp === 0x7f ? '_' : ch;
  }
  return out;
}

/** One unique label per root, in the order given (see the header for the rule). */
export function docsRootLabels(roots: readonly string[]): string[] {
  const taken = new Set<string>();
  const out: string[] = [];
  for (const root of roots) {
    const base = labelBase(root);
    let label = base;
    for (let n = 2; taken.has(label); n++) {label = `${base}-${n}`;}
    taken.add(label);
    out.push(label);
  }
  return out;
}

// ── Slugs ───────────────────────────────────────────────────────────────────

/** The base slug of one heading text, before duplicate suffixes. */
export function docsSlug(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80) {
      if (cp >= 65 && cp <= 90) {out += String.fromCharCode(cp + 32);}
      else if (isAsciiAlnum(cp) || cp === 0x5f || cp === 0x2d) {out += ch;}
      else if (isDocsSpace(cp)) {out += '-';}
    } else if (isDocsSpace(cp)) {
      out += '-';
    } else {
      out += ch;
    }
  }
  return out === '' ? 'section' : out;
}

/** Unique slugs for a page's heading texts, in document order. */
export function docsSlugs(texts: readonly string[]): string[] {
  const used = new Set<string>();
  return texts.map((text) => {
    const base = docsSlug(text);
    let slug = base;
    for (let n = 1; used.has(slug); n++) {slug = `${base}-${n}`;}
    used.add(slug);
    return slug;
  });
}

/** GitHub's anchor for each heading text, with its `-1`, `-2` suffixes (used to match link fragments). */
export function githubAnchors(texts: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return texts.map((text) => {
    const base = githubAnchorId(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  });
}

// ── Ids ─────────────────────────────────────────────────────────────────────

/** `<root label>/<rel path>`. */
export function docsPageId(rootLabel: string, relPath: string): string {
  return `${rootLabel}/${relPath}`;
}

/** `<page id>#<slug>`. */
export function docsSectionId(pageId: string, slug: string): string {
  return `${pageId}#${slug}`;
}

/** The root label of a page or section id: everything before the first `/`. */
export function docsIdRoot(id: string): string {
  const i = id.indexOf('/');
  return i < 0 ? id : id.slice(0, i);
}

/**
 * Split an id the model or host named into its page id and optional slug.
 * `hasPage` says whether a full string is a page in the host's own index; the
 * whole id is tried first (a file name may contain `#`), then the part before
 * the last `#`. Returns null when neither is a known page: never build a path
 * from an id that is not in the index (S1).
 */
export function parseDocsId(id: string, hasPage: (pageId: string) => boolean): { pageId: string; slug?: string } | null {
  if (hasPage(id)) {return { pageId: id };}
  const hash = id.lastIndexOf('#');
  if (hash <= 0) {return null;}
  const pageId = id.slice(0, hash);
  const slug = id.slice(hash + 1);
  if (slug === '' || !hasPage(pageId)) {return null;}
  return { pageId, slug };
}

/** True for a rel path a page may have: non-empty, relative, no empty, `.` or `..` segment, no NUL. */
export function isSafeRelPath(relPath: string): boolean {
  if (relPath === '' || relPath.startsWith('/') || relPath.includes('\0')) {return false;}
  return relPath.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/** The file name without its `.md` / `.markdown` extension (any case). */
export function docsFileStem(relPath: string): string {
  const name = relPath.slice(relPath.lastIndexOf('/') + 1);
  const lower = foldAscii(name);
  if (lower.endsWith('.markdown')) {return name.slice(0, name.length - 9);}
  if (lower.endsWith('.md')) {return name.slice(0, name.length - 3);}
  return name;
}

// ── Builder ─────────────────────────────────────────────────────────────────

/** A page as the host extracts it: no id, no slugs, no body. */
export interface AiDocsPageInput {
  /** The root's label (`docsRootLabels`). */
  root: string;
  /** Path relative to the root, `/` separators. */
  relPath: string;
  /** Frontmatter `title`, when there is one. Else the first heading, else the file name. */
  title?: string;
  /** From `headingsOutline(markdown)`. */
  headings: Array<{ level: number; text: string }>;
  /** Links as written (`AiDocsLink`). */
  links?: AiDocsLink[];
  /** File length in characters. */
  chars: number;
}

export interface AiDocsIndexInput {
  baseId: string;
  /** Roots that were found, in configured order, each with its label. */
  roots: Array<{ label: string }>;
  /** The base's `homeFile` override, a rel path (applied under every root). */
  homeFile?: string;
  pages: readonly AiDocsPageInput[];
  /** The file cap cut the walk short (the builder also sets it past `DOCS_MAX_FILES`). */
  truncated?: boolean;
  oversizeSkipped?: number;
  /** Unix milliseconds; the builder is pure, so the host supplies the clock. */
  builtAt?: number;
}

function buildPage(input: AiDocsPageInput, id: string): AiDocsPage {
  const headingInputs = input.headings
    .filter((h) => typeof h.text === 'string' && h.text.trim() !== '')
    .slice(0, DOCS_MAX_HEADINGS_PER_PAGE);
  const slugs = docsSlugs(headingInputs.map((h) => h.text));
  const headings: AiDocsHeading[] = headingInputs.map((h, i) => ({
    id: docsSectionId(id, slugs[i]),
    level: Math.min(6, Math.max(1, Math.round(h.level) || 1)),
    text: h.text,
    slug: slugs[i],
  }));
  const fm = typeof input.title === 'string' ? input.title.trim() : '';
  const title = fm !== '' ? fm : headings.length > 0 ? headings[0].text : docsFileStem(input.relPath);
  return {
    id,
    root: input.root,
    relPath: input.relPath,
    title,
    headings,
    links: (input.links ?? []).slice(0, DOCS_MAX_LINKS_PER_PAGE),
    chars: Math.max(0, Math.round(input.chars) || 0),
  };
}

/**
 * Build a base's index from host-extracted pages: ids, unique slugs, titles,
 * deduped and sorted pages (a page with an unknown root label or an unsafe rel
 * path is dropped; for a repeated id the first in sorted order wins), the file
 * cap, and each root's home.
 */
export function buildDocsIndex(input: AiDocsIndexInput): AiDocsIndex {
  const rootOrder = new Map<string, number>();
  input.roots.forEach((r, i) => {
    if (!rootOrder.has(r.label)) {rootOrder.set(r.label, i);}
  });
  const usable = input.pages.filter((p) => rootOrder.has(p.root) && isSafeRelPath(p.relPath));
  usable.sort((a, b) => (rootOrder.get(a.root) as number) - (rootOrder.get(b.root) as number) || cmpCodePoints(a.relPath, b.relPath));
  const seen = new Set<string>();
  const pages: AiDocsPage[] = [];
  let truncated = input.truncated === true;
  for (const p of usable) {
    const id = docsPageId(p.root, p.relPath);
    if (seen.has(id)) {continue;}
    if (pages.length >= DOCS_MAX_FILES) {
      truncated = true;
      break;
    }
    seen.add(id);
    pages.push(buildPage(p, id));
  }
  return {
    baseId: input.baseId,
    roots: input.roots.map((r) => ({ label: r.label })),
    pages,
    homes: chooseDocsHomes(input.roots.map((r) => r.label), pages, input.homeFile),
    truncated,
    oversizeSkipped: Math.max(0, input.oversizeSkipped ?? 0),
    builtAt: input.builtAt ?? 0,
  };
}

/** Pages by id, for the lookups the loop and the link resolver do. */
export function docsPagesById(index: Pick<AiDocsIndex, 'pages'>): Map<string, AiDocsPage> {
  const map = new Map<string, AiDocsPage>();
  for (const p of index.pages) {map.set(p.id, p);}
  return map;
}
