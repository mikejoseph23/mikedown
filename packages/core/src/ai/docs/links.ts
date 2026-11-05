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
import { DOCS_MAX_LINKS } from './caps';
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
  /** Links that are `broken`, over every page of the index. */
  countBroken(): number;
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

export function createDocsLinkResolver(index: Pick<AiDocsIndex, 'pages'>): DocsLinkResolver {
  const byId = new Map<string, AiDocsPage>();
  const byStem = new Map<string, AiDocsPage[]>();
  const anchors = new Map<string, string[]>();
  for (const p of index.pages) {
    byId.set(p.id, p);
    const stem = foldAscii(docsFileStem(p.relPath));
    const list = byStem.get(stem);
    if (list) {list.push(p);} else {byStem.set(stem, [p]);}
  }

  function matchFragment(page: AiDocsPage, rawFragment: string): string | null {
    if (rawFragment === '') {return null;}
    const fragment = safeDecode(rawFragment);
    const folded = foldAscii(fragment);
    for (const h of page.headings) {
      if (h.slug === fragment || h.slug === folded) {return h.id;}
    }
    let gh = anchors.get(page.id);
    if (!gh) {
      gh = githubAnchors(page.headings.map((h) => h.text));
      anchors.set(page.id, gh);
    }
    const at = gh.findIndex((a) => a === fragment || a === folded);
    return at >= 0 ? page.headings[at].id : null;
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
    const stem = wanted.slice(wanted.lastIndexOf('/') + 1);
    const suffix = wanted.includes('/') ? `/${wanted.replace(/^\/+/, '')}` : '';
    const matches = (byStem.get(stem) ?? []).filter((p) => {
      if (suffix === '') {return true;}
      const path = `/${foldAscii(p.relPath)}`;
      const noExt = path.replace(/\.(?:md|markdown)$/, '');
      return noExt.endsWith(suffix);
    });
    if (matches.length === 0) {return { ...base, reason: 'not-found' };}
    const ranked = rankDocsWikilinkCandidates(from.id, matches.map((p) => p.id));
    const page = byId.get(ranked[0]) as AiDocsPage;
    const out = landing(base, page, fragment);
    out.candidates = matches.length;
    return out;
  }

  const resolver: DocsLinkResolver = {
    resolve(fromPageId, link) {
      const from = byId.get(fromPageId);
      if (!from) {return { text: link.text, target: link.target, kind: link.kind, status: 'broken', reason: 'not-found' };}
      return link.kind === 'wikilink' ? resolveWikilink(from, link) : resolveMarkdown(from, link);
    },
    countBroken() {
      let n = 0;
      for (const p of index.pages) {
        for (const l of p.links) {
          if (resolver.resolve(p.id, l).status === 'broken') {n++;}
        }
      }
      return n;
    },
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
