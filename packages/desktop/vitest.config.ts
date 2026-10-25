/**
 * Unit tests for the desktop app's pure logic. Core is consumed from source
 * (same aliases as the root vitest.config.ts) so the jsdom round-trip in
 * test/unit/smoke-roundtrip.test.ts is the reference the webview harness is
 * compared against.
 */
import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const coreSrc = path.resolve(here, '..', 'core', 'src');

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@mikedown\/core\/shared(\/.*)?$/, replacement: path.join(coreSrc, 'shared') + '$1' },
      { find: /^@mikedown\/core\/ai$/, replacement: path.join(coreSrc, 'ai', 'index.ts') },
      { find: /^@mikedown\/core$/, replacement: path.join(coreSrc, 'index.ts') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/unit/**/*.test.ts'],
    env: { TZ: 'UTC' },
  },
});
