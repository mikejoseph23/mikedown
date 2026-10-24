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
 *
 *    A break the *source* spelled explicitly — `\` or two trailing spaces —
 *    keeps that spelling, though: a parse rule tags those breaks
 *    (`mdBreak: 'backslash' | 'spaces'`) so a file written for CommonMark
 *    renderers, where a bare newline is only a soft break, round-trips intact.
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

/** How the source spelled a hard break; `null` for a bare newline or a new break. */
export type HardBreakStyle = 'backslash' | 'spaces';

/**
 * Wrap markdown-it's `escape` (`\` + newline) and `newline` (two trailing
 * spaces) inline rules so the hard breaks they emit carry their source style,
 * and render those as `<br data-md-break="…">` for the node's `parseHTML`.
 */
function tagHardBreakStyles(md: any): void {
  const wrap = (ruleName: string, style: HardBreakStyle): void => {
    const rule = md.inline.ruler.__rules__.find((r: any) => r.name === ruleName);
    if (!rule) {return;}
    const original = rule.fn;
    md.inline.ruler.at(ruleName, (state: any, silent: boolean) => {
      const before = state.tokens.length;
      const matched = original(state, silent);
      if (matched && !silent && state.tokens.length > before) {
        const last = state.tokens[state.tokens.length - 1];
        if (last.type === 'hardbreak') {last.meta = { ...(last.meta ?? {}), mikedownBreak: style };}
      }
      return matched;
    });
  };
  wrap('escape', 'backslash');
  wrap('newline', 'spaces');

  const fallback = md.renderer.rules.hardbreak;
  md.renderer.rules.hardbreak = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    const style = tokens[idx].meta?.mikedownBreak;
    if (style) {return `<br data-md-break="${style}">\n`;}
    return fallback ? fallback(tokens, idx, options, env, self) : '<br>\n';
  };
}

export const MarkdownHardBreak = HardBreak.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      mdBreak: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const style = element.getAttribute('data-md-break');
          return style === 'backslash' || style === 'spaces' ? style : null;
        },
        renderHTML: (attributes: { mdBreak?: HardBreakStyle | null }) =>
          attributes.mdBreak ? { 'data-md-break': attributes.mdBreak } : {},
      },
    };
  },

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
            // A break the source spelled explicitly keeps its spelling — except
            // two spaces after another break, which would be a blank line.
            const { breaks } = markdownOptions((this as any).editor);
            const afterBreak = index > 0 && parent.child(index - 1).type === node.type;
            const style = node.attrs.mdBreak as HardBreakStyle | null;
            if (style === 'spaces' && !afterBreak) {
              state.write('  \n');
            } else {
              state.write(breaks && !afterBreak && style !== 'backslash' ? '\n' : '\\\n');
            }
            state.mikedownAfterHardBreak = true;
            return;
          }
        },
        parse: {
          setup: tagHardBreakStyles,
        },
      },
    };
  },
});
