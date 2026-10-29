/**
 * The Desktop `MikeDownAiHost` over a fake `AiApi` (the Rust commands and
 * their events): streaming, cancellation, listener cleanup, and how
 * discovery merges into the saved engines.
 */
import { describe, expect, it, vi } from 'vitest';
import { defaultAiSettings, parseAiSettings, toWireCompletionRequest, type AiEngineConfig, type AiSettings } from '@mikedown/core/ai';
import type { AiCompletionRequest } from '@mikedown/core';
import { createAiHost } from '../../src/host/aiHost';
import { aiChannelId, type AiApi, type AiDoneEvent, type AiEngineInfo, type AiErrorEvent, type AiTokenEvent } from '../../src/host/aiApi';

type Handler<T> = (e: T) => void;

function createFakeApi() {
  const tokens = new Map<string, Handler<AiTokenEvent>[]>();
  const dones = new Map<string, Handler<AiDoneEvent>[]>();
  const errors = new Map<string, Handler<AiErrorEvent>[]>();
  const add = <T>(map: Map<string, Handler<T>[]>, id: string, h: Handler<T>) => {
    map.set(id, [...(map.get(id) ?? []), h]);
    return () => { map.set(id, (map.get(id) ?? []).filter((x) => x !== h)); };
  };
  const api = {
    complete: vi.fn(async (_req: unknown) => 'chan'),
    cancel: vi.fn(async (_id: string) => true),
    listEngines: vi.fn(async (): Promise<AiEngineInfo[]> => []),
    testEngine: vi.fn(async (id: string): Promise<AiEngineInfo> => ({ engineId: id, ok: true, isLocal: true, hasKey: false, latencyMs: 12 })),
    discoverModels: vi.fn(),
    setSecret: vi.fn(async () => undefined),
    requestCloudConsent: vi.fn(async () => true),
    onToken: vi.fn(async (id: string, h: Handler<AiTokenEvent>) => add(tokens, id, h)),
    onDone: vi.fn(async (id: string, h: Handler<AiDoneEvent>) => add(dones, id, h)),
    onError: vi.fn(async (id: string, h: Handler<AiErrorEvent>) => add(errors, id, h)),
  };
  const listenerCount = (): number => [tokens, dones, errors].reduce((n, m) => n + [...m.values()].reduce((k, a) => k + a.length, 0), 0);
  const emit = {
    token: (id: string, delta: string) => (tokens.get(id) ?? []).slice().forEach((h) => h({ requestId: id, delta })),
    done: (id: string, result: AiDoneEvent['result']) => (dones.get(id) ?? []).slice().forEach((h) => h({ requestId: id, result })),
    error: (id: string, code: AiErrorEvent['code'], message: string) => (errors.get(id) ?? []).slice().forEach((h) => h({ requestId: id, code, message })),
  };
  return { api: api as unknown as AiApi & typeof api, emit, listenerCount };
}

const SERVED = { engineId: 'e1', engineName: 'oMLX', modelId: 'm', isLocal: true };
const REQUEST: AiCompletionRequest = {
  requestId: 'req-1',
  feature: 'rewrite',
  task: 'rewrite',
  route: { engineId: 'e1', modelId: 'm' },
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }, { type: 'image', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }] }],
};

function engine(over: Partial<AiEngineConfig> = {}): AiEngineConfig {
  return {
    id: 'e1',
    name: 'oMLX',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:8000/v1',
    enabled: true,
    locality: 'auto',
    discovery: 'auto',
    models: [],
    ...over,
  };
}

function setup(engines: AiEngineConfig[] = [engine()]) {
  const fake = createFakeApi();
  let settings: AiSettings = { ...defaultAiSettings(), engines };
  const saveEngines = vi.fn(async (next: AiEngineConfig[]) => { settings = { ...settings, engines: next }; });
  const host = createAiHost({ api: fake.api, settings: () => settings, saveEngines });
  return { ...fake, host, saveEngines, settings: () => settings };
}

describe('aiHost.complete', () => {
  it('listens first, invokes with the base64 wire form, streams tokens and resolves with the result', async () => {
    const { host, api, emit, listenerCount } = setup();
    const tokens: string[] = [];
    const pending = host.complete(REQUEST, (d) => tokens.push(d), new AbortController().signal);
    await vi.waitFor(() => expect(api.complete).toHaveBeenCalled());
    expect(api.onToken.mock.invocationCallOrder[0]).toBeLessThan(api.complete.mock.invocationCallOrder[0]);
    expect(api.complete).toHaveBeenCalledWith(toWireCompletionRequest(REQUEST));
    const sent = api.complete.mock.calls[0][0] as { messages: Array<{ content: Array<{ dataBase64?: string }> }> };
    expect(sent.messages[0].content[1].dataBase64).toBe('AQID');

    emit.token('req-1', 'Hel');
    emit.token('req-1', 'lo');
    emit.done('req-1', { text: 'Hello', served: SERVED, finishReason: 'stop' });
    await expect(pending).resolves.toMatchObject({ text: 'Hello', served: SERVED });
    expect(tokens).toEqual(['Hel', 'lo']);
    expect(listenerCount()).toBe(0);
  });

  it('passes the per-request requestOverrides (thinking dial) through to ai_complete', async () => {
    const { host, api, emit } = setup();
    const req: AiCompletionRequest = { ...REQUEST, requestOverrides: { reasoning_effort: 'low' } };
    const pending = host.complete(req, () => undefined, new AbortController().signal);
    await vi.waitFor(() => expect(api.complete).toHaveBeenCalled());
    expect(api.complete.mock.calls[0][0]).toMatchObject({ requestOverrides: { reasoning_effort: 'low' } });
    emit.done('req-1', { text: 'ok', served: SERVED, finishReason: 'stop' });
    await pending;
  });

  it('rejects with the code and message of an error event, and unlistens', async () => {
    const { host, api, emit, listenerCount } = setup();
    const pending = host.complete(REQUEST, () => undefined, new AbortController().signal);
    await vi.waitFor(() => expect(api.complete).toHaveBeenCalled());
    emit.error('req-1', 'rateLimited', 'HTTP 429');
    await expect(pending).rejects.toEqual({ code: 'rateLimited', message: 'HTTP 429' });
    expect(listenerCount()).toBe(0);
  });

  it('rejects with the AiError when the command itself refuses (cloud gate)', async () => {
    const { host, api, listenerCount } = setup();
    api.complete.mockRejectedValueOnce({ code: 'cloudBlocked', message: 'Cloud engines are turned off.' });
    await expect(host.complete(REQUEST, () => undefined, new AbortController().signal)).rejects.toEqual({
      code: 'cloudBlocked',
      message: 'Cloud engines are turned off.',
    });
    expect(listenerCount()).toBe(0);
  });

  it('abort cancels in Rust, rejects as cancelled at once, ignores late events and unlistens', async () => {
    const { host, api, emit, listenerCount } = setup();
    const ctl = new AbortController();
    const tokens: string[] = [];
    const pending = host.complete(REQUEST, (d) => tokens.push(d), ctl.signal);
    await vi.waitFor(() => expect(api.complete).toHaveBeenCalled());
    ctl.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(api.cancel).toHaveBeenCalledWith('req-1');
    emit.token('req-1', 'late');
    expect(tokens).toEqual([]);
    expect(listenerCount()).toBe(0);
  });

  it('an already aborted signal never reaches Rust', async () => {
    const { host, api } = setup();
    const ctl = new AbortController();
    ctl.abort();
    await expect(host.complete(REQUEST, () => undefined, ctl.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(api.onToken).not.toHaveBeenCalled();
    expect(api.complete).not.toHaveBeenCalled();
  });

  it('two requests at once keep their tokens apart', async () => {
    const { host, api, emit } = setup();
    const a: string[] = [];
    const b: string[] = [];
    const pa = host.complete({ ...REQUEST, requestId: 'a' }, (d) => a.push(d), new AbortController().signal);
    const pb = host.complete({ ...REQUEST, requestId: 'b' }, (d) => b.push(d), new AbortController().signal);
    await vi.waitFor(() => expect(api.complete).toHaveBeenCalledTimes(2));
    emit.token('a', '1');
    emit.token('b', '2');
    emit.done('a', { text: '1', served: SERVED });
    emit.done('b', { text: '2', served: SERVED });
    await Promise.all([pa, pb]);
    expect([a, b]).toEqual([['1'], ['2']]);
  });
});

describe('aiHost channel ids', () => {
  it('maps request ids to event-safe names like the Rust side', () => {
    expect(aiChannelId('req-1_a')).toBe('req-1_a');
    expect(aiChannelId('ai:rewrite/1 x')).toBe('ai_rewrite_1_x');
  });
});

describe('aiHost registry methods', () => {
  const saved = parseAiSettings({
    'ai.engines': [{
      id: 'e1', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', futureKey: 7,
      models: [{ id: 'old', enabled: false, capabilities: { chat: true, stream: true, vision: false, json: true, tools: true, fim: false, embed: false, contextTokens: 8192 }, capabilitiesSource: 'user', manual: true }],
    }],
  });

  it('listEngines combines Rust\'s reachability with the saved models', async () => {
    const { host, api } = setup(saved.engines);
    api.listEngines.mockResolvedValueOnce([{ engineId: 'e1', ok: false, isLocal: true, hasKey: true, error: 'down' }]);
    const [status] = (await host.listEngines?.()) ?? [];
    expect(status).toMatchObject({ engineId: 'e1', ok: false, isLocal: true, hasKey: true, error: 'down' });
    expect(status.models.map((m) => m.id)).toEqual(['old']);
    expect(status.models[0].source).toBe('user');
  });

  it('passes on where the key came from, and says nothing when Rust does not', async () => {
    const { host, api } = setup(saved.engines);
    api.listEngines.mockResolvedValueOnce([{ engineId: 'e1', ok: true, isLocal: true, hasKey: true, keySource: 'file' }]);
    expect(((await host.listEngines?.()) ?? [])[0].keySource).toBe('file');
    api.listEngines.mockResolvedValueOnce([{ engineId: 'e1', ok: true, isLocal: true, hasKey: true }]);
    expect(((await host.listEngines?.()) ?? [])[0]).not.toHaveProperty('keySource');
  });

  it('an engine Rust has not seen yet is never-probed with locality from the URL', async () => {
    const { host } = setup(saved.engines);
    const [status] = (await host.listEngines?.()) ?? [];
    expect(status).toMatchObject({ ok: null, isLocal: true, hasKey: false });
  });

  it('testEngine returns the probe result', async () => {
    const { host } = setup(saved.engines);
    expect(await host.testEngine?.('e1')).toMatchObject({ engineId: 'e1', ok: true, latencyMs: 12 });
    await expect(host.testEngine?.('nope')).rejects.toMatchObject({ code: 'modelNotFound' });
  });

  it('discoverModels merges with core heuristics, keeps manual models and unknown keys, and persists', async () => {
    const { host, api, saveEngines } = setup(saved.engines);
    api.discoverModels.mockResolvedValueOnce({
      info: { engineId: 'e1', ok: true, isLocal: true, hasKey: false, latencyMs: 30 },
      models: [{ id: 'gemma-4-26b-a4b-it-qat-mlx-4bit', capabilities: { contextTokens: 131072, embed: false }, source: 'endpoint', loaded: true }],
    });
    const status = await host.discoverModels?.('e1');
    expect(saveEngines).toHaveBeenCalledTimes(1);
    const persisted = saveEngines.mock.calls[0][0][0];
    expect((persisted as unknown as { futureKey: number }).futureKey).toBe(7);
    expect(persisted.models.map((m) => m.id)).toEqual(['old', 'gemma-4-26b-a4b-it-qat-mlx-4bit']);
    expect(persisted.models[0].missing).toBeUndefined();
    const added = status?.models.find((m) => m.id.startsWith('gemma'));
    expect(added).toMatchObject({ source: 'endpoint', loaded: true });
    expect(added?.capabilities.contextTokens).toBe(131072);
    expect(added?.capabilities.chat).toBe(true);
    expect(status?.latencyMs).toBe(30);
  });

  it('a failed discovery reports the error in the status and saves nothing', async () => {
    const { host, api, saveEngines } = setup(saved.engines);
    api.discoverModels.mockRejectedValueOnce({ code: 'unreachable', message: 'Could not reach the engine' });
    const status = await host.discoverModels?.('e1');
    expect(status).toMatchObject({ ok: false, error: 'Could not reach the engine' });
    expect(saveEngines).not.toHaveBeenCalled();
  });

  it('setSecret passes the key (or null) to the keychain command and requestCloudConsent asks', async () => {
    const { host, api } = setup();
    await host.setSecret?.('e1', 'sk-123');
    await host.setSecret?.('e1', null);
    expect(api.setSecret.mock.calls).toEqual([['e1', 'sk-123'], ['e1', null]]);
    expect(await host.requestCloudConsent?.('e1')).toBe(true);
    api.setSecret.mockRejectedValueOnce({ code: 'unknown', message: 'The keychain refused the change: locked' });
    await expect(host.setSecret?.('e1', 'x')).rejects.toMatchObject({ message: expect.stringContaining('locked') });
  });
});

describe('TauriHost.ai', () => {
  async function makeHost(withAi: boolean) {
    const { TauriHost } = await import('../../src/host/tauriHost');
    const { createPathOps } = await import('../../src/host/pathOps');
    const { createDesktopSettingsStore } = await import('../../src/settings/desktopSettings');
    const fake = createFakeApi();
    return new TauriHost({
      doc: () => null,
      path: createPathOps('posix'),
      fs: { assetUrl: (p: string) => p },
      settings: createDesktopSettingsStore(),
      images: { uploadImage: vi.fn(), pickImage: vi.fn(), resizeImage: vi.fn() } as never,
      app: { onModelChanged: vi.fn(), onStats: vi.fn(), openPath: vi.fn(), notify: vi.fn() },
      ...(withAi ? { ai: { api: fake.api, settings: () => defaultAiSettings(), saveEngines: async () => undefined } } : {}),
    });
  }

  it('is a tier 2 host when the app wires the engine registry', async () => {
    const host = await makeHost(true);
    expect(host.ai).toBeDefined();
    for (const method of ['complete', 'listEngines', 'testEngine', 'discoverModels', 'setSecret', 'requestCloudConsent'] as const) {
      expect(typeof host.ai?.[method]).toBe('function');
    }
  });

  it('has no ai group otherwise, so core keeps every AI surface off', async () => {
    expect((await makeHost(false)).ai).toBeUndefined();
  });
});
