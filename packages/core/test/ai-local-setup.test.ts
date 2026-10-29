/**
 * One-click local setup and detection (M1) without any UI: `setUpLocalEngine`
 * saves the engine early to fetch its models, ends with one patch of engines,
 * routing and `ai.enabled`, and takes the early engine back on every failure;
 * `detectLocalServers` answers null rather than "nothing found" when the host
 * cannot say; `bestLocalServer` offers the running server that is not set up.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAiSettings } from '../src/ai';
import type { AiEngineStatus, AiLocalServerProbe, AiSettings, MikeDownAiHost } from '../src/ai';
import { bestLocalServer, detectLocalServers, setUpLocalEngine } from '../src/ai-local-setup';

const caps = { chat: true, stream: true, vision: false, json: true, tools: true, fim: false, embed: false, contextTokens: null };
const model = (id: string, over: Record<string, unknown> = {}) => ({ id, capabilities: { ...caps, ...over }, source: 'endpoint' as const });
const status = (engineId: string, over: Partial<AiEngineStatus> = {}): AiEngineStatus => ({ engineId, ok: true, isLocal: true, hasKey: false, models: [{ ...model('gemma-3'), loaded: true }], ...over });

afterEach(() => { vi.useRealTimers(); });

/** A host that echoes saved engines, as VS Code and Desktop do. */
function setup(over: { discover?: (id: string) => Promise<AiEngineStatus>; existing?: unknown[]; noDiscover?: boolean } = {}) {
  let host: AiSettings = parseAiSettings({ enabled: false, engines: over.existing ?? [] }, { onWarning: () => {} });
  const saves: Array<Record<string, unknown>> = [];
  const discoverModels = vi.fn(over.discover ?? (async (id: string) => status(id)));
  const ai = { complete: vi.fn(), listEngines: vi.fn(async () => []), setSecret: vi.fn(async () => {}), ...(over.noDiscover ? {} : { discoverModels }) } as unknown as MikeDownAiHost;
  const onStatuses = vi.fn();
  const options = {
    ai,
    settings: host,
    statuses: [] as AiEngineStatus[],
    getHostSettings: () => host,
    saveNow: (patch: Record<string, unknown>) => {
      saves.push(patch);
      if (patch['ai.engines']) {host = { ...host, engines: parseAiSettings({ engines: patch['ai.engines'] }, { onWarning: () => {} }).engines };}
    },
    waitForSettings: async (accept: (s: AiSettings) => boolean) => (accept(host) ? host : null),
    onStatuses,
  };
  return { options, saves, discoverModels, host: () => host, onStatuses };
}

describe('setUpLocalEngine', () => {
  it('adds the engine, fetches its models, routes to the loaded chat model and turns AI on, in one patch', async () => {
    const t = setup({ discover: async (id) => status(id, { models: [model('nomic-embed', { chat: false, embed: true }), model('qwen3'), { ...model('gemma-3'), loaded: true }] }) });
    const result = await setUpLocalEngine(t.options, 'lmstudio');

    expect(result.route).toEqual({ engineId: result.engineId, modelId: 'gemma-3' });
    expect(Object.keys(result.patch).sort()).toEqual(['ai.enabled', 'ai.engines', 'ai.routing']);
    expect(result.patch['ai.enabled']).toBe(true);
    expect(result.settings).toMatchObject({ enabled: true, routing: { default: result.route } });
    const engine = result.settings.engines.find((e) => e.id === result.engineId)!;
    expect(engine).toMatchObject({ name: 'LM Studio', kind: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1' });
    expect(engine.models.map((m) => m.id)).toEqual(expect.arrayContaining(['gemma-3', 'qwen3']));
    // The host had to know the engine before it could fetch: one quiet early save, then nothing more from here.
    expect(t.saves).toHaveLength(1);
    expect(Object.keys(t.saves[0])).toEqual(['ai.engines']);
    expect(t.discoverModels).toHaveBeenCalledExactlyOnceWith(result.engineId);
    expect(t.onStatuses).toHaveBeenCalled();
  });

  it('gives the new engine an id that does not collide with an existing one', async () => {
    const t = setup({ existing: [{ id: 'lm-studio', name: 'LM Studio', kind: 'lmstudio', baseUrl: 'http://127.0.0.1:1235/v1', models: [] }] });
    const result = await setUpLocalEngine(t.options, 'lmstudio');
    expect(result.engineId).not.toBe('lm-studio');
    expect(result.settings.engines).toHaveLength(2);
  });

  describe('when it fails, the early-saved engine is taken back and the reason is readable', () => {
    const engineIds = (t: ReturnType<typeof setup>) => t.host().engines.map((e) => e.id);

    it('the fetch throws', async () => {
      const t = setup({ discover: async () => { throw new Error('connection refused'); } });
      await expect(setUpLocalEngine(t.options, 'lmstudio')).rejects.toThrow('Could not fetch the models from LM Studio: connection refused');
      expect(t.saves).toHaveLength(2);
      expect(engineIds(t)).toEqual([]);
    });

    it('the host answers not ok', async () => {
      const t = setup({ discover: async (id) => status(id, { ok: false, error: 'HTTP 500' }) });
      await expect(setUpLocalEngine(t.options, 'ollama')).rejects.toThrow('Could not fetch the models from Ollama: HTTP 500');
      expect(engineIds(t)).toEqual([]);
    });

    it('the server lists no chat model', async () => {
      const t = setup({ discover: async (id) => status(id, { models: [] }) });
      await expect(setUpLocalEngine(t.options, 'lmstudio')).rejects.toThrow('LM Studio has no chat model loaded or downloaded yet.');
      expect(engineIds(t)).toEqual([]);
      const embeddingsOnly = setup({ discover: async (id) => status(id, { models: [model('nomic-embed', { chat: false, embed: true })] }) });
      await expect(setUpLocalEngine(embeddingsOnly.options, 'lmstudio')).rejects.toThrow(/no chat model/);
      expect(engineIds(embeddingsOnly)).toEqual([]);
    });

    it('nothing loaded and no sizes to go by: no guess, it asks for a pick in Set up', async () => {
      const t = setup({ discover: async (id) => status(id, { models: [model('glm-5.3'), model('qwen3')] }) });
      await expect(setUpLocalEngine(t.options, 'lmstudio')).rejects.toThrow('LM Studio has no model loaded. Load one there, or choose Set up to pick one.');
      expect(engineIds(t)).toEqual([]);
    });

    it('keeps the engines that were there before', async () => {
      const t = setup({ existing: [{ id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', models: [] }], discover: async () => { throw new Error('nope'); } });
      await expect(setUpLocalEngine(t.options, 'lmstudio')).rejects.toThrow();
      expect(engineIds(t)).toEqual(['omlx']);
    });
  });

  it('refuses a preset that is not a known local server, and a host that cannot fetch models, before saving anything', async () => {
    const t = setup();
    await expect(setUpLocalEngine(t.options, 'anthropic')).rejects.toThrow('That local server is not one MikeDown knows.');
    await expect(setUpLocalEngine(t.options, 'nope')).rejects.toThrow('not one MikeDown knows');
    const none = setup({ noDiscover: true });
    await expect(setUpLocalEngine(none.options, 'lmstudio')).rejects.toThrow('This app cannot fetch models.');
    expect(t.saves).toHaveLength(0);
    expect(none.saves).toHaveLength(0);
  });
});

describe('detectLocalServers (the host round trip)', () => {
  const probes: AiLocalServerProbe[] = [{ presetId: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', ok: true, models: 2 }];
  const hostWith = (detect?: MikeDownAiHost['detectLocalServers']) => ({ complete: vi.fn(), ...(detect ? { detectLocalServers: detect } : {}) }) as unknown as MikeDownAiHost;

  it('asks about every local preset but Custom and returns what the host answered', async () => {
    const detect = vi.fn(async () => probes);
    expect(await detectLocalServers(hostWith(detect))).toEqual(probes);
    const candidates = detect.mock.calls[0][0] as Array<{ presetId: string }>;
    expect(candidates.map((c) => c.presetId)).toEqual(['omlx', 'lmstudio', 'ollama', 'llamacpp', 'vllm']);
  });

  it('answers null, not "nothing found", when the host cannot detect, fails, or sends something else', async () => {
    expect(await detectLocalServers(hostWith())).toBeNull();
    expect(await detectLocalServers(hostWith(async () => { throw new Error('bridge gone'); }))).toBeNull();
    expect(await detectLocalServers(hostWith((async () => 'nonsense') as never))).toBeNull();
    expect(await detectLocalServers(hostWith(async () => null as never))).toBeNull();
  });

  it('answers null when already aborted, when aborted meanwhile, and when the host never answers', async () => {
    const detect = vi.fn(async () => probes);
    const gone = new AbortController();
    gone.abort();
    expect(await detectLocalServers(hostWith(detect), gone.signal)).toBeNull();
    expect(detect).not.toHaveBeenCalled();

    vi.useFakeTimers();
    const live = new AbortController();
    const slow = hostWith(() => new Promise<AiLocalServerProbe[]>((resolve) => setTimeout(() => resolve(probes), 10_000)));
    const meanwhile = detectLocalServers(slow, live.signal);
    live.abort();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await meanwhile).toBeNull();

    // The host's own cap is 1.5 s per address; the round trip gives up a little after that.
    const stuck = detectLocalServers(hostWith(() => new Promise<AiLocalServerProbe[]>(() => {})));
    await vi.advanceTimersByTimeAsync(2999);
    let settled = false;
    void stuck.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await stuck).toBeNull();
  });

  it('hands the host a signal that fires when the caller aborts', async () => {
    let seen: AbortSignal | undefined;
    const caller = new AbortController();
    const pending = detectLocalServers(hostWith((_c, signal) => { seen = signal; return new Promise(() => {}); }), caller.signal);
    await Promise.resolve();
    expect(seen?.aborted).toBe(false);
    caller.abort();
    expect(seen?.aborted).toBe(true);
    void pending;
  });
});

describe('bestLocalServer', () => {
  const probe = (presetId: string, ok: boolean, models?: number): AiLocalServerProbe => ({ presetId, baseUrl: { lmstudio: 'http://127.0.0.1:1234/v1', ollama: 'http://127.0.0.1:11434/v1', omlx: 'http://127.0.0.1:8000/v1' }[presetId]!, ok, ...(models === undefined ? {} : { models }) });
  const lmsEngine = parseAiSettings({ engines: [{ id: 'lms', name: 'LM Studio', kind: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', models: [] }] }, { onWarning: () => {} }).engines;

  it('offers the running server with the most models', () => {
    expect(bestLocalServer([probe('lmstudio', true, 2), probe('ollama', true, 7)], [])).toMatchObject({ presetId: 'ollama', models: 7 });
  });

  it('skips a server that is already set up, and offers the next one', () => {
    expect(bestLocalServer([probe('lmstudio', true, 9), probe('ollama', true, 1)], lmsEngine)?.presetId).toBe('ollama');
  });

  it('is null when nothing is running, or the only running server is already set up', () => {
    expect(bestLocalServer([probe('lmstudio', false), probe('ollama', false)], [])).toBeNull();
    expect(bestLocalServer([probe('lmstudio', true, 3)], lmsEngine)).toBeNull();
    expect(bestLocalServer([], [])).toBeNull();
  });
});
