/**
 * Getting from a cited section back to its file, and from the document being
 * edited to a base. Pure, for the chat panel and the editor's reveal.
 *
 * A chip's target comes from `host.docs.listBases()` (the root) and the section
 * the host read (`relPath`), never from model text. The href is a `file:` URL
 * because both hosts need an absolute path outside the current folder, and a
 * Windows path would read as a URL scheme. Hosts open it after their own checks.
 *
 * A heading is found again by M2's slug rule (`docs/index.ts`), not GitHub's:
 * the two differ on non-ASCII text and on some duplicates.
 */

import { headingsWithOffsets } from '../documentBudget';
import type { AiDocBaseStatus, AiDocsSection } from '../types';
import { encodeLinkPath, type DocsDocumentLocation } from './citations';
import { docsIdRoot, docsSlugs } from './index';

const parts = (path: string): string[] => path.split(/[\\/]+/).filter((s) => s !== '' && s !== '.');
const isDrive = (path: string): boolean => /^[A-Za-z]:[\\/]/.test(path);
const isUnc = (path: string): boolean => path.startsWith('\\\\');
const isWindows = (path: string): boolean => isDrive(path) || isUnc(path);
const isAbsolute = (path: string): boolean => path.startsWith('/') || isWindows(path);

/** `file:` URL for `relPath` under an absolute root: POSIX, drive letter or UNC. */
export function docsFileHref(root: string, relPath: string): string {
  const rel = relPath.split('/').filter((s) => s !== '').map(encodeLinkPath).join('/');
  if (isDrive(root)) {
    const [drive, ...rest] = parts(root);
    return `file:///${drive}/${[...rest.map(encodeLinkPath), rel].join('/')}`;
  }
  if (isUnc(root)) {
    const [server, ...rest] = parts(root);
    return `file://${server}/${[...rest.map(encodeLinkPath), rel].join('/')}`;
  }
  return `file:///${[...root.split('/').filter((s) => s !== '').map(encodeLinkPath), rel].join('/')}`;
}

/** The absolute path a section's file has, for display. Null when its base or root is no longer configured. */
export function docsSectionFile(section: Pick<AiDocsSection, 'pageId' | 'relPath'>, baseId: string, statuses: readonly AiDocBaseStatus[]): { root: string; relPath: string; baseName: string } | null {
  const status = statuses.find((s) => s.base.id === baseId);
  const label = docsIdRoot(section.pageId);
  const root = status?.roots.find((r) => r.label === label);
  return status && root ? { root: root.root, relPath: section.relPath, baseName: status.base.name } : null;
}

/**
 * Where a folder sits among the bases, for Insert's relative links. Null for a
 * folder that is not absolute (an untitled document) or under no root. A base
 * in `prefer` wins, so a folder under two bases links to the one the answer used.
 */
export function docsDocumentLocation(folder: string | null | undefined, statuses: readonly AiDocBaseStatus[], prefer: readonly string[] = []): DocsDocumentLocation | null {
  if (!folder || !isAbsolute(folder)) {return null;}
  const fold = (s: string): string => (isWindows(folder) ? s.toLowerCase() : s);
  const want = parts(folder);
  const ordered = [...statuses].sort((a, b) => Number(prefer.includes(b.base.id)) - Number(prefer.includes(a.base.id)));
  for (const status of ordered) {
    for (const root of status.roots) {
      if (!isAbsolute(root.root) || isWindows(root.root) !== isWindows(folder)) {continue;}
      const under = parts(root.root);
      if (under.length > want.length || !under.every((part, i) => fold(part) === fold(want[i]))) {continue;}
      return { baseId: status.base.id, root: root.label, folder: want.slice(under.length).join('/') };
    }
  }
  return null;
}

export interface DocsHeadingHit {
  /** Which heading, 0-based, counting the headings `headingsOutline` reports. */
  index: number;
  /** Where its line starts in `markdown`. */
  offset: number;
}

/** The heading whose M2 slug is `slug`, or null. */
export function docsHeadingAt(markdown: string, slug: string): DocsHeadingHit | null {
  const headings = headingsWithOffsets(markdown);
  const index = docsSlugs(headings.map((h) => h.text)).indexOf(slug);
  return index < 0 ? null : { index, offset: headings[index].start };
}
