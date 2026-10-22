import { Node, InputRule } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import footnotePlugin from 'markdown-it-footnote';

// Footnotes: `[^label]` references and `[^label]: text` definitions.
//
// Two nodes:
//   footnoteRef — inline atom, `label` attr, rendered as a superscript `[label]`.
//   footnoteDef — block container (`block+`, so multi-paragraph notes work),
//                 `label` attr, rendered with its label in a gutter column.
//
// Same HTML bridge as `wikilink-node.ts` / `math.ts`: markdown-it emits
// `<sup data-footnote-ref>` / `<div data-footnote-def>` which parseHTML picks
// up, and the serializers write the markdown back.
//
// markdown-it-footnote is used for the tokenizing only. Its defaults would hoist
// every definition into a trailing list, drop definitions nothing references,
// and renumber labels, none of which survives a round-trip through someone's
// file. So `footnote_tail` is disabled and definitions are kept where they were
// written, with the author's labels. Inline footnotes (`^[text]`) are disabled;
// they stay literal text. A `[^x]` with no matching definition also stays text.

const REF_ATTR = 'data-footnote-ref';
const DEF_ATTR = 'data-footnote-def';

function configureMarkdownIt(md: any): void {
  if (md.__mikedownFootnotes) {return;}
  md.__mikedownFootnotes = true;
  md.use(footnotePlugin);
  md.inline.ruler.disable(['footnote_inline']);
  md.core.ruler.disable(['footnote_tail']);

  // The plugin's block rule emits footnote_reference_open/close pairs in place;
  // with the tail disabled nothing else touches them, so turn them into the
  // tokens the renderer rules below understand.
  md.core.ruler.after('block', 'mikedown_footnote_defs', (state: any) => {
    for (const tok of state.tokens) {
      if (tok.type === 'footnote_reference_open') {
        tok.type = 'footnote_open';
      } else if (tok.type === 'footnote_reference_close') {
        tok.type = 'footnote_close';
      }
    }
  });

  const esc = md.utils.escapeHtml as (s: string) => string;
  md.renderer.rules.footnote_ref = (tokens: any[], idx: number) =>
    `<sup ${REF_ATTR}="${esc(tokens[idx].meta.label)}"></sup>`;
  md.renderer.rules.footnote_open = (tokens: any[], idx: number) =>
    `<div ${DEF_ATTR}="${esc(tokens[idx].meta.label)}">`;
  md.renderer.rules.footnote_close = () => '</div>\n';
}

/** Smallest positive integer label not already used by a reference or definition. */
export function nextFootnoteLabel(doc: PmNode): string {
  const used = new Set<string>();
  doc.descendants((n) => {
    if (n.type.name === 'footnoteRef' || n.type.name === 'footnoteDef') {used.add(n.attrs.label as string);}
    return true;
  });
  let n = 1;
  while (used.has(String(n))) {n++;}
  return String(n);
}

/** Position at which to find the definition for `label`, or null. */
function findDefinition(doc: PmNode, label: string): { pos: number; node: PmNode } | null {
  let found: { pos: number; node: PmNode } | null = null;
  doc.descendants((n, pos) => {
    if (found) {return false;}
    if (n.type.name === 'footnoteDef' && n.attrs.label === label) {
      found = { pos, node: n };
      return false;
    }
    return true;
  });
  return found;
}

export const FootnoteRef = Node.create({
  name: 'footnoteRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (el) => el.getAttribute(REF_ATTR) || '',
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: `sup[${REF_ATTR}]` }];
  },

  renderHTML({ node }) {
    const label = node.attrs.label as string;
    return ['sup', { [REF_ATTR]: label, class: 'mikedown-footnote-ref', title: `Footnote ${label} (Cmd/Ctrl+click to jump)` }, `[${label}]`];
  },

  addInputRules() {
    return [
      new InputRule({
        find: /\[\^([^\s[\]]+)\]$/,
        handler: ({ state, range, match }) => {
          const label = match[1];
          const { tr } = state;
          tr.replaceWith(range.from, range.to, state.schema.nodes.footnoteRef.create({ label }));
          if (!findDefinition(tr.doc, label)) {
            tr.insert(
              tr.doc.content.size,
              state.schema.nodes.footnoteDef.create({ label }, state.schema.nodes.paragraph.create())
            );
          }
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          // Cmd/Ctrl+click a reference to jump to its definition, and a
          // definition's label gutter to jump back to the first reference.
          handleClick: (view, _pos, event) => {
            if (!(event.metaKey || event.ctrlKey)) {return false;}
            const target = event.target as HTMLElement | null;
            const refEl = target?.closest?.(`[${REF_ATTR}]`);
            const defEl = target?.closest?.(`[${DEF_ATTR}]`);
            const { doc } = view.state;
            if (refEl) {
              const def = findDefinition(doc, refEl.getAttribute(REF_ATTR) ?? '');
              if (!def) {return false;}
              const end = def.pos + def.node.nodeSize - 1;
              view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(end), -1)).scrollIntoView());
              view.focus();
              return true;
            }
            if (defEl) {
              const label = defEl.getAttribute(DEF_ATTR);
              let refPos = -1;
              doc.descendants((n, p) => {
                if (refPos >= 0) {return false;}
                if (n.type.name === 'footnoteRef' && n.attrs.label === label) {refPos = p;}
                return true;
              });
              if (refPos < 0) {return false;}
              view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(refPos))).scrollIntoView());
              view.focus();
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: PmNode) {
          state.write(`[^${node.attrs.label}]`);
        },
        parse: {
          setup(md: any) {
            configureMarkdownIt(md);
          },
        },
      },
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      /** Insert a reference at the cursor plus (if new) an empty definition at the end of the doc. */
      insertFootnote: (label?: string) => ReturnType;
    };
  }
}

export const FootnoteDef = Node.create({
  name: 'footnoteDef',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (el) => el.getAttribute(DEF_ATTR) || '',
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: `div[${DEF_ATTR}]`, priority: 60 }];
  },

  renderHTML({ node }) {
    return ['div', { [DEF_ATTR]: node.attrs.label, class: 'mikedown-footnote-def' }, 0];
  },

  addCommands() {
    return {
      insertFootnote:
        (label) =>
        ({ state, dispatch }) => {
          const { schema } = state;
          const name = label || nextFootnoteLabel(state.doc);
          if (dispatch) {
            const tr = state.tr;
            tr.replaceSelectionWith(schema.nodes.footnoteRef.create({ label: name }), false);
            let target = findDefinition(tr.doc, name);
            if (!target) {
              const at = tr.doc.content.size;
              tr.insert(at, schema.nodes.footnoteDef.create({ label: name }, schema.nodes.paragraph.create()));
              target = findDefinition(tr.doc, name);
            }
            if (target) {
              const end = target.pos + target.node.nodeSize - 1;
              tr.setSelection(TextSelection.near(tr.doc.resolve(end), -1));
            }
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: PmNode) {
          // Continuation blocks are indented four spaces, which is how the
          // footnote syntax keeps them inside the definition.
          const empty = node.childCount === 1 && node.firstChild?.type.name === 'paragraph' && node.firstChild.content.size === 0;
          state.wrapBlock('    ', `[^${node.attrs.label}]:${empty ? '' : ' '}`, node, () => state.renderContent(node));
        },
        parse: {
          // Registered by FootnoteRef's setup: one plugin covers both nodes.
        },
      },
    };
  },
});
