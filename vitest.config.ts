import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: {
    alias: {
      vscode: new URL('./test/stubs/vscode.ts', import.meta.url).pathname,
      '@mikedown/core/shared': new URL('./packages/core/src/shared', import.meta.url).pathname,
      '@mikedown/core/ai': new URL('./packages/core/src/ai/index.ts', import.meta.url).pathname,
      '@mikedown/core': new URL('./packages/core/src', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    // Pin the process time zone so date/time formatting tests (e.g. "local"
    // results in slashcommandsDate.test.ts) are deterministic regardless of
    // the machine running them.
    env: { TZ: 'UTC' },
    // Editor-boot tests build a full TipTap editor in jsdom (~0.2-1s each on a
    // dev machine). The 2-core CI runner is several times slower, so give it
    // more headroom than the 5s default. Local runs keep the defaults.
    ...(process.env.CI ? { testTimeout: 30000, hookTimeout: 30000 } : {}),
  },
});
