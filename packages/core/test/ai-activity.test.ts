/**
 * The AI activity recorder: the log itself (off by default, ring of 50,
 * subscribers) and what `runAiCompletion` writes into it.
 *
 * Note: the recorder keeps the host result's metadata flat on the response
 * (`response.usage / finishReason / timing / served`), not under `response.result`.
 */
import { describe, expect, it, vi } from 'vitest';
import { makeAiError, parseAiSettings, defaultAiSettings } from '../src/ai';
import type { AiCompletionRequest, AiCompletionResult, AiEngineStatus, AiSettings, MikeDownAiHost } from '../src/ai';
import { AI_ACTIVITY_LIMIT, aiActivityStatus, createAiActivityLog, type AiActivityEntry } from '../src/ai-activity';
import { runAiCompletion, type AiRunContext } from '../src/ai-request';

const entry = (id: string, over: Partial<AiActivityEntry> = {}): AiActivityEntry => ({
  id,
  startedAt: 1,
  endedAt: null,
  feature: 'rewrite',
  task: 'rewrite',
  route: null,
  thinking: null,
  request: { requestId: id, feature: 'rewrite', task: 'rewrite', messages: [{ role: 'user', content: 'x' }] },
  response: { text: '' },
  error: null,
  attempt: 1,
  ...over,
});

// ── The log ─────────────────────────────────────────────────────────────────

describe('createAiActivityLog', () => {
  it('is off by default and record is a no-op while off', () => {
    const log = createAiActivityLog();
    const fn = vi.fn();
    log.subscribe(fn);
    expect(log.enabled).toBe(false);
    log.record(entry('a'));
    expect(log.entries()).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('update on an unknown entry is a no-op', () => {
    const log = createAiActivityLog();
    log.setEnabled(true);
    const fn = vi.fn();
    log.subscribe(fn);
    log.update('missing', { endedAt: 5 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('enabling then disabling clears the entries', () => {
    const log = createAiActivityLog();
    log.setEnabled(true);
    log.record(entry('a'));
    expect(log.entries()).toHaveLength(1);
    log.setEnabled(false);
    expect(log.entries()).toEqual([]);
    log.record(entry('b'));
    expect(log.entries()).toEqual([]);
  });

  it('notifies subscribers on each change, and not after unsubscribe', () => {
    const log = createAiActivityLog();
    log.setEnabled(true);
    const fn = vi.fn();
    const off = log.subscribe(fn);
    log.record(entry('a'));
    log.update('a', { endedAt: 2 });
    log.update('a', (e) => ({ response: { text: `${e.response.text}x` } }));
    expect(fn).toHaveBeenCalledTimes(3);
    log.setEnabled(false);
    expect(fn).toHaveBeenCalledTimes(4);
    off();
    log.setEnabled(true);
    log.record(entry('b'));
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('replaces an entry on update instead of mutating the one a snapshot holds', () => {
    const log = createAiActivityLog();
    log.setEnabled(true);
    log.record(entry('a'));
    const before = log.get('a')!;
    log.update('a', { endedAt: 9 });
    expect(before.endedAt).toBeNull();
    expect(log.get('a')!.endedAt).toBe(9);
  });

  it('keeps the newest 50: the 51st drops the oldest, order stays oldest first', () => {
    const log = createAiActivityLog();
    log.setEnabled(true);
    expect(AI_ACTIVITY_LIMIT).toBe(50);
    for (let i = 1; i <= 50; i++) {log.record(entry(`e${i}`));}
    expect(log.entries()).toHaveLength(50);
    expect(log.entries()[0].id).toBe('e1');
    log.record(entry('e51'));
    const ids = log.entries().map((e) => e.id);
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe('e2');
    expect(ids[49]).toBe('e51');
    expect(log.get('e1')).toBeUndefined();
  });
});

describe('aiActivityStatus', () => {
  it('maps an entry to one word', () => {
    const route = { engineId: 'e', modelId: 'm', label: 'E', isLocal: true, viaFallback: false };
    expect(aiActivityStatus(entry('a'))).toBe('streaming');
    expect(aiActivityStatus(entry('a', { endedAt: 2 }))).toBe('ok');
    expect(aiActivityStatus(entry('a', { endedAt: 2, route: { ...route, viaFallback: true } }))).toBe('fallback');
    expect(aiActivityStatus(entry('a', { endedAt: 2, error: makeAiError('auth') }))).toBe('error');
    expect(aiActivityStatus(entry('a', { endedAt: 2, error: makeAiError('cancelled') }))).toBe('cancelled');
  });
});

// ── runAiCompletion into the log ────────────────────────────────────────────

const CHAT = { chat: true, stream: true, vision: false, json: true, tools: false, fim: false, embed: false, contextTokens: 32768 };

function aiSettings(over: Record<string, unknown> = {}): AiSettings {
  return parseAiSettings({
    enabled: true,
    allowCloud: true,
    engines: [
      { id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', models: [{ id: 'qwen', capabilities: CHAT, capabilitiesSource: 'user' }] },
      { id: 'lms', name: 'LM Studio', kind: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', models: [{ id: 'gemma', capabilities: CHAT, capabilitiesSource: 'user' }] },
      { id: 'claude', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', models: [{ id: 'sonnet', capabilities: CHAT, capabilitiesSource: 'user' }] },
    ],
    routing: { default: { engineId: 'omlx', modelId: 'qwen' }, fallback: 'anyLocal', tasks: {} },
    ...over,
  }, { onWarning: () => {} });
}

type Step = (req: AiCompletionRequest, onToken: (d: string) => void, signal: AbortSignal) => Promise<AiCompletionResult>;

function fakeHost(script: Step[], extra: Partial<MikeDownAiHost> = {}) {
  const calls: AiCompletionRequest[] = [];
  const ai: MikeDownAiHost = {
    complete: (req, onToken, signal) => {
      calls.push(req);
      return script[Math.min(calls.length, script.length) - 1](req, onToken, signal);
    },
    ...extra,
  };
  return { ai, calls };
}

const tier2 = { listEngines: async (): Promise<AiEngineStatus[]> => [] };
const served = (engineId: string, modelId: string) => ({ engineId, engineName: engineId, modelId, isLocal: true });
const answer = (words: string[]): Step => async (req, onToken) => {
  for (const w of words) {onToken(w);}
  return {
    text: words.join(''),
    served: served(req.route?.engineId ?? 'host', req.route?.modelId ?? 'model'),
    usage: { promptTokens: 7, completionTokens: 3 },
    finishReason: 'stop',
    timing: { totalMs: 120, firstTokenMs: 40 },
  };
};

function setup(ai: MikeDownAiHost, settings: AiSettings = defaultAiSettings(), enabled = true) {
  const activity = createAiActivityLog();
  activity.setEnabled(enabled);
  const ctx: AiRunContext = { ai, settings: () => settings, statuses: () => [], consent: {}, activity };
  return { activity, ctx };
}

const messages = [{ role: 'user' as const, content: 'Shorten this.' }];
const run = { feature: 'rewrite', messages };

describe('runAiCompletion records into the activity log', () => {
  it('tier-1 host: one entry with the request as sent, the streamed text and the result metadata', async () => {
    const { ai, calls } = fakeHost([answer(['Hel', 'lo ', 'there'])]);
    const { activity, ctx } = setup(ai);
    const changes = vi.fn();
    activity.subscribe(changes);
    await runAiCompletion(ctx, run, {}, new AbortController().signal);

    const entries = activity.entries();
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.id).toBe(calls[0].requestId);
    expect(e.request).toBe(calls[0]);
    expect(e.request.messages).toBe(messages);
    expect(e.route).toBeNull();
    expect(e.attempt).toBe(1);
    expect(e.error).toBeNull();
    expect(e.endedAt).not.toBeNull();
    expect(e.response.text).toBe('Hello there');
    // Flat metadata, not response.result.
    expect(e.response).toMatchObject({
      text: 'Hello there',
      usage: { promptTokens: 7, completionTokens: 3 },
      finishReason: 'stop',
      timing: { totalMs: 120, firstTokenMs: 40 },
      served: { engineId: 'host', modelId: 'model' },
    });
    expect(e.response).not.toHaveProperty('result');
    expect(aiActivityStatus(e)).toBe('ok');
    // record + one change per token + the final update.
    expect(changes).toHaveBeenCalledTimes(1 + 3 + 1);
  });

  it('records nothing while the log is off', async () => {
    const { ai } = fakeHost([answer(['hi'])]);
    const { activity, ctx } = setup(ai, defaultAiSettings(), false);
    await runAiCompletion(ctx, run, {}, new AbortController().signal);
    expect(activity.entries()).toEqual([]);
  });

  it('tier-2 host: records the route, and the entry streams until the host answers', async () => {
    let seen: AiActivityEntry | undefined;
    const holder: { activity?: ReturnType<typeof createAiActivityLog> } = {};
    const { ai } = fakeHost([async (req, onToken) => {
      onToken('par');
      seen = holder.activity!.entries()[0];
      onToken('tial');
      return { text: 'partial', served: served('omlx', 'qwen') };
    }], tier2);
    const { activity, ctx } = setup(ai, aiSettings());
    holder.activity = activity;
    await runAiCompletion(ctx, run, {}, new AbortController().signal);
    expect(seen).toMatchObject({ endedAt: null, response: { text: 'par' } });
    expect(aiActivityStatus(seen!)).toBe('streaming');
    expect(activity.entries()[0].route).toEqual({ engineId: 'omlx', modelId: 'qwen', label: 'oMLX', isLocal: true, viaFallback: false });
  });

  it('an unreachable engine before any token: two entries, the first with the error, the second via the fallback', async () => {
    const { ai, calls } = fakeHost([
      async () => { throw makeAiError('unreachable', 'connection refused'); },
      answer(['from lm studio']),
    ], tier2);
    const { activity, ctx } = setup(ai, aiSettings());
    await runAiCompletion(ctx, run, {}, new AbortController().signal);

    const [first, second] = activity.entries();
    expect(activity.entries()).toHaveLength(2);
    expect(calls.map((c) => c.route?.engineId)).toEqual(['omlx', 'lms']);

    expect(first.attempt).toBe(1);
    expect(first.retried).toBe(true);
    expect(first.error).toMatchObject({ code: 'unreachable', engineId: 'omlx' });
    expect(first.endedAt).not.toBeNull();
    expect(first.route).toMatchObject({ engineId: 'omlx', viaFallback: false });
    expect(aiActivityStatus(first)).toBe('error');

    expect(second.attempt).toBe(2);
    expect(second.error).toBeNull();
    expect(second.id).not.toBe(first.id);
    expect(second.route).toMatchObject({ engineId: 'lms', viaFallback: true });
    expect(second.response.text).toBe('from lm studio');
    expect(aiActivityStatus(second)).toBe('fallback');
  });

  it('a cancelled signal records the entry with error code cancelled', async () => {
    const controller = new AbortController();
    const { ai } = fakeHost([async (_req, onToken, signal) => {
      onToken('partial');
      controller.abort();
      if (signal.aborted) {throw new Error('aborted');}
      return { text: 'never', served: served('host', 'm') };
    }]);
    const { activity, ctx } = setup(ai);
    await expect(runAiCompletion(ctx, run, {}, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    const entries = activity.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0].error?.code).toBe('cancelled');
    expect(entries[0].endedAt).not.toBeNull();
    expect(aiActivityStatus(entries[0])).toBe('cancelled');
  });

  it('a cancel before sending records nothing', async () => {
    const { ai, calls } = fakeHost([answer(['x'])]);
    const { activity, ctx } = setup(ai);
    const controller = new AbortController();
    controller.abort();
    await expect(runAiCompletion(ctx, run, {}, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(calls).toHaveLength(0);
    expect(activity.entries()).toEqual([]);
  });

  it('a cloud consent refusal with nowhere else to go records nothing', async () => {
    const requestCloudConsent = vi.fn(async () => false);
    const { ai, calls } = fakeHost([answer(['x'])], { ...tier2, requestCloudConsent });
    const s = aiSettings({ routing: { default: { engineId: 'claude', modelId: 'sonnet' }, fallback: 'none', tasks: {} } });
    const { activity, ctx } = setup(ai, s);
    await expect(runAiCompletion(ctx, run, {}, new AbortController().signal)).rejects.toBeDefined();
    expect(requestCloudConsent).toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(activity.entries()).toEqual([]);
  });

  it('a refusal that falls back to a local engine records only the request that was sent', async () => {
    const requestCloudConsent = vi.fn(async () => false);
    const { ai, calls } = fakeHost([answer(['local'])], { ...tier2, requestCloudConsent });
    const s = aiSettings({ routing: { default: { engineId: 'omlx', modelId: 'qwen' }, fallback: 'anyLocal', tasks: { rewrite: { engineId: 'claude', modelId: 'sonnet' } } } });
    const { activity, ctx } = setup(ai, s);
    await runAiCompletion(ctx, run, {}, new AbortController().signal);
    expect(calls).toHaveLength(1);
    const entries = activity.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0].route).toMatchObject({ engineId: 'omlx', viaFallback: true });
  });
});

// ── Settings ────────────────────────────────────────────────────────────────

describe('activityPanel setting', () => {
  const parse = (raw: unknown) => parseAiSettings(raw, { onWarning: () => {} });

  it('defaults to false', () => {
    expect(defaultAiSettings().activityPanel).toBe(false);
    expect(parse({}).activityPanel).toBe(false);
    expect(parse(undefined).activityPanel).toBe(false);
  });

  it('accepts true, flat or nested', () => {
    expect(parse({ activityPanel: true }).activityPanel).toBe(true);
    expect(parse({ 'ai.activityPanel': true }).activityPanel).toBe(true);
    expect(parse({ activityPanel: false }).activityPanel).toBe(false);
  });

  it('ignores non-booleans', () => {
    for (const bad of ['true', 1, 0, null, {}, []]) {
      expect(parse({ activityPanel: bad }).activityPanel, JSON.stringify(bad)).toBe(false);
    }
  });
});
