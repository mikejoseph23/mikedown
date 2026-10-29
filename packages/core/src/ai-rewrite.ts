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
 *   transaction, puts the cursor at its start and scrolls to the top.
 */

import { Extension, elementFromString, posToDOMRect, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { DOMParser as PmDOMParser, type Fragment } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration as CmDecoration, EditorView as CmEditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { aiErrorCopy, toAiError } from './ai';
import type { AiError, AiRouteOk, AiServedBy } from './ai';
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
import type { AiFeatureAvailability, AiRunEvents, AiRunOutcome, AiRunRequest } from './ai-request';
import { loadAudience, rememberAudience, rememberLanguage, translateLanguageChoices } from './ai-prefs';
import { getPortal } from './portal';

/** A target range; `id` tells one open target from the next. */
interface Range { from: number; to: number; id: number }

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
          const from = tr.mapping.map(value.from, 1);
          const to = tr.mapping.map(value.to, -1);
          return to > from ? { from, to, id: value.id } : null;
        },
      },
      props: {
        decorations(state) {
          const r = aiRewriteHighlightKey.getState(state);
          if (!r) {return null;}
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
    const from = tr.changes.mapPos(value.from, 1);
    const to = tr.changes.mapPos(value.to, -1);
    return to > from ? { from, to, id: value.id } : null;
  },
  provide: (f) => CmEditorView.decorations.from(f, (r) => (r
    ? CmDecoration.set([CmDecoration.mark({ class: 'mikedown-ai-rewrite-target' }).range(r.from, r.to)])
    : CmDecoration.none)),
});

/** Add to the source view's extensions. */
export const cmAiRewriteHighlight = [cmRewriteRange];

// ── Targets ─────────────────────────────────────────────────────────────────

/** What the popover rewrites: one selection, or the whole body, in one view. */
export interface AiRewriteTarget {
  mode: 'rich' | 'source';
  /** `document`: the whole body without its frontmatter (whole-document translate). */
  scope: 'selection' | 'document';
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
  const text = serializeFragment(editor, doc.slice(from, to).content);
  if (!text.trim()) {return null;}

  // Context: the enclosing top-level block plus one on each side.
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  const beforeStart = $from.depth > 0 ? $from.posAtIndex(Math.max(0, $from.index(0) - 1), 0) : 0;
  const afterEnd = $to.depth > 0 ? $to.posAtIndex(Math.min(doc.childCount, $to.index(0) + 2), 0) : doc.content.size;
  const before = beforeStart < from ? serializeFragment(editor, doc.slice(beforeStart, from).content) : '';
  const after = afterEnd > to ? serializeFragment(editor, doc.slice(to, afterEnd).content) : '';

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
  return Math.max(1024, Math.min(16384, Math.ceil((text.length / 3.5) * 1.6) + 256));
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
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

type Phase = 'choose' | 'running' | 'done' | 'error';
type Picker = 'language' | 'audience';
type OutputMode = 'replace' | 'readOnly' | 'replaceDocument';

/** True when `params` holds what `def` needs. */
function hasParam(def: AiRewriteVariantDefinition | undefined, params: AiRewriteParams): boolean {
  if (def?.param === 'language') {return !!params.language?.trim();}
  if (def?.param === 'audience') {return !!params.audience && !!getAiAudience(params.audience);}
  return true;
}

const plainLabel = (label: string): string => label.replace(/…$/, '');

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
  let error: AiError | null = null;
  /** The error is the router's: nothing can serve, so the fix is in settings. */
  let unavailable = false;
  let note = '';
  let warning: { text: string; title: string } | null = null;
  let side: 'below' | 'above' | null = null;
  let frame = 0;
  let copiedTimer: number | undefined;
  let detach: Array<() => void> = [];

  // Parts rebuilt per open.
  let titleEl: HTMLElement;
  let badgeEl: HTMLElement;
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
    badgeEl = el('span', 'ai-rw-badge');
    badgeEl.hidden = true;
    const closeBtn = button('ai-rw-icon-btn', '', () => close());
    closeBtn.innerHTML = CLOSE;
    closeBtn.setAttribute('aria-label', 'Cancel (Esc)');
    closeBtn.title = 'Cancel (Esc)';
    head.append(spark, titleEl, badgeEl, closeBtn);

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

    errorEl = el('div', 'ai-rw-error');
    errorEl.setAttribute('role', 'alert');

    warnEl = el('div', 'ai-rw-warn');

    footEl = el('div', 'ai-rw-foot');
    acceptBtn = button('ai-rw-btn ai-rw-btn--primary', 'Accept', () => accept());
    retryBtn = button('ai-rw-btn', 'Retry', () => start(variant, instruction));
    copyBtn = button('ai-rw-btn', 'Copy', () => copy());
    noteEl = el('span', 'ai-rw-note');
    hintEl = el('span', 'ai-rw-hint', 'Esc to cancel');
    footEl.append(acceptBtn, retryBtn, copyBtn, noteEl, hintEl);

    liveEl = el('div', 'ai-rw-sr');
    liveEl.setAttribute('aria-live', 'polite');

    box.append(head, chooseEl, bodyEl, errorEl, warnEl, footEl, liveEl);
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

  function renderBadge(): void {
    const b = deps.badge(route, served, served ? viaFallback : route?.viaFallback ?? false);
    badgeEl.hidden = !b;
    if (!b) {return;}
    badgeEl.dataset.where = b.where ?? '';
    badgeEl.classList.toggle('is-pending', !served);
    badgeEl.title = b.title;
    const glyph = el('span', 'ai-rw-badge-glyph');
    glyph.innerHTML = b.where === 'cloud' ? CLOUD : LOCAL;
    const text = el('span', 'ai-rw-badge-text', b.text);
    const parts: Node[] = [glyph, text];
    if (b.fallback) {parts.push(el('span', 'ai-rw-badge-fallback', '(fallback)'));}
    badgeEl.replaceChildren(...parts);
  }

  function renderOut(): void {
    const shown = phase === 'done' ? finalText.trim() : rewriteVisibleText(raw).trimStart();
    outEl.textContent = shown;
    newPaneEl.classList.toggle('is-waiting', phase === 'running' && !shown);
    if (phase === 'running' && !shown) {
      const name = deps.badge(route, null, false)?.text.split(' · ')[1];
      outEl.textContent = '';
      outEl.dataset.placeholder = name ? `Waiting for ${name}…` : 'Waiting for the engine…';
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
    root.setAttribute('aria-label', variant === 'explain' && phase !== 'choose' ? 'Explain with AI' : 'Rewrite with AI');
    titleEl.textContent = headTitle();
    if (variant === 'custom' && instruction && phase !== 'choose') {titleEl.title = instruction;} else {titleEl.removeAttribute('title');}
    chooseEl.hidden = phase !== 'choose';
    menuEl.hidden = !!picker;
    formEl.hidden = !!picker;
    pickerEl.hidden = !picker;
    bodyEl.hidden = phase === 'choose' || phase === 'error';
    errorEl.hidden = phase !== 'error';
    footEl.hidden = phase === 'choose' || phase === 'error';
    newLabelEl.textContent = mode === 'readOnly' ? 'Explanation' : variant === 'translate' ? 'Translation' : 'Rewrite';
    renderBadge();
    renderOut();

    const ready = phase === 'done' && !!finalText.trim();
    acceptBtn.hidden = phase === 'error';
    acceptBtn.setAttribute('aria-disabled', ready ? 'false' : 'true');
    acceptBtn.textContent = mode === 'readOnly' ? 'Insert below' : mode === 'replaceDocument' ? 'Replace document' : 'Accept';
    acceptBtn.title = mode === 'readOnly'
      ? 'Insert the explanation as a quote below the selection'
      : mode === 'replaceDocument' ? 'Replace the document body; frontmatter is kept (Enter)' : 'Replace the selection (Enter)';
    copyBtn.hidden = phase === 'error';
    copyBtn.setAttribute('aria-disabled', (phase === 'done' ? finalText : rewriteVisibleText(raw)).trim() ? 'false' : 'true');
    retryBtn.hidden = phase === 'error';
    noteEl.textContent = note;
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
    const copyText = unavailable
      ? { title: 'No engine can rewrite right now', message: e.message, action: 'openSettings' as const }
      : aiErrorCopy(e.code);
    const iconEl = el('span', 'ai-rw-error-icon');
    iconEl.innerHTML = ALERT;
    const textBox = el('div', 'ai-rw-error-text');
    textBox.append(el('div', 'ai-rw-error-title', copyText.title));
    // The router's reason or the host's detail, when it says more than the generic copy.
    const detail = e.message && e.message !== copyText.message ? e.message : '';
    textBox.append(el('div', 'ai-rw-error-message', e.code === 'unknown' && detail ? detail : copyText.message));
    if (detail && e.code !== 'unknown') {textBox.append(el('div', 'ai-rw-error-detail', detail));}
    if (e.code === 'contextOverflow' && target) {
      const what = target.scope === 'document' ? 'The document' : 'The selection';
      textBox.append(el('div', 'ai-rw-error-detail', `${what} is ${target.text.length.toLocaleString()} characters.`));
    }
    const actions = el('div', 'ai-rw-error-actions');
    const settingsBtn = button(`ai-rw-btn${copyText.action === 'openSettings' ? ' ai-rw-btn--primary' : ''}`, 'Open AI settings', () => {
      close({ refocus: false });
      deps.openSettings();
    });
    actions.append(settingsBtn);
    if (!unavailable && copyText.action !== 'shortenSelection' && e.code !== 'cloudBlocked') {
      actions.append(button(`ai-rw-btn${copyText.action === 'retry' ? ' ai-rw-btn--primary' : ''}`, 'Retry', () => start(variant, instruction)));
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

  /** Arrow keys, Home and End move between the chips of the first level or the picker's rows. */
  function moveFocus(e: KeyboardEvent): boolean {
    if (!root || phase !== 'choose' || !/^(Arrow(Up|Down|Left|Right)|Home|End)$/.test(e.key)) {return false;}
    const selector = picker ? '.ai-rw-picker-list > button' : '.ai-rw-menu .ai-rw-chip';
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
      // Enter accepts a replacement; Explain inserts only on an explicit click.
      if (e.key === 'Enter' && phase === 'done' && outputMode() !== 'readOnly' && !e.shiftKey && !e.altKey) {
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

  function start(v: AiRewriteVariant, custom?: string): void {
    const t = target;
    if (!t || !root) {return;}
    abort();
    const seq = runSeq;
    const ac = new AbortController();
    controller = ac;
    variant = v;
    instruction = v === 'custom' ? (custom ?? instruction) : '';
    picker = null;
    phase = 'running';
    raw = '';
    finalText = '';
    served = null;
    error = null;
    note = '';
    warning = null;
    oldTextEl.textContent = t.scope === 'document' ? '' : t.text.trim();
    const def = getAiRewriteVariant(v);
    if (def?.param === 'language' && params.language) {rememberLanguage(params.language);}
    if (def?.param === 'audience' && params.audience) {rememberAudience(params.audience);}
    render();
    position();
    root.focus({ preventScroll: true });

    // TODO(M4): budget a whole document with `budgetDocument` (ai/documentBudget.ts)
    // once it lands: send what fits and set `note` to its coverage ("Translated
    // the first N% of the document."). Until then the whole body goes and an
    // engine that cannot take it answers `contextOverflow`.
    const readOnly = def?.output === 'readOnly';
    const messages = readOnly
      ? buildExplainMessages({ selection: t.text, before: t.before, after: t.after, title: t.title })
      : buildRewriteMessages({
        variant: v,
        instruction,
        selection: t.text,
        before: t.before,
        after: t.after,
        params: def?.param ? params : undefined,
        scope: t.scope,
      });
    const maxTokens = readOnly ? explainMaxTokens()
      : t.scope === 'document' ? documentMaxTokens(t.text)
        : rewriteMaxTokens(t.text, v);
    deps.run({
      feature: 'rewrite',
      messages,
      maxTokens,
      temperature: v === 'fixFlow' || v === 'translate' ? 0.2 : 0.5,
    }, {
      onRoute: (r) => {
        if (seq !== runSeq) {return;}
        route = r;
        raw = '';
        renderBadge();
        renderOut();
      },
      onToken: (_delta, text) => {
        if (seq !== runSeq) {return;}
        raw = text;
        scheduleOut();
      },
    }, ac.signal).then((outcome) => {
      if (seq !== runSeq || !root) {return;}
      controller = null;
      served = outcome.result.served;
      viaFallback = outcome.viaFallback;
      deps.onServed(outcome.result.served, outcome.viaFallback);
      // Explain is a note, not a version of the selection: no whitespace to carry over.
      finalText = finalizeRewriteText(outcome.result.text || raw, readOnly ? '' : t.text);
      if (!finalText.trim()) {
        phase = 'error';
        error = { code: 'unknown', message: 'The engine sent back no text.' };
      } else {
        phase = 'done';
        const reason = outcome.result.finishReason;
        note = reason === 'length' ? 'Stopped at the length limit.' : reason === 'error' ? 'The stream ended early.' : '';
        if (STRUCTURE_CHECKED.has(v)) {
          const diff = checkMarkdownStructure(t.text, finalText);
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
    }, (err: unknown) => {
      if (seq !== runSeq || !root) {return;}
      controller = null;
      const e = toAiError(err);
      if (e.code === 'cancelled') {return;}
      phase = 'error';
      error = e;
      render();
      position();
      liveEl.textContent = `${aiErrorCopy(e.code).title}.`;
      errorEl.querySelector<HTMLButtonElement>('.ai-rw-btn--primary, .ai-rw-btn')?.focus({ preventScroll: true });
    });
  }

  function accept(): void {
    const t = target;
    if (!t || phase !== 'done' || !finalText.trim()) {return;}
    const ok = outputMode() === 'readOnly' ? t.insertBelow(finalText) : t.accept(finalText);
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
