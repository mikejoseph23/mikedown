// @vitest-environment node
// The answer call's source budget, the 24 KB section cap and the keyword fallback ranking.
import { describe, expect, it } from 'vitest';
import {
  DOCS_KEYWORD_MAX_TERMS,
  DOCS_KEYWORD_TOP,
  DOCS_MAX_SECTION_BYTES,
  budgetDocsSections,
  capSectionText,
  clampDocsHops,
  clampDocsSourceShare,
  docsBudgetChars,
  docsCoverageNote,
  keywordTerms,
  rankKeywordSections,
  scoreKeywordSection,
  scanDocsSections,
} from '@mikedown/core/ai';
import type { AiDocsSection, DocsKeywordSection } from '@mikedown/core/ai';

const sec = (id: string, len: number | string, truncated = false): AiDocsSection => ({
  id,
  pageId: 'd/a.md',
  title: 'A',
  relPath: 'a.md',
  text: typeof len === 'number' ? 'x'.repeat(len) : len,
  truncated,
});

describe('budget: the share', () => {
  it('is floor(tokens x share% x 3.5) characters', () => {
    expect(docsBudgetChars(1000, 30)).toBe(1050);
    expect(docsBudgetChars(8192, 60)).toBe(Math.floor((8192 * 60 * 3.5) / 100));
    expect(docsBudgetChars(1001, 33)).toBe(Math.floor((1001 * 33 * 3.5) / 100));
  });
  it('clamps the share to 30..80 and falls back to 60 for junk', () => {
    expect(clampDocsSourceShare(0)).toBe(30);
    expect(clampDocsSourceShare(29.4)).toBe(30);
    expect(clampDocsSourceShare(100)).toBe(80);
    expect(clampDocsSourceShare(undefined)).toBe(60);
    expect(clampDocsSourceShare('50')).toBe(60);
    expect(clampDocsSourceShare(NaN)).toBe(60);
    expect(clampDocsSourceShare(Infinity)).toBe(60);
    expect(clampDocsSourceShare(-5)).toBe(30);
    expect(docsBudgetChars(1000, 5)).toBe(1050);
    expect(docsBudgetChars(1000, 99)).toBe(2800);
    expect(docsBudgetChars(1000)).toBe(2100);
  });
  it('clamps the hops to 1..5, default 3', () => {
    expect([0, 1, 5, 6, 2.5, undefined, 'x', NaN, -3].map(clampDocsHops)).toEqual([1, 1, 5, 5, 3, 3, 3, 3, 1]);
  });
  it('a missing, negative or infinite context gives no budget and no crash', () => {
    for (const t of [0, -10, NaN, Infinity]) {
      expect(docsBudgetChars(t)).toBe(0);
      const r = budgetDocsSections([sec('a', 10)], { contextTokens: t });
      expect(r.sent).toEqual([]);
    }
  });
});

describe('budget: the cut', () => {
  it('keeps sections in the order given and cuts the one that does not fit', () => {
    const r = budgetDocsSections([sec('a', 500), sec('b', 900), sec('c', 400)], { contextTokens: 1000, sourceShare: 30 });
    expect(r.sent.map((s) => s.section.id)).toEqual(['a', 'c']);
    expect(r.cutIds).toEqual(['b']);
  });
  it('a big early section does not starve the small ones behind it', () => {
    const r = budgetDocsSections([sec('big', 2000), sec('s1', 100), sec('s2', 100)], { contextTokens: 1000, sourceShare: 30 });
    expect(r.sent.map((s) => s.section.id)).toEqual(['s1', 's2']);
    expect(r.cutIds).toEqual(['big']);
  });
  it('a section that fits exactly is kept; one char over is not', () => {
    expect(budgetDocsSections([sec('a', 1050)], { contextTokens: 1000, sourceShare: 30 }).sent).toHaveLength(1);
    const r = budgetDocsSections([sec('a', 1050), sec('b', 1)], { contextTokens: 1000, sourceShare: 30 });
    expect(r.cutIds).toEqual(['b']);
  });
  it('numbering starts at 1 and has no gap after the cut', () => {
    const r = budgetDocsSections([sec('a', 400), sec('b', 900), sec('c', 400), sec('d', 2000), sec('e', 100)], { contextTokens: 1000, sourceShare: 30 });
    expect(r.sent.map((s) => [s.n, s.section.id])).toEqual([[1, 'a'], [2, 'c'], [3, 'e']]);
  });
  it('dedupes by id, first stays, and counts the request after dedupe', () => {
    const r = budgetDocsSections([sec('a', 10), sec('a', 99999), sec('b', 10)], { contextTokens: 1000 });
    expect(r.sent.map((s) => s.section.text.length)).toEqual([10, 10]);
    expect(r.requested).toBe(2);
  });
  it('nothing fits: the first section is kept cut to the budget and flagged truncated', () => {
    const r = budgetDocsSections([sec('a', 5000), sec('b', 5000)], { contextTokens: 1000, sourceShare: 30 });
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0].n).toBe(1);
    expect(r.sent[0].section.text).toHaveLength(1050);
    expect(r.sent[0].section.truncated).toBe(true);
    expect(r.cutIds).toEqual(['b']);
    expect(r.cutShort).toBe(1);
  });
  it('cutting never leaves half a surrogate pair', () => {
    const emoji = '😀';
    const r = budgetDocsSections([sec('a', emoji.repeat(2000))], { contextTokens: 1000, sourceShare: 30 });
    const text = r.sent[0].section.text;
    expect(text.length % 2).toBe(0);
    expect(/[\ud800-\udbff]$/.test(text)).toBe(false);
  });
  it('does not mutate its input', () => {
    const input = [sec('a', 5000)];
    budgetDocsSections(input, { contextTokens: 1000, sourceShare: 30 });
    expect(input[0].text).toHaveLength(5000);
    expect(input[0].truncated).toBe(false);
  });
  it('no sections, no budget and no sources', () => {
    expect(budgetDocsSections([], { contextTokens: 1000 })).toMatchObject({ sent: [], cutIds: [], requested: 0, note: null });
    expect(budgetDocsSections([sec('a', 10)], { contextTokens: 0 })).toMatchObject({ sent: [], cutIds: ['a'] });
  });
  it('an empty section still counts and is numbered', () => {
    expect(budgetDocsSections([sec('a', 0)], { contextTokens: 1000 }).sent.map((s) => s.n)).toEqual([1]);
  });
});

describe('budget: the coverage note wording', () => {
  it('all sent: "answered from N sections"', () => {
    expect(docsCoverageNote(1, 1, 0, 0)).toBe('answered from 1 section');
    expect(docsCoverageNote(4, 4, 0, 0)).toBe('answered from 4 sections');
  });
  it('some left out: "answered from N of M sections, K left out"', () => {
    expect(docsCoverageNote(7, 4, 0, 0)).toBe('answered from 4 of 7 sections, 3 left out');
    expect(docsCoverageNote(2, 1, 0, 0)).toBe('answered from 1 of 2 sections, 1 left out');
  });
  it('cut short and secrets parts are appended with semicolons', () => {
    expect(docsCoverageNote(3, 3, 1, 0)).toBe('answered from 3 sections; 1 section cut short');
    expect(docsCoverageNote(3, 3, 2, 0)).toBe('answered from 3 sections; 2 sections cut short');
    expect(docsCoverageNote(5, 2, 1, 2)).toBe('answered from 2 of 5 sections, 3 left out; 1 section cut short; 2 sections left out: look like they contain a key');
  });
  it('nothing asked and nothing sent: null, or only the secrets part after "without sources"', () => {
    expect(docsCoverageNote(0, 0, 0, 0)).toBeNull();
    expect(docsCoverageNote(0, 0, 0, 1)).toBe('answered without sources; 1 section left out: looks like it contains a key');
  });
  it('the secrets scan result feeds the note end to end, naming ids only', () => {
    const scan = scanDocsSections([sec('a', 'fine text'), sec('b', 'AKIAIOSFODNN7EXAMPLE'), sec('c', 'also fine')]);
    const r = budgetDocsSections(scan.kept, { contextTokens: 1000, secretsLeftOut: scan.leftOut.length });
    expect(r.note).toBe('answered from 2 sections; 1 section left out: looks like it contains a key');
    expect(JSON.stringify(r)).not.toContain('AKIA');
  });
  it('a negative or missing secrets count adds nothing', () => {
    expect(budgetDocsSections([sec('a', 5)], { contextTokens: 1000, secretsLeftOut: -3 }).note).toBe('answered from 1 section');
  });
});

describe('the 24 KB section cap', () => {
  it('is 24 KiB', () => {
    expect(DOCS_MAX_SECTION_BYTES).toBe(24 * 1024);
  });
  it('leaves text at or under the cap alone', () => {
    const text = 'a'.repeat(DOCS_MAX_SECTION_BYTES);
    expect(capSectionText(text)).toEqual({ text, truncated: false });
  });
  it('cuts one byte over to the cap and flags it', () => {
    const r = capSectionText('a'.repeat(DOCS_MAX_SECTION_BYTES + 1));
    expect(r.truncated).toBe(true);
    expect(r.text).toHaveLength(DOCS_MAX_SECTION_BYTES);
  });
  it('counts bytes, not characters, and never splits a code point', () => {
    const r = capSectionText('é'.repeat(DOCS_MAX_SECTION_BYTES)); // 2 bytes each
    expect(r.truncated).toBe(true);
    expect(new TextEncoder().encode(r.text).length).toBeLessThanOrEqual(DOCS_MAX_SECTION_BYTES);
    expect(r.text).toBe('é'.repeat(DOCS_MAX_SECTION_BYTES / 2));
    for (const [text, max] of [['😀😀😀', 7], ['a😀', 4], ['😀', 3], ['日本語', 4]] as const) {
      const cut = capSectionText(text, max).text;
      expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(max);
      expect(cut).not.toMatch(/�/);
      expect(text.startsWith(cut)).toBe(true);
    }
  });
  it('a zero cap gives empty text, flagged', () => {
    expect(capSectionText('abc', 0)).toEqual({ text: '', truncated: true });
  });
});

describe('keyword ranking', () => {
  const k = (id: string, o: Partial<DocsKeywordSection> = {}): DocsKeywordSection => ({ id, pageId: 'd/a.md', title: 'Page', relPath: 'a.md', heading: 'Heading', text: '', ...o });

  it('terms: folded, split on punctuation, stop words dropped, repeats removed', () => {
    expect(keywordTerms('How do I rotate the API-Key?')).toEqual(['rotate', 'api', 'key']);
    expect(keywordTerms('key KEY Key')).toEqual(['key']);
    expect(keywordTerms('the and of')).toEqual(['the', 'and', 'of']); // all stop words: keep them
    expect(keywordTerms('')).toEqual([]);
    expect(keywordTerms('  ?!  ')).toEqual([]);
    expect(keywordTerms('snake_case é日本')).toEqual(['snake_case', 'é日本']);
    expect(keywordTerms('Éa')).toEqual(['Éa']); // ASCII fold only
  });
  it('keeps at most 12 terms', () => {
    expect(keywordTerms(Array.from({ length: 30 }, (_, i) => `w${i}`).join(' '))).toHaveLength(DOCS_KEYWORD_MAX_TERMS);
  });

  it('a heading hit outranks a text hit', () => {
    const r = rankKeywordSections('rotation', [k('text', { heading: 'Other', text: 'rotation rotation rotation' }), k('head', { heading: 'Key rotation', text: '' })]);
    expect(r.map((x) => x.id)).toEqual(['head', 'text']);
  });
  it('heading beats title beats path beats one text hit', () => {
    const only = (o: Partial<DocsKeywordSection>) => scoreKeywordSection(['zed'], k('x', { heading: 'h', title: 't', relPath: 'p.md', text: '', ...o }));
    expect(only({ heading: 'zed' })).toBe(16); // 10 + 6
    expect(only({ title: 'zed' })).toBe(9); // 3 + 6
    expect(only({ relPath: 'zed.md' })).toBe(8); // 2 + 6
    expect(only({ text: 'zed' })).toBe(7); // 1 + 6
    expect(only({ text: 'zed zed zed zed zed zed zed' })).toBe(11); // capped at 5 + 6
    expect(only({})).toBe(0);
  });
  it('is case-insensitive for ASCII only and matches substrings', () => {
    expect(scoreKeywordSection(['rotat'], k('x', { heading: 'Rotation' }))).toBe(16);
    expect(scoreKeywordSection(['é'], k('x', { heading: 'É' }))).toBe(0);
    expect(scoreKeywordSection(['é'], k('x', { heading: 'é' }))).toBe(16);
  });
  it('more matching terms rank higher', () => {
    const r = rankKeywordSections('alpha beta', [k('one', { heading: 'alpha' }), k('two', { heading: 'alpha beta' })]);
    expect(r.map((x) => x.id)).toEqual(['two', 'one']);
  });
  it('is deterministic: ties break by id in code point order whatever the input order', () => {
    const ids = ['d/z.md#a', 'd/a.md#b', 'd/a.md#a', 'd/B.md#a', 'd/😀.md#a', 'd/￿.md#a'];
    const input = ids.map((id) => k(id, { heading: 'same' }));
    const want = [...ids].sort((a, b) => (a < b ? -1 : 1)); // UTF-16 order differs for 😀 vs ￿
    const a = rankKeywordSections('same', input).map((x) => x.id);
    const b = rankKeywordSections('same', [...input].reverse()).map((x) => x.id);
    expect(a).toEqual(b);
    expect(a.indexOf('d/￿.md#a')).toBeLessThan(a.indexOf('d/😀.md#a')); // code point order: U+FFFF < U+1F600
    expect(a.slice(0, 4)).toEqual(want.slice(0, 4));
  });
  it('returns the top 20 and honours a smaller limit; zero matches or no terms is empty', () => {
    const many = Array.from({ length: 50 }, (_, i) => k(`d/a.md#s${String(i).padStart(2, '0')}`, { heading: 'match' }));
    expect(rankKeywordSections('match', many)).toHaveLength(DOCS_KEYWORD_TOP);
    expect(rankKeywordSections('match', many, 3)).toHaveLength(3);
    expect(rankKeywordSections('match', many, 0)).toEqual([]);
    expect(rankKeywordSections('nothing here', many)).toEqual([]);
    expect(rankKeywordSections('', many)).toEqual([]);
  });
  it('refs carry ids and labels and the score, never the text; a preamble has no heading', () => {
    const [ref] = rankKeywordSections('secret', [k('d/a.md', { heading: undefined, text: 'the secret plan' })]);
    expect(ref).toEqual({ id: 'd/a.md', pageId: 'd/a.md', title: 'Page', relPath: 'a.md', score: 7 });
    expect(JSON.stringify(ref)).not.toContain('plan');
  });
  it('is fast on a large corpus and a long query', () => {
    const corpus = Array.from({ length: 5000 }, (_, i) => k(`d/p${i}.md#h`, { text: 'lorem ipsum dolor sit amet '.repeat(200) }));
    const t0 = Date.now();
    rankKeywordSections(Array.from({ length: 100 }, (_, i) => `dolor${i % 3} lorem`).join(' '), corpus);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
