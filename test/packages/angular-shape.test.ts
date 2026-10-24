// @vitest-environment node
// @mikedown/angular-specific checks on the ng-packagr output (packages/angular/dist). The family-wide checks live in
// package-shape.test.ts. Requires the build: run via `npm run test:packages`; skips with a warning when dist is missing.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkgDir = fileURLToPath(new URL('../../packages/angular', import.meta.url));
const dist = join(pkgDir, 'dist');
const built = existsSync(join(dist, 'package.json')) && existsSync(join(dist, 'fesm2022', 'mikedown-angular.mjs'));
if (existsSync(join(pkgDir, 'package.json')) && !built) {
  console.warn('[angular-shape] packages/angular/dist is not built: skipping. Run `npm run test:packages`.');
}
const suite = built ? describe : describe.skip;

const NG_RANGE = '>=17.0.0 <23.0.0';

suite('@mikedown/angular dist', () => {
  const manifest = built ? JSON.parse(readFileSync(join(dist, 'package.json'), 'utf8')) : {};
  const fesm = built ? readFileSync(join(dist, 'fesm2022', 'mikedown-angular.mjs'), 'utf8') : '';
  const dts = built ? readFileSync(join(dist, 'index.d.ts'), 'utf8') : '';

  it('peers on Angular 17 to 22, rxjs ^7.5 and core; no Angular in dependencies', () => {
    for (const name of ['@angular/core', '@angular/common', '@angular/forms', '@angular/router']) {
      expect(manifest.peerDependencies?.[name]).toBe(NG_RANGE);
      expect(manifest.dependencies?.[name]).toBeUndefined();
    }
    expect(manifest.peerDependencies?.rxjs).toBe('^7.5.0');
    expect(manifest.peerDependencies?.['@mikedown/core']).toBeTruthy();
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['tslib']);
  });

  it('is side-effect free, ESM, and has no scripts or devDependencies', () => {
    expect(manifest.sideEffects).toBe(false);
    expect(manifest.scripts).toBeUndefined();
    expect(manifest.devDependencies).toBeUndefined();
    expect(fesm).not.toMatch(/\brequire\(/);
    expect(manifest.exports?.['.']?.default).toBe('./fesm2022/mikedown-angular.mjs');
  });

  it('is compiled in partial-Ivy mode by Angular 17', () => {
    expect(fesm).toContain('ɵɵngDeclareComponent');
    expect(fesm).not.toContain('ɵɵdefineComponent');
    const versions = [...fesm.matchAll(/version: "(\d+)\.\d+\.\d+", ngImport/g)].map((m) => m[1]);
    expect(versions.length).toBeGreaterThan(0);
    expect(new Set(versions)).toEqual(new Set(['17']));
  });

  it('registers both selectors on one standalone component', () => {
    expect(fesm).toContain('selector: "mikedown-editor, lyme-markdown-editor"');
    expect(fesm).toMatch(/isStandalone: true/);
  });

  it('exports the component, module, unescapeBrackets and host types', () => {
    for (const name of ['MikeDownEditorComponent', 'MikeDownModule', 'unescapeBrackets', 'AngularMikeDownHost', 'MIKEDOWN_SETTINGS_KEY']) {
      expect(fesm).toMatch(new RegExp(`export \\{[^}]*\\b${name}\\b`));
    }
    expect(existsSync(join(dist, 'public-api.d.ts')) || dts.includes('public-api')).toBe(true);
  });

  it('ships README.md, LICENSE.md and CHANGELOG.md', () => {
    for (const f of ['README.md', 'LICENSE.md', 'CHANGELOG.md']) expect(existsSync(join(dist, f))).toBe(true);
  });
});
