// @vitest-environment node
// Shape checks on the built @mikedown/core package. Requires `dist/` (run via
// `npm run test:core-package`, which builds first). Skips when dist is missing.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(pkgDir, 'dist');
const built = existsSync(join(dist, 'index.js')) && existsSync(join(dist, 'styles.css'));
if (!built) {
  console.warn('[package-shape] packages/core/dist is missing: skipping. Run `npm run test:core-package`.');
}
const suite = built ? describe : describe.skip;

const read = (f: string) => readFileSync(join(dist, f), 'utf8');

suite('@mikedown/core dist shape', () => {
  it('index.js is ESM with no VS Code leakage', () => {
    const js = read('index.js');
    expect(js).not.toMatch(/\brequire\(/);
    expect(js).not.toContain('acquireVsCodeApi');
    expect(js).not.toContain('--vscode-');
    expect(js).toMatch(/^export \{|\nexport \{/);
  });

  it('mermaid and katex are lazy (dynamic import only)', () => {
    const js = read('index.js');
    expect(js).toMatch(/import\(["']mermaid["']\)/);
    expect(js).toMatch(/import\(["']katex["']\)/);
    expect(js).not.toMatch(/^import .* from ["'](mermaid|katex)["']/m);
    expect(js).not.toMatch(/^import ["'](mermaid|katex)["']/m);
  });

  it('index.js gzipped stays under the 400 KB budget', () => {
    const gz = gzipSync(readFileSync(join(dist, 'index.js'))).length;
    console.info(`[package-shape] dist/index.js gzipped: ${gz} bytes (${(gz / 1024).toFixed(1)} KB)`);
    expect(gz).toBeLessThan(400 * 1024);
  });

  it('styles.css has no --vscode- and every selector is scoped', () => {
    const css = read('styles.css');
    expect(css).not.toContain('--vscode-');
    const root = postcss.parse(css);
    const unscoped: string[] = [];
    root.walkRules((rule) => {
      const parent = rule.parent;
      if (parent && parent.type === 'atrule' && /keyframes$/i.test((parent as postcss.AtRule).name)) return;
      // Theme token blocks are zero-specificity `:where(...)` custom property
      // declarations (no styling), so they are allowed unscoped.
      const decls = rule.nodes.filter((n) => n.type !== 'comment');
      const tokenOnly =
        decls.length > 0 &&
        decls.every((n) => n.type === 'decl' && (n.prop.startsWith('--') || n.prop === 'color-scheme'));
      for (const sel of rule.selectors) {
        if (tokenOnly && /^:where\(/.test(sel)) continue;
        // .mikedown-portal is the root of floating UI mounted outside .mikedown-root.
        if (!/\.mikedown-root\b/.test(sel) && !/\.mikedown-portal\b/.test(sel)) unscoped.push(sel);
      }
    });
    expect(unscoped).toEqual([]);
  });

  it('tokens.css has no --vscode-', () => {
    expect(read('tokens.css')).not.toContain('--vscode-');
  });

  it('index.d.ts exports the public API', () => {
    const dts = read('index.d.ts');
    expect(dts).toMatch(/declare function createMikeDownEditor\(/);
    expect(dts).toMatch(/interface MikeDownHost\b/);
    expect(dts).toMatch(/interface MikeDownEditorHandle\b/);
    const exportLines = dts.split('\n').filter((l) => /^export\s*(type\s*)?\{/.test(l)).join('\n');
    expect(exportLines).toMatch(/\bcreateMikeDownEditor\b/);
    expect(exportLines).toMatch(/\bMikeDownHost\b/);
    expect(exportLines).toMatch(/\bMikeDownEditorHandle\b/);
  });

  it('declarations reference no mermaid, katex or nspell types', () => {
    const dtsFiles = readdirSync(dist).filter((f) => f.endsWith('.d.ts'));
    expect(dtsFiles.length).toBeGreaterThan(0);
    for (const f of dtsFiles) {
      const src = read(f);
      expect(src).not.toMatch(/(from|import\()\s*["'](mermaid|katex|nspell)/);
      expect(src).not.toMatch(/\/\/\/\s*<reference[^>]*(mermaid|katex|nspell)/);
    }
  });
});

suite('@mikedown/core shared subpath', () => {
  it('shared/imagePaste is built, ESM, and free of Node imports', () => {
    const js = read('shared/imagePaste.js');
    expect(js).toContain('createImagePasteHelpers');
    expect(js).not.toMatch(/\brequire\(/);
    expect(js).not.toMatch(/from ["'](node:)?(path|crypto)["']/);
    expect(existsSync(join(dist, 'shared', 'imagePaste.d.ts'))).toBe(true);
  });

  it('the main entry does not export the image-paste helpers', () => {
    expect(read('index.d.ts')).not.toMatch(/\bcreateImagePasteHelpers\b/);
  });
});
