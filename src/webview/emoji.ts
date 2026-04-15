import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import { full as emojiPlugin } from 'markdown-it-emoji';
import emojiData from 'markdown-it-emoji/lib/data/full.mjs';

// GitHub-style `:shortcode:` emoji support.
//
// Round-trip:
//   parse     — markdown-it-emoji (full GitHub set) emits `emoji` tokens; we
//               override the renderer to emit `<span class="mikedown-emoji"
//               data-emoji-shortcode="…">😄</span>`, which PM's DOMParser picks
//               up via parseHTML() below.
//   render    — emits the same span in the editor DOM.
//   serialize — writes `:shortcode:` back to markdown, preserving the source
//               form so GitHub/GitLab can re-render it server-side.

const EMOJI_MAP = emojiData as Record<string, string>;

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export const Emoji = Node.create({
  name: 'emoji',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      shortcode: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-emoji-shortcode]',
        priority: 60,
        getAttrs: (dom) => {
          if (typeof dom === 'string') return false;
          const el = dom as HTMLElement;
          const shortcode = el.getAttribute('data-emoji-shortcode');
          if (!shortcode) return false;
          return { shortcode };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const shortcode = node.attrs.shortcode as string;
    const char = EMOJI_MAP[shortcode] ?? `:${shortcode}:`;
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'mikedown-emoji',
        'data-emoji-shortcode': shortcode,
        title: `:${shortcode}:`,
      }),
      char,
    ];
  },

  addInputRules() {
    return [
      new InputRule({
        find: /:([a-zA-Z0-9_+-]+):$/,
        handler: ({ state, range, match }) => {
          const shortcode = match[1];
          if (!(shortcode in EMOJI_MAP)) return null;
          const { tr } = state;
          tr.replaceWith(range.from, range.to, this.type.create({ shortcode }));
        },
      }),
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(`:${node.attrs.shortcode}:`);
        },
        parse: {
          setup(markdownit: any) {
            markdownit.use(emojiPlugin);
            markdownit.renderer.rules.emoji = (tokens: any[], idx: number) => {
              const token = tokens[idx];
              const shortcode = token.markup;
              const char = token.content;
              return `<span class="mikedown-emoji" data-emoji-shortcode="${escapeAttr(shortcode)}" title=":${escapeAttr(shortcode)}:">${char}</span>`;
            };
          },
        },
      },
    };
  },
});
