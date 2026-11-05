/**
 * Keyword fallback ranking (decision 11): when a root's home is the map, or
 * navigation read nothing, hosts scan their files and rank sections with this,
 * so both hosts return the same order for the same input. Pure.
 *
 * THE RANKING CONTRACT (A10; `test/ai-fixtures/docs/keyword.json`). All
 * arithmetic is integer, all comparison is by code point; nothing depends on
 * locale.
 *
 * Case folding. ASCII `A-Z` become `a-z`; every other code point is left
 * unchanged (`foldAscii`). `É` does not match `é`.
 *
 * Terms. Fold the query, then split it into tokens: a token is a maximal run
 * of ASCII letters and digits, `_`, and any non-ASCII code point that is not
 * in the fixed whitespace list (`isDocsSpace`). Everything else separates
 * tokens (so `key-rotation` is `key`, `rotation`). Drop tokens in `STOP_WORDS`
 * unless that leaves none (then keep every token). Remove repeats (first
 * occurrence stays), keep the first `DOCS_KEYWORD_MAX_TERMS` (12). No terms,
 * no results.
 *
 * Fields of a section: its heading text (none for a preamble), its page title,
 * its page rel path, and its text. A term "occurs" in a field when the folded
 * field contains it as a substring (so `rotat` finds `rotation`); occurrences
 * are counted left to right without overlap.
 *
 * Score, per section, over all terms:
 *   10 x (terms occurring in the heading)
 *    + 3 x (terms occurring in the page title)
 *    + 2 x (terms occurring in the rel path)
 *    + sum over terms of min(occurrences in the text, 5)
 *    + 6 x (terms occurring in any of the four fields)
 * A score of 0 means no match and the section is left out.
 *
 * Order. Score descending; ties broken by section id ascending by code point
 * (ids are unique). The first `DOCS_KEYWORD_TOP` (20) are returned.
 */

import type { AiDocsSectionRef } from '../types';
import { DOCS_KEYWORD_MAX_TERMS, DOCS_KEYWORD_TOP } from './caps';
import { cmpCodePoints, foldAscii, isAsciiAlnum, isDocsSpace } from './util';

/** Words that carry no meaning in a question. Fixed list; the same on every host. */
export const DOCS_STOP_WORDS: readonly string[] = [
  'a', 'about', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from', 'how', 'i', 'in', 'is', 'it',
  'me', 'my', 'of', 'on', 'or', 'our', 'should', 'that', 'the', 'this', 'to', 'was', 'we', 'what', 'when', 'where', 'which', 'who',
  'why', 'with', 'you',
];
const STOP = new Set(DOCS_STOP_WORDS);

/** Fold and split a query into ranking terms (see the header). */
export function keywordTerms(query: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  for (const ch of foldAscii(query)) {
    const cp = ch.codePointAt(0) as number;
    const inToken = cp >= 0x80 ? !isDocsSpace(cp) : isAsciiAlnum(cp) || cp === 0x5f;
    if (inToken) {cur += ch;}
    else if (cur !== '') {
      tokens.push(cur);
      cur = '';
    }
  }
  if (cur !== '') {tokens.push(cur);}
  const meaningful = tokens.filter((t) => !STOP.has(t));
  const pool = meaningful.length > 0 ? meaningful : tokens;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of pool) {
    if (seen.has(t)) {continue;}
    seen.add(t);
    out.push(t);
    if (out.length >= DOCS_KEYWORD_MAX_TERMS) {break;}
  }
  return out;
}

/** Non-overlapping occurrences of `term` in `text`, left to right. */
export function countOccurrences(text: string, term: string): number {
  if (term === '') {return 0;}
  let n = 0;
  let at = text.indexOf(term);
  while (at >= 0) {
    n++;
    at = text.indexOf(term, at + term.length);
  }
  return n;
}

/** A section as the host scans it. */
export interface DocsKeywordSection {
  /** `<page id>#<slug>`, or the page id for a preamble. */
  id: string;
  pageId: string;
  /** The page's title. */
  title: string;
  relPath: string;
  /** The heading text; absent for a preamble. */
  heading?: string;
  text: string;
}

/** Score one section against folded terms (0 is no match). */
export function scoreKeywordSection(terms: readonly string[], section: DocsKeywordSection): number {
  if (terms.length === 0) {return 0;}
  const heading = foldAscii(section.heading ?? '');
  const title = foldAscii(section.title);
  const path = foldAscii(section.relPath);
  const text = foldAscii(section.text);
  let score = 0;
  for (const term of terms) {
    const inHeading = heading.includes(term);
    const inTitle = title.includes(term);
    const inPath = path.includes(term);
    const occurrences = countOccurrences(text, term);
    if (inHeading) {score += 10;}
    if (inTitle) {score += 3;}
    if (inPath) {score += 2;}
    score += Math.min(occurrences, 5);
    if (inHeading || inTitle || inPath || occurrences > 0) {score += 6;}
  }
  return score;
}

/** Rank sections for a query: scored, ordered, top `limit` (20). */
export function rankKeywordSections(query: string, sections: readonly DocsKeywordSection[], limit: number = DOCS_KEYWORD_TOP): AiDocsSectionRef[] {
  const terms = keywordTerms(query);
  if (terms.length === 0) {return [];}
  const scored: AiDocsSectionRef[] = [];
  for (const s of sections) {
    const score = scoreKeywordSection(terms, s);
    if (score <= 0) {continue;}
    const ref: AiDocsSectionRef = { id: s.id, pageId: s.pageId, title: s.title, relPath: s.relPath, score };
    if (s.heading !== undefined) {ref.heading = s.heading;}
    scored.push(ref);
  }
  scored.sort((a, b) => b.score - a.score || cmpCodePoints(a.id, b.id));
  return scored.slice(0, Math.max(0, limit));
}
