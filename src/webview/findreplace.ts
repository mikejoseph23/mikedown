import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { StateEffect, StateField } from '@codemirror/state';
import { EditorView as CmEditorView, Decoration as CmDecoration, DecorationSet as CmDecorationSet } from '@codemirror/view';

// ─── State ───────────────────────────────────────────────────────────────────

export interface SearchState {
  query: string;
  replaceWith: string;
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  currentIndex: number; // -1 means no selection
}

export interface SearchMatch {
  from: number;
  to: number;
}

const findReplaceKey = new PluginKey<{ decorations: DecorationSet; matches: SearchMatch[] }>('findReplace');

let currentSearchState: SearchState = {
  query: '',
  replaceWith: '',
  matchCase: false,
  wholeWord: false,
  useRegex: false,
  currentIndex: -1,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildRegex(state: SearchState): RegExp | null {
  if (!state.query) return null;
  try {
    let pattern = state.useRegex ? state.query : state.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (state.wholeWord) pattern = `\\b${pattern}\\b`;
    return new RegExp(pattern, state.matchCase ? 'g' : 'gi');
  } catch (_) {
    return null;
  }
}

// Walk text nodes directly and compute PM positions from the node's own
// starting position. This avoids any fragile text-offset → PM-pos mapping.
function findMatchesInDoc(doc: any, searchState: SearchState): SearchMatch[] {
  const rx = buildRegex(searchState);
  if (!rx) return [];
  const matches: SearchMatch[] = [];
  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return;
    const text: string = node.text ?? '';
    rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      const from = pos + m.index;
      const to = from + m[0].length;
      if (to > from) matches.push({ from, to });
      if (m[0].length === 0) rx.lastIndex++; // avoid infinite loop on zero-length match
    }
  });
  return matches;
}

function buildDecorations(matches: SearchMatch[], activeIndex: number): Decoration[] {
  return matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class: i === activeIndex ? 'search-match-active' : 'search-match',
    })
  );
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const FindReplaceExtension = Extension.create({
  name: 'findReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: findReplaceKey,
        state: {
          init(_: any, _editorState: EditorState) {
            return { decorations: DecorationSet.empty, matches: [] as SearchMatch[] };
          },
          apply(tr: Transaction, prev: any, _oldState: EditorState, newState: EditorState) {
            if (!tr.getMeta(findReplaceKey) && !tr.docChanged) return prev;
            if (!currentSearchState.query) {
              return { decorations: DecorationSet.empty, matches: [] };
            }
            const matches = findMatchesInDoc(newState.doc, currentSearchState);
            // Keep the active index in range after doc edits.
            if (currentSearchState.currentIndex >= matches.length) {
              currentSearchState.currentIndex = matches.length > 0 ? 0 : -1;
            } else if (currentSearchState.currentIndex < 0 && matches.length > 0) {
              currentSearchState.currentIndex = 0;
            }
            const decos = buildDecorations(matches, currentSearchState.currentIndex);
            return {
              decorations: DecorationSet.create(newState.doc, decos),
              matches,
            };
          },
        },
        props: {
          decorations(state: EditorState) {
            return findReplaceKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Scroll the active match into view by locating the rendered decoration
 * element in the DOM. We deliberately do NOT change the ProseMirror selection:
 *
 *   1. Setting the editor selection moves DOM focus away from the find input
 *      and updates the toolbar's active-block indicator (e.g. "Text Format"
 *      flips to "H1" when a heading match is active), which the user finds
 *      confusing.
 *   2. Clicking the find bar's ↑ / ↓ buttons takes focus off the editor, so
 *      ProseMirror's scrollIntoView meta doesn't reliably scroll either.
 *
 * Scrolling the decoration span directly side-steps both problems.
 */
function scrollActiveIntoView(editor: any): void {
  // Wait for the decoration render to flush, then scroll.
  const run = () => {
    try {
      const dom = editor?.view?.dom as HTMLElement | undefined;
      if (!dom || !dom.isConnected) return;
      const el = dom.querySelector('.search-match-active') as HTMLElement | null;
      if (!el) return;
      // `nearest` avoids yanking the viewport around when the match is already visible.
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    } catch {
      // Editor may have been destroyed between dispatch and the rAF callback.
    }
  };
  // The transaction that repainted decorations has just been dispatched;
  // give the view one frame to render the new span before querying for it.
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(run);
  } else {
    run();
  }
}

export function updateSearch(
  editor: any, // TipTap Editor
  partial: Partial<SearchState>
): SearchMatch[] {
  currentSearchState = { ...currentSearchState, ...partial };
  currentSearchState.currentIndex = currentSearchState.query ? 0 : -1;
  // Trigger plugin recompute
  editor.view.dispatch(editor.view.state.tr.setMeta(findReplaceKey, true));
  const state = findReplaceKey.getState(editor.view.state);
  const matches = state?.matches ?? [];
  // Auto-jump to the first match so users see immediate feedback when typing.
  if (matches.length > 0) scrollActiveIntoView(editor);
  return matches;
}

export function clearSearch(editor: any): void {
  currentSearchState = { ...currentSearchState, query: '', currentIndex: -1 };
  editor.view.dispatch(editor.view.state.tr.setMeta(findReplaceKey, true));
}

export function findNext(editor: any): void {
  const state = findReplaceKey.getState(editor.view.state);
  if (!state || state.matches.length === 0) return;
  currentSearchState.currentIndex =
    (currentSearchState.currentIndex + 1) % state.matches.length;
  editor.view.dispatch(editor.view.state.tr.setMeta(findReplaceKey, true));
  scrollActiveIntoView(editor);
}

export function findPrev(editor: any): void {
  const state = findReplaceKey.getState(editor.view.state);
  if (!state || state.matches.length === 0) return;
  currentSearchState.currentIndex =
    (currentSearchState.currentIndex - 1 + state.matches.length) % state.matches.length;
  editor.view.dispatch(editor.view.state.tr.setMeta(findReplaceKey, true));
  scrollActiveIntoView(editor);
}

export function replaceCurrentMatch(editor: any, replaceWith: string): void {
  const state = findReplaceKey.getState(editor.view.state);
  if (!state || state.matches.length === 0) return;
  const match = state.matches[currentSearchState.currentIndex];
  if (!match) return;
  editor.view.dispatch(
    editor.view.state.tr.insertText(replaceWith, match.from, match.to)
  );
  // Advance to next match after replace
  updateSearch(editor, { replaceWith });
}

export function replaceAllMatches(editor: any, replaceWith: string): number {
  const state = findReplaceKey.getState(editor.view.state);
  if (!state || state.matches.length === 0) return 0;
  const count = state.matches.length;
  // Replace in reverse order to preserve offsets
  const tr = editor.view.state.tr;
  [...state.matches].reverse().forEach((m: SearchMatch) => {
    tr.insertText(replaceWith, m.from, m.to);
  });
  editor.view.dispatch(tr);
  updateSearch(editor, {});
  return count;
}

// ─── CodeMirror (source mode) integration ────────────────────────────────────
//
// A separate StateField renders match decorations inside the CodeMirror view.
// Match detection reuses `currentSearchState` so options (case / word / regex)
// stay in sync with the shared find bar UI.

const setCmSearchEffect = StateEffect.define<{ matches: SearchMatch[]; activeIndex: number }>();

const cmSearchField = StateField.define<CmDecorationSet>({
  create() {
    return CmDecoration.none;
  },
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setCmSearchEffect)) {
        const { matches, activeIndex } = e.value;
        if (matches.length === 0) {
          value = CmDecoration.none;
        } else {
          const decos = matches.map((m, i) =>
            CmDecoration.mark({
              class: i === activeIndex ? 'search-match-active' : 'search-match',
            }).range(m.from, m.to)
          );
          value = CmDecoration.set(decos, true);
        }
      }
    }
    return value;
  },
  provide: f => CmEditorView.decorations.from(f),
});

export const cmFindReplaceExtension = [cmSearchField];

let cmMatches: SearchMatch[] = [];

function findMatchesInCm(view: CmEditorView, state: SearchState): SearchMatch[] {
  const rx = buildRegex(state);
  if (!rx) return [];
  const text = view.state.doc.toString();
  const matches: SearchMatch[] = [];
  rx.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    if (to > from) matches.push({ from, to });
    if (m[0].length === 0) rx.lastIndex++;
  }
  return matches;
}

function cmScrollActive(view: CmEditorView): void {
  const m = cmMatches[currentSearchState.currentIndex];
  if (!m) return;
  view.dispatch({ effects: CmEditorView.scrollIntoView(m.from, { y: 'nearest' }) });
}

export function cmUpdateSearch(view: CmEditorView, partial: Partial<SearchState>): SearchMatch[] {
  currentSearchState = { ...currentSearchState, ...partial };
  currentSearchState.currentIndex = currentSearchState.query ? 0 : -1;
  cmMatches = findMatchesInCm(view, currentSearchState);
  if (currentSearchState.currentIndex >= cmMatches.length) {
    currentSearchState.currentIndex = cmMatches.length > 0 ? 0 : -1;
  }
  view.dispatch({
    effects: setCmSearchEffect.of({ matches: cmMatches, activeIndex: currentSearchState.currentIndex }),
  });
  if (cmMatches.length > 0) cmScrollActive(view);
  return cmMatches;
}

export function cmClearSearch(view: CmEditorView): void {
  currentSearchState = { ...currentSearchState, query: '', currentIndex: -1 };
  cmMatches = [];
  view.dispatch({ effects: setCmSearchEffect.of({ matches: [], activeIndex: -1 }) });
}

export function cmFindNext(view: CmEditorView): void {
  if (cmMatches.length === 0) return;
  currentSearchState.currentIndex =
    (currentSearchState.currentIndex + 1) % cmMatches.length;
  view.dispatch({
    effects: setCmSearchEffect.of({ matches: cmMatches, activeIndex: currentSearchState.currentIndex }),
  });
  cmScrollActive(view);
}

export function cmFindPrev(view: CmEditorView): void {
  if (cmMatches.length === 0) return;
  currentSearchState.currentIndex =
    (currentSearchState.currentIndex - 1 + cmMatches.length) % cmMatches.length;
  view.dispatch({
    effects: setCmSearchEffect.of({ matches: cmMatches, activeIndex: currentSearchState.currentIndex }),
  });
  cmScrollActive(view);
}

export function cmReplaceCurrent(view: CmEditorView, replaceWith: string): void {
  if (cmMatches.length === 0) return;
  const m = cmMatches[currentSearchState.currentIndex];
  if (!m) return;
  view.dispatch({ changes: { from: m.from, to: m.to, insert: replaceWith } });
  cmUpdateSearch(view, {});
}

export function cmReplaceAll(view: CmEditorView, replaceWith: string): number {
  if (cmMatches.length === 0) return 0;
  const count = cmMatches.length;
  // Changes must be sorted ascending & non-overlapping; our matches already are.
  const changes = cmMatches.map(m => ({ from: m.from, to: m.to, insert: replaceWith }));
  view.dispatch({ changes });
  cmUpdateSearch(view, {});
  return count;
}
