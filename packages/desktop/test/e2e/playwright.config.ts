/**
 * E2E: Playwright against `vite dev` with a mocked `window.__TAURI_INTERNALS__`
 * (see README.md here for why not tauri-driver). Port 1430 so it does not
 * collide with a running `tauri dev` on 1420.
 */
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 1430;

export default defineConfig({
  testDir: here,
  testMatch: '*.spec.ts',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    cwd: path.resolve(here, '..', '..'),
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  outputDir: path.join(here, '..', '..', 'test-results', 'e2e'),
});
