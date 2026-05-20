/**
 * Emoji shortcode autocomplete.
 *
 * Watches text right before the cursor for a `:abc` pattern. When the typed
 * stem (>=2 alphanumeric chars) matches one or more shortcodes, shows a small
 * floating popup with up to 8 matches. Arrow keys + Enter selects; Esc/click
 * outside dismisses. Selection replaces the `:abc` stem with an Emoji node.
 *
 * Lives as a TipTap extension so it has access to the editor state and keymap
 * priority. The popup itself is created in `document.body` to avoid mutating
 * the ProseMirror-managed DOM.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import emojiData from 'markdown-it-emoji/lib/data/full.mjs';

const EMOJI_MAP = emojiData as Record<string, string>;
const EMOJI_KEYS = Object.keys(EMOJI_MAP);

const MAX_RESULTS = 8;
const MIN_QUERY_LEN = 2;

interface Match {
  shortcode: string;
  char: string;
}

interface PopupState {
  from: number;
  to: number;
  query: string;
  matches: Match[];
  activeIndex: number;
}

let popupEl: HTMLElement | null = null;
let state: PopupState | null = null;

function findMatches(query: string): Match[] {
  const q = query.toLowerCase();
  const starts: Match[] = [];
  const contains: Match[] = [];
  for (const key of EMOJI_KEYS) {
    if (key === q) {
      starts.unshift({ shortcode: key, char: EMOJI_MAP[key] });
    } else if (key.startsWith(q)) {
      starts.push({ shortcode: key, char: EMOJI_MAP[key] });
    } else if (key.includes(q)) {
      contains.push({ shortcode: key, char: EMOJI_MAP[key] });
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

export function isEmojiAutocompleteOpen(): boolean {
  return popupEl !== null && state !== null && state.matches.length > 0;
}

function ensurePopup(): HTMLElement {
  if (!popupEl) {
    popupEl = document.createElement('div');
    popupEl.id = 'mikedown-emoji-ac';
    popupEl.setAttribute('role', 'listbox');
    document.body.appendChild(popupEl);
  }
  return popupEl;
}

function renderPopup(): void {
  if (!state) return;
  const el = ensurePopup();
  el.innerHTML = '';
  state.matches.forEach((m, i) => {
    const item = document.createElement('div');
    item.className = 'eac-item' + (i === state!.activeIndex ? ' eac-active' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(i === state!.activeIndex));

    const emoji = document.createElement('span');
    emoji.className = 'eac-emoji';
    emoji.textContent = m.char;

    const label = document.createElement('span');
    label.className = 'eac-label';
    label.textContent = `:${m.shortcode}:`;

    item.appendChild(emoji);
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
  // anchor below the typed `:abc`
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

let viewRef: any = null;

function selectMatch(index: number): void {
  if (!state || !viewRef) return;
  const match = state.matches[index];
  if (!match) return;
  const { from, to } = state;
  const emojiType = viewRef.state.schema.nodes.emoji;
  const tr = viewRef.state.tr;
  if (emojiType) {
    tr.replaceWith(from, to, emojiType.create({ shortcode: match.shortcode }));
  } else {
    tr.insertText(match.char, from, to);
  }
  viewRef.dispatch(tr);
  hidePopup();
  viewRef.focus();
}

const emojiAutocompleteKey = new PluginKey('emojiAutocomplete');

export const EmojiAutocomplete = Extension.create({
  name: 'emojiAutocomplete',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: emojiAutocompleteKey,
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
                Math.max(0, $from.parentOffset - 40),
                $from.parentOffset,
                undefined,
                '￼',
              );
              const m = /(?:^|[\s(>])(:([a-z0-9_+\-]{2,}))$/i.exec(textBefore);
              if (!m) { hidePopup(); return; }

              const query = m[2];
              const matches = findMatches(query);
              if (matches.length === 0) { hidePopup(); return; }

              const stemLen = m[1].length; // includes leading ':'
              const from = pos - stemLen;
              const to = pos;
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
