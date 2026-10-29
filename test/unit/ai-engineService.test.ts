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
import { AiEngineService, consentFingerprint, type ConsentDialogAnswer, type EngineServiceDeps, type StoredConsent } from '../../src/ai/engineService';
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

function setup(raw: Record<string, unknown> = rawSettings, opts: { env?: Record<string, string>; askConsent?: ConsentDialogAnswer; adapters?: Partial<Record<AiEngineKind, Partial<ProviderAdapter>>>; now?: () => number } = {}) {
  let settings: AiSettings = parseAiSettings(raw, { onWarning: () => {} });
  const store = memoryStore();
  const consent = new Map<string, StoredConsent>();
  const log: string[] = [];
  const askConsent = vi.fn(async (): Promise<ConsentDialogAnswer> => opts.askConsent ?? 'allow');
  const saved: unknown[] = [];
  const adapters = new Map<AiEngineKind, ProviderAdapter>(
    (['openai-compatible', 'lmstudio', 'ollama', 'anthropic', 'openai'] as AiEngineKind[]).map((k) => [k, fakeAdapter(k, opts.adapters?.[k])]),
  );
  const deps: EngineServiceDeps = {
    readSettings: () => settings,
    secrets: new AiSecrets(store, opts.env ?? {}),
    consent: {
      get: (id) => consent.get(id),
      set: async (id, record) => { consent.set(id, record); },
      forget: async (id) => { consent.delete(id); },
      ids: () => [...consent.keys()],
    },
    askConsent,
    saveEngines: async (engines) => { saved.push(engines); },
    log: (l) => log.push(l),
    adapters,
    ...(opts.now ? { now: opts.now } : {}),
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
    expect(consent.get('claude')).toMatchObject({ answer: 'allow', fingerprint: expect.any(String), at: expect.any(Number) });
    expect(await service.requestCloudConsent('claude')).toBe(true);
    expect(askConsent).toHaveBeenCalledTimes(1);
  });

  it('"Don\'t allow" rejects with consentDenied, is not stored, and is answered without asking for the rest of the session', async () => {
    const { service, askConsent, consent } = setup(rawSettings, { askConsent: 'deny' });
    await expect(service.complete({}, req(cloud), () => {})).rejects.toMatchObject({ code: 'consentDenied' });
    expect(consent.has('claude')).toBe(false);
    expect(await service.requestCloudConsent('claude')).toBe(false);
    await expect(service.complete({}, req(cloud, 'b'), () => {})).rejects.toMatchObject({ code: 'consentDenied' });
    expect(askConsent).toHaveBeenCalledTimes(1);
    expect(service.consentState()).toEqual({ claude: false });
  });

  it('"Allow once" lets the next completion through, stores nothing, and the one after asks again', async () => {
    const { service, askConsent, consent } = setup(rawSettings, { askConsent: 'allowOnce' });
    expect(await service.requestCloudConsent('claude')).toBe('once');
    expect(consent.has('claude')).toBe(false);
    expect(service.consentState()).toEqual({});
    expect(service.listConsents()).toEqual([]);
    await expect(service.complete({}, req(cloud, 'a'), () => {})).resolves.toMatchObject({ text: expect.stringContaining('ok') });
    expect(askConsent).toHaveBeenCalledTimes(1);
    // The grant is used up: this completion asks (and is allowed once again).
    await service.complete({}, req(cloud, 'b'), () => {});
    expect(askConsent).toHaveBeenCalledTimes(2);
    expect(consent.has('claude')).toBe(false);
  });

  it('a stored "never" from an older version refuses without asking and routes as a refusal', async () => {
    const { service, askConsent, consent } = setup();
    consent.set('claude', { fingerprint: consentFingerprint(parseAiSettings(rawSettings, { onWarning: () => {} }).engines[1]), answer: 'never', at: 1 });
    await expect(service.complete({}, req(cloud, 'a'), () => {})).rejects.toMatchObject({ code: 'consentDenied', message: expect.stringContaining('turned off') });
    expect(await service.requestCloudConsent('claude')).toBe('never');
    expect(askConsent).not.toHaveBeenCalled();
    expect(service.consentState()).toEqual({ claude: false });
  });

  it('a stored answer for an engine that points elsewhere now counts as never asked (B4)', async () => {
    const { service, askConsent, consent, setSettings } = setup();
    consent.set('claude', { fingerprint: consentFingerprint(parseAiSettings(rawSettings, { onWarning: () => {} }).engines[1]), answer: 'allow', at: 1 });
    expect(service.consentState()).toEqual({ claude: true });
    expect(await service.requestCloudConsent('claude')).toBe(true);
    expect(askConsent).not.toHaveBeenCalled();

    setSettings({ ...rawSettings, engines: [rawSettings.engines[0], { ...rawSettings.engines[1], baseUrl: 'https://proxy.example.com' }] });
    expect(service.consentState()).toEqual({});
    expect(service.listConsents()).toEqual([]);
    await service.settingsChanged();
    expect(consent.has('claude')).toBe(false);
    expect(await service.requestCloudConsent('claude')).toBe(true);
    expect(askConsent).toHaveBeenCalledTimes(1);
  });

  it('adding a key or a trailing slash does not change what a consent is for', () => {
    const [, claude] = parseAiSettings(rawSettings, { onWarning: () => {} }).engines;
    expect(consentFingerprint({ ...claude, baseUrl: 'https://API.anthropic.com/' })).toBe(consentFingerprint(claude));
    expect(consentFingerprint({ ...claude, apiKeyEnv: 'ANTHROPIC_API_KEY' })).toBe(consentFingerprint(claude));
    expect(consentFingerprint({ ...claude, baseUrl: 'https://proxy.example.com' })).not.toBe(consentFingerprint(claude));
  });

  it('requestCloudConsent rejects with cloudBlocked while Allow cloud is off, and never asks', async () => {
    const { service, askConsent } = setup({ ...rawSettings, allowCloud: false });
    await expect(service.requestCloudConsent('claude')).rejects.toMatchObject({ code: 'cloudBlocked' });
    expect(askConsent).not.toHaveBeenCalled();
    expect(await service.requestCloudConsent('omlx')).toBe(true);
  });

  it('lists the stored answers newest first and forgets one, so the next attempt asks again', async () => {
    const { service, askConsent, consent } = setup({
      ...rawSettings,
      engines: [...rawSettings.engines, { id: 'oai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', models: [{ id: 'gpt' }] }],
    });
    expect(service.listConsents()).toEqual([]);
    await service.requestCloudConsent('claude');
    await service.requestCloudConsent('oai');
    consent.get('claude')!.at = 100;
    consent.get('oai')!.at = 200;
    expect(service.listConsents()).toEqual([
      { engineId: 'oai', answer: 'allow', at: 200, scope: 'workspace' },
      { engineId: 'claude', answer: 'allow', at: 100, scope: 'workspace' },
    ]);
    await service.forgetConsent('claude');
    expect(service.listConsents().map((r) => r.engineId)).toEqual(['oai']);
    await service.requestCloudConsent('claude');
    expect(askConsent).toHaveBeenCalledTimes(3);
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
    expect(log[0]).toMatch(/^rewrite\/rewrite · oMLX · qwen · local · \d+ ms · stop(?: · first token \d+ ms)?$/);
    expect(log.join('\n')).not.toContain('secret prompt');
  });

  it('adds the thinking level and max_tokens to the log line when the request sets one, and nothing otherwise', async () => {
    const { service, log } = setup(rawSettings, { env: { OMLX_API_KEY: 'sk-secret' } });
    await service.complete({}, { ...req(), requestOverrides: { reasoning_effort: 'high' }, maxTokens: 4096 }, () => {});
    expect(log[0]).toMatch(/^rewrite\/rewrite · oMLX · qwen · local · \d+ ms · stop · thinking high · max_tokens 4096(?: · first token \d+ ms)?$/);
    await service.complete({}, { ...req(), requestOverrides: { reasoning_effort: 'none' } }, () => {});
    expect(log[1]).toMatch(/· stop · thinking off(?: · first token \d+ ms)?$/);
    await service.complete({}, { ...req(), requestOverrides: { top_p: 0.5 } }, () => {});
    expect(log[2]).toMatch(/^rewrite\/rewrite · oMLX · qwen · local · \d+ ms · stop(?: · first token \d+ ms)?$/);
    await service.complete({}, req(), () => {});
    expect(log[3]).not.toContain('thinking');
    expect(log.join('\n')).not.toMatch(/secret|sk-/);
  });

  it('reads a thinking level from the model overrides, with the request winning', async () => {
    const raw = { ...rawSettings, engines: [{ ...rawSettings.engines[0], models: [{ id: 'qwen', requestOverrides: { reasoning_effort: 'low' } }] }, rawSettings.engines[1]] };
    const { service, log } = setup(raw);
    await service.complete({}, req(), () => {});
    expect(log[0]).toMatch(/· stop · thinking low(?: · first token \d+ ms)?$/);
    await service.complete({}, { ...req(), requestOverrides: { reasoning_effort: 'high' } }, () => {});
    expect(log[1]).toMatch(/· stop · thinking high(?: · first token \d+ ms)?$/);
  });

  it('logs the time to the first token and the speed from the adapter\'s timing and usage', async () => {
    const { service, log } = setup(rawSettings, {
      adapters: {
        'openai-compatible': {
          complete: async (engine, _key, model) => ({
            text: 'Short.', served: { engineId: engine.id, engineName: engine.name, modelId: model.id, isLocal: true }, finishReason: 'stop',
            usage: { promptTokens: 418, completionTokens: 68 }, timing: { totalMs: 2400, firstTokenMs: 600, outputChars: 300 },
          }),
        },
      },
    });
    const result = await service.complete({}, req(), () => {});
    expect(result.timing).toEqual({ totalMs: 2400, firstTokenMs: 600, outputChars: 300 });
    expect(log[0]).toMatch(/· stop · 418 in, 68 out · first token 600 ms · 38 tok\/s$/);
  });

  it('an adapter that does not time the request (VS Code LM) is timed by the service', async () => {
    let t = 1000;
    const { service } = setup(rawSettings, {
      now: () => t,
      adapters: {
        'openai-compatible': {
          complete: async (engine, _key, model, _req, onToken) => {
            t += 300;
            onToken('Short answer.');
            t += 1000;
            return { text: 'Short answer.', served: { engineId: engine.id, engineName: engine.name, modelId: model.id, isLocal: true }, finishReason: 'stop' };
          },
        },
      },
    });
    const result = await service.complete({}, req(), () => {});
    expect(result.timing).toEqual({ totalMs: 1300, firstTokenMs: 300, outputChars: 13 });
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

  it('B1: a key from the engine variable is reported as env; a stored key wins', async () => {
    const { service } = setup(rawSettings, { env: { OMLX_API_KEY: 'from-env' } });
    const omlx = (list: Awaited<ReturnType<typeof service.listEngines>>) => list.find((s) => s.engineId === 'omlx');
    expect(omlx(await service.listEngines())).toMatchObject({ hasKey: true, keySource: 'env' });
    expect(await service.setSecret('omlx', 'stored-key')).toMatchObject({ hasKey: true, keySource: 'stored' });
  });

  it('setSecret reports hasKey; a removed engine loses its key and consent', async () => {
    const { service, store, consent, setSettings } = setup();
    expect(await service.setSecret('claude', 'sk-ant-1')).toMatchObject({ hasKey: true, keySource: 'stored' });
    expect(store.data.get('mikedown.ai.apiKey.claude')).toBe('sk-ant-1');
    consent.set('claude', { fingerprint: 'x', answer: 'allow', at: 1 });
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
    expect(askConsent).toHaveBeenCalledWith(expect.objectContaining({ id: 'claude' }), 'rewrite', undefined);
  });

  it('the consent prompt is told what the request sends (whole-document Translate)', async () => {
    const { service, askConsent } = setup();
    await service.requestCloudConsent('claude', 'rewrite', 'document');
    expect(askConsent).toHaveBeenCalledWith(expect.objectContaining({ id: 'claude' }), 'rewrite', 'document');
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

describe('consent answers and fingerprints (T2)', () => {
  const claudeRaw = rawSettings.engines[1];
  const routedToClaude = { ...rawSettings, routing: { default: { engineId: 'claude', modelId: 'claude-sonnet-5-5' }, fallback: 'none', tasks: {} } };

  it('a stored "never" and this session\'s "Don\'t allow" are voided when the engine points somewhere else, and the next request asks again', async () => {
    const { service, askConsent, consent, setSettings } = setup(rawSettings, { askConsent: 'deny' });
    consent.set('claude', { fingerprint: consentFingerprint(parseAiSettings(rawSettings, { onWarning: () => {} }).engines[1]), answer: 'never', at: 1 });
    await expect(service.complete({}, req(cloud), () => {})).rejects.toMatchObject({ code: 'consentDenied' });
    expect(service.consentState()).toEqual({ claude: false });
    expect(askConsent).not.toHaveBeenCalled();

    setSettings({ ...rawSettings, engines: [rawSettings.engines[0], { ...claudeRaw, baseUrl: 'https://proxy.example.com' }] });
    expect(service.consentState()).toEqual({});
    await service.settingsChanged();
    expect(consent.has('claude')).toBe(false);
    await expect(service.complete({}, req({ engineId: 'claude', modelId: 'claude-sonnet-5-5' }, 'b'), () => {})).rejects.toMatchObject({ code: 'consentDenied' });
    expect(askConsent).toHaveBeenCalledTimes(1);
    expect(service.consentState()).toEqual({ claude: false });

    setSettings({ ...rawSettings, engines: [rawSettings.engines[0], { ...claudeRaw, baseUrl: 'https://other.example.com' }] });
    expect(service.consentState()).toEqual({});
    expect(await service.requestCloudConsent('claude')).toBe(false);
    expect(askConsent).toHaveBeenCalledTimes(2);
  });

  it('changing the engine kind voids the answer too', async () => {
    const { service, consent, setSettings } = setup();
    await service.requestCloudConsent('claude');
    expect(service.consentState()).toEqual({ claude: true });
    setSettings({ ...rawSettings, engines: [rawSettings.engines[0], { ...claudeRaw, kind: 'openai' }] });
    expect(service.consentState()).toEqual({});
    await service.settingsChanged();
    expect(consent.has('claude')).toBe(false);
  });

  it('an engine that is deleted takes its consent with it, and does not show in the list', async () => {
    const { service, consent, setSettings } = setup();
    await service.requestCloudConsent('claude');
    expect(service.listConsents().map((r) => r.engineId)).toEqual(['claude']);
    setSettings({ ...rawSettings, engines: [rawSettings.engines[0]] });
    expect(service.listConsents()).toEqual([]);
    await service.settingsChanged();
    expect(consent.has('claude')).toBe(false);
  });

  it('a stored "never" refuses a request that came without a route, without asking', async () => {
    const { service, askConsent, consent } = setup(routedToClaude);
    consent.set('claude', { fingerprint: consentFingerprint(parseAiSettings(routedToClaude, { onWarning: () => {} }).engines[1]), answer: 'never', at: 1 });
    await expect(service.complete({}, req(), () => {})).rejects.toMatchObject({ code: 'consentDenied' });
    expect(askConsent).not.toHaveBeenCalled();
  });

  it('"Allow once" on a request without a route sends it, is not stored and asks again next time; the answers log differently', async () => {
    const { service, askConsent, consent, log } = setup(routedToClaude, { askConsent: 'allowOnce' });
    await service.complete({}, req(undefined, 'a'), () => {});
    await service.complete({}, req(undefined, 'b'), () => {});
    expect(askConsent).toHaveBeenCalledTimes(2);
    expect(consent.size).toBe(0);
    expect(log.join('\n')).toContain('allowed once');
    expect(log.join('\n')).not.toContain('allowed for this workspace');
  });

  it('"Don\'t allow" on a request without a route refuses it and the next one without asking', async () => {
    const { service, askConsent, consent, log } = setup(routedToClaude, { askConsent: 'deny' });
    await expect(service.complete({}, req(undefined, 'a'), () => {})).rejects.toMatchObject({ code: 'consentDenied' });
    await expect(service.complete({}, req(undefined, 'b'), () => {})).rejects.toMatchObject({ code: 'consentDenied' });
    expect(askConsent).toHaveBeenCalledTimes(1);
    expect(consent.size).toBe(0);
    expect(log.join('\n')).toContain('not allowed until restart');
  });

  it('forgetting a stored "never" lets the next request ask again', async () => {
    const { service, askConsent, consent } = setup();
    consent.set('claude', { fingerprint: consentFingerprint(parseAiSettings(rawSettings, { onWarning: () => {} }).engines[1]), answer: 'never', at: 1 });
    expect(service.listConsents()).toMatchObject([{ engineId: 'claude', answer: 'never', scope: 'workspace' }]);
    await service.forgetConsent('claude');
    expect(service.listConsents()).toEqual([]);
    await service.requestCloudConsent('claude');
    expect(askConsent).toHaveBeenCalledTimes(1);
  });

  it('this session\'s "Don\'t allow" is listed, and forgetting it lets the next request ask again', async () => {
    const { service, askConsent, consent } = setup(rawSettings, { askConsent: 'deny' });
    await service.requestCloudConsent('claude');
    expect(consent.size).toBe(0);
    expect(service.listConsents()).toEqual([{ engineId: 'claude', answer: 'deny', at: expect.any(Number), scope: 'workspace' }]);
    await service.forgetConsent('claude');
    expect(service.listConsents()).toEqual([]);
    expect(service.consentState()).toEqual({});
    await service.requestCloudConsent('claude');
    expect(askConsent).toHaveBeenCalledTimes(2);
  });

  it('records the answer with a timestamp from the service clock', async () => {
    const { service, consent } = setup();
    const before = Date.now();
    await service.requestCloudConsent('claude');
    expect(consent.get('claude')!.at).toBeGreaterThanOrEqual(before);
  });
});

describe('detectLocalServers (T1)', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  /** A fetch that answers per URL, remembers every request, and hangs (until aborted) for a URL it has no answer for. */
  function fakeFetch(routes: Record<string, (init: RequestInit | undefined) => Response | Promise<Response>>) {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, headers: { ...(init?.headers as Record<string, string> | undefined) } });
      const route = routes[url];
      if (route) {return Promise.resolve(route(init));}
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      });
    });
    return { fetch, calls };
  }

  function service(fetch: EngineServiceDeps['fetch'], opts: { env?: Record<string, string>; now?: () => number } = {}) {
    const log: string[] = [];
    const settings = parseAiSettings({ enabled: true, engines: [] }, { onWarning: () => {} });
    const svc = new AiEngineService({
      readSettings: () => settings,
      // A home with no ~/.omlx, so a developer's real oMLX key file never answers for the test.
      secrets: new AiSecrets(memoryStore(), opts.env ?? {}, () => path.join(os.tmpdir(), 'mikedown-no-such-home')),
      consent: { get: () => undefined, set: async () => {}, forget: async () => {}, ids: () => [] },
      askConsent: async () => 'allow',
      saveEngines: async () => {},
      log: (l) => log.push(l),
      adapters: new Map(),
      fetch,
      now: opts.now,
    });
    return { svc, log };
  }

  const LMS = { presetId: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1' };
  const OLLAMA = { presetId: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' };
  const OMLX = { presetId: 'omlx', baseUrl: 'http://127.0.0.1:8000/v1' };
  const LMS_URL = 'http://127.0.0.1:1234/api/v0/models';
  const OLLAMA_URL = 'http://127.0.0.1:11434/api/tags';
  const OMLX_URL = 'http://127.0.0.1:8000/v1/models';

  afterEach(() => { vi.useRealTimers(); });

  it('asks each address its own native list in parallel, counts the models, and logs one line', async () => {
    const { fetch, calls } = fakeFetch({
      [LMS_URL]: () => json({ data: [{ id: 'a', type: 'llm' }, { id: 'b', type: 'vlm' }, { id: 'e', type: 'embeddings' }] }),
      [OLLAMA_URL]: () => json({ models: [{ name: 'llama3' }] }),
      [OMLX_URL]: () => Promise.reject(new TypeError('fetch failed')),
    });
    let t = 1000;
    const { svc, log } = service(fetch, { now: () => (t += 7) });
    const probes = await svc.detectLocalServers([OMLX, LMS, OLLAMA]);
    expect(probes).toEqual([
      { ...OMLX, ok: false },
      { ...LMS, ok: true, models: 2, latencyMs: expect.any(Number) },
      { ...OLLAMA, ok: true, models: 1, latencyMs: expect.any(Number) },
    ]);
    expect(calls.map((c) => c.url).sort()).toEqual([LMS_URL, OLLAMA_URL, OMLX_URL].sort());
    // A GET that carries no key to a server that did not ask for one.
    expect(calls.every((c) => !('authorization' in c.headers))).toBe(true);
    expect(log).toEqual(['Detect local servers: oMLX no answer, LM Studio ok (2 models), Ollama ok (1 model).']);
  });

  it('gives up on an address after 1.5 s, not before, and answers the rest on time', async () => {
    vi.useFakeTimers();
    const { fetch } = fakeFetch({ [LMS_URL]: () => json({ data: [{ id: 'a' }] }) });
    const { svc, log } = service(fetch);
    let done = false;
    const run = svc.detectLocalServers([LMS, OLLAMA]).then((p) => { done = true; return p; });
    await vi.advanceTimersByTimeAsync(1499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const probes = await run;
    expect(probes[0]).toMatchObject({ presetId: 'lmstudio', ok: true, models: 1 });
    expect(probes[1]).toEqual({ ...OLLAMA, ok: false });
    expect(log).toEqual(['Detect local servers: LM Studio ok (1 model), Ollama no answer.']);
  });

  it('never caches: every call asks again and reports what is there now', async () => {
    let up = false;
    const { fetch, calls } = fakeFetch({ [OLLAMA_URL]: () => (up ? json({ models: [{ name: 'a' }, { name: 'b' }] }) : Promise.reject(new TypeError('fetch failed'))) });
    const { svc, log } = service(fetch);
    expect((await svc.detectLocalServers([OLLAMA]))[0].ok).toBe(false);
    up = true;
    expect((await svc.detectLocalServers([OLLAMA]))[0]).toMatchObject({ ok: true, models: 2 });
    expect(calls).toHaveLength(2);
    expect(log).toEqual(['Detect local servers: Ollama no answer.', 'Detect local servers: Ollama ok (2 models).']);
    // Nor does it touch the engine status cache.
    expect(await svc.listEngines()).toEqual([]);
  });

  it('counts a server that answers with a body of another shape as running, without a count', async () => {
    const { fetch } = fakeFetch({ [OLLAMA_URL]: () => json({ hello: 'world' }) });
    const { svc, log } = service(fetch);
    const [probe] = await svc.detectLocalServers([OLLAMA]);
    expect(probe).toMatchObject({ ok: true });
    expect(probe).not.toHaveProperty('models');
    expect(log[0]).toBe('Detect local servers: Ollama ok.');
  });

  it('retries a 401 once with the preset\'s own key (oMLX), and a server that stays shut says it needs a key', async () => {
    const authed = fakeFetch({
      [OMLX_URL]: (init) => ((init?.headers as Record<string, string>).authorization === 'Bearer sk-omlx' ? json({ data: [{ id: 'qwen' }] }) : json({ error: 'no key' }, 401)),
    });
    const withKey = service(authed.fetch, { env: { OMLX_API_KEY: 'sk-omlx' } });
    expect((await withKey.svc.detectLocalServers([OMLX]))[0]).toMatchObject({ ok: true, models: 1 });
    expect(authed.calls).toHaveLength(2);
    expect(authed.calls[0].headers.authorization).toBeUndefined();
    expect(authed.calls[1].headers.authorization).toBe('Bearer sk-omlx');
    expect(withKey.log).toEqual(['Detect local servers: oMLX ok (1 model).']);

    const shut = fakeFetch({ [OMLX_URL]: () => json({ error: 'no key' }, 401) });
    const noKey = service(shut.fetch);
    expect((await noKey.svc.detectLocalServers([OMLX]))[0]).toEqual({ ...OMLX, ok: false });
    expect(shut.calls).toHaveLength(1);
    expect(noKey.log).toEqual(['Detect local servers: oMLX needs a key.']);
  });

  it('sends a key only to the preset\'s own address, never to another host that asks', async () => {
    const elsewhere = { presetId: 'omlx', baseUrl: 'http://10.0.0.5:8000/v1' };
    const { fetch, calls } = fakeFetch({ 'http://10.0.0.5:8000/v1/models': () => json({ error: 'no key' }, 401) });
    const { svc } = service(fetch, { env: { OMLX_API_KEY: 'sk-omlx' } });
    expect((await svc.detectLocalServers([elsewhere]))[0].ok).toBe(false);
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls)).not.toContain('sk-omlx');
  });

  it('refuses anything that is not a known local preset at an http address, without a request', async () => {
    const { fetch } = fakeFetch({});
    const { svc, log } = service(fetch);
    const probes = await svc.detectLocalServers([
      { presetId: 'anthropic', baseUrl: 'https://api.anthropic.com' },
      { presetId: 'custom', baseUrl: 'http://127.0.0.1:8000/v1' },
      { presetId: 'ollama', baseUrl: 'file:///etc/passwd' },
      { presetId: 'ollama' },
      'junk',
      null,
      42,
    ]);
    expect(probes.map((p) => p.ok)).toEqual(Array(7).fill(false));
    expect(fetch).not.toHaveBeenCalled();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^Detect local servers: Anthropic not a local preset, /);
  });

  it('looks at no more than 32 candidates, and an empty list asks nothing', async () => {
    const { fetch } = fakeFetch({ [OLLAMA_URL]: () => json({ models: [] }) });
    const { svc, log } = service(fetch);
    expect(await svc.detectLocalServers(Array.from({ length: 40 }, () => OLLAMA))).toHaveLength(32);
    expect(await svc.detectLocalServers([])).toEqual([]);
    expect(log[1]).toBe('Detect local servers: nothing asked.');
  });
});

describe('key source in the engine list (B1, T1)', () => {
  it('names a key found in the engine\'s variable as env, and never sends the key itself', async () => {
    const { service } = setup(rawSettings, { env: { OMLX_API_KEY: 'from-env' } });
    const omlx = (await service.listEngines()).find((s) => s.engineId === 'omlx');
    expect(omlx).toMatchObject({ hasKey: true, keySource: 'env' });
    expect(JSON.stringify(omlx)).not.toContain('from-env');
  });
});
