// @vitest-environment node
// The documentation-base contract shared with Desktop (Rust): root labels, ids,
// heading slugs, section splitting and keyword ranking. test/ai-fixtures/docs/.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  docsFileStem,
  docsPageId,
  docsRootLabels,
  docsSectionId,
  docsSlug,
  docsSlugs,
  isSafeRelPath,
  keywordTerms,
  parseDocsId,
  rankKeywordSections,
  splitDocsSections,
} from '@mikedown/core/ai';

const load = (name: string): any => JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'test', 'ai-fixtures', 'docs', name), 'utf8'));

describe('docs fixtures: labels', () => {
  for (const c of load('labels.json').cases) {
    it(JSON.stringify(c.roots), () => expect(docsRootLabels(c.roots)).toEqual(c.labels));
  }
});

describe('docs fixtures: slugs', () => {
  const f = load('slugs.json');
  for (const c of f.slug) {
    it(`slug of ${JSON.stringify(c.text)}`, () => expect(docsSlug(c.text)).toBe(c.slug));
  }
  for (const c of f.pages) {
    it(`unique slugs for ${JSON.stringify(c.headings)}`, () => expect(docsSlugs(c.headings)).toEqual(c.slugs));
  }
});

describe('docs fixtures: ids', () => {
  const f = load('ids.json');
  const known = new Set<string>(f.known);
  for (const c of f.pages) {it(`page id ${c.id}`, () => expect(docsPageId(c.root, c.relPath)).toBe(c.id));}
  for (const c of f.sections) {it(`section id ${c.id}`, () => expect(docsSectionId(c.pageId, c.slug)).toBe(c.id));}
  for (const c of f.parse) {
    it(`parse ${JSON.stringify(c.id)}`, () => expect(parseDocsId(c.id, (p) => known.has(p))).toEqual(c.expected));
  }
  for (const c of f.safeRelPaths) {it(`safe rel path ${JSON.stringify(c.relPath)}`, () => expect(isSafeRelPath(c.relPath)).toBe(c.safe));}
  for (const c of f.stems) {it(`stem of ${c.relPath}`, () => expect(docsFileStem(c.relPath)).toBe(c.stem));}
});

describe('docs fixtures: sections', () => {
  for (const c of load('sections.json').cases) {
    it(c.name, () => {
      const got = splitDocsSections(c.markdown).map((s) => ({ heading: s.heading, text: s.text }));
      expect(got).toEqual(c.sections);
    });
  }
});

describe('docs fixtures: per-page limits', () => {
  const f = load('limits.json');
  it('headings past the 1000th are text of the 1000th section', () => {
    const c = f.manyHeadings;
    const md = Array.from({ length: c.count }, (_, n) => c.line.replace('{n}', String(n))).join('');
    const sections = splitDocsSections(md);
    expect(sections).toHaveLength(c.sections);
    const last = sections[sections.length - 1];
    expect(last.heading?.slug).toBe(c.lastSlug);
    expect(last.heading?.text).toBe(c.lastHeading);
    expect(last.text.endsWith(c.lastTextTail)).toBe(true);
  });
  it('heading text is cut to 200 code points before the slug', () => {
    const c = f.longHeading;
    const s = splitDocsSections(`# ${c.char.repeat(c.length)}\nbody\n`);
    expect(s[0].heading?.text.length).toBe(c.textLength);
    expect(s[0].heading?.slug.length).toBe(c.slugLength);
    const w = f.longHeadingWide;
    const t = splitDocsSections(`# ${w.char.repeat(w.length)}\n`)[0].heading?.text ?? '';
    expect(Array.from(t)).toHaveLength(w.textCodePoints);
  });
});

describe('docs fixtures: keyword ranking', () => {
  const f = load('keyword.json');
  for (const c of f.terms) {it(`terms of ${JSON.stringify(c.query)}`, () => expect(keywordTerms(c.query)).toEqual(c.terms));}
  for (const c of f.rank) {
    it(c.name, () => {
      const got = rankKeywordSections(c.query, c.sections, c.limit).map((r) => ({ id: r.id, score: r.score }));
      expect(got).toEqual(c.expected);
    });
  }
});
