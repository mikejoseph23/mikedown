import { defineConfig } from 'vitest/config';

// Tests run against core's source, so they need no build of core first.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@mikedown/core': new URL('../core/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.{ts,tsx}'],
    env: { TZ: 'UTC' },
  },
});
