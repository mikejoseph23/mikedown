/**
 * host.docs for VS Code (src/ai/docsHost.ts) against a real temp folder, so
 * symlinks, canonical paths and sizes are the file system's own: the walker's
 * skips, readSections' containment (S1, S2, S3, S12), the index and keyword
 * search, watchers per root (S9), and the bases a webview saves. Cross-host
 * contracts (titles, links, keyword ranking on files) run the shared fixtures
 * in test/ai-fixtures/docs/; Desktop runs the same ones in Rust.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCS_MAX_FILES, parseAiSettings, type AiDocBase } from '@mikedown/core/ai';
import {
  DocsHost,
  extractDocsLinks,
  frontmatterTitle,
  isDocsBaseFile,
  isPathUnderRoot,
  prepareBasesForSave,
  type DocsEntryKind,
  type DocsFs,
} from '../../src/ai/docsHost';

function kindOfStats(s: fs.Stats): DocsEntryKind {
  if (s.isSymbolicLink()) {return 'symlink';}
  if (s.isDirectory()) {return 'dir';}
  if (s.isFile()) {return 'file';}
  return 'other';
}

/** Node's fs shaped like the extension's `DocsFs` (links report as `symlink`, like `vscode.FileType` with the bit tested first). */
const realFs: DocsFs = {
  readDirectory: async (dir) => (await fs.promises.readdir(dir, { withFileTypes: true })).map((d) => ({ name: d.name, kind: d.isSymbolicLink() ? 'symlink' : d.isDirectory() ? 'dir' : d.isFile() ? 'file' : 'other' })),
  stat: async (p) => {
    const l = await fs.promises.lstat(p);
    return { kind: kindOfStats(l), size: l.size };
  },
  // The extension decodes with a default TextDecoder (BOM stripped, bad bytes replaced), so does the test.
  readFile: async (p) => new TextDecoder('utf-8').decode(await fs.promises.readFile(p)),
  realpath: (p) => fs.promises.realpath(p),
};

let tmp: string;
let docs: string;
let outside: string;

function write(rel: string, text: string, base = docs): void {
  const p = path.join(base, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

function base(over: Partial<AiDocBase> = {}): AiDocBase {
  return { id: 'b1', name: 'Docs', roots: [docs], allowCloud: false, enabled: true, ...over };
}

function host(bases: () => AiDocBase[], extra: Partial<ConstructorParameters<typeof DocsHost>[0]> = {}): DocsHost {
  return new DocsHost({ fs: realFs, readBases: bases, ...extra });
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mikedown-docs-')));
  docs = path.join(tmp, 'docs');
  outside = path.join(tmp, 'outside');
  fs.mkdirSync(docs);
  fs.mkdirSync(outside);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('the walker (S3)', () => {
  it('indexes markdown in any case and skips node_modules, hidden folders, symlinks and other files', async () => {
    write('README.md', '# Home\n');
    write('guide/Setup.MD', '# Setup\n');
    write('guide/notes.markdown', '# Notes\n');
    write('guide/readme.txt', 'no');
    write('node_modules/pkg/x.md', '# no\n');
    write('.hidden/secret.md', '# no\n');
    write('real/inside.md', '# Inside\n');
    write('secret.md', '# Outside secret\n', outside);
    fs.symlinkSync(outside, path.join(docs, 'linkdir'), 'dir');
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(docs, 'linkfile.md'));
    const h = host(() => [base()]);
    const ids = (await h.index('b1')).pages.map((p) => p.id);
    expect(ids).toEqual(['docs/README.md', 'docs/guide/Setup.MD', 'docs/guide/notes.markdown', 'docs/real/inside.md']);
  });

  it('stops at the file cap and reports it, per root and in the base', async () => {
    const entries = Array.from({ length: DOCS_MAX_FILES + 50 }, (_, i) => ({ name: `f${String(i).padStart(5, '0')}.md`, kind: 'file' as DocsEntryKind }));
    const memFs: DocsFs = {
      readDirectory: async () => entries,
      stat: async (p) => (p === '/big' ? { kind: 'dir', size: 0 } : { kind: 'file', size: 4 }),
      readFile: async () => '# t\n',
      realpath: async (p) => p,
    };
    const h = new DocsHost({ fs: memFs, readBases: () => [base({ roots: ['/big'] })] });
    const index = await h.index('b1');
    expect(index.pages).toHaveLength(DOCS_MAX_FILES);
    expect(index.truncated).toBe(true);
    const [status] = await h.listBases();
    expect(status.capReached).toBe(true);
    expect(status.roots[0].capReached).toBe(true);
    expect(status.fileCount).toBe(DOCS_MAX_FILES);
  });

  it('skips a file over 1 MiB, counts it, and does not read it', async () => {
    write('ok.md', '# ok\n');
    write('big.md', '# big\n' + 'x'.repeat(1024 * 1024));
    const readFile = vi.fn(realFs.readFile);
    const h = host(() => [base()], { fs: { ...realFs, readFile } });
    const index = await h.index('b1');
    expect(index.pages.map((p) => p.id)).toEqual(['docs/ok.md']);
    expect(index.oversizeSkipped).toBe(1);
    expect(readFile).toHaveBeenCalledTimes(1);
    expect((await h.listBases())[0]).toMatchObject({ oversizeSkipped: 1, fileCount: 1 });
  });

  it('builds titles, headings and links, and counts broken links', async () => {
    write('a.md', '---\ntitle: "Alpha"\n---\n# Heading\nSee [b](b.md#two) and [gone](missing.md).\n');
    write('b.md', '# B\n## Two\n');
    const h = host(() => [base()]);
    const index = await h.index('b1');
    const a = index.pages.find((p) => p.id === 'docs/a.md');
    expect(a?.title).toBe('Alpha');
    expect(a?.headings.map((x) => x.id)).toEqual(['docs/a.md#heading']);
    expect(a?.links.map((l) => l.target)).toEqual(['b.md#two', 'missing.md']);
    expect((await h.listBases())[0].brokenLinks).toBe(1);
  });
});

describe('readSections (S1, S2, S12)', () => {
  beforeEach(() => {
    write('guide.md', '# Guide\nintro\n## Key rotation\nrotate keys\n## Other\nmore\n');
  });

  it('returns a section by id, the whole page by page id, in the order asked', async () => {
    const h = host(() => [base()]);
    const sections = await h.readSections('b1', ['docs/guide.md#other', 'docs/guide.md']);
    expect(sections.map((s) => s.id)).toEqual(['docs/guide.md#other', 'docs/guide.md']);
    expect(sections[0]).toMatchObject({ pageId: 'docs/guide.md', heading: 'Other', relPath: 'guide.md', truncated: false });
    expect(sections[0].text).toBe('## Other\nmore\n');
    expect(sections[1].heading).toBeUndefined();
    expect(sections[1].text).toContain('rotate keys');
  });

  it('leaves out ids the index does not know, with a reason, and never builds a path from id text', async () => {
    write('secret.md', '# Secret\n', outside);
    const readFile = vi.fn(realFs.readFile);
    const realpath = vi.fn(realFs.realpath);
    const h = host(() => [base()], { fs: { ...realFs, readFile, realpath } });
    await h.index('b1');
    realpath.mockClear();
    readFile.mockClear();
    const ids = ['docs/../../outside/secret.md', '../outside/secret.md', '/etc/passwd', `${outside}/secret.md`, 'docs/guide.md#nope', 'docs/nope.md', '', 'docs/guide.md#'];
    const { sections, refused } = await h.readSectionsDetailed('b1', ids);
    expect(sections).toEqual([]);
    expect(refused.length).toBe(ids.length - 1); // the empty id is dropped before lookup
    expect(readFile.mock.calls.every(([p]) => p.startsWith(docs))).toBe(true);
    expect(realpath.mock.calls.every(([p]) => !p.includes('outside'))).toBe(true);
  });

  it('refuses a file swapped for a symlink to outside the root after it was indexed', async () => {
    write('secret.md', '# Secret\ntop secret\n', outside);
    const h = host(() => [base()]);
    await h.index('b1');
    fs.rmSync(path.join(docs, 'guide.md'));
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(docs, 'guide.md'));
    const { sections, refused } = await h.readSectionsDetailed('b1', ['docs/guide.md']);
    expect(sections).toEqual([]);
    expect(refused).toEqual([{ id: 'docs/guide.md', reason: 'outside the root' }]);
  });

  it('refuses a file that grew past 1 MiB, and a folder swapped in for the file', async () => {
    const h = host(() => [base()]);
    await h.index('b1');
    write('guide.md', '# Guide\n' + 'x'.repeat(1024 * 1024));
    expect((await h.readSectionsDetailed('b1', ['docs/guide.md'])).refused[0].reason).toBe('file is over the size limit');
    fs.rmSync(path.join(docs, 'guide.md'));
    fs.mkdirSync(path.join(docs, 'guide.md'));
    expect((await h.readSectionsDetailed('b1', ['docs/guide.md'])).refused[0].reason).toBe('not a regular file');
  });

  it('caps a long section and marks it truncated', async () => {
    write('long.md', '# Long\n' + 'word '.repeat(10000));
    const h = host(() => [base()]);
    const [s] = await h.readSections('b1', ['docs/long.md#long']);
    expect(s.truncated).toBe(true);
    expect(Buffer.byteLength(s.text)).toBeLessThanOrEqual(24 * 1024);
  });

  it('refuses unknown and disabled bases, and a base whose roots are missing', async () => {
    const h = host(() => [base(), base({ id: 'off', roots: [docs], enabled: false }), base({ id: 'gone', roots: [path.join(tmp, 'nope')] })]);
    await expect(h.readSections('nope', ['docs/guide.md'])).rejects.toThrow(/Unknown/);
    await expect(h.readSections('off', ['docs/guide.md'])).rejects.toThrow(/turned off/);
    await expect(h.index('gone')).rejects.toThrow(/Root not found/);
    await expect(h.keywordSearch('off', 'guide')).rejects.toThrow(/turned off/);
  });

  it('takes the root from the configuration on every call, so a removed base cannot be read', async () => {
    let bases = [base()];
    const h = host(() => bases);
    expect(await h.readSections('b1', ['docs/guide.md'])).toHaveLength(1);
    bases = [];
    await expect(h.readSections('b1', ['docs/guide.md'])).rejects.toThrow(/Unknown/);
  });
});

describe('health', () => {
  it('reports a missing root as not found, never removes it, and recovers when it appears', async () => {
    write('a.md', '# A\n');
    const missing = path.join(tmp, 'later');
    const h = host(() => [base({ roots: [docs, missing] })]);
    let [status] = await h.listBases();
    expect(status).toMatchObject({ active: true, rootsMissing: 1, fileCount: 1 });
    expect(status.roots.map((r) => r.found)).toEqual([true, false]);
    expect(status.roots[0].home).toBe('map');
    fs.mkdirSync(missing);
    write('b.md', '# B\n', missing);
    [status] = await h.listBases();
    expect(status).toMatchObject({ active: true, rootsMissing: 0, fileCount: 2 });
    expect(status.roots.map((r) => r.label)).toEqual(['docs', 'later']);
  });

  it('is inactive with no readable root, and does not walk a disabled base', async () => {
    const readDirectory = vi.fn(realFs.readDirectory);
    const h = host(() => [base({ roots: [path.join(tmp, 'nope')] }), base({ id: 'off', enabled: false })], { fs: { ...realFs, readDirectory } });
    const [gone, off] = await h.listBases();
    expect(gone).toMatchObject({ active: false, rootsMissing: 1 });
    expect(off).toMatchObject({ active: false, fileCount: 0 });
    expect(readDirectory).not.toHaveBeenCalled();
  });

  it('picks the home by precedence and reports its path', async () => {
    write('README.md', '# R\n');
    write('INDEX.md', '# I\n');
    const h = host(() => [base()]);
    expect((await h.listBases())[0].roots[0]).toMatchObject({ home: 'index', homePath: 'INDEX.md' });
  });
});

describe('keyword search', () => {
  it('ranks sections through the shared ranking and reads through the same checks', async () => {
    write('keys.md', '# Keys\nintro\n## Key rotation\nrotate the signing key every ninety days\n');
    write('other.md', '# Other\nnothing about it\n');
    write('secret.md', '# Secret\nrotation rotation\n', outside);
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(docs, 'leak.md'));
    const h = host(() => [base()]);
    const refs = await h.keywordSearch('b1', 'key rotation');
    expect(refs.map((r) => r.id)).toEqual(['docs/keys.md#key-rotation', 'docs/keys.md#keys']);
    expect(refs[0]).toMatchObject({ pageId: 'docs/keys.md', title: 'Keys', relPath: 'keys.md', heading: 'Key rotation' });
    expect(await h.keywordSearch('b1', '   ')).toEqual([]);
  });

  it('skips a page that fails the containment check at search time', async () => {
    write('a.md', '# A\nneedle\n');
    write('secret.md', '# S\nneedle needle needle\n', outside);
    const h = host(() => [base()]);
    await h.index('b1');
    fs.rmSync(path.join(docs, 'a.md'));
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(docs, 'a.md'));
    expect(await h.keywordSearch('b1', 'needle')).toEqual([]);
  });
});

describe('index lifetime and watchers (S9)', () => {
  it('watches each found root once, marks the index stale on a change, and walks again', async () => {
    write('a.md', '# A\n');
    const second = path.join(tmp, 'second');
    fs.mkdirSync(second);
    write('s.md', '# S\n', second);
    const callbacks: Array<() => void> = [];
    const disposed: string[] = [];
    const createWatcher = vi.fn((root: string, onChange: () => void) => {
      callbacks.push(onChange);
      return { dispose: () => { disposed.push(root); } };
    });
    const h = host(() => [base({ roots: [docs, second, path.join(tmp, 'missing')] })], { createWatcher });
    const changed = vi.fn();
    h.watch('b1', changed);
    await h.index('b1');
    expect(createWatcher.mock.calls.map((c) => c[0])).toEqual([docs, second]);
    expect(h.watcherCount()).toBe(2);

    write('b.md', '# B\n');
    expect((await h.index('b1')).pages.map((p) => p.id)).not.toContain('docs/b.md'); // cached until something says otherwise
    callbacks[0]();
    expect(changed).toHaveBeenCalledTimes(1);
    expect((await h.index('b1')).pages.map((p) => p.id)).toContain('docs/b.md');
    expect(createWatcher).toHaveBeenCalledTimes(2); // same roots: the watchers stay
  });

  it('walks again after the TTL', async () => {
    write('a.md', '# A\n');
    let now = 1000;
    const h = host(() => [base()], { now: () => now, ttlMs: 60_000 });
    await h.index('b1');
    write('b.md', '# B\n');
    now += 59_000;
    expect((await h.index('b1')).pages).toHaveLength(1);
    now += 2_000;
    expect((await h.index('b1')).pages).toHaveLength(2);
  });

  it('disposes the watchers when a base is removed, turned off or re-pointed, and on dispose', async () => {
    write('a.md', '# A\n');
    const live = new Set<string>();
    let n = 0;
    const createWatcher = (root: string): { dispose(): void } => {
      const id = `${root}#${n++}`;
      live.add(id);
      return { dispose: () => { live.delete(id); } };
    };
    let bases = [base()];
    const h = host(() => bases, { createWatcher });
    await h.index('b1');
    expect(live.size).toBe(1);
    bases = [base({ enabled: false })];
    h.reconcile();
    expect(live.size).toBe(0);
    bases = [base()];
    await h.index('b1');
    expect(live.size).toBe(1);
    bases = [];
    await h.listBases();
    expect(live.size).toBe(0);
    bases = [base()];
    await h.index('b1');
    expect(live.size).toBe(1);
    h.dispose();
    expect(live.size).toBe(0);
    await expect(h.index('b1')).rejects.toThrow();
  });
});

describe('isPathUnderRoot', () => {
  it('compares whole components, never prefixes', () => {
    expect(isPathUnderRoot('/docs', '/docs/a.md', 'linux')).toBe(true);
    expect(isPathUnderRoot('/docs', '/docs-evil/a.md', 'linux')).toBe(false);
    expect(isPathUnderRoot('/docs', '/docs', 'linux')).toBe(false);
    expect(isPathUnderRoot('/docs/a', '/docs/a/b/c.md', 'linux')).toBe(true);
    expect(isPathUnderRoot('/docs', '/Docs/a.md', 'linux')).toBe(false);
  });

  it('is case-insensitive on Windows only, and honours the drive', () => {
    expect(isPathUnderRoot('C:\\Docs', 'c:\\docs\\a.md', 'win32')).toBe(true);
    expect(isPathUnderRoot('C:\\Docs', 'C:\\Docs-evil\\a.md', 'win32')).toBe(false);
    expect(isPathUnderRoot('C:\\Docs', 'D:\\Docs\\a.md', 'win32')).toBe(false);
  });
});

describe('extraction helpers', () => {
  it('reads a frontmatter title, quoted or not', () => {
    expect(frontmatterTitle('---\ntitle: Plain title\n---\n# H\n')).toBe('Plain title');
    expect(frontmatterTitle("---\ntitle: 'Quoted'\n---\n")).toBe('Quoted');
    expect(frontmatterTitle('# No frontmatter\ntitle: not this\n')).toBeUndefined();
    expect(frontmatterTitle('---\ntags: [a]\n---\n')).toBeUndefined();
  });

  it('extracts links and wikilinks, not images, code or frontmatter', () => {
    const md = [
      '---',
      'link: [fm](fm.md)',
      '---',
      'See [one](one.md#a "T"), [two](<two words.md>) and [[Three#Part|alias]].',
      'An image ![alt](img.png) and ![[pic.png]] are not links.',
      'Inline `[code](x.md)` is skipped.',
      '```',
      '[fenced](f.md)',
      '```',
      '[ext](https://example.com/a_(b))',
    ].join('\n');
    expect(extractDocsLinks(md)).toEqual([
      { target: 'one.md#a', text: 'one', kind: 'markdown' },
      { target: 'two words.md', text: 'two', kind: 'markdown' },
      { target: 'Three#Part|alias', text: 'alias', kind: 'wikilink' },
    ]);
  });
});

describe('review fix 1: the read must be the file the walker listed', () => {
  beforeEach(() => {
    write('page.md', '# Page\nreal text\n');
    write('other.md', '# Other\nother text\n');
  });

  it('refuses a file swapped for a symlink that stays inside the root', async () => {
    const h = host(() => [base()]);
    await h.index('b1');
    fs.rmSync(path.join(docs, 'page.md'));
    fs.symlinkSync(path.join(docs, 'other.md'), path.join(docs, 'page.md'));
    const { sections, refused } = await h.readSectionsDetailed('b1', ['docs/page.md', 'docs/other.md']);
    expect(refused).toEqual([{ id: 'docs/page.md', reason: 'not the file that was indexed' }]);
    expect(sections.map((x) => x.id)).toEqual(['docs/other.md']);
    expect((await h.keywordSearch('b1', 'other')).map((r) => r.pageId)).toEqual(['docs/other.md']);
  });

  it('refuses a file whose parent folder was swapped for a symlink to another folder in the root', async () => {
    write('sub/page.md', '# Sub\nreal\n');
    write('sub2/page.md', '# Sub\nimpostor\n');
    const h = host(() => [base()]);
    await h.index('b1');
    expect((await h.readSections('b1', ['docs/sub/page.md']))[0].text).toContain('real');
    fs.rmSync(path.join(docs, 'sub'), { recursive: true });
    fs.symlinkSync(path.join(docs, 'sub2'), path.join(docs, 'sub'), 'dir');
    const { sections, refused } = await h.readSectionsDetailed('b1', ['docs/sub/page.md']);
    expect(sections).toEqual([]);
    expect(refused).toEqual([{ id: 'docs/sub/page.md', reason: 'not the file that was indexed' }]);
  });

  it('refuses a parent folder swapped for a symlink that leaves the root', async () => {
    write('sub/page.md', '# Sub\nreal\n');
    write('page.md', '# Sub\nleaked\n', outside);
    const h = host(() => [base()]);
    await h.index('b1');
    fs.rmSync(path.join(docs, 'sub'), { recursive: true });
    fs.symlinkSync(outside, path.join(docs, 'sub'), 'dir');
    expect((await h.readSectionsDetailed('b1', ['docs/sub/page.md'])).refused[0].reason).toBe('outside the root');
  });

  it('still reads the file when nothing was swapped, through a root that is itself a link', async () => {
    const viaLink = path.join(tmp, 'link-to-docs');
    fs.symlinkSync(docs, viaLink, 'dir');
    const h = host(() => [base({ roots: [viaLink] })]);
    const index = await h.index('b1');
    expect(index.pages.map((p) => p.id)).toEqual(['link-to-docs/other.md', 'link-to-docs/page.md']);
    expect((await h.readSections('b1', ['link-to-docs/page.md']))[0].text).toContain('real text');
  });

  it('compares case-insensitively on Windows only', async () => {
    // A fake Windows file system: the canonical path comes back in another case than the one joined.
    const memFs: DocsFs = {
      readDirectory: async () => [{ name: 'Page.md', kind: 'file' }],
      stat: async (p) => (p.toLowerCase() === 'c:\\docs' ? { kind: 'dir', size: 0 } : { kind: 'file', size: 4 }),
      readFile: async () => '# T\n',
      realpath: async (p) => (p.toLowerCase().endsWith('page.md') ? 'C:\\DOCS\\page.md' : p),
    };
    const win = new DocsHost({ fs: memFs, readBases: () => [base({ roots: ['C:\\Docs'] })], platform: 'win32' });
    expect(await win.readSections('b1', ['Docs/Page.md'])).toHaveLength(1);
  });
});

describe('more refusals (the M7 list)', () => {
  beforeEach(() => {
    write('guide.md', '# Guide\nneedle text\n');
  });

  it('refuses a .txt the path resolves to (fake file system, so the extension check is the one that fires)', async () => {
    const swapped: DocsFs = { ...realFs, realpath: async (p) => (p.endsWith('guide.md') ? p.replace(/guide\.md$/, 'guide.txt') : realFs.realpath(p)) };
    const h = host(() => [base()], { fs: swapped });
    await h.index('b1');
    const { sections, refused } = await h.readSectionsDetailed('b1', ['docs/guide.md']);
    expect(sections).toEqual([]);
    expect(refused).toEqual([{ id: 'docs/guide.md', reason: 'not a markdown file' }]);
  });

  it('refuses a 2 MiB file that grew after indexing', async () => {
    const h = host(() => [base()]);
    await h.index('b1');
    write('guide.md', '# Guide\n' + 'x'.repeat(2 * 1024 * 1024));
    expect((await h.readSectionsDetailed('b1', ['docs/guide.md'])).refused).toEqual([{ id: 'docs/guide.md', reason: 'file is over the size limit' }]);
    expect(await h.keywordSearch('b1', 'needle')).toEqual([]);
  });

  it('refuses a 2 MiB file by its text even when stat says it is small', async () => {
    const lying: DocsFs = { ...realFs, stat: async (p) => ({ ...(await realFs.stat(p)), size: p.endsWith('guide.md') ? 10 : 0 }) };
    const h = host(() => [base()], { fs: lying });
    await h.index('b1');
    write('guide.md', '# Guide\n' + 'x'.repeat(2 * 1024 * 1024));
    expect((await h.readSectionsDetailed('b1', ['docs/guide.md'])).refused).toEqual([{ id: 'docs/guide.md', reason: 'file is over the size limit' }]);
  });

  it('a sibling folder that shares the root\'s name as a prefix is not inside it', async () => {
    const evil = path.join(tmp, 'docs-evil');
    fs.mkdirSync(evil);
    write('x.md', '# Evil\nhunter2\n', evil);
    const h = host(() => [base()]);
    await h.index('b1');
    fs.rmSync(path.join(docs, 'guide.md'));
    fs.symlinkSync(path.join(evil, 'x.md'), path.join(docs, 'guide.md'));
    expect((await h.readSectionsDetailed('b1', ['docs/guide.md'])).refused).toEqual([{ id: 'docs/guide.md', reason: 'outside the root' }]);
  });

  it('accepts a markdown extension in any case and lists no .md.txt, .mdx or .txt', async () => {
    write('Upper.MD', '# Upper\n');
    write('Mixed.Markdown', '# Mixed\n');
    write('a.md.txt', '# no\n');
    write('b.mdx', '# no\n');
    write('c.txt', 'no');
    const h = host(() => [base()]);
    expect((await h.index('b1')).pages.map((p) => p.relPath)).toEqual(['Mixed.Markdown', 'Upper.MD', 'guide.md']);
    expect(await h.readSections('b1', ['docs/Upper.MD', 'docs/Mixed.Markdown'])).toHaveLength(2);
  });

  it('refuses a base id that is not in the configuration, whatever else it looks like', async () => {
    const h = host(() => [base()]);
    for (const id of ['', 'nope', docs, '../b1', 'B1', 'b1 ']) {
      await expect(h.index(id)).rejects.toThrow(/Unknown/);
      await expect(h.readSections(id, ['docs/guide.md'])).rejects.toThrow(/Unknown/);
      await expect(h.keywordSearch(id, 'needle')).rejects.toThrow(/Unknown/);
    }
    await expect(h.readSections(undefined as unknown as string, [])).rejects.toThrow(/Unknown/);
  });

  it('a file deleted since indexing is a refusal for that id, not a crash for the request', async () => {
    write('kept.md', '# Kept\nneedle\n');
    const h = host(() => [base()]);
    await h.index('b1');
    fs.rmSync(path.join(docs, 'guide.md'));
    const { sections, refused } = await h.readSectionsDetailed('b1', ['docs/guide.md', 'docs/kept.md']);
    expect(refused).toEqual([{ id: 'docs/guide.md', reason: 'file not found' }]);
    expect(sections.map((x) => x.id)).toEqual(['docs/kept.md']);
    expect((await h.keywordSearch('b1', 'needle')).map((r) => r.pageId)).toEqual(['docs/kept.md']);
    fs.rmSync(docs, { recursive: true });
    expect(await h.readSections('b1', ['docs/kept.md'])).toEqual([]);
    expect(await h.keywordSearch('b1', 'needle')).toEqual([]);
  });

  it('a file that is not UTF-8 is read with replacement characters and does not fail the others', async () => {
    fs.writeFileSync(path.join(docs, 'bad.md'), Buffer.concat([Buffer.from('# Bad\nneedle '), Buffer.from([0xff, 0xfe, 0xc3]), Buffer.from(' end\n')]));
    const h = host(() => [base()]);
    const sections = await h.readSections('b1', ['docs/bad.md', 'docs/guide.md']);
    expect(sections.map((x) => x.id)).toEqual(['docs/bad.md', 'docs/guide.md']);
    expect(sections[0].text).toContain('\ufffd');
    expect(await h.keywordSearch('b1', 'needle')).toHaveLength(2);
  });

  it('a read that throws for one file leaves that id out and serves the rest', async () => {
    write('boom.md', '# Boom\nneedle\n');
    let failing = false;
    const flaky: DocsFs = { ...realFs, readFile: async (p) => { if (failing && p.endsWith('boom.md')) {throw new Error('EIO');} return realFs.readFile(p); } };
    const h = host(() => [base()], { fs: flaky });
    await h.index('b1');
    failing = true;
    const { sections, refused } = await h.readSectionsDetailed('b1', ['docs/boom.md', 'docs/guide.md']);
    expect(refused).toEqual([{ id: 'docs/boom.md', reason: 'could not be read' }]);
    expect(sections.map((x) => x.id)).toEqual(['docs/guide.md']);
    expect((await h.keywordSearch('b1', 'needle')).map((r) => r.pageId)).toEqual(['docs/guide.md']);
  });

  it('a bad UTF-8 or unreadable file at index time does not stop the walk', async () => {
    write('boom.md', '# Boom\n');
    const flaky: DocsFs = { ...realFs, readFile: async (p) => { if (p.endsWith('boom.md')) {throw new Error('EIO');} return realFs.readFile(p); } };
    const h = host(() => [base()], { fs: flaky });
    expect((await h.index('b1')).pages.map((p) => p.id)).toEqual(['docs/guide.md']);
  });
});

describe('walker details (S3)', () => {
  it('lists a symlinked folder and file as neither folder nor file, even with the bit set on a directory', async () => {
    // What `docsVsCode.ts#entryKind` produces for `vscode.FileType.Directory | SymbolicLink`.
    const memFs: DocsFs = {
      readDirectory: async (d) => (d === '/r' ? [{ name: 'real', kind: 'dir' }, { name: 'linkdir', kind: 'symlink' }, { name: 'link.md', kind: 'symlink' }, { name: 'a.md', kind: 'file' }] : d === '/r/real' ? [{ name: 'b.md', kind: 'file' }] : (() => { throw new Error(`walked into ${d}`); })()),
      stat: async (p) => (p === '/r' ? { kind: 'dir', size: 0 } : { kind: 'file', size: 4 }),
      readFile: async () => '# t\n',
      realpath: async (p) => p,
    };
    const h = new DocsHost({ fs: memFs, readBases: () => [base({ roots: ['/r'] })] });
    expect((await h.index('b1')).pages.map((p) => p.id)).toEqual(['r/a.md', 'r/real/b.md']);
  });

  it('the vscode.FileType bitmask: Directory | SymbolicLink is a symlink, tested with &', async () => {
    vi.resetModules();
    vi.doMock('vscode', () => ({ FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 }, Uri: { file: (p: string) => ({ fsPath: p }) }, workspace: {}, window: {} }));
    const { entryKind } = await import('../../src/ai/docsVsCode');
    expect(entryKind(1)).toBe('file');
    expect(entryKind(2)).toBe('dir');
    expect(entryKind(2 | 64)).toBe('symlink');
    expect(entryKind(1 | 64)).toBe('symlink');
    expect(entryKind(64)).toBe('symlink');
    expect(entryKind(0)).toBe('other');
    vi.doUnmock('vscode');
  });

  it('skips node_modules and hidden folders at any depth, but lists a hidden file', async () => {
    write('a/node_modules/x.md', '# no\n');
    write('a/.cache/y.md', '# no\n');
    write('a/b/.hidden.md', '# yes\n');
    const h = host(() => [base()]);
    expect((await h.index('b1')).pages.map((p) => p.relPath)).toEqual(['a/b/.hidden.md']);
  });

  it('shares the file cap across roots and reports it on the root that ran out', async () => {
    const files = Array.from({ length: DOCS_MAX_FILES - 2 }, (_, i) => ({ name: `f${i}.md`, kind: 'file' as DocsEntryKind }));
    const memFs: DocsFs = {
      readDirectory: async () => files,
      stat: async (p) => (p === '/one' || p === '/two' ? { kind: 'dir', size: 0 } : { kind: 'file', size: 4 }),
      readFile: async () => '# t\n',
      realpath: async (p) => p,
    };
    const h = new DocsHost({ fs: memFs, readBases: () => [base({ roots: ['/one', '/two'] })] });
    const [status] = await h.listBases();
    expect(status.roots.map((r) => r.capReached)).toEqual([false, true]);
    expect(status.roots.map((r) => r.fileCount)).toEqual([DOCS_MAX_FILES - 2, 2]);
    expect(status.capReached).toBe(true);
    expect((await h.index('b1')).truncated).toBe(true);
  });
});

describe('ids and labels over every configured root (review fix 3)', () => {
  it('a missing first root does not shift the other roots\' ids', async () => {
    const first = path.join(tmp, 'a', 'docs');
    const second = path.join(tmp, 'b', 'docs');
    write('two.md', '# Two\n', second);
    const h = host(() => [base({ roots: [first, second] })]);
    expect((await h.index('b1')).pages.map((p) => p.id)).toEqual(['docs-2/two.md']);
    expect((await h.readSections('b1', ['docs-2/two.md'])).map((x) => x.id)).toEqual(['docs-2/two.md']);
    write('one.md', '# One\n', first);
    await h.listBases({ refresh: true });
    expect((await h.index('b1')).pages.map((p) => p.id)).toEqual(['docs/one.md', 'docs-2/two.md']);
  });
});

describe('broken links in health (review fix 2)', () => {
  it('counts on the walk, keeps the count on a plain cached call without walking, and recounts on refresh', async () => {
    write('a.md', '# A\n[gone](gone.md) [ok](b.md)\n');
    write('b.md', '# B\n');
    const readDirectory = vi.fn(realFs.readDirectory);
    const h = host(() => [base()], { fs: { ...realFs, readDirectory } });
    expect((await h.listBases())[0].brokenLinks).toBe(1);
    const walks = readDirectory.mock.calls.length;
    write('b.md', '# B\n[also gone](nope.md)\n');
    expect((await h.listBases())[0].brokenLinks).toBe(1);
    expect(readDirectory).toHaveBeenCalledTimes(walks);
    expect((await h.listBases({ refresh: true }))[0].brokenLinks).toBe(2);
  });

  it('is undefined for a disabled base and for a base with no readable root', async () => {
    write('a.md', '# A\n[gone](gone.md)\n');
    const h = host(() => [base({ id: 'off', enabled: false }), base({ id: 'gone', roots: [path.join(tmp, 'nope')] }), base()]);
    const list = await h.listBases();
    expect(list.map((s) => [s.base.id, s.brokenLinks])).toEqual([['off', undefined], ['gone', undefined], ['b1', 1]]);
  });
});

describe('plain and refreshed listBases (decisions 12 and 14, A4)', () => {
  it('a plain call after an index exists walks nothing; refresh walks again and picks up a file added since', async () => {
    write('a.md', '# A\n');
    const readDirectory = vi.fn(realFs.readDirectory);
    const h = host(() => [base()], { fs: { ...realFs, readDirectory } });
    expect((await h.listBases())[0].fileCount).toBe(1);
    const walked = readDirectory.mock.calls.length;
    expect(walked).toBeGreaterThan(0);
    for (let i = 0; i < 3; i += 1) {await h.listBases();}
    expect(readDirectory).toHaveBeenCalledTimes(walked);
    write('b.md', '# B\n');
    expect((await h.listBases())[0].fileCount).toBe(1);
    expect(readDirectory).toHaveBeenCalledTimes(walked);
    expect((await h.listBases({ refresh: true }))[0].fileCount).toBe(2);
    expect(readDirectory.mock.calls.length).toBeGreaterThan(walked);
  });

  it('allowCloud, enabled and a rename are read afresh on a plain call, with no walk', async () => {
    write('a.md', '# A\n');
    const readDirectory = vi.fn(realFs.readDirectory);
    let current = base();
    const h = host(() => [current], { fs: { ...realFs, readDirectory } });
    expect((await h.listBases())[0].base.allowCloud).toBe(false);
    const walked = readDirectory.mock.calls.length;

    current = base({ allowCloud: true });
    expect((await h.listBases())[0].base.allowCloud).toBe(true);
    current = base({ allowCloud: true, name: 'Renamed' });
    expect((await h.listBases())[0].base.name).toBe('Renamed');
    expect(readDirectory).toHaveBeenCalledTimes(walked);

    current = base({ allowCloud: true, name: 'Renamed', enabled: false });
    expect(await h.listBases()).toMatchObject([{ active: false, base: { enabled: false } }]);
    expect(readDirectory).toHaveBeenCalledTimes(walked);
  });
});

describe('keyword search over files: the shared fixture', () => {
  it('keyword-files.json gives the same ids and scores, in the same order', async () => {
    const f = JSON.parse(fs.readFileSync(path.join(__dirname, '../ai-fixtures/docs/keyword-files.json'), 'utf8')) as {
      rootName: string;
      files: Record<string, string>;
      queries: Array<{ query: string; expected: Array<{ id: string; score: number }> }>;
    };
    const root = path.join(tmp, f.rootName);
    for (const [rel, text] of Object.entries(f.files)) {write(rel, text, root);}
    const h = host(() => [base({ roots: [root] })]);
    expect(f.queries.length).toBeGreaterThan(10);
    for (const q of f.queries) {
      const got = (await h.keywordSearch('b1', q.query)).map((r) => ({ id: r.id, score: r.score }));
      expect(got, `query ${JSON.stringify(q.query)}`).toEqual(q.expected);
    }
  });
});

describe('shared fixtures: titles and links (cross-host contract)', () => {
  const fixture = (name: string): { cases: Array<Record<string, unknown>> } => JSON.parse(fs.readFileSync(path.join(__dirname, '../ai-fixtures/docs', name), 'utf8'));

  it('titles.json', () => {
    const cases = fixture('titles.json').cases;
    expect(cases.length).toBeGreaterThan(10);
    for (const c of cases) {
      expect(frontmatterTitle(c.markdown as string), c.name as string).toBe((c.title as string | null) ?? undefined);
    }
  });

  it('links.json', () => {
    const cases = fixture('links.json').cases;
    expect(cases.length).toBeGreaterThan(10);
    for (const c of cases) {
      expect(extractDocsLinks(c.markdown as string), c.name as string).toEqual(c.links);
    }
  });
});

describe('prepareBasesForSave (A2)', () => {
  const current = [base()];

  it('validates like settings: bad roots dropped, ids made, unknown input refused', () => {
    const { bases, warnings } = prepareBasesForSave(current, [{ name: 'New', roots: ['/a/b', 'relative/path', '/a/b'], allowCloud: 'yes' }]);
    expect(bases).toHaveLength(1);
    expect(bases[0]).toMatchObject({ name: 'New', roots: ['/a/b'], allowCloud: false, enabled: true });
    expect(bases[0].id).toBeTruthy();
    expect(warnings.length).toBeGreaterThan(0);
    expect(() => prepareBasesForSave(current, 'nope')).toThrow(/list/);
    expect(() => prepareBasesForSave(current, Array.from({ length: 101 }, () => ({})))).toThrow(/At most/);
  });

  it('refuses to replace valid bases with nothing valid, but allows an empty list', () => {
    expect(() => prepareBasesForSave(current, [{ name: 'bad', roots: ['relative'] }])).toThrow(/nothing was saved/);
    expect(prepareBasesForSave(current, []).bases).toEqual([]);
  });

  it('writes through writeBases only, validated, and refuses without it', async () => {
    const writeBases = vi.fn(async () => {});
    const h = new DocsHost({ fs: realFs, readBases: () => current, writeBases });
    await h.saveBases([{ id: 'x', name: 'X', roots: ['/x/y'] }]);
    expect(writeBases).toHaveBeenCalledWith([{ id: 'x', name: 'X', roots: ['/x/y'], allowCloud: false, enabled: true }]);
    await expect(new DocsHost({ fs: realFs, readBases: () => current }).saveBases([])).rejects.toThrow(/not available/);
  });

  it('parseAiSettings agrees on what a valid base is', () => {
    const settings = parseAiSettings({ docBases: [{ id: 'x', name: 'X', roots: ['/x/y'] }] }, { onWarning: () => {} });
    expect(settings.docBases.map((b) => b.roots)).toEqual([['/x/y']]);
  });
});

describe('isDocsBaseFile (which file: links a chat chip may open)', () => {
  const base = (roots: string[], over: Partial<AiDocBase> = {}): AiDocBase => ({ id: 'b', name: 'B', roots, allowCloud: false, enabled: true, ...over });
  const docs = [base(['/kb/docs'])];

  it('opens a markdown file under a root, and nothing else', () => {
    expect(isDocsBaseFile('/kb/docs/a.md', docs, 'linux')).toBe(true);
    expect(isDocsBaseFile('/kb/docs/deep/er/a.markdown', docs, 'linux')).toBe(true);
    expect(isDocsBaseFile('/kb/docs/A.MD', docs, 'linux')).toBe(true);
    expect(isDocsBaseFile('/kb/docs/sub dir/a b.md', docs, 'linux')).toBe(true);
  });

  it('refuses a non-markdown file, however it is named', () => {
    for (const name of ['/kb/docs/a.txt', '/kb/docs/a.md.exe', '/kb/docs/a.mdx', '/kb/docs/a.sh', '/kb/docs/md', '/kb/docs/.md.bak']) {
      expect(isDocsBaseFile(name, docs, 'linux'), name).toBe(false);
    }
  });

  it('refuses the root itself and a sibling that shares its prefix', () => {
    expect(isDocsBaseFile('/kb/docs', docs, 'linux')).toBe(false);
    expect(isDocsBaseFile('/kb/docs.md', docs, 'linux')).toBe(false);
    expect(isDocsBaseFile('/kb/docs-evil/a.md', docs, 'linux')).toBe(false);
    expect(isDocsBaseFile('/kb/docsevil/a.md', docs, 'linux')).toBe(false);
    expect(isDocsBaseFile('/kb/doc/a.md', docs, 'linux')).toBe(false);
    expect(isDocsBaseFile('/kb/a.md', docs, 'linux')).toBe(false);
  });

  it('judges a ../ path by where it lands', () => {
    expect(isDocsBaseFile('/kb/docs/../secret/a.md', docs, 'linux')).toBe(false);
    expect(isDocsBaseFile('/kb/docs/../../etc/a.md', docs, 'linux')).toBe(false);
    expect(isDocsBaseFile('/kb/docs/x/../../docs-evil/a.md', docs, 'linux')).toBe(false);
    expect(isDocsBaseFile('/kb/docs/x/../a.md', docs, 'linux')).toBe(true);
    expect(isDocsBaseFile('/kb/docs//a.md', docs, 'linux')).toBe(true);
    expect(isDocsBaseFile('/kb/docs/./a.md', docs, 'linux')).toBe(true);
  });

  it('a root that is not in the configuration opens nothing', () => {
    expect(isDocsBaseFile('/other/a.md', docs, 'linux')).toBe(false);
    expect(isDocsBaseFile('/kb/docs/a.md', [], 'linux')).toBe(false);
    expect(isDocsBaseFile('/kb/docs/a.md', [base([])], 'linux')).toBe(false);
  });

  it('any root of any base in the configuration counts', () => {
    const many = [base(['/a', '/b/c'], { id: 'one' }), base(['/d'], { id: 'two' })];
    expect(isDocsBaseFile('/b/c/x.md', many, 'linux')).toBe(true);
    expect(isDocsBaseFile('/d/x.md', many, 'linux')).toBe(true);
    expect(isDocsBaseFile('/b/x.md', many, 'linux')).toBe(false);
  });

  it('is case-sensitive on POSIX and case-insensitive on Windows only', () => {
    expect(isDocsBaseFile('/kb/Docs/a.md', docs, 'linux')).toBe(false);
    expect(isDocsBaseFile('/kb/Docs/a.md', docs, 'darwin')).toBe(false);
    const win = [base(['C:\\KB\\Docs'])];
    expect(isDocsBaseFile('c:\\kb\\docs\\A.md', win, 'win32')).toBe(true);
    expect(isDocsBaseFile('C:\\KB\\Docs-evil\\a.md', win, 'win32')).toBe(false);
    expect(isDocsBaseFile('D:\\KB\\Docs\\a.md', win, 'win32')).toBe(false);
    expect(isDocsBaseFile('C:\\KB\\Docs\\..\\Secret\\a.md', win, 'win32')).toBe(false);
    expect(isDocsBaseFile('C:/KB/Docs/sub/a.md', win, 'win32')).toBe(true);
    expect(isDocsBaseFile('C:\\KB\\Docs\\a.txt', win, 'win32')).toBe(false);
  });

  it('a UNC root keeps its server and share', () => {
    const unc = [base(['\\\\srv\\share\\docs'])];
    expect(isDocsBaseFile('\\\\srv\\share\\docs\\a.md', unc, 'win32')).toBe(true);
    expect(isDocsBaseFile('\\\\other\\share\\docs\\a.md', unc, 'win32')).toBe(false);
    expect(isDocsBaseFile('\\\\srv\\share2\\docs\\a.md', unc, 'win32')).toBe(false);
  });

  it('a bad URL, an empty path or a relative one opens nothing', () => {
    for (const bad of ['', '.', 'a.md', 'docs/a.md', '../kb/docs/a.md', '\0', '%2e%2e/a.md', 'file:///kb/docs/a.md', '/']) {
      expect(isDocsBaseFile(bad, docs, 'linux'), bad).toBe(false);
    }
    expect(isDocsBaseFile(undefined as unknown as string, docs, 'linux')).toBe(false);
    expect(isDocsBaseFile(null as unknown as string, docs, 'linux')).toBe(false);
  });

  it('the filesystem root is never a base in practice, and a root with only a drive is not special-cased here', () => {
    // parseAiSettings refuses "/" as a root, so no configured base holds it.
    expect(parseAiSettings({ docBases: [{ id: 'x', name: 'X', roots: ['/'] }] }, { onWarning: () => {} }).docBases).toEqual([]);
  });
});
