/**
 * `/summary` and `/title` (AI writing M5): the `ai` slash group and its
 * ranking, the AI menu entries, the popover's insert and choose modes, the
 * JSON repair round trip, and the document budget (also for whole-document
 * translate).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { undo as cmUndo } from '@codemirror/commands';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
import type { AiCompletionRequest, MikeDownAiHost } from '../src/ai';
import { OUTLINE_SYSTEM_PROMPT, SUMMARY_SYSTEM_PROMPT } from '../src/ai/prompts/summary';
import { AI_SLASH_COMMANDS, matchCommands } from '../src/slashcommands-registry';
import { closeSlashMenu, setSlashSourceMode } from '../src/slashcommands';
import { aiToolbarMenuEntries } from '../src/ai-toolbar';
import { hideToolbarDropdown } from '../src/toolbar-dropdown';
import { budgetTranslation, coverageNoteText, setYamlTitle, yamlHasTitle } from '../src/ai-rewrite';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

beforeEach(() => {
  localStorage.clear();
});

// ── Pure pieces ─────────────────────────────────────────────────────────────

describe('the ai slash group', () => {
  const ids = (q: string, hidden: string[] = []) => matchCommands(q, { hasFrontmatter: false, hidden: new Set(hidden) }).map((c) => c.id);
  const aiIds = [...AI_SLASH_COMMANDS.summary, ...AI_SLASH_COMMANDS.title];

  it('/sum offers Summary first; tldr and summarize are aliases', () => {
    expect(ids('sum')[0]).toBe('summary');
    expect(ids('tldr')[0]).toBe('summary');
    expect(ids('summarize')[0]).toBe('summary');
  });

  it('an exact id outranks an exact alias: /title and /outline are the AI commands while shown', () => {
    expect(ids('title').slice(0, 2)).toEqual(['title', 'h1']);
    expect(ids('outline').slice(0, 2)).toEqual(['outline', 'toc']);
    // Hidden: the old meanings come back.
    expect(ids('title', aiIds)[0]).toBe('h1');
    expect(ids('outline', aiIds)[0]).toBe('toc');
    expect(ids('', aiIds).some((id) => aiIds.includes(id))).toBe(false);
  });

  it('/heading still means a heading', () => {
    expect(ids('heading')[0]).toBe('h1');
  });
});

describe('AI menu entries', () => {
  const base = { icons: { rewrite: '', manage: '' }, onRewrite: () => {}, onManage: () => {}, canManageEngines: true };

  it('Summarize document… and Suggest titles… sit after Rewrite selection, before the separator', () => {
    const entries = aiToolbarMenuEntries({
      ...base,
      rewrite: { enabled: true },
      summarize: { enabled: false, hint: 'No engine can summarize' },
      titles: { enabled: true },
    });
    expect(entries.map((e) => (e.type === 'action' ? e.label : e.type))).toEqual([
      'Rewrite selection', 'Summarize document…', 'Suggest titles…', 'separator', 'Manage engines…',
    ]);
    const summarize = entries[1];
    expect(summarize.type === 'action' && summarize.isDisabled?.()).toBe(true);
    expect(summarize.type === 'action' && summarize.hint).toBe('No engine can summarize');
  });

  it('null leaves an entry out', () => {
    const entries = aiToolbarMenuEntries({ ...base, rewrite: null, summarize: null, titles: { enabled: true } });
    expect(entries.map((e) => (e.type === 'action' ? e.label : e.type))).toEqual(['Suggest titles…', 'separator', 'Manage engines…']);
  });
});

describe('frontmatter title', () => {
  it('changes only the title line and quotes when YAML needs it', () => {
    const yaml = '# keep me\ntitle: Old\ntags: [a, b]\nauthor:   Ann';
    expect(yamlHasTitle(yaml)).toBe(true);
    expect(setYamlTitle(yaml, 'New title')).toBe('# keep me\ntitle: New title\ntags: [a, b]\nauthor:   Ann');
    expect(setYamlTitle(yaml, 'Plans: 2027')).toBe('# keep me\ntitle: "Plans: 2027"\ntags: [a, b]\nauthor:   Ann');
    expect(setYamlTitle(yaml, 'Say "hi"')).toContain('title: "Say \\"hi\\""');
  });

  it('replaces a block scalar title with its indented lines; no title key is a no-op', () => {
    expect(setYamlTitle('title: >\n  Long\n  old\ndate: 2026', 'Short')).toBe('title: Short\ndate: 2026');
    expect(yamlHasTitle('subtitle: x')).toBe(false);
    expect(setYamlTitle('subtitle: x', 'T')).toBe('subtitle: x');
  });
});

describe('document budget', () => {
  const section = (i: number) => `## Section ${i}\n\n${'Words in a paragraph. '.repeat(40)}\n\n`;
  const long = Array.from({ length: 40 }, (_, i) => section(i)).join('');

  it('a translation that does not fit keeps the rest as it is, cut on a heading', () => {
    const b = budgetTranslation(long, 8192);
    expect(b.coverage).toBeLessThan(1);
    expect(b.text + b.rest).toBe(long.slice(0, b.text.length) + long.slice(b.text.length));
    expect(b.rest.trimStart().startsWith('## Section')).toBe(true);
    // Room for the answer: sent tokens plus the output budget stay inside the window.
    expect(Math.ceil(b.text.length / 3.5) + b.maxTokens).toBeLessThanOrEqual(8192);
  });

  it('a body that fits is sent whole', () => {
    const b = budgetTranslation('# Short\n\nText.', 32768);
    expect(b).toMatchObject({ text: '# Short\n\nText.', rest: '', coverage: 1 });
  });

  it('words the coverage note per job, and nothing when all of it fit', () => {
    expect(coverageNoteText('summary', 1)).toBe('');
    expect(coverageNoteText('summary', 0.42)).toBe('Covers the first 42% of the document; the rest did not fit the model\'s context.');
    expect(coverageNoteText('translate', 0.5)).toContain('Translates the first 50%');
  });
});

// ── In the editor ───────────────────────────────────────────────────────────

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 30));
  closeSlashMenu();
  // Source mode is module state in slashcommands.ts; a destroyed editor does not reset it.
  setSlashSourceMode(false);
  hideToolbarDropdown();
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  document.querySelectorAll('.mikedown-ai-rewrite').forEach((n) => n.remove());
});

type Reply = string | ((req: AiCompletionRequest, n: number) => string);

/** A tier-1 host that streams `reply` word by word. */
function mountWithAi(markdown: string, reply: Reply, ai: { enabled: boolean } = { enabled: true }) {
  const requests: AiCompletionRequest[] = [];
  class AiHost extends NoopHost {
    ai: MikeDownAiHost = {
      complete: async (req, onToken) => {
        requests.push(req);
        const text = typeof reply === 'function' ? reply(req, requests.length) : reply;
        for (const w of text.split(/(?<= )/)) {onToken(w);}
        return { text, served: { engineName: 'Proxy', modelId: 'house-model', isLocal: true }, finishReason: 'stop' };
      },
    };
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, {
    host: new AiHost(),
    initialMarkdown: markdown,
    hostOwnsShortcuts: true,
    features: { sidebar: true },
    settings: { ai } as never,
  });
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

/** A new empty paragraph at the end with `/query` typed into it. */
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

const enterInEditor = (handle: MikeDownEditorHandle) => handle.tiptap.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

describe('/summary', () => {
  const MD = '# Plan\n\nWe ship the editor in May. Docs follow in June.\n';

  it('/sum then Enter opens the popover; Insert puts one callout in place of /sum; one undo restores /sum', async () => {
    const { handle, requests } = mountWithAi(MD, '- Ship in May.\n- Docs in June.');
    typeSlash(handle, '/sum');
    expect(slashMenuIds()[0]).toBe('summary');
    enterInEditor(handle);
    expect(popover()).not.toBeNull();
    expect(popover()!.dataset.output).toBe('insert');
    expect(popover()!.querySelector('.ai-rw-title')?.textContent).toBe('Summary');
    // Nothing changed yet: /sum is only marked.
    expect(handle.getMarkdown()).toContain('/sum');
    expect(document.querySelector('.mikedown-ai-rewrite-target')?.textContent).toBe('/sum');
    await settle();
    expect(requests[0].feature).toBe('summary');
    expect(requests[0].messages[0].content).toBe(SUMMARY_SYSTEM_PROMPT);
    expect(requests[0].messages[1].content).toContain('We ship the editor in May.');
    const slashBlock = handle.tiptap.state.doc.childCount - 1;

    clickButton('Insert');
    expect(popover()).toBeNull();
    const md = handle.getMarkdown();
    expect(md).not.toContain('/sum');
    expect(md).toContain('[!NOTE]');
    expect(md).toContain('**Summary**');
    expect(md).toContain('Ship in May.');
    // One block where the /sum paragraph was (the trailing paragraph after it is StarterKit's TrailingNode).
    expect(handle.tiptap.state.doc.child(slashBlock).type.name).toBe('callout');
    expect(handle.tiptap.state.doc.child(slashBlock - 1).textContent).toContain('Docs follow in June.');

    handle.command('undo');
    expect(handle.getMarkdown().trimEnd()).toBe(`${MD}\n/sum`.trimEnd());
  });

  it('Esc leaves /summary and the document untouched', async () => {
    const { handle } = mountWithAi(MD, '- A.');
    typeSlash(handle, '/summary');
    const before = handle.getMarkdown();
    enterInEditor(handle);
    await settle();
    press('Escape');
    expect(popover()).toBeNull();
    expect(handle.getMarkdown()).toBe(before);
    expect(document.querySelector('.mikedown-ai-rewrite-target')).toBeNull();
  });

  it('TL;DR ⇄ Outline runs again; /outline opens on Outline and inserts a plain list', async () => {
    const { handle, requests } = mountWithAi(MD, (req) => (req.messages[0].content === OUTLINE_SYSTEM_PROMPT ? '- Plan\n  - May\n  - June' : '- Short.'));
    typeSlash(handle, '/outline');
    enterInEditor(handle);
    await settle();
    expect(popover()!.querySelector('.ai-rw-title')?.textContent).toBe('Outline');
    expect(popover()!.querySelector('.ai-rw-kind-seg[aria-pressed="true"]')?.textContent).toBe('Outline');
    clickButton('TL;DR');
    await settle();
    expect(requests).toHaveLength(2);
    expect(requests[1].messages[0].content).toBe(SUMMARY_SYSTEM_PROMPT);
    expect(popover()!.querySelector('.ai-rw-title')?.textContent).toBe('Summary');
    clickButton('Outline');
    await settle();
    clickButton('Insert');
    const md = handle.getMarkdown();
    expect(md).toContain('- Plan');
    expect(md).not.toContain('[!NOTE]');
    expect(md).not.toContain('/outline');
  });

  it('a long document is cut to fit: the popover and the block say how much was covered', async () => {
    const long = Array.from({ length: 40 }, (_, i) => `## Part ${i}\n\n${'Some words about this part. '.repeat(40)}\n`).join('\n');
    const { handle, requests } = mountWithAi(long, '- Parts.');
    handle.command('aiSummarize');
    await settle();
    expect(requests[0].messages[1].content).toContain('Only the first');
    const note = popover()!.querySelector<HTMLElement>('.ai-rw-coverage')!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toMatch(/^Covers the first \d+% of the document/);
    clickButton('Insert');
    expect(handle.getMarkdown()).toMatch(/Covers the first \d+% of the document\./);
  });

  it('source mode (AI menu): inserts at the caret line in one CM transaction', async () => {
    const { el, handle } = mountWithAi('Line one.\nLine two.\n\nAfter.\n', '- One and two.');
    handle.command('toggleSource');
    const view = EditorView.findFromDOM(el.querySelector<HTMLElement>('.cm-editor')!)!;
    const doc = view.state.doc.toString();
    view.dispatch({ selection: { anchor: doc.indexOf('one') } });
    handle.command('aiSummarize');
    await settle();
    clickButton('Insert');
    expect(view.state.doc.toString()).toBe('Line one.\n\n> [!NOTE]\n> **Summary**\n>\n> - One and two.\n\nLine two.\n\nAfter.\n');
    cmUndo(view);
    expect(view.state.doc.toString()).toBe(doc);
  });
});

describe('/title', () => {
  const titles = '{"titles": ["Alpha Plan", "Beta Plan", "Gamma Plan"]}';

  async function openTitles(handle: MikeDownEditorHandle): Promise<HTMLButtonElement[]> {
    typeSlash(handle, '/title');
    expect(slashMenuIds()[0]).toBe('title');
    enterInEditor(handle);
    await settle();
    await settle();
    expect(popover()!.dataset.output).toBe('choose');
    return [...popover()!.querySelectorAll<HTMLButtonElement>('.ai-rw-titles > button')];
  }

  it('with frontmatter title: sets title:, leaves the H1, Properties updates; one undo reverts both', async () => {
    const MD = '---\ntitle: Old\ntags: [a]\n---\n# Heading One\n\nBody text.\n';
    const { el, handle, requests } = mountWithAi(MD, titles);
    const items = await openTitles(handle);
    expect(requests[0].feature).toBe('title');
    expect(requests[0].messages[1].content).toContain('The current title is "Old"');
    expect(items.map((b) => b.textContent)).toEqual(['Alpha Plan', 'Beta Plan', 'Gamma Plan']);
    expect(popover()!.querySelector('.ai-rw-titles-hint')?.textContent).toBe('Sets title: in Properties');
    // Keyboard navigable.
    expect(document.activeElement).toBe(items[0]);
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(items[1]);
    const before = handle.getMarkdown();

    items[1].click();
    expect(popover()).toBeNull();
    const md = handle.getMarkdown();
    expect(md.startsWith('---\ntitle: Beta Plan\ntags: [a]\n---\n# Heading One\n')).toBe(true);
    expect(md).not.toContain('/title');
    expect(el.querySelector('.mikedown-outline-sidebar')?.textContent).toContain('Beta Plan');

    handle.command('undo');
    expect(handle.getMarkdown()).toBe(before);
    expect(el.querySelector('.mikedown-outline-sidebar')?.textContent).not.toContain('Beta Plan');
  });

  it('without frontmatter: replaces the H1 text; one undo reverts', async () => {
    const MD = '# Old Heading\n\nBody text.\n';
    const { handle } = mountWithAi(MD, titles);
    const items = await openTitles(handle);
    expect(popover()!.querySelector('.ai-rw-titles-hint')?.textContent).toBe('Replaces the H1');
    const before = handle.getMarkdown();
    items[2].click();
    const md = handle.getMarkdown();
    expect(md.startsWith('# Gamma Plan\n\nBody text.')).toBe(true);
    expect(md).not.toContain('/title');
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(before);
  });

  it('without an H1: inserts one at the top', async () => {
    const { handle } = mountWithAi('## Sub\n\nBody text.\n', titles);
    const items = await openTitles(handle);
    expect(popover()!.querySelector('.ai-rw-titles-hint')?.textContent).toBe('Inserts an H1');
    items[0].click();
    expect(handle.getMarkdown().startsWith('# Alpha Plan\n\n## Sub')).toBe(true);
  });

  it('repairs a reply that is not JSON once, then shows the titles', async () => {
    const { handle, requests } = mountWithAi('# Old\n\nBody.\n', (_req, n) => (n === 1 ? 'Here are some titles: Alpha, Beta' : titles));
    handle.command('aiSuggestTitle');
    await settle();
    await settle();
    expect(requests).toHaveLength(2);
    expect(requests[1].messages).toHaveLength(requests[0].messages.length + 2);
    expect(requests[1].messages.at(-1)?.content).toContain('not valid JSON');
    expect(popover()!.querySelectorAll('.ai-rw-titles > button')).toHaveLength(3);
  });

  it('a second bad reply is badOutput: Try again and Open AI settings', async () => {
    const { handle, requests } = mountWithAi('# Old\n\nBody.\n', 'no json here');
    handle.command('aiSuggestTitle');
    await settle();
    await settle();
    expect(requests).toHaveLength(2);
    expect(popover()!.dataset.phase).toBe('error');
    expect(popover()!.querySelector('.ai-rw-error-title')?.textContent).toBe('No usable answer');
    findButton('Try again');
    findButton('Open AI settings');
  });

  it('source mode: sets the frontmatter title line in one CM transaction', async () => {
    const MD = '---\ntitle: Old\n---\n# Heading\n\nBody.\n';
    const { el, handle } = mountWithAi(MD, titles);
    handle.command('toggleSource');
    const view = EditorView.findFromDOM(el.querySelector<HTMLElement>('.cm-editor')!)!;
    const doc = view.state.doc.toString();
    handle.command('aiSuggestTitle');
    await settle();
    await settle();
    popover()!.querySelector<HTMLButtonElement>('.ai-rw-titles > button')!.click();
    expect(view.state.doc.toString()).toBe('---\ntitle: Alpha Plan\n---\n# Heading\n\nBody.\n');
    cmUndo(view);
    expect(view.state.doc.toString()).toBe(doc);
  });
});

describe('whole-document translate, cut to fit', () => {
  it('translates the part that fits, keeps the rest as it is, and says so', async () => {
    const long = Array.from({ length: 40 }, (_, i) => `## Part ${i}\n\n${'Some words about this part. '.repeat(40).trim()}\n`).join('\n');
    const { handle, requests } = mountWithAi(long, '## Parte 0\n\nUnas palabras.');
    handle.tiptap.commands.setTextSelection(4);
    handle.command('aiTranslate');
    popover()!.querySelector<HTMLInputElement>('.ai-rw-toggle input')!.click();
    clickButton('Spanish');
    await settle();
    expect(requests[0].messages[1].content).not.toContain('## Part 39');
    const note = popover()!.querySelector<HTMLElement>('.ai-rw-coverage')!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toMatch(/^Translates the first \d+% of the document/);
    clickButton('Replace document');
    const md = handle.getMarkdown();
    expect(md.startsWith('## Parte 0\n\nUnas palabras.\n\n## Part ')).toBe(true);
    expect(md).toContain('## Part 39');
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(long);
  });
});

describe('availability', () => {
  it('AI off: no ai slash group', () => {
    const { handle } = mountWithAi('Text.\n', 'x', { enabled: false });
    typeSlash(handle, '/');
    const ids = slashMenuIds();
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some((id) => ['summary', 'outline', 'title'].includes(id))).toBe(false);
  });

  it('AI on: the group is last, labelled AI', () => {
    const { handle } = mountWithAi('Text.\n', 'x');
    typeSlash(handle, '/');
    expect(slashMenuIds().slice(-3)).toEqual(['summary', 'outline', 'title']);
    const headers = [...document.querySelectorAll('#mikedown-slash-menu .slash-menu-group-header')].map((h) => h.textContent);
    expect(headers.at(-1)).toBe('AI');
  });

  it('AI on with no route: group hidden; the AI menu entries are disabled with the router\'s reason', async () => {
    class Host extends NoopHost {
      ai = {
        complete: async () => { throw new Error('unused'); },
        listEngines: async () => [],
        testEngine: async () => ({ ok: false }),
        discoverModels: async () => ({ models: [] }),
        setSecret: async () => {},
      } as unknown as MikeDownAiHost;
    }
    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = createMikeDownEditor(el, { host: new Host(), initialMarkdown: 'Text.\n', settings: { ai: { enabled: true } } as never });
    mounted.push({ handle, el });
    await settle();
    typeSlash(handle, '/');
    expect(slashMenuIds().some((id) => ['summary', 'outline', 'title'].includes(id))).toBe(false);
    closeSlashMenu();
    el.querySelector<HTMLButtonElement>('button[data-action="ai"]')!.click();
    const items = [...document.querySelectorAll<HTMLElement>('#toolbar-dropdown .tdd-item')];
    const byLabel = (label: string) => items.find((i) => i.querySelector('.tdd-item-label')?.textContent === label)!;
    for (const label of ['Summarize document…', 'Suggest titles…']) {
      expect(byLabel(label).getAttribute('aria-disabled')).toBe('true');
      expect(byLabel(label).querySelector('.tdd-item-hint')?.textContent?.length).toBeGreaterThan(0);
    }
  });
});
