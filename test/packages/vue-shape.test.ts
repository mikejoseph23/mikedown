// @vitest-environment node
// @mikedown/vue specifics, on top of the generic checks in package-shape.test.ts.
// Needs the build: run via `npm run test:packages`.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(__dirname, '..', '..', 'packages', 'vue');
const built = existsSync(join(dir, 'dist', 'index.js'));
if (!built) console.warn('[vue-shape] packages/vue/dist is missing: skipping. Run `npm run test:packages`.');

(built ? describe : describe.skip)('@mikedown/vue dist shape', () => {
  const js = () => readFileSync(join(dir, 'dist', 'index.js'), 'utf8');

  it('keeps vue and @mikedown/core external', () => {
    expect(js()).toMatch(/from ["']vue["']/);
    expect(js()).toMatch(/from ["']@mikedown\/core["']/);
    expect(js().length).toBeLessThan(20_000);
  });

  it('peers on vue >=3.3 and declares types', () => {
    const m = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(m.peerDependencies.vue).toBe('>=3.3.0');
    expect(m.sideEffects).toBe(false);
    expect(existsSync(join(dir, 'dist', 'index.d.ts'))).toBe(true);
  });
});
