/**
 * Host hardening for documentation bases (S2, S7, S9) on the VS Code host:
 * hostile pages stay near-linear, a file is read through a bounded handle and
 * refused unless it is UTF-8 text, the walk stops at a folder cap and a time
 * budget and says so in health, and the walk yields to the extension host.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCS_MAX_DIRS, DOCS_MAX_FILE_BYTES, DOCS_MAX_LINK_TARGET_CHARS, type AiDocBase } from '@mikedown/core/ai';
import { DocsHost, extractDocsLinks, readBounded, type DocsEntryKind, type DocsFs } from '../../src/ai/docsHost';
import { MIB, expectNearLinear, rep } from '../../packages/core/test/helpers/growth';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const base = (over: Partial<AiDocBase> = {}): AiDocBase => ({ id: 'b1', name: 'Docs', roots: ['/docs'], allowCloud: false, enabled: true, ...over });
const noYield = async (): Promise<void> => {};

/** A fake file system from a map of path to bytes; folders are implied. */
function memFs(files: Record<string, Uint8Array | string>, extra: Partial<DocsFs> = {}): DocsFs {
  const bytes = (v: Uint8Array | string): Uint8Array => (typeof v === 'string' ? enc(v) : v);
  const dirs = new Set<string>(['/docs']);
  for (const f of Object.keys(files)) {
    for (let d = path.posix.dirname(f); d !== '/' && d !== '.'; d = path.posix.dirname(d)) {dirs.add(d);}
  }
  return {
    readDirectory: async (dir) => {
      const out = new Map<string, DocsEntryKind>();
      for (const f of Object.keys(files)) {
        if (f.startsWith(`${dir}/`)) {
          const rest = f.slice(dir.length + 1);
          const slash = rest.indexOf('/');
          out.set(slash < 0 ? rest : rest.slice(0, slash), slash < 0 ? 'file' : 'dir');
        }
      }
      return [...out].map(([name, kind]) => ({ name, kind }));
    },
    stat: async (p) => (dirs.has(p) ? { kind: 'dir', size: 0 } : { kind: 'file', size: bytes(files[p] ?? '').length }),
    readFile: async (p, max) => bytes(files[p]).subarray(0, max),
    realpath: async (p) => p,
    ...extra,
  };
}

function host(files: Record<string, Uint8Array | string>, extra: Partial<ConstructorParameters<typeof DocsHost>[0]> = {}, fsExtra: Partial<DocsFs> = {}): DocsHost {
  return new DocsHost({ fs: memFs(files, fsExtra), readBases: () => [base()], yieldToHost: noYield, ...extra });
}

describe('extractDocsLinks stays near-linear on 1 MiB of one line (S9)', () => {
  const inputs: Array<[string, (u: number) => string]> = [
    ['an opening link then a million blanks', (u) => `[a](${' '.repeat(Math.round(MIB * u))}x`],
    ['blank runs after many openings', (u) => rep('[a](' + ' '.repeat(40) + 'x ', MIB, u)],
    ['brackets', (u) => rep('[', MIB, u)],
    ['link openings', (u) => rep('[a](', MIB, u)],
    ['unclosed angle destinations', (u) => rep('[a](<', MIB, u)],
    ['unclosed titles', (u) => rep('[a](x "', MIB, u)],
    ['unclosed single-quote titles', (u) => rep("[a](x '", MIB, u)],
    ['images', (u) => rep('![a](<', MIB, u)],
    ['wikilink openings', (u) => rep('[[a', MIB, u)],
    ['text then a long destination', (u) => `[a](${'d'.repeat(Math.round(MIB * u))})`],
    ['backticks', (u) => rep('`[a](b)', MIB, u)],
    ['many short lines', (u) => rep('[a](b)\n', MIB, u)],
  ];
  for (const [name, make] of inputs) {
    it(name, async () => {
      await expectNearLinear(name, make, (md) => extractDocsLinks(md));
    }, 300_000);
  }

  it('keeps the first 1000 links of 150,000', () => {
    expect(extractDocsLinks(rep('[a](b.md) ', MIB, 1))).toHaveLength(1000);
  });
});

describe('the bounded read (F9)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mikedown-docs-lim-')));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('reads at most the bytes asked for, however big the file is', async () => {
    const file = path.join(tmp, 'big.md');
    fs.writeFileSync(file, 'x'.repeat(5000));
    expect((await readBounded(file, 100)).length).toBe(100);
    expect((await readBounded(file, 6000)).length).toBe(5000);
    fs.writeFileSync(file, '');
    expect((await readBounded(file, 10)).length).toBe(0);
  });

  it('asks the file system for the size cap plus one byte, so a file that grew after stat is still bounded', async () => {
    const readFile = vi.fn(async (_p: string, max: number) => new Uint8Array(max).fill(120));
    const h = host({ '/docs/a.md': '# a\n' }, {}, { readFile });
    const index = await h.index('b1');
    expect(readFile).toHaveBeenCalledWith('/docs/a.md', DOCS_MAX_FILE_BYTES + 1);
    // The fake returned cap + 1 bytes for a file stat said was 4: it is over the cap.
    expect(index.pages).toEqual([]);
    expect(index.oversizeSkipped).toBe(1);
  });
});

describe('files that are not UTF-8 text (F7)', () => {
  const utf16le = (s: string): Uint8Array => Uint8Array.from([0xff, 0xfe, ...[...s].flatMap((c) => [c.charCodeAt(0), 0])]);
  const key = 'AKIAIOSFODNN7EXAMPLE';

  it('skips a UTF-16, UTF-32 or NUL file in the walk, counts it, and keeps indexing', async () => {
    const h = host({
      '/docs/ok.md': '# Ok\n',
      '/docs/bom.md': Uint8Array.from([0xef, 0xbb, 0xbf, ...enc('# With a UTF-8 mark\n')]),
      '/docs/u16.md': utf16le(`# Keys\n${key}\n`),
      '/docs/u16be.md': Uint8Array.from([0xfe, 0xff, 0, 0x23, 0, 0x20, 0, 0x61]),
      '/docs/u32.md': Uint8Array.from([0, 0, 0xfe, 0xff, 0, 0, 0, 0x23]),
      '/docs/nul.md': Uint8Array.from([...enc('# a'), 0, ...enc('b\n')]),
    });
    const index = await h.index('b1');
    expect(index.pages.map((p) => p.id)).toEqual(['docs/bom.md', 'docs/ok.md']);
    expect(index.pages.find((p) => p.id === 'docs/bom.md')?.title).toBe('With a UTF-8 mark');
    const [status] = await h.listBases();
    expect(status.notTextSkipped).toBe(4);
    expect(status.roots[0].notTextSkipped).toBe(4);
    expect(status.fileCount).toBe(2);
  });

  it('refuses the same file at the read, with the reason', async () => {
    let swapped = false;
    const files: Record<string, Uint8Array | string> = { '/docs/a.md': '# A\nbody\n' };
    const h = host(files, {}, {
      readFile: async (p, max) => (swapped ? utf16le(`# A\n${key}\n`) : enc(files[p] as string)).subarray(0, max),
    });
    await h.index('b1');
    swapped = true;
    const out = await h.readSectionsDetailed('b1', ['docs/a.md#a']);
    expect(out.sections).toEqual([]);
    expect(out.refused).toEqual([{ id: 'docs/a.md#a', reason: 'not UTF-8 text' }]);
  });
});

describe('what the index keeps of a hostile page (F9)', () => {
  it('cuts heading text to 200 code points and a link target to 500', async () => {
    const h = host({ '/docs/a.md': `# ${'h'.repeat(900)}\n[a](${'t'.repeat(900)}) [[${'w'.repeat(250)}]]\n` });
    const page = (await h.index('b1')).pages[0];
    expect(page.headings[0].text).toHaveLength(200);
    expect(page.headings[0].slug).toBe('h'.repeat(200));
    expect(page.links.map((l) => l.target.length)).toEqual([DOCS_MAX_LINK_TARGET_CHARS, 250]);
  });

  it('reads a section by the id of a clipped heading', async () => {
    const h = host({ '/docs/a.md': `# ${'h'.repeat(900)}\nbody text\n` });
    const [page] = (await h.index('b1')).pages;
    const out = await h.readSections('b1', [page.headings[0].id]);
    expect(out[0].text).toContain('body text');
  });

  it('indexes 1000 headings of a page with 100,000 and reads a late section from the last one', async () => {
    const text = rep('# s\n', MIB, 1);
    const h = host({ '/docs/a.md': text });
    const [page] = (await h.index('b1')).pages;
    expect(page.headings).toHaveLength(1000);
    const [section] = await h.readSections('b1', [page.headings[999].id]);
    expect(section.truncated).toBe(true);
  });
});

describe('the folder cap, the time budget and yielding (S9)', () => {
  it('stops at the folder cap and says so', async () => {
    // Three levels of 30 folders each: 1 + 30 + 900 + 27,000 folders, more than the cap.
    const reads = vi.fn();
    const treeFs: DocsFs = {
      readDirectory: async (dir) => {
        reads();
        const depth = dir.split('/').length - 2;
        return depth >= 3 ? [] : Array.from({ length: 30 }, (_, i) => ({ name: `d${i}`, kind: 'dir' as const }));
      },
      stat: async () => ({ kind: 'dir', size: 0 }),
      readFile: async () => new Uint8Array(),
      realpath: async (p) => p,
    };
    const h = new DocsHost({ fs: treeFs, readBases: () => [base()], yieldToHost: noYield });
    const [status] = await h.listBases();
    expect(reads).toHaveBeenCalledTimes(DOCS_MAX_DIRS);
    expect(status.dirCapReached).toBe(true);
    expect(status.roots[0].dirCapReached).toBe(true);
    expect(status.active).toBe(true);
  }, 60_000);

  it('ends the build at the time budget and says so, keeping what it read', async () => {
    let clock = 0;
    const files: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {files[`/docs/f${String(i).padStart(3, '0')}.md`] = `# F${i}\n[x](f${i}.md)\n`;}
    // Each read takes 10 ms of the fake clock; the budget is 200 ms.
    const h = host(files, { now: () => clock, buildBudgetMs: 200 }, { readFile: async (p, max) => { clock += 10; return enc(files[p]).subarray(0, max); } });
    const index = await h.index('b1');
    expect(index.pages.length).toBeGreaterThan(0);
    expect(index.pages.length).toBeLessThan(100);
    const [status] = await h.listBases();
    expect(status.timedOut).toBe(true);
    expect(status.brokenLinks).toBeUndefined();
    expect(status.active).toBe(true);
  });

  it('does not report a timeout for a build that finishes in budget', async () => {
    const h = host({ '/docs/a.md': '# A\n[b](gone.md)\n' });
    const [status] = await h.listBases();
    expect(status.timedOut).toBeUndefined();
    expect(status.brokenLinks).toBe(1);
  });

  it('yields to the host between batches of files, between folders and while counting links', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 80; i++) {files[`/docs/d${i % 4}/f${i}.md`] = `# F${i}\n[x](f${i}.md)\n`;}
    const yieldToHost = vi.fn(async () => {});
    const h = host(files, { yieldToHost });
    await h.listBases();
    // 80 files in batches of 16 is at least 5 yields; counting 80 pages adds more.
    expect(yieldToHost.mock.calls.length).toBeGreaterThanOrEqual(8);
  });

  it('a chat reading a hostile base never blocks for longer than one batch: the work between yields is bounded by the batch size', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 200; i++) {files[`/docs/f${i}.md`] = `# F${i}\n`;}
    let running = 0;
    let maxRunning = 0;
    const readFile = async (p: string, max: number): Promise<Uint8Array> => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await Promise.resolve();
      running--;
      return enc(files[p]).subarray(0, max);
    };
    const h = host(files, {}, { readFile });
    await h.index('b1');
    expect(maxRunning).toBeLessThanOrEqual(16);
  });
});
