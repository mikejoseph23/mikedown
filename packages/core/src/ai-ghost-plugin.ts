/**
 * Inline suggestions ("ghost text"): the ProseMirror half (decisions D1, D2,
 * D6 and D7 in ghost-text-plan.md). `ai-ghost.ts` decides when to ask and what
 * to show; this plugin tells it what the document did and draws the answer.
 *
 * - The suggestion is plugin state drawn as a widget decoration, so it is never
 *   in the document, the serialized markdown or `getText`.
 * - Keys are taken in `handleDOMEvents.keydown`, not `handleKeyDown`:
 *   `view.someProp` asks the editor's own `editorProps.handleKeyDown` before
 *   any plugin whatever the plugin order, and that handler owns Tab in lists
 *   and tables. DOM event handlers run ahead of it. Nothing is claimed unless a
 *   suggestion shows (D7).
 * - Register with a plain `editor.registerPlugin(plugin)`. Appended last, this
 *   plugin's `view.update` runs after the autocompletes' have opened or closed
 *   their popups, which is what `popupOpen` reads.
 * - `view.update` never dispatches. The controller's `onSuggestion(null)` from
 *   inside `noteChange` lands on a state `apply` already cleared, so
 *   `setGhostSuggestion` has nothing to do.
 *
 * Lives in the lazy AI chunk (`ai-ui.ts`); only types come from `ai-ghost`.
 */

import { Plugin, PluginKey, type EditorState, type PluginSpec, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PmNode, ResolvedPos } from '@tiptap/pm/model';
import { closeHistory, isHistoryTransaction } from '@tiptap/pm/history';
import type { GhostBlockKind } from './ai';
import type { GhostChangeInput, GhostController } from './ai-ghost';

export interface GhostPluginOptions {
  controller: GhostController;
  /** Markdown for a document, without the frontmatter: `(doc) => editor.storage.markdown.serializer.serialize(doc)`. */
  serialize: (doc: PmNode) => string;
  /** An emoji, wikilink, tag or slash popup is open; it wins over a suggestion (D7). */
  popupOpen?: () => boolean;
  /** False stops everything, for example in source mode. */
  enabled?: () => boolean;
}

/** What the last root transaction was: ours, a keystroke candidate, any other edit, or no edit. */
type GhostChange = 'own' | 'typing' | 'other' | null;

export interface AiGhostState {
  /** The text on screen, or null. */
  text: string | null;
  pos: number;
  /** When this suggestion first showed: streaming redraws the widget, the fade must not restart. */
  shownAt: number;
  change: GhostChange;
  decorations: DecorationSet;
}

interface GhostMeta {
  /** Present: show this text (null clears it). */
  text?: string | null;
  /** Our own accept or typed-match edit: keep the suggestion and tell the controller nothing. */
  own?: boolean;
}

interface GhostPluginSpec extends PluginSpec<AiGhostState> {
  triggerNow(view: EditorView): void;
}

export const aiGhostKey = new PluginKey<AiGhostState>('aiGhost');

/** A document edit counts as a keystroke only this soon after a key (D1). */
const GHOST_KEY_WINDOW_MS = 1000;

/** Marks the caret in the markdown; private-use characters no serializer escapes and no document holds. */
const CARET_MARK = '';

/** Blocks a suggestion can live in, outermost to innermost. Tables and footnote definitions are left out on purpose (D1). */
const ALLOWED_CONTAINERS = new Set(['doc', 'blockquote', 'callout', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem']);

const EMPTY: AiGhostState = { text: null, pos: 0, shownAt: 0, change: null, decorations: DecorationSet.empty };

function classify(tr: Transaction, meta: GhostMeta | undefined): GhostChange {
  if (meta?.own) {return 'own';}
  if (!tr.docChanged) {return null;}
  // Undoing an accept must not bring the same suggestion back, and a paste or a host update is not typing.
  const notTyping = isHistoryTransaction(tr) || !!tr.getMeta('paste') || !!tr.getMeta('uiEvent')
    || !!tr.getMeta('preventUpdate') || tr.getMeta('addToHistory') === false;
  return notTyping ? 'other' : 'typing';
}

function ghostWidget(state: EditorState, text: string, pos: number, shownAt: number): DecorationSet {
  const toDOM = (view: EditorView): Node => {
    const span = view.dom.ownerDocument.createElement('span');
    span.className = 'mikedown-ghost';
    span.setAttribute('aria-hidden', 'true');
    span.setAttribute('spellcheck', 'false');
    // A negative delay resumes the fade where the previous token's widget left off.
    span.style.animationDelay = `${shownAt - Date.now()}ms`;
    span.textContent = text;
    return span;
  };
  // The marks the text will take on accept, so bold stays bold before and after.
  const marks = state.storedMarks ?? state.selection.$head.marks();
  return DecorationSet.create(state.doc, [Decoration.widget(pos, toDOM, { side: 1, marks })]);
}

function applyGhost(tr: Transaction, prev: AiGhostState, oldState: EditorState, newState: EditorState): AiGhostState {
  const meta = tr.getMeta(aiGhostKey) as GhostMeta | undefined;
  const root = tr.getMeta('appendedTransaction') as Transaction | undefined;
  // An appended transaction (autolink, say) belongs to the edit that caused it.
  const change = (root ? prev.change : null) ?? classify(tr, meta);

  let text = prev.text;
  if (meta && 'text' in meta) {
    text = meta.text ?? null;
  } else if (change !== 'own' && (tr.docChanged || !oldState.selection.eq(newState.selection))) {
    text = null;
  }

  if (text === null) {
    return prev.text === null && prev.change === change ? prev : { ...EMPTY, change };
  }
  const pos = newState.selection.head;
  if (text === prev.text && pos === prev.pos && !tr.docChanged) {
    return prev.change === change ? prev : { ...prev, change };
  }
  const shownAt = prev.text === null ? Date.now() : prev.shownAt;
  return { text, pos, shownAt, change, decorations: ghostWidget(newState, text, pos, shownAt) };
}

/**
 * What may show of `text`: its first line. The trim keeps a single newline at
 * block end, but inserting it would put a raw line break in the paragraph and
 * flattening it to a space would glue on whatever the next line starts with (a
 * bullet, a heading marker). So a suggestion stops at its newline: what shows
 * is what Tab inserts, and the prefix-match and word rules still line up
 * because this is a prefix of the controller's text.
 */
function visibleLine(text: string | null): string | null {
  if (!text) {return null;}
  const newline = text.indexOf('\n');
  return (newline < 0 ? text : text.slice(0, newline).replace(/[ \t]+$/, '')) || null;
}

/** The markdown and the caret's offset in it, from one serialization, so they cannot disagree. */
function readAtCaret(state: EditorState, serialize: (doc: PmNode) => string): { markdown: string; caretOffset: number } {
  const marked = serialize(state.tr.insertText(CARET_MARK, state.selection.head).doc);
  const caretOffset = marked.indexOf(CARET_MARK);
  if (caretOffset < 0) {
    // The block serialized without its text. Nothing before the caret is known, so nothing fires.
    return { markdown: '', caretOffset: 0 };
  }
  return { markdown: marked.slice(0, caretOffset) + marked.slice(caretOffset + CARET_MARK.length), caretOffset };
}

/** The kind of block the caret is in, or null when suggestions are not allowed there. */
function blockKindAt($head: ResolvedPos): GhostBlockKind | null {
  const name = $head.parent.type.name;
  if (name !== 'paragraph' && name !== 'heading') {return null;}
  let kind: GhostBlockKind = name === 'heading' ? 'heading' : 'paragraph';
  let inner = kind !== 'paragraph';
  for (let depth = $head.depth - 1; depth >= 0; depth--) {
    const container = $head.node(depth).type.name;
    if (!ALLOWED_CONTAINERS.has(container)) {return null;}
    if (inner) {continue;}
    if (container === 'listItem' || container === 'taskItem') {
      kind = 'listItem';
      inner = true;
    } else if (container === 'blockquote' || container === 'callout') {
      kind = 'blockquote';
      inner = true;
    }
  }
  return kind;
}

/** The eligibility probe (D1). Only `read` serializes, and only when a request is about to fire. */
function probe(view: EditorView, options: GhostPluginOptions, manual: boolean): GhostChangeInput {
  const { state } = view;
  const { selection } = state;
  const { $head } = selection;
  const input: GhostChangeInput = { read: () => readAtCaret(state, options.serialize), atBlockEnd: false, eligible: false };
  if (!selection.empty || !view.editable || view.composing) {return input;}
  if (options.enabled?.() === false || options.popupOpen?.()) {return input;}
  const blockKind = blockKindAt($head);
  if (!blockKind || (state.storedMarks ?? $head.marks()).some((mark) => mark.type.name === 'code')) {return input;}
  const block = $head.parent;
  // A leaf after the caret (hard break, image) counts as text, so only real trailing whitespace passes.
  if (block.textBetween($head.parentOffset, block.content.size, '\n', '￼').trim() !== '') {return input;}
  // An empty block has nothing to continue until someone asks; the toolbar menu has the focus when it does.
  if (!manual && (block.content.size === 0 || !view.hasFocus())) {return input;}
  return { ...input, atBlockEnd: $head.parentOffset === block.content.size, eligible: true, blockKind };
}

function insertOwn(view: EditorView, text: string, keep: boolean): void {
  const meta: GhostMeta = keep ? { own: true } : { own: true, text: null };
  // One step of its own: closed before, so it does not join earlier typing...
  view.dispatch(closeHistory(view.state.tr).insertText(text).setMeta(aiGhostKey, meta).scrollIntoView());
  // ...and after, so typing right away (inside `newGroupDelay`) does not join it. No steps here.
  view.dispatch(closeHistory(view.state.tr).setMeta(aiGhostKey, { own: true } satisfies GhostMeta));
}

/** A key that matched the suggestion: goes through input rules like any typed character. */
function insertTyped(view: EditorView, char: string): void {
  const { from, to } = view.state.selection;
  const plain = (): Transaction => view.state.tr.insertText(char).setMeta(aiGhostKey, { own: true } satisfies GhostMeta).scrollIntoView();
  if (!view.someProp('handleTextInput', (handle) => handle(view, from, to, char, plain))) {
    view.dispatch(plain());
  }
}

/** Run the key against a showing suggestion. True means it was used. */
function ghostKey(view: EditorView, event: KeyboardEvent, controller: GhostController): boolean {
  const mod = event.metaKey || event.ctrlKey;
  if (event.key === 'Tab' && !mod && !event.shiftKey && !event.altKey) {
    const text = visibleLine(controller.accept());
    setGhostSuggestion(view, null);
    if (!text) {return false;}
    insertOwn(view, text, false);
    return true;
  }
  if (event.key === 'ArrowRight' && mod && !event.shiftKey && !event.altKey) {
    const word = visibleLine(controller.acceptWord());
    if (!word) {
      setGhostSuggestion(view, null);
      return false;
    }
    insertOwn(view, word, true);
    return true;
  }
  if (event.key === 'Escape' && !mod && !event.shiftKey && !event.altKey) {
    controller.dismiss();
    setGhostSuggestion(view, null);
    return true;
  }
  // Same rule as ProseMirror's keypress: Ctrl alone or Cmd is a chord, Ctrl+Alt is AltGr.
  const printable = [...event.key].length === 1 && !event.metaKey && !(event.ctrlKey && !event.altKey);
  if (printable && controller.typed(event.key)) {
    insertTyped(view, event.key);
    return true;
  }
  return false;
}

/**
 * The plugin. `editor.registerPlugin(createGhostPlugin(...))` installs it, with
 * no ordering function (see the top of this file). It does not own the
 * controller: registering any later plugin rebuilds plugin views, so the
 * caller destroys the controller on teardown.
 */
export function createGhostPlugin(options: GhostPluginOptions): Plugin<AiGhostState> {
  const { controller } = options;
  let lastKeyAt = 0;

  const spec: GhostPluginSpec = {
    key: aiGhostKey,
    state: {
      init: () => EMPTY,
      apply: applyGhost,
    },
    view: () => ({
      update(view, prevState) {
        const { change } = aiGhostKey.getState(view.state) ?? EMPTY;
        if (change === 'own') {return;}
        if (change === null) {
          if (!prevState.selection.eq(view.state.selection)) {controller.noteSelectionMove();}
          return;
        }
        const input = probe(view, options, false);
        const keystroke = change === 'typing' && Date.now() - lastKeyAt < GHOST_KEY_WINDOW_MS;
        controller.noteChange(keystroke ? input : { ...input, eligible: false });
      },
    }),
    props: {
      decorations: (state) => aiGhostKey.getState(state)?.decorations,
      handleDOMEvents: {
        keydown(view, event) {
          lastKeyAt = Date.now();
          if (!aiGhostKey.getState(view.state)?.text) {return false;}
          if (event.isComposing || event.keyCode === 229 || view.composing) {return false;}
          // A popup that opened late (candidates still arriving) wins over a suggestion already up.
          if (options.popupOpen?.()) {
            controller.dismiss();
            setGhostSuggestion(view, null);
            return false;
          }
          if (!ghostKey(view, event, controller)) {return false;}
          event.preventDefault();
          return true;
        },
        // Do not sit under an IME's own preview.
        compositionstart() {
          controller.dismiss();
          return false;
        },
        compositionend() {
          lastKeyAt = Date.now();
          return false;
        },
        // Tab would go elsewhere, and nobody is waiting for a request once focus has left.
        blur() {
          controller.dismiss();
          return false;
        },
      },
    },
    triggerNow(view) {
      controller.triggerNow(probe(view, options, true));
    },
  };
  return new Plugin<AiGhostState>(spec);
}

/**
 * Show `text` at the caret, or clear it with null. This is the controller's
 * `onSuggestion`. Does nothing when the screen already matches.
 */
export function setGhostSuggestion(view: EditorView, text: string | null): void {
  if (view.isDestroyed) {return;}
  const ghost = aiGhostKey.getState(view.state);
  if (!ghost) {return;}
  const next = visibleLine(text);
  if (next === ghost.text) {return;}
  if (next !== null && (!view.state.selection.empty || view.composing)) {return;}
  view.dispatch(view.state.tr.setMeta(aiGhostKey, { text: next } satisfies GhostMeta).setMeta('addToHistory', false));
}

/**
 * The manual trigger (the shortcut and the toolbar entry). Probes now, because
 * the caret may have moved since the last edit, and fires if eligible, whatever
 * the trigger mode. Focus the view first when calling from outside it, or Tab
 * will not reach the suggestion.
 */
export function triggerGhostNow(view: EditorView): void {
  (aiGhostKey.get(view.state)?.spec as GhostPluginSpec | undefined)?.triggerNow(view);
}
