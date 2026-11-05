/**
 * The chat panel (ai-chat-panel.ts): the scope picker, every outcome, chips,
 * Insert, Cancel, history, and hostile model and page text. Most tests drive a
 * fake `DocsChat` that returns the outcome under test; the last group runs the
 * real loop against fakes (shared with ai-docs-loop.test.ts). The smoke test
 * `ai-chat-panel-smoke.test.ts` covers the wiring; this file does not repeat it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiErrorCopy, makeAiError, type AiDocBaseStatus, type DocsTurnEvents, type DocsTurnOutcome, type MikeDownDocsHost } from '../src/ai';
import { AI_CHAT_BUSY_NOTICE, AI_CHAT_NO_BASES, AI_CHAT_SECRET_NOTICE, chatLocalOnlyTitle, formatChatExport } from '../src/ai-chat-panel';
import { createAiDocsChat } from '../src/ai-docs-run';
import { answered, ask, fakeChat, mount, sent, settle, status, unmountPanels } from './helpers/ai-chat-fakes';
import { AWS_KEY, aiSettings, ctxOf, fakeAi, fakeDocs, nav, simple, toCloud, type FakePage } from './helpers/ai-docs-fakes';

const clipboard = vi.fn(async (_text: string) => {});

beforeEach(() => {
  clipboard.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboard }, configurable: true });
});
afterEach(() => {
  unmountPanels();
  vi.restoreAllMocks();
});

const docsHost = (list: AiDocBaseStatus[] = [status('b', '/kb', 'docs')]): MikeDownDocsHost => ({ listBases: async () => list }) as unknown as MikeDownDocsHost;
const answerEl = (c: HTMLElement) => c.querySelector<HTMLElement>('.ai-chat-answer')!;
const logText = (c: HTMLElement) => c.querySelector('.ai-chat-log')!.textContent ?? '';
const click = (c: HTMLElement, fk: string) => c.querySelector<HTMLElement>(`[data-fk="${fk}"]`)!.click();
const statusText = (c: HTMLElement) => Array.from(c.querySelectorAll('.ai-chat-status')).map((n) => n.textContent).join('');
const chips = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('.ai-chat-chip'));
const lastInsert = (fn: ReturnType<typeof vi.fn>) => (fn.mock.calls[fn.mock.calls.length - 1] as unknown as [string])[0];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 1000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) {await wait(2);}
  expect(cond()).toBe(true);
}

/** Every attribute that could fetch, navigate or run code, on `root` and below. */
function liveAttributes(root: Element): string[] {
  const found: string[] = [];
  for (const node of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attr of Array.from(node.attributes)) {
      if (/^(href|src|srcset|xlink:href|action|formaction|poster|data|ping|srcdoc)$/i.test(attr.name) || /^on/i.test(attr.name)) {
        found.push(`${node.tagName.toLowerCase()}[${attr.name}]`);
      }
    }
  }
  return found;
}
/** A `<` that starts a tag, comment or processing instruction and is not backslash-escaped. */
const RAW_TAG = /(^|[^\\])<[a-zA-Z/!?]/;
const dangerousElements = 'img, a, script, iframe, object, embed, svg, link, style, form, video, audio, source, base, meta';

// ── Scope picker ────────────────────────────────────────────────────────────

describe('the scope picker', () => {
  const radio = (c: HTMLElement, value: string) => c.querySelector<HTMLInputElement>(`input[value="${value}"]`)!;

  it('is hidden without host.docs and shown with it, with both choices named', async () => {
    const plain = mount({ chat: fakeChat(async () => answered('x', [])) });
    expect(plain.container.querySelector<HTMLElement>('.ai-chat-scope')!.hidden).toBe(true);
    const withDocs = mount({ chat: fakeChat(async () => answered('x', [])), docs: docsHost() });
    await settle();
    const picker = withDocs.container.querySelector<HTMLElement>('.ai-chat-scope')!;
    expect(picker.hidden).toBe(false);
    expect(picker.textContent).toContain('This document');
    expect(picker.textContent).toContain('Active bases');
    expect(picker.getAttribute('role')).toBe('radiogroup');
  });

  it('starts on This document until the bases are known, then moves to Active bases', async () => {
    let release: (v: AiDocBaseStatus[]) => void = () => {};
    const docs = { listBases: () => new Promise<AiDocBaseStatus[]>((r) => { release = r; }) } as unknown as MikeDownDocsHost;
    const { container } = mount({ chat: fakeChat(async () => answered('x', [])), docs });
    expect(radio(container, 'document').checked).toBe(true);
    expect(container.querySelector('textarea')!.placeholder).toBe('Ask about this document…');
    release([status('b', '/kb', 'docs')]);
    await settle();
    expect(radio(container, 'bases').checked).toBe(true);
    expect(container.querySelector('textarea')!.placeholder).toBe('Ask your documentation…');
  });

  it('a base that is off, or whose folder is missing, is not active', async () => {
    const list = [
      status('off', '/a', 'a', { base: { id: 'off', name: 'Off', roots: ['/a'], enabled: false, allowCloud: false }, active: false }),
      status('gone', '/b', 'b', { roots: [{ root: '/b', label: 'b', found: false, fileCount: 0, oversizeSkipped: 0, capReached: false }] }),
    ];
    const { container } = mount({ chat: fakeChat(async () => answered('x', [])), docs: docsHost(list) });
    await settle();
    expect(radio(container, 'document').checked).toBe(true);
  });

  it('a choice made before the list arrives is kept', async () => {
    let release: (v: AiDocBaseStatus[]) => void = () => {};
    const docs = { listBases: () => new Promise<AiDocBaseStatus[]>((r) => { release = r; }) } as unknown as MikeDownDocsHost;
    const { container } = mount({ chat: fakeChat(async () => answered('x', [])), docs });
    radio(container, 'bases').checked = true;
    radio(container, 'bases').dispatchEvent(new Event('change'));
    radio(container, 'document').checked = true;
    radio(container, 'document').dispatchEvent(new Event('change'));
    release([status('b', '/kb', 'docs')]);
    await settle();
    expect(radio(container, 'document').checked).toBe(true);
  });

  it('a list that fails to load leaves This document, and no base is named', async () => {
    const docs = { listBases: async () => { throw new Error('nope'); } } as unknown as MikeDownDocsHost;
    const { container } = mount({ chat: fakeChat(async () => answered('x', [])), docs });
    await settle();
    expect(radio(container, 'document').checked).toBe(true);
  });

  it('Active bases names the active bases, or says none is and offers the manager', async () => {
    const openBases = vi.fn();
    const two = mount({ chat: fakeChat(async () => answered('x', [])), docs: docsHost([status('a', '/a', 'a'), status('b', '/b', 'b')]) });
    await settle();
    expect(two.container.querySelector('.ai-chat-bases')!.textContent).toBe('A, B');

    const none = mount({ chat: fakeChat(async () => answered('x', [])), docs: docsHost([status('a', '/a', 'a', { active: false })]), openBases });
    await settle();
    radio(none.container, 'bases').checked = true;
    radio(none.container, 'bases').dispatchEvent(new Event('change'));
    expect(none.container.querySelector('.ai-chat-bases')!.textContent).toContain('No base is active.');
    click(none.container, 'chat:manage-bases');
    expect(openBases).toHaveBeenCalledOnce();

    const noManager = mount({ chat: fakeChat(async () => answered('x', [])), docs: docsHost([]) });
    await settle();
    radio(noManager.container, 'bases').checked = true;
    radio(noManager.container, 'bases').dispatchEvent(new Event('change'));
    expect(noManager.container.querySelector('[data-fk="chat:manage-bases"]')).toBeNull();
  });

  it('sends the scope that is chosen: the live text for the document, the host and options for bases', async () => {
    let text = 'first text';
    const chat = fakeChat(async () => answered('x', []));
    const docs = docsHost();
    const options = { maxHops: 2 };
    const { container, input } = mount({ chat, docs, documentText: () => text, docsOptions: () => options, thinking: 'low' as never });
    await settle();
    await ask(input, 'one');
    expect(chat.input).toMatchObject({ question: 'one', scope: { kind: 'bases', docs, options }, thinking: 'low' });

    radio(container, 'document').checked = true;
    radio(container, 'document').dispatchEvent(new Event('change'));
    text = 'edited since';
    await ask(input, 'two');
    expect(chat.input).toMatchObject({ question: 'two', scope: { kind: 'document', text: 'edited since', options } });
    expect((chat.input as { scope: { docs?: unknown } }).scope.docs).toBeUndefined();
  });

  it('cannot change mid-turn, and a turn keeps the scope it started with', async () => {
    let finish: (o: DocsTurnOutcome) => void = () => {};
    const chat = fakeChat(() => new Promise<DocsTurnOutcome>((r) => { finish = r; }));
    const { container, input } = mount({ chat, docs: docsHost() });
    await settle();
    await ask(input, 'q');
    expect(radio(container, 'bases').disabled).toBe(true);
    expect(radio(container, 'document').disabled).toBe(true);
    finish(answered('A [1].', [sent(1, 'a.md', 's', 'S')]));
    await settle();
    expect(radio(container, 'bases').disabled).toBe(false);
    expect(chips(container)).toHaveLength(1);
  });

  it('a feature switch hides the picker and the Active bases line, blocks Send, and says why', async () => {
    let off: string | null = 'Chat is turned off in the AI settings.';
    const chat = fakeChat(async () => answered('x', []));
    const { container, input, handle } = mount({ chat, docs: docsHost(), featureOffNotice: () => off });
    await settle();
    expect(container.querySelector<HTMLElement>('.ai-chat-scope')!.hidden).toBe(true);
    expect(container.querySelector<HTMLElement>('.ai-chat-bases')!.hidden).toBe(true);
    expect(container.querySelector('.ai-chat-off')!.textContent).toContain(off);
    input.disabled = false;
    input.value = 'forced';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    click(container, 'chat:send');
    expect(chat.input).toBeNull();
    off = null;
    handle.refresh();
    await settle();
    expect(input.disabled).toBe(false);
    expect(container.querySelector<HTMLElement>('.ai-chat-off')!.hidden).toBe(true);
  });

  it('an empty or blank question is not sent', async () => {
    const chat = fakeChat(async () => answered('x', []));
    const { container, input } = mount({ chat });
    await ask(input, '   \n ');
    expect(chat.input).toBeNull();
    expect(container.querySelectorAll('.ai-chat-turn')).toHaveLength(0);
    expect(container.querySelector<HTMLButtonElement>('[data-fk="chat:send"]')!.disabled).toBe(true);
  });
});

// ── Outcomes ────────────────────────────────────────────────────────────────

describe('every outcome renders', () => {
  const one = async (outcome: DocsTurnOutcome | (() => Promise<DocsTurnOutcome>), over: Parameters<typeof mount>[0] extends infer O ? Partial<O> : never = {}) => {
    const chat = fakeChat(typeof outcome === 'function' ? outcome : async () => outcome);
    const page = mount({ chat, ...(over as object) });
    await settle();
    await ask(page.input, 'the question');
    return page;
  };

  it('answered with sources: the answer, chips, the coverage note, and the actions', async () => {
    const list = [sent(1, 'a.md', 's', 'S'), sent(2, 'b.md', 't', 'T')];
    const { container } = await one(answered('Do this [1] then that [2].', list), { docs: docsHost() });
    await settle();
    expect(answerEl(container).textContent).toContain('Do this');
    expect(chips(container).map((c) => c.textContent)).toEqual(['1a.md › S', '2b.md › T']);
    expect(container.querySelector('.ai-chat-notes')!.textContent).toBe('answered from 1 of 2 sections, 1 left out');
    expect(container.querySelector('[data-fk="chat:insert"]')).not.toBeNull();
    expect(container.querySelector('[data-fk="chat:copy"]')).not.toBeNull();
    expect(container.querySelector('.ai-chat-route')!.textContent).toBe('m');
  });

  it('answered with sent sections and no citation says "No sources cited"', async () => {
    const { container } = await one(answered('Plain.', [sent(1, 'a.md', 's', 'S')]), { docs: docsHost() });
    await settle();
    expect(chips(container)).toHaveLength(0);
    expect(container.querySelector('.ai-chat-notes')!.textContent).toContain('No sources cited');
  });

  it('answered without any sources says so once, even if the coverage line already does', async () => {
    const outcome = answered('General knowledge.', []) as DocsTurnOutcome & { coverage: string };
    outcome.coverage = '';
    const a = await one(outcome, { docs: docsHost() });
    await settle();
    expect(a.container.querySelector('.ai-chat-notes')!.textContent).toBe('answered without sources');

    const again = answered('General knowledge.', []) as DocsTurnOutcome & { coverage: string };
    again.coverage = 'answered without sources: nothing matched';
    const b = await one(again, { docs: docsHost() });
    await settle();
    expect(b.container.querySelector('.ai-chat-notes')!.textContent).toBe('answered without sources: nothing matched');
  });

  it('baseLocalOnly names the base, says nothing was sent, and offers both actions', async () => {
    const openRouting = vi.fn();
    const openBases = vi.fn();
    const { container } = await one({ kind: 'baseLocalOnly', bases: [{ id: 'b', name: 'Runbooks' }], route: { engineId: 'claude', modelId: 'sonnet', isLocal: false } } as unknown as DocsTurnOutcome, {
      openRouting, openBases, engineName: (id) => (id === 'claude' ? 'Claude Cloud' : id),
    });
    const text = container.querySelector('.ai-chat-notice')!.textContent ?? '';
    expect(text).toContain('Base Runbooks is local-only');
    expect(text).toContain('Claude Cloud is a cloud engine, so nothing was sent.');
    expect(container.querySelector('[data-fk="chat:insert"]')).toBeNull();
    expect(container.querySelector('[data-fk="chat:copy"]')).toBeNull();
    click(container, 'chat:pick-local');
    click(container, 'chat:base-switch');
    expect(openRouting).toHaveBeenCalledOnce();
    expect(openBases).toHaveBeenCalledOnce();
  });

  it('baseLocalOnly without a route (a host that cannot say) and without the page actions', async () => {
    const { container } = await one({ kind: 'baseLocalOnly', bases: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], route: null } as unknown as DocsTurnOutcome);
    const text = container.querySelector('.ai-chat-notice')!.textContent ?? '';
    expect(text).toContain('Bases A and B are local-only');
    expect(text).toContain('This route may not stay on this machine, so nothing was sent.');
    expect(container.querySelector('.ai-chat-actions')).toBeNull();
  });

  it('names one, two and three bases', () => {
    expect(chatLocalOnlyTitle([{ name: 'A' }])).toBe('Base A is local-only');
    expect(chatLocalOnlyTitle([{ name: 'A' }, { name: 'B' }])).toBe('Bases A and B are local-only');
    expect(chatLocalOnlyTitle([{ name: 'A' }, { name: 'B' }, { name: 'C' }])).toBe('Bases A, B and C are local-only');
  });

  it('noActiveBases says so, offers the manager, and looks at the bases again', async () => {
    const openBases = vi.fn();
    const listBases = vi.fn(async () => [] as AiDocBaseStatus[]);
    const { container } = await one({ kind: 'noActiveBases' }, { docs: { listBases } as unknown as MikeDownDocsHost, openBases });
    const calls = listBases.mock.calls.length;
    expect(container.querySelector('.ai-chat-notice')!.textContent).toContain(AI_CHAT_NO_BASES);
    click(container, 'chat:manage-bases');
    expect(openBases).toHaveBeenCalledOnce();
    await settle();
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('questionHasSecret: nothing sent, the text returns to the box, and it is in no history or export', async () => {
    const saveTextFile = vi.fn(async () => {});
    const secret = `how do I use ${AWS_KEY}?`;
    const outcomes: DocsTurnOutcome[] = [answered('Fine.', []), { kind: 'questionHasSecret' }];
    const { container, input } = mount({ chat: fakeChat(async () => outcomes.shift()!), saveTextFile });
    await ask(input, 'a safe question');
    await ask(input, secret);
    expect(logText(container)).toContain('a safe question');
    expect(logText(container)).not.toContain(AWS_KEY);
    expect(container.querySelector('.ai-chat-notice')!.textContent).toContain(AI_CHAT_SECRET_NOTICE);
    expect(input.value).toBe(secret);
    expect(container.querySelectorAll('.ai-chat-question')).toHaveLength(1);

    click(container, 'chat:copy-all');
    await settle();
    click(container, 'chat:save');
    await settle();
    const copied = clipboard.mock.calls[0][0];
    const [, saved] = saveTextFile.mock.calls[0] as unknown as [string, string];
    for (const text of [copied, saved]) {
      expect(text).not.toContain(AWS_KEY);
      expect(text).toContain('a safe question');
      expect(text).toContain('(not kept: it looked like it held a key)');
    }
    expect(container.innerHTML).not.toContain(AWS_KEY);
  });

  it('questionHasSecret does not overwrite what the user typed meanwhile', async () => {
    let finish: (o: DocsTurnOutcome) => void = () => {};
    const { container, input } = mount({ chat: fakeChat(() => new Promise<DocsTurnOutcome>((r) => { finish = r; })) });
    await ask(input, `key ${AWS_KEY}`);
    input.value = 'a new draft';
    finish({ kind: 'questionHasSecret' });
    await settle();
    expect(input.value).toBe('a new draft');
    expect(container.innerHTML).not.toContain(AWS_KEY);
  });

  it('busy gives the notice and the question back', async () => {
    const { container, input } = await one({ kind: 'busy' });
    expect(container.querySelector('.ai-chat-notice')!.textContent).toContain(AI_CHAT_BUSY_NOTICE);
    expect(input.value).toBe('the question');
  });

  it('cancelled keeps what streamed and says Cancelled', async () => {
    let signal: AbortSignal | null = null;
    const chat = fakeChat((events: DocsTurnEvents, s) => {
      signal = s;
      events.onToken?.('Part', 'Partial answer so far');
      return new Promise(() => {});
    });
    const { container, input } = mount({ chat });
    await ask(input, 'q');
    await until(() => !!container.querySelector('.ai-chat-answer'));
    click(container, 'chat:cancel');
    expect(signal!.aborted).toBe(true);
    expect(answerEl(container).classList.contains('is-cancelled')).toBe(true);
    expect(answerEl(container).textContent).toBe('Partial answer so far');
    expect(container.querySelector('.ai-chat-note')!.textContent).toBe('Cancelled');
    expect(container.querySelector('[data-fk="chat:insert"]')).toBeNull();
  });

  it('error: an unknown error shows its own message, a coded one the standard copy naming the engine', async () => {
    const unknown = await one({ kind: 'error', error: { code: 'unknown', message: 'Something broke' } } as DocsTurnOutcome);
    expect(unknown.container.querySelector('.ai-chat-notice')!.textContent).toContain('Something broke');

    const outcomes: DocsTurnOutcome[] = [{ kind: 'error', error: makeAiError('unreachable', 'down') }];
    const openRouting = vi.fn();
    const { container, input } = mount({
      chat: fakeChat(async (events) => {
        events.onRoute?.({ engineId: 'omlx', modelId: 'qwen', isLocal: true, viaFallback: false, task: 'docs', needsConsent: false } as never, null);
        return outcomes.shift()!;
      }),
      engineName: () => 'oMLX',
      openRouting,
    });
    await ask(input, 'q');
    const expected = aiErrorCopy('unreachable', { engine: 'oMLX', model: 'qwen' }).message;
    expect(container.querySelector('.ai-chat-notice')!.textContent).toContain(expected);
    click(container, 'chat:engines');
    expect(openRouting).toHaveBeenCalledOnce();
  });

  it('error: a rejected run is an error outcome, not a crash', async () => {
    const { container, input } = mount({ chat: fakeChat(async () => { throw new Error('socket hang up'); }) });
    await ask(input, 'q');
    await settle();
    expect(container.querySelector('.ai-chat-notice')).not.toBeNull();
    expect(container.querySelector('[data-fk="chat:cancel"]')!.hasAttribute('hidden')).toBe(true);
    input.value = 'again';
    input.dispatchEvent(new Event('input'));
    expect(container.querySelector<HTMLButtonElement>('[data-fk="chat:send"]')!.disabled).toBe(false);
  });

  it('shows progress while it runs, and the answer replaces it', async () => {
    let finish: (o: DocsTurnOutcome) => void = () => {};
    const chat = fakeChat((events) => {
      events.onProgress?.({ phase: 'navigate', hop: 2, maxHops: 3, pages: 2 });
      return new Promise<DocsTurnOutcome>((r) => { finish = r; });
    });
    const { container, input } = mount({ chat });
    await ask(input, 'q');
    expect(container.querySelector('.ai-chat-progress')!.textContent).toBe('Reading 2 pages... hop 2 of 3');
    finish(answered('Done.', []));
    await settle();
    expect(container.querySelector('.ai-chat-progress')).toBeNull();
    expect(answerEl(container).textContent).toBe('Done.');
  });
});

// ── Chips ───────────────────────────────────────────────────────────────────

describe('citation chips', () => {
  const withOne = async (over: Parameters<typeof mount>[0] extends infer O ? Partial<O> : never = {}, section = sent(1, 'guides/a.md', 'key-rotation', 'Key rotation'), answer = 'Rotate [1].') => {
    const openFile = vi.fn();
    const page = mount({ chat: fakeChat(async () => answered(answer, [section])), docs: docsHost([status('b', '/kb/root', 'docs')]), openFile, ...(over as object) });
    await settle();
    await ask(page.input, 'q');
    await settle();
    return { ...page, openFile };
  };

  it('opens the file with the section to reveal', async () => {
    const { container, openFile } = await withOne();
    chips(container)[0].click();
    await settle();
    expect(openFile).toHaveBeenCalledOnce();
    expect(openFile).toHaveBeenCalledWith('file:///kb/root/guides/a.md', { section: 'key-rotation' });
  });

  it('a page-level citation (no heading) opens the file with no reveal', async () => {
    const page = sent(1, 'guides/a.md', 'x', 'X');
    page.section.id = 'docs/guides/a.md';
    delete (page.section as { heading?: string }).heading;
    const { container, openFile } = await withOne({}, page);
    chips(container)[0].click();
    await settle();
    expect(openFile).toHaveBeenCalledWith('file:///kb/root/guides/a.md', undefined);
    expect(chips(container)[0].textContent).toBe('1guides/a.md');
  });

  it('[1, 2] and a repeated [1] make a chip each, all opening what they name', async () => {
    const list = [sent(1, 'a.md', 'one', 'One'), sent(2, 'b.md', 'two', 'Two')];
    const openFile = vi.fn();
    const { container, input } = mount({ chat: fakeChat(async () => answered('Both [1, 2], and again [1].', list)), docs: docsHost(), openFile });
    await settle();
    await ask(input, 'q');
    expect(chips(container)).toHaveLength(3);
    for (const chip of chips(container)) {chip.click();}
    await settle();
    expect(openFile.mock.calls.map((c) => (c[1] as { section: string }).section)).toEqual(['one', 'two', 'one']);
  });

  it('shows the base and full path on hover, and a base that is gone only the relative path', async () => {
    let list = [status('b', '/kb/root/', 'docs')];
    const docs = { listBases: async () => list } as unknown as MikeDownDocsHost;
    const { container, input, handle } = mount({ chat: fakeChat(async () => answered('Rotate [1].', [sent(1, 'guides/a.md', 's', 'S')])), docs, openFile: vi.fn() });
    await settle();
    await ask(input, 'q');
    expect(chips(container)[0].title).toBe('B: /kb/root/guides/a.md');
    list = [];
    handle.refresh();
    await settle();
    expect(chips(container)[0].title).toBe('guides/a.md');
  });

  const chooseBases = (c: HTMLElement) => {
    const radio = c.querySelector<HTMLInputElement>('input[value="bases"]')!;
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
  };

  it('a chip whose base is no longer set up says so and opens nothing', async () => {
    // The panel remembers the bases it last saw, so a base removed after the answer still opens; one it never saw (the list was empty or failed) cannot.
    const docs = { listBases: async () => [] as AiDocBaseStatus[] } as unknown as MikeDownDocsHost;
    const openFile = vi.fn();
    const { container, input } = mount({ chat: fakeChat(async () => answered('Rotate [1].', [sent(1, 'a.md', 's', 'S')])), docs, openFile });
    await settle();
    chooseBases(container);
    await ask(input, 'q');
    expect(chips(container)).toHaveLength(1);
    expect(chips(container)[0].title).toBe('a.md');
    chips(container)[0].click();
    await settle();
    expect(openFile).not.toHaveBeenCalled();
    expect(statusText(container)).toBe('Could not open a.md: its base is no longer set up.');
  });

  it('a base that comes back is used on the next click', async () => {
    let list: AiDocBaseStatus[] = [];
    const docs = { listBases: async () => list } as unknown as MikeDownDocsHost;
    const openFile = vi.fn();
    const { container, input } = mount({ chat: fakeChat(async () => answered('Rotate [1].', [sent(1, 'a.md', 's', 'S')])), docs, openFile });
    await settle();
    chooseBases(container);
    await ask(input, 'q');
    list = [status('b', '/kb', 'docs')];
    chips(container)[0].click();
    await settle();
    expect(openFile).toHaveBeenCalledWith('file:///kb/a.md', { section: 's' });
  });

  it('builds the file URL from the base\'s own root: Windows drive and UNC roots too', async () => {
    const win = await withOne({ docs: docsHost([status('b', 'C:\\kb\\docs', 'docs')]) });
    chips(win.container)[0].click();
    await settle();
    expect(win.openFile.mock.calls[0][0]).toBe('file:///C:/kb/docs/guides/a.md');
    const unc = await withOne({ docs: docsHost([status('b', '\\\\srv\\share\\docs', 'docs')]) });
    chips(unc.container)[0].click();
    await settle();
    expect(unc.openFile.mock.calls[0][0]).toBe('file://srv/share/docs/guides/a.md');
  });

  it('only a host with openFile gets buttons; without it a chip only shows', async () => {
    const { container } = await withOne({ openFile: undefined });
    expect(container.querySelector('button.ai-chat-chip')).toBeNull();
    expect(chips(container)).toHaveLength(1);
    expect(chips(container)[0].tagName).toBe('SPAN');
    const withButton = await withOne();
    const button = withButton.container.querySelector('button.ai-chat-chip')!;
    expect(button.getAttribute('aria-label')).toBe('Open source 1: guides/a.md › Key rotation');
  });

  it('the target comes only from what was sent: a link or number the model wrote opens nothing else', async () => {
    const { container, openFile } = await withOne({}, undefined, 'See [1](file:///etc/passwd) and [open](javascript:alert(1)) and [1].');
    for (const chip of chips(container)) {chip.click();}
    await settle();
    for (const call of openFile.mock.calls) {expect(call[0]).toBe('file:///kb/root/guides/a.md');}
    expect(liveAttributes(answerEl(container))).toEqual([]);
  });

  it('an unknown [n] is dropped from the text and gets no chip', async () => {
    const { container } = await withOne({}, undefined, 'Real [1], invented [9], both [1, 7].');
    expect(chips(container)).toHaveLength(2);
    expect(answerEl(container).textContent).not.toMatch(/\[\s*[79]/);
    expect(answerEl(container).textContent).toContain('invented,');
  });

  it('[n] in code stays code, and a number in a link\'s target is not a citation', async () => {
    const { container } = await withOne({}, undefined, 'Use `list[1]` or\n\n```\nitems[1]\n```\n\nand [x][1] but cite [1].');
    expect(chips(container)).toHaveLength(1);
    expect(answerEl(container).querySelector('code')!.textContent).toBe('list[1]');
    expect(answerEl(container).textContent).toContain('items[1]');
  });

  it('a model-written chip marker cannot forge a chip or crash the panel', async () => {
    const forged = `A \uE0000\uE001 B \uE0009\uE001 C [1] D \uE000`;
    const { container } = await withOne({}, undefined, forged);
    expect(chips(container)).toHaveLength(1);
    expect(answerEl(container).textContent).not.toMatch(/[\uE000\uE001]/);
  });

  it('This document answers have no chips: markers are stripped from the text', async () => {
    const { container, input } = mount({ chat: fakeChat(async () => answered('The rate is 5 [1]. Also [2].', [sent(1, 'document.md', 's', 'S', 'document', 'document')])) });
    await ask(input, 'q');
    expect(chips(container)).toHaveLength(0);
    expect(answerEl(container).textContent).not.toMatch(/\[\d/);
    expect(container.querySelector('.ai-chat-notes')!.textContent).not.toContain('No sources cited');
  });
});

// ── Insert at cursor ────────────────────────────────────────────────────────

describe('Insert at cursor', () => {
  const list = () => [
    { ...sent(1, 'guides/a.md', 'key-rotation', 'Key rotation'), section: { ...sent(1, 'guides/a.md', 'key-rotation', 'Key rotation').section, text: 'Rotate keys. Docs: https://ok.example/keys and ![d](https://ok.example/d.png)' } },
    { ...sent(2, 'guides/b.md', 'audit', 'Audit'), section: { ...sent(2, 'guides/b.md', 'audit', 'Audit').section, text: 'Audit. See https://uncited.example/page' } },
  ];

  const insertWith = async (answer: string, over: Parameters<typeof mount>[0] extends infer O ? Partial<O> : never = {}) => {
    const insertAtCursor = vi.fn(() => true);
    const page = mount({
      chat: fakeChat(async () => answered(answer, list())),
      docs: docsHost([status('b', '/kb', 'docs')]),
      insertAtCursor,
      documentFolder: () => '/kb/notes',
      ...(over as object),
    });
    await settle();
    await ask(page.input, 'q');
    click(page.container, 'chat:insert');
    const used = page.opts.insertAtCursor as ReturnType<typeof vi.fn>;
    return { ...page, insertAtCursor: used, md: lastInsert(used) };
  };

  it('rewrites citations to relative links from the document\'s folder', async () => {
    const { md } = await insertWith('Rotate monthly [1], then audit [2].');
    expect(md).toBe('Rotate monthly [Key rotation](../guides/a.md#key-rotation), then audit [Audit](../guides/b.md#audit).');
  });

  it('a link or image to a URL the cited sections do not hold becomes text', async () => {
    const { md } = await insertWith('See [1]. ![chart](https://evil.example/c.png) and [docs](https://evil.example/x) and [x](https://uncited.example/page).');
    expect(md).not.toMatch(/!\[/);
    expect(md).not.toContain('](https://evil.example');
    // The URL is in a section that was sent but not cited, so it does not count.
    expect(md).not.toContain('](https://uncited.example');
    expect(md).toContain('[Key rotation](../guides/a.md#key-rotation)');
  });

  it('a URL that appears verbatim in a cited section stays a link, and so does a cited image', async () => {
    const { md } = await insertWith('Per [1], [keys](https://ok.example/keys) ![d](https://ok.example/d.png).');
    expect(md).toContain('[keys](https://ok.example/keys)');
    expect(md).toContain('![d](https://ok.example/d.png)');
  });

  it('raw HTML and script URLs do not reach the document as live markup', async () => {
    const { md } = await insertWith('Hi <img src=x onerror=alert(1)> <a href="https://evil.example">x</a> [y](javascript:alert(1)) <script>bad()</script> [1]');
    // The sanitizer escapes `<`, so it is text: no unescaped tag start.
    expect(md).not.toMatch(RAW_TAG);
    expect(md).not.toMatch(/\]\(javascript:/i);
    expect(md).not.toContain('](https://evil.example');
  });

  it('a heading with markup in the citation label is escaped, not live', async () => {
    const hostile = { ...sent(1, 'a.md', 'x', '<img src=x onerror=alert(1)> ![p](https://evil.example/p.png)'), baseId: 'b' };
    const insertAtCursor = vi.fn(() => true);
    const { container, input } = mount({
      chat: fakeChat(async () => answered('Yes [1].', [hostile])),
      docs: docsHost([status('b', '/kb', 'docs')]),
      insertAtCursor,
      documentFolder: () => '/kb',
    });
    await settle();
    await ask(input, 'q');
    click(container, 'chat:insert');
    const md = lastInsert(insertAtCursor);
    expect(md).not.toMatch(RAW_TAG);
    expect(md).not.toMatch(/(^|[^\\])!\[/);
    expect(md).not.toContain('](https://evil.example');
  });

  it('an untitled document, or one outside every root, gets "file › heading" text and no link', async () => {
    for (const folder of [null, '/elsewhere/notes']) {
      const { md } = await insertWith('Rotate [1].', { documentFolder: () => folder });
      expect(md).toBe('Rotate guides/a.md › Key rotation.');
    }
  });

  it('says Inserted, or says it could not when the editor refuses', async () => {
    const ok = await insertWith('Yes.');
    expect(statusText(ok.container)).toBe('Inserted');
    const refused = await insertWith('Yes.', { insertAtCursor: vi.fn(() => false) });
    expect(statusText(refused.container)).toBe('Could not insert here.');
  });

  it('only answered turns offer it, and a read-only editor does not', async () => {
    const { container, input } = mount({ chat: fakeChat(async () => answered('Yes.', [])), canInsert: () => false });
    await ask(input, 'q');
    expect(container.querySelector('[data-fk="chat:insert"]')).toBeNull();
    expect(container.querySelector('[data-fk="chat:copy"]')).not.toBeNull();
  });

  it('This document inserts the answer with its markers removed and its links defanged', async () => {
    const insertAtCursor = vi.fn(() => true);
    const { container, input } = mount({
      chat: fakeChat(async () => answered('Yes [1]. ![x](https://evil.example/i.png) [y](https://evil.example)', [sent(1, 'document.md', 's', 'S', 'document', 'document')])),
      insertAtCursor,
    });
    await ask(input, 'q');
    click(container, 'chat:insert');
    const md = lastInsert(insertAtCursor);
    expect(md).not.toMatch(/\[1\]|evil\.example|!\[/);
  });
});

// ── Cancel and history ──────────────────────────────────────────────────────

describe('cancel', () => {
  it('the Cancel button aborts the signal and returns to idle at once', async () => {
    let signal: AbortSignal | null = null;
    const { container, input } = mount({ chat: fakeChat((_e, s) => { signal = s; return new Promise(() => {}); }) });
    await ask(input, 'q');
    expect(signal!.aborted).toBe(false);
    expect(container.querySelector<HTMLElement>('[data-fk="chat:cancel"]')!.hidden).toBe(false);
    expect(container.querySelector<HTMLElement>('[data-fk="chat:send"]')!.hidden).toBe(true);
    click(container, 'chat:cancel');
    expect(signal!.aborted).toBe(true);
    expect(container.querySelector<HTMLElement>('[data-fk="chat:cancel"]')!.hidden).toBe(true);
    expect(container.querySelector<HTMLElement>('[data-fk="chat:send"]')!.hidden).toBe(false);
    expect(container.querySelector('.ai-chat-progress')).toBeNull();
  });

  it('a result that arrives after Cancel is ignored, and a new question works', async () => {
    let late: (o: DocsTurnOutcome) => void = () => {};
    const results: Array<() => Promise<DocsTurnOutcome>> = [
      () => new Promise<DocsTurnOutcome>((r) => { late = r; }),
      async () => answered('Second answer.', []),
    ];
    const { container, input } = mount({ chat: fakeChat(() => results.shift()!()) });
    await ask(input, 'first');
    click(container, 'chat:cancel');
    late(answered('LATE ANSWER', []));
    await settle();
    expect(logText(container)).not.toContain('LATE ANSWER');
    await ask(input, 'second');
    expect(logText(container)).toContain('Second answer.');
    expect(container.querySelectorAll('.ai-chat-turn')).toHaveLength(2);
  });

  it('tokens that arrive after Cancel are ignored', async () => {
    let events: DocsTurnEvents | null = null;
    const { container, input } = mount({ chat: fakeChat((e) => { events = e; return new Promise(() => {}); }) });
    await ask(input, 'q');
    click(container, 'chat:cancel');
    events!.onToken?.('x', 'LATE TOKENS');
    events!.onProgress?.({ phase: 'answer', maxHops: 3, pages: 1 });
    await wait(120);
    expect(logText(container)).not.toContain('LATE TOKENS');
    expect(container.querySelector('.ai-chat-progress')).toBeNull();
  });

  it('Esc cancels while running and goes back to the document when idle', async () => {
    const onEscape = vi.fn();
    let signal: AbortSignal | null = null;
    const outcomes = [() => Promise.resolve(answered('Done.', [])), (_s: AbortSignal) => new Promise<DocsTurnOutcome>(() => {})];
    const { container, input } = mount({ chat: fakeChat((_e, s) => { signal = s; return outcomes.shift()!(s); }), onEscape });
    await ask(input, 'one');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onEscape).toHaveBeenCalledOnce();
    await ask(input, 'two');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(signal!.aborted).toBe(true);
    expect(onEscape).toHaveBeenCalledOnce();
  });
});

describe('history', () => {
  it('keeps every turn in order while open and puts them all in Copy conversation', async () => {
    const outcomes = [answered('First [1].', [sent(1, 'a.md', 's', 'S')]), answered('Second.', [])];
    const { container, input } = mount({ chat: fakeChat(async () => outcomes.shift()!), docs: docsHost() });
    await settle();
    await ask(input, 'q one');
    await ask(input, 'q two');
    expect(Array.from(container.querySelectorAll('.ai-chat-question')).map((n) => n.textContent)).toEqual(['q one', 'q two']);
    click(container, 'chat:copy-all');
    await settle();
    const text = clipboard.mock.calls[0][0];
    expect(text).toContain('=== Turn 1 of 2 ===');
    expect(text).toContain('=== Turn 2 of 2 ===');
    expect(text.indexOf('q one')).toBeLessThan(text.indexOf('q two'));
    expect(text).toContain('[1] a.md › S');
    expect(text).toContain('Scope: Active bases');
  });

  it('destroy aborts what is running, empties the panel, and a late result renders nothing', async () => {
    let signal: AbortSignal | null = null;
    let late: (o: DocsTurnOutcome) => void = () => {};
    const { container, input, handle } = mount({ chat: fakeChat((_e, s) => { signal = s; return new Promise<DocsTurnOutcome>((r) => { late = r; }); }) });
    await ask(input, 'a private question');
    handle.destroy();
    expect(signal!.aborted).toBe(true);
    expect(container.childElementCount).toBe(0);
    late(answered('LATE', []));
    await settle();
    expect(container.childElementCount).toBe(0);
    expect(container.textContent).toBe('');
    handle.destroy();
    handle.refresh();
    expect(container.childElementCount).toBe(0);
  });

  it('a new mount starts empty: closing cleared the conversation', async () => {
    const outcomes = [answered('Old answer.', []), answered('New.', [])];
    const chat = fakeChat(async () => outcomes.shift()!);
    const first = mount({ chat });
    await ask(first.input, 'old question');
    first.handle.destroy();
    const second = mount({ chat });
    expect(second.container.querySelectorAll('.ai-chat-turn')).toHaveLength(0);
    expect(second.container.textContent).not.toContain('old question');
    expect(second.container.querySelector<HTMLElement>('[data-fk="chat:copy-all"]')!.hidden).toBe(true);
    await ask(second.input, 'new question');
    click(second.container, 'chat:copy-all');
    await settle();
    expect(clipboard.mock.calls[0][0]).not.toContain('old question');
  });

  it('the close button asks the host to close, and does not clear by itself', async () => {
    const onClose = vi.fn();
    const { container, input } = mount({ chat: fakeChat(async () => answered('Kept.', [])), onClose });
    await ask(input, 'q');
    click(container, 'chat:close');
    expect(onClose).toHaveBeenCalledOnce();
    expect(logText(container)).toContain('Kept.');
  });

  it('Save needs host.saveTextFile; a failed save says so', async () => {
    const none = mount({ chat: fakeChat(async () => answered('x', [])) });
    await ask(none.input, 'q');
    expect(none.container.querySelector('[data-fk="chat:save"]')).toBeNull();
    const saveTextFile = vi.fn(async () => { throw new Error('disk full'); });
    const { container, input } = mount({ chat: fakeChat(async () => answered('x', [])), saveTextFile });
    await ask(input, 'q');
    click(container, 'chat:save');
    await settle();
    expect(statusText(container)).toBe('Could not save.');
  });

  it('an export holds the text verbatim and each turn\'s scope', () => {
    const text = formatChatExport([
      { startedAt: 0, scope: 'document', status: 'answered', question: 'q', answer: 'a [1]', sources: ['[1] x.md'] },
      { startedAt: 0, scope: 'bases', status: 'not sent', question: null, notes: ['n'] },
    ]);
    expect(text).toContain('Scope: This document');
    expect(text).toContain('Scope: Active bases');
    expect(text).toContain('(not kept: it looked like it held a key)');
    expect(text.endsWith('\n')).toBe(true);
  });
});

// ── Hostile text ────────────────────────────────────────────────────────────

describe('model and page text is data', () => {
  const HOSTILE = [
    '<img src=x onerror=alert(1)>',
    '<script>alert(2)</script>',
    '<svg onload=alert(3)></svg>',
    '<a href="javascript:alert(4)">click</a>',
    '<iframe src="https://evil.example"></iframe>',
    '[link](javascript:alert(5))',
    '[ref][r]\n\n[r]: https://evil.example/ref',
    '![pic](https://evil.example/p.png)',
    '<https://evil.example/auto>',
    'https://evil.example/bare',
    '<div onclick="x()">d</div>',
    '<style>*{display:none}</style>',
  ].join('\n\n');

  it('the answer holds no element or attribute that can fetch, navigate or run', async () => {
    const list = [sent(1, 'a.md', 's', 'S')];
    const { container, input } = mount({ chat: fakeChat(async () => answered(`Fine [1].\n\n${HOSTILE}`, list)), docs: docsHost(), openFile: vi.fn() });
    await settle();
    await ask(input, 'q');
    const answer = answerEl(container);
    expect(answer.querySelectorAll(dangerousElements)).toHaveLength(0);
    expect(liveAttributes(answer)).toEqual([]);
    // It is all still there, as text.
    expect(answer.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(answer.textContent).toContain('<script>alert(2)</script>');
    expect(container.querySelector('script')).toBeNull();
    expect(document.querySelector('img, iframe')).toBeNull();
  });

  it('nor while it streams, nor after it is cancelled', async () => {
    let events: DocsTurnEvents | null = null;
    const { container, input } = mount({ chat: fakeChat((e) => { events = e; return new Promise(() => {}); }) });
    await ask(input, 'q');
    events!.onToken?.('x', HOSTILE);
    await until(() => !!container.querySelector('.ai-chat-answer'));
    expect(answerEl(container).querySelectorAll(dangerousElements)).toHaveLength(0);
    expect(liveAttributes(answerEl(container))).toEqual([]);
    click(container, 'chat:cancel');
    expect(answerEl(container).querySelectorAll(dangerousElements)).toHaveLength(0);
    expect(liveAttributes(answerEl(container))).toEqual([]);
  });

  it('a heading or file name with markup is text in the chip, its title and its label', async () => {
    const evil = '<img src=x onerror=alert(1)> & "quotes"';
    const { container, input } = mount({
      chat: fakeChat(async () => answered('See [1].', [sent(1, `${evil}.md`, 'x', evil)])),
      docs: docsHost([status('b', '/kb', 'docs')]),
      openFile: vi.fn(),
    });
    await settle();
    await ask(input, 'q');
    const chip = chips(container)[0];
    expect(chip.querySelector('img')).toBeNull();
    expect(chip.textContent).toContain(evil);
    expect(chip.title).toContain(evil);
    expect(chip.getAttribute('aria-label')).toContain(evil);
    expect(chip.querySelectorAll('*')).toHaveLength(2);
    expect(liveAttributes(chip)).toEqual([]);
    expect(container.querySelector('img')).toBeNull();
  });

  it('a base name with markup is text everywhere the panel shows it', async () => {
    const evil = '<img src=x onerror=alert(1)><b>Docs</b>';
    const list = [status('b', '/kb', 'docs', { base: { id: 'b', name: evil, roots: ['/kb'], enabled: true, allowCloud: false } })];
    const outcomes: DocsTurnOutcome[] = [
      answered('See [1].', [sent(1, 'a.md', 's', 'S')]),
      { kind: 'baseLocalOnly', bases: [{ id: 'b', name: evil }], route: null } as unknown as DocsTurnOutcome,
    ];
    const { container, input } = mount({ chat: fakeChat(async () => outcomes.shift()!), docs: docsHost(list), openFile: vi.fn(), openBases: vi.fn() });
    await settle();
    expect(container.querySelector('.ai-chat-bases')!.textContent).toBe(evil);
    await ask(input, 'q');
    expect(chips(container)[0].title).toBe(`${evil}: /kb/a.md`);
    await ask(input, 'again');
    expect(container.querySelector('.ai-chat-notice-title')!.textContent).toBe(`Base ${evil} is local-only`);
    expect(container.querySelector('img, b')).toBeNull();
    expect(liveAttributes(container.querySelector('.ai-chat-log')!)).toEqual([]);
  });

  it('a question with markup is shown as text', async () => {
    const q = '<img src=x onerror=alert(1)> hello';
    const { container, input } = mount({ chat: fakeChat(async () => answered('ok', [])) });
    await ask(input, q);
    expect(container.querySelector('.ai-chat-question')!.textContent).toBe(q);
    expect(container.querySelector('.ai-chat-question img')).toBeNull();
  });

  it('an error message with markup is text', async () => {
    const msg = '<img src=x onerror=alert(1)> failed';
    const { container, input } = mount({ chat: fakeChat(async () => ({ kind: 'error', error: { code: 'unknown', message: msg } }) as DocsTurnOutcome) });
    await ask(input, 'q');
    expect(container.querySelector('.ai-chat-notice img')).toBeNull();
    expect(container.querySelector('.ai-chat-notice')!.textContent).toContain(msg);
  });

  it('Insert output holds no live image and no foreign link', async () => {
    const insertAtCursor = vi.fn(() => true);
    const cited = sent(1, 'a.md', 's', 'S');
    cited.section.text = 'Allowed: https://ok.example/a';
    const { container, input } = mount({
      chat: fakeChat(async () => answered(`Yes [1].\n\n${HOSTILE}\n\n[ok](https://ok.example/a)`, [cited])),
      docs: docsHost(),
      insertAtCursor,
      documentFolder: () => '/kb',
    });
    await settle();
    await ask(input, 'q');
    click(container, 'chat:insert');
    const md = lastInsert(insertAtCursor);
    expect(md).not.toMatch(RAW_TAG);
    expect(md).not.toMatch(/(^|[^\\])!\[/);
    expect(md).not.toMatch(/\]\(javascript:/i);
    expect(md).not.toContain('evil.example/p.png');
    // Every remaining link target is the citation's own file or the one URL the cited section holds.
    const targets = Array.from(md.matchAll(/\]\(([^)\s]+)\)/g)).map((m) => m[1]);
    for (const target of targets) {expect(['a.md#s', 'https://ok.example/a']).toContain(target);}
    expect(md).not.toMatch(/\]\[|^\[r\]:/m);
    expect(md).not.toMatch(/<https?:/);
  });
});

// ── The real loop under the panel ───────────────────────────────────────────

describe('with the real loop and fake engine', () => {
  const SEC_BODIES: FakePage = { relPath: 'security.md', title: 'Security', headings: ['Key rotation', 'Audit'], bodies: { 'Key rotation': 'Rotate keys every 90 days.', Audit: 'Audit quarterly.' } };
  const OPS_BODIES: FakePage = { relPath: 'ops.md', title: 'Operations', headings: ['Backups'], bodies: { Backups: 'Back up nightly.' } };
  const HOME_PAGE: FakePage = {
    relPath: 'README.md',
    title: 'Handbook',
    headings: ['Start here'],
    links: [{ target: 'security.md', text: 'Security', kind: 'markdown' }, { target: 'ops.md', text: 'Operations', kind: 'markdown' }],
  };

  function loopPanel(script: Parameters<typeof fakeAi>[0], over: { settings?: Record<string, unknown>; bases?: Parameters<typeof fakeDocs>[0]; docsOptions?: Record<string, unknown>; panel?: Record<string, unknown> } = {}) {
    const { ai, calls } = fakeAi(script);
    const fake = fakeDocs(over.bases ?? [simple({ pages: [HOME_PAGE, SEC_BODIES, OPS_BODIES] })]);
    const chat = createAiDocsChat(ctxOf(ai, aiSettings(over.settings)));
    const openFile = vi.fn();
    const docs = fake.docs as unknown as MikeDownDocsHost;
    const page = mount({ chat, docs, openFile, docsOptions: () => over.docsOptions ?? { maxHops: 3 }, ...(over.panel as object), });
    return { ...page, calls, fake, openFile };
  }

  const progress = (c: HTMLElement) => c.querySelector('.ai-chat-progress')?.textContent ?? '';

  it('three hops, then the answer, with progress lines along the way and chips that open', async () => {
    let container: HTMLElement = document.body;
    const seen: string[] = [];
    const snap = (reply: string) => () => { seen.push(progress(container)); return reply; };
    const page = loopPanel([
      snap(nav(['docs/security.md#key-rotation'])),
      snap(nav(['docs/ops.md#backups'])),
      snap(nav(['docs/security.md#audit'])),
      snap(nav(['docs/security.md#audit'], true)),
    ]);
    container = page.container;
    await settle();
    await ask(page.input, 'how do keys rotate?');
    await until(() => !!container.querySelector('.ai-chat-answer'));
    const navCalls = page.calls.filter((c) => c.format === 'json');
    expect(navCalls).toHaveLength(3);
    expect(page.calls).toHaveLength(4);
    expect(seen[0]).toMatch(/hop 1 of 3/);
    expect(seen[1]).toMatch(/hop 2 of 3/);
    expect(seen[2]).toMatch(/hop 3 of 3/);
    expect(seen[1]).toMatch(/Reading 1 page/);
    expect(chips(container)).toHaveLength(1);
    expect(container.querySelector('.ai-chat-progress')).toBeNull();
    expect(container.querySelector('.ai-chat-notes')!.textContent).toContain('answered from 3 sections');
    chips(container)[0].click();
    await settle();
    expect(page.openFile).toHaveBeenCalledWith('file:///r/b/security.md', { section: 'key-rotation' });
  });

  it('a reply that is not JSON is repaired once, and the turn goes on with what it then reads', async () => {
    const page = loopPanel(['I would read the security page, probably.', nav(['docs/security.md#audit'], true)]);
    await settle();
    await ask(page.input, 'q');
    await until(() => !!page.container.querySelector('.ai-chat-answer'));
    expect(page.calls.filter((c) => c.format === 'json')).toHaveLength(2);
    expect(page.fake.reads).toEqual([{ baseId: 'b', ids: ['docs/security.md#audit'] }]);
    expect(page.container.querySelector('.ai-chat-notice')).toBeNull();
    expect(chips(page.container)).toHaveLength(1);
  });

  it('a reply that stays broken ends in an answer without sources, not an error', async () => {
    const page = loopPanel(['nonsense', 'still nonsense']);
    await settle();
    await ask(page.input, 'q');
    await until(() => !!page.container.querySelector('.ai-chat-answer'));
    expect(page.container.querySelector('.ai-chat-notice')).toBeNull();
    expect(page.container.querySelector('.ai-chat-notes')!.textContent ?? '').toMatch(/without sources|No sources cited/);
  });

  it('a section with a key is left out, the note says so, and the key is nowhere', async () => {
    const leaky: FakePage = { ...SEC_BODIES, bodies: { 'Key rotation': `The key is ${AWS_KEY}.`, Audit: 'Audit quarterly.' } };
    const saveTextFile = vi.fn(async () => {});
    const page = loopPanel(
      [nav(['docs/security.md#key-rotation', 'docs/security.md#audit'], true)],
      { bases: [simple({ pages: [HOME_PAGE, leaky, OPS_BODIES] })], panel: { saveTextFile } },
    );
    await settle();
    await ask(page.input, 'q');
    await until(() => !!page.container.querySelector('.ai-chat-answer'));
    expect(page.container.querySelector('.ai-chat-notes')!.textContent).toContain('1 section left out: looks like it contains a key');
    expect(chips(page.container)[0].textContent).toContain('Audit');
    click(page.container, 'chat:copy-all');
    click(page.container, 'chat:save');
    await settle();
    const everything = [
      page.calls.map((c) => JSON.stringify(c.messages)).join('\n'),
      page.container.innerHTML,
      page.container.textContent ?? '',
      clipboard.mock.calls.map((c) => c[0]).join('\n'),
      (saveTextFile.mock.calls[0] as unknown as [string, string])[1],
    ].join('\n');
    expect(everything).not.toContain(AWS_KEY);
  });

  it('a question with a key sends nothing and is not kept', async () => {
    const page = loopPanel([nav([], true)]);
    await settle();
    await ask(page.input, `use ${AWS_KEY} please`);
    await until(() => !!page.container.querySelector('.ai-chat-notice'));
    expect(page.calls).toHaveLength(0);
    expect(page.fake.reads).toEqual([]);
    expect(page.container.querySelector('.ai-chat-notice')!.textContent).toContain(AI_CHAT_SECRET_NOTICE);
    expect(page.container.querySelector('.ai-chat-question')).toBeNull();
    expect(page.input.value).toContain(AWS_KEY);
  });

  it('a cloud route with a local-only base: the local-only notice, nothing read or sent', async () => {
    const openRouting = vi.fn();
    const openBases = vi.fn();
    const page = loopPanel([nav([], true)], {
      settings: toCloud(),
      bases: [simple({ name: 'Secret handbook' })],
      panel: { openRouting, openBases, engineName: (id: string) => (id === 'claude' ? 'Cloud' : id) },
    });
    await settle();
    await ask(page.input, 'q');
    await until(() => !!page.container.querySelector('.ai-chat-notice'));
    expect(page.container.querySelector('.ai-chat-notice-title')!.textContent).toBe('Base Secret handbook is local-only');
    expect(page.container.querySelector('.ai-chat-notice')!.textContent).toContain('Cloud is a cloud engine, so nothing was sent.');
    expect(page.calls).toHaveLength(0);
    expect(page.fake.reads).toEqual([]);
    expect(page.fake.indexed).toEqual([]);
    click(page.container, 'chat:pick-local');
    click(page.container, 'chat:base-switch');
    expect(openRouting).toHaveBeenCalledOnce();
    expect(openBases).toHaveBeenCalledOnce();
  });

  it('the same cloud route is fine for a base that allows it, and for This document', async () => {
    const cloudOk = loopPanel([nav([], true)], { settings: toCloud(), bases: [simple({ allowCloud: true })] });
    await settle();
    await ask(cloudOk.input, 'q');
    await until(() => !!cloudOk.container.querySelector('.ai-chat-answer'));
    expect(cloudOk.container.querySelector('.ai-chat-notice')).toBeNull();

    const doc = loopPanel([nav([], true)], { settings: toCloud(), bases: [simple()], panel: { documentText: () => '# Title\n\nSome words.\n' } });
    doc.container.querySelector<HTMLInputElement>('input[value="document"]')!.checked = true;
    doc.container.querySelector<HTMLInputElement>('input[value="document"]')!.dispatchEvent(new Event('change'));
    await ask(doc.input, 'q');
    await until(() => !!doc.container.querySelector('.ai-chat-answer'));
    expect(doc.container.querySelector('.ai-chat-notice')).toBeNull();
    expect(doc.fake.listBases).not.toHaveBeenCalledTimes(99);
  });

  it('every base off: no active bases, and nothing sent', async () => {
    const page = loopPanel([nav([], true)], { bases: [simple({ enabled: false })] });
    await settle();
    page.container.querySelector<HTMLInputElement>('input[value="bases"]')!.checked = true;
    page.container.querySelector<HTMLInputElement>('input[value="bases"]')!.dispatchEvent(new Event('change'));
    await ask(page.input, 'q');
    await until(() => !!page.container.querySelector('.ai-chat-notice'));
    expect(page.container.querySelector('.ai-chat-notice')!.textContent).toContain(AI_CHAT_NO_BASES);
    expect(page.calls).toHaveLength(0);
  });

  it('This document through the loop: no chips, the markers stripped, no sources note', async () => {
    const page = loopPanel([nav([], true)], { bases: [], panel: { documentText: () => '# T\n\n## Keys\n\nThe key rotates monthly.\n' } });
    await ask(page.input, 'how often?');
    await until(() => !!page.container.querySelector('.ai-chat-answer'));
    expect(chips(page.container)).toHaveLength(0);
    expect(answerEl(page.container).textContent).toBe('the answer');
    expect(page.container.querySelector('.ai-chat-notes')?.textContent ?? '').not.toContain('No sources cited');
    expect(page.calls.map((c) => c.task)).toEqual(['chat', 'chat']);
  });

  it('Cancel mid-hop aborts the engine\'s signal and leaves no answer', async () => {
    let engineSignal: AbortSignal | undefined;
    const { ai } = fakeAi([nav([], true)]);
    const hanging = { ...ai, complete: (req: Parameters<typeof ai.complete>[0], onToken: Parameters<typeof ai.complete>[1], signal?: AbortSignal) => {
      engineSignal = signal;
      return new Promise<never>(() => {});
    } } as typeof ai;
    const fake = fakeDocs([simple()]);
    const chat = createAiDocsChat(ctxOf(hanging, aiSettings()));
    const page = mount({ chat, docs: fake.docs as unknown as MikeDownDocsHost, docsOptions: () => ({ maxHops: 3 }) });
    await settle();
    await ask(page.input, 'q');
    await until(() => engineSignal !== undefined);
    click(page.container, 'chat:cancel');
    await settle();
    expect(engineSignal!.aborted).toBe(true);
    expect(page.container.querySelector('.ai-chat-note')!.textContent).toBe('Cancelled');
    expect(page.container.querySelector('.ai-chat-answer')).toBeNull();
  });
});
