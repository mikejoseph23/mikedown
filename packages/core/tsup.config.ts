import { defineConfig } from 'tsup';

// Peers and dependencies stay external (tsup externalizes everything listed in
// package.json dependencies, peerDependencies and optional peers, subpaths
// included). mermaid and katex are optional peers loaded by dynamic import().
// tiptap-markdown is a plain dependency: consumers' bundlers resolve its ES
// build through its exports map (see README, "Bundler notes").
export default defineConfig({
  // shared/imagePaste is a separate entry so hosts (the desktop app) can
  // import it as @mikedown/core/shared/imagePaste without the editor.
  entry: { index: 'src/index.ts', 'shared/imagePaste': 'src/shared/imagePaste.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  platform: 'browser',
  splitting: false,
  // Keep the dynamic import() calls for mermaid and katex as written.
  external: ['mermaid', 'katex'],
});
