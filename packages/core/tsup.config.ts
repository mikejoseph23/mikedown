import { defineConfig } from 'tsup';

// Peers and dependencies stay external (tsup externalizes everything listed in
// package.json dependencies, peerDependencies and optional peers, subpaths
// included). mermaid and katex are optional peers loaded by dynamic import().
// tiptap-markdown is a plain dependency: consumers' bundlers resolve its ES
// build through its exports map (see README, "Bundler notes").
export default defineConfig({
  // shared/* entries are separate so hosts (the desktop app) can import them
  // as @mikedown/core/shared/<name> without the editor: imagePaste (M1),
  // sha1 (hash-dedupe in the desktop image pipeline), wordCount (status
  // footer) and anchoring (heading slugs for the desktop folder index).
  entry: {
    index: 'src/index.ts',
    'shared/imagePaste': 'src/shared/imagePaste.ts',
    'shared/sha1': 'src/shared/sha1.ts',
    'shared/wordCount': 'src/shared/wordCount.ts',
    'shared/anchoring': 'src/shared/anchoring.ts',
    // @mikedown/core/ai: the pure AI layer (schema, router, SSE, request
    // builders) for hosts that run inference, without the editor.
    'ai/index': 'src/ai/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  platform: 'browser',
  // The AI UI (src/ai-ui.ts) is an import() in the editor: splitting emits it
  // as its own chunk, which consumers' bundlers split again, so an editor
  // without host.ai never loads it. Code shared by entries goes in chunks
  // instead of being copied into each.
  splitting: true,
  // Keep the dynamic import() calls for mermaid and katex as written.
  external: ['mermaid', 'katex'],
});
