// @vitest-environment node
// Shape checks on every public @mikedown/* package (found by globbing
// packages/*/package.json), plus the core-specific dist checks. Requires the
// built packages: run via `npm run test:packages`, which builds first. Checks that
// need a package's build output skip with a warning when it is missing.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helper with no type declarations
import { CORE_NAME, ROOT, discoverPackages } from '../../scripts/lib/npm-packages.mjs';

interface Pkg {
  folder: string;
  dirPath: string;
  publishDir: string;
  nonWorkspace: boolean;
  name: string;
  version: string;
}

const packages: Pkg[] = discoverPackages();
const family: string = JSON.parse(readFileSync(join(ROOT, 'packages', 'core', 'package.json'), 'utf8')).version;

/** The manifest npm will publish: dist/package.json for angular, else the source one. */
function manifestOf(pkg: Pkg): any {
  return JSON.parse(readFileSync(join(pkg.publishDir, 'package.json'), 'utf8'));
}

function exportEntries(exp: unknown): Array<[string, unknown]> {
  if (typeof exp === 'string') return [['.', exp]];
  return Object.entries(exp as Record<string, unknown>);
}

function targetsOf(entry: unknown): string[] {
  if (typeof entry === 'string') return [entry];
  if (Array.isArray(entry)) return entry.flatMap(targetsOf);
  if (entry && typeof entry === 'object') return Object.values(entry).flatMap(targetsOf);
  return [];
}

/** A target exists; a `*` pattern needs its directory and at least one matching file. */
function targetExists(base: string, target: string): boolean {
  if (!target.includes('*')) return existsSync(join(base, target));
  const [pre, post] = target.split('*');
  const slash = pre.lastIndexOf('/');
  const dir = join(base, pre.slice(0, slash));
  const filePrefix = pre.slice(slash + 1);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => f.startsWith(filePrefix) && f.endsWith(post));
}

describe('public package list', () => {
  it('finds @mikedown/core first', () => {
    expect(packages.length).toBeGreaterThan(0);
    expect(packages[0].name).toBe(CORE_NAME);
  });
});

for (const pkg of packages) {
  // For angular, publishDir is dist/ and only exists after its build.
  const built = existsSync(join(pkg.publishDir, 'package.json'));
  if (!built) {
    console.warn(`[package-shape] ${pkg.name}: ${pkg.publishDir} is not built: skipping. Run \`npm run test:packages\`.`);
  }
  const suite = built ? describe : describe.skip;

  suite(`${pkg.name} manifest`, () => {
    const m = built ? manifestOf(pkg) : ({} as any);
    const src = JSON.parse(readFileSync(join(pkg.dirPath, 'package.json'), 'utf8'));

    it('is public, MIT licensed, and points at its repo directory', () => {
      expect(m.private).toBeUndefined();
      expect(m.license).toBe('MIT');
      expect(m.repository?.directory).toBe(`packages/${pkg.folder}`);
    });

    it('ships dist, README.md and LICENSE.md', () => {
      if (pkg.nonWorkspace) {
        // ng-packagr writes dist/package.json without `files`; the assets are copied into dist.
        expect(existsSync(join(pkg.publishDir, 'README.md'))).toBe(true);
        expect(existsSync(join(pkg.publishDir, 'LICENSE.md'))).toBe(true);
      } else {
        expect(m.files).toEqual(expect.arrayContaining(['dist', 'README.md', 'LICENSE.md']));
        expect(existsSync(join(pkg.dirPath, 'README.md'))).toBe(true);
        expect(existsSync(join(pkg.dirPath, 'LICENSE.md'))).toBe(true);
      }
    });

    it('has a types entry that resolves', () => {
      const t = m.types ?? m.typings;
      expect(typeof t).toBe('string');
      expect(existsSync(join(pkg.publishDir, t))).toBe(true);
    });

    it('every exports target exists', () => {
      expect(m.exports).toBeTruthy();
      const missing: string[] = [];
      for (const [key, entry] of exportEntries(m.exports)) {
        for (const target of targetsOf(entry)) {
          if (!target.startsWith('./')) continue;
          if (!targetExists(pkg.publishDir, target)) missing.push(`${key} -> ${target}`);
        }
      }
      expect(missing).toEqual([]);
    });

    it('conditional exports order "types", "import", then "default" (Jest resolution)', () => {
      const bad: string[] = [];
      for (const [key, entry] of exportEntries(m.exports)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const conds = Object.keys(entry);
        const imp = conds.indexOf('import');
        if (imp === -1) continue;
        if (conds.indexOf('default') <= imp) bad.push(`${key}: "default" must follow "import"`);
        if (conds.includes('types') && conds.indexOf('types') > imp) bad.push(`${key}: "types" must precede "import"`);
        const e = entry as Record<string, string>;
        if (e.default !== e.import) bad.push(`${key}: "default" should match "import"`);
      }
      expect(bad).toEqual([]);
    });

    it('declares the family version', () => {
      expect(src.version).toBe(family);
    });

    if (pkg.name !== CORE_NAME) {
      it(`peers on ${CORE_NAME} at ^<family version>`, () => {
        expect(m.peerDependencies?.[CORE_NAME]).toBe(`^${family}`);
        const dev = src.devDependencies?.[CORE_NAME];
        // A non-workspace package (angular) links the repo's core with `file:../core`.
        if (dev !== undefined) expect(dev).toBe(pkg.nonWorkspace ? 'file:../core' : `^${family}`);
      });
    }
  });
}

const corePkg = packages.find((p) => p.name === CORE_NAME)!;

describe('@mikedown/core peers', () => {
  const m = JSON.parse(readFileSync(join(corePkg.dirPath, 'package.json'), 'utf8'));

  it('katex is a required peer (styles.css imports its CSS); mermaid stays optional', () => {
    expect(m.peerDependencies.katex).toBeTruthy();
    expect(m.peerDependenciesMeta?.katex).toBeUndefined();
    expect(m.peerDependencies.mermaid).toBeTruthy();
    expect(m.peerDependenciesMeta?.mermaid?.optional).toBe(true);
  });
});

const dist = join(corePkg.dirPath, 'dist');
const built = existsSync(join(dist, 'index.js')) && existsSync(join(dist, 'styles.css'));
if (!built) {
  console.warn('[package-shape] packages/core/dist is missing: skipping core dist checks. Run `npm run test:packages`.');
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
    expect(exportLines).toMatch(/\bbindMikeDownValue\b/);
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
