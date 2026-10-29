/**
 * Result timing (F1): the footer's "2.4 s · 38 tok/s" and its tooltip, the
 * log parts both hosts write, which engines are asked for usage in the
 * stream; and a model that did not load (L4): the mapping, the copy and the
 * popover's Choose model.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
import {
  aiErrorCodeFromHttp,
  aiErrorCopy,
  aiResultStats,
  aiResultStatsText,
  aiResultStatsTitle,
  aiTimingLogParts,
  isAiErrorCode,
  makeAiError,
  parseAiSettings,
  streamUsageSupported,
  withStreamUsage,
} from '../src/ai';
import type { AiCompletionResult, AiEngineKind, AiSettings, MikeDownAiHost } from '../src/ai';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const FIXTURES = join(__dirname, '..', '..', '..', 'test', 'ai-fixtures');
const load = (rel: string): any => JSON.parse(readFileSync(join(FIXTURES, rel), 'utf8'));

describe('result stats (shared fixture)', () => {
  for (const c of load('stats/result-stats.json').cases) {
    it(c.name, () => {
      const result = c.result as Pick<AiCompletionResult, 'text' | 'usage' | 'timing'>;
      const stats = aiResultStats(result);
      expect(stats ? aiResultStatsText(stats) : null).toBe(c.footer);
      expect(stats ? aiResultStatsTitle(stats) : null).toBe(c.title);
      expect(aiTimingLogParts(result)).toEqual(c.log);
    });
  }

  it('without outputChars the estimate falls back to the answer text', () => {
    const stats = aiResultStats({ text: 'x'.repeat(80), timing: { totalMs: 2000 } })!;
    expect(stats).toMatchObject({ outputTokens: 20, approximate: true, tokensPerSecond: 10 });
  });
});

describe('usage in the stream (shared fixture)', () => {
  for (const c of load('requests/stream-usage.json').cases) {
    it(`${c.kind} ${c.baseUrl}`, () => {
      const engine = { kind: c.kind as AiEngineKind, baseUrl: c.baseUrl as string };
      expect(streamUsageSupported(engine)).toBe(c.expected);
      expect('stream_options' in withStreamUsage({ stream: true }, engine)).toBe(c.expected);
    });
  }

  it('leaves a non-streamed body and one whose overrides set stream_options alone', () => {
    const lm = { kind: 'lmstudio' as const, baseUrl: 'http://127.0.0.1:1234/v1' };
    expect(withStreamUsage({ stream: false }, lm)).toEqual({ stream: false });
    const own = { stream: true, stream_options: { include_usage: false } };
    expect(withStreamUsage(own, lm)).toBe(own);
  });
});

describe('a model that did not load (L4)', () => {
  const LM_STUDIO = '{"error":"Failed to load model \\"qwen3.8-flash-next-oq5e-mtp\\". Error: Failed to load model."}';

  it('maps LM Studio, llama.cpp and Ollama load failures, ahead of the context check', () => {
    expect(isAiErrorCode('modelLoadFailed')).toBe(true);
    expect(aiErrorCodeFromHttp(400, LM_STUDIO)).toBe('modelLoadFailed');
    expect(aiErrorCodeFromHttp(400, 'Failed to load model: context length too large for memory')).toBe('modelLoadFailed');
    expect(aiErrorCodeFromHttp(500, 'error loading model: unknown architecture')).toBe('modelLoadFailed');
    expect(aiErrorCodeFromHttp(500, '{"error":"llama runner process has terminated: exit status 2"}')).toBe('modelLoadFailed');
    expect(aiErrorCodeFromHttp(500, 'model requires more system memory (40 GiB) than is available (16 GiB)')).toBe('modelLoadFailed');
    // Still loading is not a failure, and auth and 404 keep their codes.
    expect(aiErrorCodeFromHttp(503, 'Loading model')).toBe('unreachable');
    expect(aiErrorCodeFromHttp(401, 'failed to load model')).toBe('auth');
    expect(aiErrorCodeFromHttp(404, 'failed to load model')).toBe('modelNotFound');
  });

  it('names the engine and the model, and points at the model picker', () => {
    expect(aiErrorCopy('modelLoadFailed', { engine: 'LM Studio', model: 'qwen3.8-flash-next-oq5e-mtp' })).toEqual({
      title: "Model didn't load",
      message: "LM Studio couldn't load qwen3.8-flash-next-oq5e-mtp. Load it in LM Studio, or choose another model.",
      action: 'chooseModel',
    });
    expect(aiErrorCopy('modelLoadFailed', { engine: 'Ollama' }).message).toBe("Ollama couldn't load the model. Load it in Ollama, or choose another model.");
    expect(aiErrorCopy('modelLoadFailed').action).toBe('chooseModel');
  });
});

// ── In the popover ──────────────────────────────────────────────────────────

const CHAT = { chat: true, stream: true, vision: false, json: true, tools: false, fim: false, embed: false, contextTokens: 32768 };
const SERVED = { engineId: 'lms', engineName: 'LM Studio', modelId: 'qwen3.8-flash-next-oq5e-mtp', isLocal: true };

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];
afterEach(() => {
  for (const { handle, el } of mounted.splice(0)) {
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  document.querySelectorAll('.mikedown-ai-rewrite, #mikedown-settings-overlay, #mikedown-ai-page-overlay').forEach((n) => n.remove());
});

function settings(): AiSettings {
  return parseAiSettings({
    enabled: true,
    engines: [{ id: 'lms', name: 'LM Studio', kind: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', models: [{ id: SERVED.modelId, capabilities: CHAT, capabilitiesSource: 'user' }] }],
    routing: { default: { engineId: 'lms', modelId: SERVED.modelId }, fallback: 'none', tasks: {} },
  }, { onWarning: () => {} });
}

function mount(complete: MikeDownAiHost['complete']): MikeDownEditorHandle {
  class Host extends NoopHost { ai = { complete: vi.fn(complete), listEngines: vi.fn(async () => []) } as unknown as MikeDownAiHost; }
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host: new Host(), initialMarkdown: 'Hello world.\n', hostOwnsShortcuts: true, settings: { ai: settings() } as never });
  mounted.push({ handle, el });
  return handle;
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) {await new Promise((r) => setTimeout(r, 0));}
};
const popover = () => document.querySelector<HTMLElement>('.mikedown-ai-rewrite');
const popoverButton = (label: string) => [...(popover()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent === label && !b.hidden);

async function rewriteShorter(handle: MikeDownEditorHandle): Promise<void> {
  handle.tiptap.commands.setTextSelection({ from: 1, to: 13 });
  handle.command('aiRewrite');
  [...popover()!.querySelectorAll<HTMLButtonElement>('.ai-rw-chip')].find((b) => b.dataset.variant === 'shorter')!.click();
  await settle();
}

describe('popover footer stats (F1)', () => {
  it('shows time and speed beside the badge, with the detail in the tooltip', async () => {
    const handle = mount(async (_req, onToken) => {
      onToken('Hi world.');
      return { text: 'Hi world.', served: SERVED, finishReason: 'stop', usage: { promptTokens: 418, completionTokens: 68 }, timing: { totalMs: 2400, firstTokenMs: 600, outputChars: 300 } };
    });
    await settle();
    await rewriteShorter(handle);
    expect(popover()?.dataset.phase).toBe('done');
    const stats = popover()!.querySelector<HTMLElement>('.ai-rw-stats')!;
    expect(stats.hidden).toBe(false);
    expect(stats.textContent).toBe('2.4 s · 38 tok/s');
    expect(stats.title).toBe('First token after 0.6 s\nTotal 2.4 s\n68 output tokens\n418 input tokens\n38 tok/s');
    // Right before the engine badge.
    expect(stats.nextElementSibling?.classList.contains('ai-rw-badge')).toBe(true);
  });

  it('an estimate is marked, and an older host without timing shows nothing', async () => {
    let timing: AiCompletionResult['timing'] = { totalMs: 2400, firstTokenMs: 400, outputChars: 304 };
    const handle = mount(async (_req, onToken) => {
      onToken('Hi world.');
      return { text: 'Hi world.', served: SERVED, finishReason: 'stop', ...(timing ? { timing } : {}) };
    });
    await settle();
    await rewriteShorter(handle);
    expect(popover()!.querySelector('.ai-rw-stats')?.textContent).toBe('2.4 s · ~38 tok/s');
    timing = undefined;
    popoverButton('Retry')!.click();
    await settle();
    expect(popover()?.dataset.phase).toBe('done');
    expect(popover()!.querySelector<HTMLElement>('.ai-rw-stats')!.hidden).toBe(true);
  });
});

describe('popover: a model that did not load (L4)', () => {
  it('names engine and model, keeps the raw message in Details, and Choose model opens the engine', async () => {
    const raw = 'HTTP 400: Failed to load model "qwen3.8-flash-next-oq5e-mtp". Error: Failed to load model.';
    const handle = mount(async () => { throw makeAiError('modelLoadFailed', raw); });
    await settle();
    await rewriteShorter(handle);
    expect(popover()?.dataset.phase).toBe('error');
    expect(popover()!.querySelector('.ai-rw-error-title')?.textContent).toBe("Model didn't load");
    expect(popover()!.querySelector('.ai-rw-error-message')?.textContent)
      .toBe("LM Studio couldn't load qwen3.8-flash-next-oq5e-mtp. Load it in LM Studio, or choose another model.");
    const details = popover()!.querySelector<HTMLDetailsElement>('details.ai-rw-error-more')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('.ai-rw-error-detail')?.textContent).toBe(raw);
    expect(popoverButton('Retry')).toBeDefined();
    expect(popoverButton('Close')).toBeDefined();
    expect(popoverButton('Open AI settings')).toBeUndefined();
    const choose = popoverButton('Choose model')!;
    expect(choose.classList.contains('ai-rw-btn--primary')).toBe(true);
    choose.click();
    expect(popover()).toBeNull();
    expect(document.querySelector('[data-fk="nav:eng:lms"]')?.getAttribute('aria-current')).toBe('true');
  });
});
