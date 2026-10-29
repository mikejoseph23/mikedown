// @vitest-environment node
// @mikedown/web-component specifics on top of package-shape.test.ts: side-effect
// entries, the CDN bundle (size budget, no bare imports, pinned CDN URLs) and
// its third-party notices. Run via `npm run test:packages`, which builds first.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const dir = join(ROOT, 'packages', 'web-component');
const dist = join(dir, 'dist');
const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
const standalonePath = join(dist, 'mikedown-editor.standalone.js');

/**
 * Budget: 850 kB gzipped for what a page loads up front (the entry and the
 * chunks it imports statically), CSS included. The AI UI is a lazy chunk
 * outside it (it was 900 kB while AI was in the one file).
 */
const BUDGET = 850 * 1024;

const built = existsSync(join(dist, 'index.js')) && existsSync(standalonePath);
if (!built) {
  console.warn('[web-component-shape] packages/web-component/dist is missing: skipping. Run `npm run test:packages`.');
}
const suite = built ? describe : describe.skip;

const versionOf = (name: string) =>
  JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version as string;

describe('@mikedown/web-component manifest', () => {
  it('lists only the define entry and the CDN bundle as side effects', () => {
    expect(manifest.sideEffects).toEqual(['./dist/define.js', './dist/mikedown-editor.standalone.js']);
  });

  it('exports the element, ./define and ./standalone', () => {
    expect(Object.keys(manifest.exports)).toEqual(expect.arrayContaining(['.', './define', './standalone']));
  });

  it('ships THIRD_PARTY_NOTICES.md', () => {
    expect(manifest.files).toContain('THIRD_PARTY_NOTICES.md');
  });

  it('peers on core only', () => {
    expect(Object.keys(manifest.peerDependencies)).toEqual(['@mikedown/core']);
    expect(manifest.dependencies).toBeUndefined();
  });
});

suite('@mikedown/web-component dist', () => {
  it('index.js keeps @mikedown/core external and has no top-level define', () => {
    const js = readFileSync(join(dist, 'index.js'), 'utf8');
    expect(js).not.toMatch(/customElements\.define\(/);
    const chunks = [...js.matchAll(/from "\.\/(chunk-[\w-]+\.js)"/g)].map((m) => m[1]);
    const all = [js, ...chunks.map((c) => readFileSync(join(dist, c), 'utf8'))].join('\n');
    expect(all).toMatch(/from "@mikedown\/core"/);
    expect(all).not.toMatch(/@tiptap\/|@codemirror\//);
  });

  it('define.js shares the element chunk with index.js (one class)', () => {
    const define = readFileSync(join(dist, 'define.js'), 'utf8');
    const index = readFileSync(join(dist, 'index.js'), 'utf8');
    const chunkOf = (s: string) => /from "\.\/(chunk-[\w-]+\.js)"/.exec(s)?.[1];
    expect(chunkOf(define)).toBeTruthy();
    expect(chunkOf(define)).toBe(chunkOf(index));
    expect(define).toMatch(/defineMikeDownElement\(\)/);
  });

  it('declarations exist for both entries', () => {
    expect(readFileSync(join(dist, 'index.d.ts'), 'utf8')).toMatch(/defineMikeDownElement/);
    expect(existsSync(join(dist, 'define.d.ts'))).toBe(true);
  });
});

suite('@mikedown/web-component standalone bundle', () => {
  /** Every standalone output: the entry and its chunks (`mikedown-editor.*.js`). */
  const files = built ? readdirSync(dist).filter((f) => /^mikedown-editor\..+\.js$/.test(f)) : [];
  const read = (f: string) => readFileSync(join(dist, f), 'utf8');
  const js = files.map(read).join('\n');
  const aiChunk = files.find((f) => f.startsWith('mikedown-editor.ai-ui-'));

  /** Each file's imports, static and dynamic, as written. */
  async function importsOf(file: string): Promise<Array<{ path: string; kind: string }>> {
    const seen: Array<{ path: string; kind: string }> = [];
    await build({
      entryPoints: [join(dist, file)],
      bundle: true,
      write: false,
      format: 'esm',
      logLevel: 'silent',
      plugins: [
        {
          name: 'record',
          setup(b) {
            b.onResolve({ filter: /.*/ }, (args) => {
              if (args.kind === 'entry-point') return undefined;
              seen.push({ path: args.path, kind: args.kind });
              return { path: args.path, external: true };
            });
          },
        },
      ],
    });
    return seen;
  }

  /** The files a page loads up front: the entry and, transitively, its static imports. */
  async function upFront(): Promise<string[]> {
    const out = new Set<string>();
    const queue = ['mikedown-editor.standalone.js'];
    while (queue.length) {
      const f = queue.shift()!;
      if (out.has(f)) continue;
      out.add(f);
      for (const i of await importsOf(f)) {
        if (i.kind === 'import-statement' && i.path.startsWith('./')) queue.push(i.path.slice(2));
      }
    }
    return [...out];
  }

  it(`stays under the ${BUDGET / 1024} kB gzipped budget (entry and its static chunks)`, async () => {
    const gz = (await upFront()).reduce((n, f) => n + gzipSync(readFileSync(join(dist, f))).length, 0);
    console.info(`[web-component-shape] standalone up front gzipped: ${gz} bytes (${(gz / 1024).toFixed(1)} kB)`);
    if (aiChunk) {
      const ai = gzipSync(readFileSync(join(dist, aiChunk))).length;
      console.info(`[web-component-shape] standalone AI chunk gzipped: ${ai} bytes (${(ai / 1024).toFixed(1)} kB)`);
    }
    expect(gz).toBeLessThan(BUDGET);
  });

  it('imports nothing but the two CDN URLs and its own chunks (loads in a no-build page)', async () => {
    const all = (await Promise.all(files.map(importsOf))).flat();
    expect(all.length).toBeGreaterThan(0);
    const foreign = all.filter((i) => !i.path.startsWith('https://cdn.jsdelivr.net/npm/'));
    for (const i of foreign) {
      expect(i.path).toMatch(/^\.\/mikedown-editor\..+\.js$/);
      expect(existsSync(join(dist, i.path)), i.path).toBe(true);
    }
  });

  it('keeps the AI UI out of what loads up front, in one chunk loaded by import()', async () => {
    expect(aiChunk).toBeTruthy();
    const eager = await upFront();
    expect(eager).not.toContain(aiChunk);
    // Strings only the AI UI has: the first-run panel, the AI menu, the engine presets.
    const markers = ['Turn on and set up', 'Manage engines', 'LM Studio'];
    for (const f of eager) {
      for (const m of markers) expect(read(f), `${m} in ${f}`).not.toContain(m);
    }
    for (const m of markers) expect(read(aiChunk!), m).toContain(m);
    const dynamic = (await Promise.all(eager.map(importsOf))).flat().filter((i) => i.kind === 'dynamic-import');
    expect(dynamic.map((i) => i.path)).toContain(`./${aiChunk}`);
  });

  it('loads katex and mermaid from jsDelivr pinned to the installed versions, never @latest', () => {
    const katex = versionOf('katex');
    const mermaid = versionOf('mermaid');
    expect(js).toContain(`import("https://cdn.jsdelivr.net/npm/katex@${katex}/+esm")`);
    expect(js).toContain(`import("https://cdn.jsdelivr.net/npm/mermaid@${mermaid}/dist/mermaid.esm.min.mjs")`);
    expect(js).toContain(`https://cdn.jsdelivr.net/npm/katex@${katex}/dist/katex.min.css`);
    expect(js).not.toContain('@latest');
  });

  it('inlines core styles without the KaTeX @import', () => {
    expect(js).toContain('mikedown-styles');
    expect(js).toContain('.mikedown-root');
    expect(js).not.toMatch(/@import\s*["']katex/);
  });

  it('defines the element on load', () => {
    expect(read('mikedown-editor.standalone.js')).toMatch(/customElements\.define\(/);
    expect(js).toContain('mikedown-editor');
  });

  it('THIRD_PARTY_NOTICES.md covers the bundled peers with license text', () => {
    const notices = readFileSync(join(dir, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    for (const name of ['@tiptap/core', 'prosemirror-model', '@codemirror/view', 'lowlight', 'highlight.js', 'tiptap-markdown', 'markdown-it']) {
      expect(notices, name).toMatch(new RegExp(`^## ${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} \\d`, 'm'));
    }
    expect(notices).toMatch(/Permission is hereby granted/);
    expect(notices).not.toMatch(/^## @mikedown\//m);
  });
});

describe('core list markers survive a CSS reset (Tailwind preflight)', () => {
  const css = readFileSync(join(ROOT, 'packages', 'core', 'src', 'styles', 'editor.css'), 'utf8');

  it('sets list-style-type on editor lists', () => {
    expect(css).toMatch(/\.ProseMirror ul \{ list-style-type: disc; \}/);
    expect(css).toMatch(/\.ProseMirror ol \{ list-style-type: decimal; \}/);
  });
});
