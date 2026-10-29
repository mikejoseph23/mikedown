/**
 * Thinking dial per request (AI writing M3): the per-request overrides core
 * sends (against the shared fixture both hosts merge), runAiCompletion's
 * plumbing, the session memory per kind, and the popover's control.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
import { THINKING_DEFAULT_HEADROOM_TOKENS, THINKING_HEADROOM_TOKENS, THINKING_MAX_TOKENS_CAP, parseAiSettings, thinkingMaxTokens, thinkingOverrides } from '../src/ai';
import type { AiCompletionRequest, AiCompletionResult, AiSettings, AiThinkingLevel, MikeDownAiHost } from '../src/ai';
import { runAiCompletion, thinkingRequestOverrides, type AiRunContext, type AiRunThinking } from '../src/ai-request';
import { clearSessionThinking, rememberSessionThinking, sessionThinkingLevel } from '../src/ai-prefs';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

beforeEach(() => {
  clearSessionThinking();
});

interface FixtureCase {
  name: string;
  kind: string;
  local: boolean;
  level: AiThinkingLevel;
  modelOverrides: Record<string, unknown> | null;
  requestOverrides: Record<string, unknown>;
  expectedBody: Record<string, unknown>;
}

const fixture = JSON.parse(readFileSync(join(__dirname, '../../../test/ai-fixtures/requests/thinking-overrides.json'), 'utf8')) as { cases: FixtureCase[] };

describe('thinkingRequestOverrides (shared fixture)', () => {
  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const out = thinkingRequestOverrides(c.kind, c.modelOverrides ?? undefined, c.level, { local: c.local });
    expect(out).toEqual(c.requestOverrides);
    // Whatever is added to neutralize the model's fields, the level's own fields are all there.
    expect(out).toMatchObject(thinkingOverrides(c.kind, c.level, { local: c.local }));
  });

  it('is undefined for a level the kind cannot express or a kind with no mapping', () => {
    expect(thinkingRequestOverrides('lmstudio', undefined, 'high')).toBeUndefined();
    expect(thinkingRequestOverrides('anthropic', undefined, 'off')).toBeUndefined();
    expect(thinkingRequestOverrides('future-kind', undefined, 'low')).toBeUndefined();
  });
});

describe('session thinking memory', () => {
  it('is per kind, in memory only', () => {
    expect(sessionThinkingLevel('openai-compatible')).toBeNull();
    rememberSessionThinking('openai-compatible', 'low');
    rememberSessionThinking('anthropic', 'high');
    expect(sessionThinkingLevel('openai-compatible')).toBe('low');
    expect(sessionThinkingLevel('anthropic')).toBe('high');
    expect(sessionThinkingLevel('lmstudio')).toBeNull();
    expect(JSON.stringify({ ...localStorage })).not.toContain('thinking');
  });
});

// ── runAiCompletion ─────────────────────────────────────────────────────────

const CHAT = { chat: true, stream: true, vision: false, json: false, tools: false, fim: false, embed: false, contextTokens: 8192 };

function aiSettings(defaultEngine = 'omlx', modelOverrides?: Record<string, unknown>): AiSettings {
  return parseAiSettings({
    enabled: true,
    allowCloud: true,
    engines: [
      { id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', models: [{ id: 'qwen', capabilities: CHAT, capabilitiesSource: 'user', ...(modelOverrides ? { requestOverrides: modelOverrides } : {}) }] },
      { id: 'claude', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', models: [{ id: 'sonnet', capabilities: CHAT, capabilitiesSource: 'user' }] },
      { id: 'odd', name: 'Future', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:9000/v1', models: [{ id: 'm', capabilities: CHAT, capabilitiesSource: 'user' }] },
    ],
    routing: { default: { engineId: defaultEngine, modelId: defaultEngine === 'omlx' ? 'qwen' : defaultEngine === 'claude' ? 'sonnet' : 'm' }, fallback: 'none', tasks: {} },
  }, { onWarning: () => {} });
}

function host(tier2 = true) {
  const calls: AiCompletionRequest[] = [];
  const ai: MikeDownAiHost = {
    complete: async (req) => {
      calls.push(req);
      return { text: 'ok', served: { engineId: req.route?.engineId, engineName: 'E', modelId: req.route?.modelId ?? 'm', isLocal: true }, finishReason: 'stop' };
    },
    ...(tier2 ? { listEngines: async () => [] } : {}),
  };
  return { ai, calls };
}

const ctx = (ai: MikeDownAiHost, settings: AiSettings): AiRunContext => ({ ai, settings: () => settings, statuses: () => [], consent: { claude: true } });
const run = { feature: 'rewrite', messages: [{ role: 'user' as const, content: 'x' }] };

describe('runAiCompletion thinking', () => {
  it('sends the level as requestOverrides and reports it with the configured one', async () => {
    const { ai, calls } = host();
    const routes: Array<AiRunThinking | null> = [];
    const out = await runAiCompletion(ctx(ai, aiSettings('omlx', { reasoning_effort: 'high' })), { ...run, thinking: 'low' }, { onRoute: (_r, t) => routes.push(t) }, new AbortController().signal);
    expect(calls[0].requestOverrides).toEqual({ reasoning_effort: 'low' });
    expect(routes[0]).toEqual({ kind: 'openai-compatible', configured: 'high', sent: 'low' });
    expect(out.thinking).toEqual(routes[0]);
  });

  it('asks a function once the kind is known', async () => {
    const { ai, calls } = host();
    const asked: string[] = [];
    await runAiCompletion(ctx(ai, aiSettings('claude')), { ...run, thinking: (kind) => { asked.push(kind); return 'medium'; } }, {}, new AbortController().signal);
    expect(asked).toEqual(['anthropic']);
    expect(calls[0].requestOverrides).toEqual(thinkingOverrides('anthropic', 'medium'));
  });

  it('sends nothing without a level, or for a level the kind cannot express', async () => {
    const { ai, calls } = host();
    const routes: Array<AiRunThinking | null> = [];
    await runAiCompletion(ctx(ai, aiSettings()), run, { onRoute: (_r, t) => routes.push(t) }, new AbortController().signal);
    await runAiCompletion(ctx(ai, aiSettings('claude')), { ...run, thinking: 'off' }, { onRoute: (_r, t) => routes.push(t) }, new AbortController().signal);
    expect(calls.map((c) => 'requestOverrides' in c)).toEqual([false, false]);
    expect(routes).toEqual([
      { kind: 'openai-compatible', configured: null, sent: null },
      { kind: 'anthropic', configured: null, sent: null },
    ]);
  });

  it('a tier-1 host gets no overrides and no dial', async () => {
    const { ai, calls } = host(false);
    const routes: Array<AiRunThinking | null> = [];
    const out = await runAiCompletion(ctx(ai, aiSettings()), { ...run, thinking: 'high' }, { onRoute: (_r, t) => routes.push(t) }, new AbortController().signal);
    expect(calls[0].requestOverrides).toBeUndefined();
    expect(routes).toEqual([null]);
    expect(out.thinking).toBeNull();
  });
});

describe('reasoning headroom (T3 F2)', () => {
  it('thinkingMaxTokens adds headroom by level, model default counting as thinking, and nothing for Off', () => {
    expect(thinkingMaxTokens(256, 'off')).toBe(256);
    expect(thinkingMaxTokens(256, 'low')).toBe(256 + THINKING_HEADROOM_TOKENS.low);
    expect(thinkingMaxTokens(256, 'medium')).toBe(256 + THINKING_HEADROOM_TOKENS.medium);
    expect(thinkingMaxTokens(256, 'high')).toBe(256 + THINKING_HEADROOM_TOKENS.high);
    expect(thinkingMaxTokens(256, null)).toBe(256 + THINKING_DEFAULT_HEADROOM_TOKENS);
    expect(THINKING_HEADROOM_TOKENS.low).toBeLessThan(THINKING_HEADROOM_TOKENS.medium);
    expect(THINKING_HEADROOM_TOKENS.medium).toBeLessThan(THINKING_HEADROOM_TOKENS.high);
  });

  it('is capped, by the cap and by what is left of the context window, and never below the answer budget', () => {
    expect(thinkingMaxTokens(6000, 'high')).toBe(THINKING_MAX_TOKENS_CAP);
    expect(thinkingMaxTokens(12000, 'high')).toBe(12000);
    expect(thinkingMaxTokens(256, 'high', { contextTokens: 4096, promptTokens: 1000 })).toBe(4096 - 1000 - 256);
    expect(thinkingMaxTokens(700, 'high', { contextTokens: 2048, promptTokens: 1500 })).toBe(700);
    expect(thinkingMaxTokens(256, 'low', { contextTokens: null })).toBe(256 + THINKING_HEADROOM_TOKENS.low);
  });

  it('runAiCompletion raises maxTokens for a model that can think, and leaves an Off request unchanged', async () => {
    const { ai, calls } = host();
    const sent = async (settings: AiSettings, thinking?: AiThinkingLevel): Promise<number | undefined> => {
      await runAiCompletion(ctx(ai, settings), { ...run, maxTokens: 256, ...(thinking ? { thinking } : {}) }, {}, new AbortController().signal);
      return calls[calls.length - 1].maxTokens;
    };
    expect(await sent(aiSettings(), 'off')).toBe(256);
    expect(await sent(aiSettings('omlx', { chat_template_kwargs: { enable_thinking: false } }))).toBe(256);
    expect(await sent(aiSettings())).toBe(256 + THINKING_DEFAULT_HEADROOM_TOKENS);
    expect(await sent(aiSettings(), 'high')).toBe(256 + THINKING_HEADROOM_TOKENS.high);
    expect(await sent(aiSettings('omlx', { reasoning_effort: 'low' }))).toBe(256 + THINKING_HEADROOM_TOKENS.low);
    expect(await sent(aiSettings('claude'), 'low')).toBe(256 + THINKING_HEADROOM_TOKENS.low);
  });

  it('a tier-1 host and a request without maxTokens are unchanged', async () => {
    const t1 = host(false);
    await runAiCompletion(ctx(t1.ai, aiSettings()), { ...run, maxTokens: 256 }, {}, new AbortController().signal);
    expect(t1.calls[0].maxTokens).toBe(256);
    const t2 = host();
    await runAiCompletion(ctx(t2.ai, aiSettings()), run, {}, new AbortController().signal);
    expect(t2.calls[0].maxTokens).toBeUndefined();
  });
});

// ── Popover ─────────────────────────────────────────────────────────────────

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];
afterEach(() => {
  for (const { handle, el } of mounted.splice(0)) {
    handle.destroy();
    el.remove();
  }
  document.querySelectorAll('.mikedown-ai-rewrite').forEach((n) => n.remove());
});

function mountTier2(kind: string, modelOverrides?: Record<string, unknown>) {
  const requests: AiCompletionRequest[] = [];
  class AiHost extends NoopHost {
    ai: MikeDownAiHost = {
      complete: async (req, onToken): Promise<AiCompletionResult> => {
        requests.push(req);
        onToken('Short.');
        return { text: 'Short.', served: { engineId: 'e', engineName: 'oMLX', modelId: 'qwen', isLocal: true }, finishReason: 'stop' };
      },
      listEngines: async () => [],
    };
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ai = {
    enabled: true,
    engines: [{ id: 'e', name: 'oMLX', kind, baseUrl: 'http://127.0.0.1:8000/v1', models: [{ id: 'qwen', capabilities: CHAT, capabilitiesSource: 'user', ...(modelOverrides ? { requestOverrides: modelOverrides } : {}) }] }],
    routing: { default: { engineId: 'e', modelId: 'qwen' }, fallback: 'none', tasks: {} },
  };
  const handle = createMikeDownEditor(el, { host: new AiHost(), initialMarkdown: 'Hello world.\n', hostOwnsShortcuts: true, settings: { ai } as never });
  mounted.push({ handle, el });
  return { handle, requests };
}

function mountTier1() {
  class AiHost extends NoopHost {
    ai: MikeDownAiHost = {
      complete: async () => ({ text: 'Hi.', served: { engineName: 'Proxy', modelId: 'm', isLocal: true }, finishReason: 'stop' }),
    };
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host: new AiHost(), initialMarkdown: 'Hello world.\n', hostOwnsShortcuts: true, settings: { ai: { enabled: true } } as never });
  mounted.push({ handle, el });
  return { handle };
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const popover = () => document.querySelector<HTMLElement>('.mikedown-ai-rewrite');
const dial = () => popover()?.querySelector<HTMLElement>('.ai-rw-think');
const segments = () => [...(dial()?.querySelectorAll<HTMLButtonElement>('.ai-rw-think-seg') ?? [])];
const pressed = () => segments().find((s) => s.getAttribute('aria-pressed') === 'true')?.dataset.level ?? null;

async function rewriteShorter(handle: MikeDownEditorHandle): Promise<void> {
  handle.tiptap.commands.setTextSelection({ from: 1, to: 13 });
  handle.command('aiRewrite');
  [...popover()!.querySelectorAll<HTMLButtonElement>('.ai-rw-chip')].find((b) => b.dataset.variant === 'shorter')!.click();
  await settle();
  await settle();
}

describe('popover thinking dial', () => {
  it('shows the kind\'s levels with the model\'s setting pressed, re-runs on a change and remembers it per kind', async () => {
    const { handle, requests } = mountTier2('openai-compatible', { chat_template_kwargs: { enable_thinking: false } });
    await settle();
    await rewriteShorter(handle);
    expect(dial()!.hidden).toBe(false);
    expect(segments().map((s) => s.textContent)).toEqual(['Off', 'Low', 'Med', 'High']);
    expect(pressed()).toBe('off');
    expect(requests[0].requestOverrides).toBeUndefined();

    segments().find((s) => s.dataset.level === 'low')!.click();
    await settle();
    await settle();
    expect(requests).toHaveLength(2);
    // Local engine set to Off: the request turns thinking back on for the tier.
    expect(requests[1].requestOverrides).toEqual({ reasoning_effort: 'low', chat_template_kwargs: { enable_thinking: true } });
    expect(pressed()).toBe('low');
    expect(sessionThinkingLevel('openai-compatible')).toBe('low');
    expect(popover()!.querySelector<HTMLElement>('.ai-rw-badge')!.title).toMatch(/Thinking: low\.$/);

    // Retry keeps the remembered level.
    [...popover()!.querySelectorAll<HTMLButtonElement>('.ai-rw-foot button')].find((b) => b.textContent === 'Retry')!.click();
    await settle();
    await settle();
    expect(requests[2].requestOverrides).toMatchObject(thinkingOverrides('openai-compatible', 'low', { local: true }));
  });

  it('pressing the level already in effect does not re-run', async () => {
    const { handle, requests } = mountTier2('anthropic', { thinking: { type: 'adaptive' }, output_config: { effort: 'high' } });
    await settle();
    await rewriteShorter(handle);
    expect(segments().map((s) => s.textContent)).toEqual(['Low', 'Med', 'High']);
    expect(pressed()).toBe('high');
    segments().find((s) => s.dataset.level === 'high')!.click();
    await settle();
    expect(requests).toHaveLength(1);
  });

  it('is absent for a kind with no mapping (never routed, so the popover says why)', async () => {
    const { handle } = mountTier2('future-kind');
    await settle();
    handle.tiptap.commands.setTextSelection({ from: 1, to: 13 });
    handle.command('aiRewrite');
    await settle();
    expect(dial()?.hidden ?? true).toBe(true);
  });

  it('is absent for a tier-1 host', async () => {
    const { handle } = mountTier1();
    await rewriteShorter(handle);
    expect(popover()!.dataset.phase).toBe('done');
    expect(dial()!.hidden).toBe(true);
  });
});
