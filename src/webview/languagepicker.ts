/**
 * Language Picker — small popover for choosing a code block's language.
 *
 * Anchored to an element (the pill or a screen point from the context menu).
 * Searchable. Free-text input accepts any identifier. "Clear" sets plaintext.
 *
 * Lives in document.body to avoid mutating ProseMirror's managed DOM.
 */

import { Editor } from '@tiptap/core';

const CURATED: string[] = [
  'json', 'javascript', 'typescript', 'python', 'bash',
  'html', 'css', 'jsx', 'tsx', 'sql',
  'yaml', 'markdown', 'go', 'rust', 'ruby', 'java',
];

let popoverEl: HTMLElement | null = null;
let onClose: (() => void) | null = null;

function applyLanguage(editor: Editor, language: string): void {
  const lang = language.trim();
  editor.chain().focus().updateAttributes('codeBlock', { language: lang || null }).run();
}

function clearLanguage(editor: Editor): void {
  editor.chain().focus().updateAttributes('codeBlock', { language: null }).run();
}

export function hideLanguagePicker(): void {
  if (popoverEl) {
    popoverEl.remove();
    popoverEl = null;
  }
  if (onClose) {
    const cb = onClose;
    onClose = null;
    cb();
  }
  document.removeEventListener('mousedown', handleDocMouseDown, true);
  document.removeEventListener('keydown', handleDocKeyDown, true);
}

function handleDocMouseDown(e: MouseEvent): void {
  if (!popoverEl) return;
  if (!(e.target as HTMLElement).closest('#mikedown-language-picker')) {
    hideLanguagePicker();
  }
}

function handleDocKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    hideLanguagePicker();
  }
}

interface ShowOptions {
  anchorRect?: DOMRect;
  point?: { x: number; y: number };
  allLanguages: string[];
  currentLanguage: string;
  onClosed?: () => void;
}

export function showLanguagePicker(editor: Editor, opts: ShowOptions): void {
  hideLanguagePicker();
  onClose = opts.onClosed ?? null;

  popoverEl = document.createElement('div');
  popoverEl.id = 'mikedown-language-picker';
  popoverEl.setAttribute('role', 'dialog');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'lp-input';
  input.placeholder = 'Search or type any language…';
  input.spellcheck = false;
  input.autocapitalize = 'off';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Code block language');
  popoverEl.appendChild(input);

  const list = document.createElement('div');
  list.className = 'lp-list';
  list.setAttribute('role', 'listbox');
  popoverEl.appendChild(list);

  const allKnown = Array.from(new Set([...CURATED, ...opts.allLanguages]));
  const others = opts.allLanguages
    .filter(l => !CURATED.includes(l))
    .sort();
  const currentLang = (opts.currentLanguage || '').trim().toLowerCase();

  let focusedIndex = 0;
  let rendered: HTMLElement[] = [];

  const buildItem = (label: string, value: string, opts2?: { hint?: string; isClear?: boolean }): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'lp-item';
    if (opts2?.isClear) el.classList.add('lp-item-clear');
    if (value.toLowerCase() === currentLang) el.classList.add('lp-item-current');
    el.setAttribute('role', 'option');
    el.dataset.value = value;

    const labelEl = document.createElement('span');
    labelEl.className = 'lp-item-label';
    labelEl.textContent = label;
    el.appendChild(labelEl);

    if (opts2?.hint) {
      const hintEl = document.createElement('span');
      hintEl.className = 'lp-item-hint';
      hintEl.textContent = opts2.hint;
      el.appendChild(hintEl);
    }

    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (opts2?.isClear) {
        clearLanguage(editor);
      } else {
        applyLanguage(editor, value);
      }
      hideLanguagePicker();
    });
    el.addEventListener('mouseenter', () => setFocused(rendered.indexOf(el)));
    return el;
  };

  const setFocused = (i: number): void => {
    rendered.forEach((el, idx) => el.classList.toggle('lp-focused', idx === i));
    focusedIndex = i;
    if (i >= 0 && rendered[i]) {
      rendered[i].scrollIntoView({ block: 'nearest' });
    }
  };

  const render = (filter: string): void => {
    list.textContent = '';
    rendered = [];
    const q = filter.trim().toLowerCase();

    // "Clear language" first
    const clearItem = buildItem('Clear language', '', { isClear: true });
    if (!q || 'clear language'.includes(q) || 'plaintext'.includes(q)) {
      list.appendChild(clearItem);
      rendered.push(clearItem);
    }

    let matches: { label: string; value: string; hint?: string }[] = [];
    if (q) {
      // Search across everything we know about
      const seen = new Set<string>();
      for (const lang of allKnown) {
        if (lang.toLowerCase().includes(q) && !seen.has(lang)) {
          seen.add(lang);
          matches.push({ label: lang, value: lang });
        }
      }
      // If the typed string isn't an exact match for any known language,
      // offer it as a custom value at the top.
      if (q && !allKnown.some(l => l.toLowerCase() === q)) {
        matches.unshift({ label: filter.trim(), value: filter.trim(), hint: 'Use as custom' });
      }
    } else {
      // No filter: show curated set first, then "More languages…" section
      for (const lang of CURATED) matches.push({ label: lang, value: lang });
    }

    for (const m of matches) {
      const el = buildItem(m.label, m.value, { hint: m.hint });
      list.appendChild(el);
      rendered.push(el);
    }

    if (!q && others.length > 0) {
      const header = document.createElement('div');
      header.className = 'lp-section-header';
      header.textContent = 'All languages';
      list.appendChild(header);
      for (const lang of others) {
        const el = buildItem(lang, lang);
        list.appendChild(el);
        rendered.push(el);
      }
    }

    if (rendered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lp-empty';
      empty.textContent = 'No matches';
      list.appendChild(empty);
    } else {
      setFocused(0);
    }
  };

  input.addEventListener('input', () => render(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (rendered.length === 0) return;
      setFocused((focusedIndex + 1) % rendered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (rendered.length === 0) return;
      setFocused(focusedIndex <= 0 ? rendered.length - 1 : focusedIndex - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = rendered[focusedIndex];
      if (target) {
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      } else if (input.value.trim()) {
        applyLanguage(editor, input.value);
        hideLanguagePicker();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hideLanguagePicker();
    }
  });

  document.body.appendChild(popoverEl);
  render('');

  // Position
  const vw = window.innerWidth, vh = window.innerHeight;
  popoverEl.style.visibility = 'hidden';
  const rect = popoverEl.getBoundingClientRect();
  let left: number, top: number;
  if (opts.anchorRect) {
    left = opts.anchorRect.right - rect.width;
    top = opts.anchorRect.bottom + 4;
    if (top + rect.height > vh - 4) {
      top = opts.anchorRect.top - rect.height - 4;
    }
  } else if (opts.point) {
    left = opts.point.x;
    top = opts.point.y;
  } else {
    left = (vw - rect.width) / 2;
    top = (vh - rect.height) / 2;
  }
  left = Math.max(4, Math.min(left, vw - rect.width - 4));
  top = Math.max(4, Math.min(top, vh - rect.height - 4));
  popoverEl.style.left = `${left}px`;
  popoverEl.style.top = `${top}px`;
  popoverEl.style.visibility = '';

  // Delay listeners by one frame so the click that opened us doesn't immediately close.
  requestAnimationFrame(() => {
    document.addEventListener('mousedown', handleDocMouseDown, true);
    document.addEventListener('keydown', handleDocKeyDown, true);
  });

  input.focus();
}

export function isLanguagePickerOpen(): boolean {
  return popoverEl !== null;
}
