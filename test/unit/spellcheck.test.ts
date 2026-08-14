import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import Link from '@tiptap/extension-link';
import { Wikilink } from '../../src/webview/wikilink-node';
import { Highlight } from '../../src/webview/highlight';
import { tokenize } from '../../src/webview/spellcheck';

// ─── Fixture dictionary ────────────────────────────────────────────────────
//
// A tiny hand-built hunspell pair, not the real 550 KB bundled dictionaries,
// so tests are fast and deterministic regardless of upstream word-list churn.
// `color`/`colour` differ between the two locales on purpose — that's the
// probe used for the language-switch test.

const AFF = "SET UTF-8\nTRY esianrtolcdugmphbyfvkwzESIANRTOLCDUGMPHBYFVKWZ'\n";
const DIC_EN = '8\ncolor\nhello\nworld\nquick\nbrown\nfox\ntest\ncode\n';
const DIC_EN_GB = '8\ncolour\nhello\nworld\nquick\nbrown\nfox\ntest\ncode\n';

/** Known-good word per fixture locale, and the misspelling used to probe it. */
const MISSPELLED = 'helo'; // one edit from "hello", which both locales know
const KNOWN = 'hello';

function installFetchMock(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const isGB = url.includes('en-GB');
      const isAff = url.endsWith('.aff');
      const body = isAff ? AFF : isGB ? DIC_EN_GB : DIC_EN;
      return Promise.resolve({ text: () => Promise.resolve(body) } as Response);
    })
  );
}

/**
 * Loads a fresh module instance (module-level singleton state — `config`,
 * `spell`, `ignoredWords` — must not leak between tests) and drives it to a
 * loaded dictionary via the mocked fetch above.
 */
async function freshSpellCheck() {
  vi.resetModules();
  installFetchMock();
  document.body.innerHTML = '';
  document.body.dataset.dictionaryBase = 'mock://dictionaries';
  const mod = await import('../../src/webview/spellcheck');
  return mod;
}

function makeEditor(extensions: any[], content = '') {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Markdown.configure({ html: false, tightLists: true, breaks: true }),
      Link.configure({ openOnClick: false }),
      Wikilink,
      Highlight,
      ...extensions,
    ],
    content,
    element: document.createElement('div'),
  });
}

function squiggleTexts(editor: Editor): string[] {
  const dom = editor.view.dom as HTMLElement;
  return Array.from(dom.querySelectorAll('.mikedown-misspelling')).map(el => el.textContent ?? '');
}

// ─── tokenize() — pure, no dictionary needed ───────────────────────────────

describe('tokenize', () => {
  it('splits contractions into the letter run, keeping the apostrophe', () => {
    expect(tokenize("don't").map(t => t.word)).toEqual(["don't"]);
    expect(tokenize("it's a test").map(t => t.word)).toEqual(["it's", 'test']);
  });

  it('splits hyphenated words at the hyphen', () => {
    // Documented behavior (spellcheck.ts comment on WORD_RE): hyphens are not
    // part of the word-character class, so "right-click" checks as two words.
    expect(tokenize('right-click').map(t => t.word)).toEqual(['right', 'click']);
  });

  it('keeps possessives intact but trims a trailing bare apostrophe', () => {
    expect(tokenize("the dog's bone").map(t => t.word)).toEqual(['the', "dog's", 'bone']);
    // Plural possessive "dogs'" — the trailing apostrophe carries no letters
    // after it, so trimToken strips it back to "dogs".
    expect(tokenize("the dogs' bones").map(t => t.word)).toEqual(['the', 'dogs', 'bones']);
  });

  it('drops non-ASCII letters — unicode words are only checked ASCII-prefix', () => {
    // WORD_RE is [A-Za-z][A-Za-z'’]* — café tokenizes as "caf", not "café"
    // (the "é" simply isn't in the word-character class, so the match ends
    // there). This is current, documented tokenizer behavior, not a claim
    // that it's ideal; flagging here so a future change to support unicode
    // letters has a test that will visibly break instead of silently
    // changing behavior.
    expect(tokenize('café').map(t => t.word)).toEqual(['caf']);
    // "naïve" splits into "na" + "ve" at the "ï", and both fall below the
    // 3-character noise threshold (isSkippableToken), so neither is checked
    // — only "idea" survives. Not a deliberate unicode feature; a side
    // effect of the ASCII-only regex plus the short-token filter.
    expect(tokenize('naïve idea').map(t => t.word)).toEqual(['idea']);
  });

  it('masks URLs, emails, and file paths out entirely', () => {
    expect(tokenize('see https://example.com/path for info').map(t => t.word)).toEqual([
      'see',
      'for',
      'info',
    ]);
    expect(tokenize('email me at foo@example.com please').map(t => t.word)).toEqual([
      'email',
      'please',
    ]);
    expect(tokenize('open src/webview/spellcheck.ts now').map(t => t.word)).toEqual([
      'open',
      'now',
    ]);
  });

  it('skips short tokens, acronyms, and camelCase identifiers', () => {
    expect(tokenize('an API call').map(t => t.word)).toEqual(['call']); // "an" too short, "API" all-caps
    expect(tokenize('call getMisspellingAt now').map(t => t.word)).toEqual(['call', 'now']);
  });

  it('reports the correct offset for a word after a masked run', () => {
    const text = 'see https://x.com word';
    const tokens = tokenize(text);
    const wordTok = tokens.find(t => t.word === 'word')!;
    expect(text.slice(wordTok.index, wordTok.index + 4)).toBe('word');
  });
});

// ─── Exclusion rules — through a real editor + the ProseMirror plugin ──────

describe('exclusion rules (decorations in a live editor)', () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
    vi.unstubAllGlobals();
  });

  it('flags a misspelling in plain prose', async () => {
    const mod = await freshSpellCheck();
    editor = makeEditor([mod.SpellCheckExtension], `This is a ${MISSPELLED} word.`);
    mod.configureSpellCheck(editor, { enabled: true, language: 'en', ignoreCodeBlocks: true, userWords: [] });
    await vi.waitFor(() => expect(squiggleTexts(editor)).toContain(MISSPELLED), { timeout: 2000 });
  });

  it('does not flag the same misspelling inside a fenced code block', async () => {
    const mod = await freshSpellCheck();
    editor = makeEditor([mod.SpellCheckExtension], `\`\`\`\n${MISSPELLED} world\n\`\`\``);
    mod.configureSpellCheck(editor, { enabled: true, language: 'en', ignoreCodeBlocks: true, userWords: [] });
    // Give the dictionary time to load and a full scan to run, then assert
    // nothing was flagged (a negative wait — poll a bit, then check once).
    await new Promise(r => setTimeout(r, 300));
    expect(squiggleTexts(editor)).not.toContain(MISSPELLED);
  });

  it('does not flag the same misspelling inside inline code', async () => {
    const mod = await freshSpellCheck();
    editor = makeEditor([mod.SpellCheckExtension], `Run \`${MISSPELLED}\` now.`);
    mod.configureSpellCheck(editor, { enabled: true, language: 'en', ignoreCodeBlocks: true, userWords: [] });
    await new Promise(r => setTimeout(r, 300));
    expect(squiggleTexts(editor)).not.toContain(MISSPELLED);
  });

  it('does not flag misspellings inside link text', async () => {
    const mod = await freshSpellCheck();
    editor = makeEditor([mod.SpellCheckExtension], `See [${MISSPELLED} link](https://example.com)`);
    mod.configureSpellCheck(editor, { enabled: true, language: 'en', ignoreCodeBlocks: true, userWords: [] });
    await new Promise(r => setTimeout(r, 300));
    expect(squiggleTexts(editor)).not.toContain(MISSPELLED);
  });

  it('does not flag misspellings inside a [[wikilink]] target', async () => {
    const mod = await freshSpellCheck();
    editor = makeEditor([mod.SpellCheckExtension], `[[${MISSPELLED} Note]]`);
    mod.configureSpellCheck(editor, { enabled: true, language: 'en', ignoreCodeBlocks: true, userWords: [] });
    await new Promise(r => setTimeout(r, 300));
    expect(squiggleTexts(editor)).not.toContain(MISSPELLED);
  });

  it('does not flag misspellings inside ==highlighted== text', async () => {
    const mod = await freshSpellCheck();
    editor = makeEditor([mod.SpellCheckExtension], `This is ==${MISSPELLED}== text.`);
    mod.configureSpellCheck(editor, { enabled: true, language: 'en', ignoreCodeBlocks: true, userWords: [] });
    await new Promise(r => setTimeout(r, 300));
    expect(squiggleTexts(editor)).not.toContain(MISSPELLED);
  });
});

// ─── User dictionary: add / ignore / external (cSpell) words ──────────────

describe('user dictionary logic', () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
    vi.unstubAllGlobals();
  });

  it('"Add to Dictionary" clears the squiggle and it does not return on rescan', async () => {
    const mod = await freshSpellCheck();
    editor = makeEditor([mod.SpellCheckExtension], `This is ${MISSPELLED} text.`);
    mod.configureSpellCheck(editor, { enabled: true, language: 'en', ignoreCodeBlocks: true, userWords: [] });
    await vi.waitFor(() => expect(squiggleTexts(editor)).toContain(MISSPELLED), { timeout: 2000 });

    mod.addWordToDictionary(editor, MISSPELLED);
    expect(squiggleTexts(editor)).not.toContain(MISSPELLED);

    // Retype elsewhere in the doc — a fresh occurrence of the same word must
    // also come back clean, proving it's dictionary state, not a one-off
    // decoration removal.
    editor.commands.insertContentAt(editor.state.doc.content.size, ` Another ${MISSPELLED} here.`);
    await new Promise(r => setTimeout(r, 400));
    expect(squiggleTexts(editor)).not.toContain(MISSPELLED);
    expect(mod.getSpellCheckConfig().userWords).toContain(MISSPELLED);
  });

  it('"Ignore" clears the squiggle for the session without persisting it', async () => {
    const mod = await freshSpellCheck();
    editor = makeEditor([mod.SpellCheckExtension], `This is ${MISSPELLED} text.`);
    mod.configureSpellCheck(editor, { enabled: true, language: 'en', ignoreCodeBlocks: true, userWords: [] });
    await vi.waitFor(() => expect(squiggleTexts(editor)).toContain(MISSPELLED), { timeout: 2000 });

    mod.ignoreWord(editor, MISSPELLED);
    expect(squiggleTexts(editor)).not.toContain(MISSPELLED);
    // Session-only: does not land in the persisted/editable userWords list.
    expect(mod.getSpellCheckConfig().userWords).not.toContain(MISSPELLED);
  });

  it('honors a pre-seeded userWords list (e.g. loaded from settings) on first scan', async () => {
    const mod = await freshSpellCheck();
    editor = makeEditor([mod.SpellCheckExtension], `This is ${MISSPELLED} text.`);
    mod.configureSpellCheck(editor, {
      enabled: true,
      language: 'en',
      ignoreCodeBlocks: true,
      userWords: [MISSPELLED],
    });
    await new Promise(r => setTimeout(r, 300));
    expect(squiggleTexts(editor)).not.toContain(MISSPELLED);
  });

  it('getMisspellingAt returns null once a word is added to the dictionary', async () => {
    const mod = await freshSpellCheck();
    editor = makeEditor([mod.SpellCheckExtension], `This is ${MISSPELLED} text.`);
    mod.configureSpellCheck(editor, { enabled: true, language: 'en', ignoreCodeBlocks: true, userWords: [] });
    await vi.waitFor(() => expect(squiggleTexts(editor)).toContain(MISSPELLED), { timeout: 2000 });

    // +1 for the paragraph node's own start offset, +1 more to land strictly
    // inside the word (getMisspellingAt/caretWord treat `from` itself as the
    // boundary before the word, not inside it).
    const pos = editor.state.doc.textContent.indexOf(MISSPELLED) + 2;
    expect(mod.getMisspellingAt(editor, pos)).not.toBeNull();

    mod.addWordToDictionary(editor, MISSPELLED);
    expect(mod.getMisspellingAt(editor, pos)).toBeNull();
  });
});

// ─── Settings toggling: enabled/disabled, language switch ─────────────────

describe('settings toggling', () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
    vi.unstubAllGlobals();
  });

  it('never fetches a dictionary when disabled', async () => {
    const mod = await freshSpellCheck();
    editor = makeEditor([mod.SpellCheckExtension], `This is ${MISSPELLED} text.`);
    mod.configureSpellCheck(editor, { enabled: false, language: 'en', ignoreCodeBlocks: true, userWords: [] });
    await new Promise(r => setTimeout(r, 300));
    expect(fetch).not.toHaveBeenCalled();
    expect(squiggleTexts(editor)).toHaveLength(0);
  });

  it('toggling off live clears existing squiggles without a reload', async () => {
    const mod = await freshSpellCheck();
    editor = makeEditor([mod.SpellCheckExtension], `This is ${MISSPELLED} text.`);
    mod.configureSpellCheck(editor, { enabled: true, language: 'en', ignoreCodeBlocks: true, userWords: [] });
    await vi.waitFor(() => expect(squiggleTexts(editor)).toContain(MISSPELLED), { timeout: 2000 });

    mod.configureSpellCheck(editor, { enabled: false });
    expect(squiggleTexts(editor)).toHaveLength(0);
  });

  it('toggling back on re-scans and squiggles reappear', async () => {
    const mod = await freshSpellCheck();
    editor = makeEditor([mod.SpellCheckExtension], `This is ${MISSPELLED} text.`);
    mod.configureSpellCheck(editor, { enabled: true, language: 'en', ignoreCodeBlocks: true, userWords: [] });
    await vi.waitFor(() => expect(squiggleTexts(editor)).toContain(MISSPELLED), { timeout: 2000 });

    mod.configureSpellCheck(editor, { enabled: false });
    expect(squiggleTexts(editor)).toHaveLength(0);

    mod.configureSpellCheck(editor, { enabled: true });
    await vi.waitFor(() => expect(squiggleTexts(editor)).toContain(MISSPELLED), { timeout: 2000 });
  });

  it('switching language re-fetches and applies the new locale (color vs colour)', async () => {
    const mod = await freshSpellCheck();
    editor = makeEditor(
      [mod.SpellCheckExtension],
      '<p>Pick a color and a colour, they should differ by locale.</p>'
    );
    mod.configureSpellCheck(editor, { enabled: true, language: 'en', ignoreCodeBlocks: true, userWords: [] });
    await vi.waitFor(() => expect(squiggleTexts(editor)).toContain('colour'), { timeout: 2000 });
    expect(squiggleTexts(editor)).not.toContain('color');

    mod.configureSpellCheck(editor, { language: 'en-GB' });
    await vi.waitFor(() => expect(squiggleTexts(editor)).toContain('color'), { timeout: 2000 });
    expect(squiggleTexts(editor)).not.toContain('colour');
  });

  it('ignoreCodeBlocks: false extends checking into fenced code', async () => {
    const mod = await freshSpellCheck();
    editor = makeEditor([mod.SpellCheckExtension], `<pre><code>${MISSPELLED} world</code></pre>`);
    mod.configureSpellCheck(editor, {
      enabled: true,
      language: 'en',
      ignoreCodeBlocks: false,
      userWords: [],
    });
    await vi.waitFor(() => expect(squiggleTexts(editor)).toContain(MISSPELLED), { timeout: 2000 });
  });
});
