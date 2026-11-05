/** The chat panel's wiring end to end with a fake chat; M10 owns the thorough tests. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { docsDocumentLocation, docsFileHref, docsHeadingAt, parseCitations, type AiDocBaseStatus, type DocsChat, type DocsSentSection, type DocsTurnEvents, type DocsTurnOutcome } from '../src/ai';
import { chatProgressLine, formatChatExport, mountAiChatPanel, type AiChatPanelOptions } from '../src/ai-chat-panel';

const status = (id: string, root: string, label: string, over: Partial<AiDocBaseStatus> = {}): AiDocBaseStatus => ({
  base: { id, name: id.toUpperCase(), roots: [root], enabled: true, allowCloud: false },
  active: true,
  roots: [{ root, label, found: true, fileCount: 1, oversizeSkipped: 0, capReached: false }],
  fileCount: 1,
  oversizeSkipped: 0,
  rootsMissing: 0,
  capReached: false,
  ...over,
} as AiDocBaseStatus);

const sent = (n: number, relPath: string, slug: string, heading: string, baseId = 'b', root = 'docs', text = 'see https://ok.example/x'): DocsSentSection => ({
  n,
  baseId,
  section: { id: `${root}/${relPath}#${slug}`, pageId: `${root}/${relPath}`, title: relPath, relPath, heading, text, truncated: false },
});

function answered(answer: string, list: DocsSentSection[]): DocsTurnOutcome {
  const citations = parseCitations(answer, list.map((s) => s.n));
  return {
    kind: 'answered', answer: citations.text, citations, sent: list, coverage: 'answered from 1 of 2 sections, 1 left out',
    withoutSources: list.length === 0, noSources: list.length > 0 && citations.noSources, hops: 1, droppedCount: 0, secretsLeftOut: 0, entriesLeftOut: 0,
    run: { result: { text: answer }, route: { engineId: 'e', modelId: 'm', isLocal: true, viaFallback: false, task: 'docs', needsConsent: false }, viaFallback: false, thinking: null, requestId: 'req1' },
  } as unknown as DocsTurnOutcome;
}

function fakeChat(run: (events: DocsTurnEvents, signal: AbortSignal) => Promise<DocsTurnOutcome>): DocsChat & { input: unknown } {
  const chat = { busy: false, input: null as unknown, run: (input: unknown, events: DocsTurnEvents, signal: AbortSignal) => { chat.input = input; return run(events, signal); } };
  return chat as unknown as DocsChat & { input: unknown };
}

const mounted: Array<{ destroy(): void }> = [];
afterEach(() => {
  while (mounted.length) {mounted.pop()!.destroy();}
  document.body.replaceChildren();
});

function mount(over: Partial<AiChatPanelOptions> & Pick<AiChatPanelOptions, 'chat'>) {
  const container = document.createElement('div');
  document.body.append(container);
  const opts: AiChatPanelOptions = {
    documentText: () => '# Doc',
    featureOffNotice: () => null,
    canInsert: () => true,
    insertAtCursor: vi.fn(() => true),
    onClose: () => {},
    ...over,
  };
  const handle = mountAiChatPanel(container, opts);
  mounted.push(handle);
  return { container, handle, opts, input: container.querySelector('textarea')! };
}

async function ask(input: HTMLTextAreaElement, text: string): Promise<void> {
  input.value = text;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('chat panel', () => {
  it('This document by default without host.docs; the picker is hidden; Shift+Enter does not send', async () => {
    const chat = fakeChat(async () => answered('Plain answer.', []));
    const { container, input } = mount({ chat });
    expect(container.querySelector<HTMLElement>('.ai-chat-scope')!.hidden).toBe(true);
    input.value = 'x';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    expect(chat.input).toBeNull();
    await ask(input, 'What?');
    expect((chat.input as { scope: { kind: string; text: string } }).scope).toMatchObject({ kind: 'document', text: '# Doc' });
  });

  it('defaults to Active bases when one is active, and This document when none is', async () => {
    const docs = { listBases: async () => [status('b', '/kb', 'docs')] } as never;
    const a = mount({ chat: fakeChat(async () => answered('x', [])), docs });
    await settle();
    expect(a.container.querySelector<HTMLInputElement>('input[value="bases"]')!.checked).toBe(true);
    const none = { listBases: async () => [status('b', '/kb', 'docs', { active: false })] } as never;
    const b = mount({ chat: fakeChat(async () => answered('x', [])), docs: none });
    await settle();
    expect(b.container.querySelector<HTMLInputElement>('input[value="document"]')!.checked).toBe(true);
  });

  it('renders untrusted text inert, chips only for sent sections, none inside code, and opens a chip outside the folder', async () => {
    const list = [sent(1, 'guides/a b.md', 'key-rotation', 'Key rotation')];
    const chat = fakeChat(async () => answered('Do it [1] and `[1]` <img src=x onerror=y> [x](https://evil.example) [9].', list));
    const openFile = vi.fn();
    const docs = { listBases: async () => [status('b', '/kb/root', 'docs')] } as never;
    const { container, input } = mount({ chat, docs, openFile });
    await settle();
    await ask(input, 'q');
    const answer = container.querySelector('.ai-chat-answer')!;
    expect(answer.querySelectorAll('.ai-chat-chip')).toHaveLength(1);
    expect(answer.querySelector('code')!.textContent).toBe('[1]');
    expect(answer.querySelector('img, a, [href], [src]')).toBeNull();
    const chip = answer.querySelector<HTMLButtonElement>('.ai-chat-chip')!;
    expect(chip.textContent).toContain('guides/a b.md › Key rotation');
    expect(chip.title).toBe('B: /kb/root/guides/a b.md');
    chip.click();
    await settle();
    expect(openFile).toHaveBeenCalledWith('file:///kb/root/guides/a%20b.md', { section: 'key-rotation' });
    expect(container.querySelector('.ai-chat-notes')!.textContent).toContain('answered from 1 of 2 sections');
  });

  it('Insert rewrites citations relative to the document and drops a model link', async () => {
    const list = [sent(1, 'guides/a.md', 'key-rotation', 'Key rotation')];
    const insertAtCursor = vi.fn(() => true);
    const docs = { listBases: async () => [status('b', '/kb', 'docs')] } as never;
    const { container, input } = mount({
      chat: fakeChat(async () => answered('Rotate [1]. [bad](https://evil.example/x) ![i](https://evil.example/i.png)', list)),
      docs, insertAtCursor, documentFolder: () => '/kb/other',
    });
    await settle();
    await ask(input, 'q');
    container.querySelector<HTMLButtonElement>('[data-fk="chat:insert"]')!.click();
    const md = (insertAtCursor.mock.calls[0] as unknown as [string])[0];
    expect(md).toContain('[Key rotation](../guides/a.md#key-rotation)');
    expect(md).not.toContain('evil.example');
  });

  it('Insert falls back to file › heading text without a document folder; read-only has no Insert', async () => {
    const list = [sent(1, 'a.md', 's', 'S')];
    const insertAtCursor = vi.fn(() => true);
    const docs = { listBases: async () => [status('b', '/kb', 'docs')] } as never;
    const one = mount({ chat: fakeChat(async () => answered('A [1].', list)), docs, insertAtCursor, documentFolder: () => null });
    await settle();
    await ask(one.input, 'q');
    one.container.querySelector<HTMLButtonElement>('[data-fk="chat:insert"]')!.click();
    expect((insertAtCursor.mock.calls[0] as unknown as [string])[0]).toBe('A a.md › S.');
    const two = mount({ chat: fakeChat(async () => answered('A [1].', list)), docs, canInsert: () => false });
    await settle();
    await ask(two.input, 'q');
    expect(two.container.querySelector('[data-fk="chat:insert"]')).toBeNull();
  });

  it('This document answers show no citations and no "No sources cited"; Insert still sanitizes', async () => {
    const list = [sent(1, 'document.md', 's', 'S', 'document', 'document')];
    const insertAtCursor = vi.fn(() => true);
    const { container, input } = mount({ chat: fakeChat(async () => answered('Yes [1]. [x](https://evil.example)', list)), insertAtCursor });
    await ask(input, 'q');
    expect(container.querySelector('.ai-chat-chip')).toBeNull();
    expect(container.querySelector('.ai-chat-answer')!.textContent).toBe('Yes. x');
    container.querySelector<HTMLButtonElement>('[data-fk="chat:insert"]')!.click();
    expect((insertAtCursor.mock.calls[0] as unknown as [string])[0]).toBe('Yes. x');
  });

  it('shows every other outcome, and a question with a key is not kept', async () => {
    const openRouting = vi.fn();
    const openBases = vi.fn();
    const outcomes: DocsTurnOutcome[] = [
      { kind: 'baseLocalOnly', bases: [{ id: 'b', name: 'Runbooks' }], route: null },
      { kind: 'noActiveBases' },
      { kind: 'error', error: { code: 'unknown', message: 'Broke' } } as DocsTurnOutcome,
      { kind: 'questionHasSecret' },
      { kind: 'busy' },
    ];
    const { container, input, handle } = mount({ chat: fakeChat(async () => outcomes.shift()!), openRouting, openBases });
    await ask(input, 'one');
    expect(container.textContent).toContain('Base Runbooks is local-only');
    container.querySelector<HTMLButtonElement>('[data-fk="chat:pick-local"]')!.click();
    container.querySelector<HTMLButtonElement>('[data-fk="chat:base-switch"]')!.click();
    expect(openRouting).toHaveBeenCalledOnce();
    expect(openBases).toHaveBeenCalledOnce();
    await ask(input, 'two');
    expect(container.textContent).toContain('No documentation base is active');
    await ask(input, 'three');
    expect(container.textContent).toContain('Broke');
    await ask(input, 'AKIAKEYTEXT');
    expect(container.querySelector('.ai-chat-log')!.textContent).toContain('holds a key');
    expect(container.querySelector('.ai-chat-log')!.textContent).not.toContain('AKIAKEYTEXT');
    expect(input.value).toBe('AKIAKEYTEXT');
    await ask(input, 'five');
    expect(input.value).toBe('five');
    handle.refresh();
    expect(container.querySelector('.ai-chat-log')!.textContent).not.toContain('AKIAKEYTEXT');
  });

  it('Esc cancels, keeps history and returns to idle; destroy aborts and clears', async () => {
    let signal: AbortSignal | null = null;
    let next: DocsTurnOutcome | null = answered('First.', []);
    const chat = fakeChat((_events, s) => {
      if (next) {const out = next; next = null; return Promise.resolve(out);}
      signal = s;
      return new Promise(() => {});
    });
    const { container, input, handle } = mount({ chat });
    await ask(input, 'first');
    await ask(input, 'second');
    expect(container.querySelector<HTMLElement>('[data-fk="chat:cancel"]')!.hidden).toBe(false);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(signal!.aborted).toBe(true);
    expect(container.querySelector<HTMLElement>('[data-fk="chat:cancel"]')!.hidden).toBe(true);
    expect(container.textContent).toContain('First.');
    expect(container.textContent).toContain('Cancelled');
    await ask(input, 'third');
    handle.destroy();
    expect(signal!.aborted).toBe(true);
    expect(container.childElementCount).toBe(0);
  });

  it('the feature switch blocks input; Activity link only while it records; export has the turn', async () => {
    let on = false;
    const openActivity = vi.fn();
    const saveTextFile = vi.fn(async () => {});
    let off: string | null = 'Chat is turned off in the AI settings.';
    const { container, input, handle } = mount({
      chat: fakeChat(async () => answered('Answer [1].', [sent(1, 'a.md', 's', 'S')])),
      docs: { listBases: async () => [status('b', '/kb', 'docs')] } as never,
      featureOffNotice: () => off,
      activityOn: () => on,
      openActivity,
      saveTextFile,
    });
    expect(container.textContent).toContain('Chat is turned off');
    expect(input.disabled).toBe(true);
    off = null;
    handle.refresh();
    await settle();
    await ask(input, 'q');
    expect(container.querySelector('[data-fk="chat:activity"]')).toBeNull();
    on = true;
    handle.refresh();
    container.querySelector<HTMLButtonElement>('[data-fk="chat:activity"]')!.click();
    expect(openActivity).toHaveBeenCalledWith('req1');
    container.querySelector<HTMLButtonElement>('[data-fk="chat:save"]')!.click();
    const [name, text] = saveTextFile.mock.calls[0] as unknown as [string, string];
    expect(name).toMatch(/^mikedown-ai-chat-\d{8}-\d{4}\.txt$/);
    expect(text).toContain('=== Turn 1 of 1 ===');
    expect(text).toContain('[1] a.md › S');
  });

  it('progress line and export', () => {
    expect(chatProgressLine({ phase: 'navigate', hop: 2, maxHops: 3, pages: 2 }, 'bases')).toBe('Reading 2 pages... hop 2 of 3');
    expect(formatChatExport([])).toBe('');
  });
});

describe('chip targets and locations', () => {
  it('builds a file: URL for POSIX, drive and UNC roots', () => {
    expect(docsFileHref('/kb/my docs/', 'a#b/c?.md')).toBe('file:///kb/my%20docs/a%23b/c%3F.md');
    expect(docsFileHref('C:\\kb\\docs', 'a.md')).toBe('file:///C:/kb/docs/a.md');
    expect(docsFileHref('\\\\srv\\share\\docs', 'a.md')).toBe('file://srv/share/docs/a.md');
  });

  it('places a folder under a root by whole components, and not an untitled one', () => {
    const list = [status('a', '/kb/docs', 'docs'), status('b', '/other/docs', 'docs')];
    expect(docsDocumentLocation('/kb/docs/x/y', list)).toEqual({ baseId: 'a', root: 'docs', folder: 'x/y' });
    expect(docsDocumentLocation('/other/docs', list)).toEqual({ baseId: 'b', root: 'docs', folder: '' });
    expect(docsDocumentLocation('/kb/docs-evil', list)).toBeNull();
    expect(docsDocumentLocation('.', list)).toBeNull();
    expect(docsDocumentLocation(null, list)).toBeNull();
  });

  it('finds a heading by the documentation slug, where GitHub anchors differ', () => {
    const md = '---\ntitle: x\n---\n# Résumé\n\n## Setup\n\n## Setup\n\n## Setup 1\n';
    expect(docsHeadingAt(md, 'résumé')?.index).toBe(0);
    expect(docsHeadingAt(md, 'setup-1')?.index).toBe(2);
    expect(docsHeadingAt(md, 'setup-1-1')?.index).toBe(3);
    expect(docsHeadingAt(md, 'nope')).toBeNull();
    expect(md.slice(docsHeadingAt(md, 'résumé')!.offset)).toMatch(/^# Résumé/);
  });
});

describe('the editor wiring', () => {
  it('aiChat opens the panel docked in the root; off shows the notice instead; destroy removes it', async () => {
    const { createMikeDownEditor, NoopHost } = await import('../src/index');
    const { parseAiSettings } = await import('../src/ai');
    const { hideToolbarDropdown } = await import('../src/toolbar-dropdown');
    class Host extends NoopHost { ai = { complete: vi.fn(), listEngines: vi.fn(async () => []) } as never; }
    const el = document.createElement('div');
    document.body.append(el);
    const quiet = { onWarning: () => {} };
    const handle = createMikeDownEditor(el, { host: new Host(), settings: { ai: parseAiSettings({ enabled: true, features: { chat: { enabled: false } } }, quiet) } });
    await new Promise((r) => setTimeout(r, 0));
    handle.command('aiChat');
    expect(el.querySelector('.ai-chat')).toBeNull();
    expect(el.textContent).toContain('Chat is turned off in the AI settings.');
    handle.updateSettings({ ai: parseAiSettings({ enabled: true }, quiet) });
    handle.command('aiChat');
    expect(el.querySelector('.mikedown-root > .ai-chat-dock .ai-chat')).not.toBeNull();
    handle.destroy();
    expect(document.querySelector('.ai-chat')).toBeNull();
    hideToolbarDropdown();
  });
});
