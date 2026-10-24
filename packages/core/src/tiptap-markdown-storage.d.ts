/**
 * `tiptap-markdown` registers its serializer on `editor.storage.markdown` but
 * ships no augmentation of TipTap's `Storage`. Only what MikeDown calls is declared.
 */
import '@tiptap/core';

declare module '@tiptap/core' {
  interface Storage {
    markdown: {
      getMarkdown(): string;
    };
  }
}
