// @vitest-environment node
/**
 * `budgetDocument` and `headingsOutline` (`ai/documentBudget.ts`): fit, cuts
 * on section boundaries, fences never split, the coverage maths, frontmatter
 * always kept, and the outline's shape.
 */
import { describe, expect, it } from 'vitest';
import { CHARS_PER_TOKEN, budgetDocument, headingsOutline } from '@mikedown/core/ai';

/** A window whose character budget is exactly `chars` (output and reserve zero). */
const windowOf = (chars: number) => ({ contextTokens: Math.ceil(chars / CHARS_PER_TOKEN), outputTokens: 0, reserveTokens: 0 });

const FM = '---\ntitle: Doc\ntags: [a]\n---\n';
const para = (n: number, word = 'word') => `${word} `.repeat(n).trim();

/** Frontmatter, a preamble paragraph and `count` sections of about 400 characters. */
function sectioned(count: number, withFence = false): string {
  const parts = [FM, 'Preamble paragraph.', ''];
  for (let i = 1; i <= count; i++) {
    parts.push(`## Section ${i}`, '', para(80, `s${i}`), '');
    if (withFence) {parts.push('```', '## inside a fence', 'code();', '```', '');}
  }
  return parts.join('\n');
}

describe('budgetDocument: fit', () => {
  it('a document inside the budget comes back untouched', () => {
    const doc = sectioned(3);
    expect(budgetDocument(doc, windowOf(doc.length))).toEqual({
      text: doc,
      coverage: 1,
      truncated: false,
      sectionsIncluded: 4,
      sectionsTotal: 4,
    });
  });

  it('an empty document fits whatever the budget', () => {
    expect(budgetDocument('', { contextTokens: 0, outputTokens: 0, reserveTokens: 0 })).toMatchObject({ text: '', coverage: 1, truncated: false });
  });

  it('the budget is context minus output minus reserve at 3.5 characters a token', () => {
    const doc = Array.from({ length: 70 }, () => 'x'.repeat(98)).join('\n\n');
    // 7000 characters. (4096 - 1000 - 96) * 3.5 = 10500 fits; (2096 - 1000 - 96) * 3.5 = 3500 does not.
    expect(budgetDocument(doc, { contextTokens: 4096, outputTokens: 1000, reserveTokens: 96 }).truncated).toBe(false);
    expect(budgetDocument(doc, { contextTokens: 2096, outputTokens: 1000, reserveTokens: 96 }).truncated).toBe(true);
  });
});

describe('budgetDocument: section boundaries', () => {
  const doc = sectioned(10);

  it('keeps whole leading sections and ends where the next heading starts', () => {
    const r = budgetDocument(doc, windowOf(Math.floor(doc.length * 0.5)));
    expect(r.truncated).toBe(true);
    expect(doc.startsWith(r.text)).toBe(true);
    const next = doc.slice(r.text.length).trimStart();
    expect(next.startsWith('## Section ')).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(Math.floor(doc.length * 0.5));
    expect(r.sectionsTotal).toBe(11);
    expect(r.sectionsIncluded).toBeGreaterThan(1);
    expect(r.sectionsIncluded).toBeLessThan(11);
    // Included sections are the preamble plus one per heading kept.
    expect(headingsOutline(r.text)).toHaveLength(r.sectionsIncluded - 1);
  });

  it('a heading that sits exactly on the budget is kept out of the text, not cut through', () => {
    const at = doc.indexOf('## Section 4');
    const r = budgetDocument(doc, windowOf(at));
    // The section starting at `at` is not included: the cut is the previous heading.
    expect(r.text.includes('## Section 4')).toBe(false);
    expect(r.text.includes('## Section 3')).toBe(true);
  });

  it('a document that opens with a heading counts that heading as section one', () => {
    const md = '# One\n\n' + para(100) + '\n\n# Two\n\n' + para(100) + '\n\n# Three\n\n' + para(100);
    const r = budgetDocument(md, windowOf(Math.floor(md.length * 0.7)));
    expect(r.sectionsTotal).toBe(3);
    expect(r.sectionsIncluded).toBe(2);
    expect(r.text.endsWith(para(100))).toBe(true);
    expect(r.text.includes('# Three')).toBe(false);
  });

  it('a heading-less document is one section, cut between paragraphs', () => {
    const md = Array.from({ length: 12 }, (_, i) => para(60, `p${i}`)).join('\n\n');
    const r = budgetDocument(md, windowOf(Math.floor(md.length / 2)));
    expect(r.truncated).toBe(true);
    expect(r.sectionsIncluded).toBe(1);
    expect(r.sectionsTotal).toBe(1);
    expect(r.text.endsWith(para(60, 'p5')) || r.text.endsWith(para(60, 'p4'))).toBe(true);
    expect(md.startsWith(r.text)).toBe(true);
  });

  it('CRLF documents split on the same boundaries', () => {
    const crlf = sectioned(6).replace(/\n/g, '\r\n');
    const r = budgetDocument(crlf, windowOf(Math.floor(crlf.length * 0.5)));
    expect(r.truncated).toBe(true);
    expect(crlf.slice(r.text.length).trimStart().startsWith('## Section ')).toBe(true);
  });
});

describe('budgetDocument: fences', () => {
  it('a heading inside a fence is not a section start', () => {
    const doc = sectioned(6, true);
    const r = budgetDocument(doc, windowOf(Math.floor(doc.length * 0.5)));
    expect((r.text.match(/^```/gm) ?? []).length % 2).toBe(0);
    expect(r.text.trimEnd().endsWith('```')).toBe(true);
    expect(r.sectionsTotal).toBe(7);
  });

  it('a fence that fills the first section is never split, with backticks, tildes or a longer fence', () => {
    for (const fence of ['```', '~~~', '````']) {
      const body = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');
      const md = `# Only\n\nFirst block.\n\n${fence}\n${body}\n${fence}\n\nLast block.`;
      const r = budgetDocument(md, windowOf(300));
      expect(r.text, fence).toBe('# Only\n\nFirst block.');
      expect(r.text.includes(fence), fence).toBe(false);
    }
  });

  it('a fence containing a shorter fence line stays whole', () => {
    const md = '# A\n\nIntro.\n\n````md\n```\ninner\n```\n````\n\nAfter.\n\n# B\n\n' + para(200);
    const r = budgetDocument(md, windowOf(md.indexOf('# B') + 10));
    expect(r.text).toBe(md.slice(0, md.indexOf('# B')).trimEnd());
    expect(r.text).toContain('````md\n```\ninner\n```\n````');
  });

  it('whole blocks of an over-budget first section are kept up to the budget', () => {
    const md = ['# Only', '', para(30, 'a'), '', para(30, 'b'), '', para(30, 'c'), '', para(30, 'd')].join('\n');
    const cutAt = md.indexOf(para(30, 'c'));
    const r = budgetDocument(md, windowOf(cutAt + 20));
    expect(r.text).toBe(`# Only\n\n${para(30, 'a')}\n\n${para(30, 'b')}`);
    expect(r.truncated).toBe(true);
    expect(r.sectionsIncluded).toBe(1);
  });

  it('the first block (here the heading line) is kept even when the budget is zero', () => {
    const md = '# Only\n\n' + para(300, 'a') + '\n\n' + para(300, 'b');
    const r = budgetDocument(md, { contextTokens: 100, outputTokens: 100, reserveTokens: 100 });
    expect(r.text).toBe('# Only');
    expect(r.truncated).toBe(true);
  });
});

describe('budgetDocument: a single block', () => {
  it('cannot be cut: one paragraph over the budget is sent whole and reported as not truncated', () => {
    // Known limit: the budget cuts on block boundaries only, so a single huge block (or fence)
    // goes through uncut and the request may overflow the model's window.
    const md = 'x'.repeat(7000);
    expect(budgetDocument(md, windowOf(1000))).toMatchObject({ text: md, coverage: 1, truncated: false });
  });
});

describe('budgetDocument: coverage', () => {
  it('is the cut position over the document length, strictly between 0 and 1 when truncated', () => {
    const doc = sectioned(10);
    const r = budgetDocument(doc, windowOf(Math.floor(doc.length * 0.5)));
    // The cut is the offset where the next section starts.
    const cut = r.text.length + doc.slice(r.text.length).search(/## Section/);
    expect(r.coverage).toBeCloseTo(cut / doc.length, 10);
    expect(r.coverage).toBeGreaterThan(0.3);
    expect(r.coverage).toBeLessThanOrEqual(0.5);
  });

  it('grows with the budget', () => {
    const doc = sectioned(10);
    const small = budgetDocument(doc, windowOf(Math.floor(doc.length * 0.3)));
    const large = budgetDocument(doc, windowOf(Math.floor(doc.length * 0.8)));
    expect(large.coverage).toBeGreaterThan(small.coverage);
    expect(large.sectionsIncluded).toBeGreaterThan(small.sectionsIncluded);
  });

  it('is clamped so a cut is never reported as 0 or all', () => {
    const tiny = '# T\n\nfirst\n\n' + 'x'.repeat(100_000);
    const r = budgetDocument(tiny, { contextTokens: 10, outputTokens: 10, reserveTokens: 10 });
    expect(r.truncated).toBe(true);
    expect(r.coverage).toBeGreaterThanOrEqual(0.001);
    expect(r.coverage).toBeLessThan(1);

    // The last section starts just before the end, so a cut right before it covers almost everything.
    const nearlyAll = '# A\n\n' + 'a'.repeat(100_000) + '\n\n# B\n\nz';
    const r2 = budgetDocument(nearlyAll, windowOf(nearlyAll.length - 3));
    expect(r2.truncated).toBe(true);
    expect(r2.coverage).toBeLessThanOrEqual(0.999);
  });
});

describe('budgetDocument: frontmatter', () => {
  it('is always kept, with the opening sections', () => {
    const doc = sectioned(10);
    for (const share of [0.15, 0.4, 0.9]) {
      const r = budgetDocument(doc, windowOf(Math.floor(doc.length * share)));
      expect(r.text.startsWith(FM.trimEnd()), String(share)).toBe(true);
    }
  });

  it('is kept when only the first block fits', () => {
    const doc = FM + '\n# T\n\n' + para(300, 'a') + '\n\n' + para(300, 'b');
    const r = budgetDocument(doc, { contextTokens: 50, outputTokens: 0, reserveTokens: 0 });
    expect(r.text).toBe(FM + '\n# T');
  });

  it('a `# comment` line in the frontmatter is not a heading and not a section', () => {
    const doc = '---\n# comment\ntitle: x\n---\n' + para(50) + '\n\n## Real\n\n' + para(50);
    expect(budgetDocument(doc, windowOf(doc.length)).sectionsTotal).toBe(2);
  });
});

describe('headingsOutline', () => {
  it('is a list of { level, text } in document order', () => {
    expect(headingsOutline('# One\n\n## Two\n\ntext\n\n### Three')).toEqual([
      { level: 1, text: 'One' },
      { level: 2, text: 'Two' },
      { level: 3, text: 'Three' },
    ]);
  });

  it('gives an empty list for no headings', () => {
    expect(headingsOutline('')).toEqual([]);
    expect(headingsOutline('just text\n\nmore')).toEqual([]);
  });

  it('skips frontmatter, fenced code of both kinds, and strips closing hashes', () => {
    const md = '---\n# not\n---\n# A\n```\n# no\n```\n~~~\n## no\n~~~\n## B ##\n###### F';
    expect(headingsOutline(md)).toEqual([
      { level: 1, text: 'A' },
      { level: 2, text: 'B' },
      { level: 6, text: 'F' },
    ]);
  });

  it('is strict about what counts as an ATX heading', () => {
    const md = ['#hashtag', '####### seven', '    # indented code', ' ## three spaces ok', '#', '# ', 'Setext', '======', '# Real'].join('\n');
    expect(headingsOutline(md)).toEqual([
      { level: 2, text: 'three spaces ok' },
      { level: 1, text: 'Real' },
    ]);
  });

  it('keeps inline markup as written and handles CRLF', () => {
    expect(headingsOutline('# **Bold** and `code`\r\n\r\n## Next\r\n')).toEqual([
      { level: 1, text: '**Bold** and `code`' },
      { level: 2, text: 'Next' },
    ]);
  });
});
