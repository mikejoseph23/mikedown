import { defineConfig } from 'vite';

// Library mode: vue and core (with its subpaths) stay external.
export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js' },
    sourcemap: true,
    target: 'es2020',
    rollupOptions: { external: ['vue', /^@mikedown\/core(\/.*)?$/] },
  },
});
