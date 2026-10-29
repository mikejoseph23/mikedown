/**
 * Markdown structure post-check (T1): what `checkMarkdownStructure` flags and
 * what it deliberately leaves alone. Complements the M1 cases in
 * ai-rewrite-family.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { checkMarkdownStructure, countMarkdownStructure } from '../src/ai';

const SAMPLE = [
  '# Title',
  '',
  '## Part',
  '',
  'See [one](https://a.test) and [[Wiki Page]].[^1]',
  '',
  '- a',
  '- b',
  '',
  '| h1 | h2 |',
  '| --- | --- |',
  '| 1 | 2 |',
  '| 3 | 4 |',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
  '[^1]: Note.',
].join('\n');

describe('identical pair', () => {
  it('reports nothing for the same text, and for prose and line ending changes', () => {
    expect(checkMarkdownStructure(SAMPLE, SAMPLE)).toEqual({ ok: true, mismatches: [], messages: [] });
    const translated = SAMPLE.replace('See', 'Mira').replace('Note.', 'Nota.').replace(/\n/g, '\r\n');
    expect(checkMarkdownStructure(SAMPLE, translated).ok).toBe(true);
  });
});

describe('dropped pieces', () => {
  it('a dropped link names the missing URL', () => {
    const diff = checkMarkdownStructure(SAMPLE, SAMPLE.replace('[one](https://a.test)', 'one'));
    expect(diff.ok).toBe(false);
    expect(diff.mismatches).toEqual([
      { kind: 'link', original: 1, result: 0, message: '1 link in the original, 0 in the result (missing: https://a.test)' },
    ]);
  });

  it('a dropped fence is one fenced block fewer; an unclosed fence still counts as one', () => {
    const diff = checkMarkdownStructure(SAMPLE, SAMPLE.replace(/```js\nconst x = 1;\n```\n/, ''));
    expect(diff.messages).toEqual(['1 fenced code block in the original, 0 in the result']);
    expect(countMarkdownStructure('```js\nno close\n# not a heading').fencedCodeBlocks).toBe(1);
    expect(countMarkdownStructure('~~~\nx\n~~~').fencedCodeBlocks).toBe(1);
  });

  it('a table row lost is reported with the row counts', () => {
    const diff = checkMarkdownStructure(SAMPLE, SAMPLE.replace('| 3 | 4 |\n', ''));
    expect(diff.messages).toEqual(['3 table rows in the original, 2 in the result']);
    expect(countMarkdownStructure(SAMPLE).tableRows).toBe(3);
  });

  it('a heading that changes level is reported at both levels', () => {
    const diff = checkMarkdownStructure(SAMPLE, SAMPLE.replace('## Part', '### Part'));
    expect(diff.messages).toEqual([
      '1 level 2 heading in the original, 0 in the result',
      '0 level 3 headings in the original, 1 in the result',
    ]);
  });

  it('a heading turned into bold text is a dropped heading', () => {
    expect(checkMarkdownStructure(SAMPLE, SAMPLE.replace('# Title', '**Title**')).messages).toEqual(['1 level 1 heading in the original, 0 in the result']);
  });
});

describe('list markers', () => {
  it('counts items, so a bullet marker swap is not reported', () => {
    // Documented limit: only the number of list items is compared, not the marker.
    expect(checkMarkdownStructure('- a\n- b', '* a\n* b').ok).toBe(true);
    expect(checkMarkdownStructure('- a\n- b', '+ a\n+ b').ok).toBe(true);
  });

  it('a bullet list turned into a numbered one keeps its count', () => {
    expect(checkMarkdownStructure('- a\n- b', '1. a\n2. b').ok).toBe(true);
    expect(countMarkdownStructure('1) a\n2) b').listItems).toBe(2);
  });

  it('a list collapsed into prose, or an item merged, is reported', () => {
    expect(checkMarkdownStructure('- a\n- b\n- c', 'a, b and c').messages).toEqual(['3 list items in the original, 0 in the result']);
    expect(checkMarkdownStructure('- a\n- b\n- c', '- a\n- b and c').messages).toEqual(['3 list items in the original, 2 in the result']);
  });

  it('nested and task items count; a bare number sentence does not', () => {
    expect(countMarkdownStructure('- a\n  - [ ] b\n    1. c').listItems).toBe(3);
    expect(countMarkdownStructure('2024 was a good year').listItems).toBe(0);
  });
});

describe('wikilinks and footnotes', () => {
  it('counts wikilinks and footnote references', () => {
    const counts = countMarkdownStructure('See [[A]] and [[B|alias]].[^1] More.[^note]\n\n[^1]: one\n[^note]: two');
    expect(counts.wikilinks).toBe(2);
    // The definition lines are not references.
    expect(counts.footnoteReferences).toBe(2);
    expect(counts.links).toEqual([]);
  });

  it('a translation that unwraps a wikilink or drops a footnote marker is reported', () => {
    const original = 'See [[Wiki Page]] now.[^1]\n\n[^1]: Note.';
    expect(checkMarkdownStructure(original, 'Mira Wiki Page ahora.[^1]\n\n[^1]: Nota.').messages).toEqual(['1 wikilink in the original, 0 in the result']);
    expect(checkMarkdownStructure(original, 'Mira [[Wiki Page]] ahora.\n\n[^1]: Nota.').messages).toEqual(['1 footnote reference in the original, 0 in the result']);
  });

  it('a translated wikilink target still counts as a wikilink', () => {
    expect(checkMarkdownStructure('See [[Home]].', 'Mira [[Inicio]].').ok).toBe(true);
  });
});

describe('links, images and code', () => {
  it('counts autolinks and reference definitions as links and images apart', () => {
    const counts = countMarkdownStructure('<https://auto.test> [ref][1] ![img](p.png)\n\n[1]: https://ref.test "Title"');
    expect([...counts.links].sort()).toEqual(['https://auto.test', 'https://ref.test']);
    expect(counts.images).toEqual(['p.png']);
  });

  it('a translated link text with the same URL passes; a changed URL is reported', () => {
    expect(checkMarkdownStructure('[docs](https://x.test/a)', '[documentación](https://x.test/a)').ok).toBe(true);
    const diff = checkMarkdownStructure('[docs](https://x.test/a)', '[docs](https://x.test/b)');
    expect(diff.messages).toEqual(['1 link point somewhere else in the result (missing: https://x.test/a; unexpected: https://x.test/b)']);
  });

  it('lists at most three missing URLs and says how many more', () => {
    const original = [1, 2, 3, 4, 5].map((n) => `[l](https://${n}.test)`).join(' ');
    expect(checkMarkdownStructure(original, 'none').messages).toEqual(['5 links in the original, 0 in the result (missing: https://1.test, https://2.test, https://3.test and 2 more)']);
  });

  it('inline code spans are counted and hide their contents from the other counters', () => {
    expect(countMarkdownStructure('Use `# x` and `[a](https://hidden.test)` and ``a ` b``.')).toMatchObject({ inlineCodeSpans: 3, links: [], headings: [0, 0, 0, 0, 0, 0] });
    expect(checkMarkdownStructure('Use `npm test` here.', 'Usa npm test aquí.').messages).toEqual(['1 inline code span in the original, 0 in the result']);
  });

  it('text inside a code fence does not count as headings, items or links', () => {
    const counts = countMarkdownStructure('```md\n# h\n- item\n[a](https://hidden.test)\n| a | b |\n| - | - |\n```');
    expect(counts).toMatchObject({ fencedCodeBlocks: 1, links: [], listItems: 0, tableRows: 0 });
    expect(counts.headings.every((n) => n === 0)).toBe(true);
  });
});
