import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { findInlineTags } from '../tagSyntax';

// Inline `#tag` support — decoration only.
//
// Tags are NOT a node or mark: the document model keeps the literal `#tag`
// text, so markdown parse/serialize round-trips for free (no tiptap-markdown
// changes). A ProseMirror plugin scans text nodes and paints `.mikedown-tag`
// spans over each `#tag`. Click handling lives in editor-main.ts alongside the
// link handler (Cmd/Ctrl+click to navigate, matching link UX) so plain clicks
// still place the caret for editing.
//
// Code is skipped: text with the `code` mark and anything inside a `codeBlock`
// is left untouched. Headings need no special-casing — the heading's `#`
// markers aren't part of the editor's text model, so there's nothing to match.

export const TagDecorator = Extension.create({
  name: 'tagDecorator',

  addProseMirrorPlugins() {
    const key = new PluginKey('tagDecorator');
    return [
      new Plugin({
        key,
        state: {
          init: (_config, { doc }) => buildDecorations(doc),
          apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return key.getState(state);
          },
        },
      }),
    ];
  },
});

function buildDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text) return;
    if (parent?.type.name === 'codeBlock') return;
    if (node.marks.some(m => m.type.name === 'code')) return;

    for (const match of findInlineTags(node.text)) {
      const from = pos + match.index;
      const to = from + match.length;
      decorations.push(
        Decoration.inline(from, to, {
          class: 'mikedown-tag',
          'data-tag': match.tag,
          title: `Cmd/Ctrl+click to find documents tagged #${match.tag}`,
        })
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}
