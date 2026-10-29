// @vitest-environment node
// M4 smoke tests for the pure document-understanding modules: lenient JSON,
// the document budget and the summary / title / properties prompts. The full
// suites are milestone T2.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  JSON_SHAPE_HINT,
  aiErrorCopy,
  budgetDocument,
  buildPropertiesMessages,
  buildSummaryMessages,
  buildTitleMessages,
  finalizeSummary,
  headingsOutline,
  jsonRepairMessages,
  parseLenientJson,
  parsePropertySuggestions,
  parseTitles,
  summaryMaxTokens,
} from '@mikedown/core/ai';

const OUTPUTS = join(__dirname, '..', '..', '..', 'test', 'ai-fixtures', 'outputs');

describe('parseLenientJson fixtures', () => {
  const files = readdirSync(OUTPUTS).filter((f) => f.endsWith('.json'));
  it('finds the fixtures', () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });
  for (const file of files) {
    it(file, () => {
      const fx = JSON.parse(readFileSync(join(OUTPUTS, file), 'utf8'));
      const r = parseLenientJson(fx.raw);
      expect(r.ok).toBe(fx.expected.ok);
      if (r.ok) {expect(r.value).toEqual(fx.expected.value);}
      else {expect(r.error.length).toBeGreaterThan(0);}
    });
  }

  it('keeps apostrophes inside double-quoted strings and braces inside strings', () => {
    const r = parseLenientJson('{"a": "it\'s {fine}", "b": [1, 2,],}');
    expect(r).toEqual({ ok: true, value: { a: "it's {fine}", b: [1, 2] } });
  });

  it('takes the next JSON value when the first bracket pair is not JSON', () => {
    expect(parseLenientJson('see [this one] then {"x": 1}')).toEqual({ ok: true, value: { x: 1 } });
  });

  it('an empty reply, or only an unclosed think block, is not ok', () => {
    expect(parseLenientJson('').ok).toBe(false);
    expect(parseLenientJson('<think>still {"x": 1} thinking').ok).toBe(false);
  });
});

describe('repair turn and shape hint', () => {
  it('quotes the error and the earlier reply', () => {
    const msgs = jsonRepairMessages('<think>x</think>nope', 'No JSON object found in the reply.');
    expect(msgs.map((m) => m.role)).toEqual(['assistant', 'user']);
    expect(msgs[0].content).toBe('nope');
    expect(msgs[1].content).toBe('Your previous reply was not valid JSON (No JSON object found in the reply.). Reply with the JSON object only.');
  });

  it('JSON_SHAPE_HINT puts the example on one line', () => {
    expect(JSON_SHAPE_HINT({ titles: ['a', 'b'] })).toContain('{"titles":["a","b"]}');
  });

  it('badOutput has the agreed copy', () => {
    expect(aiErrorCopy('badOutput').message).toBe('The model did not return a usable answer. Try again or pick another model.');
  });
});

// ── Document budget ─────────────────────────────────────────────────────────

function bigDocument(): string {
  const parts = ['---', 'title: Big', '---', '', 'Intro paragraph.', ''];
  for (let i = 1; i <= 40; i++) {
    parts.push(`## Section ${i}`, '', 'Some words. '.repeat(120).trim(), '', '```js', '## not a heading', '', 'const x = 1;'.repeat(5), '```', '');
  }
  return parts.join('\n');
}

describe('budgetDocument', () => {
  const doc = bigDocument();

  it('is a no-op when the document fits', () => {
    const r = budgetDocument('# Hi\n\nShort.', { contextTokens: 8192, outputTokens: 600, reserveTokens: 800 });
    expect(r).toMatchObject({ text: '# Hi\n\nShort.', coverage: 1, truncated: false, sectionsIncluded: 1, sectionsTotal: 1 });
  });

  it('keeps whole leading sections on a 60k document with an 8k window', () => {
    expect(doc.length).toBeGreaterThan(50000);
    const r = budgetDocument(doc, { contextTokens: 8192, outputTokens: 700, reserveTokens: 900 });
    expect(r.truncated).toBe(true);
    expect(r.coverage).toBeGreaterThan(0);
    expect(r.coverage).toBeLessThan(1);
    expect(r.text.startsWith('---\ntitle: Big\n---')).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(Math.floor((8192 - 700 - 900) * 3.5));
    expect(r.sectionsIncluded).toBeLessThan(r.sectionsTotal);
    // Ends on a section boundary: the last section's fenced block is whole.
    expect(doc.startsWith(r.text)).toBe(true);
    expect((r.text.match(/^```/gm) ?? []).length % 2).toBe(0);
    expect(r.text.trimEnd().endsWith('```')).toBe(true);
    expect(headingsOutline(r.text)).toHaveLength(r.sectionsIncluded - 1);
  });

  it('a first section over budget is cut between blocks, never inside a fence', () => {
    const fence = '```\n' + 'line\n'.repeat(2000) + '```';
    const text = ['# Only section', '', 'First block.', '', fence, '', 'Last block.'].join('\n');
    const r = budgetDocument(text, { contextTokens: 1200, outputTokens: 100, reserveTokens: 100 });
    expect(r.truncated).toBe(true);
    expect(r.sectionsIncluded).toBe(1);
    expect(r.text).toBe('# Only section\n\nFirst block.');
  });

  it('headingsOutline skips frontmatter and fenced code and strips closing hashes', () => {
    const md = '---\n# comment\n---\n# One\n```\n# nope\n```\n## Two ##\n###### Six';
    expect(headingsOutline(md)).toEqual([
      { level: 1, text: 'One' },
      { level: 2, text: 'Two' },
      { level: 6, text: 'Six' },
    ]);
  });
});

// ── Prompts ─────────────────────────────────────────────────────────────────

describe('summary prompt', () => {
  it('asks for bullets on a long document and a paragraph on a short one, and notes the cut', () => {
    const long = buildSummaryMessages({ document: 'word '.repeat(600), kind: 'tldr', coverage: 0.4 });
    expect(long[0].role).toBe('system');
    expect(String(long[1].content)).toContain('3 to 6 bullet points');
    expect(String(long[1].content)).toContain('first 40%');
    const short = buildSummaryMessages({ document: 'Short.', kind: 'tldr', coverage: 1 });
    expect(String(short[1].content)).toContain('one paragraph');
    expect(String(short[1].content)).not.toContain('Only the first');
  });

  it('wraps TL;DR in a Summary callout and leaves the outline a plain list', () => {
    expect(finalizeSummary('<think>hm</think>\n- one\n- two', 'tldr')).toBe('> [!NOTE]\n> **Summary**\n>\n> - one\n> - two');
    expect(finalizeSummary('```markdown\n- A\n  - B\n```', 'outline')).toBe('- A\n  - B');
  });

  it('appends the coverage line when truncated and drops a lead-in or label', () => {
    expect(finalizeSummary('Here is the summary:\n\n**Summary**\n\n- one', 'tldr', 0.37)).toBe(
      '> [!NOTE]\n> **Summary**\n>\n> - one\n>\n> Covers the first 37% of the document.',
    );
    expect(finalizeSummary('- A', 'outline', 0.5)).toBe('- A\n\nCovers the first 50% of the document.');
    expect(finalizeSummary('  <think>only thinking', 'tldr')).toBe('');
  });

  it('scales the output budget with the input within bounds', () => {
    expect(summaryMaxTokens('tldr', 100)).toBe(256);
    expect(summaryMaxTokens('tldr', 1_000_000)).toBe(700);
    expect(summaryMaxTokens('outline', 100)).toBe(384);
    expect(summaryMaxTokens('outline', 1_000_000)).toBe(1200);
  });
});

describe('title prompt and parser', () => {
  it('lists the headings and the existing title and asks for the titles shape', () => {
    const msgs = buildTitleMessages({
      document: 'Body',
      outline: [{ level: 1, text: 'A' }, { level: 2, text: 'B' }],
      existingTitle: 'Old',
      count: 3,
    });
    const user = String(msgs[1].content);
    expect(user).toContain('- A\n  - B');
    expect(user).toContain('Do not repeat it');
    expect(user).toContain('{"titles":["title 1","title 2","title 3"]}');
  });

  it('dedupes, trims to 120 characters and drops the existing title', () => {
    const long = 'x'.repeat(200);
    const r = parseTitles(JSON.stringify({ titles: ['Old Title', ' New one. ', 'new ONE', long, 7, ''] }), 'old title');
    expect(r).toEqual({ ok: true, titles: ['New one', 'x'.repeat(120)] });
  });

  it('fails when there is nothing usable', () => {
    expect(parseTitles('{"titles": []}').ok).toBe(false);
    expect(parseTitles('no json here').ok).toBe(false);
  });
});

describe('properties prompt and parser', () => {
  const existing = [
    { key: 'title', value: 'Current' },
    { key: 'tags', value: ['Alpha', 'beta'] },
  ];

  it('lists the vocabulary as tags to prefer', () => {
    const msgs = buildPropertiesMessages({ document: 'Body', outline: [], existing, vocabulary: ['project/active', 'ideas'] });
    const user = String(msgs[1].content);
    expect(user).toContain('Prefer these existing tags');
    expect(user).toContain('project/active, ideas');
    expect(user).toContain('tags: Alpha, beta');
  });

  it('normalises tags, marks known ones, drops present ones and caps at 8', () => {
    const reply = JSON.stringify({
      title: 'Current',
      description: 'd'.repeat(300),
      tags: ['#Ideas', 'Machine Learning', 'ALPHA', 'ideas', 'a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', '123'],
    });
    const r = parsePropertySuggestions(reply, existing, ['ideas', '#Project/Active']);
    expect(r.ok).toBe(true);
    if (!r.ok) {return;}
    expect(r.suggestions.title).toBeUndefined();
    expect(r.suggestions.description).toHaveLength(200);
    expect(r.suggestions.tags).toHaveLength(8);
    expect(r.suggestions.tags.slice(0, 3)).toEqual([
      { tag: 'ideas', known: true },
      { tag: 'machine-learning', known: false },
      { tag: 'a1', known: false },
    ]);
  });

  it('is ok with nothing new when everything is already present, and a failure when the reply is empty', () => {
    const same = parsePropertySuggestions('{"title":"Current","tags":["alpha"]}', existing, []);
    expect(same).toEqual({ ok: true, suggestions: { tags: [] } });
    expect(parsePropertySuggestions('{"tags": []}', existing, []).ok).toBe(false);
    expect(parsePropertySuggestions('nothing', existing, []).ok).toBe(false);
  });
});
