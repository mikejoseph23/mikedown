/**
 * Resolve the links of a base's pages inside its index (decision 14), mark the
 * broken ones and produce the hop-1 link list. Pure; the host only extracts
 * links as written (`AiDocsLink`).
 *
 * Rules.
 *   - A link with a scheme (`https:`, `mailto:`, anything `name:` with two or
 *     more letters before the colon) or starting `//` is `external`: not
 *     followable, not counted as broken.
 *   - A relative link resolves from the linking page's folder. `?query` is
 *     dropped, `%XX` decoded (kept raw when malformed), `.` and `..`
 *     normalised. A link that climbs above its own root, or starts with `/`
 *     or a drive letter, is broken (`outside-root`) and never followable.
 *     The index does not know where roots sit on disk, so a link into a
 *     sibling root is broken too, even when that folder is another root of the
 *     base.
 *   - The target must be a page of the index (exact id; if the path has no
 *     `.md` / `.markdown` extension, `.md` is tried). Else broken `not-found`.
 *   - `#fragment` is matched against the page's heading slugs, then GitHub's
 *     anchors. A fragment that matches nothing still resolves to the page
 *     (`fragmentMissing`): the page is real.
 *   - Wikilinks (`[[Name]]`, `[[Name#Heading]]`, `[[folder/Name|alias]]`)
 *     match pages by file stem, ASCII case-folded, anywhere in the base. With
 *     several matches the nearest to the linking page wins (same folder, then
 *     fewest folder hops, then the shorter id, then code point order) and
 *     `ambiguous` carries the count. This is `pickBestWikilinkTarget`
 *     (`src/wikilinkResolve.ts`) reimplemented over page ids: core cannot
 *     import from `src/` and the original uses Node's `path`. Matching other
 *     active bases is the loop's job; `candidates` says how many matched here.
 */

import type { AiDocsIndex, AiDocsLink, AiDocsPage } from '../types';
import { DOCS_MAX_LINK_WORK, DOCS_MAX_LINKS } from './caps';
import { docsFileStem, docsPageId, githubAnchors } from './index';
import { cmpCodePoints, foldAscii } from './util';

export type AiDocsLinkStatus = 'ok' | 'broken' | 'external';
export type AiDocsBrokenReason = 'outside-root' | 'not-found';

export interface AiDocsResolvedLink {
  text: string;
  target: string;
  kind: AiDocsLink['kind'];
  status: AiDocsLinkStatus;
  reason?: AiDocsBrokenReason;
  /** The page the link lands on (status `ok`). */
  pageId?: string;
  /** The section it lands on, when the fragment matched a heading. */
  sectionId?: string;
  /** The page is real but the `#fragment` matched no heading. */
  fragmentMissing?: boolean;
  /** Wikilink only: how many pages matched the name in this base. */
  candidates?: number;
}

export interface DocsLinkResolver {
  resolve(fromPageId: string, link: AiDocsLink): AiDocsResolvedLink;
  /**
   * Links that are `broken`, over every page of the index. The work on
   * wikilinks is bounded (`DOCS_MAX_LINK_WORK` candidate pages); past it the
   * count stops, so it is a lower bound for a hostile base.
   */
  countBroken(): number;
  /** Broken links on one page, for a host that counts a page at a time and yields between pages. Shares the work bound. */
  countBrokenOn(pageId: string): number;
  /** The wikilink work bound was hit, so `countBroken` is a lower bound. */
  workExceeded(): boolean;
}

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]+:/;

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function dirOf(relPath: string): string[] {
  const parts = relPath.split('/');
  parts.pop();
  return parts;
}

/** Distance in path segments from the linking page's folder to a candidate (up-hops plus down-hops, file name included). */
function hops(fromId: string, candidateId: string): number {
  const from = fromId.split('/');
  from.pop();
  const cand = candidateId.split('/');
  let common = 0;
  while (common < from.length && common < cand.length - 1 && from[common] === cand[common]) {common++;}
  return from.length - common + (cand.length - common);
}

function sameFolder(fromId: string, candidateId: string): boolean {
  return fromId.slice(0, fromId.lastIndexOf('/')) === candidateId.slice(0, candidateId.lastIndexOf('/'));
}

/** Order wikilink candidates nearest first (see the header). Pure and total. */
export function rankDocsWikilinkCandidates(fromPageId: string, candidateIds: readonly string[]): string[] {
  return [...candidateIds].sort((a, b) => {
    const sa = sameFolder(fromPageId, a) ? 0 : 1;
    const sb = sameFolder(fromPageId, b) ? 0 : 1;
    if (sa !== sb) {return sa - sb;}
    const da = hops(fromPageId, a);
    const db = hops(fromPageId, b);
    if (da !== db) {return da - db;}
    if (a.length !== b.length) {return a.length - b.length;}
    return cmpCodePoints(a, b);
  });
}

/** Is candidate `a` nearer to the linking page than `b`? The comparator of `rankDocsWikilinkCandidates`, on parts split once. */
interface Cand {
  id: string;
  folder: string;
  parts: string[];
}

function nearer(fromFolder: string, fromParts: readonly string[], a: Cand, b: Cand): boolean {
  const sa = a.folder === fromFolder ? 0 : 1;
  const sb = b.folder === fromFolder ? 0 : 1;
  if (sa !== sb) {return sa < sb;}
  const da = hopsParts(fromParts, a.parts);
  const db = hopsParts(fromParts, b.parts);
  if (da !== db) {return da < db;}
  if (a.id.length !== b.id.length) {return a.id.length < b.id.length;}
  return cmpCodePoints(a.id, b.id) < 0;
}

function hopsParts(fromParts: readonly string[], candParts: readonly string[]): number {
  let common = 0;
  while (common < fromParts.length && common < candParts.length - 1 && fromParts[common] === candParts[common]) {common++;}
  return fromParts.length - common + (candParts.length - common);
}

export function createDocsLinkResolver(index: Pick<AiDocsIndex, 'pages'>): DocsLinkResolver {
  const byId = new Map<string, AiDocsPage>();
  const byStem = new Map<string, Array<Cand & { page: AiDocsPage; path: string }>>();
  /** Heading slug and GitHub anchor to the first heading that has it, per page, built when a link first needs them. */
  const slugAt = new Map<string, Map<string, number>>();
  const anchorAt = new Map<string, Map<string, number>>();
  /** Nearest page per (linking folder, wikilink name): the ranking depends on nothing else. */
  const nearest = new Map<string, { page: AiDocsPage | null; count: number }>();
  let work = 0;
  let exceeded = false;
  for (const p of index.pages) {
    byId.set(p.id, p);
    const stem = foldAscii(docsFileStem(p.relPath));
    const parts = p.id.split('/');
    const entry = { id: p.id, folder: p.id.slice(0, p.id.lastIndexOf('/')), parts, page: p, path: `/${foldAscii(p.relPath)}`.replace(/\.(?:md|markdown)$/, '') };
    const list = byStem.get(stem);
    if (list) {list.push(entry);} else {byStem.set(stem, [entry]);}
  }

  function firstIndex(map: Map<string, Map<string, number>>, page: AiDocsPage, keys: () => string[]): Map<string, number> {
    let m = map.get(page.id);
    if (!m) {
      m = new Map();
      keys().forEach((k, i) => {
        if (!m?.has(k)) {m?.set(k, i);}
      });
      map.set(page.id, m);
    }
    return m;
  }

  function matchFragment(page: AiDocsPage, rawFragment: string): string | null {
    if (rawFragment === '') {return null;}
    const fragment = safeDecode(rawFragment);
    const folded = foldAscii(fragment);
    const slugs = firstIndex(slugAt, page, () => page.headings.map((h) => h.slug));
    const bySlug = Math.min(slugs.get(fragment) ?? Infinity, slugs.get(folded) ?? Infinity);
    if (bySlug !== Infinity) {return page.headings[bySlug].id;}
    const anchors = firstIndex(anchorAt, page, () => githubAnchors(page.headings.map((h) => h.text)));
    const byAnchor = Math.min(anchors.get(fragment) ?? Infinity, anchors.get(folded) ?? Infinity);
    return byAnchor !== Infinity ? page.headings[byAnchor].id : null;
  }

  function landing(base: AiDocsResolvedLink, page: AiDocsPage, fragment: string): AiDocsResolvedLink {
    const out: AiDocsResolvedLink = { ...base, status: 'ok', pageId: page.id };
    if (fragment !== '') {
      const section = matchFragment(page, fragment);
      if (section) {out.sectionId = section;} else {out.fragmentMissing = true;}
    }
    return out;
  }

  function resolveMarkdown(from: AiDocsPage, link: AiDocsLink): AiDocsResolvedLink {
    const base: AiDocsResolvedLink = { text: link.text, target: link.target, kind: link.kind, status: 'broken' };
    const raw = link.target.trim();
    if (SCHEME.test(raw) || raw.startsWith('//')) {return { ...base, status: 'external' };}
    const hash = raw.indexOf('#');
    const pathPart = hash < 0 ? raw : raw.slice(0, hash);
    const fragment = hash < 0 ? '' : raw.slice(hash + 1);
    const noQuery = pathPart.split('?')[0];
    if (noQuery === '') {
      // `#fragment` alone points inside the page (an empty target is the page itself).
      return landing(base, from, fragment);
    }
    const decoded = safeDecode(noQuery);
    if (decoded.startsWith('/') || /^[A-Za-z]:/.test(decoded)) {return { ...base, reason: 'outside-root' };}
    const stack = dirOf(from.relPath);
    for (const seg of decoded.split('/')) {
      if (seg === '' || seg === '.') {continue;}
      if (seg === '..') {
        if (stack.length === 0) {return { ...base, reason: 'outside-root' };}
        stack.pop();
      } else {
        stack.push(seg);
      }
    }
    const rel = stack.join('/');
    const page = byId.get(docsPageId(from.root, rel)) ?? byId.get(docsPageId(from.root, `${rel}.md`));
    if (!page) {return { ...base, reason: 'not-found' };}
    return landing(base, page, fragment);
  }

  /** The page nearest to `from` among those named `wanted` (a folded name, maybe with folders), and how many matched. */
  function nearestPage(from: AiDocsPage, wanted: string): { page: AiDocsPage | null; count: number } {
    const folder = from.id.slice(0, from.id.lastIndexOf('/'));
    const key = `${folder}\u0000${wanted}`;
    const hit = nearest.get(key);
    if (hit) {return hit;}
    const stem = wanted.slice(wanted.lastIndexOf('/') + 1);
    const suffix = wanted.includes('/') ? `/${wanted.replace(/^\/+/, '')}` : '';
    const list = byStem.get(stem) ?? [];
    work += list.length;
    if (work > DOCS_MAX_LINK_WORK) {exceeded = true;}
    const fromParts = from.id.split('/');
    fromParts.pop();
    let best: (typeof list)[number] | null = null;
    let count = 0;
    for (const c of list) {
      if (suffix !== '' && !c.path.endsWith(suffix)) {continue;}
      count++;
      if (best === null || nearer(folder, fromParts, c, best)) {best = c;}
    }
    const out = { page: best ? best.page : null, count };
    nearest.set(key, out);
    return out;
  }

  function resolveWikilink(from: AiDocsPage, link: AiDocsLink): AiDocsResolvedLink {
    const base: AiDocsResolvedLink = { text: link.text, target: link.target, kind: link.kind, status: 'broken' };
    let name = link.target.trim();
    const bar = name.indexOf('|');
    if (bar >= 0) {name = name.slice(0, bar);}
    const hash = name.indexOf('#');
    const fragment = hash < 0 ? '' : name.slice(hash + 1).trim();
    if (hash >= 0) {name = name.slice(0, hash);}
    name = name.trim();
    if (name === '') {return landing(base, from, fragment);}
    const wanted = foldAscii(name.replace(/\\/g, '/').replace(/\.(?:md|markdown)$/i, ''));
    const { page, count } = nearestPage(from, wanted);
    if (page === null) {return { ...base, reason: 'not-found' };}
    const out = landing(base, page, fragment);
    out.candidates = count;
    return out;
  }

  const resolver: DocsLinkResolver = {
    resolve(fromPageId, link) {
      const from = byId.get(fromPageId);
      if (!from) {return { text: link.text, target: link.target, kind: link.kind, status: 'broken', reason: 'not-found' };}
      return link.kind === 'wikilink' ? resolveWikilink(from, link) : resolveMarkdown(from, link);
    },
    countBrokenOn(pageId) {
      const p = byId.get(pageId);
      if (!p) {return 0;}
      let n = 0;
      for (const l of p.links) {
        if (exceeded) {break;}
        if (resolver.resolve(p.id, l).status === 'broken') {n++;}
      }
      return n;
    },
    countBroken() {
      let n = 0;
      for (const p of index.pages) {
        if (exceeded) {break;}
        n += resolver.countBrokenOn(p.id);
      }
      return n;
    },
    workExceeded: () => exceeded,
  };
  return resolver;
}

export interface DocsLinkList {
  /** Followable links, in page order, one per landing (page or section). */
  links: AiDocsResolvedLink[];
  /** Followable links beyond the cap. */
  omitted: number;
  /** Links on the page that are broken (not listed). */
  broken: number;
}

/**
 * The hop-1 link list of a page (usually a home): its followable links,
 * deduplicated by landing, at most `cap` (200). Broken and external links are
 * left out; broken ones are counted.
 */
export function docsLinkList(index: Pick<AiDocsIndex, 'pages'>, pageId: string, cap: number = DOCS_MAX_LINKS, resolver?: DocsLinkResolver): DocsLinkList {
  const r = resolver ?? createDocsLinkResolver(index);
  const page = index.pages.find((p) => p.id === pageId);
  const out: DocsLinkList = { links: [], omitted: 0, broken: 0 };
  if (!page) {return out;}
  const seen = new Set<string>();
  for (const link of page.links) {
    const resolved = r.resolve(page.id, link);
    if (resolved.status === 'broken') {
      out.broken++;
      continue;
    }
    if (resolved.status !== 'ok') {continue;}
    const key = resolved.sectionId ?? (resolved.pageId as string);
    if (seen.has(key)) {continue;}
    seen.add(key);
    if (out.links.length >= cap) {out.omitted++;} else {out.links.push(resolved);}
  }
  return out;
}
