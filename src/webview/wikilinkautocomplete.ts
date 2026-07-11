/**
 * Wikilink filename autocomplete.
 *
 * Watches text right before the cursor for an open `[[abc` pattern. When the
 * typed query matches one or more workspace file basenames, shows a small
 * floating popup with up to 8 matches. Arrow keys + Enter/Tab selects;
 * Esc/click outside dismisses. Selection replaces the `[[abc` stem with a
 * Wikilink node.
 *
 * Modeled on `emojiautocomplete.ts`. The candidate list (bare basenames, no
 * extension) is supplied lazily by the host: the first time the popup opens
 * with an empty cache we invoke a registered requester callback which asks the
 * host for the workspace file list; the host answers by calling
 * `receiveWikilinkCandidates`.
 *
 * The popup itself is created in `document.body` to avoid mutating the
 * ProseMirror-managed DOM.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const MAX_RESULTS = 8;

interface PopupState {
  from: number;
  to: number;
  query: string;
  matches: string[];
  activeIndex: number;
}

let popupEl: HTMLElement | null = null;
let state: PopupState | null = null;
let viewRef: any = null;

// Module-level candidate cache (bare basenames, no extension).
let candidates: string[] = [];
// Lazy requester: called once per empty-cache popup open to ask the host for
// the file list. `requestedForEmpty` guards against spamming the host.
let requester: (() => void) | null = null;
let requestedForEmpty = false;

/** Store the callback the extension invokes (once, lazily) the first time the
 *  popup opens with an empty candidate cache. */
export function setWikilinkCandidateRequester(fn: () => void): void {
  requester = fn;
}

/** Set the cached candidate list. If the popup is open, re-filter + re-render. */
export function receiveWikilinkCandidates(names: string[]): void {
  candidates = Array.isArray(names) ? names.slice() : [];
  requestedForEmpty = false;
  if (state) {
    const matches = findMatches(state.query);
    if (matches.length === 0) {
      hidePopup();
      return;
    }
    state.matches = matches;
    state.activeIndex = Math.min(state.activeIndex, matches.length - 1);
    renderPopup();
    if (viewRef) positionPopup(viewRef, state.from);
  }
}

function findMatches(query: string): string[] {
  const q = query.toLowerCase();
  if (q.length === 0) {
    return candidates.slice(0, MAX_RESULTS);
  }
  const starts: string[] = [];
  const contains: string[] = [];
  for (const name of candidates) {
    const lower = name.toLowerCase();
    if (lower.startsWith(q)) {
      starts.push(name);
    } else if (lower.includes(q)) {
      contains.push(name);
    }
    if (starts.length >= MAX_RESULTS) break;
  }
  return [...starts, ...contains].slice(0, MAX_RESULTS);
}

function hidePopup(): void {
  if (popupEl) {
    popupEl.remove();
    popupEl = null;
  }
  state = null;
}

export function isWikilinkAutocompleteOpen(): boolean {
  return popupEl !== null && state !== null && state.matches.length > 0;
}

function ensurePopup(): HTMLElement {
  if (!popupEl) {
    popupEl = document.createElement('div');
    popupEl.id = 'mikedown-wikilink-ac';
    popupEl.setAttribute('role', 'listbox');
    document.body.appendChild(popupEl);
  }
  return popupEl;
}

function renderPopup(): void {
  if (!state) return;
  const el = ensurePopup();
  el.innerHTML = '';
  state.matches.forEach((name, i) => {
    const item = document.createElement('div');
    item.className = 'wac-item' + (i === state!.activeIndex ? ' wac-active' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(i === state!.activeIndex));

    const label = document.createElement('span');
    label.className = 'wac-label';
    label.textContent = name;

    item.appendChild(label);
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectMatch(i);
    });
    el.appendChild(item);
  });
}

function positionPopup(view: any, from: number): void {
  if (!popupEl) return;
  const coords = view.coordsAtPos(from);
  const top = coords.bottom + 4;
  const left = coords.left;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  popupEl.style.visibility = 'hidden';
  popupEl.style.left = '0px';
  popupEl.style.top = '0px';
  const rect = popupEl.getBoundingClientRect();
  const clampedLeft = Math.max(4, Math.min(left, vw - rect.width - 4));
  let clampedTop = top;
  if (clampedTop + rect.height > vh - 4) {
    clampedTop = Math.max(4, coords.top - rect.height - 4);
  }
  popupEl.style.left = `${clampedLeft}px`;
  popupEl.style.top = `${clampedTop}px`;
  popupEl.style.visibility = '';
}

function selectMatch(index: number): void {
  if (!state || !viewRef) return;
  const name = state.matches[index];
  if (!name) return;
  const { from, to } = state;
  const type = viewRef.state.schema.nodes.wikilink;
  if (!type) return;
  const tr = viewRef.state.tr.replaceWith(from, to, type.create({ target: name }));
  viewRef.dispatch(tr);
  hidePopup();
  viewRef.focus();
}

const wikilinkAutocompleteKey = new PluginKey('wikilinkAutocomplete');

export const WikilinkAutocomplete = Extension.create({
  name: 'wikilinkAutocomplete',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: wikilinkAutocompleteKey,
        view(view) {
          viewRef = view;
          return {
            update(view) {
              viewRef = view;
              const { selection } = view.state;
              if (!selection.empty) {
                hidePopup();
                return;
              }
              const $from = selection.$from;
              // Bail out inside code blocks / code marks.
              const parentType = $from.parent.type.name;
              if (parentType === 'codeBlock') { hidePopup(); return; }
              const markName = view.state.schema.marks.code;
              if (markName && markName.isInSet(view.state.storedMarks || $from.marks())) {
                hidePopup();
                return;
              }

              // Look at text before cursor on the current node.
              const pos = selection.from;
              const textBefore = $from.parent.textBetween(
                Math.max(0, $from.parentOffset - 60),
                $from.parentOffset,
                undefined,
                '￼',
              );
              // Open wikilink being typed: `[[` followed by chars that are not
              // `]`, `[` or newline, anchored at the cursor.
              const m = /\[\[([^\]\n[]*)$/.exec(textBefore);
              if (!m) { hidePopup(); return; }

              const query = m[1];

              // Lazily ask the host for the file list the first time we open
              // with an empty cache.
              if (candidates.length === 0) {
                if (requester && !requestedForEmpty) {
                  requestedForEmpty = true;
                  requester();
                }
              }

              const stemLen = query.length + 2; // includes the leading `[[`
              const from = pos - stemLen;
              const to = pos;

              const matches = findMatches(query);
              if (matches.length === 0) {
                // Nothing to show yet (candidates may still be loading). Retain
                // enough state that a later `receiveWikilinkCandidates` can
                // re-filter and populate the popup, but don't render it empty.
                if (popupEl) { popupEl.remove(); popupEl = null; }
                state = { from, to, query, matches: [], activeIndex: 0 };
                return;
              }

              if (!state || state.from !== from || state.query !== query) {
                state = { from, to, query, matches, activeIndex: 0 };
              } else {
                state.to = to;
                state.matches = matches;
                state.activeIndex = Math.min(state.activeIndex, matches.length - 1);
              }
              renderPopup();
              positionPopup(view, from);
            },
            destroy() {
              hidePopup();
              viewRef = null;
            },
          };
        },
        props: {
          handleKeyDown(view, event) {
            if (!state || state.matches.length === 0) return false;
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              state.activeIndex = (state.activeIndex + 1) % state.matches.length;
              renderPopup();
              return true;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              state.activeIndex = state.activeIndex <= 0 ? state.matches.length - 1 : state.activeIndex - 1;
              renderPopup();
              return true;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              selectMatch(state.activeIndex);
              return true;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              hidePopup();
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
