/**
 * Citations in an answer, and what Insert at cursor does with it. Pure.
 *
 * Parsing (`parseCitations`). The model cites sources as `[n]` or `[n, m]`
 * (the numbers the final call gave its sections). A marker is NOT a citation
 * when it sits in a fenced code block or code span, is followed by `(` or `:`
 * (a link or a definition), follows `!` or a non-citation `]` (an image or
 * `[text][1]` reference). Unknown numbers are dropped from the text (and from
 * a list); none valid means `NO_SOURCES_CITED`.
 *
 * Insert (`prepareInsertMarkdown`, A8/S8). Two steps, in this order:
 *   1. `sanitizeInsertMarkdown`: every link, image, reference-style link and
 *      bare or `<...>` autolink the MODEL wrote becomes plain text unless its
 *      URL appears verbatim in a cited section's text (and is `https:`,
 *      `http:` or, for links, `mailto:`). A link around an image is handled
 *      innermost first, so nesting cannot carry an image through. Raw HTML
 *      tags are escaped. Code spans and fenced blocks are left alone.
 *   2. `rewriteCitationsForInsert`: each citation becomes a CommonMark
 *      relative link to the cited file, such as
 *      `[Key rotation](security.md#key-rotation)` (spaces and brackets in
 *      the path percent-encoded), when the current document sits under the
 *      same root as the source; otherwise plain `file › heading` text. The
 *      fragment is the heading slug (`docsSlug`), which is GitHub's anchor
 *      for ASCII headings.
 * Those relative links are the only links Insert adds.
 */

import type { AiDocsSection } from '../types';
import type { AiDocsNumberedSection } from './budget';
import { docsIdRoot } from './index';

export const NO_SOURCES_CITED = 'No sources cited';
export const ANSWERED_WITHOUT_SOURCES = 'answered without sources';

// ── Code-aware masking ──────────────────────────────────────────────────────

/** Per character: true inside a fenced block, a code span, or an escape (`\x`). */
function codeMask(s: string): boolean[] {
  const mask: boolean[] = new Array<boolean>(s.length).fill(false);
  // Fenced blocks, by lines.
  let fence: { ch: string; len: number } | null = null;
  let pos = 0;
  while (pos < s.length) {
    const nl = s.indexOf('\n', pos);
    const end = nl < 0 ? s.length : nl + 1;
    const line = s.slice(pos, nl < 0 ? s.length : nl).replace(/\r$/, '');
    let inFence = fence !== null;
    if (!fence) {
      const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (m) {
        fence = { ch: m[1][0], len: m[1].length };
        inFence = true;
      }
    } else {
      const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len) {fence = null;}
    }
    if (inFence) {for (let i = pos; i < end; i++) {mask[i] = true;}}
    pos = end;
  }
  // Code spans and escapes, outside fences.
  const runs: Array<{ at: number; len: number }> = [];
  for (let i = 0; i < s.length; i++) {
    if (mask[i]) {continue;}
    if (s[i] === '\\' && i + 1 < s.length) {
      mask[i] = true;
      mask[i + 1] = true;
      i++;
    } else if (s[i] === '`') {
      let j = i;
      while (j < s.length && s[j] === '`' && !mask[j]) {j++;}
      runs.push({ at: i, len: j - i });
      i = j - 1;
    }
  }
  // Pair backtick runs of equal length, right to left so each lookup is O(1).
  const nextByLen = new Map<number, number>();
  const closer: number[] = new Array<number>(runs.length).fill(-1);
  for (let r = runs.length - 1; r >= 0; r--) {
    const nx = nextByLen.get(runs[r].len);
    if (nx !== undefined) {closer[r] = nx;}
    nextByLen.set(runs[r].len, r);
  }
  for (let r = 0; r < runs.length; r++) {
    if (closer[r] < 0) {continue;}
    const to = runs[closer[r]].at + runs[closer[r]].len;
    for (let i = runs[r].at; i < to; i++) {mask[i] = true;}
    // Skip runs swallowed by this span.
    while (r + 1 < runs.length && runs[r + 1].at < to) {r++;}
  }
  return mask;
}

// ── Parsing ─────────────────────────────────────────────────────────────────

export type DocsCitationPart = { type: 'text'; text: string } | { type: 'cite'; ns: number[] };

export interface ParsedCitations {
  /** Valid numbers in order of first appearance. */
  cited: number[];
  /** Numbers the model wrote that match no source, in order, once each. */
  dropped: number[];
  /** The answer with unknown numbers removed. */
  text: string;
  /** The same answer cut into plain text and citation parts, for rendering `[1]` chips. */
  parts: DocsCitationPart[];
  /** True when no valid citation is left. Show `NO_SOURCES_CITED`. */
  noSources: boolean;
}

const CITE = /\[(\d{1,4}(?:[ \t]*,[ \t]*\d{1,4})*)\]/g;

/** Find `[n]` markers and keep the valid ones. `validNs` are the numbers of the sections sent. */
export function parseCitations(answer: string, validNs: Iterable<number>): ParsedCitations {
  const valid = new Set(validNs);
  const mask = codeMask(answer);
  const parts: DocsCitationPart[] = [];
  const cited: number[] = [];
  const dropped: number[] = [];
  let last = 0;
  let prevCiteEnd = -1;
  let text = '';
  const pushText = (t: string): void => {
    if (t === '') {return;}
    text += t;
    const tail = parts[parts.length - 1];
    if (tail && tail.type === 'text') {tail.text += t;} else {parts.push({ type: 'text', text: t });}
  };
  CITE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITE.exec(answer)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const next = answer[end];
    const prev = start > 0 ? answer[start - 1] : '';
    const notCitation =
      mask[start] ||
      next === '(' ||
      next === ':' ||
      prev === '!' ||
      (prev === ']' && prevCiteEnd !== start);
    if (notCitation) {continue;}
    const ns = m[1].split(',').map((x) => parseInt(x.trim(), 10));
    const ok = ns.filter((n, i) => valid.has(n) && ns.indexOf(n) === i);
    for (const n of ns) {
      if (valid.has(n)) {
        if (!cited.includes(n)) {cited.push(n);}
      } else if (!dropped.includes(n)) {
        dropped.push(n);
      }
    }
    let before = answer.slice(last, start);
    if (ok.length === 0) {
      // Remove the marker, and one space before it when punctuation or the end follows.
      if (before.endsWith(' ') && (end >= answer.length || /[\s.,;:!?)]/.test(answer[end]))) {before = before.slice(0, -1);}
      pushText(before);
    } else {
      pushText(before);
      text += `[${ok.join(', ')}]`;
      parts.push({ type: 'cite', ns: ok });
    }
    last = end;
    prevCiteEnd = end;
  }
  pushText(answer.slice(last));
  return { cited, dropped, text, parts, noSources: cited.length === 0 };
}

// ── Labels and relative links ───────────────────────────────────────────────

/** The slug part of a section id (`undefined` for a whole page). */
function sectionSlug(section: AiDocsSection): string | undefined {
  const prefix = `${section.pageId}#`;
  return section.id.startsWith(prefix) ? section.id.slice(prefix.length) : undefined;
}

/** The chip text: `file › heading`, or the file alone for a whole page. */
export function docsCitationLabel(section: Pick<AiDocsSection, 'relPath' | 'heading'>): string {
  return section.heading ? `${section.relPath} › ${section.heading}` : section.relPath;
}

/** Percent-encode what would end a CommonMark link destination: space, `%`, brackets, parentheses, angle brackets, backslash, control characters. */
export function encodeLinkPath(path: string): string {
  let out = '';
  for (const ch of path) {
    const cp = ch.codePointAt(0) as number;
    if (cp <= 0x20 || cp === 0x7f || '%()[]<>\\'.includes(ch)) {
      out += encodeURIComponent(ch).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    } else {
      out += ch;
    }
  }
  return out;
}

function escapeLinkText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/([\\[\]])/g, '\\$1');
}

/** Where the document being edited sits: the label of the root that contains it and its folder relative to that root (`''` for the root itself). */
export interface DocsDocumentLocation {
  root: string;
  folder: string;
}

/** Relative path from a folder (relative to a root) to a file (relative to the same root). */
export function relativeDocsPath(fromFolder: string, toRelPath: string): string {
  const from = fromFolder.split('/').filter((s) => s !== '' && s !== '.');
  const to = toRelPath.split('/').filter((s) => s !== '');
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) {common++;}
  const rel = [...from.slice(common).map(() => '..'), ...to.slice(common)].join('/');
  return rel.includes(':') && !rel.startsWith('.') ? `./${rel}` : rel;
}

/**
 * The CommonMark relative link for one cited section, or null when the
 * document is not under the section's root (then the caller writes plain text).
 */
export function citationLink(section: AiDocsSection, location: DocsDocumentLocation | null | undefined): string | null {
  if (!location || location.root !== docsIdRoot(section.pageId)) {return null;}
  const slug = sectionSlug(section);
  const path = encodeLinkPath(relativeDocsPath(location.folder, section.relPath));
  const text = escapeLinkText(section.heading ?? section.title);
  return `[${text}](${path}${slug ? `#${slug}` : ''})`;
}

/**
 * Replace each valid `[n]` with its link (or `file › heading` text). Unknown
 * numbers are removed. Run `sanitizeInsertMarkdown` first.
 */
export function rewriteCitationsForInsert(answer: string, sources: readonly AiDocsNumberedSection[], location?: DocsDocumentLocation | null): string {
  const byN = new Map(sources.map((s) => [s.n, s.section]));
  const parsed = parseCitations(answer, byN.keys());
  return parsed.parts
    .map((part) => {
      if (part.type === 'text') {return part.text;}
      return part.ns
        .map((n) => {
          const section = byN.get(n) as AiDocsSection;
          return citationLink(section, location) ?? docsCitationLabel(section);
        })
        .join(', ');
    })
    .join('');
}

// ── Sanitizer (S8) ──────────────────────────────────────────────────────────

const URL_CONTINUES = /[A-Za-z0-9_~/%#?&=+@:-]/;

function urlInSources(url: string, sources: readonly string[]): boolean {
  if (url === '') {return false;}
  for (const text of sources) {
    let at = text.indexOf(url);
    while (at >= 0) {
      const before = at > 0 ? text[at - 1] : '';
      const after = text[at + url.length] ?? '';
      if (!(before !== '' && /[A-Za-z0-9_/-]/.test(before)) && !(after !== '' && URL_CONTINUES.test(after))) {return true;}
      at = text.indexOf(url, at + 1);
    }
  }
  return false;
}

function allowedUrl(url: string, image: boolean, sources: readonly string[]): boolean {
  const u = url.trim();
  if (image ? !/^https:\/\//i.test(u) : !/^(?:https?:\/\/|mailto:)/i.test(u)) {return false;}
  return urlInSources(u, sources);
}

/** Make a URL non-clickable and non-autolinking but still readable. */
function defang(url: string): string {
  return url.replace(/^([A-Za-z][A-Za-z0-9+.-]*):/, '$1\\:').replace(/^www\./i, (m) => `${m.slice(0, 3)}\\.`);
}

function normLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface SanitizedMarkdown {
  markdown: string;
  /** Links, autolinks and definitions turned into text. */
  linksRemoved: number;
  imagesRemoved: number;
}

/** See the header. `citedTexts` are the texts of the sections the answer cited. */
export function sanitizeInsertMarkdown(markdown: string, citedTexts: readonly string[]): SanitizedMarkdown {
  const s = markdown;
  const mask = codeMask(s);
  const result: SanitizedMarkdown = { markdown: '', linksRemoved: 0, imagesRemoved: 0 };

  // Matching brackets in one pass (code, fences and escapes skipped).
  const closeOf = new Map<number, number>();
  const stack: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (mask[i]) {continue;}
    if (s[i] === '[') {stack.push(i);}
    else if (s[i] === ']' && stack.length > 0) {closeOf.set(stack.pop() as number, i);}
  }

  // Reference definitions: keep the ones whose URL is allowed, drop the rest.
  const defs = new Map<string, boolean>();
  const dropRanges: Array<[number, number]> = [];
  {
    let pos = 0;
    while (pos < s.length) {
      const nl = s.indexOf('\n', pos);
      const end = nl < 0 ? s.length : nl + 1;
      if (!mask[pos]) {
        const line = s.slice(pos, nl < 0 ? s.length : nl);
        const m = /^ {0,3}\[((?:[^\]\\]|\\.)+)\]:[ \t]*(<[^>\n]*>|\S+)/.exec(line);
        if (m) {
          const url = m[2].startsWith('<') ? m[2].slice(1, -1) : m[2];
          const ok = allowedUrl(url, false, citedTexts) || allowedUrl(url, true, citedTexts);
          defs.set(normLabel(m[1]), ok);
          if (!ok) {
            dropRanges.push([pos, end]);
            result.linksRemoved++;
          }
        }
      }
      pos = end;
    }
  }
  const dropped = (i: number): boolean => dropRanges.some(([a, b]) => i >= a && i < b);

  /** Parse `(destination "title")` starting at `(`; returns the destination and the index after `)`. */
  function parseInline(open: number, limit: number): { url: string; raw: string; end: number } | null {
    let i = open + 1;
    while (i < limit && /[ \t\n]/.test(s[i])) {i++;}
    let url = '';
    let raw = '';
    if (s[i] === '<') {
      const gt = s.indexOf('>', i);
      if (gt < 0 || gt >= limit || s.slice(i, gt).includes('\n')) {return null;}
      url = s.slice(i + 1, gt);
      raw = s.slice(i, gt + 1);
      i = gt + 1;
    } else {
      let depth = 0;
      const from = i;
      while (i < limit) {
        const c = s[i];
        if (c === '\\' && i + 1 < limit) {i += 2; continue;}
        if (/\s/.test(c)) {break;}
        if (c === '(') {depth++;}
        else if (c === ')') {
          if (depth === 0) {break;}
          depth--;
        }
        i++;
      }
      url = s.slice(from, i);
      raw = url;
    }
    while (i < limit && /[ \t\n]/.test(s[i])) {i++;}
    if (i < limit && (s[i] === '"' || s[i] === "'" || s[i] === '(')) {
      const closeCh = s[i] === '(' ? ')' : s[i];
      let j = i + 1;
      while (j < limit && s[j] !== closeCh) {j += s[j] === '\\' ? 2 : 1;}
      if (j >= limit) {return null;}
      i = j + 1;
      while (i < limit && /[ \t\n]/.test(s[i])) {i++;}
    }
    if (i >= limit || s[i] !== ')') {return null;}
    return { url, raw, end: i + 1 };
  }

  function walk(from: number, to: number): string {
    let out = '';
    let i = from;
    while (i < to) {
      if (dropped(i)) {
        i++;
        continue;
      }
      if (mask[i]) {
        out += s[i++];
        continue;
      }
      const c = s[i];
      const image = c === '!' && s[i + 1] === '[' && !mask[i + 1] && closeOf.has(i + 1);
      if (image || (c === '[' && closeOf.has(i))) {
        const open = image ? i + 1 : i;
        const close = closeOf.get(open) as number;
        if (close < to) {
          const next = s[close + 1];
          let kind: 'inline' | 'ref' | 'shortcut' | null = null;
          let url = '';
          let end = close + 1;
          let refLabel = '';
          if (next === '(' && !mask[close + 1]) {
            const p = parseInline(close + 1, to);
            if (p) {
              kind = 'inline';
              url = p.url;
              end = p.end;
            }
          } else if (next === '[' && !mask[close + 1] && closeOf.has(close + 1) && (closeOf.get(close + 1) as number) < to) {
            const rc = closeOf.get(close + 1) as number;
            const label = s.slice(close + 2, rc);
            refLabel = normLabel(label === '' ? s.slice(open + 1, close) : label);
            if (defs.has(refLabel)) {
              kind = 'ref';
              end = rc + 1;
            }
          } else if (defs.has(normLabel(s.slice(open + 1, close)))) {
            kind = 'shortcut';
            refLabel = normLabel(s.slice(open + 1, close));
          }
          if (kind) {
            const inner = walk(open + 1, close);
            if (kind === 'inline') {
              const ok = allowedUrl(url, image, citedTexts);
              if (image) {
                if (ok) {out += `![${inner}](${url})`;}
                else {
                  out += inner;
                  result.imagesRemoved++;
                }
              } else if (ok) {
                out += `[${inner}](${url})`;
              } else {
                // A citation written as a link keeps its number.
                out += /^\d+(?:\s*,\s*\d+)*$/.test(inner) ? `[${inner}]` : inner;
                result.linksRemoved++;
              }
            } else {
              const bang = image ? '!' : '';
              if (defs.get(refLabel)) {
                // Allowed definition: keep the reference, with its text sanitized.
                out += `${bang}[${inner}]${kind === 'ref' ? s.slice(close + 1, end) : ''}`;
              } else if (kind === 'ref') {
                out += inner;
                if (image) {result.imagesRemoved++;} else {result.linksRemoved++;}
              } else {
                // Shortcut to a removed definition: literal text.
                out += `${bang}[${inner}]`;
              }
            }
            i = kind === 'shortcut' ? close + 1 : end;
            continue;
          }
        }
      }
      if (c === '<') {
        const auto = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/.exec(s.slice(i, i + 2100));
        if (auto) {
          const url = auto[1];
          if (allowedUrl(url, false, citedTexts)) {out += auto[0];}
          else {
            out += defang(url);
            result.linksRemoved++;
          }
          i += auto[0].length;
          continue;
        }
        if (/[A-Za-z/!?]/.test(s[i + 1] ?? '')) {
          out += '\\<';
          i++;
          continue;
        }
      }
      const atWord = i === 0 || !/[A-Za-z0-9_]/.test(s[i - 1]);
      if (atWord && (c === 'h' || c === 'H' || c === 'w' || c === 'W')) {
        const m = /^(?:https?:\/\/|www\.)[^\s<]+/i.exec(s.slice(i, i + 2100));
        if (m) {
          const trimmed = m[0].replace(/[.,:;!?'")*_~\]]+$/, '');
          if (/^https?:\/\//i.test(trimmed) && allowedUrl(trimmed, false, citedTexts)) {out += trimmed;}
          else {
            out += defang(trimmed);
            result.linksRemoved++;
          }
          i += trimmed.length;
          continue;
        }
      }
      out += c;
      i++;
    }
    return out;
  }

  result.markdown = walk(0, s.length);
  return result;
}

/**
 * The text Insert at cursor puts in the document: sanitize what the model
 * wrote, then turn citations into relative links (or `file › heading`).
 */
export function prepareInsertMarkdown(answer: string, sources: readonly AiDocsNumberedSection[], location?: DocsDocumentLocation | null): SanitizedMarkdown {
  const parsed = parseCitations(answer, sources.map((x) => x.n));
  const citedTexts = parsed.cited.map((n) => sources.find((x) => x.n === n)?.section.text ?? '');
  const clean = sanitizeInsertMarkdown(answer, citedTexts);
  return { ...clean, markdown: rewriteCitationsForInsert(clean.markdown, sources, location) };
}
