// @vitest-environment node
// Home precedence, the link graph and its escapes (decisions 3, 14; S1, S9).
import { describe, expect, it } from 'vitest';
import {
  buildDocsIndex,
  buildDocsMap,
  chooseDocsHomes,
  createDocsLinkResolver,
  docsHasNoHome,
  docsHomeHealth,
  docsLinkList,
  rankDocsWikilinkCandidates,
  renderDocsMap,
} from '@mikedown/core/ai';
import type { AiDocsLink, AiDocsPageInput } from '@mikedown/core/ai';

const page = (root: string, relPath: string, headings: string[] = [], links: AiDocsLink[] = [], title?: string): AiDocsPageInput => ({
  root,
  relPath,
  title,
  headings: headings.map((text) => ({ level: 1, text })),
  links,
  chars: 10,
});
const md = (target: string, text = 't'): AiDocsLink => ({ target, text, kind: 'markdown' });
const wiki = (target: string): AiDocsLink => ({ target, text: target, kind: 'wikilink' });

describe('home precedence per root', () => {
  const homes = (pages: AiDocsPageInput[], homeFile?: string, roots = ['r']) =>
    buildDocsIndex({ baseId: 'b', roots: roots.map((label) => ({ label })), homeFile, pages }).homes;

  it('override beats INDEX.md beats README.md beats the map', () => {
    const pages = [page('r', 'README.md'), page('r', 'INDEX.md'), page('r', 'start.md')];
    expect(homes(pages, 'start.md')[0]).toEqual({ root: 'r', kind: 'override', pageId: 'r/start.md' });
    expect(homes(pages)[0]).toEqual({ root: 'r', kind: 'index', pageId: 'r/INDEX.md' });
    expect(homes([page('r', 'README.md'), page('r', 'a.md')])[0]).toEqual({ root: 'r', kind: 'readme', pageId: 'r/README.md' });
    expect(homes([page('r', 'a.md')])[0]).toEqual({ root: 'r', kind: 'map', pageId: null });
  });

  it('a missing override falls through to INDEX.md, then README.md', () => {
    expect(homes([page('r', 'INDEX.md'), page('r', 'README.md')], 'gone.md')[0].kind).toBe('index');
    expect(homes([page('r', 'README.md')], 'gone.md')[0].kind).toBe('readme');
  });

  it('only the top level counts for INDEX.md and README.md', () => {
    expect(homes([page('r', 'sub/INDEX.md'), page('r', 'sub/README.md')])[0].kind).toBe('map');
  });

  it('matches names ASCII case-insensitively, exact case winning', () => {
    expect(homes([page('r', 'index.md')])[0]).toMatchObject({ kind: 'index', pageId: 'r/index.md' });
    expect(homes([page('r', 'Readme.MD')])[0]).toMatchObject({ kind: 'readme' });
    expect(homes([page('r', 'readme.md'), page('r', 'README.md')])[0].pageId).toBe('r/README.md');
    expect(homes([page('r', 'Start/Home.md')], 'start/home.md')[0]).toMatchObject({ kind: 'override', pageId: 'r/Start/Home.md' });
  });

  it('is decided per root: each root has its own home, the override is looked up in each', () => {
    const pages = [page('a', 'INDEX.md'), page('b', 'README.md'), page('c', 'x.md'), page('c', 'HOME.md'), page('a', 'HOME.md')];
    expect(homes(pages, undefined, ['a', 'b', 'c']).map((h) => [h.root, h.kind])).toEqual([['a', 'index'], ['b', 'readme'], ['c', 'map']]);
    expect(homes(pages, 'HOME.md', ['a', 'b', 'c']).map((h) => [h.root, h.kind, h.pageId])).toEqual([
      ['a', 'override', 'a/HOME.md'],
      ['b', 'readme', 'b/README.md'],
      ['c', 'override', 'c/HOME.md'],
    ]);
  });

  it('a root with no pages at all has a map home, and a README in another root does not leak in', () => {
    const idx = buildDocsIndex({ baseId: 'b', roots: [{ label: 'a' }, { label: 'b' }], pages: [page('a', 'README.md')] });
    expect(idx.homes).toEqual([{ root: 'a', kind: 'readme', pageId: 'a/README.md' }, { root: 'b', kind: 'map', pageId: null }]);
  });

  it('reports the base as having no home only when every root is a map, and health text per root', () => {
    const idx = buildDocsIndex({ baseId: 'b', roots: [{ label: 'a' }, { label: 'b' }], pages: [page('a', 'README.md'), page('b', 'x.md')] });
    expect(docsHasNoHome(idx.homes)).toBe(false);
    expect(idx.homes.map(docsHomeHealth)).toEqual([null, 'No home document']);
    expect(docsHasNoHome(chooseDocsHomes(['a'], [], undefined))).toBe(true);
    expect(docsHasNoHome([])).toBe(false);
  });
});

describe('the map fallback', () => {
  it('is capped at 400 pages by default, keeps the shallowest, lists in path order and counts the rest', () => {
    const pages = [
      ...Array.from({ length: 400 }, (_, i) => page('r', `top/p${String(i).padStart(3, '0')}.md`)),
      ...Array.from({ length: 10 }, (_, i) => page('r', `deep/er/est/x${i}.md`)),
      page('r', 'a/aa.md'),
    ];
    const idx = buildDocsIndex({ baseId: 'b', roots: [{ label: 'r' }], pages });
    const map = buildDocsMap(idx, 'r');
    expect(map.entries).toHaveLength(400);
    expect(map.omitted).toBe(11);
    // depth 3 pages are dropped first; depth 1 pages (all 401) compete only by path.
    expect(map.entries.some((e) => e.pageId.includes('deep/'))).toBe(false);
    const ids = map.entries.map((e) => e.pageId);
    expect(ids).toEqual([...ids].sort());
    expect(renderDocsMap(map).split('\n').pop()).toBe('(11 more pages not listed)');
  });

  it('keeps only level 1 to 3 headings, at most 8 per page, and leaves other roots out', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ level: 2, text: `H${i}` }));
    const idx = buildDocsIndex({
      baseId: 'b',
      roots: [{ label: 'r' }, { label: 's' }],
      pages: [{ root: 'r', relPath: 'a.md', headings: [...many, { level: 4, text: 'Deep' }], chars: 1 }, page('s', 'other.md')],
    });
    const map = buildDocsMap(idx, 'r');
    expect(map.entries).toHaveLength(1);
    expect(map.entries[0].headings).toEqual(many.slice(0, 8).map((h) => h.text));
    expect(map.omitted).toBe(0);
    expect(renderDocsMap(map)).toBe('- r/a.md | H0 | H0; H1; H2; H3; H4; H5; H6; H7');
  });

  it('is deterministic whatever order the host listed the pages in', () => {
    const pages = Array.from({ length: 30 }, (_, i) => page('r', `${i % 3 === 0 ? 'x/' : ''}f${i}.md`));
    const a = renderDocsMap(buildDocsMap(buildDocsIndex({ baseId: 'b', roots: [{ label: 'r' }], pages }), 'r', 10));
    const b = renderDocsMap(buildDocsMap(buildDocsIndex({ baseId: 'b', roots: [{ label: 'r' }], pages: [...pages].reverse() }), 'r', 10));
    expect(a).toBe(b);
  });
});

describe('link graph', () => {
  const links: AiDocsLink[] = [];
  const index = buildDocsIndex({
    baseId: 'b',
    roots: [{ label: 'docs' }, { label: 'more' }],
    pages: [
      page('docs', 'README.md', ['Start'], links),
      page('docs', 'a/one.md', ['Intro', 'Intro']),
      page('docs', 'a/b/two.md'),
      page('docs', 'x/Setup.md'),
      page('docs', 'y/setup.md'),
      page('docs', 'My Notes #1.md'),
      page('docs', 'sub dir/note.md'),
      page('more', 'README.md'),
      page('more', 'Setup.md'),
    ],
  });
  const r = createDocsLinkResolver(index);
  const go = (target: string, from = 'docs/a/one.md', kind: 'markdown' | 'wikilink' = 'markdown') =>
    r.resolve(from, kind === 'wikilink' ? wiki(target) : md(target));

  it('resolves relative links from the linking page folder', () => {
    expect(go('b/two.md')).toMatchObject({ status: 'ok', pageId: 'docs/a/b/two.md' });
    expect(go('./b/two.md')).toMatchObject({ status: 'ok', pageId: 'docs/a/b/two.md' });
    expect(go('../README.md')).toMatchObject({ status: 'ok', pageId: 'docs/README.md' });
    expect(go('b/../b/two.md')).toMatchObject({ status: 'ok', pageId: 'docs/a/b/two.md' });
    expect(go('missing', 'docs/a/b/two.md')).toMatchObject({ status: 'broken', reason: 'not-found' });
    expect(go('b/two')).toMatchObject({ status: 'ok', pageId: 'docs/a/b/two.md' });
    expect(go('b/two.md?plain=1#x')).toMatchObject({ status: 'ok', pageId: 'docs/a/b/two.md', fragmentMissing: true });
  });

  it('resolves files with spaces and # in the name when the link encodes them', () => {
    expect(go('../My%20Notes%20%231.md')).toMatchObject({ status: 'ok', pageId: 'docs/My Notes #1.md' });
    expect(go('../sub%20dir/note.md')).toMatchObject({ status: 'ok', pageId: 'docs/sub dir/note.md' });
    // An unencoded # starts the fragment: the page is My Notes, which is not there.
    expect(go('../My Notes #1.md')).toMatchObject({ status: 'broken', reason: 'not-found' });
  });

  it('a malformed percent escape stays literal and does not throw', () => {
    expect(go('../100%.md')).toMatchObject({ status: 'broken', reason: 'not-found' });
    expect(() => go('%E0%A4%A.md')).not.toThrow();
  });

  it('every way of leaving the root is broken (outside-root), never followable', () => {
    const escapes = [
      '../../x.md',
      '../../../etc/passwd',
      'a/../../x.md',
      '../a/../../x.md',
      './../../x.md',
      '/abs/path.md',
      '/',
      '\\\\server\\share\\x.md',
      'C:\\Users\\x.md',
      'C:/Users/x.md',
      'c:x.md',
      '%2e%2e/%2e%2e/x.md',
      '%2E%2E/%2E%2E/x.md',
      '..%2f..%2fx.md',
      '..%2F..%2Fx.md',
      '%2fetc%2fpasswd',
    ];
    for (const t of escapes) {
      const out = go(t);
      expect(out.status, t).toBe('broken');
      expect(out.pageId, t).toBeUndefined();
    }
    // From the root's top level a single .. already leaves.
    expect(go('../x.md', 'docs/README.md')).toMatchObject({ status: 'broken', reason: 'outside-root' });
  });

  it('file: and other schemes are external, not followed and not counted broken', () => {
    for (const t of ['file:///etc/passwd', 'FILE:///x.md', 'https://x.dev/a.md', 'mailto:a@b.c', 'javascript:alert(1)', 'data:text/plain,hi', 'vscode://file/x', '//cdn.example/x.md']) {
      expect(go(t).status, t).toBe('external');
    }
    // A Windows drive path is not a scheme (one letter) and is outside the root.
    expect(go('D:\\x.md').status).toBe('broken');
  });

  it('a link into a sibling root is broken even when it names a real file', () => {
    expect(go('../../more/README.md')).toMatchObject({ status: 'broken', reason: 'outside-root' });
    expect(go('../more/README.md')).toMatchObject({ status: 'broken' });
  });

  it('a link cannot reach a page of another root by sharing a prefix in the id', () => {
    expect(go('../docs-2/x.md').pageId).toBeUndefined();
    const idx = buildDocsIndex({ baseId: 'b', roots: [{ label: 'docs' }, { label: 'docs-evil' }], pages: [page('docs', 'a.md'), page('docs-evil', 'secret.md')] });
    const out = createDocsLinkResolver(idx).resolve('docs/a.md', md('../docs-evil/secret.md'));
    expect(out).toMatchObject({ status: 'broken', reason: 'outside-root' });
  });

  it('matches fragments to headings, duplicates getting -1', () => {
    expect(go('#intro')).toMatchObject({ status: 'ok', pageId: 'docs/a/one.md', sectionId: 'docs/a/one.md#intro' });
    expect(go('#intro-1')).toMatchObject({ sectionId: 'docs/a/one.md#intro-1' });
    expect(go('#INTRO')).toMatchObject({ sectionId: 'docs/a/one.md#intro' });
    expect(go('#nope')).toMatchObject({ status: 'ok', fragmentMissing: true });
    expect(go('')).toMatchObject({ status: 'ok', pageId: 'docs/a/one.md' });
  });

  it('wikilinks: case-insensitive, extension optional, alias and heading stripped', () => {
    expect(go('ONE', 'docs/README.md', 'wikilink')).toMatchObject({ status: 'ok', pageId: 'docs/a/one.md' });
    expect(go('one.md|Alias', 'docs/README.md', 'wikilink')).toMatchObject({ pageId: 'docs/a/one.md' });
    expect(go('one#Intro', 'docs/README.md', 'wikilink')).toMatchObject({ pageId: 'docs/a/one.md', sectionId: 'docs/a/one.md#intro' });
    expect(go('a/one', 'docs/README.md', 'wikilink')).toMatchObject({ pageId: 'docs/a/one.md' });
    expect(go('b/one', 'docs/README.md', 'wikilink')).toMatchObject({ status: 'broken', reason: 'not-found' });
    expect(go('', 'docs/a/one.md', 'wikilink')).toMatchObject({ status: 'ok', pageId: 'docs/a/one.md' });
  });

  it('wikilinks with duplicates pick the nearest and report how many matched', () => {
    // Wikilinks match anywhere in the base: docs/x/Setup.md, docs/y/setup.md and more/Setup.md.
    const fromX = go('setup', 'docs/x/Setup.md', 'wikilink');
    expect(fromX).toMatchObject({ pageId: 'docs/x/Setup.md', candidates: 3 });
    const fromY = go('setup', 'docs/y/setup.md', 'wikilink');
    expect(fromY).toMatchObject({ pageId: 'docs/y/setup.md', candidates: 3 });
    // From the top: equal distance and equal id length, so code point order decides ('S' < 's').
    const fromTop = go('setup', 'docs/README.md', 'wikilink');
    expect(fromTop).toMatchObject({ pageId: 'docs/x/Setup.md', candidates: 3 });
    // Same answer every time.
    expect(go('setup', 'docs/README.md', 'wikilink')).toEqual(fromTop);
  });

  it('a wikilink prefers its own root and reaches the other root of the base only when nothing nearer exists', () => {
    expect(r.resolve('more/README.md', wiki('setup'))).toMatchObject({ pageId: 'more/Setup.md', candidates: 3 });
    expect(r.resolve('docs/README.md', wiki('setup')).pageId?.startsWith('docs/')).toBe(true);
    expect(r.resolve('docs/README.md', wiki('README'))).toMatchObject({ pageId: 'docs/README.md', candidates: 2 });
  });

  it('ranks wikilink candidates: same folder, then fewest hops, then shorter id, then code point order', () => {
    expect(rankDocsWikilinkCandidates('d/a/x.md', ['d/b/s.md', 'd/a/s.md', 'd/a/b/s.md'])).toEqual(['d/a/s.md', 'd/a/b/s.md', 'd/b/s.md']);
    expect(rankDocsWikilinkCandidates('d/x.md', ['d/zz/s.md', 'd/a/s.md', 'd/aa/s.md'])).toEqual(['d/a/s.md', 'd/aa/s.md', 'd/zz/s.md']);
    const input = ['d/q/s.md', 'd/p/s.md', 'd/r/s.md'];
    expect(rankDocsWikilinkCandidates('d/x.md', input)).toEqual(rankDocsWikilinkCandidates('d/x.md', [...input].reverse()));
  });

  it('a link from a page that is not in the index is broken, not a throw', () => {
    expect(r.resolve('docs/ghost.md', md('a/one.md'))).toMatchObject({ status: 'broken' });
  });
});

describe('links leaving every root are flagged broken in counts and lists', () => {
  const idx = buildDocsIndex({
    baseId: 'b',
    roots: [{ label: 'r' }],
    pages: [
      page('r', 'README.md', [], [md('../x.md'), md('/etc/passwd'), md('a/../../y.md'), md('%2e%2e/z.md'), md('C:\\q.md'), md('missing.md'), md('https://ok.dev'), md('file:///etc/hosts'), md('a.md'), wiki('a'), wiki('nope')]),
      page('r', 'a.md'),
    ],
  });
  it('counts them, lists none of them, and dedupes the two links to the same page', () => {
    const list = docsLinkList(idx, 'r/README.md');
    expect(list.links.map((l) => l.pageId)).toEqual(['r/a.md']);
    expect(list.broken).toBe(7);
    expect(list.omitted).toBe(0);
    expect(createDocsLinkResolver(idx).countBroken()).toBe(7);
    // The list text and targets carry nothing from the escapes.
    expect(JSON.stringify(list.links)).not.toMatch(/passwd|\.\.\//);
  });
  it('an unknown page gives an empty list', () => {
    expect(docsLinkList(idx, 'r/none.md')).toEqual({ links: [], omitted: 0, broken: 0 });
  });
  it('caps the list and counts what did not fit', () => {
    const many = Array.from({ length: 250 }, (_, i) => md(`p${i}.md`));
    const pages = [page('r', 'README.md', [], many), ...many.map((_, i) => page('r', `p${i}.md`))];
    const big = buildDocsIndex({ baseId: 'b', roots: [{ label: 'r' }], pages });
    const list = docsLinkList(big, 'r/README.md');
    expect(list.links).toHaveLength(200);
    expect(list.omitted).toBe(50);
  });
});
