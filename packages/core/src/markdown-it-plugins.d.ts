/**
 * Ambient types for the markdown-it plugins MikeDown uses, which ship no `.d.ts`.
 */
declare module 'markdown-it-emoji' {
  import type MarkdownIt from 'markdown-it';
  export const full: MarkdownIt.PluginSimple;
}

declare module 'markdown-it-emoji/lib/data/full.mjs' {
  const emojiData: Record<string, string>;
  export default emojiData;
}

declare module 'markdown-it-mark' {
  import type MarkdownIt from 'markdown-it';
  const markPlugin: MarkdownIt.PluginSimple;
  export default markPlugin;
}
