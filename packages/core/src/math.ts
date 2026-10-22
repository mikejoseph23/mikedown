import { Node, InputRule } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { TextSelection, NodeSelection } from '@tiptap/pm/state';
import type { EditorView, NodeView } from '@tiptap/pm/view';
import katex from 'katex';

// KaTeX math: inline `$...$` and display `$$...$$`, the syntax GitHub renders.
//
// Two atom nodes, `mathInline` and `mathBlock`, each holding the raw LaTeX in a
// `latex` attr. Same bridge as `wikilink-node.ts`: markdown-it rules emit
// `<span|div data-math-*>` HTML that `parseHTML` picks up, and a `state.write`
// serializer puts the delimiters back.
//
// Rendering and editing live in a NodeView. The view owns its DOM
// (`ignoreMutation` → true), so swapping the rendered formula for an input box
// never touches ProseMirror's own DOM; the edit is committed with a normal
// `setNodeMarkup` transaction.
//
// Delimiter rules follow pandoc / GitHub so prices don't turn into math:
//   • the opening `$` must be followed by a non-space,
//   • the closing `$` must be preceded by a non-space and not followed by a digit,
//   • `\$` is a literal dollar sign (markdown-it's escape rule runs first).
// `escapeMarkdownText` uses `matchInlineMath` to backslash a `$` only when the
// parser would otherwise read it as a delimiter, so plain prose like
// "costs $5 and $10" round-trips byte-for-byte.

import { matchInlineMath, serializeMathBlock } from './mathSyntax';

// ── Rendering ─────────────────────────────────────────────────────────────

let renderEnabled = true;
const liveViews = new Set<MathNodeView>();

export function isMathRenderingEnabled(): boolean {
  return renderEnabled;
}

/** Toggle KaTeX rendering. Off → formulas show as their raw `$…$` source. */
export function setMathRenderingEnabled(value: boolean): void {
  if (renderEnabled === value) {return;}
  renderEnabled = value;
  for (const v of liveViews) {v.render();}
}

function renderInto(el: HTMLElement, latex: string, displayMode: boolean): void {
  el.classList.remove('has-error', 'is-empty', 'is-raw');
  if (!latex.trim()) {
    el.classList.add('is-empty');
    el.textContent = displayMode ? 'Empty formula, click to edit' : '$ $';
    return;
  }
  if (!renderEnabled) {
    el.classList.add('is-raw');
    el.textContent = displayMode ? serializeMathBlock(latex) : `$${latex}$`;
    return;
  }
  try {
    katex.render(latex, el, { displayMode, throwOnError: true, trust: false, output: 'htmlAndMathml' });
  } catch (err) {
    el.classList.add('has-error');
    el.textContent = displayMode ? latex : `$${latex}$`;
    el.title = err instanceof Error ? err.message : String(err);
  }
}

class MathNodeView implements NodeView {
  dom: HTMLElement;
  private rendered: HTMLElement;
  private input: HTMLInputElement | HTMLTextAreaElement | null = null;
  private preview: HTMLElement | null = null;

  constructor(
    private node: PmNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private displayMode: boolean
  ) {
    this.dom = document.createElement(displayMode ? 'div' : 'span');
    this.dom.className = displayMode ? 'mikedown-math-block' : 'mikedown-math-inline';
    this.dom.setAttribute('contenteditable', 'false');
    this.rendered = document.createElement(displayMode ? 'div' : 'span');
    this.rendered.className = 'mikedown-math-rendered';
    this.dom.appendChild(this.rendered);
    this.dom.addEventListener('mousedown', (e) => {
      if (this.input) {return;}
      e.preventDefault();
      this.startEditing();
    });
    liveViews.add(this);
    this.render();
    if (node.attrs.editOnMount) {
      // Freshly inserted empty node (slash command / `$$ ` rule): open the editor.
      setTimeout(() => this.startEditing(), 0);
    }
  }

  render(): void {
    if (this.input) {return;}
    renderInto(this.rendered, this.node.attrs.latex as string, this.displayMode);
  }

  update(node: PmNode): boolean {
    if (node.type !== this.node.type) {return false;}
    const changed = node.attrs.latex !== this.node.attrs.latex;
    this.node = node;
    if (changed) {this.render();}
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('is-selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('is-selected');
  }

  startEditing(): void {
    if (this.input || !this.view.editable) {return;}
    const latex = this.node.attrs.latex as string;
    this.dom.classList.add('is-editing');
    this.rendered.style.display = 'none';

    if (this.displayMode) {
      const ta = document.createElement('textarea');
      ta.className = 'mikedown-math-input';
      ta.value = latex;
      ta.rows = Math.max(2, latex.split('\n').length);
      ta.spellcheck = false;
      ta.placeholder = 'LaTeX, e.g. \\int_0^1 x^2\\,dx';
      this.preview = document.createElement('div');
      this.preview.className = 'mikedown-math-preview';
      renderInto(this.preview, latex, true);
      ta.addEventListener('input', () => {
        ta.rows = Math.max(2, ta.value.split('\n').length);
        if (this.preview) {renderInto(this.preview, ta.value, true);}
      });
      this.input = ta;
      this.dom.append(ta, this.preview);
    } else {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'mikedown-math-input';
      inp.value = latex;
      inp.spellcheck = false;
      inp.placeholder = 'LaTeX';
      inp.size = Math.max(4, latex.length + 1);
      inp.addEventListener('input', () => { inp.size = Math.max(4, inp.value.length + 1); });
      this.input = inp;
      this.dom.appendChild(inp);
    }

    const input = this.input;
    input.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Escape') {
        ke.preventDefault();
        this.finishEditing(false);
      } else if (ke.key === 'Enter' && (!this.displayMode || ke.metaKey || ke.ctrlKey)) {
        ke.preventDefault();
        this.finishEditing(true);
      }
    });
    input.addEventListener('blur', () => this.finishEditing(true));
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  private finishEditing(commit: boolean): void {
    const input = this.input;
    if (!input) {return;}
    const value = input.value;
    this.input = null;
    input.remove();
    this.preview?.remove();
    this.preview = null;
    this.dom.classList.remove('is-editing');
    this.rendered.style.display = '';

    const pos = this.getPos();
    if (pos == null) {return;}
    const { state } = this.view;
    let tr = state.tr;
    if (commit && !value.trim()) {
      tr = tr.delete(pos, pos + this.node.nodeSize);
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
    } else {
      if (commit && value !== this.node.attrs.latex) {
        tr = tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, latex: value, editOnMount: false });
      } else if (this.node.attrs.editOnMount) {
        tr = tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, editOnMount: false });
        tr.setMeta('addToHistory', false);
      }
      // Park the cursor just after the formula so typing continues naturally.
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(pos + this.node.nodeSize)));
    }
    this.view.dispatch(tr);
    this.render();
    this.view.focus();
  }

  stopEvent(event: Event): boolean {
    // Clicks open the editor (handled above), so PM must not also act on them.
    if (event.type === 'mousedown') {return true;}
    // Let the embedded input handle its own keys, clicks, and paste.
    return this.input !== null && event.target instanceof globalThis.Node && this.input.contains(event.target);
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    liveViews.delete(this);
  }
}

// ── markdown-it rules ─────────────────────────────────────────────────────

function escAttr(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function mathMarkdownIt(md: any): void {
  // After `escape` so `\$` is already consumed as a literal dollar sign.
  md.inline.ruler.after('escape', 'math_inline', (state: any, silent: boolean) => {
    const m = matchInlineMath(state.src, state.pos);
    if (!m) {return false;}
    if (!silent) {
      const token = state.push('math_inline', '', 0);
      token.content = m.latex;
    }
    state.pos = m.end;
    return true;
  });

  md.block.ruler.before(
    'fence',
    'math_block',
    (state: any, startLine: number, endLine: number, silent: boolean) => {
      let pos = state.bMarks[startLine] + state.tShift[startLine];
      let max = state.eMarks[startLine];
      if (state.sCount[startLine] - state.blkIndent >= 4) {return false;}
      if (state.src.slice(pos, pos + 2) !== '$$') {return false;}
      pos += 2;
      const firstLine = state.src.slice(pos, max);
      let latex: string;
      let nextLine = startLine;

      // One-liner: `$$ x^2 $$`
      if (firstLine.trim().endsWith('$$') && firstLine.trim().length > 2) {
        const t = firstLine.trim();
        latex = t.slice(0, -2).trim();
      } else {
        const lines: string[] = [];
        if (firstLine.trim()) {lines.push(firstLine.trim());}
        let found = false;
        for (nextLine = startLine + 1; nextLine < endLine; nextLine++) {
          pos = state.bMarks[nextLine] + state.tShift[nextLine];
          max = state.eMarks[nextLine];
          if (pos < max && state.sCount[nextLine] < state.blkIndent) {break;}
          const line = state.src.slice(pos, max);
          if (line.trimEnd().endsWith('$$')) {
            const before = line.trimEnd().slice(0, -2);
            if (before.trim()) {lines.push(before.trimEnd());}
            found = true;
            break;
          }
          lines.push(state.src.slice(state.bMarks[nextLine] + Math.min(state.tShift[nextLine], state.blkIndent), max));
        }
        if (!found) {return false;}
        latex = lines.join('\n');
      }
      if (silent) {return true;}
      state.line = nextLine + 1;
      const token = state.push('math_block', 'div', 0);
      token.block = true;
      token.content = latex;
      token.map = [startLine, state.line];
      return true;
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] }
  );

  md.renderer.rules.math_inline = (tokens: any[], idx: number) =>
    `<span data-math-inline data-latex="${escAttr(tokens[idx].content)}"></span>`;
  md.renderer.rules.math_block = (tokens: any[], idx: number) =>
    `<div data-math-block data-latex="${escAttr(tokens[idx].content)}"></div>\n`;
}

// ── Nodes ─────────────────────────────────────────────────────────────────

const mathAttrs = () => ({
  latex: {
    default: '',
    parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? '',
    renderHTML: (attrs: { latex: string }) => ({ 'data-latex': attrs.latex }),
  },
  // Display-only: open the editor when the node first mounts. Never serialized.
  editOnMount: {
    default: false,
    parseHTML: () => false,
    renderHTML: () => ({}),
  },
});

/** Inline math matcher for the input rule: `$latex$` followed by a space or
 *  punctuation. Waiting for the character after the closing `$` means
 *  "$5-$10" never converts (the `1` rules it out), matching the parser. */
const INLINE_INPUT_RULE = /(?:^|[^\\$])(\$([^\s$](?:[^$\n]*?[^\s$\\])?)\$)([\s.,;:!?)\]])$/;

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return mathAttrs();
  },

  parseHTML() {
    return [{ tag: 'span[data-math-inline]' }];
  },

  renderHTML({ node }) {
    return ['span', { 'data-math-inline': '', 'data-latex': node.attrs.latex }, `$${node.attrs.latex}$`];
  },

  addNodeView() {
    return ({ node, view, getPos }) => new MathNodeView(node, view, getPos as () => number | undefined, false);
  },

  addInputRules() {
    return [
      new InputRule({
        find: INLINE_INPUT_RULE,
        handler: ({ state, range, match }) => {
          const start = range.from + match[0].indexOf(match[1]);
          const node = this.type.create({ latex: match[2] });
          state.tr.replaceWith(start, range.to, [node, state.schema.text(match[3])]);
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    // Enter on a selected formula (inline or block) opens its editor.
    return { Enter: () => editSelectedMath(this.editor) };
  },


  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: PmNode) {
          state.write(`$${node.attrs.latex}$`);
        },
        parse: {
          setup(md: any) {
            mathMarkdownIt(md);
          },
        },
      },
    };
  },
});

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return mathAttrs();
  },

  parseHTML() {
    return [{ tag: 'div[data-math-block]' }];
  },

  renderHTML({ node }) {
    return ['div', { 'data-math-block': '', 'data-latex': node.attrs.latex }, serializeMathBlock(node.attrs.latex)];
  },

  addNodeView() {
    return ({ node, view, getPos }) => new MathNodeView(node, view, getPos as () => number | undefined, true);
  },

  addInputRules() {
    // `$$ ` at the start of an empty paragraph → empty display-math block in edit mode.
    return [
      new InputRule({
        find: /^\$\$\s$/,
        handler: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.name !== 'paragraph' || $from.parent.textContent !== '$$') {return null;}
          const para = $from.before();
          state.tr.replaceWith(para, para + $from.parent.nodeSize, this.type.create({ latex: '', editOnMount: true }));
        },
      }),
    ];
  },


  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: PmNode) {
          state.write(serializeMathBlock(node.attrs.latex as string));
          state.closeBlock(node);
        },
        parse: {
          // Registered by MathInline's setup — one plugin covers both nodes.
        },
      },
    };
  },
});

/** Open the editor on the math node under the current NodeSelection, if any. */
export function editSelectedMath(editor: Editor): boolean {
  const sel = editor.state.selection;
  if (!(sel instanceof NodeSelection)) {return false;}
  const name = sel.node.type.name;
  if (name !== 'mathInline' && name !== 'mathBlock') {return false;}
  const dom = editor.view.nodeDOM(sel.from) as HTMLElement | null;
  dom?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  return true;
}
