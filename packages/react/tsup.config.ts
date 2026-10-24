import { defineConfig } from 'tsup';

// react, react-dom and @mikedown/core are peers, so tsup leaves them external.
// The banner keeps 'use client' at the top so the Next.js app router treats the
// module as a client component; the component also touches no DOM at import or render.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  platform: 'browser',
  splitting: false,
  external: ['react', 'react-dom', '@mikedown/core'],
  banner: { js: "'use client';" },
});
