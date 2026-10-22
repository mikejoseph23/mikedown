import { Highlight as TiptapHighlight } from '@tiptap/extension-highlight';
import markPlugin from 'markdown-it-mark';

// `==text==` highlight / mark support.
//
// Round-trip:
//   parse     — markdown-it-mark turns `==text==` into `<mark>text</mark>`.
//               TipTap's built-in Highlight.parseHTML picks up the `<mark>` tag.
//   render    — emits `<mark>` in the editor DOM (styled via editor.css).
//   serialize — tiptap-markdown writes `==…==` around the mark range via the
//               open/close pair below.
export const Highlight = TiptapHighlight.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { open: '==', close: '==', mixable: true, expelEnclosingWhitespace: true },
        parse: {
          setup(md: any) {
            md.use(markPlugin);
          },
        },
      },
    };
  },
}).configure({ multicolor: false });
