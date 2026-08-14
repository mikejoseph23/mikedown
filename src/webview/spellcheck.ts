/**
 * Spell checking for the WYSIWYG editor.
 *
 * VS Code creates its Electron window with `spellcheck: false`, so Chromium's
 * native spell checker is off for the whole workbench renderer — webviews
 * included. There is no per-webview opt-in, so MikeDown ships its own: hunspell
 * dictionaries parsed by `nspell` in the webview, with misspellings rendered as
 * ProseMirror inline decorations.
 *
 * Decorations (never direct DOM writes) are what keep this safe: ProseMirror
 * paints the squiggle class inside its own update cycle, so the "never mutate
 * editor.view.dom outside a transaction" constraint holds by construction.
 * `findreplace.ts` is the template this file follows.
 *
 * Source mode (CodeMirror) is deliberately NOT spell checked — see the summary
 * for that decision.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import nspell from 'nspell';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SpellCheckLanguage = 'en' | 'en-GB';

export interface SpellCheckConfig {
  enabled: boolean;
  language: SpellCheckLanguage;
  ignoreCodeBlocks: boolean;
  userWords: string[];
}

export interface Misspelling {
  from: number;
  to: number;
  word: string;
}

interface PluginState {
  decorations: DecorationSet;
}

// ─── Module state ────────────────────────────────────────────────────────────

const spellCheckKey = new PluginKey<PluginState>('spellCheck');

/** CSS class applied to a flagged range. Styled in `spellcheck.css`. */
const MISSPELLING_CLASS = 'mikedown-misspelling';

/** Debounce for the incremental re-check after typing. */
const RECHECK_DEBOUNCE_MS = 300;

let config: SpellCheckConfig = {
  enabled: true,
  language: 'en',
  ignoreCodeBlocks: true,
  userWords: [],
};

/** The live checker. `null` until the dictionary has been fetched and parsed. */
let spell: ReturnType<typeof nspell> | null = null;

/** Which language `spell` was built from, so we know when to rebuild. */
let loadedLanguage: SpellCheckLanguage | null = null;

/** In-flight load, so overlapping requests don't fetch the dictionary twice. */
let loadPromise: Promise<void> | null = null;

/** Session-only "Ignore" words — never persisted, cleared on reload. */
const ignoredWords = new Set<string>();

/** Editor instances that want a repaint once the dictionary lands. */
let boundEditor: any = null;

/** Ranges touched since the last re-check, awaiting the debounced pass. */
let pendingRanges: Array<{ from: number; to: number }> = [];
let recheckTimer: number | null = null;

/**
 * The word the caret currently sits inside, which we deliberately leave
 * unflagged so half-typed words don't squiggle under the cursor. Remembered so
 * we can re-check it once the caret leaves.
 */
let caretSkip: { from: number; to: number } | null = null;

// ─── Dictionary loading ──────────────────────────────────────────────────────

/**
 * Base URI for the shipped `dictionaries/` folder. The host stamps it onto
 * `<body data-dictionary-base>` because the CSP has no inline-script allowance.
 */
function dictionaryBase(): string {
  const raw = document.body?.dataset?.dictionaryBase ?? '';
  return raw.replace(/\/+$/, '');
}

function dictionaryDir(language: SpellCheckLanguage): string {
  return language === 'en-GB' ? 'en-GB' : 'en';
}

async function loadDictionary(language: SpellCheckLanguage): Promise<void> {
  const base = dictionaryBase();
  if (!base) return; // Host didn't stamp the attribute — nothing to fetch.
  const dir = `${base}/${dictionaryDir(language)}`;
  const [aff, dic] = await Promise.all([
    fetch(`${dir}/index.aff`).then(r => r.text()),
    fetch(`${dir}/index.dic`).then(r => r.text()),
  ]);
  const instance = nspell(aff, dic);
  applyWordLists(instance);
  spell = instance;
  loadedLanguage = language;
}

function applyWordLists(instance: ReturnType<typeof nspell>): void {
  for (const word of config.userWords) {
    if (word) instance.add(word);
  }
  for (const word of ignoredWords) {
    instance.add(word);
  }
}

/**
 * Kick off the dictionary load if it's needed and not already running. Repaints
 * the editor when it resolves. Runs on idle so the 55 ms parse never sits on
 * the document-open path.
 */
function ensureDictionary(editor: any): void {
  if (!config.enabled) return;
  if (spell && loadedLanguage === config.language) return;
  if (loadPromise) return;
  const target = config.language;
  const start = (): void => {
    loadPromise = loadDictionary(target)
      .then(() => {
        if (config.enabled) requestFullScan(editor);
      })
      .catch(() => {
        // A missing or unreadable dictionary must never break editing — the
        // feature just stays off for this session.
        spell = null;
        loadedLanguage = null;
      })
      .finally(() => {
        loadPromise = null;
      });
  };
  const idle = (window as any).requestIdleCallback as undefined | ((cb: () => void, opts?: any) => number);
  if (typeof idle === 'function') {
    idle(start, { timeout: 2000 });
  } else {
    window.setTimeout(start, 0);
  }
}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

/** Words are letter runs; apostrophes join, hyphens split (so `right-click`
 *  checks as `right` + `click` rather than as one unknown token). */
const WORD_RE = /[A-Za-z][A-Za-z'’]*/g;

/**
 * Non-prose runs masked out before tokenizing: URLs, email addresses, file
 * paths, `snake_case`, and `name.ext` style tokens. An untuned tokenizer flags
 * hundreds of these per document, which drowns the real misspellings.
 */
const NON_PROSE_RE = /\S*(?:https?:\/\/|www\.|[/\\@_]|\.[A-Za-z0-9]{1,5}(?![A-Za-z0-9]))\S*/g;

/** Replace non-prose runs with spaces, preserving offsets into the text node. */
function maskNonProse(text: string): string {
  return text.replace(NON_PROSE_RE, m => ' '.repeat(m.length));
}

/** Tokens we never check even when unknown to the dictionary. */
function isSkippableToken(token: string): boolean {
  if (token.length < 3) return true;                 // "vs", "a", "an" — noise
  if (token === token.toUpperCase()) return true;    // acronyms: API, HTML
  if (/[a-z][A-Z]/.test(token)) return true;         // camelCase identifiers
  return false;
}

/** Strip possessive / quote apostrophes that the token regex swept up. */
function trimToken(token: string): { word: string; offset: number } {
  let start = 0;
  let end = token.length;
  while (end > start && /['’]/.test(token[end - 1])) end--;
  const word = token.slice(start, end);
  return { word, offset: start };
}

export interface CheckableToken {
  word: string;
  /** Offset of the word within the text passed to `tokenize`. */
  index: number;
}

/**
 * Split a run of text into the words worth spell checking. Exported for unit
 * testing — the tokenizer, not the dictionary, is where the noise lives.
 */
export function tokenize(text: string): CheckableToken[] {
  const masked = maskNonProse(text);
  const out: CheckableToken[] = [];
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(masked)) !== null) {
    const { word, offset } = trimToken(m[0]);
    if (!word || isSkippableToken(word)) continue;
    out.push({ word, index: m.index + offset });
  }
  return out;
}

// ─── Document scanning ───────────────────────────────────────────────────────

function isKnown(word: string): boolean {
  if (!spell) return true;
  if (ignoredWords.has(word)) return true;
  if (spell.correct(word)) return true;
  // Sentence-initial capitals: "Colour" should follow the same verdict as
  // "colour" when the dictionary only lists the lowercase form.
  if (/^[A-Z][a-z'’]*$/.test(word) && spell.correct(word.toLowerCase())) return true;
  return false;
}

/**
 * Walk `[from, to]` of the document and return every misspelled range.
 * Excludes code blocks, inline code, links, highlighted text, and wikilinks
 * (see the walk below).
 */
function findMisspellings(doc: any, from: number, to: number): Misspelling[] {
  if (!spell) return [];
  const out: Misspelling[] = [];
  doc.nodesBetween(from, to, (node: any, pos: number) => {
    if (config.ignoreCodeBlocks) {
      // `spec.code` catches codeBlock and any future code-ish node (mermaid
      // blocks are codeBlocks, so they're covered here too).
      if (node.type.spec?.code) return false;
    }
    // Wikilinks are file references, not prose.
    if (node.type.name === 'wikilink') return false;
    if (!node.isText) return true;

    const marks: any[] = node.marks ?? [];
    if (marks.some(m => m.type.name === 'link')) return false;
    if (marks.some(m => m.type.name === 'highlight')) return false;
    if (config.ignoreCodeBlocks && marks.some(m => m.type.name === 'code')) return false;

    const text: string = node.text ?? '';
    for (const token of tokenize(text)) {
      if (isKnown(token.word)) continue;
      const wordFrom = pos + token.index;
      const wordTo = wordFrom + token.word.length;
      if (wordTo <= from || wordFrom >= to) continue; // outside the scanned slice
      out.push({ from: wordFrom, to: wordTo, word: token.word });
    }
    return true;
  });
  return out;
}

/** The word the caret sits strictly inside, if any — left unflagged. */
function caretWord(state: EditorState, found: Misspelling[]): Misspelling | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const pos = sel.from;
  return found.find(m => pos > m.from && pos <= m.to) ?? null;
}

function toDecorations(found: Misspelling[]): Decoration[] {
  return found.map(m =>
    Decoration.inline(m.from, m.to, { class: MISSPELLING_CLASS }, { word: m.word })
  );
}

/** Expand a changed range out to the text blocks that contain it, so a re-scan
 *  sees whole words rather than the sliver the edit touched. */
function expandToBlocks(doc: any, from: number, to: number): { from: number; to: number } {
  const clamp = (p: number): number => Math.max(0, Math.min(doc.content.size, p));
  try {
    const $from = doc.resolve(clamp(from));
    const $to = doc.resolve(clamp(to));
    return { from: $from.start($from.depth), to: $to.end($to.depth) };
  } catch {
    return { from: clamp(from), to: clamp(to) };
  }
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

type SpellMeta =
  | { kind: 'full' }
  | { kind: 'rescan'; ranges: Array<{ from: number; to: number }> }
  | { kind: 'clear' };

function fullScan(state: EditorState): PluginState {
  const found = findMisspellings(state.doc, 0, state.doc.content.size);
  const skip = caretWord(state, found);
  caretSkip = skip ? { from: skip.from, to: skip.to } : null;
  const visible = skip ? found.filter(m => m !== skip) : found;
  return { decorations: DecorationSet.create(state.doc, toDecorations(visible)) };
}

function rescanRanges(
  prev: PluginState,
  state: EditorState,
  ranges: Array<{ from: number; to: number }>
): PluginState {
  let set = prev.decorations;
  let skip: Misspelling | null = null;
  for (const raw of ranges) {
    const range = expandToBlocks(state.doc, raw.from, raw.to);
    const stale = set.find(range.from, range.to);
    if (stale.length) set = set.remove(stale);
    const found = findMisspellings(state.doc, range.from, range.to);
    const inCaret = caretWord(state, found);
    if (inCaret) skip = inCaret;
    const visible = inCaret ? found.filter(m => m !== inCaret) : found;
    if (visible.length) set = set.add(state.doc, toDecorations(visible));
  }
  caretSkip = skip ? { from: skip.from, to: skip.to } : null;
  return { decorations: set };
}

export const SpellCheckExtension = Extension.create({
  name: 'spellCheck',

  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key: spellCheckKey,
        state: {
          init(): PluginState {
            return { decorations: DecorationSet.empty };
          },
          apply(tr: Transaction, prev: PluginState, _old: EditorState, next: EditorState): PluginState {
            const meta = tr.getMeta(spellCheckKey) as SpellMeta | undefined;
            if (meta?.kind === 'clear') {
              caretSkip = null;
              pendingRanges = [];
              return { decorations: DecorationSet.empty };
            }
            if (!config.enabled || !spell) {
              return prev.decorations === DecorationSet.empty ? prev : { decorations: DecorationSet.empty };
            }
            if (meta?.kind === 'full') return fullScan(next);
            if (meta?.kind === 'rescan') return rescanRanges(prev, next, meta.ranges);
            if (!tr.docChanged) return prev;

            // Map the existing squiggles forward so they track the text they
            // belong to, and remember what changed for the debounced re-check.
            const mapped = prev.decorations.map(tr.mapping, next.doc);
            tr.mapping.maps.forEach((map: any, i: number) => {
              map.forEach((_os: number, _oe: number, newStart: number, newEnd: number) => {
                const rest = tr.mapping.slice(i + 1);
                pendingRanges.push({ from: rest.map(newStart, -1), to: rest.map(newEnd, 1) });
              });
            });
            if (caretSkip) {
              caretSkip = {
                from: tr.mapping.map(caretSkip.from, -1),
                to: tr.mapping.map(caretSkip.to, 1),
              };
            }
            return { decorations: mapped };
          },
        },
        props: {
          decorations(state: EditorState) {
            return spellCheckKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
        view(view) {
          boundEditor = (view as any);
          return {
            update: (v) => {
              if (!config.enabled) return;
              // IME composition: leave the document alone until it commits.
              if ((v as any).composing) return;
              if (pendingRanges.length) {
                scheduleRecheck(v);
                return;
              }
              // The caret left the word we were holding back — check it now.
              if (caretSkip) {
                const sel = v.state.selection;
                const inside = sel.empty && sel.from > caretSkip.from && sel.from <= caretSkip.to;
                if (!inside) {
                  const range = caretSkip;
                  caretSkip = null;
                  dispatchMeta(v, { kind: 'rescan', ranges: [range] });
                }
              }
            },
            destroy: () => {
              if (recheckTimer !== null) {
                clearTimeout(recheckTimer);
                recheckTimer = null;
              }
              pendingRanges = [];
              caretSkip = null;
              if (boundEditor === view) boundEditor = null;
            },
          };
        },
      }),
    ];
  },
});

// ─── Dispatch helpers ────────────────────────────────────────────────────────

function dispatchMeta(view: any, meta: SpellMeta): void {
  try {
    view.dispatch(view.state.tr.setMeta(spellCheckKey, meta));
  } catch {
    // View may have been torn down between scheduling and firing.
  }
}

function scheduleRecheck(view: any): void {
  if (recheckTimer !== null) clearTimeout(recheckTimer);
  recheckTimer = window.setTimeout(() => {
    recheckTimer = null;
    const ranges = pendingRanges;
    pendingRanges = [];
    if (!ranges.length || !config.enabled || !spell) return;
    if (view.composing) return;
    dispatchMeta(view, { kind: 'rescan', ranges });
  }, RECHECK_DEBOUNCE_MS);
}

function viewOf(editor: any): any | null {
  return editor?.view ?? (boundEditor && boundEditor.state ? boundEditor : null);
}

function requestFullScan(editor: any): void {
  const view = viewOf(editor);
  if (!view) return;
  dispatchMeta(view, { kind: 'full' });
}

function requestClear(editor: any): void {
  const view = viewOf(editor);
  if (!view) return;
  dispatchMeta(view, { kind: 'clear' });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Called once after the editor mounts, and again on every `settings` broadcast.
 * Handles enable/disable and language switches live — no reload.
 */
export function configureSpellCheck(editor: any, partial: Partial<SpellCheckConfig>): void {
  const prev = config;
  config = { ...config, ...partial };

  if (!config.enabled) {
    // Off means off: drop the decorations and never load a dictionary.
    requestClear(editor);
    return;
  }

  const languageChanged = config.language !== prev.language;
  const wordsChanged =
    config.userWords.length !== prev.userWords.length ||
    config.userWords.some((w, i) => w !== prev.userWords[i]);

  if (languageChanged || loadedLanguage !== config.language) {
    spell = null;
    loadedLanguage = null;
    requestClear(editor);
    ensureDictionary(editor);
    return;
  }

  if (!spell) {
    ensureDictionary(editor);
    return;
  }

  if (wordsChanged || config.ignoreCodeBlocks !== prev.ignoreCodeBlocks || !prev.enabled) {
    applyWordLists(spell);
    requestFullScan(editor);
  }
}

/** Current config — read by the settings modal so it opens on live values. */
export function getSpellCheckConfig(): SpellCheckConfig {
  return { ...config, userWords: [...config.userWords] };
}

/**
 * The misspelling at a document position, if any. Used by the right-click
 * dispatcher to decide whether to show the spelling menu.
 */
export function getMisspellingAt(editor: any, pos: number): Misspelling | null {
  const view = viewOf(editor);
  if (!view || !config.enabled || !spell) return null;
  const state = spellCheckKey.getState(view.state);
  if (!state) return null;
  const hits = state.decorations.find(pos, pos);
  if (!hits.length) return null;
  const deco = hits[0] as any;
  const word = deco.spec?.word ?? view.state.doc.textBetween(deco.from, deco.to);
  return { from: deco.from, to: deco.to, word };
}

/** Up to `limit` corrections for a word, cheapest-first per nspell's ranking. */
export function getSuggestions(word: string, limit = 5): string[] {
  if (!spell) return [];
  try {
    return spell.suggest(word).slice(0, limit);
  } catch {
    return [];
  }
}

/** Session-only ignore — not persisted anywhere. */
export function ignoreWord(editor: any, word: string): void {
  ignoredWords.add(word);
  if (spell) spell.add(word);
  requestFullScan(editor);
}

/** Persisted "Add to Dictionary" — mirrors locally so the squiggle clears now
 *  rather than waiting on the settings round-trip. */
export function addWordToDictionary(editor: any, word: string): void {
  if (!config.userWords.includes(word)) {
    config.userWords = [...config.userWords, word];
  }
  if (spell) spell.add(word);
  requestFullScan(editor);
}
