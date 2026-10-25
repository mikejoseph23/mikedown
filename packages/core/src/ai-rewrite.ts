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
  AI_REWRITE_VARIANTS,
  REWRITE_CONTEXT_CHARS,
  buildRewriteMessages,
  finalizeRewriteText,
  getAiRewriteVariant,
  rewriteMaxTokens,
  rewriteVisibleText,
  type AiRewriteVariant,
} from './ai/prompts/rewrite';
import type { AiFeatureAvailability, AiRunEvents, AiRunOutcome, AiRunRequest } from './ai-request';
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

/** What the popover rewrites: one selection in one view. */
export interface AiRewriteTarget {
  mode: 'rich' | 'source';
  /** The selection as markdown. */
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
      const storage = (editor.storage as unknown as Record<string, { parser?: { parse(md: string, o?: { inline?: boolean }): string } }>).markdown;
      const html = storage?.parser?.parse(markdown, { inline: true }) ?? markdown;
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
    release() {
      if (range()) {view.dispatch({ effects: setCmRewriteRange.of(null) });}
    },
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
}

export interface AiRewritePopover {
  /** Open on a target: with a variant it runs at once, without one it shows the choices. */
  open(target: AiRewriteTarget, choice?: { variant: AiRewriteVariant; instruction?: string }): void;
  /** Open on a target to say why rewrite cannot run (AI on, no usable route). */
  openUnavailable(target: AiRewriteTarget, reason: string): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

type Phase = 'choose' | 'running' | 'done' | 'error';

export function createAiRewritePopover(deps: AiRewritePopoverDeps): AiRewritePopover {
  let target: AiRewriteTarget | null = null;
  let root: HTMLElement | null = null;
  let phase: Phase = 'choose';
  let variant: AiRewriteVariant = 'shorter';
  let instruction = '';
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
  let side: 'below' | 'above' | null = null;
  let frame = 0;
  let copiedTimer: number | undefined;
  let detach: Array<() => void> = [];

  // Parts rebuilt per open.
  let titleEl: HTMLElement;
  let badgeEl: HTMLElement;
  let chooseEl: HTMLElement;
  let inputEl: HTMLInputElement;
  let bodyEl: HTMLElement;
  let outEl: HTMLElement;
  let newPaneEl: HTMLElement;
  let errorEl: HTMLElement;
  let footEl: HTMLElement;
  let acceptBtn: HTMLButtonElement;
  let retryBtn: HTMLButtonElement;
  let copyBtn: HTMLButtonElement;
  let noteEl: HTMLElement;
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
    t.release();
    if (opts.refocus !== false) {t.focus();}
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

    chooseEl = el('div', 'ai-rw-choose');
    const chips = el('div', 'ai-rw-chips');
    for (const v of AI_REWRITE_VARIANTS) {
      if (v.id === 'custom') {continue;}
      chips.append(button('ai-rw-chip', v.label, () => start(v.id)));
    }
    const form = el('form', 'ai-rw-form');
    inputEl = el('input', 'ai-rw-input');
    inputEl.type = 'text';
    inputEl.placeholder = 'Describe a change, e.g. "make it friendlier"';
    inputEl.setAttribute('aria-label', 'Custom rewrite instruction');
    inputEl.maxLength = 1000;
    const go = button('ai-rw-btn ai-rw-btn--primary', 'Rewrite', () => submitCustom());
    form.append(inputEl, go);
    form.addEventListener('submit', (e) => { e.preventDefault(); submitCustom(); });
    chooseEl.append(chips, form);

    bodyEl = el('div', 'ai-rw-body');
    const oldPane = el('div', 'ai-rw-pane ai-rw-pane--old');
    oldPane.append(el('div', 'ai-rw-label', 'Original'), el('div', 'ai-rw-text', target?.text.trim() ?? ''));
    newPaneEl = el('div', 'ai-rw-pane ai-rw-pane--new');
    const newText = el('div', 'ai-rw-text');
    outEl = el('span', 'ai-rw-out');
    newText.append(outEl, el('span', 'ai-rw-caret'));
    newPaneEl.append(el('div', 'ai-rw-label', 'Rewrite'), newText);
    bodyEl.append(oldPane, newPaneEl);

    errorEl = el('div', 'ai-rw-error');
    errorEl.setAttribute('role', 'alert');

    footEl = el('div', 'ai-rw-foot');
    acceptBtn = button('ai-rw-btn ai-rw-btn--primary', 'Accept', () => accept());
    acceptBtn.title = 'Replace the selection (Enter)';
    retryBtn = button('ai-rw-btn', 'Retry', () => start(variant, instruction));
    copyBtn = button('ai-rw-btn', 'Copy', () => copy());
    noteEl = el('span', 'ai-rw-note');
    const hint = el('span', 'ai-rw-hint', 'Esc to cancel');
    footEl.append(acceptBtn, retryBtn, copyBtn, noteEl, hint);

    liveEl = el('div', 'ai-rw-sr');
    liveEl.setAttribute('aria-live', 'polite');

    box.append(head, chooseEl, bodyEl, errorEl, footEl, liveEl);
    return box;
  }

  function submitCustom(): void {
    const text = inputEl.value.trim();
    if (!text) { inputEl.focus(); return; }
    start('custom', text);
  }

  function variantLabel(): string {
    if (variant === 'custom') {return 'Custom';}
    return getAiRewriteVariant(variant)?.label ?? 'Rewrite';
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
    root.dataset.phase = phase;
    root.dataset.layout = target.multiline ? 'split' : 'single';
    root.setAttribute('aria-busy', phase === 'running' ? 'true' : 'false');
    titleEl.textContent = phase === 'choose' || unavailable ? 'Rewrite' : `Rewrite · ${variantLabel()}`;
    if (variant === 'custom' && instruction && phase !== 'choose') {titleEl.title = instruction;} else {titleEl.removeAttribute('title');}
    chooseEl.hidden = phase !== 'choose';
    bodyEl.hidden = phase === 'choose' || phase === 'error';
    errorEl.hidden = phase !== 'error';
    footEl.hidden = phase === 'choose' || phase === 'error';
    renderBadge();
    renderOut();

    const ready = phase === 'done' && !!finalText.trim();
    acceptBtn.hidden = phase === 'error';
    acceptBtn.setAttribute('aria-disabled', ready ? 'false' : 'true');
    copyBtn.hidden = phase === 'error';
    copyBtn.setAttribute('aria-disabled', (phase === 'done' ? finalText : rewriteVisibleText(raw)).trim() ? 'false' : 'true');
    retryBtn.hidden = phase === 'error';
    noteEl.textContent = note;

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
      textBox.append(el('div', 'ai-rw-error-detail', `The selection is ${target.text.length.toLocaleString()} characters.`));
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
    root = build();
    getPortal().appendChild(root);

    const onKey = (e: KeyboardEvent): void => {
      if (!root) {return;}
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === 'Enter' && phase === 'done' && !e.shiftKey && !e.altKey) {
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
    phase = 'running';
    raw = '';
    finalText = '';
    served = null;
    error = null;
    note = '';
    render();
    position();
    root.focus({ preventScroll: true });

    const messages = buildRewriteMessages({ variant: v, instruction, selection: t.text, before: t.before, after: t.after });
    deps.run({
      feature: 'rewrite',
      messages,
      maxTokens: rewriteMaxTokens(t.text, v),
      temperature: v === 'fixFlow' ? 0.2 : 0.5,
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
      finalText = finalizeRewriteText(outcome.result.text || raw, t.text);
      if (!finalText.trim()) {
        phase = 'error';
        error = { code: 'unknown', message: 'The engine sent back no text.' };
      } else {
        phase = 'done';
        const reason = outcome.result.finishReason;
        note = reason === 'length' ? 'Stopped at the length limit.' : reason === 'error' ? 'The stream ended early.' : '';
      }
      render();
      position();
      liveEl.textContent = phase === 'done' ? 'Rewrite ready. Press Enter to accept or Escape to cancel.' : 'Rewrite failed.';
      if (phase === 'done') {acceptBtn.focus({ preventScroll: true });}
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
    const ok = t.accept(finalText);
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
      if (choice) {
        start(choice.variant, choice.instruction);
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
    menu = el('div', 'ai-bubble-menu');
    menu.setAttribute('role', 'menu');
    for (const v of AI_REWRITE_VARIANTS) {
      const item = button('ai-bubble-item', '', () => { hide(); deps.run(v.id); });
      item.setAttribute('role', 'menuitem');
      item.append(el('span', 'ai-bubble-item-label', v.label));
      if (v.id === 'custom') {item.append(el('span', 'ai-bubble-item-key', rewriteHotkeyLabel()));}
      menu.append(item);
    }
    box.append(menu);
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
