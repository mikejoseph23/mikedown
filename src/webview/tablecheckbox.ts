import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, EditorView } from '@tiptap/pm/view';

// ─── Table Checkbox Plugin ──────────────────────────────────────────────────
//
// Scans table cells for "[ ]" and "[x]" text patterns and replaces them with
// interactive checkbox widget decorations. Clicking a checkbox toggles the
// underlying text between "[ ]" and "[x]", preserving markdown round-trip.

const tableCheckboxKey = new PluginKey<DecorationSet>('tableCheckbox');

const CHECKBOX_RE = /\[([ xX])\]/g;

function isInsideTable(doc: any, pos: number): boolean {
  const resolved = doc.resolve(pos);
  for (let depth = resolved.depth; depth > 0; depth--) {
    const nodeType = resolved.node(depth).type.name;
    if (nodeType === 'tableCell' || nodeType === 'tableHeader') return true;
  }
  return false;
}

function buildDecorations(doc: any, view?: EditorView): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return;
    if (!isInsideTable(doc, pos)) return;

    const text = node.text!;
    let match: RegExpExecArray | null;
    CHECKBOX_RE.lastIndex = 0;

    while ((match = CHECKBOX_RE.exec(text)) !== null) {
      const from = pos + match.index;
      const to = from + match[0].length;
      const checked = match[1].toLowerCase() === 'x';

      const widget = Decoration.widget(from, (view) => {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = checked;
        checkbox.classList.add('table-checkbox');
        checkbox.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const newText = checked ? '[ ]' : '[x]';
          const tr = view.state.tr.replaceWith(
            from,
            to,
            view.state.schema.text(newText),
          );
          view.dispatch(tr);
        });
        return checkbox;
      }, {
        // Widget sits before the text; the inline decoration hides the raw text
        side: -1,
      });

      const hide = Decoration.inline(from, to, {
        class: 'table-checkbox-hidden',
      });

      decorations.push(widget, hide);
    }
  });

  return DecorationSet.create(doc, decorations);
}

export const TableCheckboxExtension = Extension.create({
  name: 'tableCheckbox',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tableCheckboxKey,
        state: {
          init(_, { doc }) {
            return buildDecorations(doc);
          },
          apply(tr, oldDecorations) {
            if (!tr.docChanged) return oldDecorations;
            return buildDecorations(tr.doc);
          },
        },
        props: {
          decorations(state) {
            return tableCheckboxKey.getState(state);
          },
        },
      }),
    ];
  },
});
