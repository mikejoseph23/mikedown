import { describe, expect, it, vi } from 'vitest';
import { createPathOps } from '../../src/host/pathOps';
import {
  createMdIndex,
  extractHeadings,
  matchTarget,
  rankCandidates,
  resolveTargets,
  wikilinkFilePath,
} from '../../src/tree/mdIndex';

const posix = createPathOps('posix');
const win = createPathOps('win32');

const FILES = [
  '/n/Note.md',
  '/n/sub/Note.md',
  '/n/sub/deeper/Note.markdown',
  '/n/projects/Plan.md',
  '/n/archive/2025/Plan.md',
  '/n/Unique Name.md',
];

describe('headings', () => {
  it('reads ATX headings outside code fences, with GitHub duplicate suffixes', () => {
    const md = '# Title\n\ntext\n\n## Setup ##\n```\n# not a heading\n```\n## Setup\n~~~\n## nope\n~~~\n### Café & Co\n';
    expect(extractHeadings(md)).toEqual([
      { text: 'Title', level: 1, slug: 'title' },
      { text: 'Setup', level: 2, slug: 'setup' },
      { text: 'Setup', level: 2, slug: 'setup-1' },
      { text: 'Café & Co', level: 3, slug: 'caf--co' },
    ]);
  });
});

describe('wikilink resolution', () => {
  it('ranks the same folder first, then fewest hops, then the shorter path', () => {
    const notes = FILES.filter((f) => /Note\.(md|markdown)$/.test(f));
    expect(rankCandidates(notes, '/n/sub', posix)[0]).toBe('/n/sub/Note.md');
    expect(rankCandidates(notes, '/n', posix)[0]).toBe('/n/Note.md');
    expect(rankCandidates(notes, '/n/sub/deeper', posix)[0]).toBe('/n/sub/deeper/Note.markdown');
    expect(rankCandidates(notes, '/n/projects', posix)[0]).toBe('/n/Note.md');
  });

  it('matches names case-insensitively, with or without the extension, and by path suffix', () => {
    expect(matchTarget('note', FILES, '/n', posix)).toHaveLength(3);
    expect(matchTarget('Note.md', FILES, '/n', posix)).toHaveLength(3);
    expect(matchTarget('sub/Note', FILES, '/n', posix)).toEqual(['/n/sub/Note.md']);
    expect(matchTarget('2025/plan', FILES, '/n', posix)).toEqual(['/n/archive/2025/Plan.md']);
    expect(matchTarget('Missing', FILES, '/n', posix)).toEqual([]);
    expect(matchTarget('  ', FILES, '/n', posix)).toEqual([]);
  });

  it('returns the nearest href and a count for ambiguity', () => {
    const res = resolveTargets(['Note', 'Plan', 'Unique Name', 'Nope'], FILES, '/n', '/n/projects/today.md', posix);
    expect(res).toEqual([
      { target: 'Note', href: '../Note.md', count: 3 },
      { target: 'Plan', href: './Plan.md', count: 2 },
      { target: 'Unique Name', href: '../Unique%20Name.md', count: 1 },
      { target: 'Nope', href: null, count: 0 },
    ]);
  });

  it('works with Windows paths', () => {
    const files = ['C:\\n\\Note.md', 'C:\\n\\sub\\note.md'];
    expect(resolveTargets(['NOTE'], files, 'C:\\n', 'C:\\n\\sub\\x.md', win)).toEqual([{ target: 'NOTE', href: './note.md', count: 2 }]);
  });

  it('creates new notes next to the current document and refuses escapes', () => {
    expect(wikilinkFilePath('Fresh Idea', '/n/sub/a.md', posix)).toEqual({ path: '/n/sub/Fresh Idea.md', heading: 'Fresh Idea' });
    expect(wikilinkFilePath('ideas/Fresh.md', '/n/a.md', posix)).toEqual({ path: '/n/ideas/Fresh.md', heading: 'Fresh' });
    expect(wikilinkFilePath('../out', '/n/a.md', posix)).toHaveProperty('error');
    expect(wikilinkFilePath('/etc/passwd', '/n/a.md', posix)).toHaveProperty('error');
    expect(wikilinkFilePath('', '/n/a.md', posix)).toHaveProperty('error');
  });
});

describe('the index', () => {
  function setup(files: Record<string, string>) {
    let clock = 0;
    const disk = { ...files };
    const listMarkdown = vi.fn(async () => Object.keys(disk).filter((f) => /\.(md|markdown)$/i.test(f)));
    const index = createMdIndex('/n', {
      path: posix,
      listMarkdown,
      readText: async (p) => {
        if (!(p in disk)) {throw new Error(`ENOENT ${p}`);}
        return { text: disk[p] };
      },
      exists: async (p) => p in disk || Object.keys(disk).some((f) => f.startsWith(`${p}/`)),
      createFile: async (p, content) => {
        if (p in disk) {throw new Error('exists');}
        disk[p] = content;
      },
      now: () => clock,
      ttlMs: 1000,
    });
    return { index, disk, listMarkdown, tick: (ms: number) => { clock += ms; } };
  }

  it('lists files lazily, caches them, and re-reads after invalidate or the TTL', async () => {
    const { index, disk, listMarkdown, tick } = setup({ '/n/a.md': '# A\n' });
    expect(listMarkdown).not.toHaveBeenCalled();
    expect(await index.files()).toEqual(['/n/a.md']);
    await index.files();
    expect(listMarkdown).toHaveBeenCalledTimes(1);
    disk['/n/b.md'] = '';
    index.invalidate();
    expect(await index.files()).toEqual(['/n/a.md', '/n/b.md']);
    tick(1500);
    await index.files();
    expect(listMarkdown).toHaveBeenCalledTimes(3);
  });

  it('suggests other files relative to the document plus its own headings', async () => {
    const { index } = setup({ '/n/a.md': '', '/n/sub/b.md': '' });
    const list = await index.linkSuggestions('/n/a.md', '# Top\n## Part two\n');
    expect(list).toEqual([
      { label: 'b.md', href: './sub/b.md', type: 'file' },
      { label: 'Top', href: '#top', type: 'anchor', level: 1 },
      { label: 'Part two', href: '#part-two', type: 'anchor', level: 2 },
    ]);
  });

  it('reads another file’s headings for file.md# completion', async () => {
    const { index } = setup({ '/n/a.md': '', '/n/sub/My Note.md': '# One\n## Two\n' });
    const heads = await index.fileHeadings('/n/a.md', 'sub/My%20Note.md');
    expect(heads.map((h) => h.href)).toEqual(['#one', '#two']);
    expect(await index.fileHeadings('/n/a.md', 'missing.md')).toEqual([]);
  });

  it('flags broken anchors, missing files and missing anchors in other files', async () => {
    const { index } = setup({ '/n/a.md': '', '/n/b.md': '# Exists\n<a id="custom"></a>\n' });
    const doc = '# Here\n';
    const broken = await index.checkLinks('/n/a.md', doc, [
      { href: '#here', type: 'anchor' },
      { href: '#gone', type: 'anchor' },
      { href: 'b.md', type: 'file' },
      { href: './missing.md', type: 'file' },
      { href: 'b.md#exists', type: 'fileAnchor' },
      { href: 'b.md#custom', type: 'fileAnchor' },
      { href: 'b.md#nope', type: 'fileAnchor' },
    ]);
    expect(broken).toEqual(['#gone', './missing.md', 'b.md#nope']);
  });

  it('createWikilink writes a heading, does not overwrite, and invalidates the list', async () => {
    const { index, disk, listMarkdown } = setup({ '/n/sub/a.md': '' });
    await index.files();
    const res = await index.createWikilink('/n/sub/a.md', 'New Idea');
    expect(res).toEqual({ path: '/n/sub/New Idea.md', created: true, resolution: { target: 'New Idea', href: './New%20Idea.md', count: 1 } });
    expect(disk['/n/sub/New Idea.md']).toBe('# New Idea\n');
    const again = await index.createWikilink('/n/sub/a.md', 'New Idea');
    expect(again.created).toBe(false);
    await index.files();
    expect(listMarkdown).toHaveBeenCalledTimes(2);
    await expect(index.createWikilink(null, 'X')).rejects.toThrow(/Save the document/);
    await expect(index.createWikilink('/n/a.md', '../../etc')).rejects.toThrow(/Cannot create/);
  });

  it('[[Note Name]] resolves against the folder after a file appears', async () => {
    const { index, disk } = setup({ '/n/a.md': '' });
    expect(await index.resolveWikilinks('/n/a.md', ['Note Name'])).toEqual([{ target: 'Note Name', href: null, count: 0 }]);
    disk['/n/notes/Note Name.md'] = '';
    index.invalidate();
    expect(await index.resolveWikilinks('/n/a.md', ['Note Name'])).toEqual([{ target: 'Note Name', href: './notes/Note%20Name.md', count: 1 }]);
  });
});
