// @vitest-environment node
/**
 * Opt-in live checks of the VS Code AI adapters against real local servers:
 * oMLX (`OMLX_API_KEY`), LM Studio and, when it happens to be running,
 * Ollama. Off unless `MIKEDOWN_AI_LIVE=1`; run with `npm run test:ai-live`.
 * A server that is not reachable skips its tests, it never fails them.
 * Completions are 20 tokens, use a model the server already has loaded, and
 * never ask LM Studio to load one.
 *
 * Overrides: `MIKEDOWN_AI_LIVE_OMLX_URL`, `MIKEDOWN_AI_LIVE_LMSTUDIO_URL`,
 * `MIKEDOWN_AI_LIVE_OLLAMA_URL` (base URLs ending in /v1) and
 * `MIKEDOWN_AI_LIVE_{OMLX,LMSTUDIO,OLLAMA}_MODEL`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { AI_ENGINE_PRESETS, parseAiSettings, type AiCompletionRequest, type AiDiscoveredModel, type AiEngineConfig, type AiEngineKind } from '@mikedown/core/ai';
import { AiEngineService } from '../../src/ai/engineService';
import { AiSecrets } from '../../src/ai/secrets';
import { createAdapters } from '../../src/ai/providers';

const LIVE = process.env.MIKEDOWN_AI_LIVE === '1';
const env = process.env;

interface Target {
  label: string;
  kind: AiEngineKind;
  baseUrl: string;
  apiKeyEnv?: string;
  modelOverride?: string;
  /** Root used to decide whether anything listens there at all. */
  reachable: boolean;
  engine: AiEngineConfig;
  /** A model that is already loaded and can chat, or undefined. */
  model?: string;
  skipReason?: string;
}

const TARGET_DEFS = [
  { label: 'oMLX', kind: 'openai-compatible' as const, baseUrl: env.MIKEDOWN_AI_LIVE_OMLX_URL ?? 'http://127.0.0.1:8000/v1', apiKeyEnv: 'OMLX_API_KEY', modelOverride: env.MIKEDOWN_AI_LIVE_OMLX_MODEL },
  { label: 'LM Studio', kind: 'lmstudio' as const, baseUrl: env.MIKEDOWN_AI_LIVE_LMSTUDIO_URL ?? 'http://127.0.0.1:1234/v1', modelOverride: env.MIKEDOWN_AI_LIVE_LMSTUDIO_MODEL },
  { label: 'Ollama', kind: 'ollama' as const, baseUrl: env.MIKEDOWN_AI_LIVE_OLLAMA_URL ?? 'http://127.0.0.1:11434/v1', modelOverride: env.MIKEDOWN_AI_LIVE_OLLAMA_MODEL },
];

function engineFor(def: (typeof TARGET_DEFS)[number], models: Array<{ id: string }> = []): AiEngineConfig {
  const raw = { id: def.kind, name: def.label, kind: def.kind, baseUrl: def.baseUrl, ...(def.apiKeyEnv ? { apiKeyEnv: def.apiKeyEnv } : {}), models };
  return parseAiSettings({ enabled: true, engines: [raw] }, { onWarning: () => {} }).engines[0];
}

function rootOf(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, '');
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Is anything listening? Any HTTP answer counts, a 401 included. */
async function listening(baseUrl: string): Promise<boolean> {
  try {
    await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

/** A chat-capable model the server already has in memory. */
async function loadedModel(def: (typeof TARGET_DEFS)[number], discovered: AiDiscoveredModel[]): Promise<string | undefined> {
  if (def.modelOverride) {return def.modelOverride;}
  const chat = discovered.filter((m) => m.capabilities.chat !== false && m.capabilities.embed !== true && !/whisper|embed/i.test(m.id));
  if (def.kind === 'openai-compatible') {
    // oMLX: /api/status lists what is in memory (same key as /v1).
    const status = await getJson(`${rootOf(def.baseUrl)}/api/status`, def.apiKeyEnv && env[def.apiKeyEnv] ? { authorization: `Bearer ${env[def.apiKeyEnv]}` } : {});
    const loaded: string[] = Array.isArray(status?.loaded_models) ? status.loaded_models : [];
    const inMemory = chat.filter((m) => loaded.includes(m.id));
    // The "flash" builds are the small, fast ones.
    return (inMemory.find((m) => /flash/i.test(m.id)) ?? inMemory[0])?.id;
  }
  return chat.find((m) => m.loaded === true)?.id;
}

const targets = new Map<string, Target>();

const request = (requestId: string, content: string, maxTokens: number): AiCompletionRequest => ({
  requestId, feature: 'rewrite', task: 'rewrite', maxTokens, temperature: 0, messages: [{ role: 'user', content }],
});

function serviceFor(t: Target): { service: AiEngineService; log: string[] } {
  const log: string[] = [];
  const settings = parseAiSettings({
    enabled: true,
    engines: [{ ...t.engine, models: [{ id: t.model ?? 'none' }] }],
    routing: { default: { engineId: t.engine.id, modelId: t.model ?? 'none' }, fallback: 'none', tasks: {} },
  }, { onWarning: () => {} });
  const service = new AiEngineService({
    readSettings: () => settings,
    secrets: new AiSecrets({ get: async () => undefined, store: async () => {}, delete: async () => {} }, process.env),
    consent: { get: () => undefined, grant: async () => {}, forget: async () => {} },
    askConsent: async () => false,
    saveEngines: async () => {},
    log: (l) => log.push(l),
    adapters: createAdapters(),
  });
  return { service, log };
}

describe.skipIf(!LIVE)('live AI engines', () => {
  beforeAll(async () => {
    for (const def of TARGET_DEFS) {
      const engine = engineFor(def);
      const adapter = createAdapters().get(def.kind)!;
      const reachable = await listening(def.baseUrl);
      const t: Target = { ...def, reachable, engine };
      if (!reachable) {
        t.skipReason = `${def.label} is not reachable at ${def.baseUrl}`;
      } else if (def.apiKeyEnv && !env[def.apiKeyEnv]) {
        t.skipReason = `${def.apiKeyEnv} is not set`;
      } else {
        try {
          const key = def.apiKeyEnv ? env[def.apiKeyEnv] ?? null : null;
          t.model = await loadedModel(def, await adapter.listModels(engine, key, AbortSignal.timeout(15000)));
        } catch {
          // Discovery has its own test; completions just skip without a model.
        }
      }
      targets.set(def.label, t);
    }
  }, 60_000);

  for (const def of TARGET_DEFS) {
    describe(def.label, () => {
      const target = (ctx: { skip: (note?: string) => never }): Target => {
        const t = targets.get(def.label)!;
        if (t.skipReason) {ctx.skip(t.skipReason);}
        return t;
      };
      const withModel = (ctx: { skip: (note?: string) => never }): Target & { model: string } => {
        const t = target(ctx);
        if (!t.model) {ctx.skip(`${def.label} has no chat model loaded; not loading one for a test`);}
        return t as Target & { model: string };
      };
      const key = (t: Target): string | null => (t.apiKeyEnv ? env[t.apiKeyEnv] ?? null : null);

      it('probe answers ok with a latency', async (ctx) => {
        const t = target(ctx);
        const probe = await createAdapters().get(t.kind)!.probe(t.engine, key(t), AbortSignal.timeout(10000));
        expect(probe.error).toBeUndefined();
        expect(probe.ok).toBe(true);
        expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
      }, 30_000);

      if (def.apiKeyEnv) {
        it('probe without the key is auth', async (ctx) => {
          const t = target(ctx);
          const probe = await createAdapters().get(t.kind)!.probe(t.engine, null, AbortSignal.timeout(10000));
          // A server run without auth answers ok; a keyed one must say auth.
          if (probe.ok) {ctx.skip(`${def.label} accepts requests without a key`);}
          expect(probe.error?.code).toBe('auth');
        }, 30_000);
      }

      it('discovery lists models with ids and capabilities', async (ctx) => {
        const t = target(ctx);
        const models = await createAdapters().get(t.kind)!.listModels(t.engine, key(t), AbortSignal.timeout(15000));
        expect(models.length).toBeGreaterThan(0);
        for (const m of models) {
          expect(typeof m.id).toBe('string');
          expect(m.id.length).toBeGreaterThan(0);
          expect(['endpoint', 'heuristic']).toContain(m.source);
        }
        if (def.kind === 'lmstudio') {
          expect(models.some((m) => m.source === 'endpoint')).toBe(true);
        }
      }, 30_000);

      it('streams a 20-token completion', async (ctx) => {
        const t = withModel(ctx);
        const { service, log } = serviceFor(t);
        const tokens: string[] = [];
        const result = await service.complete({}, request('live-1', 'Count from one to ten in words.', 20), (d) => tokens.push(d));
        expect(['stop', 'length']).toContain(result.finishReason);
        expect(result.served).toMatchObject({ engineId: t.engine.id, modelId: t.model, isLocal: true });
        // A reasoning model can spend 20 tokens thinking: then there is no visible text, but the stream still completed.
        expect(tokens.join('')).toBe(result.text);
        expect(log).toHaveLength(1);
        expect(log[0]).toMatch(/· local · \d+ ms · (stop|length)/);
        expect(log[0]).not.toContain('Count from one');
      }, 120_000);

      it('a cancelled completion rejects cancelled and leaves the server answering', async (ctx) => {
        const t = withModel(ctx);
        const { service } = serviceFor(t);
        const panel = {};
        const started = Date.now();
        // Cancel on the first token, or after 4 s when a reasoning model is still thinking.
        const cancel = (): void => service.cancel(panel, 'live-2');
        const timer = setTimeout(cancel, 4000);
        const pending = service.complete(panel, request('live-2', 'Write a very long story about a lighthouse keeper, at least 2000 words.', 2000), cancel);
        await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
        clearTimeout(timer);
        expect(service.hasInFlight(panel)).toBe(false);
        expect(Date.now() - started).toBeLessThan(15000);
        const probe = await createAdapters().get(t.kind)!.probe(t.engine, key(t), AbortSignal.timeout(10000));
        expect(probe.ok).toBe(true);
      }, 60_000);
    });
  }
});

/**
 * The oMLX preset finds its key in `~/.omlx/settings.json` when `OMLX_API_KEY` is
 * not set (a Dock-launched VS Code). Run with `env -u OMLX_API_KEY` to prove it
 * against the real file; with the variable set the variable wins and the test
 * still passes. The key is never printed.
 */
describe.skipIf(!LIVE)('live oMLX key file', () => {
  it('resolves a non-empty key from the real settings file and the server accepts it', async (ctx) => {
    const preset = AI_ENGINE_PRESETS.find((p) => p.id === 'omlx')!;
    const baseUrl = env.MIKEDOWN_AI_LIVE_OMLX_URL ?? preset.baseUrl;
    if (!(await listening(baseUrl))) {ctx.skip(`oMLX is not reachable at ${baseUrl}`);}
    const engine = parseAiSettings({
      enabled: true,
      engines: [{ id: 'omlx', name: preset.name, kind: preset.kind, baseUrl, apiKeyEnv: preset.apiKeyEnv, apiKeyFile: preset.apiKeyFile }],
    }, { onWarning: () => {} }).engines[0];
    const log: string[] = [];
    const secrets = new AiSecrets({ get: async () => undefined, store: async () => {}, delete: async () => {} }, process.env, undefined, (l) => log.push(l));
    const key = await secrets.resolve(engine);
    if (!key && log.some((l) => l.includes('ENOENT'))) {ctx.skip('no ~/.omlx/settings.json on this machine');}
    expect(typeof key).toBe('string');
    expect((key ?? '').length).toBeGreaterThan(0);
    expect(await secrets.hasKey(engine)).toBe(true);
    const probe = await createAdapters().get(engine.kind)!.probe(engine, key, AbortSignal.timeout(10000));
    expect(probe.error).toBeUndefined();
    expect(probe.ok).toBe(true);
  }, 30_000);
});
