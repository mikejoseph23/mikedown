/**
 * Backlinks for core's document sidebar: the files in the open folder that
 * link to a document, by markdown link (`[text](other.md)`) or `[[wikilink]]`.
 * Same rules as the VS Code extension (`src/backlinkProvider.ts`): one entry
 * per link with its line, the line's text and the href as written, so the
 * opened file can scroll to it. Fenced code is skipped.
 *
 * The file list is the folder `.md` index's (`MdIndex.files`). Each file's
 * outgoing links are read once and cached; the watcher and the app's own
 * saves drop a file's entry (`invalidate`), and an entry older than the TTL
 * is read again so edits in folders nobody watches still show up. Wikilinks
 * resolve against the current file list on every query, so a new or renamed
 * note changes the answer without re-reading anything.
 */
import type { BacklinkItem } from '@mikedown/core';
import type { PathOps } from '@mikedown/core/shared/imagePaste';
import { matchTarget, rankCandidates, type MdIndex } from './mdIndex';
import { relativeLinkHref } from './dropRouting';

/** One outgoing link of a file, before resolution. */
export interface OutgoingLink {
  kind: 'markdown' | 'wikilink';
  /** 1-based. */
  line: number;
  lineText: string;
  /** Markdown: the decoded file part of the href. Wikilink: the target name. */
  target: string;
  /** The href as written (markdown, with any #anchor) or the whole `[[…]]`. */
  linkHref: string;
}

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const MD_LINK = /\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const WIKILINK = /\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g;

/** Outgoing links in a markdown text (the backlink index reads each file through this). */
export function extractOutgoingLinks(text: string): OutgoingLink[] {
  const out: OutgoingLink[] = [];
  let fence: string | null = null;
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) {fence = f[1][0];}
      else if (f[1][0] === fence) {fence = null;}
      return;
    }
    if (fence !== null) {return;}
    const lineText = line.trim().slice(0, 120);
    for (const m of line.matchAll(MD_LINK)) {
      const href = m[2].replace(/^<|>$/g, '').trim();
      if (!href || href.startsWith('#') || SCHEME.test(href)) {continue;}
      const hash = href.indexOf('#');
      let file = hash >= 0 ? href.slice(0, hash) : href;
      const q = file.indexOf('?');
      if (q >= 0) {file = file.slice(0, q);}
      try { file = decodeURIComponent(file); } catch { /* keep raw */ }
      if (!file) {continue;}
      out.push({ kind: 'markdown', line: i + 1, lineText, target: file, linkHref: href });
    }
    for (const w of line.matchAll(WIKILINK)) {
      const target = w[1].trim();
      if (!target) {continue;}
      out.push({ kind: 'wikilink', line: i + 1, lineText, target, linkHref: w[0] });
    }
  });
  return out;
}

export interface BacklinkIndexDeps {
  path: PathOps;
  index: Pick<MdIndex, 'root' | 'files'>;
  readText(path: string): Promise<{ text: string }>;
  now?: () => number;
  /** How long a file's cached links are trusted without a watcher event. */
  ttlMs?: number;
}

export interface BacklinkIndex {
  /** Files in the folder that link to `docPath`, in file then line order. */
  backlinksFor(docPath: string): Promise<BacklinkItem[]>;
  /** Forget one file's links (it changed), or every file's. */
  invalidate(path?: string): void;
}

const READ_CONCURRENCY = 8;

export function createBacklinkIndex(deps: BacklinkIndexDeps): BacklinkIndex {
  const { path, index } = deps;
  const now = deps.now ?? (() => Date.now());
  const ttl = deps.ttlMs ?? 60_000;
  const cache = new Map<string, { links: OutgoingLink[]; at: number }>();

  async function linksOf(file: string): Promise<OutgoingLink[]> {
    const hit = cache.get(file);
    if (hit && now() - hit.at < ttl) {return hit.links;}
    let links: OutgoingLink[] = [];
    try {
      links = extractOutgoingLinks((await deps.readText(file)).text);
    } catch { /* unreadable: no links */ }
    cache.set(file, { links, at: now() });
    return links;
  }

  const same = (a: string, b: string): boolean => path.relative(a, b) === '';

  return {
    async backlinksFor(docPath) {
      const files = await index.files();
      const sources = files.filter((f) => !same(f, docPath));
      const linkLists: OutgoingLink[][] = new Array(sources.length);
      let next = 0;
      const worker = async (): Promise<void> => {
        while (next < sources.length) {
          const i = next++;
          linkLists[i] = await linksOf(sources[i]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, sources.length) }, worker));

      const items: BacklinkItem[] = [];
      sources.forEach((source, i) => {
        const dir = path.dirname(source);
        // Occurrence per (source, href): the Nth backlink scrolls to the Nth matching link.
        const seen = new Map<string, number>();
        for (const link of linkLists[i]) {
          let target: string | null;
          if (link.kind === 'markdown') {
            target = path.isAbsolute(link.target) ? path.normalize(link.target) : path.resolve(dir, link.target);
          } else {
            const matches = matchTarget(link.target, files, index.root, path);
            target = matches.length ? rankCandidates(matches, dir, path)[0] : null;
          }
          if (!target || !same(target, docPath)) {continue;}
          const occurrence = seen.get(link.linkHref) ?? 0;
          seen.set(link.linkHref, occurrence + 1);
          items.push({
            uri: relativeLinkHref(docPath, source, path),
            displayPath: path.relative(index.root, source).replace(/\\/g, '/'),
            line: link.line,
            lineText: link.lineText,
            linkHref: link.linkHref,
            occurrence,
          });
        }
      });
      return items;
    },
    invalidate(p) {
      if (p === undefined) {cache.clear();}
      else {cache.delete(p);}
    },
  };
}
