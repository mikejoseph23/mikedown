/**
 * Inline `#tag` autocomplete.
 *
 * Watches text right before the cursor for a `#abc` stem that follows
 * whitespace or `(` mid-line. When the typed query matches existing workspace
 * tags, shows a small floating popup with up to 8 matches (with doc counts).
 * Arrow keys + Enter/Tab selects; Esc/click outside dismisses. Selection
 * replaces the stem with `#tag ` as plain text (tags are decoration-only; see
 * `tag.ts`).
 *
 * Never triggers at the start of a textblock: there `#` is heading syntax
 * (`# Title`), and a tag right at line start is rare enough not to fight it.
 *
 * Modeled on `wikilinkautocomplete.ts`. The host pushes the tag list with a
 * `tags` message (on ready and whenever the index changes); if the cache is
 * empty when the popup would open, a registered requester asks for it once.
 *
 * The popup itself is created in `document.body` to avoid mutating the
 * ProseMirror-managed DOM.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { isSlashMenuOpen } from './slashcommands';
import { isTagsEnabled } from './tag';

const MAX_RESULTS = 8;

export interface TagCandidate {
  tag: string;
  count: number;
}

interface PopupState {
  from: number;
  to: number;
  query: string;
  matches: TagCandidate[];
  activeIndex: number;
}

let popupEl: HTMLElement | null = null;
let state: PopupState | null = null;
let viewRef: any = null;

let candidates: TagCandidate[] = [];
let requester: (() => void) | null = null;
let requestedForEmpty = false;

/** `#` + stem, preceded by whitespace or `(` — never at textblock start. */
const TRIGGER = /(?<=[\s(])#([A-Za-z0-9_/-]+)$/;

/** Store the callback invoked (once, lazily) when the popup opens with an empty cache. */
export function setTagCandidateRequester(fn: () => void): void {
  requester = fn;
}

/** Set the cached tag list. If the popup is open, re-filter + re-render. */
export function receiveTagCandidates(tags: TagCandidate[]): void {
  candidates = Array.isArray(tags) ? tags.filter(t => t && typeof t.tag === 'string') : [];
  requestedForEmpty = false;
  if (state) {
    const matches = findTagMatches(candidates, state.query);
    if (matches.length === 0) {
      hidePopup();
      return;
    }
    state.matches = matches;
    state.activeIndex = Math.min(state.activeIndex, matches.length - 1);
    renderPopup();
    if (viewRef) {positionPopup(viewRef, state.from);}
  }
}

/**
 * Prefix matches first, then substring matches (the source list is already
 * sorted by doc count). A lone exact match is dropped so a fully typed tag
 * doesn't hold Enter hostage.
 */
export function findTagMatches(list: TagCandidate[], query: string): TagCandidate[] {
  const q = query.toLowerCase();
  if (!q) {return [];}
  const starts: TagCandidate[] = [];
  const contains: TagCandidate[] = [];
  for (const c of list) {
    const lower = c.tag.toLowerCase();
    if (lower.startsWith(q)) {starts.push(c);}
    else if (lower.includes(q)) {contains.push(c);}
    if (starts.length >= MAX_RESULTS) {break;}
  }
  // Never offer exactly what's typed — it adds nothing, and the live tag
  // list includes the half-typed token itself.
  return [...starts, ...contains].filter((c) => c.tag.toLowerCase() !== q).slice(0, MAX_RESULTS);
}

function hidePopup(): void {
  if (popupEl) {
    popupEl.remove();
    popupEl = null;
  }
  state = null;
}

export function isTagAutocompleteOpen(): boolean {
  return popupEl !== null && state !== null && state.matches.length > 0;
}

function ensurePopup(): HTMLElement {
  if (!popupEl) {
    popupEl = document.createElement('div');
    popupEl.id = 'mikedown-tag-ac';
    popupEl.setAttribute('role', 'listbox');
    document.body.appendChild(popupEl);
  }
  return popupEl;
}

function renderPopup(): void {
  if (!state) {return;}
  const el = ensurePopup();
  el.innerHTML = '';
  state.matches.forEach((c, i) => {
    const item = document.createElement('div');
    item.className = 'wac-item' + (i === state!.activeIndex ? ' wac-active' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(i === state!.activeIndex));

    const label = document.createElement('span');
    label.className = 'wac-label';
    label.textContent = `#${c.tag}`;

    const count = document.createElement('span');
    count.className = 'tac-count';
    count.textContent = String(c.count);

    item.append(label, count);
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectMatch(i);
    });
    el.appendChild(item);
  });
}

function positionPopup(view: any, from: number): void {
  if (!popupEl) {return;}
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
  if (!state || !viewRef) {return;}
  const match = state.matches[index];
  if (!match) {return;}
  const { from, to } = state;
  viewRef.dispatch(viewRef.state.tr.insertText(`#${match.tag} `, from, to));
  hidePopup();
  viewRef.focus();
}

const tagAutocompleteKey = new PluginKey('tagAutocomplete');

export const TagAutocomplete = Extension.create({
  name: 'tagAutocomplete',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tagAutocompleteKey,
        view(view) {
          viewRef = view;
          return {
            update(view) {
              viewRef = view;
              const { selection } = view.state;
              if (!isTagsEnabled() || !selection.empty || isSlashMenuOpen()) {
                hidePopup();
                return;
              }
              const $from = selection.$from;
              if ($from.parent.type.name === 'codeBlock') { hidePopup(); return; }
              const marks = view.state.storedMarks || $from.marks();
              if (marks.some((m: any) => m.type.name === 'code' || m.type.name === 'link')) {
                hidePopup();
                return;
              }

              const textBefore = $from.parent.textBetween(
                Math.max(0, $from.parentOffset - 60),
                $from.parentOffset,
                undefined,
                '￼',
              );
              const m = TRIGGER.exec(textBefore);
              if (!m) { hidePopup(); return; }
              const query = m[1];

              if (candidates.length === 0 && requester && !requestedForEmpty) {
                requestedForEmpty = true;
                requester();
              }

              const pos = selection.from;
              const from = pos - query.length - 1; // includes the leading `#`
              const to = pos;

              const matches = findTagMatches(candidates, query);
              if (matches.length === 0) {
                // Keep state so a late `receiveTagCandidates` can populate it.
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
          handleKeyDown(_view, event) {
            if (!state || state.matches.length === 0) {return false;}
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
