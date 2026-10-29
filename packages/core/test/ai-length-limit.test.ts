/**
 * Answers that stop at the token limit (T3 F2b, F3): the summary drops a cut
 * fragment, the popover and the Properties row say the answer was cut off,
 * and an empty answer at the limit says why (thinking used the budget).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
import { aiLengthLimitCopy, finalizeSummary } from '../src/ai';
import type { AiCompletionRequest, AiCompletionResult, MikeDownAiHost } from '../src/ai';
import { aiRunThinkingOn } from '../src/ai-request';
import { clearSessionThinking } from '../src/ai-prefs';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

describe('finalizeSummary at the length limit', () => {
  it('drops a cut #tag so it cannot become a tag, and marks the cut', () => {
    const out = finalizeSummary('The pilot runs four days a week. #pl', 'tldr', 1, true);
    expect(out).not.toContain('#pl');
    expect(out).toContain('> The pilot runs four days a week. …');
  });

  it('drops a cut word, keeps an answer that ended on punctuation, and leaves a finished answer alone', () => {
    expect(finalizeSummary('We ship in May and docs fol', 'outline', 1, true)).toBe('We ship in May and docs…');
    expect(finalizeSummary('We ship in May.', 'outline', 1, true)).toBe('We ship in May. …');
    expect(finalizeSummary('We ship in May and docs fol', 'outline')).toBe('We ship in May and docs fol');
  });

  it('a list item left with only its marker goes', () => {
    expect(finalizeSummary('- Ship in May.\n- Docs', 'outline', 1, true)).toBe('- Ship in May. …');
    expect(finalizeSummary('#pl', 'tldr', 1, true)).toBe('');
  });
});

describe('length-limit copy', () => {
  it('names Thinking only when the model was thinking', () => {
    expect(aiLengthLimitCopy({ thinking: true, empty: true }).message).toMatch(/thinking.*Lower Thinking, or Retry/);
    expect(aiLengthLimitCopy({ thinking: false, empty: true }).message).not.toMatch(/Thinking/);
    expect(aiLengthLimitCopy({ thinking: true, empty: false }).message).toMatch(/cut off.*Lower Thinking/);
    expect(aiLengthLimitCopy({ thinking: false, empty: false }).message).toBe('The answer was cut off at the length limit.');
  });

  it('thinking is on for model default and any tier, off for Off or no mapping', () => {
    expect(aiRunThinkingOn(null)).toBe(false);
    expect(aiRunThinkingOn({ kind: 'openai-compatible', configured: null, sent: null })).toBe(true);
    expect(aiRunThinkingOn({ kind: 'openai-compatible', configured: 'off', sent: null })).toBe(false);
    expect(aiRunThinkingOn({ kind: 'openai-compatible', configured: 'off', sent: 'high' })).toBe(true);
    expect(aiRunThinkingOn({ kind: 'openai-compatible', configured: 'high', sent: 'off' })).toBe(false);
  });
});

// ── In the editor ───────────────────────────────────────────────────────────

const CHAT = { chat: true, stream: true, vision: false, json: false, tools: false, fim: false, embed: false, contextTokens: 32768 };
const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 10));
  clearSessionThinking();
  for (const { handle, el } of mounted.splice(0)) {
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  document.querySelectorAll('.mikedown-ai-rewrite').forEach((n) => n.remove());
});

type Reply = { text: string; finish: AiCompletionResult['finishReason'] };

/** A tier-2 host on a local openai-compatible engine (a kind with thinking levels). */
function mount(markdown: string, reply: Reply | ((req: AiCompletionRequest) => Reply), modelOverrides?: Record<string, unknown>) {
  const requests: AiCompletionRequest[] = [];
  class AiHost extends NoopHost {
    ai: MikeDownAiHost = {
      complete: async (req, onToken): Promise<AiCompletionResult> => {
        requests.push(req);
        const r = typeof reply === 'function' ? reply(req) : reply;
        if (r.text) {onToken(r.text);}
        return { text: r.text, served: { engineId: 'e', engineName: 'oMLX', modelId: 'qwen', isLocal: true }, finishReason: r.finish };
      },
      listEngines: async () => [],
    };
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ai = {
    enabled: true,
    engines: [{ id: 'e', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', models: [{ id: 'qwen', capabilities: CHAT, capabilitiesSource: 'user', ...(modelOverrides ? { requestOverrides: modelOverrides } : {}) }] }],
    routing: { default: { engineId: 'e', modelId: 'qwen' }, fallback: 'none', tasks: {} },
  };
  const handle = createMikeDownEditor(el, { host: new AiHost(), initialMarkdown: markdown, hostOwnsShortcuts: true, features: { sidebar: true }, settings: { ai } as never });
  mounted.push({ handle, el });
  return { el, handle, requests };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) {await new Promise((r) => setTimeout(r, 0));}
};
const popover = () => document.querySelector<HTMLElement>('.mikedown-ai-rewrite');
const buttons = () => [...(popover()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].filter((b) => !b.hidden && !b.closest('[hidden]'));
const hasButton = (label: string) => buttons().some((b) => b.textContent === label);
const errorMessage = () => popover()?.querySelector('.ai-rw-error-message')?.textContent ?? '';
const note = () => popover()?.querySelector('.ai-rw-note')?.textContent ?? '';

async function rewriteShorter(handle: MikeDownEditorHandle): Promise<void> {
  handle.tiptap.commands.setTextSelection({ from: 1, to: 13 });
  handle.command('aiRewrite');
  [...popover()!.querySelectorAll<HTMLButtonElement>('.ai-rw-chip')].find((b) => b.dataset.variant === 'shorter')!.click();
  await settle();
}

describe('rewrite at the length limit', () => {
  it('no text with thinking at model default: the error says thinking used the budget, with Retry', async () => {
    const { handle } = mount('Hello world.\n', { text: '', finish: 'length' });
    await settle();
    await rewriteShorter(handle);
    expect(popover()!.dataset.phase).toBe('error');
    expect(errorMessage()).toBe(aiLengthLimitCopy({ thinking: true, empty: true }).message);
    expect(popover()!.querySelector('.ai-rw-error-title')?.textContent).toBe('No room left to answer');
    expect(popover()!.textContent).not.toContain('The engine sent back no text.');
    expect(hasButton('Try again') || hasButton('Retry')).toBe(true);
  });

  it('no text with thinking Off: the error does not mention Thinking', async () => {
    const { handle } = mount('Hello world.\n', { text: '', finish: 'length' }, { chat_template_kwargs: { enable_thinking: false } });
    await settle();
    await rewriteShorter(handle);
    expect(errorMessage()).toBe(aiLengthLimitCopy({ thinking: false, empty: true }).message);
  });

  it('a cut answer is shown with the note, and Accept stays', async () => {
    const { handle } = mount('Hello world.\n', { text: 'Hi wor', finish: 'length' });
    await settle();
    await rewriteShorter(handle);
    expect(popover()!.dataset.phase).toBe('done');
    expect(note()).toBe(aiLengthLimitCopy({ thinking: true, empty: false }).message);
    expect(hasButton('Accept')).toBe(true);
  });
});

describe('/summary and /title at the length limit', () => {
  const MD = '# Plan\n\nWe ship the editor in May. Docs follow in June.\n';

  it('Insert stays; the note shows the cut, and the cut #tag is not inserted', async () => {
    const { handle } = mount(MD, { text: 'The editor ships in May. #pl', finish: 'length' });
    await settle();
    handle.tiptap.commands.setTextSelection(handle.tiptap.state.doc.content.size - 1);
    handle.command('aiSummarize');
    await settle();
    expect(popover()!.dataset.phase).toBe('done');
    expect(note()).toContain('cut off');
    expect(hasButton('Insert')).toBe(true);
    buttons().find((b) => b.textContent === 'Insert')!.click();
    const md = handle.getMarkdown();
    expect(md).toContain('The editor ships in May. …');
    expect(md).not.toContain('#pl');
  });

  it('a summary with no text at the limit gets the out-of-room error', async () => {
    const { handle } = mount(MD, { text: '', finish: 'length' });
    await settle();
    handle.command('aiSummarize');
    await settle();
    expect(popover()!.dataset.phase).toBe('error');
    expect(errorMessage()).toBe(aiLengthLimitCopy({ thinking: true, empty: true }).message);
  });

  it('titles with no text at the limit: the out-of-room error, without a repair round trip', async () => {
    const { handle, requests } = mount(MD, { text: '', finish: 'length' });
    await settle();
    handle.command('aiSuggestTitle');
    await settle();
    expect(requests).toHaveLength(1);
    expect(popover()!.dataset.phase).toBe('error');
    expect(errorMessage()).toBe(aiLengthLimitCopy({ thinking: true, empty: true }).message);
  });
});

describe('Properties Suggest at the length limit', () => {
  const MD = '---\ntitle: Old\n---\n# Plan\n\nWe ship the editor in May.\n';
  const row = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-testid="properties-suggest"]')!;

  it('no text: the row says thinking used the budget, with Try again', async () => {
    const { el, handle, requests } = mount(MD, { text: '', finish: 'length' });
    await settle();
    handle.command('aiSuggestProperties');
    await settle();
    expect(requests).toHaveLength(1);
    expect(row(el).dataset.state).toBe('error');
    expect(row(el).querySelector('.properties-suggest-error')?.textContent).toBe(aiLengthLimitCopy({ thinking: true, empty: true }).message);
  });

  it('a cut answer that still parsed shows its chips with the note', async () => {
    const { el, handle } = mount(MD, { text: '{"description": "How the editor ships.", "tags": ["release"]}', finish: 'length' });
    await settle();
    handle.command('aiSuggestProperties');
    await settle();
    expect(row(el).dataset.state).toBe('idle');
    expect(row(el).querySelectorAll('.properties-suggest-chip').length).toBeGreaterThan(0);
    expect(row(el).querySelector('.properties-suggest-note')?.textContent).toBe(aiLengthLimitCopy({ thinking: true, empty: false }).message);
  });
});
