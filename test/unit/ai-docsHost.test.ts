/**
 * host.docs for VS Code (src/ai/docsHost.ts) against a real temp folder, so
 * symlinks, canonical paths and sizes are the file system's own: the walker's
 * skips, readSections' containment (S1, S2, S3, S12), the index and keyword
 * search, watchers per root (S9), and the bases a webview saves. M7 writes the
 * thorough suite; these are the cases the host must not regress.
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
  readFile: (p) => fs.promises.readFile(p, 'utf8'),
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
