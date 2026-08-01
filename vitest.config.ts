import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: {
    alias: { vscode: new URL('./test/stubs/vscode.ts', import.meta.url).pathname },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.ts'],
  },
});
