/**
 * The popover's `insert` and `choose` modes and whole-document translate, beyond
 * the happy paths in ai-summary-title.test.ts: one block and one undo for an
 * insert, which title target a pick lands on (and how it is quoted), and a
 * translation cut to fit that keeps the untranslated rest word for word.
 * Also the per-feature rules for hiding the `ai` slash group (D15).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
import type { AiCompletionRequest, MikeDownAiHost } from '../src/ai';
import { AI_SLASH_COMMANDS, matchCommands } from '../src/slashcommands-registry';
import { closeSlashMenu, setSlashSourceMode } from '../src/slashcommands';
import { budgetTranslation } from '../src/ai-rewrite';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

beforeEach(() => {
  localStorage.clear();
});

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 30));
  closeSlashMenu();
  setSlashSourceMode(false);
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  document.querySelectorAll('.mikedown-ai-rewrite').forEach((n) => n.remove());
});

type Reply = string | ((req: AiCompletionRequest, n: number) => string);

interface MountOptions {
  features?: Record<string, { enabled: boolean }>;
  /** A host without an `ai` object at all. */
  noAi?: boolean;
}

function mount(markdown: string, reply: Reply, opts: MountOptions = {}) {
  const requests: AiCompletionRequest[] = [];
  class AiHost extends NoopHost {
    ai: MikeDownAiHost = {
      complete: async (req, onToken) => {
        requests.push(req);
        const text = typeof reply === 'function' ? reply(req, requests.length) : reply;
        onToken(text);
        return { text, served: { engineName: 'Proxy', modelId: 'house-model', isLocal: true }, finishReason: 'stop' };
      },
    };
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, {
    host: opts.noAi ? new NoopHost() : new AiHost(),
    initialMarkdown: markdown,
    hostOwnsShortcuts: true,
    features: { sidebar: true },
    settings: { ai: { enabled: true, ...(opts.features ? { features: opts.features } : {}) } } as never,
  });
  mounted.push({ handle, el });
  return { el, handle, requests };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) {await new Promise((r) => setTimeout(r, 0));}
};
const popover = () => document.querySelector<HTMLElement>('.mikedown-ai-rewrite');
const clickButton = (label: string): void => {
  const b = [...(popover()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((x) => x.textContent === label);
  if (!b) {throw new Error(`no "${label}" button`);}
  b.click();
};
const enterInEditor = (handle: MikeDownEditorHandle) => handle.tiptap.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

function typeSlash(handle: MikeDownEditorHandle, query: string): void {
  handle.tiptap.commands.setTextSelection(handle.tiptap.state.doc.content.size - 1);
  handle.tiptap.commands.splitBlock();
  const view = handle.tiptap.view;
  for (const ch of query) {view.dispatch(view.state.tr.insertText(ch));}
}

function slashMenuIds(): string[] {
  const menu = document.getElementById('mikedown-slash-menu');
  return Array.from(menu?.querySelectorAll<HTMLElement>('.slash-menu-item') ?? []).map((r) => r.dataset.command ?? '');
}

const AI_IDS = ['summary', 'outline', 'title'];
const aiShown = () => slashMenuIds().filter((id) => AI_IDS.includes(id));

// ── Slash group availability (D15) ──────────────────────────────────────────

describe('the ai slash group is shown only while its feature is available', () => {
  it('a host with no AI object has no group', () => {
    const { handle } = mount('Text.\n', 'x', { noAi: true });
    typeSlash(handle, '/');
    expect(slashMenuIds().length).toBeGreaterThan(0);
    expect(aiShown()).toEqual([]);
    expect(document.querySelectorAll('#mikedown-slash-menu .slash-menu-group-header')).not.toHaveLength(0);
    expect([...document.querySelectorAll('#mikedown-slash-menu .slash-menu-group-header')].map((h) => h.textContent)).not.toContain('AI');
  });

  it('with the summary feature switched off, /summary and /outline go but /title stays', () => {
    const { handle } = mount('Text.\n', 'x', { features: { summary: { enabled: false } } });
    typeSlash(handle, '/');
    expect(aiShown()).toEqual(['title']);
  });

  it('with the title feature switched off, /title goes but the summary commands stay', () => {
    const { handle } = mount('Text.\n', 'x', { features: { title: { enabled: false } } });
    typeSlash(handle, '/');
    expect(aiShown()).toEqual(['summary', 'outline']);
  });

  it('a hidden command does not answer its query, and the old meaning of a shared word is back', () => {
    const { handle } = mount('Text.\n', 'x', { features: { summary: { enabled: false }, title: { enabled: false } } });
    typeSlash(handle, '/outline');
    expect(slashMenuIds()[0]).toBe('toc');
    expect(aiShown()).toEqual([]);
  });
});

// ── Insert mode ─────────────────────────────────────────────────────────────

describe('insert mode', () => {
  const MD = '# Plan\n\nWe ship the editor in May. Docs follow in June.\n\nSecond paragraph here.\n';

  it('/outline puts one list where /outline was, and one undo brings /outline back, one redo the list', async () => {
    const { handle } = mount(MD, '- Plan\n  - May\n  - June');
    typeSlash(handle, '/outline');
    const withQuery = handle.getMarkdown();
    enterInEditor(handle);
    await settle();
    clickButton('Insert');
    const inserted = handle.getMarkdown();
    expect(inserted).not.toContain('/outline');

    let lists = 0;
    handle.tiptap.state.doc.forEach((n) => { if (n.type.name === 'bulletList') {lists++;} });
    expect(lists).toBe(1);

    handle.command('undo');
    expect(handle.getMarkdown()).toBe(withQuery);
    // The query is back as plain text, and a further undo does not eat anything else of the document.
    expect(handle.getMarkdown()).toContain('Second paragraph here.');
    handle.command('redo');
    expect(handle.getMarkdown()).toBe(inserted);
  });

  it('a reply with a lead-in line drops the lead-in', async () => {
    const { handle } = mount(MD, 'Here is the outline:\n\n- One\n- Two');
    typeSlash(handle, '/outline');
    enterInEditor(handle);
    await settle();
    clickButton('Insert');
    const md = handle.getMarkdown();
    expect(md).toContain('- One\n- Two');
    expect(md).not.toContain('Here is the outline');
  });

  it('a reply with a lead-in and a wrapping code fence inserts only the list', async () => {
    const { handle } = mount(MD, 'Here is the outline:\n\n```markdown\n- One\n- Two\n```');
    typeSlash(handle, '/outline');
    enterInEditor(handle);
    await settle();
    clickButton('Insert');
    const md = handle.getMarkdown();
    expect(md).toContain('- One\n- Two');
    expect(md).not.toContain('Here is the outline');
    expect(md).not.toContain('```');
  });

  it('an empty reply reports a bad output: no Insert, and the document is untouched', async () => {
    const { handle } = mount(MD, '   ');
    typeSlash(handle, '/summary');
    const before = handle.getMarkdown();
    enterInEditor(handle);
    await settle();
    expect(popover()!.dataset.phase).toBe('error');
    expect(popover()!.querySelector('.ai-rw-error-title')?.textContent).toBe('No usable answer');
    expect(popover()!.querySelector<HTMLElement>('.ai-rw-foot')!.hidden).toBe(true);
    expect(handle.getMarkdown()).toBe(before);
  });
});

// ── Choose mode ─────────────────────────────────────────────────────────────

describe('choose mode', () => {
  const titles = '{"titles": ["Alpha Plan", "Plan: Phase 2", "Gamma Plan"]}';

  async function pick(handle: MikeDownEditorHandle, index: number): Promise<void> {
    handle.command('aiSuggestTitle');
    await settle();
    await settle();
    const items = [...popover()!.querySelectorAll<HTMLButtonElement>('.ai-rw-titles > button')];
    items[index].click();
  }

  it('frontmatter with a title: sets title:, quoted when YAML needs it, and leaves the H1 alone', async () => {
    const { handle } = mount('---\ntitle: Old\n---\n# Heading One\n\nBody.\n', titles);
    await pick(handle, 1);
    expect(handle.getMarkdown()).toBe('---\ntitle: "Plan: Phase 2"\n---\n# Heading One\n\nBody.\n');
  });

  it('frontmatter without a title: replaces the H1 and leaves the frontmatter byte for byte', async () => {
    const MD = '---\ntags: [a, b]\ndate: 2026-01-02\n---\n# Heading One\n\nBody.\n';
    const { handle } = mount(MD, titles);
    handle.command('aiSuggestTitle');
    await settle();
    await settle();
    expect(popover()!.querySelector('.ai-rw-titles-hint')?.textContent).toBe('Replaces the H1');
    popover()!.querySelector<HTMLButtonElement>('.ai-rw-titles > button')!.click();
    expect(handle.getMarkdown()).toBe('---\ntags: [a, b]\ndate: 2026-01-02\n---\n# Alpha Plan\n\nBody.\n');
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(MD);
  });

  it('frontmatter without a title or an H1: a new H1 goes below the frontmatter, not above it', async () => {
    const { handle } = mount('---\ntags: [a]\n---\nBody only.\n', titles);
    handle.command('aiSuggestTitle');
    await settle();
    await settle();
    expect(popover()!.querySelector('.ai-rw-titles-hint')?.textContent).toBe('Inserts an H1');
    popover()!.querySelector<HTMLButtonElement>('.ai-rw-titles > button')!.click();
    const md = handle.getMarkdown();
    expect(md.startsWith('---\ntags: [a]\n---\n')).toBe(true);
    expect(md).toContain('# Alpha Plan\n\nBody only.');
    expect(md.indexOf('# Alpha Plan')).toBeGreaterThan(md.indexOf('tags: [a]'));
  });

  it('only the first H1 changes when there are several', async () => {
    const { handle } = mount('# First\n\nText.\n\n# Second\n\nMore.\n', titles);
    await pick(handle, 2);
    const md = handle.getMarkdown();
    expect(md).toContain('# Gamma Plan');
    expect(md).toContain('# Second');
    expect(md).not.toContain('# First');
  });
});

// ── Whole-document translate, cut to fit ────────────────────────────────────

describe('whole-document translate with a truncated budget', () => {
  const part = (i: number) => `## Part ${i}\n\n${'Some words about this part, with *emphasis* and a link. '.repeat(14).trim()} [Part ${i}](https://example.com/p${i}).\n`;
  const long = Array.from({ length: 40 }, (_, i) => part(i)).join('\n');

  it('budgetTranslation splits the body in two pieces that join back to the original', () => {
    const b = budgetTranslation(long, 8192);
    expect(b.coverage).toBeGreaterThan(0);
    expect(b.coverage).toBeLessThan(1);
    expect(b.text + b.rest).toBe(long);
    expect(b.rest.length).toBeGreaterThan(0);
  });

  it('Accept replaces the translated part and keeps the rest verbatim after it; the note shows; one undo restores all', async () => {
    const { handle, requests } = mount(long, '## Parte 0\n\nUnas palabras.');
    handle.tiptap.commands.setTextSelection(4);
    handle.command('aiTranslate');
    popover()!.querySelector<HTMLInputElement>('.ai-rw-toggle input')!.click();
    clickButton('Spanish');
    await settle();

    // What was sent is exactly the part that fits, and it is cut on a heading.
    const sent = String(requests[0].messages[1].content);
    const b = budgetTranslation(long, 8192);
    const fitting = b.text.trimEnd();
    expect(sent).toContain(fitting.slice(0, 200));
    expect(sent).not.toContain('## Part 39');
    const note = popover()!.querySelector<HTMLElement>('.ai-rw-coverage')!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toMatch(/^Translates the first \d+% of the document; the rest did not fit the model's context and stays as it is\.$/);

    clickButton('Replace document');
    const md = handle.getMarkdown();
    // The remainder is byte for byte what it was, starting at the first heading that did not fit.
    const firstUntranslated = b.rest.trimStart().split('\n')[0];
    const restFrom = md.indexOf(firstUntranslated);
    expect(restFrom).toBeGreaterThan(0);
    expect(md.slice(0, restFrom).startsWith('## Parte 0\n\nUnas palabras.')).toBe(true);
    expect(md.slice(restFrom).trimEnd()).toBe(b.rest.trimStart().trimEnd());
    expect(md).toContain('## Part 39');

    handle.command('undo');
    expect(handle.getMarkdown()).toBe(long);
  });

  it('a body that fits shows no coverage note and replaces the whole document', async () => {
    const short = '## One\n\nHello there.\n\n## Two\n\nGoodbye.\n';
    const { handle } = mount(short, '## Uno\n\nHola.\n\n## Dos\n\nAdiós.');
    handle.tiptap.commands.setTextSelection(4);
    handle.command('aiTranslate');
    popover()!.querySelector<HTMLInputElement>('.ai-rw-toggle input')!.click();
    clickButton('Spanish');
    await settle();
    expect(popover()!.querySelector<HTMLElement>('.ai-rw-coverage')!.hidden).toBe(true);
    clickButton('Replace document');
    expect(handle.getMarkdown()).toBe('## Uno\n\nHola.\n\n## Dos\n\nAdiós.\n');
  });
});
