// @vitest-environment node
// Shape checks specific to @mikedown/react. Needs the built package: run via
// `npm run test:packages`. Skips with a warning when dist is missing.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helper with no type declarations
import { ROOT } from '../../scripts/lib/npm-packages.mjs';

const dir = join(ROOT, 'packages', 'react');
const dist = join(dir, 'dist');
const built = existsSync(join(dist, 'index.js'));
if (!built) console.warn('[react-shape] packages/react/dist is missing: skipping. Run `npm run test:packages`.');
const suite = built ? describe : describe.skip;

suite('@mikedown/react dist shape', () => {
  const js = () => readFileSync(join(dist, 'index.js'), 'utf8');

  it("starts with the 'use client' directive", () => {
    expect(js().trimStart()).toMatch(/^['"]use client['"];?/);
  });

  it('is ESM with react, react-dom and core external', () => {
    const src = js();
    expect(src).not.toMatch(/\brequire\(/);
    expect(src).toMatch(/from ["']react["']/);
    expect(src).toMatch(/from ["']@mikedown\/core["']/);
    expect(src).not.toMatch(/\bcreateMikeDownEditor\(/);
  });

  it('touches no DOM at import', () => {
    const top = js().split('\n').filter((l) => /^(document|window|navigator)\b/.test(l));
    expect(top).toEqual([]);
  });

  it('declares react and react-dom >=18 as peers', () => {
    const m = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(m.peerDependencies.react).toBe('>=18');
    expect(m.peerDependencies['react-dom']).toBe('>=18');
  });

  it('types export the component and props', () => {
    const dts = readFileSync(join(dist, 'index.d.ts'), 'utf8');
    expect(dts).toMatch(/MikeDownEditor\b/);
    expect(dts).toMatch(/MikeDownEditorProps\b/);
  });
});
