// @vitest-environment node
// Sanity checks for the documentation-base core (index, home, links, secrets,
// budget, citations). The thorough suite is M3's.
import { describe, expect, it } from 'vitest';
import {
  budgetDocsSections,
  buildDocsIndex,
  buildDocsMap,
  createDocsLinkResolver,
  docsLinkList,
  dropSecretSections,
  findSecret,
  findSecretAtCutoff,
  parseCitations,
  prepareInsertMarkdown,
  sanitizeInsertMarkdown,
  scanDocsSections,
  secretsLeftOutPhrase,
} from '@mikedown/core/ai';
import type { AiDocsLink, AiDocsPageInput, AiDocsSection } from '@mikedown/core/ai';

const page = (root: string, relPath: string, headings: string[] = [], links: AiDocsLink[] = [], title?: string): AiDocsPageInput => ({
  root,
  relPath,
  title,
  headings: headings.map((text) => ({ level: 2, text })),
  links,
  chars: 100,
});
const md = (target: string, text = 't'): AiDocsLink => ({ target, text, kind: 'markdown' });
const wiki = (target: string): AiDocsLink => ({ target, text: target, kind: 'wikilink' });

describe('buildDocsIndex and homes', () => {
  const index = buildDocsIndex({
    baseId: 'b',
    roots: [{ label: 'docs' }, { label: 'docs-2' }],
    homeFile: 'HOME.md',
    pages: [
      page('docs-2', 'README.md'),
      page('docs', 'b.md', ['Setup', 'Setup']),
      page('docs', 'a/readme.md'),
      page('docs', 'INDEX.md', ['Intro'], [], 'Index title'),
      page('docs', 'b.md'), // duplicate id: dropped
      page('nope', 'x.md'), // unknown root: dropped
      page('docs', '../evil.md'), // unsafe: dropped
    ],
  });
  it('sorts, dedupes and drops unsafe pages', () => {
    expect(index.pages.map((p) => p.id)).toEqual(['docs/INDEX.md', 'docs/a/readme.md', 'docs/b.md', 'docs-2/README.md']);
    expect(index.pages[2].headings.map((h) => h.id)).toEqual(['docs/b.md#setup', 'docs/b.md#setup-1']);
  });
  it('titles: frontmatter, first heading, file name', () => {
    expect(index.pages[0].title).toBe('Index title');
    expect(index.pages[2].title).toBe('Setup');
    expect(index.pages[1].title).toBe('readme');
  });
  it('home precedence per root, map when none', () => {
    expect(index.homes).toEqual([
      { root: 'docs', kind: 'index', pageId: 'docs/INDEX.md' },
      { root: 'docs-2', kind: 'readme', pageId: 'docs-2/README.md' },
    ]);
    const withOverride = buildDocsIndex({ baseId: 'b', roots: [{ label: 'r' }], homeFile: 'start/Home.md', pages: [page('r', 'INDEX.md'), page('r', 'start/home.md')] });
    expect(withOverride.homes[0]).toEqual({ root: 'r', kind: 'override', pageId: 'r/start/home.md' });
    const none = buildDocsIndex({ baseId: 'b', roots: [{ label: 'r' }], pages: [page('r', 'a.md')] });
    expect(none.homes[0].kind).toBe('map');
  });
  it('map is capped and keeps the shallowest pages', () => {
    const pages = [page('r', 'deep/er/x.md'), ...Array.from({ length: 5 }, (_, i) => page('r', `p${i}.md`))];
    const idx = buildDocsIndex({ baseId: 'b', roots: [{ label: 'r' }], pages });
    const map = buildDocsMap(idx, 'r', 5);
    expect(map.entries).toHaveLength(5);
    expect(map.omitted).toBe(1);
    expect(map.entries.some((e) => e.pageId === 'r/deep/er/x.md')).toBe(false);
  });
});

describe('links', () => {
  const index = buildDocsIndex({
    baseId: 'b',
    roots: [{ label: 'docs' }],
    pages: [
      page('docs', 'README.md', ['Start'], [md('guide/setup.md#key-rotation'), md('guide/setup.md'), md('../outside.md'), md('/abs.md'), md('https://x.dev'), md('missing.md'), md('guide/setup#nope'), md('#start'), wiki('Setup'), wiki('nothing')]),
      page('docs', 'guide/setup.md', ['Key rotation']),
      page('docs', 'guide/Setup%20Two.md'),
      page('docs', 'other/setup.md'),
      page('docs', 'guide/sub/deep.md', [], [wiki('setup')]),
    ],
  });
  const r = createDocsLinkResolver(index);
  const from = 'docs/README.md';
  const go = (i: number) => r.resolve(from, index.pages[0].links[i]);
  it('resolves relative links, fragments and the .md fallback', () => {
    expect(go(0)).toMatchObject({ status: 'ok', pageId: 'docs/guide/setup.md', sectionId: 'docs/guide/setup.md#key-rotation' });
    expect(go(1)).toMatchObject({ status: 'ok', pageId: 'docs/guide/setup.md' });
    expect(go(6)).toMatchObject({ status: 'ok', pageId: 'docs/guide/setup.md', fragmentMissing: true });
    expect(go(7)).toMatchObject({ status: 'ok', pageId: from, sectionId: 'docs/README.md#start' });
  });
  it('marks links leaving the root or missing as broken, never followable', () => {
    expect(go(2)).toMatchObject({ status: 'broken', reason: 'outside-root' });
    expect(go(3)).toMatchObject({ status: 'broken', reason: 'outside-root' });
    expect(go(5)).toMatchObject({ status: 'broken', reason: 'not-found' });
    expect(go(4).status).toBe('external');
  });
  it('wikilinks: nearest wins and the count is reported', () => {
    expect(go(8)).toMatchObject({ status: 'ok', pageId: 'docs/guide/setup.md', candidates: 2 });
    expect(r.resolve('docs/guide/sub/deep.md', index.pages.find((p) => p.id === 'docs/guide/sub/deep.md')!.links[0])).toMatchObject({ pageId: 'docs/guide/setup.md' });
    expect(go(9)).toMatchObject({ status: 'broken', reason: 'not-found' });
  });
  it('hop-1 list drops broken and external links, dedupes and caps', () => {
    const list = docsLinkList(index, from, 2);
    expect(list.links.map((l) => l.sectionId ?? l.pageId)).toEqual(['docs/guide/setup.md#key-rotation', 'docs/guide/setup.md']);
    expect(list.broken).toBe(4);
    expect(list.omitted).toBeGreaterThanOrEqual(1);
    expect(r.countBroken()).toBe(4);
  });
});

describe('secrets', () => {
  it('finds AWS keys, tokens, PEM headers and JWTs', () => {
    expect(findSecret('key: AKIAIOSFODNN7EXAMPLE')).toBe('aws-access-key');
    expect(findSecret('OPENAI_API_KEY=sk-proj-abc123def456ghi789jkl012')).toBe('api-token');
    expect(findSecret('sk-ant-api03-Ab1Cd2Ef3Gh4Ij5Kl6Mn7')).toBe('api-token');
    expect(findSecret('token sk_live_51H8aBcDeFgHiJkLmNoPq')).toBe('api-token');
    for (const kind of ['', 'RSA ', 'EC ', 'DSA ', 'OPENSSH ', 'ENCRYPTED ']) {
      expect(findSecret(`-----BEGIN ${kind}PRIVATE KEY-----\nMIIE`)).toBe('private-key');
    }
    expect(findSecret('-----BEGIN PGP PRIVATE KEY BLOCK-----')).toBe('private-key');
    expect(findSecret('Authorization: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r')).toBe('jwt');
  });
  it('ordinary text with sk-, a public cert and short tokens never match', () => {
    for (const t of ['task-based work', 'risk-free and desk-mounted things', 'the sk-learn-pipeline-for-everything docs', 'ask-me-anything-about-the-thing-123', '-----BEGIN CERTIFICATE-----', 'AKIA is a prefix', 'eyJ.eyJ.x', 'sk-short1']) {
      expect(findSecret(t)).toBeNull();
    }
  });
  it('is linear on 1 MiB adversarial input', () => {
    const inputs = ['sk-'.repeat(350_000), `sk-${'a'.repeat(1 << 20)}`, `eyJ${'a'.repeat(1 << 20)}`, `eyJaaaaaaaa.${'eyJ'.repeat(350_000)}`, '-----BEGIN '.repeat(100_000), 'AKIA'.repeat(260_000), `${'a '.repeat(500_000)}`];
    const t0 = Date.now();
    for (const text of inputs) {findSecret(text); findSecretAtCutoff(text);}
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it('catches a key cut in half at the byte cap', () => {
    expect(findSecretAtCutoff('some text AKIAIOSFODN')).toBe('aws-access-key');
    expect(findSecretAtCutoff('some text sk-proj-abc123def4')).toBe('api-token');
    expect(findSecretAtCutoff('some ordinary text')).toBeNull();
  });
  const section = (id: string, text: string, truncated = false): AiDocsSection => ({ id, pageId: 'd/a.md', title: 'A', relPath: 'a.md', text, truncated });
  it('scans sections and reports ids only', () => {
    const scan = scanDocsSections([section('a', 'fine'), section('b', 'AKIAIOSFODNN7EXAMPLE'), section('c', 'sk-proj-abc123def4', true)]);
    expect(scan.kept.map((s) => s.id)).toEqual(['a']);
    expect(scan.leftOut).toEqual(['b', 'c']);
    expect(JSON.stringify(scan.leftOut)).not.toContain('AKIA');
  });
  it('phrases', () => {
    expect(secretsLeftOutPhrase(1)).toBe('1 section left out: looks like it contains a key');
    expect(secretsLeftOutPhrase(2, 'entry')).toBe('2 entries left out: look like they contain a key');
    expect(secretsLeftOutPhrase(0)).toBe('');
  });
  it('this-document scope drops only the section with the key', () => {
    const r = dropSecretSections('# A\nok\n# B\nAKIAIOSFODNN7EXAMPLE\n# C\nfine\n');
    expect(r).toEqual({ text: '# A\nok\n# C\nfine\n', total: 3, leftOut: 1 });
  });
});

describe('budget', () => {
  const sec = (id: string, len: number): AiDocsSection => ({ id, pageId: 'd/a.md', title: 'A', relPath: 'a.md', text: 'x'.repeat(len), truncated: false });
  it('keeps what fits, numbers after the cut, says what was left out', () => {
    // 1000 tokens x 30% x 3.5 = 1050 chars
    const r = budgetDocsSections([sec('a', 500), sec('b', 900), sec('c', 400), sec('a', 10)], { contextTokens: 1000, sourceShare: 30 });
    expect(r.sent.map((s) => [s.n, s.section.id])).toEqual([[1, 'a'], [2, 'c']]);
    expect(r.cutIds).toEqual(['b']);
    expect(r.note).toBe('answered from 2 of 3 sections, 1 left out');
  });
  it('keeps the first section cut when nothing fits, and adds the secrets part', () => {
    const r = budgetDocsSections([sec('a', 5000)], { contextTokens: 1000, sourceShare: 30, secretsLeftOut: 1 });
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0].section.text).toHaveLength(1050);
    expect(r.sent[0].section.truncated).toBe(true);
    expect(r.note).toBe('answered from 1 section; 1 section cut short; 1 section left out: looks like it contains a key');
  });
  it('clamps the share', () => {
    expect(budgetDocsSections([sec('a', 10)], { contextTokens: 1000, sourceShare: 500 }).budgetChars).toBe(2800);
  });
});

describe('citations', () => {
  const s = (n: number, relPath: string, heading: string | undefined, text = ''): { n: number; section: AiDocsSection } => ({
    n,
    section: {
      id: heading ? `d/${relPath}#${heading.toLowerCase().replace(/ /g, '-')}` : `d/${relPath}`,
      pageId: `d/${relPath}`,
      title: relPath,
      relPath,
      heading,
      text,
      truncated: false,
    },
  });
  const sources = [s(1, 'security.md', 'Key rotation', 'see https://good.example/doc and ![d](https://good.example/i.png)'), s(2, 'guides/my notes.md', 'Setup (v2)')];
  it('drops unknown numbers and reports no sources', () => {
    const p = parseCitations('Rotate keys [1]. Also [7] and [1, 9].', [1, 2]);
    expect(p.text).toBe('Rotate keys [1]. Also and [1].');
    expect(p.cited).toEqual([1]);
    expect(p.dropped).toEqual([7, 9]);
    expect(parseCitations('nothing [4]', [1]).noSources).toBe(true);
  });
  it('ignores links, code and image-like markers', () => {
    const p = parseCitations('a [1](x) b `[1]` c ![1] d\n```\n[1]\n```\n', [1]);
    expect(p.cited).toEqual([]);
  });
  it('insert: relative links, encoded paths, plain text when not under the root', () => {
    const out = prepareInsertMarkdown('Rotate [1] and set up [2].', sources, { root: 'd', folder: 'guides' });
    expect(out.markdown).toBe('Rotate [Key rotation](../security.md#key-rotation) and set up [Setup (v2)](my%20notes.md#setup-(v2)).');
    expect(prepareInsertMarkdown('See [1].', sources, null).markdown).toBe('See security.md › Key rotation.');
    expect(prepareInsertMarkdown('See [1].', sources, { root: 'other', folder: '' }).markdown).toBe('See security.md › Key rotation.');
  });
  it('sanitizer: links and images become text unless verbatim in a cited section', () => {
    const cited = ['see https://good.example/doc and ![d](https://good.example/i.png)'];
    const run = (x: string) => sanitizeInsertMarkdown(x, cited).markdown;
    expect(run('[a](https://evil.example/x)')).toBe('a');
    expect(run('[a](https://good.example/doc)')).toBe('[a](https://good.example/doc)');
    expect(run('[a](https://good.example/doc?q=secret)')).toBe('a');
    expect(run('![x](https://evil.example/p.png?d=1)')).toBe('x');
    expect(run('![x](https://good.example/i.png)')).toBe('![x](https://good.example/i.png)');
    expect(run('![x](http://good.example/i.png)')).toBe('x');
    expect(run('[a](javascript:alert(1))')).toBe('a');
    expect(run('[a](rel.md "title")')).toBe('a');
    expect(run('[![x](https://evil.example/p.png)](https://evil.example/l)')).toBe('x');
    expect(run('[![x](https://evil.example/p.png)](https://good.example/doc)')).toBe('[x](https://good.example/doc)');
    expect(run('[a][r]\n\n[r]: https://evil.example/x')).toBe('a\n\n');
    expect(run('![a][r]\n\n[r]: https://evil.example/x')).toBe('a\n\n');
    expect(run('see <https://evil.example/x> and https://evil.example/y.')).toBe('see https\\://evil.example/x and https\\://evil.example/y.');
    expect(run('see https://good.example/doc.')).toBe('see https://good.example/doc.');
    expect(run('<img src="https://evil.example/p.png">')).toBe('\\<img src="https\\://evil.example/p.png">');
    expect(run('`[a](https://evil.example/x)`')).toBe('`[a](https://evil.example/x)`');
    expect(run('[1](https://evil.example/x) and [1]')).toBe('[1] and [1]');
  });
});
