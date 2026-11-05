// @vitest-environment node
/**
 * Hostile pages (S9): one markdown file of 1 MiB, or a base of many small ones,
 * must not make the index, the section splitter, the link resolver or the
 * "This document" scope superlinear. Each case grows the input and checks the
 * time grows with it (growth, not a wall clock: see helpers/growth.ts). The
 * regexes these replaced took 10 s on 80 KB and about 28 minutes on 1 MiB.
 */
import { describe, expect, it } from 'vitest';
import {
  DOCS_MAX_HEADINGS_PER_PAGE,
  DOCS_MAX_LINK_WORK,
  budgetDocument,
  buildDocsIndex,
  createDocsLinkResolver,
  docsSlugs,
  headingsOutline,
  runDocsTurn,
  splitDocsSections,
  type AiDocsPage,
} from '../src/ai';
import { aiDocsLoopDeps } from '../src/ai-docs-run';
import { aiSettings, ctxOf, fakeAi, nav } from './helpers/ai-docs-fakes';
import { MIB, expectNearLinear, rep } from './helpers/growth';

describe('headings and sections stay near-linear on a 1 MiB file', () => {
  const inputs: Array<[string, (u: number) => string]> = [
    ['heading with a million blanks inside', (u) => `# a${' '.repeat(Math.round(MIB * u))}b`],
    ['heading with tabs and blanks inside', (u) => `# a${' \t'.repeat(Math.round((MIB * u) / 2))}b`],
    ['heading of blanks only', (u) => `#${' '.repeat(Math.round(MIB * u))}`],
    ['heading with a million closing hashes', (u) => `# a ${'#'.repeat(Math.round(MIB * u))}`],
    ['hashes and blanks alternating', (u) => `# a${' #'.repeat(Math.round((MIB * u) / 2))} b`],
    ['262,144 headings', (u) => rep('# a\n', MIB, u)],
    ['262,144 headings with the same slug family', (u) => rep('# a-1\n# a\n', MIB, u)],
    ['headings and blank lines', (u) => rep('## x\n\n', MIB, u)],
    ['seven hashes', (u) => rep('####### a\n', MIB, u)],
  ];
  for (const [name, make] of inputs) {
    it(name, async () => {
      await expectNearLinear(`${name}: splitDocsSections`, make, (md) => splitDocsSections(md));
      await expectNearLinear(`${name}: headingsOutline`, make, (md) => headingsOutline(md));
      await expectNearLinear(`${name}: budgetDocument`, make, (md) => budgetDocument(md, { contextTokens: 4000, outputTokens: 500, reserveTokens: 500 }));
    }, 300_000);
  }

  it('docsSlugs on 262,144 equal headings gives each its own slug in linear time', async () => {
    await expectNearLinear('docsSlugs', (u) => Array.from({ length: Math.round(262_144 * u) }, () => 'Setup'), (texts) => docsSlugs(texts));
    expect(docsSlugs(['Setup', 'Setup', 'Setup', 'Setup 1'])).toEqual(['setup', 'setup-1', 'setup-2', 'setup-1-1']);
  }, 120_000);

  it('the section splitter keeps the first 1000 headings and the rest is text of the last', () => {
    const sections = splitDocsSections(rep('# a\n', MIB, 1));
    expect(sections).toHaveLength(DOCS_MAX_HEADINGS_PER_PAGE);
    expect(sections[sections.length - 1].end).toBe(MIB);
  });

  it('a heading past the clip is cut before its slug', () => {
    const [s] = splitDocsSections(`# ${'é'.repeat(5000)}\n`);
    expect(Array.from(s.heading?.text ?? '')).toHaveLength(200);
    expect(Array.from(s.heading?.slug ?? '')).toHaveLength(200);
  });

  it('the index keeps 1000 headings of 200 characters from a page that has 100,000', () => {
    const page = { root: 'r', relPath: 'a.md', headings: headingsOutline(rep('# ' + 'z'.repeat(400) + '\n', MIB, 1)), chars: MIB };
    const index = buildDocsIndex({ baseId: 'b', roots: [{ label: 'r' }], pages: [page] });
    expect(index.pages[0].headings).toHaveLength(DOCS_MAX_HEADINGS_PER_PAGE);
    expect(index.pages[0].headings.every((h) => Array.from(h.text).length <= 200)).toBe(true);
  });
});

describe('This document scope with a hostile page', () => {
  const doc = (text: string) => ({ kind: 'document' as const, text });
  const inputs: Array<[string, (u: number) => string]> = [
    ['blanks inside a heading', (u) => `# a${' '.repeat(Math.round(MIB * u))}b\n`],
    ['262,144 headings', (u) => rep('# a\n', MIB, u)],
  ];
  for (const [name, make] of inputs) {
    it(name, async () => {
      await expectNearLinear(
        `This document: ${name}`,
        make,
        async (text) => {
          const { ai } = fakeAi([nav([], true)]);
          const out = await runDocsTurn(aiDocsLoopDeps(ctxOf(ai, aiSettings())), { question: 'a', scope: doc(text) }, {}, new AbortController().signal);
          expect(out.kind).toBe('answered');
        },
      );
    }, 300_000);
  }
});

describe('the link resolver stays bounded on a hostile base', () => {
  function page(root: string, relPath: string, links: AiDocsPage['links'], headings: AiDocsPage['headings'] = []): AiDocsPage {
    return { id: `${root}/${relPath}`, root, relPath, title: relPath, headings, links, chars: 10 };
  }

  it('many wikilinks to one stem from many pages: memoized per folder, and the work is capped', async () => {
    await expectNearLinear(
      'wikilinks to one stem',
      (u) => {
        const links = Array.from({ length: 200 }, (_, i) => ({ target: i % 2 ? 'README#x' : 'README', text: 'r', kind: 'wikilink' as const }));
        const pages = Array.from({ length: Math.round(2000 * u) }, (_, i) => page('r', `d${i % 40}/n${i}.md`, links));
        pages.push(...Array.from({ length: Math.round(500 * u) }, (_, i) => page('r', `e${i}/README.md`, [])));
        return pages;
      },
      (pages) => createDocsLinkResolver({ pages }).countBroken(),
    );
  }, 300_000);

  it('a count that would exceed the work bound stops and says so', () => {
    const readmes = Array.from({ length: 4000 }, (_, i) => page('r', `d${i}/README.md`, [{ target: 'README', text: 'r', kind: 'wikilink' }]));
    const resolver = createDocsLinkResolver({ pages: readmes });
    // 4000 folders x 4000 candidates is 16M, past the bound of 5M: the count is a lower bound.
    expect(resolver.countBroken()).toBe(0);
    expect(resolver.workExceeded()).toBe(true);
    expect(DOCS_MAX_LINK_WORK).toBe(5_000_000);
  });

  it('wikilinks resolve to the same page as before, nearest first, with the candidate count', () => {
    const pages = [page('r', 'a/x.md', [{ target: 'Note', text: 'n', kind: 'wikilink' }]), page('r', 'a/Note.md', []), page('r', 'b/Note.md', []), page('r', 'a/deep/note.md', [])];
    const r = createDocsLinkResolver({ pages });
    const got = r.resolve('r/a/x.md', pages[0].links[0]);
    expect(got).toMatchObject({ status: 'ok', pageId: 'r/a/Note.md', candidates: 3 });
    expect(r.resolve('r/b/Note.md', pages[0].links[0])).toMatchObject({ pageId: 'r/b/Note.md' });
  });

  it('fragments match the first heading with that slug or anchor', () => {
    const headings = [
      { id: 'r/t.md#a', level: 1, text: 'A', slug: 'a' },
      { id: 'r/t.md#a-1', level: 1, text: 'A', slug: 'a-1' },
      { id: 'r/t.md#b', level: 1, text: 'B c', slug: 'b-c' },
    ];
    const pages = [page('r', 't.md', [], headings), page('r', 's.md', [])];
    const r = createDocsLinkResolver({ pages });
    expect(r.resolve('r/s.md', { target: 't.md#a', text: '', kind: 'markdown' })).toMatchObject({ sectionId: 'r/t.md#a' });
    expect(r.resolve('r/s.md', { target: 't.md#A-1', text: '', kind: 'markdown' })).toMatchObject({ sectionId: 'r/t.md#a-1' });
    expect(r.resolve('r/s.md', { target: 't.md#b-c', text: '', kind: 'markdown' })).toMatchObject({ sectionId: 'r/t.md#b' });
    expect(r.resolve('r/s.md', { target: 't.md#zzz', text: '', kind: 'markdown' })).toMatchObject({ fragmentMissing: true });
  });
});
