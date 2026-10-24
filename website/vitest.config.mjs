import { defineConfig } from 'vitest/config';

// Site tests run over the built site (website/dist). `npm run test:site` builds it first.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    root: new URL('.', import.meta.url).pathname,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
