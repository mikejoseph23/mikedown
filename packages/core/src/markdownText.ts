/**
 * Markdown serializers for `text` and `hardBreak` (issue #5).
 *
 * tiptap-markdown ships defaults for both nodes; `getMarkdownSpec()` prefers
 * whatever the *editor's own* extension puts on `storage.markdown`, so
 * extending the base nodes here overrides them without patching the package.
 * StarterKit is configured with `text: false, hardBreak: false` so these
 * register the node types instead.
 *
 * Two bugs are fixed:
 *
 * 1. `text` — the upstream serializer HTML-escapes every run
 *    (`state.text(escapeHTML(node.text))`), turning `<job>` into `&lt;job&gt;`
 *    in the saved file. We escape for markdown instead (see markdownEscape.ts)
 *    and hand the result to `state.text(..., false)` already escaped.
 *
 * 2. `hardBreak` — the upstream serializer always emits a trailing backslash
 *    (`"\\\n"`), so every soft-wrapped line in a paragraph or blockquote grew a
 *    stray `\`. With `breaks: true` (MikeDown's mode) a bare newline already
 *    parses back to a hard break, so the backslash is pure noise. It is still
 *    emitted when `breaks` is off, where it carries meaning.
 */

import { Text } from '@tiptap/extension-text';
import { HardBreak } from '@tiptap/extension-hard-break';
import type { Node as PMNode } from '@tiptap/pm/model';
import { escapeMarkdownRun } from './markdownEscape';

/**
 * prosemirror-markdown's serializer state, plus the two flags we read/write.
 * `inTable` is tiptap-markdown's; `mikedownAfterHardBreak` is ours — it tells
 * the next text run it is starting a fresh line so `- `, `> `, `# ` and `1. `
 * get escaped and can't be re-parsed as a new block.
 */
interface SerializerState {
  text(text: string, escape?: boolean): void;
  write(content?: string): void;
  atBlockStart?: boolean;
  inTable?: boolean;
  mikedownAfterHardBreak?: boolean;
}

function markdownOptions(editor: any): { html: boolean; breaks: boolean } {
  const opts = editor?.storage?.markdown?.options ?? {};
  return { html: opts.html === true, breaks: opts.breaks === true };
}

export const MarkdownText = Text.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: PMNode) {
          const { html } = markdownOptions((this as any).editor);
          const startOfLine = state.atBlockStart === true || state.mikedownAfterHardBreak === true;
          state.mikedownAfterHardBreak = false;
          state.text(
            escapeMarkdownRun(node.text ?? '', { startOfLine, html, inTable: state.inTable === true }),
            false
          );
        },
        parse: {
          // handled by markdown-it
        },
      },
    };
  },
});

export const MarkdownHardBreak = HardBreak.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: PMNode, parent: PMNode, index: number) {
          // Hard breaks with nothing but more hard breaks after them sit at the
          // end of the block and serialize to nothing — same rule upstream
          // applies. Anything else emits a break.
          for (let i = index + 1; i < parent.childCount; i++) {
            if (parent.child(i).type === node.type) {continue;}
            if (state.inTable) {
              // A newline would end the table row; GFM's escape hatch is <br>.
              state.write('<br>');
              return;
            }
            // With `breaks: true` a bare newline already reparses as a hard
            // break, so the first break in a run needs no backslash. A *second*
            // consecutive break does — a blank line would split the paragraph,
            // whereas a lone `\` on its own line is another hard break.
            const { breaks } = markdownOptions((this as any).editor);
            const afterBreak = index > 0 && parent.child(index - 1).type === node.type;
            state.write(breaks && !afterBreak ? '\n' : '\\\n');
            state.mikedownAfterHardBreak = true;
            return;
          }
        },
        parse: {
          // handled by markdown-it
        },
      },
    };
  },
});
