// @vitest-environment node
// @mikedown/web-component specifics on top of package-shape.test.ts: side-effect
// entries, the CDN bundle (size budget, no bare imports, pinned CDN URLs) and
// its third-party notices. Run via `npm run test:packages`, which builds first.
import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const dir = join(ROOT, 'packages', 'web-component');
const dist = join(dir, 'dist');
const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
const standalonePath = join(dist, 'mikedown-editor.standalone.js');

/** M0 budget: 850 kB gzipped for the standalone JS, CSS included. */
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
  const js = built ? readFileSync(standalonePath, 'utf8') : '';

  it(`stays under the ${BUDGET / 1024} kB gzipped budget`, () => {
    const gz = gzipSync(readFileSync(standalonePath)).length;
    console.info(`[web-component-shape] dist/mikedown-editor.standalone.js gzipped: ${gz} bytes (${(gz / 1024).toFixed(1)} kB)`);
    expect(gz).toBeLessThan(BUDGET);
  });

  it('imports nothing but the two CDN URLs (loads in a no-build page)', async () => {
    // Re-parse the bundle with esbuild and record every import it makes.
    const seen: string[] = [];
    await build({
      entryPoints: [standalonePath],
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
              seen.push(args.path);
              return { path: args.path, external: true };
            });
          },
        },
      ],
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((s) => !s.startsWith('https://cdn.jsdelivr.net/npm/'))).toEqual([]);
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
    expect(js).toMatch(/customElements\.define\(/);
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
