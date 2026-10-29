/**
 * Rewrite family UI (AI writing M2): the grouped menus, the language and
 * reading level pickers with remembered choices, Explain's read-only popover
 * and Insert below, whole-document translate, and the structure warning line.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { undo as cmUndo } from '@codemirror/commands';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
import type { AiCompletionRequest, MikeDownAiHost } from '../src/ai';
import { AI_REWRITE_VARIANTS } from '../src/ai/prompts/rewrite';
import { EXPLAIN_SYSTEM_PROMPT } from '../src/ai/prompts/explain';
import { checkMarkdownStructure } from '../src/ai/prompts/structureCheck';
import { aiRewriteMenuGroups, blockquoteMarkdown, createAiRewriteBubble, structureWarningText } from '../src/ai-rewrite';
import {
  AI_TRANSLATE_LANGUAGES,
  loadAudience,
  loadRecentLanguages,
  rememberAudience,
  rememberLanguage,
  translateLanguageChoices,
} from '../src/ai-prefs';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

beforeEach(() => {
  localStorage.clear();
});

// ── Pure pieces ─────────────────────────────────────────────────────────────

describe('grouped variants', () => {
  it('groups every variant once, in menu order, Length first and Custom last', () => {
    const groups = aiRewriteMenuGroups();
    expect(groups.map((g) => g.label)).toEqual(['Length', 'Tone', 'Audience', 'Translate', 'Explain', 'Custom']);
    expect(groups.flatMap((g) => g.variants.map((v) => v.id))).toEqual(AI_REWRITE_VARIANTS.map((v) => v.id));
  });

  it('quotes every line of a note, keeping blank lines inside the quote', () => {
    expect(blockquoteMarkdown('One.\n\n- two\n')).toBe('> One.\n>\n> - two');
  });

  it('words the structure warning as what is missing or extra', () => {
    expect(structureWarningText(checkMarkdownStructure('a', 'a'))).toBe('');
    expect(structureWarningText(checkMarkdownStructure('See [x](https://a.b).', 'See x.'))).toBe('Check: 1 link missing in the result');
    expect(structureWarningText(checkMarkdownStructure('- a\n- b', '- a\n- b\n- c\n- d'))).toBe('Check: 2 extra list items in the result');
    expect(structureWarningText(checkMarkdownStructure('# A\n\n## B', 'A\n\nB'))).toBe('Check: 2 headings missing in the result');
  });
});

describe('remembered picker choices', () => {
  it('keeps up to three recent languages, newest first, deduplicated, stored as typed', () => {
    for (const l of ['French', 'German', 'french', 'Klingon (tlhIngan)', 'Dutch']) {rememberLanguage(l);}
    expect(loadRecentLanguages()).toEqual(['Dutch', 'Klingon (tlhIngan)', 'french']);
    const { recents, languages } = translateLanguageChoices();
    expect(recents).toEqual(['Dutch', 'Klingon (tlhIngan)', 'french']);
    // The fixed list without the recents.
    expect(languages).toEqual(AI_TRANSLATE_LANGUAGES.filter((l) => l !== 'Dutch' && l !== 'French'));
  });

  it('remembers the reading level and ignores unknown values', () => {
    expect(loadAudience()).toBeNull();
    rememberAudience('grade8');
    expect(loadAudience()).toBe('grade8');
    localStorage.setItem('mikedown.ai.audience', 'nonsense');
    expect(loadAudience()).toBeNull();
  });

  it('is never required: storage that throws gives defaults and drops writes', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    try {
      expect(() => rememberLanguage('French')).not.toThrow();
      expect(() => rememberAudience('esl')).not.toThrow();
      expect(loadRecentLanguages()).toEqual([]);
      expect(loadAudience()).toBeNull();
      expect(translateLanguageChoices().languages).toEqual([...AI_TRANSLATE_LANGUAGES]);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});

describe('selection bubble', () => {
  it('lists the variants grouped with a separator between groups', async () => {
    const run = vi.fn();
    const bubble = createAiRewriteBubble({
      availability: () => ({ state: 'enabled' }),
      selectionRect: () => new DOMRect(20, 40, 80, 16),
      run,
    });
    bubble.schedule();
    await new Promise((r) => setTimeout(r, 180));
    document.querySelector<HTMLButtonElement>('.ai-bubble-btn')!.click();
    const menu = document.querySelector('.ai-bubble-menu')!;
    expect(menu.querySelectorAll('.ai-bubble-item')).toHaveLength(AI_REWRITE_VARIANTS.length);
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(aiRewriteMenuGroups().length - 1);
    [...menu.querySelectorAll<HTMLButtonElement>('.ai-bubble-item')].find((b) => b.textContent === 'Translate…')!.click();
    expect(run).toHaveBeenCalledWith('translate');
    bubble.destroy();
  });
});

// ── The popover in a real editor ────────────────────────────────────────────

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 30));
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  document.querySelectorAll('.mikedown-ai-rewrite').forEach((n) => n.remove());
});

/** A tier-1 host that streams `reply` word by word. */
function mountWithAi(markdown: string, reply: string | ((req: AiCompletionRequest) => string)) {
  const requests: AiCompletionRequest[] = [];
  class AiHost extends NoopHost {
    ai: MikeDownAiHost = {
      complete: async (req, onToken) => {
        requests.push(req);
        const text = typeof reply === 'function' ? reply(req) : reply;
        for (const w of text.split(/(?<= )/)) {onToken(w);}
        return { text, served: { engineName: 'Proxy', modelId: 'house-model', isLocal: true }, finishReason: 'stop' };
      },
    };
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host: new AiHost(), initialMarkdown: markdown, hostOwnsShortcuts: true, settings: { ai: { enabled: true } } as never });
  mounted.push({ handle, el });
  return { el, handle, requests };
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const popover = () => document.querySelector<HTMLElement>('.mikedown-ai-rewrite');
function findButton(label: string): HTMLButtonElement {
  const b = [...(popover()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((x) => x.textContent === label);
  if (!b) {throw new Error(`no "${label}" button`);}
  return b;
}
const clickButton = (label: string): void => findButton(label).click();
const press = (key: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

function selectText(handle: MikeDownEditorHandle, text: string): void {
  let from = -1;
  handle.tiptap.state.doc.descendants((node, pos) => {
    if (from < 0 && node.isText && node.text?.includes(text)) {from = pos + node.text.indexOf(text);}
  });
  if (from < 0) {throw new Error(`no "${text}" in the document`);}
  handle.tiptap.commands.setTextSelection({ from, to: from + text.length });
}

describe('choose phase', () => {
  it('shows one labelled group per kind, then the custom prompt', () => {
    const { handle } = mountWithAi('Hello world.\n', 'Hi.');
    selectText(handle, 'Hello world.');
    handle.command('aiRewrite');
    const groups = [...popover()!.querySelectorAll<HTMLElement>('.ai-rw-group')];
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Length', 'Tone', 'Audience', 'Translate', 'Explain']);
    expect(groups[0].querySelectorAll('[role="menuitem"]')).toHaveLength(4);
    expect(popover()!.querySelector('.ai-rw-input')).not.toBeNull();
  });

  it('moves between chips with the arrow keys', () => {
    const { handle } = mountWithAi('Hello world.\n', 'Hi.');
    selectText(handle, 'Hello world.');
    handle.command('aiRewrite');
    findButton('Shorter').focus();
    findButton('Shorter').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(document.activeElement?.textContent).toBe('Longer');
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(document.activeElement?.textContent).toBe('Shorter');
  });

  it('Translate… opens the language picker; Esc goes back to the first level, then closes', () => {
    const { handle } = mountWithAi('Hello world.\n', 'Hola.');
    selectText(handle, 'Hello world.');
    handle.command('aiRewrite');
    clickButton('Translate…');
    expect(popover()!.querySelector('.ai-rw-title')?.textContent).toBe('Translate');
    const rows = [...popover()!.querySelectorAll('.ai-rw-picker-list > button')].map((b) => b.textContent);
    expect(rows).toEqual([...AI_TRANSLATE_LANGUAGES, 'Other…']);
    expect(popover()!.querySelector('.ai-rw-toggle')?.textContent).toBe('Whole document');
    press('Escape');
    expect(popover()?.dataset.phase).toBe('choose');
    expect(popover()!.querySelector<HTMLElement>('.ai-rw-picker')!.hidden).toBe(true);
    expect(document.activeElement?.textContent).toBe('Translate…');
    press('Escape');
    expect(popover()).toBeNull();
  });

  it('translates into the picked language, remembers it and preselects it next time', async () => {
    const { handle, requests } = mountWithAi('Hello world.\n', 'Bonjour le monde.');
    selectText(handle, 'Hello world.');
    handle.command('aiTranslate');
    clickButton('French');
    await settle();
    expect(requests[0].messages[1].content).toContain('Instruction: Translate the passage into French.');
    expect(popover()!.querySelector('.ai-rw-title')?.textContent).toBe('Translate · French');
    clickButton('Accept');
    expect(handle.getMarkdown().trimEnd()).toBe('Bonjour le monde.');

    selectText(handle, 'Bonjour le monde.');
    handle.command('aiRewrite');
    clickButton('Translate…');
    const first = popover()!.querySelector<HTMLButtonElement>('.ai-rw-picker-list > button')!;
    expect(first.textContent).toBe('French');
    expect(first.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(first);
    // French is not listed twice.
    expect([...popover()!.querySelectorAll('.ai-rw-picker-list > button')].filter((b) => b.textContent === 'French')).toHaveLength(1);
  });

  it('takes a typed language from Other…, stored as typed', async () => {
    const { handle, requests } = mountWithAi('Hello world.\n', 'Jambo dunia.');
    selectText(handle, 'Hello world.');
    handle.command('aiTranslate');
    clickButton('Other…');
    const input = popover()!.querySelector<HTMLInputElement>('.ai-rw-other .ai-rw-input')!;
    expect(document.activeElement).toBe(input);
    input.value = 'Swahili (Kenya)';
    input.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(requests[0].messages[1].content).toContain('into Swahili (Kenya).');
    expect(loadRecentLanguages()).toEqual(['Swahili (Kenya)']);
  });

  it('Reading level… opens the audience list and preselects the remembered one', async () => {
    rememberAudience('esl');
    const { handle, requests } = mountWithAi('Hello world.\n', 'Hi world.');
    selectText(handle, 'Hello world.');
    handle.command('aiRewrite');
    clickButton('Reading level…');
    const checked = popover()!.querySelector('.ai-rw-picker-list > button[aria-checked="true"]');
    expect(checked?.textContent).toBe('English learners (ESL)');
    expect(popover()!.querySelector('.ai-rw-toggle')).toBeNull();
    clickButton('8th grade');
    await settle();
    expect(requests[0].messages[1].content).toContain('8th grade reading level');
    expect(popover()!.querySelector('.ai-rw-title')?.textContent).toBe('Reading level · 8th grade');
    expect(loadAudience()).toBe('grade8');
  });
});

describe('Explain', () => {
  it('never changes the document until Insert below; then one undo removes the quote', async () => {
    const { handle, requests } = mountWithAi('# My Doc\n\nFirst para has words.\n\nSecond.\n', 'It means **this**.');
    selectText(handle, 'has words');
    const before = handle.getMarkdown();
    handle.command('aiExplain');
    await settle();
    expect(popover()!.querySelector('.ai-rw-title')?.textContent).toBe('Explain');
    expect(popover()!.dataset.output).toBe('readOnly');
    expect(requests[0].messages[0].content).toBe(EXPLAIN_SYSTEM_PROMPT);
    expect(requests[0].messages[1].content).toContain('Document title (context only): My Doc');
    expect(requests[0].maxTokens).toBe(600);
    const foot = [...popover()!.querySelectorAll<HTMLButtonElement>('.ai-rw-foot button')].filter((b) => !b.hidden).map((b) => b.textContent);
    expect(foot).toEqual(['Insert below', 'Retry', 'Copy']);
    // The highlight stays while it is open; Enter does not insert.
    expect(document.querySelector('.ProseMirror .mikedown-ai-rewrite-target')?.textContent).toBe('has words');
    press('Enter');
    expect(handle.getMarkdown()).toBe(before);

    clickButton('Insert below');
    expect(popover()).toBeNull();
    expect(handle.getMarkdown().trimEnd()).toBe('# My Doc\n\nFirst para has words.\n\n> It means **this**.\n\nSecond.');
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(before);
  });

  it('closing it leaves the document as it was', async () => {
    const { handle } = mountWithAi('Some text.\n', 'A note.');
    selectText(handle, 'Some text.');
    const before = handle.getMarkdown();
    handle.command('aiExplain');
    await settle();
    press('Escape');
    expect(popover()).toBeNull();
    expect(handle.getMarkdown()).toBe(before);
    expect(document.querySelector('.mikedown-ai-rewrite-target')).toBeNull();
  });

  it('source mode: inserts the quote after the selection line in one CM transaction', async () => {
    const { el, handle } = mountWithAi('Line one has words.\nLine two.\n\nAfter.\n', 'A note.');
    handle.command('toggleSource');
    const view = EditorView.findFromDOM(el.querySelector<HTMLElement>('.cm-editor')!)!;
    const doc = view.state.doc.toString();
    const from = doc.indexOf('has words');
    view.dispatch({ selection: { anchor: from, head: from + 'has words'.length } });
    handle.command('aiExplain');
    await settle();
    clickButton('Insert below');
    expect(view.state.doc.toString()).toBe('Line one has words.\n\n> A note.\n\nLine two.\n\nAfter.\n');
    cmUndo(view);
    expect(view.state.doc.toString()).toBe(doc);
  });
});

describe('whole-document translate', () => {
  const MD = '---\ntitle: "Hello: world"\ntags: [a, b]\n---\n# Heading\n\nSome text with [a link](https://example.com).\n';

  it('rich text: keeps the YAML byte-identical, puts the caret at the body start, one undo restores', async () => {
    const { handle, requests } = mountWithAi(MD, '# Encabezado\n\nAlgo de texto con [un enlace](https://example.com).');
    selectText(handle, 'Some text');
    const before = handle.getMarkdown();
    handle.command('aiTranslate');
    popover()!.querySelector<HTMLInputElement>('.ai-rw-toggle input')!.click();
    clickButton('Spanish');
    await settle();
    const user = requests[0].messages[1].content as string;
    expect(user).toContain('# Heading');
    expect(user).not.toContain('title:');
    expect(requests[0].messages[0].content).toContain('whole document body');
    expect(popover()!.dataset.layout).toBe('single');
    expect(popover()!.querySelector('.ai-rw-title')?.textContent).toBe('Translate · Spanish · Whole document');
    expect(popover()!.querySelector<HTMLElement>('.ai-rw-warn')!.hidden).toBe(true);

    clickButton('Replace document');
    expect(handle.getMarkdown()).toBe('---\ntitle: "Hello: world"\ntags: [a, b]\n---\n# Encabezado\n\nAlgo de texto con [un enlace](https://example.com).\n');
    expect(handle.tiptap.state.selection.from).toBe(1);
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(before);
  });

  it('source mode: replaces only the body in one CM transaction', async () => {
    const { el, handle, requests } = mountWithAi(MD, '# Titre\n\nDu texte.');
    handle.command('toggleSource');
    const view = EditorView.findFromDOM(el.querySelector<HTMLElement>('.cm-editor')!)!;
    const doc = view.state.doc.toString();
    const from = doc.indexOf('Some');
    view.dispatch({ selection: { anchor: from, head: from + 4 } });
    handle.command('aiTranslate');
    popover()!.querySelector<HTMLInputElement>('.ai-rw-toggle input')!.click();
    clickButton('French');
    await settle();
    expect(requests[0].messages[1].content).not.toContain('tags:');
    clickButton('Replace document');
    const yaml = '---\ntitle: "Hello: world"\ntags: [a, b]\n---\n';
    expect(view.state.doc.toString()).toBe(`${yaml}# Titre\n\nDu texte.\n`);
    expect(view.state.selection.main.head).toBe(yaml.length);
    cmUndo(view);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('with nothing to select, Translate offers the whole document only', async () => {
    const { handle, requests } = mountWithAi('Hello.\n\nWorld.\n', 'Hallo.\n\nWelt.');
    // The caret in a new empty paragraph at the end.
    handle.tiptap.commands.setTextSelection(handle.tiptap.state.doc.content.size - 1);
    handle.tiptap.commands.splitBlock();
    expect(handle.tiptap.state.selection.$from.parent.textContent).toBe('');
    handle.command('aiTranslate');
    const toggle = popover()!.querySelector<HTMLInputElement>('.ai-rw-toggle input')!;
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(true);
    expect(popover()!.querySelector<HTMLElement>('.ai-rw-back')!.hidden).toBe(true);
    clickButton('German');
    await settle();
    expect(requests[0].messages[1].content).toContain('Hello.');
    expect(requests[0].messages[1].content).toContain('World.');
  });
});

describe('structure warning', () => {
  it('shows what the result dropped above the footer, and Accept stays enabled', async () => {
    const { handle } = mountWithAi('See [the docs](https://x.y/docs) now.\n', 'Mira la documentación ahora.');
    selectText(handle, 'See ');
    handle.tiptap.commands.selectAll();
    handle.command('aiTranslate');
    clickButton('Spanish');
    await settle();
    const warn = popover()!.querySelector<HTMLElement>('.ai-rw-warn')!;
    expect(warn.hidden).toBe(false);
    expect(warn.textContent).toBe('Check: 1 link missing in the result');
    expect(findButton('Accept').getAttribute('aria-disabled')).toBe('false');
  });

  it('is not run for variants outside the checked set', async () => {
    const { handle } = mountWithAi('See [the docs](https://x.y/docs) now.\n', 'See docs.');
    handle.tiptap.commands.selectAll();
    handle.command('aiRewrite');
    clickButton('Shorter');
    await settle();
    expect(popover()!.querySelector<HTMLElement>('.ai-rw-warn')!.hidden).toBe(true);
  });
});
