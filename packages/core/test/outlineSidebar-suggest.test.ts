/**
 * Properties suggestions (AI writing M6): the sidebar's Suggest button and
 * chips row, applying a chip as one undo step through the frontmatter
 * history (frontmatterHistory.ts), the JSON repair round trip, and the
 * undoable "Suggest titles…" pick on a document with `title:`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
import { parseAiSettings, type AiCompletionRequest, type MikeDownAiHost } from '../src/ai';
import { PROPERTIES_SYSTEM_PROMPT } from '../src/ai/prompts/properties';
import { mergePropertySuggestion } from '../src/propertySuggestions';
import { createOutlineSidebar, type OutlineSidebar } from '../src/outlineSidebar';
import { closeSlashMenu, setSlashSourceMode } from '../src/slashcommands';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

describe('mergePropertySuggestion', () => {
  it('appends a tag to an array, a scalar list or a new tags entry, once', () => {
    expect(mergePropertySuggestion([{ key: 'tags', value: ['a'] }], { kind: 'tag', tag: 'b' })).toEqual([{ key: 'tags', value: ['a', 'b'] }]);
    expect(mergePropertySuggestion([{ key: 'tag', value: 'a, b' }], { kind: 'tag', tag: 'c' })).toEqual([{ key: 'tag', value: ['a', 'b', 'c'] }]);
    expect(mergePropertySuggestion([{ key: 'tags', value: '' }], { kind: 'tag', tag: 'c' })).toEqual([{ key: 'tags', value: ['c'] }]);
    expect(mergePropertySuggestion([{ key: 'title', value: 'T' }], { kind: 'tag', tag: '#New' })).toEqual([
      { key: 'title', value: 'T' }, { key: 'tags', value: ['new'] },
    ]);
    expect(mergePropertySuggestion([{ key: 'tags', value: ['#a'] }], { kind: 'tag', tag: 'a' })).toEqual([{ key: 'tags', value: ['#a'] }]);
  });

  it('sets or replaces title and description; a new title goes first, a new description after it', () => {
    const entries = [{ key: 'date', value: '2026' }];
    expect(mergePropertySuggestion(entries, { kind: 'title', value: 'New' })).toEqual([{ key: 'title', value: 'New' }, ...entries]);
    expect(mergePropertySuggestion([{ key: 'Title', value: 'Old' }], { kind: 'title', value: 'New' })).toEqual([{ key: 'Title', value: 'New' }]);
    expect(mergePropertySuggestion([...entries, { key: 'title', value: 'T' }], { kind: 'description', value: 'D' })).toEqual([
      ...entries, { key: 'title', value: 'T' }, { key: 'description', value: 'D' },
    ]);
    expect(mergePropertySuggestion(entries, { kind: 'description', value: 'D' })[0]).toEqual({ key: 'description', value: 'D' });
    // The input is left alone.
    expect(entries).toEqual([{ key: 'date', value: '2026' }]);
  });
});

// ── In the editor ───────────────────────────────────────────────────────────

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

type Reply = string | ((req: AiCompletionRequest, n: number) => string | Promise<string>);

function mount(markdown: string, reply: Reply, opts: { ai?: { enabled: boolean }; aiHost?: Partial<MikeDownAiHost> } = {}) {
  const requests: AiCompletionRequest[] = [];
  class AiHost extends NoopHost {
    ai: MikeDownAiHost = {
      complete: async (req, onToken, signal) => {
        requests.push(req);
        const text = typeof reply === 'function' ? await reply(req, requests.length) : reply;
        if (signal?.aborted) {throw Object.assign(new Error('cancelled'), { code: 'cancelled' });}
        onToken(text);
        return { text, served: { engineName: 'Proxy', modelId: 'house-model', isLocal: true }, finishReason: 'stop' };
      },
      ...opts.aiHost,
    } as MikeDownAiHost;
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, {
    host: new AiHost(),
    initialMarkdown: markdown,
    hostOwnsShortcuts: true,
    features: { sidebar: true },
    settings: { ai: opts.ai ?? { enabled: true } } as never,
  });
  mounted.push({ handle, el });
  return { el, handle, requests };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) {await new Promise((r) => setTimeout(r, 0));}
};
const suggestBtn = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.properties-suggest-btn')!;
const row = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-testid="properties-suggest"]')!;
const chips = (el: HTMLElement) => [...row(el).querySelectorAll<HTMLElement>('.properties-suggest-chip')];
const chip = (el: HTMLElement, kind: string, text?: string) => chips(el).find((c) => c.dataset.kind === kind
  && (text === undefined || c.querySelector('.properties-pill-text')?.textContent === text))!;
const applyChip = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('.properties-suggest-apply')!.click();
const rowButton = (el: HTMLElement, label: string) => [...row(el).querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;

const REPLY = JSON.stringify({ title: 'Launch Plan', description: 'How the editor ships in May.', tags: ['planning', 'Release Notes', 'a'] });
const BODY = '# Plan\n\nWe ship the editor in May. Docs follow in June.\n';

describe('Properties Suggest', () => {
  it('nothing runs on open or edit; Suggest asks with the vocabulary and shows chips; known tags have no "new" mark', async () => {
    const MD = `---\ntitle: Old\ntags: [a]\n---\n${BODY}`;
    const { el, handle, requests } = mount(MD, REPLY);
    handle.setTags([{ tag: 'release-notes', count: 1 }, { tag: 'planning', count: 9 }]);
    handle.tiptap.commands.insertContent('More. ');
    await settle();
    expect(requests).toHaveLength(0);

    const btn = suggestBtn(el);
    expect(btn.hidden).toBe(false);
    expect(btn.getAttribute('aria-label')).toBe('Suggest properties with AI');
    expect(btn.getAttribute('aria-disabled')).toBe('false');
    btn.click();
    expect(row(el).dataset.state).toBe('running');
    expect(row(el).querySelector('.properties-suggest-progress')).not.toBeNull();
    await settle();

    expect(requests).toHaveLength(1);
    expect(requests[0].feature).toBe('frontmatter');
    expect(requests[0].messages[0].content).toBe(PROPERTIES_SYSTEM_PROMPT);
    // Most used first; existing properties and the body go along.
    expect(requests[0].messages[1].content).toContain('planning, release-notes');
    expect(requests[0].messages[1].content).toContain('title: Old');
    expect(requests[0].messages[1].content).toContain('We ship the editor in May.');

    expect(row(el).dataset.state).toBe('idle');
    // `a` is already there; "Release Notes" normalised to a known tag.
    expect(chips(el).map((c) => c.dataset.kind)).toEqual(['title', 'description', 'tag', 'tag']);
    expect(chip(el, 'tag', 'planning').querySelector('.properties-suggest-new')).toBeNull();
    expect(chip(el, 'tag', 'release-notes').querySelector('.properties-suggest-new')).toBeNull();
    expect(chip(el, 'title').querySelector('.properties-suggest-apply')!.getAttribute('title')).toBe('Set title: Launch Plan');
  });

  it('a tag chip adds the tag, the frontmatter block shows it, the chip goes; one undo removes it, redo puts it back', async () => {
    const MD = `---\ntitle: Old\ntags: [a]\n---\n${BODY}`;
    const { el, handle } = mount(MD, JSON.stringify({ tags: ['fresh-idea'] }));
    suggestBtn(el).click();
    await settle();
    const c = chip(el, 'tag', 'fresh-idea');
    expect(c.querySelector('.properties-suggest-new')?.textContent).toBe('new');
    const before = handle.getMarkdown();

    applyChip(c);
    expect(handle.getMarkdown()).toBe(`---\ntitle: Old\ntags: [a, fresh-idea]\n---\n${BODY}`);
    expect(el.querySelector('.frontmatter-block')).not.toBeNull();
    expect(el.querySelector('.mikedown-outline-sidebar .properties-list')?.textContent).toContain('fresh-idea');
    // The last chip went, so the row closed.
    expect(row(el).hidden).toBe(true);

    handle.command('undo');
    expect(handle.getMarkdown()).toBe(before);
    expect(el.querySelector('.mikedown-outline-sidebar .properties-list')?.textContent).not.toContain('fresh-idea');
    handle.command('redo');
    expect(handle.getMarkdown()).toContain('tags: [a, fresh-idea]');
  });

  it('each chip is its own undo step; Dismiss and Dismiss all apply nothing', async () => {
    const MD = `---\ntags: [a]\n---\n${BODY}`;
    const { el, handle } = mount(MD, JSON.stringify({ title: 'Launch Plan', description: 'About May.', tags: ['x', 'y'] }));
    suggestBtn(el).click();
    await settle();
    const original = handle.getMarkdown();
    applyChip(chip(el, 'title'));
    applyChip(chip(el, 'tag', 'x'));
    expect(handle.getMarkdown()).toBe(`---\ntitle: Launch Plan\ntags: [a, x]\n---\n${BODY}`);
    chip(el, 'description').querySelector<HTMLButtonElement>('.properties-pill-x')!.click();
    expect(chips(el).map((c) => c.dataset.kind)).toEqual(['tag']);
    rowButton(el, 'Dismiss all').click();
    expect(row(el).hidden).toBe(true);
    expect(handle.getMarkdown()).toBe(`---\ntitle: Launch Plan\ntags: [a, x]\n---\n${BODY}`);

    handle.command('undo');
    expect(handle.getMarkdown()).toBe(`---\ntitle: Launch Plan\ntags: [a]\n---\n${BODY}`);
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(original);
  });

  it('without frontmatter: the first chip creates the block; one undo removes it entirely', async () => {
    const { el, handle } = mount(BODY, REPLY);
    suggestBtn(el).click();
    await settle();
    applyChip(chip(el, 'description'));
    expect(handle.getMarkdown()).toBe(`---\ndescription: How the editor ships in May.\n---\n${BODY}`);
    expect(el.querySelector('.frontmatter-block.expanded')).not.toBeNull();
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(BODY);
    expect(el.querySelector('.frontmatter-block')).toBeNull();
  });

  it('repairs a reply that is not JSON once, saying so while it runs', async () => {
    let release: (() => void) | null = null;
    const { el, requests } = mount(BODY, (_req, n) => {
      if (n === 1) {return 'Sure! Title: Launch Plan';}
      return new Promise((resolve) => { release = () => resolve(REPLY); });
    });
    suggestBtn(el).click();
    await settle();
    expect(requests).toHaveLength(2);
    expect(requests[1].messages.at(-1)?.content).toContain('not valid JSON');
    expect(row(el).querySelector('.properties-suggest-message')?.textContent).toBe('Fixing the answer format…');
    release!();
    await settle();
    expect(chips(el).length).toBeGreaterThan(0);
  });

  it('a second bad reply shows the badOutput copy with Try again, which runs again', async () => {
    const { el, requests } = mount(BODY, 'no json here');
    suggestBtn(el).click();
    await settle();
    expect(requests).toHaveLength(2);
    expect(row(el).dataset.state).toBe('error');
    expect(row(el).querySelector('.properties-suggest-error')?.textContent?.length).toBeGreaterThan(0);
    rowButton(el, 'Try again').click();
    await settle();
    expect(requests).toHaveLength(4);
  });

  it('a new run aborts the previous one; Cancel and a document switch clear the row', async () => {
    const pending: Array<(text: string) => void> = [];
    const { el, handle, requests } = mount(BODY, () => new Promise<string>((resolve) => { pending.push(resolve); }));
    suggestBtn(el).click();
    await settle();
    suggestBtn(el).click();
    await settle();
    expect(requests).toHaveLength(2);
    pending[0](REPLY);
    await settle();
    // The first answer arrived after it was replaced: still running.
    expect(row(el).dataset.state).toBe('running');
    rowButton(el, 'Cancel').click();
    expect(row(el).hidden).toBe(true);
    pending[1](REPLY);
    await settle();
    expect(row(el).hidden).toBe(true);

    suggestBtn(el).click();
    await settle();
    handle.setMarkdown('# Other\n');
    expect(row(el).hidden).toBe(true);
    pending[2](REPLY);
    await settle();
    expect(row(el).hidden).toBe(true);
  });

  it('turning AI off clears the chips; a run going at the time is aborted and shows nothing (T3 F6)', async () => {
    const { el, handle } = mount(BODY, REPLY);
    suggestBtn(el).click();
    await settle();
    expect(chips(el).length).toBeGreaterThan(0);
    handle.updateSettings({ ai: parseAiSettings({ enabled: false }, { onWarning: () => {} }) });
    expect(suggestBtn(el).hidden).toBe(true);
    expect(row(el).hidden).toBe(true);
    expect(chips(el)).toHaveLength(0);

    const pending: Array<(text: string) => void> = [];
    const second = mount(BODY, () => new Promise<string>((resolve) => { pending.push(resolve); }));
    suggestBtn(second.el).click();
    await settle();
    expect(row(second.el).dataset.state).toBe('running');
    second.handle.updateSettings({ ai: parseAiSettings({ enabled: false }, { onWarning: () => {} }) });
    expect(row(second.el).hidden).toBe(true);
    pending[0](REPLY);
    await settle();
    expect(row(second.el).hidden).toBe(true);
  });

  it('the aiSuggestProperties command shows the sidebar and runs Suggest', async () => {
    const { el, handle, requests } = mount(BODY, REPLY);
    const sidebar = el.querySelector<HTMLElement>('.mikedown-outline-sidebar')!;
    expect(sidebar.hidden).toBe(true);
    handle.command('aiSuggestProperties');
    await settle();
    expect(requests).toHaveLength(1);
    expect(sidebar.hidden).toBe(false);
    expect(el.querySelector('.properties-section')?.classList.contains('collapsed')).toBe(false);
    expect(chips(el).length).toBe(5);
  });

  it('source mode: Suggest is disabled with the reason', () => {
    const { el, handle, requests } = mount(BODY, REPLY);
    handle.command('toggleSource');
    const btn = suggestBtn(el);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.title).toBe('Switch to rich text to apply suggestions');
    btn.click();
    handle.command('aiSuggestProperties');
    expect(requests).toHaveLength(0);
    handle.command('toggleSource');
    expect(suggestBtn(el).getAttribute('aria-disabled')).toBe('false');
  });

  it('AI off: no Suggest button', () => {
    const { el } = mount(BODY, REPLY, { ai: { enabled: false } });
    expect(suggestBtn(el).hidden).toBe(true);
  });

  it('AI on with no route: Suggest is disabled with the router\'s reason', async () => {
    const { el } = mount(BODY, REPLY, {
      aiHost: {
        listEngines: async () => [],
        testEngine: async () => ({ ok: false }),
        discoverModels: async () => ({ models: [] }),
        setSecret: async () => {},
      } as unknown as Partial<MikeDownAiHost>,
    });
    await settle();
    const btn = suggestBtn(el);
    expect(btn.hidden).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.title.length).toBeGreaterThan(0);
    expect(btn.title).not.toBe('Suggest properties with AI');
  });
});

describe('Suggest titles… on a document with title:', () => {
  it('the pick is one undo step and redo restores it', async () => {
    const MD = `---\ntitle: Old\ntags: [a]\n---\n${BODY}`;
    const { el, handle } = mount(MD, '{"titles": ["Alpha Plan", "Beta Plan", "Gamma Plan"]}');
    handle.command('aiSuggestTitle');
    await settle();
    const before = handle.getMarkdown();
    document.querySelector<HTMLButtonElement>('.mikedown-ai-rewrite .ai-rw-titles > button')!.click();
    expect(handle.getMarkdown()).toBe(`---\ntitle: Alpha Plan\ntags: [a]\n---\n${BODY}`);
    expect(el.querySelector('.mikedown-outline-sidebar')?.textContent).toContain('Alpha Plan');
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(before);
    expect(el.querySelector('.mikedown-outline-sidebar')?.textContent).not.toContain('Alpha Plan');
    handle.command('redo');
    expect(handle.getMarkdown()).toContain('title: Alpha Plan');
  });
});

// ── The sidebar on its own (callbacks, no editor) ───────────────────────────

describe('the sidebar\'s Suggest button and chips row, with spies for callbacks', () => {
  let sidebar: OutlineSidebar | null = null;
  afterEach(() => {
    sidebar?.destroy();
    sidebar = null;
    document.body.innerHTML = '';
  });

  function build() {
    document.body.innerHTML = '<aside id="side" hidden></aside><button id="toggle"></button><div id="scroll"></div>';
    const cb = {
      onPropertiesChange: vi.fn(),
      onSuggestProperties: vi.fn(),
      onApplyPropertySuggestion: vi.fn(() => true),
      onCancelPropertySuggestions: vi.fn(),
    };
    sidebar = createOutlineSidebar({
      editor: { state: { doc: { forEach: () => {} }, selection: { from: 0 } }, on: vi.fn() },
      sidebarEl: document.getElementById('side')!,
      toggleEl: document.getElementById('toggle') as HTMLButtonElement,
      scrollContainer: document.getElementById('scroll')!,
      anchorFn: (t: string) => t,
      ...cb,
    } as never);
    sidebar.applyProperties([{ key: 'title', value: 'Old' }], { editable: true });
    const btn = () => document.querySelector<HTMLButtonElement>('.properties-suggest-btn')!;
    const row = () => document.querySelector<HTMLElement>('[data-testid="properties-suggest"]')!;
    const applyButtons = () => [...row().querySelectorAll<HTMLButtonElement>('.properties-suggest-apply')];
    return { cb, sidebar, btn, row, applyButtons };
  }

  const SUGGESTIONS = { title: 'New', description: 'About it.', tags: [{ tag: 'known-tag', known: true }, { tag: 'fresh', known: false }] };

  it('the button is hidden, disabled with the reason as its tooltip, or enabled; a click asks only when enabled', () => {
    const { cb, sidebar, btn } = build();
    sidebar.applySuggestAvailability({ state: 'hidden' });
    expect(btn().hidden).toBe(true);

    sidebar.applySuggestAvailability({ state: 'disabled', reason: 'No engine can do this' });
    expect(btn().hidden).toBe(false);
    expect(btn().getAttribute('aria-disabled')).toBe('true');
    expect(btn().title).toBe('No engine can do this');
    btn().click();
    expect(cb.onSuggestProperties).not.toHaveBeenCalled();

    sidebar.applySuggestAvailability({ state: 'enabled' });
    expect(btn().getAttribute('aria-disabled')).toBe('false');
    expect(btn().title).toBe('Suggest properties with AI');
    btn().click();
    expect(cb.onSuggestProperties).toHaveBeenCalledTimes(1);
  });

  it('renders one chip per suggestion, title and description first, and marks only new tags', () => {
    const { sidebar, row } = build();
    expect(row().hidden).toBe(true);
    sidebar.applyPropertySuggestions(SUGGESTIONS, 'idle');
    const chips = [...row().querySelectorAll<HTMLElement>('.properties-suggest-chip')];
    expect(chips.map((c) => c.dataset.kind)).toEqual(['title', 'description', 'tag', 'tag']);
    expect(chips.map((c) => !!c.querySelector('.properties-suggest-new'))).toEqual([false, false, false, true]);
  });

  it('the chips row sits in the list after the property rows and before "+ Add property", with the rows\' inset', () => {
    const { sidebar, row } = build();
    sidebar.applyPropertySuggestions(SUGGESTIONS, 'idle');
    const list = document.querySelector<HTMLElement>('.properties-list')!;
    const order = () => [...list.children].map((c) => (c === row() ? 'suggest'
      : c.classList.contains('properties-add-row') ? 'add' : 'row'));
    expect(row().parentElement).toBe(list);
    expect(order()).toEqual(['row', 'suggest', 'add']);
    // Not a section body of its own: that rule zeroes the side padding.
    expect(row().classList.contains('sidebar-section-body')).toBe(false);
    // A re-render of the rows keeps the order.
    sidebar.applyProperties([{ key: 'title', value: 'Old' }, { key: 'tags', value: ['a'] }], { editable: true });
    expect(order()).toEqual(['row', 'row', 'suggest', 'add']);
    // Read-only: after the rows (or the empty note), no add row.
    sidebar.applyProperties([], { editable: false });
    expect([...list.children].map((c) => c.className)).toEqual(['properties-empty', 'properties-suggest']);

    const css = readFileSync(resolve(__dirname, '../src/styles/outline-sidebar.css'), 'utf8');
    const rule = (sel: string) => css.slice(css.indexOf(`${sel} {`), css.indexOf('}', css.indexOf(`${sel} {`)));
    const inset = (sel: string) => rule(sel).match(/padding:\s*\S+\s+([^\s;]+)/)?.[1];
    expect(inset('.properties-suggest')).toBe(inset('.properties-row'));
  });

  it('a truncated title or description chip carries its full text as the tooltip', () => {
    const { sidebar, row } = build();
    const long = 'A test document containing basic Markdown features like bold text, italics, links, and tables.';
    sidebar.applyPropertySuggestions({ title: 'New', description: long, tags: [] }, 'idle');
    const apply = row().querySelector<HTMLElement>('.properties-suggest-chip[data-kind="description"] .properties-suggest-apply')!;
    expect(apply.title).toBe(`Set description: ${long}`);
  });

  it('removing the last item of a list hands the owner the entries without that key', () => {
    const { cb, sidebar } = build();
    sidebar.applyProperties([{ key: 'title', value: 'T' }, { key: 'tags', value: ['a'] }], { editable: true });
    document.querySelector<HTMLButtonElement>('.properties-value .properties-pill-x')!.click();
    expect(cb.onPropertiesChange).toHaveBeenLastCalledWith([{ key: 'title', value: 'T' }]);
  });

  it('applying a chip hands the pick to the owner, which merges it; the chip goes only when the owner applied it', () => {
    const { cb, sidebar, row, applyButtons } = build();
    sidebar.applyPropertySuggestions(SUGGESTIONS, 'idle');

    cb.onApplyPropertySuggestion.mockReturnValueOnce(false);
    applyButtons()[0].click();
    expect(cb.onApplyPropertySuggestion).toHaveBeenLastCalledWith({ kind: 'title', value: 'New' });
    expect(applyButtons()).toHaveLength(4);

    applyButtons()[0].click();
    expect(applyButtons()).toHaveLength(3);
    applyButtons()[2].click();
    expect(cb.onApplyPropertySuggestion).toHaveBeenLastCalledWith({ kind: 'tag', tag: 'fresh' });
    expect(applyButtons().map((b) => b.querySelector('.properties-pill-text')?.textContent)).toEqual(['About it.', 'known-tag']);
    // The sidebar never edits the properties itself for a suggestion.
    expect(cb.onPropertiesChange).not.toHaveBeenCalled();
    expect(row().hidden).toBe(false);
  });

  it('what the owner merges is what mergePropertySuggestion gives for each kind of pick', () => {
    const entries = [{ key: 'title', value: 'Old' }, { key: 'tags', value: ['a'] }];
    const merged = (['title', 'description', 'tag'] as const).reduce((acc, kind) => mergePropertySuggestion(acc, kind === 'tag'
      ? { kind, tag: 'fresh' }
      : { kind, value: kind === 'title' ? 'New' : 'About it.' }), entries);
    expect(merged).toEqual([
      { key: 'title', value: 'New' },
      { key: 'description', value: 'About it.' },
      { key: 'tags', value: ['a', 'fresh'] },
    ]);
  });

  it('dismissing one chip applies nothing; Dismiss all closes the row; the last chip closing it too', () => {
    const { cb, sidebar, row } = build();
    sidebar.applyPropertySuggestions(SUGGESTIONS, 'idle');
    row().querySelector<HTMLButtonElement>('.properties-pill-x')!.click();
    expect(row().querySelectorAll('.properties-suggest-chip')).toHaveLength(3);
    const dismissAll = [...row().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Dismiss all')!;
    dismissAll.click();
    expect(row().hidden).toBe(true);
    expect(cb.onApplyPropertySuggestion).not.toHaveBeenCalled();

    sidebar.applyPropertySuggestions({ tags: [{ tag: 'only', known: false }] }, 'idle');
    row().querySelector<HTMLButtonElement>('.properties-pill-x')!.click();
    expect(row().hidden).toBe(true);
  });

  it('no new suggestions says so with a Dismiss; running offers Cancel; an error offers Try again', () => {
    const { cb, sidebar, row } = build();
    const labels = () => [...row().querySelectorAll<HTMLButtonElement>('button')].map((b) => b.textContent);

    sidebar.applyPropertySuggestions({ tags: [] }, 'idle');
    expect(row().textContent).toContain('No new suggestions.');
    expect(labels()).toEqual(['Dismiss']);

    sidebar.applyPropertySuggestions(null, 'running', 'local · Proxy');
    expect(row().dataset.state).toBe('running');
    expect(labels()).toEqual(['Cancel']);
    row().querySelector<HTMLButtonElement>('button')!.click();
    expect(cb.onCancelPropertySuggestions).toHaveBeenCalledTimes(1);
    expect(row().hidden).toBe(true);

    sidebar.applyPropertySuggestions(null, 'error', 'Nothing usable came back.');
    expect(row().querySelector('[role="alert"]')?.textContent).toBe('Nothing usable came back.');
    [...row().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Try again')!.click();
    expect(cb.onSuggestProperties).toHaveBeenCalledTimes(1);
  });
});
