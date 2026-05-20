import { Node, mergeAttributes } from '@tiptap/core';

// GitHub-style alert / callout blocks.
//
//   > [!NOTE]
//   > body text…
//
// Renders as a styled, icon-prefixed colored panel in WYSIWYG mode. Round-trips
// to canonical GFM source on save. Five recognized kinds: note / tip /
// important / warning / caution. Unknown kinds (`[!FOOBAR]`) fall back to a
// plain blockquote so content is never lost.

export const CALLOUT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type CalloutKind = typeof CALLOUT_KINDS[number];

export function normalizeCalloutKind(s: string | null | undefined): CalloutKind | null {
  if (!s) return null;
  const k = s.toLowerCase();
  return (CALLOUT_KINDS as readonly string[]).includes(k) ? (k as CalloutKind) : null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (kind?: string) => ReturnType;
      toggleCallout: (kind?: string) => ReturnType;
      unsetCallout: () => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: 'note',
        parseHTML: (el) => normalizeCalloutKind(el.getAttribute('data-callout')) || 'note',
        renderHTML: (attrs) => ({ 'data-callout': attrs.kind }),
      },
    };
  },

  parseHTML() {
    return [
      {
        // Higher priority than the StarterKit Blockquote default so callout
        // markup wins. Only matches blockquotes that carry data-callout.
        tag: 'blockquote[data-callout]',
        priority: 70,
        getAttrs: (dom) => {
          if (typeof dom === 'string') return false;
          const el = dom as HTMLElement;
          const kind = normalizeCalloutKind(el.getAttribute('data-callout'));
          if (!kind) return false;
          return { kind };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const kind = (node.attrs.kind as CalloutKind) || 'note';
    // Emit only the blockquote shell — the label and icon are drawn via a
    // CSS ::before pseudo-element so they never become part of the document
    // content (and so they can't be selected, copied, or accidentally edited).
    return [
      'blockquote',
      mergeAttributes(HTMLAttributes, {
        class: `mikedown-callout mikedown-callout--${kind}`,
        'data-callout': kind,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCallout:
        (kind) =>
        ({ commands }) => {
          return commands.wrapIn(this.name, { kind: normalizeCalloutKind(kind) || 'note' });
        },
      toggleCallout:
        (kind) =>
        ({ commands, editor }) => {
          const target = normalizeCalloutKind(kind) || 'note';
          if (editor.isActive(this.name, { kind: target })) {
            return commands.lift(this.name);
          }
          if (editor.isActive(this.name)) {
            return commands.updateAttributes(this.name, { kind: target });
          }
          return commands.wrapIn(this.name, { kind: target });
        },
      unsetCallout:
        () =>
        ({ commands }) => commands.lift(this.name),
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const kind = ((node.attrs.kind as string) || 'note').toLowerCase();
          const upper = kind.toUpperCase();
          const isEmpty =
            node.childCount === 0 ||
            (node.childCount === 1 &&
              node.firstChild?.type?.name === 'paragraph' &&
              (node.firstChild?.content?.size ?? 0) === 0);
          if (isEmpty) {
            state.write(`> [!${upper}]`);
            state.closeBlock(node);
            return;
          }
          state.wrapBlock('> ', `> [!${upper}]\n> `, node, () => state.renderContent(node));
        },
        parse: {
          setup(md: any) {
            md.core.ruler.after('block', 'mikedown_callout', (state: any) => {
              const tokens = state.tokens;
              for (let i = 0; i < tokens.length; i++) {
                const open = tokens[i];
                if (open.type !== 'blockquote_open') continue;
                const pOpen = tokens[i + 1];
                const inlineTok = tokens[i + 2];
                if (!pOpen || pOpen.type !== 'paragraph_open') continue;
                if (!inlineTok || inlineTok.type !== 'inline') continue;
                const content: string = inlineTok.content || '';
                // GitHub matches the marker case-insensitively; we accept any
                // case on parse but always re-serialize uppercase.
                const m = /^\[!([A-Za-z]+)\][ \t]*(?:\r?\n)?/.exec(content);
                if (!m) continue;
                const kind = normalizeCalloutKind(m[1]);
                if (!kind) continue;

                const stripped = content.slice(m[0].length).replace(/^\r?\n+/, '');
                inlineTok.content = stripped;

                if (Array.isArray(inlineTok.children)) {
                  if (stripped.length === 0) {
                    inlineTok.children = [];
                  } else {
                    const newChildren: any[] = [];
                    md.inline.parse(stripped, md, state.env, newChildren);
                    inlineTok.children = newChildren;
                  }
                }

                open.attrSet('data-callout', kind);
                open.attrJoin('class', `mikedown-callout mikedown-callout--${kind}`);
              }
            });
          },
        },
      },
    };
  },
});
