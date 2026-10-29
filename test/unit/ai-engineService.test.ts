/**
 * AiEngineService against fake adapters, secrets and consent: the cloud
 * gate, consent once per workspace, one in-flight request per panel, secrets
 * pruned when an engine disappears, statuses from probes and failures.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeAiError, parseAiSettings, type AiEngineKind, type AiSettings, type ProviderAdapter } from '@mikedown/core/ai';
import { AiEngineService, type EngineServiceDeps } from '../../src/ai/engineService';
import { createAdapters } from '../../src/ai/providers';
import { AiSecrets, KEY_FILE_MAX_BYTES, secretKey, type SecretStore } from '../../src/ai/secrets';
import { effectiveAiRaw, stableEngineIdGenerator } from '../../src/settings';

const rawSettings = {
  enabled: true,
  allowCloud: true,
  engines: [
    { id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', apiKeyEnv: 'OMLX_API_KEY', models: [{ id: 'qwen' }] },
    { id: 'claude', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', models: [{ id: 'claude-sonnet-5-5' }] },
  ],
  routing: { default: { engineId: 'omlx', modelId: 'qwen' }, fallback: 'none', tasks: {} },
};

function memoryStore(initial: Record<string, string> = {}): SecretStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: async (k) => data.get(k),
    store: async (k, v) => { data.set(k, v); },
    delete: async (k) => { data.delete(k); },
  };
}

function fakeAdapter(kind: AiEngineKind, overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    kind,
    listModels: async () => [],
    probe: async () => ({ ok: true, latencyMs: 5 }),
    complete: async (engine, apiKey, model, req, onToken) => {
      onToken('ok');
      return { text: `ok:${apiKey ?? 'none'}`, served: { engineId: engine.id, engineName: engine.name, modelId: model.id, isLocal: true }, finishReason: 'stop' };
    },
    ...overrides,
  };
}

function setup(raw: Record<string, unknown> = rawSettings, opts: { env?: Record<string, string>; askConsent?: boolean; adapters?: Partial<Record<AiEngineKind, Partial<ProviderAdapter>>> } = {}) {
  let settings: AiSettings = parseAiSettings(raw, { onWarning: () => {} });
  const store = memoryStore();
  const consent = new Map<string, boolean>();
  const log: string[] = [];
  const askConsent = vi.fn(async () => opts.askConsent ?? true);
  const saved: unknown[] = [];
  const adapters = new Map<AiEngineKind, ProviderAdapter>(
    (['openai-compatible', 'lmstudio', 'ollama', 'anthropic', 'openai'] as AiEngineKind[]).map((k) => [k, fakeAdapter(k, opts.adapters?.[k])]),
  );
  const deps: EngineServiceDeps = {
    readSettings: () => settings,
    secrets: new AiSecrets(store, opts.env ?? {}),
    consent: {
      get: (id) => consent.get(id),
      grant: async (id) => { consent.set(id, true); },
      forget: async (id) => { consent.delete(id); },
    },
    askConsent,
    saveEngines: async (engines) => { saved.push(engines); },
    log: (l) => log.push(l),
    adapters,
  };
  const service = new AiEngineService(deps);
  return {
    service, store, consent, log, askConsent, saved,
    setSettings: (next: Record<string, unknown>) => { settings = parseAiSettings(next, { onWarning: () => {} }); },
  };
}

const req = (route?: { engineId: string; modelId: string }, requestId = 'r1') => ({
  requestId, feature: 'rewrite', task: 'rewrite', messages: [{ role: 'user' as const, content: 'secret prompt text' }], ...(route ? { route } : {}),
});
const cloud = { engineId: 'claude', modelId: 'claude-sonnet-5-5' };

describe('cloud gate', () => {
  it('refuses a cloud engine with cloudBlocked while Allow cloud is off, even when the webview asked for it', async () => {
    const { service, askConsent } = setup({ ...rawSettings, allowCloud: false });
    await expect(service.complete({}, req(cloud), () => {})).rejects.toMatchObject({ code: 'cloudBlocked' });
    expect(askConsent).not.toHaveBeenCalled();
  });

  it('asks once per workspace per engine, then remembers', async () => {
    const { service, askConsent, consent } = setup();
    await service.complete({}, req(cloud, 'a'), () => {});
    await service.complete({}, req(cloud, 'b'), () => {});
    expect(askConsent).toHaveBeenCalledTimes(1);
    expect(consent.get('claude')).toBe(true);
    expect(await service.requestCloudConsent('claude')).toBe(true);
    expect(askConsent).toHaveBeenCalledTimes(1);
  });

  it('"Not now" rejects with consentDenied and is not stored, so the next attempt asks again', async () => {
    const { service, askConsent, consent } = setup(rawSettings, { askConsent: false });
    await expect(service.complete({}, req(cloud), () => {})).rejects.toMatchObject({ code: 'consentDenied' });
    expect(consent.has('claude')).toBe(false);
    expect(await service.requestCloudConsent('claude')).toBe(false);
    expect(askConsent).toHaveBeenCalledTimes(2);
  });

  it('local engines never ask', async () => {
    const { service, askConsent } = setup();
    expect(await service.requestCloudConsent('omlx')).toBe(true);
    await service.complete({}, req(), () => {});
    expect(askConsent).not.toHaveBeenCalled();
  });
});

describe('completions', () => {
  it('routes a request without a route through core, resolves the key from apiKeyEnv and logs without the prompt', async () => {
    const { service, log } = setup(rawSettings, { env: { OMLX_API_KEY: 'from-env' } });
    const tokens: string[] = [];
    const result = await service.complete({}, req(), (d) => tokens.push(d));
    expect(result.text).toBe('ok:from-env');
    expect(result.served).toEqual({ engineId: 'omlx', engineName: 'oMLX', modelId: 'qwen', isLocal: true });
    expect(tokens).toEqual(['ok']);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^rewrite\/rewrite · oMLX · qwen · local · \d+ ms · stop$/);
    expect(log.join('\n')).not.toContain('secret prompt');
  });

  it('adds the thinking level and max_tokens to the log line when the request sets one, and nothing otherwise', async () => {
    const { service, log } = setup(rawSettings, { env: { OMLX_API_KEY: 'sk-secret' } });
    await service.complete({}, { ...req(), requestOverrides: { reasoning_effort: 'high' }, maxTokens: 4096 }, () => {});
    expect(log[0]).toMatch(/^rewrite\/rewrite · oMLX · qwen · local · \d+ ms · stop · thinking high · max_tokens 4096$/);
    await service.complete({}, { ...req(), requestOverrides: { reasoning_effort: 'none' } }, () => {});
    expect(log[1]).toMatch(/· stop · thinking off$/);
    await service.complete({}, { ...req(), requestOverrides: { top_p: 0.5 } }, () => {});
    expect(log[2]).toMatch(/^rewrite\/rewrite · oMLX · qwen · local · \d+ ms · stop$/);
    await service.complete({}, req(), () => {});
    expect(log[3]).not.toContain('thinking');
    expect(log.join('\n')).not.toMatch(/secret|sk-/);
  });

  it('reads a thinking level from the model overrides, with the request winning', async () => {
    const raw = { ...rawSettings, engines: [{ ...rawSettings.engines[0], models: [{ id: 'qwen', requestOverrides: { reasoning_effort: 'low' } }] }, rawSettings.engines[1]] };
    const { service, log } = setup(raw);
    await service.complete({}, req(), () => {});
    expect(log[0]).toMatch(/· stop · thinking low$/);
    await service.complete({}, { ...req(), requestOverrides: { reasoning_effort: 'high' } }, () => {});
    expect(log[1]).toMatch(/· stop · thinking high$/);
  });

  it('a stored key wins over apiKeyEnv', async () => {
    const { service, store } = setup(rawSettings, { env: { OMLX_API_KEY: 'from-env' } });
    store.data.set(secretKey('omlx'), 'stored');
    expect((await service.complete({}, req(), () => {})).text).toBe('ok:stored');
  });

  it('a second request on the same panel cancels the first', async () => {
    const started: string[] = [];
    const { service, log } = setup(rawSettings, {
      adapters: {
        'openai-compatible': {
          complete: (engine, _key, model, r, _onToken, signal) => new Promise((resolve, reject) => {
            started.push(r.requestId);
            signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
            if (r.requestId === 'second') {resolve({ text: 'two', served: { engineName: engine.name, modelId: model.id, isLocal: true }, finishReason: 'stop' });}
          }),
        },
      },
    });
    const panel = {};
    const first = service.complete(panel, req(undefined, 'first'), () => {});
    await vi.waitFor(() => expect(started).toEqual(['first']));
    const second = service.complete(panel, req(undefined, 'second'), () => {});
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });
    await expect(second).resolves.toMatchObject({ text: 'two' });
    expect(log[0]).toMatch(/· cancelled$/);
    expect(service.hasInFlight(panel)).toBe(false);
  });

  it('closing the panel aborts its request; other panels keep theirs', async () => {
    const { service } = setup(rawSettings, {
      adapters: {
        'openai-compatible': {
          complete: (_e, _k, _m, _r, _t, signal) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          }),
        },
      },
    });
    const a = {};
    const b = {};
    const pa = service.complete(a, req(undefined, 'a'), () => {});
    void service.complete(b, req(undefined, 'b'), () => {}).catch(() => {});
    await vi.waitFor(() => expect(service.hasInFlight(a)).toBe(true));
    service.disposePanel(a);
    await expect(pa).rejects.toMatchObject({ code: 'cancelled' });
    expect(service.hasInFlight(b)).toBe(true);
  });

  it('an unreachable engine is marked failed so core can route around it', async () => {
    const { service } = setup(rawSettings, {
      adapters: { 'openai-compatible': { complete: async () => { throw makeAiError('unreachable', 'Could not reach http://127.0.0.1:8000 (ECONNREFUSED).'); } } },
    });
    const changed = vi.fn();
    service.onStatusesChanged(changed);
    await expect(service.complete({}, req(), () => {})).rejects.toMatchObject({ code: 'unreachable' });
    expect(service.cachedStatuses().find((s) => s.engineId === 'omlx')).toMatchObject({ ok: false, error: expect.stringContaining('ECONNREFUSED') });
    expect(changed).toHaveBeenCalled();
  });
});

describe('statuses, discovery and secrets', () => {
  it('listEngines probes stale local engines only; testEngine probes a cloud one on request', async () => {
    const probe = vi.fn(async () => ({ ok: true, latencyMs: 7 }));
    const { service } = setup(rawSettings, { adapters: { 'openai-compatible': { probe }, anthropic: { probe } } });
    const list = await service.listEngines();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(list.map((s) => [s.engineId, s.ok, s.isLocal])).toEqual([['omlx', true, true], ['claude', null, false]]);
    await service.listEngines();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(await service.testEngine('claude')).toMatchObject({ ok: true, latencyMs: 7 });
  });

  it('discoverModels merges into the saved engine', async () => {
    const { service, saved } = setup(rawSettings, {
      adapters: { 'openai-compatible': { listModels: async () => [{ id: 'gemma-4-26b-vl', capabilities: {}, source: 'heuristic' as const, loaded: true }] } },
    });
    const status = await service.discoverModels('omlx');
    expect(status.models.map((m) => [m.id, m.missing ?? false])).toEqual([['qwen', true], ['gemma-4-26b-vl', false]]);
    expect(status.models[1].loaded).toBe(true);
    const engines = saved[0] as Array<{ id: string; models: Array<{ id: string }> }>;
    expect(engines.find((e) => e.id === 'omlx')!.models.map((m) => m.id)).toEqual(['qwen', 'gemma-4-26b-vl']);
  });

  it('setSecret reports hasKey; a removed engine loses its key and consent', async () => {
    const { service, store, consent, setSettings } = setup();
    expect(await service.setSecret('claude', 'sk-ant-1')).toMatchObject({ hasKey: true, keySource: 'stored' });
    expect(store.data.get('mikedown.ai.apiKey.claude')).toBe('sk-ant-1');
    consent.set('claude', true);
    setSettings({ ...rawSettings, engines: [rawSettings.engines[0]] });
    expect(await service.settingsChanged()).toEqual(['claude']);
    expect(store.data.has('mikedown.ai.apiKey.claude')).toBe(false);
    expect(consent.has('claude')).toBe(false);
    const cleared = await service.setSecret('omlx', null);
    expect(cleared).toMatchObject({ hasKey: false });
    expect(cleared).not.toHaveProperty('keySource');
  });
});

describe('settings scope rules', () => {
  const inspect = (values: Record<string, Record<string, unknown>>) => (key: string) => values[key];

  it('engines and localNetworks come from user settings only', () => {
    const raw = effectiveAiRaw(inspect({
      engines: { globalValue: [{ id: 'mine' }], workspaceValue: [{ id: 'evil' }] },
      localNetworks: { globalValue: ['10.0.98.0/24'], workspaceValue: ['0.0.0.0/0'] },
    }));
    expect(raw.engines).toEqual([{ id: 'mine' }]);
    expect(raw.localNetworks).toEqual(['10.0.98.0/24']);
  });

  it('a workspace can turn allowCloud off but not on', () => {
    expect(effectiveAiRaw(inspect({ allowCloud: { globalValue: false, workspaceValue: true } })).allowCloud).toBe(false);
    expect(effectiveAiRaw(inspect({ allowCloud: { globalValue: true, workspaceValue: false } })).allowCloud).toBe(false);
    expect(effectiveAiRaw(inspect({ allowCloud: { globalValue: true } })).allowCloud).toBe(true);
  });

  it('enabled, routing and features follow normal precedence', () => {
    const raw = effectiveAiRaw(inspect({ enabled: { defaultValue: false, globalValue: true, workspaceValue: false } }));
    expect(raw.enabled).toBe(false);
  });

  it('engines without an id get the same id on every parse', () => {
    const engines = [{ name: 'oMLX (Studio)', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1' }];
    const a = parseAiSettings({ engines }, { generateId: stableEngineIdGenerator(), onWarning: () => {} }).engines[0].id;
    const b = parseAiSettings({ engines }, { generateId: stableEngineIdGenerator(), onWarning: () => {} }).engines[0].id;
    expect(a).toBe(b);
    expect(a).toMatch(/^omlx-studio-[a-z0-9]+$/);
  });
});

describe('cloud gate, more', () => {
  const second = { id: 'gpt', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', models: [{ id: 'gpt-5.5' }] };
  const two = { ...rawSettings, engines: [...rawSettings.engines, second] };

  it('a refused cloud request never reaches the adapter', async () => {
    const complete = vi.fn();
    const { service } = setup({ ...rawSettings, allowCloud: false }, { adapters: { anthropic: { complete } } });
    await expect(service.complete({}, req(cloud), () => {})).rejects.toMatchObject({ code: 'cloudBlocked' });
    expect(complete).not.toHaveBeenCalled();
  });

  it('a denied consent never reaches the adapter', async () => {
    const complete = vi.fn();
    const { service } = setup(rawSettings, { askConsent: false, adapters: { anthropic: { complete } } });
    await expect(service.complete({}, req(cloud), () => {})).rejects.toMatchObject({ code: 'consentDenied' });
    expect(complete).not.toHaveBeenCalled();
  });

  it('consent is per engine: a second cloud engine asks on its own', async () => {
    const { service, askConsent, consent } = setup(two);
    await service.complete({}, req(cloud, 'a'), () => {});
    await service.complete({}, req({ engineId: 'gpt', modelId: 'gpt-5.5' }, 'b'), () => {});
    expect(askConsent).toHaveBeenCalledTimes(2);
    expect([...consent.keys()].sort()).toEqual(['claude', 'gpt']);
  });

  it('two requests racing for the same engine share one prompt', async () => {
    const { service, askConsent } = setup();
    await Promise.all([service.complete({}, req(cloud, 'a'), () => {}), service.complete({}, req(cloud, 'b'), () => {})]);
    expect(askConsent).toHaveBeenCalledTimes(1);
  });

  it('a stored consent survives a new service (a reopened workspace) without asking', async () => {
    const first = setup();
    await first.service.complete({}, req(cloud), () => {});
    const askAgain = vi.fn(async () => true);
    const reopened = new AiEngineService({
      readSettings: () => parseAiSettings(rawSettings, { onWarning: () => {} }),
      secrets: new AiSecrets(memoryStore(), {}),
      consent: { get: (id) => first.consent.get(id), grant: async () => {}, forget: async () => {} },
      askConsent: askAgain,
      saveEngines: async () => {},
      log: () => {},
      adapters: new Map([['anthropic', fakeAdapter('anthropic')]]),
    });
    await reopened.complete({}, req(cloud), () => {});
    expect(askAgain).not.toHaveBeenCalled();
  });

  it('the consent prompt is told which feature asked', async () => {
    const { service, askConsent } = setup();
    await service.complete({}, req(cloud), () => {});
    expect(askConsent).toHaveBeenCalledWith(expect.objectContaining({ id: 'claude' }), 'rewrite');
  });

  it('a request routed by core (no route) to a cloud default is also gated', async () => {
    const { service, askConsent } = setup({ ...rawSettings, allowCloud: false, routing: { default: cloud, fallback: 'none', tasks: {} } });
    await expect(service.complete({}, req(), () => {})).rejects.toMatchObject({ code: 'cloudBlocked' });
    expect(askConsent).not.toHaveBeenCalled();
  });

  it('AI turned off refuses everything before any engine is touched', async () => {
    const complete = vi.fn();
    const { service } = setup({ ...rawSettings, enabled: false }, { adapters: { 'openai-compatible': { complete } } });
    await expect(service.complete({}, req(), () => {})).rejects.toMatchObject({ message: expect.stringContaining('turned off') });
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('in-flight requests', () => {
  function holding(): { complete: ProviderAdapter['complete']; started: string[] } {
    const started: string[] = [];
    return {
      started,
      complete: (engine, _k, model, r, _t, signal) => new Promise((resolve, reject) => {
        started.push(r.requestId);
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        if (r.requestId.startsWith('finish')) {resolve({ text: r.requestId, served: { engineName: engine.name, modelId: model.id, isLocal: true }, finishReason: 'stop' });}
      }),
    };
  }

  it('the cancelled first request does not clear the second one from the panel', async () => {
    const h = holding();
    const { service } = setup(rawSettings, { adapters: { 'openai-compatible': { complete: h.complete } } });
    const panel = {};
    const first = service.complete(panel, req(undefined, 'first'), () => {});
    await vi.waitFor(() => expect(h.started).toEqual(['first']));
    const second = service.complete(panel, req(undefined, 'second'), () => {});
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });
    expect(service.hasInFlight(panel)).toBe(true);
    service.cancel(panel, 'second');
    await expect(second).rejects.toMatchObject({ code: 'cancelled' });
    expect(service.hasInFlight(panel)).toBe(false);
  });

  it('a request on another panel is not cancelled by a new one', async () => {
    const h = holding();
    const { service } = setup(rawSettings, { adapters: { 'openai-compatible': { complete: h.complete } } });
    const a = {};
    const b = {};
    const pa = service.complete(a, req(undefined, 'a'), () => {});
    pa.catch(() => {});
    await vi.waitFor(() => expect(service.hasInFlight(a)).toBe(true));
    await expect(service.complete(b, req(undefined, 'finish-b'), () => {})).resolves.toMatchObject({ text: 'finish-b' });
    expect(service.hasInFlight(a)).toBe(true);
    service.disposePanel(a);
    await expect(pa).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('cancel with a stale requestId leaves the running request alone', async () => {
    const h = holding();
    const { service } = setup(rawSettings, { adapters: { 'openai-compatible': { complete: h.complete } } });
    const panel = {};
    const running = service.complete(panel, req(undefined, 'current'), () => {});
    running.catch(() => {});
    await vi.waitFor(() => expect(service.hasInFlight(panel)).toBe(true));
    service.cancel(panel, 'old');
    expect(service.hasInFlight(panel)).toBe(true);
    service.cancel(panel, 'current');
    await expect(running).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('tokens after a cancel are dropped', async () => {
    let emit: ((d: string) => void) | undefined;
    const { service } = setup(rawSettings, {
      adapters: {
        'openai-compatible': {
          complete: (_e, _k, _m, _r, onToken, signal) => new Promise((_resolve, reject) => {
            emit = onToken;
            signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          }),
        },
      },
    });
    const panel = {};
    const tokens: string[] = [];
    const pending = service.complete(panel, req(undefined, 'r'), (d) => tokens.push(d));
    await vi.waitFor(() => expect(emit).toBeDefined());
    emit!('one');
    service.cancel(panel, 'r');
    emit!('two');
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(tokens).toEqual(['one']);
  });

  it('dispose aborts every running request', async () => {
    const h = holding();
    const { service } = setup(rawSettings, { adapters: { 'openai-compatible': { complete: h.complete } } });
    const pending = service.complete({}, req(undefined, 'x'), () => {});
    await vi.waitFor(() => expect(h.started).toEqual(['x']));
    service.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('API key resolution through the real adapters', () => {
  function realSetup(env: Record<string, string>, stored?: string) {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      const body = 'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const store = memoryStore(stored ? { [secretKey('omlx')]: stored } : {});
    const service = new AiEngineService({
      readSettings: () => parseAiSettings(rawSettings, { onWarning: () => {} }),
      secrets: new AiSecrets(store, env),
      consent: { get: () => undefined, grant: async () => {}, forget: async () => {} },
      askConsent: async () => true,
      saveEngines: async () => {},
      log: () => {},
      adapters: createAdapters({ fetch }),
    });
    return { service, calls };
  }

  it('uses apiKeyEnv when no secret is stored', async () => {
    const { service, calls } = realSetup({ OMLX_API_KEY: 'env-key' });
    await service.complete({}, req(), () => {});
    expect(calls[0].headers.authorization).toBe('Bearer env-key');
  });

  it('prefers the stored secret over apiKeyEnv', async () => {
    const { service, calls } = realSetup({ OMLX_API_KEY: 'env-key' }, 'stored-key');
    await service.complete({}, req(), () => {});
    expect(calls[0].headers.authorization).toBe('Bearer stored-key');
  });

  it('sends no authorization header when neither exists', async () => {
    const { service, calls } = realSetup({});
    await service.complete({}, req(), () => {});
    expect(Object.keys(calls[0].headers).map((h) => h.toLowerCase())).not.toContain('authorization');
  });

  it('probes use the same resolution', async () => {
    const { service, calls } = realSetup({ OMLX_API_KEY: 'env-key' });
    await service.testEngine('omlx');
    expect(calls[0].url).toBe('http://127.0.0.1:8000/v1/models');
    expect(calls[0].headers.authorization).toBe('Bearer env-key');
  });
});

describe('AiSecrets', () => {
  it('ignores an empty or unset apiKeyEnv value and an engine without apiKeyEnv', async () => {
    const secrets = new AiSecrets(memoryStore(), { EMPTY: '  ' });
    expect(await secrets.resolve({ id: 'a', apiKeyEnv: 'EMPTY' })).toBeNull();
    expect(await secrets.resolve({ id: 'a', apiKeyEnv: 'MISSING' })).toBeNull();
    expect(await secrets.resolve({ id: 'a' })).toBeNull();
  });

  it('set trims, and null or blank deletes', async () => {
    const store = memoryStore();
    const secrets = new AiSecrets(store, {});
    await secrets.set('a', '  sk-1  ');
    expect(store.data.get(secretKey('a'))).toBe('sk-1');
    await secrets.set('a', '   ');
    expect(store.data.has(secretKey('a'))).toBe(false);
  });

  it('hasKey is true for an env key alone', async () => {
    expect(await new AiSecrets(memoryStore(), { K: 'v' }).hasKey({ id: 'a', apiKeyEnv: 'K' })).toBe(true);
  });
});

describe('secrets follow the settings', () => {
  it('only the engine that disappeared loses its key; the others keep theirs', async () => {
    const { service, store, setSettings } = setup();
    await service.setSecret('omlx', 'k-omlx');
    await service.setSecret('claude', 'k-claude');
    setSettings({ ...rawSettings, engines: [rawSettings.engines[0]] });
    expect(await service.settingsChanged()).toEqual(['claude']);
    expect(store.data.get(secretKey('omlx'))).toBe('k-omlx');
    expect(store.data.has(secretKey('claude'))).toBe(false);
    expect(await service.settingsChanged()).toEqual([]);
  });

  it('removing every engine deletes every key', async () => {
    const { service, store, setSettings } = setup();
    await service.setSecret('omlx', 'a');
    await service.setSecret('claude', 'b');
    setSettings({ ...rawSettings, engines: [] });
    expect((await service.settingsChanged()).sort()).toEqual(['claude', 'omlx']);
    expect(store.data.size).toBe(0);
  });

  it('editing an engine in place (same id) keeps its key', async () => {
    const { service, store, setSettings } = setup();
    await service.setSecret('claude', 'k');
    setSettings({ ...rawSettings, engines: [rawSettings.engines[0], { ...rawSettings.engines[1], name: 'Claude renamed' }] });
    expect(await service.settingsChanged()).toEqual([]);
    expect(store.data.get(secretKey('claude'))).toBe('k');
  });

  it('a changed base URL voids the cached probe', async () => {
    const probe = vi.fn(async () => ({ ok: true, latencyMs: 3 }));
    const { service, setSettings } = setup(rawSettings, { adapters: { 'openai-compatible': { probe } } });
    await service.testEngine('omlx');
    expect(service.cachedStatuses().find((s) => s.engineId === 'omlx')?.ok).toBe(true);
    setSettings({ ...rawSettings, engines: [{ ...rawSettings.engines[0], baseUrl: 'http://127.0.0.1:9000/v1' }, rawSettings.engines[1]] });
    expect(service.cachedStatuses().find((s) => s.engineId === 'omlx')?.ok).toBeNull();
  });
});

describe('AiSecrets key file', () => {
  const dirs: string[] = [];
  const tmp = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mikedown-keyfile-')));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    while (dirs.length) {fs.rmSync(dirs.pop()!, { recursive: true, force: true });}
  });

  /** A fake home with `.omlx/settings.json` holding `body`, and a secrets object rooted there. */
  function setup(body: string | null, env: Record<string, string> = {}, store = memoryStore()) {
    const home = tmp();
    fs.mkdirSync(path.join(home, '.omlx'));
    if (body !== null) {fs.writeFileSync(path.join(home, '.omlx', 'settings.json'), body);}
    const log: string[] = [];
    const secrets = new AiSecrets(store, env, () => home, (l) => log.push(l));
    return { home, log, secrets, store };
  }
  const omlx = { id: 'omlx', apiKeyEnv: 'OMLX_API_KEY', apiKeyFile: { path: '~/.omlx/settings.json', jsonPath: 'auth.api_key' } };
  const good = JSON.stringify({ auth: { api_key: ' sk-file ' } });

  it('reads the key through ~ and answers hasKey from the file alone', async () => {
    const { secrets } = setup(good);
    expect(await secrets.resolve(omlx)).toBe('sk-file');
    expect(await secrets.hasKey(omlx)).toBe(true);
  });

  it('the order is stored, then the variable, then the file', async () => {
    const store = memoryStore({ [secretKey('omlx')]: 'stored' });
    const { secrets, home } = setup(good, { OMLX_API_KEY: 'from-env' }, store);
    expect(await secrets.resolve(omlx)).toBe('stored');
    await secrets.delete('omlx');
    expect(await secrets.resolve(omlx)).toBe('from-env');
    expect(await new AiSecrets(store, {}, () => home).resolve(omlx)).toBe('sk-file');
  });

  it('names the source of the key: stored, variable or file', async () => {
    const store = memoryStore({ [secretKey('omlx')]: 'stored' });
    const { secrets, home } = setup(good, { OMLX_API_KEY: 'from-env' }, store);
    expect(await secrets.resolveWithSource(omlx)).toEqual({ key: 'stored', source: 'stored' });
    await secrets.delete('omlx');
    expect(await secrets.resolveWithSource(omlx)).toEqual({ key: 'from-env', source: 'env' });
    const fileOnly = new AiSecrets(store, {}, () => home);
    expect(await fileOnly.resolveWithSource(omlx)).toEqual({ key: 'sk-file', source: 'file' });
    expect(await fileOnly.resolveWithSource({ id: 'omlx' })).toBeNull();
  });

  it('accepts an absolute path under home', async () => {
    const { secrets, home } = setup(good);
    const abs = { ...omlx, apiKeyFile: { path: path.join(home, '.omlx', 'settings.json'), jsonPath: 'auth.api_key' } };
    expect(await secrets.resolve(abs)).toBe('sk-file');
  });

  it('refuses a file outside home, and relative paths', async () => {
    const { secrets, log } = setup(good);
    const elsewhere = tmp();
    fs.writeFileSync(path.join(elsewhere, 'k.json'), good);
    expect(await secrets.resolve({ ...omlx, apiKeyFile: { path: path.join(elsewhere, 'k.json'), jsonPath: 'auth.api_key' } })).toBeNull();
    expect(await secrets.resolve({ ...omlx, apiKeyFile: { path: '~/../' + path.basename(elsewhere) + '/k.json', jsonPath: 'auth.api_key' } })).toBeNull();
    expect(await secrets.resolve({ ...omlx, apiKeyFile: { path: 'k.json', jsonPath: 'auth.api_key' } })).toBeNull();
    expect(log.join('\n')).toContain('outside the home folder');
  });

  it.skipIf(process.platform === 'win32')('refuses a symlink that escapes home and follows one that stays inside', async () => {
    const { secrets, home, log } = setup(null);
    const elsewhere = tmp();
    fs.writeFileSync(path.join(elsewhere, 'k.json'), good);
    fs.symlinkSync(path.join(elsewhere, 'k.json'), path.join(home, '.omlx', 'settings.json'));
    expect(await secrets.resolve(omlx)).toBeNull();
    expect(log[0]).toContain('outside the home folder');

    fs.writeFileSync(path.join(home, 'real.json'), good);
    fs.symlinkSync(path.join(home, 'real.json'), path.join(home, 'link.json'));
    expect(await secrets.resolve({ ...omlx, apiKeyFile: { path: '~/link.json', jsonPath: 'auth.api_key' } })).toBe('sk-file');
  });

  it('refuses a file over 64 KB and a directory', async () => {
    const { secrets, home } = setup(JSON.stringify({ auth: { api_key: 'big' }, pad: 'x'.repeat(KEY_FILE_MAX_BYTES) }));
    expect(await secrets.resolve(omlx)).toBeNull();
    expect(await secrets.resolve({ ...omlx, apiKeyFile: { path: '~/.omlx', jsonPath: 'auth.api_key' } })).toBeNull();
    expect(fs.statSync(path.join(home, '.omlx', 'settings.json')).size).toBeGreaterThan(KEY_FILE_MAX_BYTES);
  });

  it('ignores a missing file, bad JSON, a non-string, a blank string and a missing path, and logs without leaking', async () => {
    const missing = setup(null);
    expect(await missing.secrets.resolve(omlx)).toBeNull();
    expect(missing.log).toHaveLength(1);

    for (const body of ['{ nope sk-leak', JSON.stringify({ auth: { api_key: 42 } }), JSON.stringify({ auth: { api_key: '  ' } }), JSON.stringify({ auth: 'sk-leak' }), JSON.stringify({ auth: { api_key: { v: 'sk-leak' } } }), JSON.stringify({})]) {
      const { secrets, log } = setup(body);
      expect(await secrets.resolve(omlx)).toBeNull();
      expect(await secrets.hasKey(omlx)).toBe(false);
      expect(log.length).toBeGreaterThan(0);
      expect(log.join('\n')).not.toContain('sk-leak');
    }
  });

  it('logs one distinct failure once, and again after it recovers and fails anew', async () => {
    const { secrets, log, home } = setup('{ bad');
    await secrets.hasKey(omlx);
    await secrets.hasKey(omlx);
    expect(log).toHaveLength(1);
    fs.writeFileSync(path.join(home, '.omlx', 'settings.json'), good);
    expect(await secrets.resolve(omlx)).toBe('sk-file');
    fs.writeFileSync(path.join(home, '.omlx', 'settings.json'), '{ bad');
    await secrets.hasKey(omlx);
    expect(log).toHaveLength(2);
  });

  it('an engine without a key file, or with blank parts, gets nothing and logs nothing', async () => {
    const { secrets, log } = setup(good);
    expect(await secrets.resolve({ id: 'omlx' })).toBeNull();
    expect(await secrets.resolve({ id: 'omlx', apiKeyFile: { path: ' ', jsonPath: 'auth.api_key' } })).toBeNull();
    expect(log).toEqual([]);
  });

  it('the service sends the file key and reports hasKey, never the key itself', async () => {
    const { secrets } = setup(good);
    let sent: string | null = null;
    const settings = parseAiSettings({ ...rawSettings, engines: [{ ...rawSettings.engines[0], apiKeyFile: omlx.apiKeyFile }], routing: { default: { engineId: 'omlx', modelId: 'qwen' }, fallback: 'none', tasks: {} } }, { onWarning: () => {} });
    const adapter = fakeAdapter('openai-compatible', {
      complete: async (engine, apiKey, model, _req, onToken) => {
        sent = apiKey;
        onToken('ok');
        return { text: 'ok', served: { engineId: engine.id, engineName: engine.name, modelId: model.id, isLocal: true }, finishReason: 'stop' };
      },
    });
    const service = new AiEngineService({
      readSettings: () => settings,
      secrets,
      consent: { get: () => undefined, grant: async () => {}, forget: async () => {} },
      askConsent: async () => true,
      saveEngines: async () => {},
      log: () => {},
      adapters: new Map([['openai-compatible', adapter]]),
    });
    await service.complete({}, req(), () => {});
    expect(sent).toBe('sk-file');
    const status = await service.listEngines();
    expect(status[0].hasKey).toBe(true);
    expect(JSON.stringify(status)).not.toContain('sk-file');
  });
});
