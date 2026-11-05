/**
 * Home document per root (decision 3) and the in-memory map used when a root
 * has none. Pure.
 *
 * Precedence, per root: the base's override file (`homeFile`, a rel path),
 * then `INDEX.md`, then `README.md` at the root's top level, then the map.
 * Names match with ASCII case folding (`readme.md` counts); when several
 * pages fold to the same name the exact-case one wins, then the first in
 * sorted order.
 */

import type { AiDocHomeKind, AiDocsHome, AiDocsIndex, AiDocsPage } from '../types';
import { DOCS_MAX_MAP_ENTRIES } from './caps';
import { cmpCodePoints, foldAscii } from './util';

/** The health text for a root with no home document. */
export const DOCS_NO_HOME_TEXT = 'No home document';

function findPage(pages: readonly AiDocsPage[], root: string, relPath: string): AiDocsPage | null {
  const folded = foldAscii(relPath);
  let insensitive: AiDocsPage | null = null;
  for (const p of pages) {
    if (p.root !== root) {continue;}
    if (p.relPath === relPath) {return p;}
    if (insensitive === null && foldAscii(p.relPath) === folded) {insensitive = p;}
  }
  return insensitive;
}

/** Pick the home of each root. `pages` must be the index's (sorted) pages. */
export function chooseDocsHomes(rootLabels: readonly string[], pages: readonly AiDocsPage[], homeFile?: string): AiDocsHome[] {
  return rootLabels.map((root) => {
    const steps: Array<[AiDocHomeKind, string | undefined]> = [
      ['override', homeFile],
      ['index', 'INDEX.md'],
      ['readme', 'README.md'],
    ];
    for (const [kind, rel] of steps) {
      if (!rel) {continue;}
      const page = findPage(pages, root, rel);
      if (page) {return { root, kind, pageId: page.id };}
    }
    return { root, kind: 'map' as const, pageId: null };
  });
}

/** True when no root of the index has a real home. */
export function docsHasNoHome(homes: readonly AiDocsHome[]): boolean {
  return homes.length > 0 && homes.every((h) => h.kind === 'map');
}

/** The health line for one root's home: `null` when it has one, else "No home document". */
export function docsHomeHealth(home: AiDocsHome): string | null {
  return home.kind === 'map' ? DOCS_NO_HOME_TEXT : null;
}

export interface DocsMapEntry {
  pageId: string;
  title: string;
  /** Texts of the page's level 1 to 3 headings, at most `DOCS_MAP_HEADINGS_PER_PAGE`. */
  headings: string[];
}

export interface DocsMap {
  root: string;
  entries: DocsMapEntry[];
  /** Pages of the root that did not fit the cap. */
  omitted: number;
}

export const DOCS_MAP_HEADINGS_PER_PAGE = 8;

function depth(relPath: string): number {
  let n = 0;
  for (let i = 0; i < relPath.length; i++) {if (relPath[i] === '/') {n++;}}
  return n;
}

/**
 * The in-memory map of one root: titles and headings of its pages, at most
 * `cap` pages (400). When the root has more, the shallowest pages are kept
 * (fewest folders, then path order) and the entries are listed in path order.
 * Nothing is written to disk.
 */
export function buildDocsMap(index: Pick<AiDocsIndex, 'pages'>, root: string, cap: number = DOCS_MAX_MAP_ENTRIES): DocsMap {
  const pages = index.pages.filter((p) => p.root === root);
  let chosen = pages;
  if (pages.length > cap) {
    chosen = [...pages]
      .sort((a, b) => depth(a.relPath) - depth(b.relPath) || cmpCodePoints(a.relPath, b.relPath))
      .slice(0, cap)
      .sort((a, b) => cmpCodePoints(a.relPath, b.relPath));
  }
  return {
    root,
    entries: chosen.map((p) => ({
      pageId: p.id,
      title: p.title,
      headings: p.headings.filter((h) => h.level <= 3).slice(0, DOCS_MAP_HEADINGS_PER_PAGE).map((h) => h.text),
    })),
    omitted: pages.length - chosen.length,
  };
}

/** One line per page: `- <page id> | <title> | <heading>; <heading>`; a final line counts what was left out. */
export function renderDocsMap(map: DocsMap): string {
  const lines = map.entries.map((e) => {
    const heads = e.headings.length > 0 ? ` | ${e.headings.join('; ')}` : '';
    return `- ${e.pageId} | ${e.title}${heads}`;
  });
  if (map.omitted > 0) {lines.push(`(${map.omitted} more pages not listed)`);}
  return lines.join('\n');
}
