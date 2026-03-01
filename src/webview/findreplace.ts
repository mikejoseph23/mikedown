import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

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

function findMatches(docText: string, state: SearchState): SearchMatch[] {
  const rx = buildRegex(state);
  if (!rx) return [];
  const matches: SearchMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(docText)) !== null) {
    matches.push({ from: m.index, to: m.index + m[0].length });
    if (m[0].length === 0) rx.lastIndex++; // avoid infinite loop on zero-length match
  }
  return matches;
}

// Convert doc text offset to ProseMirror position
// This is an approximation: works well for plain text docs.
// For rich docs, use a proper textOffset→pmPos mapping.
function textOffsetToPmPos(pmDoc: any, offset: number): number {
  let pos = 0;
  let textSeen = 0;
  pmDoc.descendants((node: any, nodePos: number) => {
    if (node.isText) {
      const end = textSeen + node.text.length;
      if (textSeen <= offset && offset <= end) {
        pos = nodePos + (offset - textSeen);
        return false; // stop
      }
      textSeen += node.text.length;
    }
    return true;
  });
  return pos;
}

function getDocMatches(editorState: EditorState, searchState: SearchState): { matches: SearchMatch[]; pmMatches: Array<{from: number; to: number}> } {
  const docText = editorState.doc.textContent;
  const textMatches = findMatches(docText, searchState);
  // Map text offsets → PM positions
  const pmMatches = textMatches.map(m => ({
    from: textOffsetToPmPos(editorState.doc, m.from),
    to: textOffsetToPmPos(editorState.doc, m.to),
  })).filter(m => m.from !== m.to);
  return { matches: textMatches, pmMatches };
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const FindReplaceExtension = Extension.create({
  name: 'findReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: findReplaceKey,
        state: {
          init(_: any, editorState: EditorState) {
            return { decorations: DecorationSet.empty, matches: [] };
          },
          apply(tr: Transaction, prev: any, _oldState: EditorState, newState: EditorState) {
            if (!tr.getMeta(findReplaceKey) && !tr.docChanged) return prev;
            const { pmMatches } = getDocMatches(newState, currentSearchState);
            const decos = pmMatches.map((m, i) =>
              Decoration.inline(m.from, m.to, {
                class: i === currentSearchState.currentIndex ? 'search-match-active' : 'search-match',
              })
            );
            return {
              decorations: DecorationSet.create(newState.doc, decos),
              matches: pmMatches,
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

export function updateSearch(
  editor: any, // TipTap Editor
  partial: Partial<SearchState>
): SearchMatch[] {
  currentSearchState = { ...currentSearchState, ...partial, currentIndex: 0 };
  // Trigger plugin recompute
  editor.view.dispatch(editor.view.state.tr.setMeta(findReplaceKey, true));
  const state = findReplaceKey.getState(editor.view.state);
  return state?.matches ?? [];
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
  const match = state.matches[currentSearchState.currentIndex];
  if (match) {
    const { TextSelection } = require('@tiptap/pm/state');
    editor.view.dispatch(
      editor.view.state.tr.setSelection(
        TextSelection.create(editor.view.state.doc, match.from, match.to)
      ).scrollIntoView()
    );
  }
}

export function findPrev(editor: any): void {
  const state = findReplaceKey.getState(editor.view.state);
  if (!state || state.matches.length === 0) return;
  currentSearchState.currentIndex =
    (currentSearchState.currentIndex - 1 + state.matches.length) % state.matches.length;
  editor.view.dispatch(editor.view.state.tr.setMeta(findReplaceKey, true));
  const match = state.matches[currentSearchState.currentIndex];
  if (match) {
    const { TextSelection } = require('@tiptap/pm/state');
    editor.view.dispatch(
      editor.view.state.tr.setSelection(
        TextSelection.create(editor.view.state.doc, match.from, match.to)
      ).scrollIntoView()
    );
  }
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
  findNext(editor);
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
