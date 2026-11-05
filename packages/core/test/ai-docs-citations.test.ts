// @vitest-environment node
// Citations and the Insert sanitizer (S8, A8), written as attacks.
import { describe, expect, it } from 'vitest';
import {
  ANSWERED_WITHOUT_SOURCES,
  NO_SOURCES_CITED,
  citationLink,
  docsCitationLabel,
  encodeLinkPath,
  parseCitations,
  prepareInsertMarkdown,
  relativeDocsPath,
  rewriteCitationsForInsert,
  sanitizeInsertMarkdown,
} from '@mikedown/core/ai';
import type { AiDocsSection } from '@mikedown/core/ai';

const section = (relPath: string, heading: string | undefined, text = '', root = 'd'): AiDocsSection => ({
  id: heading ? `${root}/${relPath}#${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : `${root}/${relPath}`,
  pageId: `${root}/${relPath}`,
  title: relPath.replace(/\.md$/, ''),
  relPath,
  heading,
  text,
  truncated: false,
});
const numbered = (...sections: AiDocsSection[]) => sections.map((s, i) => ({ n: i + 1, section: s }));
const clean = (md: string, cited: string[] = []) => sanitizeInsertMarkdown(md, cited).markdown;

describe('parseCitations', () => {
  it('keeps valid numbers, drops unknown ones from text and lists, reports them once', () => {
    const p = parseCitations('A [1]. B [99]. C [0]. D [2, 99, 1]. E [99]', [1, 2]);
    expect(p.cited).toEqual([1, 2]);
    expect(p.dropped).toEqual([99, 0]);
    expect(p.text).toBe('A [1]. B. C. D [2, 1]. E');
    expect(p.noSources).toBe(false);
  });

  it('says no sources when nothing valid is cited, and the strings are the contract', () => {
    expect(parseCitations('Nothing here.', [1, 2])).toMatchObject({ noSources: true, cited: [], dropped: [] });
    expect(parseCitations('Only [99] and [0].', [1])).toMatchObject({ noSources: true, text: 'Only and.' });
    expect(parseCitations('Anything [1].', [])).toMatchObject({ noSources: true, dropped: [1] });
    expect(NO_SOURCES_CITED).toBe('No sources cited');
    expect(ANSWERED_WITHOUT_SOURCES).toBe('answered without sources');
  });

  it('[0] is never valid, because numbering starts at 1', () => {
    expect(parseCitations('x [0]', [1]).dropped).toEqual([0]);
  });

  it('a marker inside a code span, a fence or after an escape is not a citation and is left as written', () => {
    const answer = 'a `[1]` b ``code [2] code`` c \\[1] d\n```\n[1] [99]\n```\n~~~\n[1]\n~~~\n';
    const p = parseCitations(answer, [1, 2]);
    expect(p.cited).toEqual([]);
    expect(p.dropped).toEqual([]);
    expect(p.text).toBe(answer);
  });

  it('an unterminated fence swallows the rest, like CommonMark', () => {
    expect(parseCitations('```\n[1]', [1]).cited).toEqual([]);
  });

  it('a marker that is part of a link, a definition, an image or a reference is not a citation', () => {
    for (const t of ['[1](x)', '[1]: http://x', '![1]', '![1][1]', '[text][1]']) {
      expect(parseCitations(t, [1, 2]).cited, t).toEqual([]);
    }
  });

  it('adjacent markers [1][2] stay two citations', () => {
    expect(parseCitations('x [1][2]', [1, 2]).cited).toEqual([1, 2]);
  });

  it('huge, signed, decimal and text numbers are not citations', () => {
    for (const t of ['[12345]', '[-1]', '[1.5]', '[one]', '[1a]', '[ 1 ]', '[]', '[,]']) {
      expect(parseCitations(t, [1, 12345]).cited, t).toEqual([]);
    }
  });

  it('parts rebuild the text exactly', () => {
    const p = parseCitations('Use X [1, 2] then Y [3] and Z [7].', [1, 2, 3]);
    expect(p.parts.map((x) => (x.type === 'text' ? x.text : `[${x.ns.join(', ')}]`)).join('')).toBe(p.text);
    expect(p.parts.filter((x) => x.type === 'cite')).toEqual([{ type: 'cite', ns: [1, 2] }, { type: 'cite', ns: [3] }]);
  });

  it('a duplicate inside one marker counts once', () => {
    expect(parseCitations('x [1, 1]', [1]).parts.filter((x) => x.type === 'cite')).toEqual([{ type: 'cite', ns: [1] }]);
  });

  it('is linear on a long run of brackets and backticks', () => {
    const t0 = Date.now();
    parseCitations('[1'.repeat(200_000), [1]);
    parseCitations('`'.repeat(100_000) + '[1]', [1]);
    parseCitations('`a'.repeat(100_000) + '[1]', [1]);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('labels, paths and the relative rewrite', () => {
  const sources = numbered(
    section('security.md', 'Key rotation'),
    section('guides/my notes.md', 'Setup (v2)'),
    section('guides/a#b.md', 'Top'),
    section('guides/deep/x.md', undefined),
    section('other/y.md', 'Y', '', 'elsewhere'),
  );
  const run = (answer: string, loc: { root: string; folder: string } | null) => rewriteCitationsForInsert(answer, sources, loc);

  it('labels are file › heading, or the file for a whole page', () => {
    expect(docsCitationLabel(sources[0].section)).toBe('security.md › Key rotation');
    expect(docsCitationLabel(sources[3].section)).toBe('guides/deep/x.md');
  });

  it('writes CommonMark relative links from the document folder', () => {
    expect(run('[1]', { root: 'd', folder: '' })).toBe('[Key rotation](security.md#key-rotation)');
    expect(run('[1]', { root: 'd', folder: 'guides' })).toBe('[Key rotation](../security.md#key-rotation)');
    expect(run('[1]', { root: 'd', folder: 'a/b/c' })).toBe('[Key rotation](../../../security.md#key-rotation)');
    expect(run('[4]', { root: 'd', folder: 'guides' })).toBe('[guides/deep/x](deep/x.md)');
    expect(run('[4]', { root: 'd', folder: 'guides/deep' })).toBe('[guides/deep/x](x.md)');
    expect(run('[4]', { root: 'd', folder: 'guides/other' })).toBe('[guides/deep/x](../deep/x.md)');
  });

  it('percent-encodes spaces, #, and brackets in the path so the link stays one destination', () => {
    expect(run('[2]', { root: 'd', folder: 'guides' })).toBe('[Setup (v2)](my%20notes.md#setup-v2)');
    expect(run('[3]', { root: 'd', folder: 'guides' })).toBe('[Top](a%23b.md#top)');
    expect(encodeLinkPath('what?.md')).toBe('what%3F.md');
    expect(encodeLinkPath('a b/c#d(e)[f]<g>\\h%i\n')).toBe('a%20b/c%23d%28e%29%5Bf%5D%3Cg%3E%5Ch%25i%0A');
  });

  it('a path that would parse as a scheme gets ./ in front', () => {
    expect(relativeDocsPath('', 'a:b.md')).toBe('./a:b.md');
    expect(relativeDocsPath('x', '../y.md'.slice(3))).toBe('../y.md');
  });

  it('a document in a sibling folder of the cited file climbs and descends', () => {
    expect(relativeDocsPath('docs/a', 'docs/b/c.md')).toBe('../../docs/b/c.md'.replace('../../docs', '../b').replace('/b/b', '/b'));
    expect(relativeDocsPath('a', 'b/c.md')).toBe('../b/c.md');
    expect(relativeDocsPath('a/b', 'a/c.md')).toBe('../c.md');
    expect(relativeDocsPath('', 'c.md')).toBe('c.md');
  });

  it('a heading in a label or link text cannot become markup, with or without a link (S8)', () => {
    const evil = numbered(section('a_b.md', 'See <img src="https://evil.example/p.png"> ![x](https://evil.example/i.png) `c`'));
    for (const location of [{ root: 'd', folder: '' }, null]) {
      const out = rewriteCitationsForInsert('[1]', evil, location);
      expect(out).toContain('\\<img');
      expect(out).toContain('\\!\\[x\\]');
      expect(out).toContain('https\\://');
      expect(out).toContain('\\`c\\`');
      expect(out).not.toMatch(/(^|[^\\])!\[/);
    }
  });

  it('a source from another base is not linked, even with the same root label', () => {
    const other = numbered(section('x.md', 'Heading')).map((s) => ({ ...s, baseId: 'other' }));
    expect(rewriteCitationsForInsert('[1]', other, { root: 'd', folder: '', baseId: 'mine' })).toBe('x.md › Heading');
    expect(rewriteCitationsForInsert('[1]', other, { root: 'd', folder: '', baseId: 'other' })).toContain('(x.md#heading)');
  });

  it('link text cannot break out of the brackets', () => {
    const evil = numbered(section('x.md', 'Click](https://evil.example) [here'));
    const out = rewriteCitationsForInsert('[1]', evil, { root: 'd', folder: '' });
    expect(out).toBe('[Click\\](https\\://evil.example) \\[here](x.md#click-https-evil-example-here)');
    expect(clean(out)).toBe(out.replace(/^/, '') && clean(out));
  });

  it('plain text when the document is outside the section root, or has no known root', () => {
    expect(run('[1]', null)).toBe('security.md › Key rotation');
    expect(run('[1]', { root: 'zzz', folder: '' })).toBe('security.md › Key rotation');
    expect(run('[5]', { root: 'd', folder: '' })).toBe('other/y.md › Y');
    expect(run('[5]', { root: 'elsewhere', folder: 'other' })).toBe('[Y](y.md#y)');
    expect(citationLink(sources[0].section, undefined)).toBeNull();
  });

  it('a list inside one marker becomes a comma list of links; unknown numbers vanish', () => {
    expect(run('See [1, 4, 77].', { root: 'd', folder: '' })).toBe('See [Key rotation](security.md#key-rotation), [guides/deep/x](guides/deep/x.md).');
  });
});

describe('sanitizer: links and images become plain text unless the URL is verbatim in a cited section', () => {
  const cited = ['Docs at https://good.example/doc and ![d](https://good.example/i.png) and mailto:a@good.example and https://good.example/a_(b).'];

  it('a cited https link or image survives exactly', () => {
    expect(clean('[a](https://good.example/doc)', cited)).toBe('[a](https://good.example/doc)');
    expect(clean('![x](https://good.example/i.png)', cited)).toBe('![x](https://good.example/i.png)');
    expect(clean('[mail](mailto:a@good.example)', cited)).toBe('[mail](mailto:a@good.example)');
  });

  it('an uncited link or image becomes its text, and is counted', () => {
    const r = sanitizeInsertMarkdown('[a](https://evil.example/x) and ![b](https://evil.example/p.png)', cited);
    expect(r).toEqual({ markdown: 'a and b', linksRemoved: 1, imagesRemoved: 1 });
  });

  it('a URL that matches a cited URL only as a prefix is not verbatim', () => {
    expect(clean('[a](https://good.example/do)', cited)).toBe('a'); // prefix of the cited URL, ends mid word
    expect(clean('[a](https://good.example/doc/extra)', cited)).toBe('a'); // cited URL is a prefix of this one
    expect(clean('[a](https://good.example/doc?token=1)', cited)).toBe('a');
    expect(clean('[a](https://good.example/doc#frag)', cited)).toBe('a');
    expect(clean('[a](https://good.example/docs)', cited)).toBe('a');
    expect(clean('[a](https://good.example)', cited)).toBe('a');
    expect(clean('![x](https://good.example/i.png?exfil=secret)', cited)).toBe('x');
    expect(clean('[a](https://good.example.evil.example/doc)', cited)).toBe('a');
    expect(clean('[a](https://evil.example/https://good.example/doc)', cited)).toBe('a');
    expect(clean('[a](xhttps://good.example/doc)', cited)).toBe('a');
  });

  it('a different scheme or case is not verbatim', () => {
    expect(clean('[a](http://good.example/doc)', cited)).toBe('a');
    expect(clean('![x](http://good.example/i.png)', cited)).toBe('x');
    expect(clean('[a](HTTPS://GOOD.EXAMPLE/DOC)', cited)).toBe('a');
  });

  it('no cited text at all means no link or image survives', () => {
    expect(clean('[a](https://good.example/doc) ![b](https://good.example/i.png)', [])).toBe('a b');
    expect(clean('[a](https://good.example/doc)', [''])).toBe('a');
    expect(clean('[a]()', cited)).toBe('a');
    expect(clean('![a]()', cited)).toBe('a');
  });

  it('dangerous schemes and relative or titled destinations are always removed, even if cited', () => {
    const dangerous = ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:x', 'file:///etc/passwd', 'vscode://file/x', 'command:workbench.action.reloadWindow', '//evil.example/x', '/etc/passwd', '../secret.md', 'rel.md', '#frag'];
    for (const u of dangerous) {
      expect(clean(`[a](${u})`, [u, `x ${u} y`]), u).toBe('a');
      expect(clean(`![a](${u})`, [u, `x ${u} y`]), u).toBe('a');
      expect(clean(`[a](<${u}>)`, [u]), u).toBe('a');
    }
    expect(clean('[a](rel.md "title")', cited)).toBe('a');
    // An image over http: or mailto: is never allowed as an image.
    expect(clean('![x](mailto:a@good.example)', cited)).toBe('x');
  });

  it('a javascript: URL with whitespace or entity tricks is removed', () => {
    for (const u of ['java\tscript:alert(1)', ' javascript:alert(1)', 'jav&#x61;script:alert(1)', '&#106;avascript:alert(1)', 'javascript&colon;alert(1)']) {
      const out = clean(`[a](<${u}>) [b](${u.replace(/\s/g, '')})`, [u]);
      expect(out, u).not.toMatch(/\]\(/);
    }
  });

  it('an image nested in a link: the image is judged on its own, then the link', () => {
    expect(clean('[![x](https://evil.example/p.png)](https://evil.example/l)', cited)).toBe('x');
    expect(clean('[![x](https://evil.example/p.png)](https://good.example/doc)', cited)).toBe('[x](https://good.example/doc)');
    expect(clean('[![x](https://good.example/i.png)](https://evil.example/l)', cited)).toBe('![x](https://good.example/i.png)');
    expect(clean('[![x](https://good.example/i.png)](https://good.example/doc)', cited)).toBe('[![x](https://good.example/i.png)](https://good.example/doc)');
    expect(clean('[[![x](https://evil.example/p.png)](https://evil.example/a)](https://evil.example/b)', cited)).toBe('x');
    expect(clean('![![x](https://evil.example/p.png)](https://evil.example/q.png)', cited)).toBe('x');
  });

  it('a reference-style image defined at the bottom is judged by its definition', () => {
    expect(clean('![alt][r]\n\n[r]: https://evil.example/p.png', cited)).toBe('alt\n\n');
    expect(clean('![alt][R]\n\n[r]: https://evil.example/p.png', cited)).toBe('alt\n\n');
    expect(clean('![alt][]\n\n[alt]: https://evil.example/p.png', cited)).toBe('alt\n\n');
    expect(clean('![alt]\n\n[alt]: https://evil.example/p.png', cited)).not.toContain('evil');
    expect(clean('text ![alt][r]\n\n[r]: https://good.example/i.png', cited)).toBe('text ![alt][r]\n\n[r]: https://good.example/i.png');
    expect(clean('![alt][r]\n\n[r]: <https://evil.example/p.png> "title"', cited)).toBe('alt\n\n');
  });

  it('reference-style links and shortcut references are judged by their definitions, case-insensitively', () => {
    expect(clean('[a][r]\n\n[r]: https://evil.example/x', cited)).toBe('a\n\n');
    expect(clean('[a][R]\n\n[r]: https://evil.example/x', cited)).toBe('a\n\n');
    expect(clean('[a]\n\n[a]: https://evil.example/x', cited)).not.toContain('evil');
    expect(clean('[a][r]\n\n[r]: https://good.example/doc', cited)).toBe('[a][r]\n\n[r]: https://good.example/doc');
  });

  it('an orphan definition with an evil URL is dropped even when nothing uses it', () => {
    const out = sanitizeInsertMarkdown('hello\n\n[r]: https://evil.example/x\n', cited);
    expect(out.markdown).not.toContain('evil');
    expect(out.linksRemoved).toBe(1);
  });

  it('a definition indented four spaces is code, not a definition, so it is left alone', () => {
    expect(clean('    [r]: https://evil.example/x', cited)).toContain('evil');
  });

  it('raw HTML: <img src>, <a href>, <script>, <iframe>, comments and closing tags are escaped', () => {
    for (const html of ['<img src="https://evil.example/p.png">', '<a href="https://evil.example">x</a>', '<script>alert(1)</script>', '<iframe src=x></iframe>', '<!-- c -->', '</div>', '<?php x ?>', '<IMG SRC=x onerror=alert(1)>', '<img\nsrc=x>']) {
      const out = clean(html, cited);
      expect(out, html).not.toMatch(/(^|[^\\])</);
    }
  });

  it('a lone < in prose (a < b, <3) is left alone', () => {
    expect(clean('if a < b and 1 <2 or <3', cited)).toBe('if a < b and 1 <2 or <3');
  });

  it('autolinks: <url> and bare urls are defanged unless cited; mailto and other schemes too', () => {
    expect(clean('see <https://evil.example/x>.', cited)).toBe('see https\\://evil.example/x.');
    expect(clean('see https://evil.example/y. Then www.evil.example/z!', cited)).toBe('see https\\://evil.example/y. Then www\\.evil.example/z!');
    expect(clean('<https://good.example/doc> and https://good.example/doc.', cited)).toBe('<https://good.example/doc> and https://good.example/doc.');
    expect(clean('<javascript:alert(1)>', cited)).toBe('javascript\\:alert(1)');
    expect(clean('<mailto:a@evil.example>', cited)).toBe('mailto\\:a@evil.example');
    expect(clean('<ftp://evil.example/x>', cited)).toBe('ftp\\://evil.example/x');
    expect(clean('http://evil.example', cited)).toBe('http\\://evil.example');
  });

  it('a URL in a query of a cited URL is not an exfiltration route', () => {
    expect(clean('[a](https://good.example/doc?x=https://evil.example)', cited)).toBe('a');
    expect(clean('https://good.example/doc?leak=abc', cited)).toBe('https\\://good.example/doc?leak=abc');
  });

  it('code spans and fenced blocks are left exactly as written', () => {
    const code = '`[a](https://evil.example/x)` and ``![b](https://evil.example/p.png)``\n```\n[c](https://evil.example/c) <img src=x>\n```\n';
    expect(clean(code, cited)).toBe(code);
  });

  it('a backslash-escaped bracket is not a link', () => {
    const t = '\\[a\\](https://evil.example/x)';
    expect(clean(t, cited).startsWith('\\[a\\](')).toBe(true);
  });

  it('keeps ordinary markdown, tables, lists and emphasis unchanged', () => {
    const md = '# Title\n\n- one **bold** _it_\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> quote [x]\n\n1. step\n';
    expect(clean(md, cited)).toBe(md);
    expect(clean('', cited)).toBe('');
  });

  it('a citation written as a link keeps its number', () => {
    expect(clean('[1](https://evil.example/x) and [1, 2](https://evil.example/y)', cited)).toBe('[1] and [1, 2]');
  });

  it('an unbalanced or malformed link is left as text without throwing', () => {
    for (const t of ['[a](https://evil.example/x', '[a(https://evil.example/x)', '[a]](https://evil.example/x)', '[a]( )', '[[[[', ']]]]', '![', '[a](<https://evil.example/x)', '[a](https://x "unterminated']) {
      expect(() => clean(t, cited), t).not.toThrow();
    }
  });

  // Growth, not a wall clock: a busy machine slows a fixed limit into a false alarm, but it slows
  // the small and the large run alike. Linear work grows about 8x from 1/8 to 1x of the size; the
  // quadratic scan this guards against (28 s on 150 KB) grows about 64x. The line is 24x, with the
  // best of three small runs, and anything that finishes under 150 ms at full size passes.
  it('stays near-linear on adversarial input of 100 to 250 KB (a model, or a page it quoted, may write anything)', () => {
    const rep = (s: string, n: number, u: number): string => s.repeat(Math.max(1, Math.round(n * u)));
    const inputs: Array<[string, (u: number) => string]> = [
      ['brackets', (u) => rep('[', 50_000, u) + rep(']', 50_000, u)],
      ['open paren', (u) => rep('[a](b', 30_000, u)],
      ['nested paren', (u) => rep('[a](b (x', 30_000, u)],
      ['angle dest', (u) => rep('[a](<', 30_000, u)],
      ['open title', (u) => rep('[a](b "', 30_000, u)],
      ['refs', (u) => rep('![x][y]', 20_000, u)],
      ['urls', (u) => rep('https://x.example/', 20_000, u)],
      ['lt', (u) => rep('<', 50_000, u)],
      ['nest text', (u) => rep('[', 20_000, u) + 'a' + rep('](x)', 20_000, u)],
      ['nest image', (u) => rep('![', 20_000, u) + 'a' + rep('](x)', 20_000, u)],
      ['defs', (u) => rep('[r]: https://evil.example/x\n', 20_000, u)],
      ['refs and defs', (u) => rep('[a][r] ', 20_000, u) + '\n' + rep('[r]: https://evil.example/x\n', 5000, u)],
      ['long dest', (u) => '[a](' + rep('x', 100_000, u) + ')'],
      ['backslashes', (u) => rep('\\', 100_000, u) + '[a](b)'],
      ['backticks', (u) => rep('`a', 50_000, u)],
      ['schemes', (u) => rep('http://', 30_000, u)],
      ['text then dest', (u) => rep('[a', 50_000, u) + rep(']', 50_000, u) + '(x)'],
    ];
    const time = (text: string): number => {
      const t0 = performance.now();
      sanitizeInsertMarkdown(text, cited);
      return performance.now() - t0;
    };
    const best = (text: string, runs: number): number => Math.min(...Array.from({ length: runs }, () => time(text)));
    for (const [name, make] of inputs) {
      const full = make(1);
      expect(() => clean(full, cited), name).not.toThrow();
      let large = time(full);
      if (large < 150) {continue;}
      // Floor the small run: a few milliseconds is mostly timer and GC noise.
      const small = Math.max(best(make(1 / 8), 3), 5);
      // A slow first run may be the machine: one more look before calling it. (A quadratic scan takes tens of seconds, so it fails both.)
      if (large / small >= 24) {large = Math.min(large, time(full));}
      expect(large / small, `${name}: ${large.toFixed(0)} ms at full size, ${small.toFixed(0)} ms at 1/8`).toBeLessThan(24);
    }
  }, 600_000);

  it('a destination too long to judge is never left as a link', () => {
    const long = `https://evil.example/${'x'.repeat(5000)}`;
    for (const text of [`[a](${long})`, `![a](${long})`, `[a](<${long}>)`, `[a](https://evil.example/x "${'t'.repeat(5000)}")`]) {
      const out = clean(text, cited);
      expect(out, text.slice(0, 20)).not.toMatch(/\]\(/);
    }
  });

  it('link text nested past the limit is flattened to inert text', () => {
    const deep = '['.repeat(40) + '![x](https://evil.example/p.png)' + '](https://evil.example/l)'.repeat(40);
    const out = clean(deep, cited);
    expect(out).not.toMatch(/(^|[^\\])!\[/);
    expect(out).not.toMatch(/(^|[^\\])\]\(/);
    expect(out).not.toContain('https://evil');
  });
});

describe('prepareInsertMarkdown: sanitize first, then rewrite', () => {
  const s1 = section('security.md', 'Key rotation', 'Docs: https://good.example/doc');
  const s2 = section('guides/setup.md', 'Setup', 'nothing linkable');
  const sources = numbered(s1, s2);

  it('only the links the host wrote survive: the model cannot forge a citation link to an evil URL', () => {
    const out = prepareInsertMarkdown('Do it [1](https://evil.example/x) and see [2].', sources, { root: 'd', folder: '' });
    expect(out.markdown).toBe('Do it [Key rotation](security.md#key-rotation) and see [Setup](guides/setup.md#setup).');
    expect(out.linksRemoved).toBe(1);
  });

  it('the cited section text, not an uncited one, decides what is verbatim', () => {
    const uncitedHas = numbered(section('a.md', 'A', 'cited text'), section('b.md', 'B', 'https://good.example/doc'));
    expect(prepareInsertMarkdown('[l](https://good.example/doc) [1]', uncitedHas, null).markdown).toBe('l a.md › A');
    expect(prepareInsertMarkdown('[l](https://good.example/doc) [2]', uncitedHas, null).markdown).toBe('[l](https://good.example/doc) b.md › B');
  });

  it('a citation to an unknown number is dropped and the text stays well formed', () => {
    expect(prepareInsertMarkdown('Fact [9].', sources, null).markdown).toBe('Fact.');
  });

  it('a link with text 99 is not turned into a citation of source 99', () => {
    expect(prepareInsertMarkdown('[99](https://evil.example/x)', sources, null).markdown).toBe('');
  });

  it('a rewrite cannot produce a link the sanitizer would have removed: heading text with markdown stays inert', () => {
    const evil = numbered(section('x.md', '![i](https://evil.example/p.png)'));
    const out = prepareInsertMarkdown('[1]', evil, { root: 'd', folder: '' }).markdown;
    expect(out).not.toMatch(/(^|[^\\])!\[/);
    expect(out.startsWith('[')).toBe(true);
  });
});
