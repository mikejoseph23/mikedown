import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: {
    alias: { vscode: new URL('./test/stubs/vscode.ts', import.meta.url).pathname },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.ts'],
    // Pin the process time zone so date/time formatting tests (e.g. "local"
    // results in slashcommandsDate.test.ts) are deterministic regardless of
    // the machine running them.
    env: { TZ: 'UTC' },
  },
});
