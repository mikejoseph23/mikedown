/**
 * Selection rewrite (the `rewrite` AI feature): the popover that previews a
 * rewrite before it replaces the selection, the selection bubble that opens
 * it, and the highlight that marks the target while it is open.
 *
 * Transaction discipline (CLAUDE.md, brainstorm constraints 4, 5 and 7):
 *
 * - While the popover is open the target is marked with a decoration (a PM
 *   plugin in rich text, a CM state field in source mode). Nothing streams
 *   into the document and nothing touches `editor.view.dom`.
 * - Accept is one transaction: `tr.replaceRange` with the slice parsed from
 *   the markdown result in rich text, one CM change in source mode. One undo
 *   restores the original.
 * - Every new request (Retry, another variant, a new open) aborts the one
 *   before it; Esc and click-away abort too.
 *
 * The popover renders model output with `textContent` only.
 *
 * Three output modes, from the variant and the target:
 *
 * - `replace`: Accept replaces the selection (every variant but Explain).
 * - `readOnly`: Explain. Nothing changes unless Insert below is clicked,
 *   which inserts the note as a blockquote after the target's block in one
 *   transaction.
 * - `replaceDocument`: Translate with "Whole document". The target is the
 *   body without its frontmatter; Accept replaces the body in one
 *   transaction, puts the cursor at its start and scrolls to the top. A body
 *   too long for the model's context is cut by `budgetDocument`: the first
 *   part is translated, the rest is kept as it is, and a note says so.
 *
 * Two document jobs (the `summary` and `title` features) open the same
 * popover on a cursor target (`cursorInsertTarget`, `sourceCursorTarget`):
 *
 * - `insert` (`/summary`, `/outline`, "Summarize document…"): the summary
 *   streams into the preview; Insert puts the block at the cursor's block
 *   boundary in one transaction that also removes `/query`. TL;DR ⇄ Outline
 *   in the header runs again.
 * - `choose` (`/title`, "Suggest titles…"): three candidates; a click hands
 *   the title to the caller's `apply` (frontmatter `title:`, the H1, or a
 *   new H1). One JSON repair round trip when the reply does not parse.
 */

import { Extension, elementFromString, posToDOMRect, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { DOMParser as PmDOMParser, Fragment, type Node as PmNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration as CmDecoration, EditorView as CmEditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import {
  CHARS_PER_TOKEN,
  DEFAULT_CONTEXT_TOKENS,
  aiErrorCopy,
  aiLengthLimitCopy,
  budgetDocument,
  buildSummaryMessages,
  buildTitleMessages,
  coveragePercent,
  finalizeSummary,
  headingsOutline,
  jsonRepairMessages,
  makeAiError,
  parseTitles,
  renderHeadingOutline,
  summaryMaxTokens,
  summaryVisibleText,
  thinkingChoices,
  titleMaxTokens,
  toAiError,
  type AiSummaryKind,
} from './ai';
import type { AiError, AiErrorCopy, AiMessage, AiRouteOk, AiServedBy, AiThinkingLevel } from './ai';
import {
  AI_AUDIENCES,
  AI_REWRITE_VARIANTS,
  REWRITE_CONTEXT_CHARS,
  buildRewriteMessages,
  finalizeRewriteText,
  getAiAudience,
  getAiRewriteVariant,
  rewriteMaxTokens,
  rewriteVisibleText,
  type AiAudience,
  type AiRewriteGroup,
  type AiRewriteParams,
  type AiRewriteVariant,
  type AiRewriteVariantDefinition,
} from './ai/prompts/rewrite';
import { buildExplainMessages, explainMaxTokens } from './ai/prompts/explain';
import { checkMarkdownStructure, type StructureDiff, type StructureMismatch } from './ai/prompts/structureCheck';
import type { AiFeatureAvailability, AiRunEvents, AiRunOutcome, AiRunRequest, AiRunThinking } from './ai-request';
import { aiRunThinkingOn } from './ai-request';
import {
  loadAudience,
  rememberAudience,
  rememberLanguage,
  rememberSessionThinking,
  sessionThinkingLevel,
  translateLanguageChoices,
} from './ai-prefs';
import { getPortal } from './portal';

/**
 * A target range; `id` tells one open target from the next. An `anchor` is
 * a caret position (from === to) that follows edits and is never dropped.
 */
interface Range { from: number; to: number; id: number; anchor?: boolean }

let nextTargetId = 0;

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

const setCmRewriteRange = StateEffect.define<Range | null>();

const cmRewriteRange = StateField.define<Range | null>({
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

// ── Targets ─────────────────────────────────────────────────────────────────

/** What the popover rewrites: one selection, or the whole body, in one view. */
export interface AiRewriteTarget {
  mode: 'rich' | 'source';
  /**
   * `document`: the whole body without its frontmatter (whole-document
   * translate). `cursor`: a caret or a `/query`, where a document job inserts.
   */
  scope: 'selection' | 'document' | 'cursor';
  /** The selection (or the body) as markdown. */
  text: string;
  before: string;
  after: string;
  /** More than one line: the popover shows old and new side by side. */
  multiline: boolean;
  /** False once the target text is gone (deleted, or the view was replaced). */
  alive(): boolean;
  /** Where the target is on screen now (null when it cannot be measured). */
  rect(): DOMRect | null;
  /** Replace the target in one transaction. False when the target is gone. */
  accept(markdown: string): boolean;
  /**
   * Insert `markdown` as a blockquote after the target's block (rich text) or
   * line (source), in one transaction. False when the target is gone or has
   * no block (a document target).
   */
  insertBelow(markdown: string): boolean;
  /** The document title, context for Explain (set by the caller). */
  title?: string;
  /** Drop the highlight. */
  release(): void;
  /** Give the keyboard back to the editor. */
  focus(): void;
}

function serializeFragment(editor: Editor, fragment: Fragment): string {
  const storage = (editor.storage as unknown as Record<string, { serializer?: { serialize(f: Fragment): string } }>).markdown;
  try {
    const md = storage?.serializer?.serialize(fragment);
    if (typeof md === 'string') {return md;}
  } catch { /* fall through to plain text */ }
  return fragment.textBetween(0, fragment.size, '\n\n');
}

/**
 * `doc` from `from` to `to` as markdown. The serializer only writes marks
 * (links, bold, code...) inside a text block, so a range within one block is
 * wrapped in a plain paragraph first: its marks survive and no block syntax
 * (a heading's `#`) is added. Code keeps its text as is.
 */
function serializeRange(editor: Editor, doc: PmNode, from: number, to: number): string {
  const content = doc.slice(from, to).content;
  const parent = doc.resolve(from).parent;
  const paragraph = editor.state.schema.nodes.paragraph;
  if (content.firstChild?.isInline && !parent.type.spec.code && paragraph) {
    return serializeFragment(editor, Fragment.from(paragraph.create(null, content)));
  }
  return serializeFragment(editor, content);
}

type MarkdownStorage = {
  parser?: { parse(md: string, o?: { inline?: boolean }): string };
  getMarkdown?(): string;
};

function markdownStorage(editor: Editor): MarkdownStorage | undefined {
  return (editor.storage as unknown as Record<string, MarkdownStorage>).markdown;
}

/** Markdown parsed into block content for the editor's schema. */
function parseBlocks(editor: Editor, markdown: string): Fragment {
  const html = markdownStorage(editor)?.parser?.parse(markdown) ?? markdown;
  return PmDOMParser.fromSchema(editor.state.schema).parse(elementFromString(html)).content;
}

/** The text as a Markdown blockquote: every line quoted, blank lines kept as `>`. */
export function blockquoteMarkdown(text: string): string {
  return text.trim().split('\n').map((line) => (line.trim() ? `> ${line}` : '>')).join('\n');
}

/** A thin rect along the top of the visible part of `el`: where a document target "is". */
function visibleTopRect(el: Element): DOMRect {
  const r = el.getBoundingClientRect();
  const top = Math.max(r.top, 8);
  return new DOMRect(r.left, top, Math.max(1, r.width), 1);
}

function rectUnion(a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }): DOMRect {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return new DOMRect(left, top, Math.max(a.right, b.right) - left, Math.max(a.bottom, b.bottom) - top);
}

/**
 * The rich-text selection as a rewrite target, or null when there is nothing
 * to rewrite. An empty selection takes the text block around the caret.
 */
export function richRewriteTarget(editor: Editor): AiRewriteTarget | null {
  const { state } = editor;
  const sel = state.selection;
  // Table cell selections rewrite cell by cell badly; select the text instead.
  if ('$anchorCell' in sel) {return null;}
  let from = sel.from;
  let to = sel.to;
  if (sel.empty) {
    const $f = sel.$from;
    if (!$f.parent.isTextblock || $f.parent.type.spec.code || !$f.parent.textContent.trim()) {return null;}
    from = $f.start();
    to = $f.end();
  }
  const doc = state.doc;
  // Prose only: an image or another atom on its own is not rewritten.
  if (!doc.textBetween(from, to, ' ').trim()) {return null;}
  const text = serializeRange(editor, doc, from, to);
  if (!text.trim()) {return null;}

  // Context: the enclosing top-level block plus one on each side.
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  const beforeStart = $from.depth > 0 ? $from.posAtIndex(Math.max(0, $from.index(0) - 1), 0) : 0;
  const afterEnd = $to.depth > 0 ? $to.posAtIndex(Math.min(doc.childCount, $to.index(0) + 2), 0) : doc.content.size;
  const before = beforeStart < from ? serializeRange(editor, doc, beforeStart, from) : '';
  const after = afterEnd > to ? serializeRange(editor, doc, to, afterEnd) : '';

  const id = ++nextTargetId;
  editor.view.dispatch(state.tr.setMeta(aiRewriteHighlightKey, { range: { from, to, id } }).setMeta('addToHistory', false));
  const range = (): Range | null => {
    if (editor.isDestroyed) {return null;}
    const r = aiRewriteHighlightKey.getState(editor.state);
    return r && r.id === id ? r : null;
  };

  return {
    mode: 'rich',
    scope: 'selection',
    text,
    before,
    after,
    multiline: text.trim().includes('\n'),
    alive: () => !!range(),
    rect() {
      const r = range();
      if (!r) {return null;}
      try { return posToDOMRect(editor.view, r.from, r.to); } catch { return null; }
    },
    accept(markdown) {
      const r = range();
      if (!r || editor.isDestroyed) {return false;}
      const current = editor.state;
      const html = markdownStorage(editor)?.parser?.parse(markdown, { inline: true }) ?? markdown;
      const slice = PmDOMParser.fromSchema(current.schema).parseSlice(elementFromString(html), {
        preserveWhitespace: true,
        context: current.doc.resolve(r.from),
      });
      // Blocks replacing whole text blocks replace the blocks themselves, so
      // no empty paragraph is left behind.
      let { from, to } = r;
      const $a = current.doc.resolve(from);
      const $b = current.doc.resolve(to);
      if (slice.content.firstChild?.isBlock && $a.parent.isTextblock && $b.parent.isTextblock
        && $a.parentOffset === 0 && $b.parentOffset === $b.parent.content.size
        && $a.depth === $b.depth && $a.node($a.depth - 1) === $b.node($b.depth - 1)) {
        from = $a.before();
        to = $b.after();
      }
      // One transaction, its own undo step.
      const tr = closeHistory(current.tr).replaceRange(from, to, slice);
      tr.setMeta(aiRewriteHighlightKey, { range: null });
      const end = tr.mapping.map(to, 1);
      try {
        tr.setSelection(TextSelection.between(tr.doc.resolve(Math.min(from, tr.doc.content.size)), tr.doc.resolve(Math.min(end, tr.doc.content.size))));
      } catch { /* keep the mapped selection */ }
      editor.view.dispatch(tr.scrollIntoView());
      return true;
    },
    insertBelow(markdown) {
      const r = range();
      if (!r || editor.isDestroyed) {return false;}
      const current = editor.state;
      const content = parseBlocks(editor, blockquoteMarkdown(markdown));
      if (!content.size) {return false;}
      // After the top-level block that holds the end of the target, so a
      // selection inside a list or a table gets its note after the whole block.
      const $to = current.doc.resolve(r.to);
      const pos = $to.depth > 0 ? $to.after(1) : r.to;
      editor.view.dispatch(closeHistory(current.tr).insert(pos, content).scrollIntoView());
      return true;
    },
    release() {
      if (!range()) {return;}
      editor.view.dispatch(editor.state.tr.setMeta(aiRewriteHighlightKey, { range: null }).setMeta('addToHistory', false));
    },
    focus() {
      if (!editor.isDestroyed) {editor.view.focus();}
    },
  };
}

/** The source-mode selection as a rewrite target. An empty selection takes its line. */
export function sourceRewriteTarget(view: CmEditorView): AiRewriteTarget | null {
  const { state } = view;
  const sel = state.selection.main;
  let { from, to } = sel;
  if (sel.empty) {
    const line = state.doc.lineAt(from);
    if (!line.text.trim()) {return null;}
    from = line.from;
    to = line.to;
  }
  const text = state.sliceDoc(from, to);
  if (!text.trim()) {return null;}
  const before = state.sliceDoc(Math.max(0, from - REWRITE_CONTEXT_CHARS * 2), from);
  const after = state.sliceDoc(to, Math.min(state.doc.length, to + REWRITE_CONTEXT_CHARS * 2));

  const id = ++nextTargetId;
  view.dispatch({ effects: setCmRewriteRange.of({ from, to, id }) });
  const range = (): Range | null => {
    const r = view.state.field(cmRewriteRange, false);
    return r && r.id === id ? r : null;
  };

  return {
    mode: 'source',
    scope: 'selection',
    text,
    before,
    after,
    multiline: text.trim().includes('\n'),
    alive: () => !!range(),
    rect() {
      const r = range();
      if (!r) {return null;}
      const a = view.coordsAtPos(r.from);
      const b = view.coordsAtPos(r.to, -1);
      if (!a || !b) {return a ? rectUnion(a, a) : b ? rectUnion(b, b) : null;}
      // A multi-line range spans the content's width.
      if (b.top > a.top + 1) {
        const content = view.contentDOM.getBoundingClientRect();
        return rectUnion(a, { ...b, left: content.left, right: Math.max(a.right, b.right) });
      }
      return rectUnion(a, b);
    },
    accept(markdown) {
      const r = range();
      if (!r) {return false;}
      // One CM transaction, isolated in history so one undo restores it.
      view.dispatch({
        changes: { from: r.from, to: r.to, insert: markdown },
        selection: { anchor: r.from, head: r.from + markdown.length },
        effects: setCmRewriteRange.of(null),
        annotations: isolateHistory.of('full'),
        userEvent: 'input.ai',
        scrollIntoView: true,
      });
      return true;
    },
    insertBelow(markdown) {
      const r = range();
      if (!r) {return false;}
      const doc = view.state.doc;
      // A selection that ends at the start of a line belongs to the line before.
      const endLine = doc.lineAt(r.to);
      const line = r.to > r.from && endLine.from === r.to ? doc.lineAt(r.to - 1) : endLine;
      const next = line.number < doc.lines ? doc.line(line.number + 1) : null;
      // A blank line before the quote, and one after it when text follows directly.
      const insert = `\n\n${blockquoteMarkdown(markdown)}${next && next.text.trim() ? '\n' : ''}`;
      view.dispatch({
        changes: { from: line.to, insert },
        annotations: isolateHistory.of('full'),
        userEvent: 'input.ai',
        scrollIntoView: true,
      });
      return true;
    },
    release() {
      if (range()) {view.dispatch({ effects: setCmRewriteRange.of(null) });}
    },
    focus() {
      view.focus();
    },
  };
}

/**
 * The rich-text body as a whole-document target. The frontmatter is not in
 * the ProseMirror document (the editor keeps it apart), so Accept leaves it
 * byte-identical. `scrollToTop` runs after Accept to show the top of the page.
 */
export function richDocumentTarget(editor: Editor, opts: { scrollToTop?: () => void } = {}): AiRewriteTarget | null {
  if (editor.isDestroyed) {return null;}
  const text = markdownStorage(editor)?.getMarkdown?.() ?? editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n\n');
  if (!text.trim()) {return null;}
  return {
    mode: 'rich',
    scope: 'document',
    text,
    before: '',
    after: '',
    multiline: false,
    alive: () => !editor.isDestroyed,
    rect: () => (editor.isDestroyed ? null : visibleTopRect(editor.view.dom)),
    accept(markdown) {
      if (editor.isDestroyed) {return false;}
      const current = editor.state;
      const content = parseBlocks(editor, markdown);
      if (!content.size) {return false;}
      // One transaction, its own undo step; the caret goes to the start of
      // the body and the view scrolls there (D13).
      const tr = closeHistory(current.tr).replaceWith(0, current.doc.content.size, content);
      tr.setMeta(aiRewriteHighlightKey, { range: null });
      tr.setSelection(TextSelection.atStart(tr.doc));
      editor.view.dispatch(tr.scrollIntoView());
      opts.scrollToTop?.();
      return true;
    },
    insertBelow: () => false,
    release() { /* no highlight */ },
    focus() {
      if (!editor.isDestroyed) {editor.view.focus();}
    },
  };
}

/**
 * The source-mode body as a whole-document target. `bodyStart` gives where
 * the body starts in the full text (after the frontmatter); only the body is
 * sent and replaced, so the YAML stays byte-identical.
 */
export function sourceDocumentTarget(view: CmEditorView, bodyStart: (markdown: string) => number): AiRewriteTarget | null {
  const full = view.state.doc.toString();
  const text = full.slice(bodyStart(full));
  if (!text.trim()) {return null;}
  return {
    mode: 'source',
    scope: 'document',
    text,
    before: '',
    after: '',
    multiline: false,
    alive: () => view.dom.isConnected,
    rect: () => visibleTopRect(view.scrollDOM),
    accept(markdown) {
      const current = view.state.doc.toString();
      const from = bodyStart(current);
      // One CM transaction, isolated in history; caret at the start of the
      // body, view at the top.
      view.dispatch({
        changes: { from, to: current.length, insert: markdown },
        selection: { anchor: from },
        effects: [setCmRewriteRange.of(null), CmEditorView.scrollIntoView(0, { y: 'start' })],
        annotations: isolateHistory.of('full'),
        userEvent: 'input.ai',
      });
      return true;
    },
    insertBelow: () => false,
    release() { /* no highlight */ },
    focus() {
      view.focus();
    },
  };
}

/** Where a document job inserts: the caret, or the `/query` it replaces. */
export interface AiCursorTarget extends AiRewriteTarget {
  /** The `/query` (from < to) or the caret (from === to), mapped through edits; null once gone. */
  range(): { from: number; to: number } | null;
}

/**
 * The rich-text caret, or a slash command's `/query`, as an insert target.
 * The `/query` is marked while the popover is open and stays in the
 * document until Accept, which removes it (with a mid-line trigger space)
 * and inserts the blocks in one transaction: in place of the caret's
 * top-level block when that is left an empty paragraph, else after it.
 * Cancel leaves the document untouched.
 */
export function cursorInsertTarget(editor: Editor, slash?: { from: number; to: number }): AiCursorTarget | null {
  if (editor.isDestroyed) {return null;}
  const { state } = editor;
  const id = ++nextTargetId;
  const head = state.selection.head;
  const initial: Range = slash && slash.to > slash.from
    ? { from: slash.from, to: slash.to, id }
    : { from: head, to: head, id, anchor: true };
  editor.view.dispatch(state.tr.setMeta(aiRewriteHighlightKey, { range: initial }).setMeta('addToHistory', false));
  const range = (): Range | null => {
    if (editor.isDestroyed) {return null;}
    const r = aiRewriteHighlightKey.getState(editor.state);
    return r && r.id === id ? r : null;
  };

  return {
    mode: 'rich',
    scope: 'cursor',
    text: '',
    before: '',
    after: '',
    multiline: false,
    alive: () => !!range(),
    range() {
      const r = range();
      return r ? { from: r.from, to: r.to } : null;
    },
    rect() {
      const r = range();
      if (!r) {return null;}
      try { return posToDOMRect(editor.view, r.from, r.to); } catch { return null; }
    },
    accept(markdown) {
      const r = range();
      if (!r || editor.isDestroyed) {return false;}
      const content = parseBlocks(editor, markdown);
      if (!content.size) {return false;}
      const current = editor.state;
      // One transaction, its own undo step: `/query` out, the blocks in.
      const tr = closeHistory(current.tr);
      let at = r.from;
      if (r.to > r.from) {
        const $q = current.doc.resolve(r.from);
        if ($q.parentOffset > 0 && current.doc.textBetween(r.from - 1, r.from) === ' ') {at = r.from - 1;}
        tr.delete(at, r.to);
      }
      tr.setMeta(aiRewriteHighlightKey, { range: null });
      const $at = tr.doc.resolve(Math.min(at, tr.doc.content.size));
      let from = $at.pos;
      let to = $at.pos;
      if ($at.depth > 0) {
        const block = $at.node(1);
        const empty = block.type.name === 'paragraph' && block.content.size === 0;
        from = empty ? $at.before(1) : $at.after(1);
        to = empty ? $at.after(1) : from;
      }
      tr.replaceWith(from, to, content);
      const end = Math.min(from + content.size, tr.doc.content.size);
      try { tr.setSelection(TextSelection.near(tr.doc.resolve(end), -1)); } catch { /* keep the mapped selection */ }
      editor.view.dispatch(tr.scrollIntoView());
      return true;
    },
    insertBelow: () => false,
    release() {
      if (!range()) {return;}
      editor.view.dispatch(editor.state.tr.setMeta(aiRewriteHighlightKey, { range: null }).setMeta('addToHistory', false));
    },
    focus() {
      if (!editor.isDestroyed) {editor.view.focus();}
    },
  };
}

/**
 * The source-mode caret as an insert target. Accept puts the markdown at the
 * caret's line in one CM transaction: in place of a blank line, else after
 * the line, with blank lines around it. A caret inside the frontmatter
 * inserts at the start of the body (`bodyStart`).
 */
export function sourceCursorTarget(view: CmEditorView, bodyStart?: (markdown: string) => number): AiCursorTarget {
  const id = ++nextTargetId;
  const head = view.state.selection.main.head;
  view.dispatch({ effects: setCmRewriteRange.of({ from: head, to: head, id, anchor: true }) });
  const range = (): Range | null => {
    const r = view.state.field(cmRewriteRange, false);
    return r && r.id === id ? r : null;
  };

  return {
    mode: 'source',
    scope: 'cursor',
    text: '',
    before: '',
    after: '',
    multiline: false,
    alive: () => !!range() && view.dom.isConnected,
    range() {
      const r = range();
      return r ? { from: r.from, to: r.to } : null;
    },
    rect() {
      const r = range();
      const c = r ? view.coordsAtPos(r.from) : null;
      return c ? rectUnion(c, c) : null;
    },
    accept(markdown) {
      const r = range();
      const md = markdown.trim();
      if (!r || !md) {return false;}
      const doc = view.state.doc;
      const start = bodyStart ? bodyStart(doc.toString()) : 0;
      const line = doc.lineAt(Math.max(r.from, Math.min(start, doc.length)));
      const prev = line.number > 1 ? doc.line(line.number - 1) : null;
      const next = line.number < doc.lines ? doc.line(line.number + 1) : null;
      const textAfter = !!next && !!next.text.trim();
      let changes: { from: number; to?: number; insert: string };
      let caret: number;
      if (!line.text.trim()) {
        const lead = prev && prev.text.trim() && line.from >= start ? '\n' : '';
        changes = { from: line.from, to: line.to, insert: `${lead}${md}${textAfter ? '\n' : ''}` };
        caret = line.from + lead.length + md.length;
      } else {
        changes = { from: line.to, insert: `\n\n${md}${textAfter ? '\n' : ''}` };
        caret = line.to + 2 + md.length;
      }
      // One CM transaction, isolated in history so one undo removes it.
      view.dispatch({
        changes,
        selection: { anchor: caret },
        effects: setCmRewriteRange.of(null),
        annotations: isolateHistory.of('full'),
        userEvent: 'input.ai',
        scrollIntoView: true,
      });
      return true;
    },
    insertBelow: () => false,
    release() {
      if (range()) {view.dispatch({ effects: setCmRewriteRange.of(null) });}
    },
    focus() {
      view.focus();
    },
  };
}

// ── Titles ──────────────────────────────────────────────────────────────────

/** What a picked title changes (D12): frontmatter `title:` wins, then the first H1, else a new H1. */
export type AiTitleEffect = 'frontmatter' | 'h1' | 'insertH1';

/** The one-line hint under the candidates, naming the effect before the click. */
export const AI_TITLE_EFFECT_HINTS: Record<AiTitleEffect, string> = {
  frontmatter: 'Sets title: in Properties',
  h1: 'Replaces the H1',
  insertH1: 'Inserts an H1',
};

/** True when the frontmatter YAML has a top-level `title:` key. */
export function yamlHasTitle(yaml: string | null | undefined): boolean {
  return /^title[ \t]*:/m.test(yaml ?? '');
}

/**
 * The YAML with its top-level `title:` set to `title` (quoted when YAML
 * needs it). Only the title entry changes, including any indented block
 * scalar lines under it; every other line stays byte-identical. Without a
 * `title:` key the YAML comes back unchanged.
 */
export function setYamlTitle(yaml: string, title: string): string {
  const lines = yaml.split('\n');
  const i = lines.findIndex((l) => /^title[ \t]*:/.test(l));
  if (i < 0) {return yaml;}
  let end = i + 1;
  while (end < lines.length && /^[ \t]+\S/.test(lines[end])) {end++;}
  lines.splice(i, end - i, `title: ${yamlScalar(title)}`);
  return lines.join('\n');
}

function yamlScalar(s: string): string {
  const plain = !/[:#[\]{},&*!|>'"%@`]/.test(s) && !/^\s|\s$/.test(s) && !/^(-?\d+(\.\d+)?|true|false|null|yes|no|on|off|~|-.*)$/i.test(s);
  return plain && s ? s : `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Set the title in rich text in one transaction (its own undo step), removing
 * `remove` (a `/query`) in the same transaction: `h1` replaces the first
 * H1's text, `insertH1` puts a new H1 at the top. The frontmatter case is the
 * caller's (the YAML is not in the ProseMirror document).
 */
export function applyRichTitle(editor: Editor, effect: 'h1' | 'insertH1', title: string, remove?: { from: number; to: number } | null): boolean {
  if (editor.isDestroyed || !title.trim()) {return false;}
  const { schema } = editor.state;
  const heading = schema.nodes.heading;
  if (!heading) {return false;}
  const tr = closeHistory(editor.state.tr);
  if (remove && remove.to > remove.from) {tr.delete(remove.from, remove.to);}
  tr.setMeta(aiRewriteHighlightKey, { range: null });
  let h1: { pos: number; size: number } | null = null;
  if (effect === 'h1') {
    tr.doc.descendants((node, pos) => {
      if (h1) {return false;}
      if (node.type === heading && node.attrs.level === 1) {
        h1 = { pos, size: node.content.size };
        return false;
      }
      return !node.isTextblock;
    });
  }
  const found = h1 as { pos: number; size: number } | null;
  if (found) {
    tr.replaceWith(found.pos + 1, found.pos + 1 + found.size, schema.text(title));
  } else {
    tr.insert(0, heading.create({ level: 1 }, schema.text(title)));
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** The first H1 line of `markdown` from `from` on (outside fenced code), or null. */
function sourceH1Line(markdown: string, from: number): { from: number; to: number; prefix: string } | null {
  let pos = from;
  let fence: string | null = null;
  while (pos <= markdown.length) {
    const nl = markdown.indexOf('\n', pos);
    const end = nl < 0 ? markdown.length : nl;
    const line = markdown.slice(pos, end);
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.trim().slice(f[1].length).trim()) {fence = null;}
    } else if (f) {
      fence = f[1];
    } else {
      const m = /^( {0,3}#[ \t]+)/.exec(line);
      if (m) {return { from: pos, to: end, prefix: m[1] };}
    }
    if (nl < 0) {break;}
    pos = nl + 1;
  }
  return null;
}

/**
 * Set the title in source mode in one CM transaction: the frontmatter
 * `title:` line, else the first H1's text, else a new H1 at the start of the
 * body (`bodyStart`).
 */
export function applySourceTitle(view: CmEditorView, effect: AiTitleEffect, title: string, frontmatter: { yaml: string | null; bodyStart: number }): boolean {
  if (!title.trim()) {return false;}
  const full = view.state.doc.toString();
  let change: { from: number; to: number; insert: string };
  if (effect === 'frontmatter' && frontmatter.yaml !== null && yamlHasTitle(frontmatter.yaml)) {
    // The YAML sits between the opening `---` line and the closing one.
    const yamlFrom = full.indexOf('\n') + 1;
    change = { from: yamlFrom, to: yamlFrom + frontmatter.yaml.length, insert: setYamlTitle(frontmatter.yaml, title) };
  } else {
    const h1 = effect === 'insertH1' ? null : sourceH1Line(full, frontmatter.bodyStart);
    change = h1
      ? { from: h1.from + h1.prefix.length, to: h1.to, insert: title }
      : { from: frontmatter.bodyStart, to: frontmatter.bodyStart, insert: `# ${title}\n\n` };
  }
  view.dispatch({
    changes: change,
    effects: setCmRewriteRange.of(null),
    annotations: isolateHistory.of('full'),
    userEvent: 'input.ai',
  });
  return true;
}

// ── Icons ───────────────────────────────────────────────────────────────────

const icon = (body: string, size = 14) => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const SPARK = icon('<path d="M8 2.2l1.25 3.3 3.3 1.25-3.3 1.25L8 11.3 6.75 8 3.45 6.75 6.75 5.5z"/><path d="M12.6 10.6l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z"/>');
const CHEVRON = icon('<path d="M4.5 6.5L8 10l3.5-3.5"/>', 12);
const CLOSE = icon('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>', 12);
const LOCAL = icon('<path d="M2.5 7.5L8 3l5.5 4.5M4 6.5V13h8V6.5"/>', 11);
const CLOUD = icon('<path d="M4.5 12.5h7a2.75 2.75 0 0 0 .3-5.48A4 4 0 0 0 4.1 7.6 2.5 2.5 0 0 0 4.5 12.5z"/>', 11);
const ALERT = icon('<path d="M8 2.5l6 10.5H2z"/><path d="M8 6.5v3M8 11.4v.1"/>', 16);
const WARN = icon('<path d="M8 2.5l6 10.5H2z"/><path d="M8 6.5v3M8 11.4v.1"/>', 12);
const BACK = icon('<path d="M9.5 4L5.5 8l4 4"/>', 14);
const CHECK = icon('<path d="M3.5 8.5l3 3 6-7"/>', 12);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {node.className = className;}
  if (text !== undefined) {node.textContent = text;}
  return node;
}

function button(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  // Keep the editor's selection and focus where they are until the action runs.
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') !== 'true') {onClick();} });
  return b;
}

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
}

/** The rewrite hotkey as shown in menus. */
export function rewriteHotkeyLabel(): string {
  return isMacPlatform() ? '⌥⌘K' : 'Ctrl+Alt+K';
}

// ── Grouped variants ────────────────────────────────────────────────────────

const GROUP_LABELS: Record<AiRewriteGroup, string> = {
  length: 'Length',
  tone: 'Tone',
  audience: 'Audience',
  translate: 'Translate',
  explain: 'Explain',
  custom: 'Custom',
};

export interface AiRewriteMenuGroup {
  group: AiRewriteGroup;
  label: string;
  variants: AiRewriteVariantDefinition[];
}

/** `AI_REWRITE_VARIANTS` in menu order, one entry per group (Length, Tone, …, Custom). */
export function aiRewriteMenuGroups(): AiRewriteMenuGroup[] {
  const groups: AiRewriteMenuGroup[] = [];
  for (const v of AI_REWRITE_VARIANTS) {
    let g = groups.find((x) => x.group === v.group);
    if (!g) {
      g = { group: v.group, label: GROUP_LABELS[v.group], variants: [] };
      groups.push(g);
    }
    g.variants.push(v);
  }
  return groups;
}

/** Variants whose result is checked for dropped links, code, list items and the like. */
const STRUCTURE_CHECKED = new Set<AiRewriteVariant>(['translate', 'simpler', 'formal', 'casual', 'expand']);

const STRUCTURE_NOUNS: Record<StructureMismatch['kind'], [string, string]> = {
  heading: ['heading', 'headings'],
  fencedCodeBlock: ['code block', 'code blocks'],
  inlineCode: ['inline code span', 'inline code spans'],
  link: ['link', 'links'],
  image: ['image', 'images'],
  listItem: ['list item', 'list items'],
  tableRow: ['table row', 'table rows'],
  wikilink: ['wikilink', 'wikilinks'],
  footnote: ['footnote reference', 'footnote references'],
};

/**
 * The warning line for a structure diff ("Check: 1 link missing in the
 * result"), or '' when nothing differs. Headings of every level count as one.
 */
export function structureWarningText(diff: StructureDiff): string {
  if (diff.ok) {return '';}
  const byKind = new Map<StructureMismatch['kind'], { original: number; result: number; message: string }>();
  for (const m of diff.mismatches) {
    const seen = byKind.get(m.kind);
    if (seen) {
      seen.original += m.original;
      seen.result += m.result;
    } else {
      byKind.set(m.kind, { original: m.original, result: m.result, message: m.message });
    }
  }
  const parts: string[] = [];
  for (const [kind, m] of byKind) {
    const [one, many] = STRUCTURE_NOUNS[kind];
    const d = m.original - m.result;
    const noun = Math.abs(d) === 1 ? one : many;
    if (d > 0) {parts.push(`${d} ${noun} missing in the result`);}
    else if (d < 0) {parts.push(`${-d} extra ${noun} in the result`);}
    else if (kind === 'link' || kind === 'image') {parts.push(`${many} point somewhere else in the result`);}
    else {parts.push(`${many} differ in the result`);}
  }
  return `Check: ${parts.join('; ')}`;
}

/**
 * Output budget for a whole-document translation: about the body's length
 * again, more than `rewriteMaxTokens` allows a selection. A host that cannot
 * take it answers `contextOverflow` or stops at the length limit.
 */
function documentMaxTokens(text: string): number {
  return Math.max(1024, Math.min(16384, Math.ceil((text.length / CHARS_PER_TOKEN) * 1.6) + 256));
}

/** Tokens kept for the system prompt, the instructions and slack around a budgeted document. */
const DOCUMENT_RESERVE_TOKENS = 768;

/**
 * Fit a whole-document translation to the model's context. The answer is
 * about as long as what is sent, so when the body does not fit beside its
 * own `documentMaxTokens` the context is split: about 1 part sent to 1.6
 * parts answer. Returns the part to send, the output budget and what is left.
 */
export function budgetTranslation(body: string, contextTokens: number): { text: string; rest: string; coverage: number; maxTokens: number } {
  let maxTokens = documentMaxTokens(body);
  let b = budgetDocument(body, { contextTokens, outputTokens: maxTokens, reserveTokens: DOCUMENT_RESERVE_TOKENS });
  if (b.truncated) {
    const room = Math.max(0, contextTokens - DOCUMENT_RESERVE_TOKENS);
    maxTokens = Math.max(1024, Math.min(16384, Math.floor((room * 1.6) / 2.6)));
    b = budgetDocument(body, { contextTokens, outputTokens: maxTokens, reserveTokens: DOCUMENT_RESERVE_TOKENS });
    if (b.truncated) {maxTokens = Math.min(maxTokens, documentMaxTokens(b.text));}
  }
  return b.truncated
    ? { text: b.text, rest: body.slice(b.text.length), coverage: b.coverage, maxTokens }
    : { text: body, rest: '', coverage: 1, maxTokens };
}

/** The coverage line for a budgeted document job, or '' when all of it was sent. */
export function coverageNoteText(job: 'summary' | 'titles' | 'translate', coverage: number): string {
  if (coverage >= 1) {return '';}
  const pct = coveragePercent(coverage);
  if (job === 'translate') {return `Translates the first ${pct}% of the document; the rest did not fit the model's context and stays as it is.`;}
  if (job === 'titles') {return `Based on the first ${pct}% of the document and all of its headings; the rest did not fit the model's context.`;}
  return `Covers the first ${pct}% of the document; the rest did not fit the model's context.`;
}

// ── Popover ─────────────────────────────────────────────────────────────────

export interface AiRewriteBadge {
  where: 'local' | 'cloud' | null;
  text: string;
  title: string;
  fallback: boolean;
}

export interface AiRewritePopoverDeps {
  run(req: AiRunRequest, events: AiRunEvents, signal: AbortSignal): Promise<AiRunOutcome>;
  /** Header badge for the route about to serve (before the result) or what served. */
  badge(route: AiRouteOk | null, served: AiServedBy | null, viaFallback: boolean): AiRewriteBadge | null;
  onServed(served: AiServedBy, viaFallback: boolean): void;
  openSettings(): void;
  /** The whole body as a target (Translate's "Whole document"); absent hides the toggle. */
  documentTarget?(): AiRewriteTarget | null;
  /**
   * The routed model for `feature`, before sending: its context window (null
   * when unknown, then `DEFAULT_CONTEXT_TOKENS`) and whether it has a JSON
   * mode. Absent: the defaults.
   */
  routeInfo?(feature: string): { contextTokens: number | null; json: boolean };
}

/** `/summary` and `/outline`: what to summarise. */
export interface AiSummaryJob {
  /** The document body as markdown (frontmatter left out). */
  markdown: string;
  kind: AiSummaryKind;
}

/** `/title`: what to title, and what a pick does. */
export interface AiTitleJob {
  /** The document body as markdown (frontmatter left out). */
  markdown: string;
  /** The current title, so the model does not hand it back. */
  existingTitle?: string;
  /** What a pick changes; named in the hint under the list. */
  effect: AiTitleEffect;
  /** Set the picked title (one undo step). False when nothing changed. */
  apply(title: string): boolean;
}

/** What to run when the popover opens; a parameterised variant without its parameter opens its picker. */
export interface AiRewriteChoice {
  variant: AiRewriteVariant;
  instruction?: string;
  params?: AiRewriteParams;
  /** Translate the whole document instead of the selection. */
  wholeDocument?: boolean;
}

export interface AiRewritePopover {
  /** Open on a target: with a variant it runs at once (or opens its picker), without one it shows the choices. */
  open(target: AiRewriteTarget, choice?: AiRewriteChoice): void;
  /** Open on a target to say why rewrite cannot run (AI on, no usable route). */
  openUnavailable(target: AiRewriteTarget, reason: string): void;
  /** `insert` mode: summarise the document and insert the block at the target. */
  openSummary(target: AiRewriteTarget, job: AiSummaryJob): void;
  /** `choose` mode: suggest three titles; a click applies one. */
  openTitles(target: AiRewriteTarget, job: AiTitleJob): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

type Phase = 'choose' | 'running' | 'done' | 'error';
type Picker = 'language' | 'audience';
type OutputMode = 'replace' | 'readOnly' | 'replaceDocument' | 'insert' | 'choose';
/** What the popover is running: a rewrite variant, a summary, or title suggestions. */
type Job = 'rewrite' | 'summary' | 'titles';

const SUMMARY_KIND_LABELS: Record<AiSummaryKind, string> = { tldr: 'TL;DR', outline: 'Outline' };
const REPAIR_NOTE = 'Fixing the answer format…';

/** True when `params` holds what `def` needs. */
function hasParam(def: AiRewriteVariantDefinition | undefined, params: AiRewriteParams): boolean {
  if (def?.param === 'language') {return !!params.language?.trim();}
  if (def?.param === 'audience') {return !!params.audience && !!getAiAudience(params.audience);}
  return true;
}

const plainLabel = (label: string): string => label.replace(/…$/, '');

/** The dial's segment label: `thinkingChoices` labels, Medium shortened to fit the header. */
const thinkingSegmentLabel = (label: string): string => (label === 'Medium' ? 'Med' : label);

/** The level a route ran with: what the request sent, else the model's own. */
function thinkingInEffect(t: AiRunThinking | null): AiThinkingLevel | null {
  return t ? t.sent ?? t.configured : null;
}

export function createAiRewritePopover(deps: AiRewritePopoverDeps): AiRewritePopover {
  let target: AiRewriteTarget | null = null;
  let root: HTMLElement | null = null;
  let phase: Phase = 'choose';
  let variant: AiRewriteVariant = 'shorter';
  let instruction = '';
  let params: AiRewriteParams = {};
  let picker: Picker | null = null;
  let wholeDocument = false;
  /** Opened on the document itself (no selection): only the language picker applies. */
  let docOnly = false;
  let controller: AbortController | null = null;
  let runSeq = 0;
  let raw = '';
  let finalText = '';
  let route: AiRouteOk | null = null;
  let served: AiServedBy | null = null;
  let viaFallback = false;
  /** The thinking dial for the current route; null hides it (no mapping, tier-1 host, no route yet). */
  let thinking: AiRunThinking | null = null;
  let error: AiError | null = null;
  /** Copy that replaces the error code's own (an answer that never came, out of room). */
  let errorCopy: AiErrorCopy | null = null;
  /** The error is the router's: nothing can serve, so the fix is in settings. */
  let unavailable = false;
  let note = '';
  let warning: { text: string; title: string } | null = null;
  let job: Job = 'rewrite';
  let summaryJob: AiSummaryJob | null = null;
  let titleJob: AiTitleJob | null = null;
  let titles: string[] = [];
  /** Share of the document sent (summary, titles, whole-document translate); 1 when all of it fit. */
  let coverage = 1;
  /** What the rewrite was asked about: the selection, or the part of the body that fit. */
  let sentText = '';
  /** A whole-document translation cut to fit: the rest of the body, kept as it is on Accept. */
  let untranslated = '';
  /** The title job's JSON repair round trip is running (D16). */
  let repairing = false;
  let side: 'below' | 'above' | null = null;
  let frame = 0;
  let copiedTimer: number | undefined;
  let detach: Array<() => void> = [];

  // Parts rebuilt per open.
  let titleEl: HTMLElement;
  let badgeEl: HTMLElement;
  let thinkEl: HTMLElement;
  let chooseEl: HTMLElement;
  let menuEl: HTMLElement;
  let formEl: HTMLFormElement;
  let pickerEl: HTMLElement;
  let inputEl: HTMLInputElement;
  let bodyEl: HTMLElement;
  let oldTextEl: HTMLElement;
  let outEl: HTMLElement;
  let newLabelEl: HTMLElement;
  let newPaneEl: HTMLElement;
  let errorEl: HTMLElement;
  let warnEl: HTMLElement;
  let footEl: HTMLElement;
  let acceptBtn: HTMLButtonElement;
  let retryBtn: HTMLButtonElement;
  let copyBtn: HTMLButtonElement;
  let noteEl: HTMLElement;
  let hintEl: HTMLElement;
  let liveEl: HTMLElement;
  let kindEl: HTMLElement;
  let coverageEl: HTMLElement;
  let titlesBoxEl: HTMLElement;
  let titlesEl: HTMLElement;
  let titleHintEl: HTMLElement;

  function abort(): void {
    runSeq += 1;
    controller?.abort();
    controller = null;
  }

  function close(opts: { refocus?: boolean } = {}): void {
    if (!target) {return;}
    abort();
    cancelAnimationFrame(frame);
    window.clearTimeout(copiedTimer);
    for (const off of detach) {off();}
    detach = [];
    root?.remove();
    root = null;
    const t = target;
    target = null;
    picker = null;
    t.release();
    if (opts.refocus !== false) {t.focus();}
  }

  function outputMode(): OutputMode {
    if (job === 'summary') {return 'insert';}
    if (job === 'titles') {return 'choose';}
    if (getAiRewriteVariant(variant)?.output === 'readOnly') {return 'readOnly';}
    return target?.scope === 'document' ? 'replaceDocument' : 'replace';
  }

  function build(): HTMLElement {
    const box = el('div', 'mikedown-ai-rewrite');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Rewrite with AI');
    box.tabIndex = -1;

    const head = el('div', 'ai-rw-head');
    const spark = el('span', 'ai-rw-spark');
    spark.innerHTML = SPARK;
    titleEl = el('span', 'ai-rw-title', 'Rewrite');
    thinkEl = el('div', 'ai-rw-think');
    thinkEl.setAttribute('role', 'group');
    thinkEl.setAttribute('aria-label', 'Thinking');
    thinkEl.hidden = true;
    badgeEl = el('span', 'ai-rw-badge');
    badgeEl.hidden = true;
    const closeBtn = button('ai-rw-icon-btn', '', () => close());
    closeBtn.innerHTML = CLOSE;
    closeBtn.setAttribute('aria-label', 'Cancel (Esc)');
    closeBtn.title = 'Cancel (Esc)';
    // TL;DR ⇄ Outline for a summary; picking the other one runs again.
    kindEl = el('div', 'ai-rw-kind');
    kindEl.setAttribute('role', 'group');
    kindEl.setAttribute('aria-label', 'Summary kind');
    kindEl.hidden = true;
    for (const k of ['tldr', 'outline'] as const) {
      const seg = button('ai-rw-kind-seg', SUMMARY_KIND_LABELS[k], () => pickKind(k));
      seg.dataset.kind = k;
      seg.title = k === 'tldr' ? 'A short TL;DR of the document (runs again)' : 'An outline of the document (runs again)';
      kindEl.append(seg);
    }
    head.append(spark, titleEl, kindEl, thinkEl, badgeEl, closeBtn);

    // First level: one row per group (Length, Tone, Audience, Translate,
    // Explain), then the custom prompt. Second level: the picker.
    chooseEl = el('div', 'ai-rw-choose');
    menuEl = el('div', 'ai-rw-menu');
    menuEl.setAttribute('role', 'menu');
    menuEl.setAttribute('aria-label', 'Rewrite options');
    for (const g of aiRewriteMenuGroups()) {
      if (g.group === 'custom') {continue;}
      const section = el('div', 'ai-rw-group');
      section.dataset.group = g.group;
      section.setAttribute('role', 'group');
      section.setAttribute('aria-label', g.label);
      const heading = el('div', 'ai-rw-group-label', g.label);
      heading.setAttribute('aria-hidden', 'true');
      const chips = el('div', 'ai-rw-chips');
      for (const v of g.variants) {
        const chip = button('ai-rw-chip', v.label, () => choose(v));
        chip.setAttribute('role', 'menuitem');
        chip.dataset.variant = v.id;
        if (v.param) {chip.setAttribute('aria-haspopup', 'menu');}
        chips.append(chip);
      }
      section.append(heading, chips);
      menuEl.append(section);
    }
    formEl = el('form', 'ai-rw-form');
    inputEl = el('input', 'ai-rw-input');
    inputEl.type = 'text';
    inputEl.placeholder = 'Describe a change, e.g. "make it friendlier"';
    inputEl.setAttribute('aria-label', 'Custom rewrite instruction');
    inputEl.maxLength = 1000;
    const go = button('ai-rw-btn ai-rw-btn--primary', 'Rewrite', () => submitCustom());
    formEl.append(inputEl, go);
    formEl.addEventListener('submit', (e) => { e.preventDefault(); submitCustom(); });
    pickerEl = el('div', 'ai-rw-picker');
    chooseEl.append(menuEl, formEl, pickerEl);

    bodyEl = el('div', 'ai-rw-body');
    const oldPane = el('div', 'ai-rw-pane ai-rw-pane--old');
    oldTextEl = el('div', 'ai-rw-text');
    oldPane.append(el('div', 'ai-rw-label', 'Original'), oldTextEl);
    newPaneEl = el('div', 'ai-rw-pane ai-rw-pane--new');
    const newText = el('div', 'ai-rw-text');
    outEl = el('span', 'ai-rw-out');
    newText.append(outEl, el('span', 'ai-rw-caret'));
    newLabelEl = el('div', 'ai-rw-label', 'Rewrite');
    newPaneEl.append(newLabelEl, newText);
    bodyEl.append(oldPane, newPaneEl);

    // Title candidates, and what a pick changes.
    titlesBoxEl = el('div', 'ai-rw-titles-box');
    titlesEl = el('div', 'ai-rw-titles');
    titlesEl.setAttribute('role', 'menu');
    titlesEl.setAttribute('aria-label', 'Suggested titles');
    titleHintEl = el('div', 'ai-rw-titles-hint');
    titlesBoxEl.append(titlesEl, titleHintEl);

    errorEl = el('div', 'ai-rw-error');
    errorEl.setAttribute('role', 'alert');

    coverageEl = el('div', 'ai-rw-coverage');

    warnEl = el('div', 'ai-rw-warn');

    footEl = el('div', 'ai-rw-foot');
    acceptBtn = button('ai-rw-btn ai-rw-btn--primary', 'Accept', () => accept());
    retryBtn = button('ai-rw-btn', 'Retry', () => rerun());
    copyBtn = button('ai-rw-btn', 'Copy', () => copy());
    noteEl = el('span', 'ai-rw-note');
    hintEl = el('span', 'ai-rw-hint', 'Esc to cancel');
    footEl.append(acceptBtn, retryBtn, copyBtn, noteEl, hintEl);

    liveEl = el('div', 'ai-rw-sr');
    liveEl.setAttribute('aria-live', 'polite');

    box.append(head, chooseEl, bodyEl, titlesBoxEl, errorEl, coverageEl, warnEl, footEl, liveEl);
    return box;
  }

  function submitCustom(): void {
    const text = inputEl.value.trim();
    if (!text) { inputEl.focus(); return; }
    start('custom', text);
  }

  /** A first-level choice: a parameterised variant opens its picker, the rest run. */
  function choose(def: AiRewriteVariantDefinition): void {
    if (def.param) {
      openPicker(def.param === 'language' ? 'language' : 'audience');
      return;
    }
    start(def.id);
  }

  // ── Second-level pickers ───────────────────────────────────────────────

  function pickerOption(label: string, checked: boolean, onPick: () => void): HTMLButtonElement {
    const b = button('ai-rw-option', '', onPick);
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-checked', checked ? 'true' : 'false');
    const mark = el('span', 'ai-rw-option-check');
    mark.innerHTML = CHECK;
    b.append(mark, el('span', 'ai-rw-option-label', label));
    return b;
  }

  function pickerSeparator(): HTMLElement {
    const sep = el('div', 'ai-rw-option-sep');
    sep.setAttribute('role', 'separator');
    return sep;
  }

  function renderPicker(): void {
    if (!picker) { pickerEl.replaceChildren(); return; }
    const head = el('div', 'ai-rw-picker-head');
    const back = button('ai-rw-icon-btn ai-rw-back', '', () => closePicker());
    back.innerHTML = BACK;
    back.setAttribute('aria-label', 'Back (Esc)');
    back.title = 'Back (Esc)';
    back.hidden = docOnly;
    head.append(back, el('span', 'ai-rw-picker-title', picker === 'language' ? 'Translate to' : 'Reading level'));

    const list = el('div', 'ai-rw-picker-list');
    list.setAttribute('role', 'menu');
    list.setAttribute('aria-label', picker === 'language' ? 'Language' : 'Audience');
    const parts: HTMLElement[] = [head, list];

    if (picker === 'language') {
      const { recents, languages } = translateLanguageChoices();
      // The last language used is the default: checked and focused.
      recents.forEach((lang, i) => list.append(pickerOption(lang, i === 0, () => pickLanguage(lang))));
      if (recents.length) {list.append(pickerSeparator());}
      for (const lang of languages) {list.append(pickerOption(lang, false, () => pickLanguage(lang)));}
      list.append(pickerSeparator());
      const otherForm = el('form', 'ai-rw-form ai-rw-other');
      otherForm.hidden = true;
      const otherInput = el('input', 'ai-rw-input');
      otherInput.type = 'text';
      otherInput.placeholder = 'Language, e.g. Swahili';
      otherInput.setAttribute('aria-label', 'Other language');
      otherInput.maxLength = 60;
      otherForm.append(otherInput, button('ai-rw-btn ai-rw-btn--primary', 'Translate', () => pickLanguage(otherInput.value)));
      otherForm.addEventListener('submit', (e) => { e.preventDefault(); pickLanguage(otherInput.value); });
      const other = button('ai-rw-option ai-rw-option--other', '', () => {
        otherForm.hidden = false;
        other.setAttribute('aria-expanded', 'true');
        otherInput.focus();
        position();
      });
      other.setAttribute('role', 'menuitem');
      other.setAttribute('aria-expanded', 'false');
      other.append(el('span', 'ai-rw-option-check'), el('span', 'ai-rw-option-label', 'Other…'));
      list.append(other);
      parts.push(otherForm);

      if (docOnly || deps.documentTarget) {
        const toggle = el('label', 'ai-rw-toggle');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = wholeDocument;
        box.disabled = docOnly;
        box.addEventListener('change', () => { wholeDocument = box.checked; });
        toggle.append(box, el('span', '', 'Whole document'));
        toggle.title = docOnly ? 'Nothing is selected, so the whole document is translated.' : 'Translate the whole document instead of the selection (frontmatter is kept).';
        const foot = el('div', 'ai-rw-picker-foot');
        foot.append(toggle);
        parts.push(foot);
      }
    } else {
      const remembered = loadAudience();
      for (const a of AI_AUDIENCES) {list.append(pickerOption(a.label, a.id === remembered, () => pickAudience(a.id)));}
    }
    pickerEl.replaceChildren(...parts);
  }

  function openPicker(kind: Picker): void {
    picker = kind;
    variant = kind === 'language' ? 'translate' : 'readingLevel';
    phase = 'choose';
    renderPicker();
    render();
    position();
    const items = [...pickerEl.querySelectorAll<HTMLButtonElement>('.ai-rw-picker-list > button')];
    (items.find((b) => b.getAttribute('aria-checked') === 'true') ?? items[0])?.focus({ preventScroll: true });
  }

  function closePicker(): void {
    if (docOnly) { close(); return; }
    const was = variant;
    picker = null;
    renderPicker();
    render();
    position();
    menuEl.querySelector<HTMLButtonElement>(`.ai-rw-chip[data-variant="${was}"]`)?.focus({ preventScroll: true });
  }

  function pickLanguage(language: string): void {
    const lang = language.replace(/\s+/g, ' ').trim();
    if (!lang) {
      pickerEl.querySelector<HTMLInputElement>('.ai-rw-other .ai-rw-input')?.focus();
      return;
    }
    params = { language: lang };
    if (wholeDocument && !useDocumentTarget()) {return;}
    start('translate');
  }

  function pickAudience(audience: AiAudience): void {
    params = { audience };
    start('readingLevel');
  }

  /** Swap the selection target for the whole body. False when there is no body to translate. */
  function useDocumentTarget(): boolean {
    if (!target) {return false;}
    if (target.scope === 'document') {return true;}
    const doc = deps.documentTarget?.() ?? null;
    if (!doc) {return false;}
    target.release();
    target = doc;
    side = null;
    return true;
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  function headTitle(): string {
    if (job === 'summary') {return summaryJob?.kind === 'outline' ? 'Outline' : 'Summary';}
    if (job === 'titles') {return 'Suggest titles';}
    if (unavailable) {return 'Rewrite';}
    if (phase === 'choose') {return picker === 'language' ? 'Translate' : picker === 'audience' ? 'Reading level' : 'Rewrite';}
    if (variant === 'explain') {return 'Explain';}
    if (variant === 'custom') {return 'Rewrite · Custom';}
    if (variant === 'translate') {
      return `Translate · ${params.language ?? ''}${target?.scope === 'document' ? ' · Whole document' : ''}`;
    }
    if (variant === 'readingLevel') {
      return `Reading level · ${(params.audience && getAiAudience(params.audience)?.label) ?? ''}`;
    }
    return `Rewrite · ${plainLabel(getAiRewriteVariant(variant)?.label ?? '')}`;
  }

  /** The thinking dial: one segment per level the route's kind can express, the level in effect pressed. */
  function renderThinking(): void {
    const choices = thinking && phase !== 'choose' ? thinkingChoices(thinking.kind) : [];
    thinkEl.hidden = choices.length === 0;
    if (choices.length === 0) {return;}
    const current = thinkingInEffect(thinking);
    const label = el('span', 'ai-rw-think-label', 'Thinking');
    label.setAttribute('aria-hidden', 'true');
    const segments = choices.map((c) => {
      const seg = button('ai-rw-think-seg', thinkingSegmentLabel(c.label), () => pickThinking(c.level));
      seg.dataset.level = c.level;
      seg.setAttribute('aria-pressed', c.level === current ? 'true' : 'false');
      seg.title = `Thinking: ${c.label} (runs again)`;
      return seg;
    });
    thinkEl.title = current
      ? `Thinking: ${choices.find((c) => c.level === current)?.label ?? current}${thinking?.sent ? '' : ' (the model\'s setting)'}`
      : 'Thinking: the model\'s default';
    thinkEl.replaceChildren(label, ...segments);
  }

  function renderBadge(): void {
    renderThinking();
    const b = deps.badge(route, served, served ? viaFallback : route?.viaFallback ?? false);
    badgeEl.hidden = !b;
    if (!b) {return;}
    badgeEl.dataset.where = b.where ?? '';
    badgeEl.classList.toggle('is-pending', !served);
    // Name the level that served ("... oMLX · Qwen3 30B, on this network. Thinking: low.").
    const level = served ? thinkingInEffect(thinking) : null;
    const levelLabel = level && thinking ? thinkingChoices(thinking.kind).find((c) => c.level === level)?.label : undefined;
    badgeEl.title = levelLabel ? `${b.title} Thinking: ${levelLabel.toLowerCase()}.` : b.title;
    const glyph = el('span', 'ai-rw-badge-glyph');
    glyph.innerHTML = b.where === 'cloud' ? CLOUD : LOCAL;
    const text = el('span', 'ai-rw-badge-text', b.text);
    const parts: Node[] = [glyph, text];
    if (b.fallback) {parts.push(el('span', 'ai-rw-badge-fallback', '(fallback)'));}
    badgeEl.replaceChildren(...parts);
  }

  function renderOut(): void {
    // Titles stream as JSON: only a placeholder until the list shows.
    const shown = job === 'titles' ? ''
      : job === 'summary' ? summaryVisibleText(raw).trim()
        : phase === 'done' ? finalText.trim() : rewriteVisibleText(raw).trimStart();
    outEl.textContent = shown;
    newPaneEl.classList.toggle('is-waiting', phase === 'running' && !shown);
    if (phase === 'running' && !shown) {
      const name = deps.badge(route, null, false)?.text.split(' · ')[1];
      outEl.textContent = '';
      outEl.dataset.placeholder = repairing ? REPAIR_NOTE
        : job === 'titles' && raw ? 'Suggesting titles…'
          : name ? `Waiting for ${name}…` : 'Waiting for the engine…';
    } else {
      delete outEl.dataset.placeholder;
    }
    // Follow the stream unless the reader scrolled up.
    const scroller = outEl.parentElement;
    if (scroller && phase === 'running' && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }

  function scheduleOut(): void {
    if (frame) {return;}
    frame = requestAnimationFrame(() => { frame = 0; if (root) {renderOut();} });
  }

  function render(): void {
    if (!root || !target) {return;}
    const mode = outputMode();
    root.dataset.phase = phase;
    root.dataset.output = mode;
    // Side by side only for a multi-line selection being replaced: not for
    // Explain (nothing is replaced) nor a whole document (too long).
    root.dataset.layout = mode === 'replace' && target.multiline ? 'split' : 'single';
    root.setAttribute('aria-busy', phase === 'running' ? 'true' : 'false');
    root.setAttribute('aria-label', job === 'summary' ? 'Summarize with AI'
      : job === 'titles' ? 'Suggest titles with AI'
        : variant === 'explain' && phase !== 'choose' ? 'Explain with AI' : 'Rewrite with AI');
    titleEl.textContent = headTitle();
    if (variant === 'custom' && instruction && phase !== 'choose') {titleEl.title = instruction;} else {titleEl.removeAttribute('title');}
    chooseEl.hidden = phase !== 'choose';
    menuEl.hidden = !!picker;
    formEl.hidden = !!picker;
    pickerEl.hidden = !picker;
    bodyEl.hidden = phase === 'choose' || phase === 'error' || (mode === 'choose' && phase === 'done');
    titlesBoxEl.hidden = !(mode === 'choose' && phase === 'done');
    kindEl.hidden = job !== 'summary';
    for (const seg of kindEl.querySelectorAll<HTMLElement>('.ai-rw-kind-seg')) {
      seg.setAttribute('aria-pressed', seg.dataset.kind === summaryJob?.kind ? 'true' : 'false');
    }
    errorEl.hidden = phase !== 'error';
    footEl.hidden = phase === 'choose' || phase === 'error';
    newLabelEl.textContent = mode === 'readOnly' ? 'Explanation' : variant === 'translate' ? 'Translation' : 'Rewrite';
    renderBadge();
    renderOut();

    const ready = phase === 'done' && !!finalText.trim();
    acceptBtn.hidden = phase === 'error' || mode === 'choose';
    acceptBtn.setAttribute('aria-disabled', ready ? 'false' : 'true');
    acceptBtn.textContent = mode === 'readOnly' ? 'Insert below'
      : mode === 'insert' ? 'Insert'
        : mode === 'replaceDocument' ? 'Replace document' : 'Accept';
    acceptBtn.title = mode === 'readOnly'
      ? 'Insert the explanation as a quote below the selection'
      : mode === 'insert' ? 'Insert at the cursor (Enter)'
        : mode === 'replaceDocument' ? 'Replace the document body; frontmatter is kept (Enter)' : 'Replace the selection (Enter)';
    copyBtn.hidden = phase === 'error' || mode === 'choose';
    copyBtn.setAttribute('aria-disabled', (phase === 'done' ? finalText : rewriteVisibleText(raw)).trim() ? 'false' : 'true');
    retryBtn.hidden = phase === 'error';
    noteEl.textContent = repairing ? REPAIR_NOTE : note;

    // What part of the document was sent, when not all of it fit.
    const covered = job === 'rewrite' ? (target.scope === 'document' ? 'translate' : null) : job;
    const covText = covered && (phase === 'running' || phase === 'done') ? coverageNoteText(covered, coverage) : '';
    coverageEl.hidden = !covText;
    coverageEl.textContent = covText;
    hintEl.textContent = mode === 'readOnly' ? 'Esc to close' : 'Esc to cancel';

    // The structure check, between the preview and the footer. A warning
    // only: Accept stays enabled.
    warnEl.hidden = !(phase === 'done' && warning);
    if (phase === 'done' && warning) {
      const glyph = el('span', 'ai-rw-warn-icon');
      glyph.innerHTML = WARN;
      warnEl.replaceChildren(glyph, el('span', 'ai-rw-warn-text', warning.text));
      warnEl.title = warning.title;
    }

    if (phase === 'error' && error) {renderError(error);}
  }

  function renderError(e: AiError): void {
    const copyText: AiErrorCopy = unavailable
      ? { title: 'No engine can rewrite right now', message: e.message, action: 'openSettings' as const }
      : errorCopy ?? aiErrorCopy(e.code);
    const iconEl = el('span', 'ai-rw-error-icon');
    iconEl.innerHTML = ALERT;
    const textBox = el('div', 'ai-rw-error-text');
    textBox.append(el('div', 'ai-rw-error-title', copyText.title));
    // The router's reason or the host's detail, when it says more than the generic copy.
    const detail = e.message && e.message !== copyText.message ? e.message : '';
    textBox.append(el('div', 'ai-rw-error-message', e.code === 'unknown' && detail ? detail : copyText.message));
    if (detail && e.code !== 'unknown') {textBox.append(el('div', 'ai-rw-error-detail', detail));}
    if (e.code === 'contextOverflow' && target) {
      const what = target.scope === 'selection' ? 'The selection' : 'The document';
      const size = job === 'summary' ? summaryJob?.markdown.length ?? 0
        : job === 'titles' ? titleJob?.markdown.length ?? 0 : target.text.length;
      textBox.append(el('div', 'ai-rw-error-detail', `${what} is ${size.toLocaleString()} characters.`));
    }
    const actions = el('div', 'ai-rw-error-actions');
    const settingsBtn = button(`ai-rw-btn${copyText.action === 'openSettings' ? ' ai-rw-btn--primary' : ''}`, 'Open AI settings', () => {
      close({ refocus: false });
      deps.openSettings();
    });
    actions.append(settingsBtn);
    if (!unavailable && copyText.action !== 'shortenSelection' && e.code !== 'cloudBlocked') {
      actions.append(button(`ai-rw-btn${copyText.action === 'retry' ? ' ai-rw-btn--primary' : ''}`, e.code === 'badOutput' ? 'Try again' : 'Retry', () => rerun()));
    }
    actions.append(button('ai-rw-btn', 'Close', () => close()));
    errorEl.replaceChildren(iconEl, textBox, actions);
  }

  function position(): void {
    if (!root || !target) {return;}
    if (!target.alive()) { close({ refocus: false }); return; }
    const rect = target.rect();
    // Not measurable right now (scrolled out of a virtualised view): stay put.
    if (!rect) {return;}
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 8;
    const w = root.offsetWidth || 440;
    const h = root.offsetHeight || 200;
    // Pick a side once, with room for the tallest state, so streaming never flips it.
    if (!side) {
      const reserve = Math.min(vh * 0.55, 380);
      side = rect.bottom + gap + reserve <= vh - gap || rect.top - gap - reserve < gap ? 'below' : 'above';
    }
    let top = side === 'below' ? rect.bottom + gap : rect.top - gap - h;
    top = Math.max(gap, Math.min(top, vh - h - gap));
    const left = Math.max(gap, Math.min(rect.left, vw - w - gap));
    root.style.top = `${Math.round(top)}px`;
    root.style.left = `${Math.round(left)}px`;
  }

  /** Arrow keys, Home and End move between the chips of the first level, the picker's rows or the titles. */
  function moveFocus(e: KeyboardEvent): boolean {
    const inTitles = outputMode() === 'choose' && phase === 'done';
    if (!root || (phase !== 'choose' && !inTitles) || !/^(Arrow(Up|Down|Left|Right)|Home|End)$/.test(e.key)) {return false;}
    const selector = inTitles ? '.ai-rw-titles > button' : picker ? '.ai-rw-picker-list > button' : '.ai-rw-menu .ai-rw-chip';
    const items = [...root.querySelectorAll<HTMLButtonElement>(selector)];
    const i = items.indexOf(e.target as HTMLButtonElement);
    if (i < 0) {return false;}
    const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
        : (i + (forward ? 1 : -1) + items.length) % items.length;
    items[next].focus({ preventScroll: true });
    return true;
  }

  function mount(t: AiRewriteTarget): void {
    close({ refocus: false });
    target = t;
    side = null;
    raw = '';
    finalText = '';
    route = null;
    served = null;
    viaFallback = false;
    thinking = null;
    error = null;
    unavailable = false;
    note = '';
    warning = null;
    picker = null;
    params = {};
    variant = 'shorter';
    instruction = '';
    docOnly = t.scope === 'document';
    wholeDocument = docOnly;
    job = 'rewrite';
    summaryJob = null;
    titleJob = null;
    titles = [];
    coverage = 1;
    sentText = '';
    untranslated = '';
    repairing = false;
    root = build();
    getPortal().appendChild(root);

    const onKey = (e: KeyboardEvent): void => {
      if (!root) {return;}
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        // Esc in a picker goes back to the first level.
        if (phase === 'choose' && picker) {closePicker();} else {close();}
        return;
      }
      if (root.contains(e.target as Node) && moveFocus(e)) {
        e.preventDefault();
        return;
      }
      // Enter accepts a replacement or inserts a summary; Explain inserts
      // only on an explicit click, and a title is picked on its own row.
      const mode = outputMode();
      if (e.key === 'Enter' && phase === 'done' && mode !== 'readOnly' && mode !== 'choose' && !e.shiftKey && !e.altKey) {
        const t2 = e.target as HTMLElement | null;
        const inField = !!t2 && (t2.tagName === 'INPUT' || t2.tagName === 'TEXTAREA');
        const onOtherButton = !!t2 && t2.tagName === 'BUTTON' && t2 !== acceptBtn && root.contains(t2);
        if ((!inField && !onOtherButton) || e.metaKey || e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
          accept();
        }
      }
    };
    const onDown = (e: MouseEvent): void => {
      if (root && !root.contains(e.target as Node)) {close({ refocus: false });}
    };
    const onMove = (): void => position();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('resize', onMove);
    document.addEventListener('scroll', onMove, true);
    detach.push(
      () => document.removeEventListener('keydown', onKey, true),
      () => document.removeEventListener('mousedown', onDown, true),
      () => window.removeEventListener('resize', onMove),
      () => document.removeEventListener('scroll', onMove, true),
    );
  }

  /** A dial change: remembered for this kind for the session, then the same run again (like Retry). */
  function pickThinking(level: AiThinkingLevel): void {
    if (!thinking || phase === 'choose') {return;}
    if (level === thinkingInEffect(thinking)) {return;}
    rememberSessionThinking(thinking.kind, level);
    // Pressed at once; the route's answer confirms it.
    thinking = { ...thinking, sent: level };
    rerun();
  }

  /** Run the current job again (Retry, Try again, the thinking dial). */
  function rerun(): void {
    if (job === 'summary') {startSummary();}
    else if (job === 'titles') {startTitles();}
    else {start(variant, instruction);}
  }

  /** The routed model's context window for `feature` (unknown: `DEFAULT_CONTEXT_TOKENS`). */
  function contextTokensFor(feature: string): number {
    return deps.routeInfo?.(feature).contextTokens ?? DEFAULT_CONTEXT_TOKENS;
  }

  /** Abort what runs and reset for a new request; returns its sequence number and signal. */
  function beginRun(): { seq: number; signal: AbortSignal } {
    abort();
    const ac = new AbortController();
    controller = ac;
    phase = 'running';
    raw = '';
    finalText = '';
    served = null;
    error = null;
    errorCopy = null;
    note = '';
    warning = null;
    repairing = false;
    return { seq: runSeq, signal: ac.signal };
  }

  function runEvents(seq: number): AiRunEvents {
    return {
      onRoute: (r, th) => {
        if (seq !== runSeq) {return;}
        route = r;
        thinking = th;
        raw = '';
        renderBadge();
        renderOut();
      },
      onToken: (_delta, text) => {
        if (seq !== runSeq) {return;}
        raw = text;
        scheduleOut();
      },
    };
  }

  function noteServed(outcome: AiRunOutcome): void {
    served = outcome.result.served;
    viaFallback = outcome.viaFallback;
    thinking = outcome.thinking;
    deps.onServed(outcome.result.served, outcome.viaFallback);
  }

  function finishNote(outcome: AiRunOutcome): string {
    const reason = outcome.result.finishReason;
    if (reason === 'length') {return aiLengthLimitCopy({ thinking: aiRunThinkingOn(outcome.thinking), empty: false }).message;}
    return reason === 'error' ? 'The stream ended early.' : '';
  }

  /** An answer with no text that stopped at the length limit: the error says why. */
  function showLengthError(outcome: AiRunOutcome): void {
    const copy = aiLengthLimitCopy({ thinking: aiRunThinkingOn(outcome.thinking), empty: true });
    errorCopy = copy;
    showError(makeAiError('badOutput', copy.message));
  }

  function showError(e: AiError): void {
    phase = 'error';
    error = e;
    repairing = false;
    render();
    position();
    liveEl.textContent = `${(errorCopy ?? aiErrorCopy(e.code)).title}.`;
    errorEl.querySelector<HTMLButtonElement>('.ai-rw-btn--primary, .ai-rw-btn')?.focus({ preventScroll: true });
  }

  function runFailed(seq: number): (err: unknown) => void {
    return (err) => {
      if (seq !== runSeq || !root) {return;}
      controller = null;
      const e = toAiError(err);
      if (e.code === 'cancelled') {return;}
      showError(e);
    };
  }

  // ── Document jobs ──────────────────────────────────────────────────────

  function pickKind(kind: AiSummaryKind): void {
    if (!summaryJob || summaryJob.kind === kind) {return;}
    summaryJob.kind = kind;
    startSummary();
  }

  /** `/summary`, `/outline`: budget the body, stream the summary, Insert when done. Never retried (D16). */
  function startSummary(): void {
    const t = target;
    const sj = summaryJob;
    if (!t || !root || !sj) {return;}
    const { seq, signal } = beginRun();
    const kind = sj.kind;
    const b = budgetDocument(sj.markdown, {
      contextTokens: contextTokensFor('summary'),
      outputTokens: summaryMaxTokens(kind, sj.markdown.length),
      reserveTokens: DOCUMENT_RESERVE_TOKENS,
    });
    coverage = b.coverage;
    render();
    position();
    root.focus({ preventScroll: true });
    deps.run({
      feature: 'summary',
      messages: buildSummaryMessages({ document: b.text, kind, coverage: b.coverage }),
      maxTokens: summaryMaxTokens(kind, b.text.length),
      temperature: 0.3,
      thinking: sessionThinkingLevel,
    }, runEvents(seq), signal).then((outcome) => {
      if (seq !== runSeq || !root) {return;}
      controller = null;
      noteServed(outcome);
      raw = outcome.result.text || raw;
      const cutOff = outcome.result.finishReason === 'length';
      finalText = finalizeSummary(raw, kind, coverage, cutOff);
      if (!finalText.trim()) {
        if (cutOff) {showLengthError(outcome);} else {showError(makeAiError('badOutput'));}
        return;
      }
      phase = 'done';
      note = finishNote(outcome);
      render();
      position();
      liveEl.textContent = `${kind === 'outline' ? 'Outline' : 'Summary'} ready. Press Enter to insert or Escape to cancel.`;
      acceptBtn.focus({ preventScroll: true });
    }, runFailed(seq));
  }

  /** `/title`: budget the body (plus every heading), ask for three titles, one JSON repair round trip. */
  function startTitles(): void {
    const t = target;
    const tj = titleJob;
    if (!t || !root || !tj) {return;}
    const { seq, signal } = beginRun();
    titles = [];
    const info = deps.routeInfo?.('title');
    const outline = headingsOutline(tj.markdown);
    const b = budgetDocument(tj.markdown, {
      contextTokens: info?.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
      outputTokens: titleMaxTokens(3),
      reserveTokens: DOCUMENT_RESERVE_TOKENS + Math.ceil(renderHeadingOutline(outline).length / CHARS_PER_TOKEN),
    });
    coverage = b.coverage;
    render();
    position();
    root.focus({ preventScroll: true });
    const messages = buildTitleMessages({ document: b.text, outline, existingTitle: tj.existingTitle, count: 3 });
    const request = (msgs: AiMessage[]): Promise<AiRunOutcome> => deps.run({
      feature: 'title',
      messages: msgs,
      maxTokens: titleMaxTokens(3),
      temperature: 0.7,
      thinking: sessionThinkingLevel,
      ...(info?.json ? { format: 'json' as const } : {}),
    }, runEvents(seq), signal);
    request(messages).then(async (first) => {
      if (seq !== runSeq || !root) {return;}
      noteServed(first);
      const firstText = first.result.text || raw;
      // Nothing to repair: the model ran out of room before it answered.
      if (!rewriteVisibleText(firstText).trim() && first.result.finishReason === 'length') {
        controller = null;
        showLengthError(first);
        return;
      }
      let last = first;
      let parsed = parseTitles(firstText, tj.existingTitle);
      if (!parsed.ok) {
        // D16: one repair round trip, abortable like the first request.
        repairing = true;
        render();
        const second = await request([...messages, ...jsonRepairMessages(firstText, parsed.error)]);
        if (seq !== runSeq || !root) {return;}
        noteServed(second);
        repairing = false;
        last = second;
        parsed = parseTitles(second.result.text || raw, tj.existingTitle);
        if (!parsed.ok) {
          if (second.result.finishReason === 'length') {
            controller = null;
            showLengthError(second);
            return;
          }
          throw makeAiError('badOutput', parsed.error);
        }
      }
      controller = null;
      titles = parsed.titles.slice(0, 3);
      phase = 'done';
      note = finishNote(last);
      renderTitles();
      render();
      position();
      liveEl.textContent = `${titles.length} ${titles.length === 1 ? 'title' : 'titles'} ready. ${AI_TITLE_EFFECT_HINTS[tj.effect]}. Escape cancels.`;
      titlesEl.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    }).catch(runFailed(seq));
  }

  function renderTitles(): void {
    titlesEl.replaceChildren(...titles.map((title) => {
      const b = button('ai-rw-option ai-rw-title-option', '', () => pickTitle(title));
      b.setAttribute('role', 'menuitem');
      b.append(el('span', 'ai-rw-option-label', title));
      return b;
    }));
    titleHintEl.textContent = titleJob ? AI_TITLE_EFFECT_HINTS[titleJob.effect] : '';
  }

  function pickTitle(title: string): void {
    const t = target;
    const tj = titleJob;
    if (!t || !tj || phase !== 'done') {return;}
    const ok = tj.apply(title);
    close({ refocus: true });
    if (!ok) {t.focus();}
  }

  function start(v: AiRewriteVariant, custom?: string): void {
    const t = target;
    if (!t || !root) {return;}
    const { seq, signal } = beginRun();
    variant = v;
    instruction = v === 'custom' ? (custom ?? instruction) : '';
    picker = null;
    oldTextEl.textContent = t.scope === 'document' ? '' : t.text.trim();
    const def = getAiRewriteVariant(v);
    if (def?.param === 'language' && params.language) {rememberLanguage(params.language);}
    if (def?.param === 'audience' && params.audience) {rememberAudience(params.audience);}
    const readOnly = def?.output === 'readOnly';

    // A whole document is fitted to the routed model's context: the part
    // that fits is translated, the rest is kept as it is (coverage note).
    sentText = t.text;
    untranslated = '';
    coverage = 1;
    let maxTokens = readOnly ? explainMaxTokens() : rewriteMaxTokens(t.text, v);
    if (t.scope === 'document' && !readOnly) {
      const b = budgetTranslation(t.text, contextTokensFor('rewrite'));
      sentText = b.text;
      untranslated = b.rest;
      coverage = b.coverage;
      maxTokens = b.maxTokens;
    }
    render();
    position();
    root.focus({ preventScroll: true });

    const messages = readOnly
      ? buildExplainMessages({ selection: t.text, before: t.before, after: t.after, title: t.title })
      : buildRewriteMessages({
        variant: v,
        instruction,
        selection: sentText,
        before: t.before,
        after: t.after,
        params: def?.param ? params : undefined,
        scope: t.scope === 'document' ? 'document' : 'selection',
      });
    deps.run({
      feature: 'rewrite',
      messages,
      maxTokens,
      temperature: v === 'fixFlow' || v === 'translate' ? 0.2 : 0.5,
      thinking: sessionThinkingLevel,
    }, runEvents(seq), signal).then((outcome) => {
      if (seq !== runSeq || !root) {return;}
      controller = null;
      noteServed(outcome);
      // Explain is a note, not a version of the selection: no whitespace to carry over.
      finalText = finalizeRewriteText(outcome.result.text || raw, readOnly ? '' : sentText);
      if (!finalText.trim()) {
        phase = 'error';
        if (outcome.result.finishReason === 'length') {
          errorCopy = aiLengthLimitCopy({ thinking: aiRunThinkingOn(outcome.thinking), empty: true });
          error = makeAiError('badOutput', errorCopy.message);
        } else {
          error = { code: 'unknown', message: 'The engine sent back no text.' };
        }
      } else {
        phase = 'done';
        note = finishNote(outcome);
        if (STRUCTURE_CHECKED.has(v)) {
          const diff = checkMarkdownStructure(sentText, finalText);
          const text = structureWarningText(diff);
          warning = text ? { text, title: diff.messages.join('\n') } : null;
        }
      }
      render();
      position();
      liveEl.textContent = phase !== 'done' ? 'Rewrite failed.'
        : readOnly ? 'Explanation ready. Insert below adds it to the document; Escape closes.'
          : `${variant === 'translate' ? 'Translation' : 'Rewrite'} ready. Press Enter to accept or Escape to cancel.${warning ? ` ${warning.text}.` : ''}`;
      if (phase === 'done') {
        // Explain leaves the keyboard on the popover so Enter cannot insert by accident.
        (readOnly ? root : acceptBtn).focus({ preventScroll: true });
      }
    }, runFailed(seq));
  }

  function accept(): void {
    const t = target;
    const mode = outputMode();
    if (!t || phase !== 'done' || !finalText.trim() || mode === 'choose') {return;}
    const ok = mode === 'readOnly' ? t.insertBelow(finalText)
      // A translation cut to fit keeps the untranslated rest after it.
      : mode === 'replaceDocument' && untranslated.trim() ? t.accept(`${finalText.trimEnd()}\n\n${untranslated.trimStart()}`)
        : t.accept(finalText);
    close({ refocus: true });
    if (!ok) {t.focus();}
  }

  function copy(): void {
    const text = (phase === 'done' ? finalText : rewriteVisibleText(raw)).trim();
    if (!text) {return;}
    void navigator.clipboard?.writeText(text).then(() => {
      if (!root) {return;}
      copyBtn.textContent = 'Copied';
      window.clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
    }, () => { /* clipboard refused */ });
  }

  return {
    open(t, choice) {
      mount(t);
      params = { ...choice?.params };
      wholeDocument = docOnly || !!choice?.wholeDocument;
      const def = choice ? getAiRewriteVariant(choice.variant) : undefined;
      // The document itself (nothing selected) can only be translated.
      if (docOnly && (!def || def.id !== 'translate' || !hasParam(def, params))) {
        openPicker('language');
        return;
      }
      if (def && def.param && !hasParam(def, params)) {
        openPicker(def.param === 'language' ? 'language' : 'audience');
        return;
      }
      if (def && (def.id !== 'custom' || choice?.instruction?.trim())) {
        if (def.id === 'translate' && wholeDocument && !useDocumentTarget()) {
          wholeDocument = false;
          openPicker('language');
          return;
        }
        start(def.id, choice?.instruction);
        return;
      }
      phase = 'choose';
      render();
      position();
      inputEl.focus({ preventScroll: true });
    },
    openSummary(t, sj) {
      mount(t);
      job = 'summary';
      summaryJob = { ...sj };
      startSummary();
    },
    openTitles(t, tj) {
      mount(t);
      job = 'titles';
      titleJob = tj;
      startTitles();
    },
    openUnavailable(t, reason) {
      mount(t);
      phase = 'error';
      error = { code: 'unknown', message: reason };
      unavailable = true;
      render();
      position();
      errorEl.querySelector<HTMLButtonElement>('.ai-rw-btn')?.focus({ preventScroll: true });
    },
    close: () => close(),
    isOpen: () => !!target,
    destroy() {
      close({ refocus: false });
    },
  };
}

// ── Selection bubble ────────────────────────────────────────────────────────

export interface AiRewriteBubbleDeps {
  availability(): AiFeatureAvailability;
  /** The selection's screen rect when the bubble may show, else null. */
  selectionRect(): DOMRect | null;
  run(variant: AiRewriteVariant): void;
}

export interface AiRewriteBubble {
  /** Re-check after a selection change (debounced). */
  schedule(): void;
  hide(): void;
  destroy(): void;
}

export function createAiRewriteBubble(deps: AiRewriteBubbleDeps): AiRewriteBubble {
  let box: HTMLElement | null = null;
  let menu: HTMLElement | null = null;
  let timer: number | undefined;

  function hide(): void {
    window.clearTimeout(timer);
    menu = null;
    box?.remove();
    box = null;
  }

  function toggleMenu(): void {
    if (!box) {return;}
    if (menu) {
      menu.remove();
      menu = null;
      box.querySelector('.ai-bubble-btn')?.setAttribute('aria-expanded', 'false');
      return;
    }
    const list = el('div', 'ai-bubble-menu');
    menu = list;
    list.setAttribute('role', 'menu');
    // One run of items per group with a thin separator between groups.
    aiRewriteMenuGroups().forEach((g, i) => {
      if (i > 0) {
        const sep = el('div', 'ai-bubble-sep');
        sep.setAttribute('role', 'separator');
        list.append(sep);
      }
      for (const v of g.variants) {
        const item = button('ai-bubble-item', '', () => { hide(); deps.run(v.id); });
        item.setAttribute('role', 'menuitem');
        if (v.param) {item.setAttribute('aria-haspopup', 'dialog');}
        item.append(el('span', 'ai-bubble-item-label', v.label));
        if (v.id === 'custom') {item.append(el('span', 'ai-bubble-item-key', rewriteHotkeyLabel()));}
        list.append(item);
      }
    });
    box.append(list);
    box.querySelector('.ai-bubble-btn')?.setAttribute('aria-expanded', 'true');
  }

  function show(rect: DOMRect, availability: AiFeatureAvailability): void {
    if (!box) {
      box = el('div', 'mikedown-ai-bubble');
      const btn = button('ai-bubble-btn', '', () => toggleMenu());
      btn.setAttribute('aria-haspopup', 'menu');
      btn.setAttribute('aria-expanded', 'false');
      btn.tabIndex = -1;
      const spark = el('span', 'ai-bubble-spark');
      spark.innerHTML = SPARK;
      const chev = el('span', 'ai-bubble-chevron');
      chev.innerHTML = CHEVRON;
      btn.append(spark, el('span', 'ai-bubble-label', 'Rewrite'), chev);
      box.append(btn);
      box.addEventListener('mousedown', (e) => e.preventDefault());
      getPortal().appendChild(box);
    }
    const btn = box.querySelector<HTMLButtonElement>('.ai-bubble-btn')!;
    const disabled = availability.state === 'disabled';
    btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    btn.title = disabled ? (availability as { reason: string }).reason : `Rewrite the selection with AI (${rewriteHotkeyLabel()})`;
    if (disabled && menu) {toggleMenu();}

    const vw = window.innerWidth;
    const gap = 6;
    const h = btn.offsetHeight || 26;
    const w = btn.offsetWidth || 96;
    let top = rect.top - h - gap;
    if (top < gap) {top = rect.bottom + gap;}
    const left = Math.max(gap, Math.min(rect.left, vw - w - gap));
    box.style.top = `${Math.round(top)}px`;
    box.style.left = `${Math.round(left)}px`;
  }

  function update(): void {
    const availability = deps.availability();
    const rect = availability.state === 'hidden' ? null : deps.selectionRect();
    if (!rect || availability.state === 'hidden') { hide(); return; }
    show(rect, availability);
  }

  return {
    schedule() {
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 140);
    },
    hide,
    destroy: hide,
  };
}
