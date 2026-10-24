import { defineConfig } from 'tsup';

// npm build: ESM + .d.ts, with @mikedown/core (a peer) external. `define` is a
// separate entry with side effects; splitting keeps one copy of the element
// class in a shared chunk, so importing both entries never defines two classes.
// The CDN bundle (dist/mikedown-editor.standalone.js) is built afterwards by
// scripts/build-standalone.mjs.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    define: 'src/define.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: true,
  target: 'es2020',
  platform: 'browser',
  tsconfig: 'tsconfig.json',
  external: ['@mikedown/core'],
});
