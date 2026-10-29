/**
 * The rewrite target highlight (a PM plugin in rich text, a CM state field in
 * source mode). Kept apart from the popover in `ai-rewrite.ts` because the
 * editor adds both extensions when it is built, while the rest of the AI UI
 * loads on demand (`ai-lite.ts`).
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration as CmDecoration, EditorView as CmEditorView } from '@codemirror/view';

/**
 * A target range; `id` tells one open target from the next. An `anchor` is
 * a caret position (from === to) that follows edits and is never dropped.
 */
export interface Range { from: number; to: number; id: number; anchor?: boolean }

// ── Target highlight: rich text ─────────────────────────────────────────────

export const aiRewriteHighlightKey = new PluginKey<Range | null>('mikedownAiRewriteHighlight');

/** Marks the rewrite target while the popover is open; the range follows edits. */
export const AiRewriteHighlight = Extension.create({
  name: 'mikedownAiRewriteHighlight',
  addProseMirrorPlugins() {
    return [new Plugin<Range | null>({
      key: aiRewriteHighlightKey,
      state: {
        init: () => null,
        apply(tr, value) {
          const meta = tr.getMeta(aiRewriteHighlightKey) as { range: Range | null } | undefined;
          if (meta) {return meta.range;}
          if (!value || !tr.docChanged) {return value;}
          if (value.anchor) {
            const p = tr.mapping.map(value.from, -1);
            return { ...value, from: p, to: p };
          }
          const from = tr.mapping.map(value.from, 1);
          const to = tr.mapping.map(value.to, -1);
          return to > from ? { from, to, id: value.id } : null;
        },
      },
      props: {
        decorations(state) {
          const r = aiRewriteHighlightKey.getState(state);
          if (!r || r.to <= r.from) {return null;}
          return DecorationSet.create(state.doc, [Decoration.inline(r.from, r.to, { class: 'mikedown-ai-rewrite-target' })]);
        },
      },
    })];
  },
});

// ── Target highlight: source mode ───────────────────────────────────────────

export const setCmRewriteRange = StateEffect.define<Range | null>();

export const cmRewriteRange = StateField.define<Range | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {if (e.is(setCmRewriteRange)) {return e.value;}}
    if (!value || !tr.docChanged) {return value;}
    if (value.anchor) {
      const p = tr.changes.mapPos(value.from, -1);
      return { ...value, from: p, to: p };
    }
    const from = tr.changes.mapPos(value.from, 1);
    const to = tr.changes.mapPos(value.to, -1);
    return to > from ? { from, to, id: value.id } : null;
  },
  provide: (f) => CmEditorView.decorations.from(f, (r) => (r && r.to > r.from
    ? CmDecoration.set([CmDecoration.mark({ class: 'mikedown-ai-rewrite-target' }).range(r.from, r.to)])
    : CmDecoration.none)),
});

/** Add to the source view's extensions. */
export const cmAiRewriteHighlight = [cmRewriteRange];
