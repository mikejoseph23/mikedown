/** Fakes shared by the chat panel's tests: a fake `DocsChat`, base statuses, sent sections and a mounted panel. */
import { vi } from 'vitest';
import { parseCitations, type AiDocBaseStatus, type DocsChat, type DocsSentSection, type DocsTurnEvents, type DocsTurnOutcome } from '../../src/ai';
import { mountAiChatPanel, type AiChatPanelOptions } from '../../src/ai-chat-panel';

export const status = (id: string, root: string, label: string, over: Partial<AiDocBaseStatus> = {}): AiDocBaseStatus => ({
  base: { id, name: id.toUpperCase(), roots: [root], enabled: true, allowCloud: false },
  active: true,
  roots: [{ root, label, found: true, fileCount: 1, oversizeSkipped: 0, capReached: false }],
  fileCount: 1,
  oversizeSkipped: 0,
  rootsMissing: 0,
  capReached: false,
  ...over,
} as AiDocBaseStatus);

export const sent = (n: number, relPath: string, slug: string, heading: string, baseId = 'b', root = 'docs', text = 'see https://ok.example/x'): DocsSentSection => ({
  n,
  baseId,
  section: { id: `${root}/${relPath}#${slug}`, pageId: `${root}/${relPath}`, title: relPath, relPath, heading, text, truncated: false },
});

export function answered(answer: string, list: DocsSentSection[]): DocsTurnOutcome {
  const citations = parseCitations(answer, list.map((s) => s.n));
  return {
    kind: 'answered', answer: citations.text, citations, sent: list, coverage: 'answered from 1 of 2 sections, 1 left out',
    withoutSources: list.length === 0, noSources: list.length > 0 && citations.noSources, hops: 1, droppedCount: 0, secretsLeftOut: 0, entriesLeftOut: 0,
    run: { result: { text: answer }, route: { engineId: 'e', modelId: 'm', isLocal: true, viaFallback: false, task: 'docs', needsConsent: false }, viaFallback: false, thinking: null, requestId: 'req1' },
  } as unknown as DocsTurnOutcome;
}

export function fakeChat(run: (events: DocsTurnEvents, signal: AbortSignal) => Promise<DocsTurnOutcome>): DocsChat & { input: unknown } {
  const chat = { busy: false, input: null as unknown, run: (input: unknown, events: DocsTurnEvents, signal: AbortSignal) => { chat.input = input; return run(events, signal); } };
  return chat as unknown as DocsChat & { input: unknown };
}

const mounted: Array<{ destroy(): void }> = [];
/** Call from `afterEach`: destroys every mounted panel and empties the body. */
export function unmountPanels(): void {
  while (mounted.length) {mounted.pop()!.destroy();}
  document.body.replaceChildren();
}

export function mount(over: Partial<AiChatPanelOptions> & Pick<AiChatPanelOptions, 'chat'>) {
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

export async function ask(input: HTMLTextAreaElement, text: string): Promise<void> {
  input.value = text;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
}

export const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

