import { describe, expect, it } from 'vitest';
import { createPathOps } from '../../src/host/pathOps';
import { routeLink } from '../../src/host/linkRouting';

const posix = createPathOps('posix');
const DOC = '/Users/mike/notes/todo.md';

describe('routeLink (edge 13)', () => {
  it('sends http(s), mailto and tel to the system browser', () => {
    expect(routeLink('https://example.com/x', DOC, posix)).toEqual({ kind: 'external', url: 'https://example.com/x' });
    expect(routeLink('mailto:a@b.c', DOC, posix)).toEqual({ kind: 'external', url: 'mailto:a@b.c' });
    expect(routeLink('tel:+1555', null, posix)).toEqual({ kind: 'external', url: 'tel:+1555' });
  });

  it('scrolls for in-document anchors', () => {
    expect(routeLink('#setup', DOC, posix)).toEqual({ kind: 'anchor', slug: 'setup' });
    expect(routeLink('#setup', null, posix)).toEqual({ kind: 'anchor', slug: 'setup' });
  });

  it('opens relative markdown links in the window, keeping the anchor', () => {
    expect(routeLink('other.md', DOC, posix)).toEqual({
      kind: 'local', path: '/Users/mike/notes/other.md', fileKind: 'markdown', anchor: null,
    });
    expect(routeLink('../shared/ref.md#intro', DOC, posix)).toEqual({
      kind: 'local', path: '/Users/mike/shared/ref.md', fileKind: 'markdown', anchor: 'intro',
    });
    expect(routeLink('./sub/a%20b.md?x=1', DOC, posix)).toMatchObject({ path: '/Users/mike/notes/sub/a b.md' });
  });

  it('classifies other local targets so the app can pick viewer or OS', () => {
    expect(routeLink('images/shot.png', DOC, posix)).toMatchObject({ kind: 'local', fileKind: 'image' });
    expect(routeLink('notes.txt', DOC, posix)).toMatchObject({ kind: 'local', fileKind: 'text' });
    expect(routeLink('report.pdf', DOC, posix)).toMatchObject({ kind: 'local', fileKind: 'other' });
    expect(routeLink('/abs/path/x.md', null, posix)).toMatchObject({ kind: 'local', path: '/abs/path/x.md' });
  });

  it('accepts file: URLs', () => {
    expect(routeLink('file:///Users/mike/a%20b.md', null, posix)).toMatchObject({ kind: 'local', path: '/Users/mike/a b.md' });
  });

  it('refuses relative links from an unsaved document', () => {
    expect(routeLink('other.md', null, posix)).toMatchObject({ kind: 'unresolvable' });
    expect(routeLink('   ', DOC, posix)).toMatchObject({ kind: 'unresolvable' });
  });

  it('works with Windows paths', () => {
    const win = createPathOps('win32');
    expect(routeLink('sub/other.md', 'C:\\Users\\mike\\notes\\todo.md', win)).toMatchObject({
      kind: 'local', path: 'C:\\Users\\mike\\notes\\sub\\other.md',
    });
  });
});
