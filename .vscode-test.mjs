import { defineConfig } from '@vscode/test-cli';
export default defineConfig({
  files: 'test/integration/**/*.test.ts',
  workspaceFolder: './test/workspace',
  mocha: {
    timeout: 20000,
  },
});
