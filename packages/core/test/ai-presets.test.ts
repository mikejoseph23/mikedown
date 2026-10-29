/**
 * The preset table as data (detect paths, key pages, pricing and install
 * links) and the pure helpers behind local server detection: the candidate
 * list, the URL and count a probe uses, how the cards rank after a probe, and
 * what counts as a usable default route.
 */
import { describe, expect, it } from 'vitest';
import {
  AI_ENGINE_PRESETS,
  AI_LOCAL_DETECT_TIMEOUT_MS,
  countDetectedModels,
  localDetectCandidates,
  localDetectTarget,
  localDetectUrl,
  parseAiSettings,
  type AiEngineConfig,
  type AiLocalServerProbe,
  type AiSettings,
} from '../src/ai';
import { hasUsableDefaultRoute, rankLocalCandidates } from '../src/ai-settings-model';

const local = AI_ENGINE_PRESETS.filter((p) => p.family === 'local');
const cloud = AI_ENGINE_PRESETS.filter((p) => p.family === 'cloud');

describe('preset data', () => {
  it('every local preset has a detect path under the server root, or defaults to /models', () => {
    for (const p of local) {
      if (p.detectPath !== undefined) {
        expect(p.detectPath, p.id).toMatch(/^\/[^/].*/);
        expect(p.detectPath, p.id).not.toMatch(/^\/v1(\/|$)/);
      }
      const url = localDetectUrl(p.baseUrl, p.detectPath);
      expect(url, p.id).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
      expect(url.endsWith(p.detectPath ?? '/models'), p.id).toBe(true);
    }
    // The two native lists answer without a key, so they are what detection reads.
    expect(AI_ENGINE_PRESETS.find((p) => p.id === 'lmstudio')?.detectPath).toBe('/api/v0/models');
    expect(AI_ENGINE_PRESETS.find((p) => p.id === 'ollama')?.detectPath).toBe('/api/tags');
  });

  it('every cloud preset has a key page that parses as an https URL', () => {
    for (const p of cloud) {
      const url = new URL(p.keyUrl ?? 'not a url');
      expect(url.protocol, p.id).toBe('https:');
      expect(url.hostname, p.id).not.toBe('');
    }
  });

  it('detection asks every local preset but Custom, at its own address, in preset order', () => {
    const candidates = localDetectCandidates();
    expect(candidates.map((c) => c.presetId)).toEqual(['omlx', 'lmstudio', 'ollama', 'llamacpp', 'vllm']);
    for (const c of candidates) {expect(c.baseUrl).toBe(AI_ENGINE_PRESETS.find((p) => p.id === c.presetId)!.baseUrl);}
    expect(AI_LOCAL_DETECT_TIMEOUT_MS).toBe(1500);
  });
});

describe('localDetectUrl and countDetectedModels', () => {
  it('puts the detect path under the root without /v1, else asks {baseUrl}/models', () => {
    expect(localDetectUrl('http://127.0.0.1:1234/v1', '/api/v0/models')).toBe('http://127.0.0.1:1234/api/v0/models');
    expect(localDetectUrl(' http://127.0.0.1:11434/v1/ ', '/api/tags')).toBe('http://127.0.0.1:11434/api/tags');
    expect(localDetectUrl('http://127.0.0.1:8080/v1', undefined)).toBe('http://127.0.0.1:8080/v1/models');
    expect(localDetectUrl('http://box.lan:9000', undefined)).toBe('http://box.lan:9000/models');
  });

  it('counts data (minus LM Studio embeddings) or models, and says nothing for another shape', () => {
    expect(countDetectedModels({ data: [{ id: 'a' }, { id: 'b' }] })).toBe(2);
    expect(countDetectedModels({ data: [{ id: 'a', type: 'llm' }, { id: 'e', type: 'embeddings' }] })).toBe(1);
    expect(countDetectedModels({ models: [{ name: 'llama3' }, { name: 'qwen' }] })).toBe(2);
    expect(countDetectedModels({ data: [] })).toBe(0);
    expect(countDetectedModels({ ok: true })).toBeUndefined();
    expect(countDetectedModels(null)).toBeUndefined();
    expect(countDetectedModels('text')).toBeUndefined();
    expect(countDetectedModels([{ id: 'a' }])).toBeUndefined();
  });
});

describe('localDetectTarget', () => {
  it('refuses cloud and unknown presets, Custom, and addresses that are not http(s)', () => {
    expect(localDetectTarget({ presetId: 'anthropic', baseUrl: 'https://api.anthropic.com' })).toBeNull();
    expect(localDetectTarget({ presetId: 'nope', baseUrl: 'http://127.0.0.1:1/v1' })).toBeNull();
    expect(localDetectTarget({ presetId: 'custom', baseUrl: 'http://127.0.0.1:8000/v1' })).toBeNull();
    expect(localDetectTarget({ presetId: 'ollama', baseUrl: 'file:///etc/passwd' })).toBeNull();
    expect(localDetectTarget({ presetId: 'ollama', baseUrl: 'http://' })).toBeNull();
    expect(localDetectTarget({ presetId: 'ollama', baseUrl: 42 as unknown as string })).toBeNull();
  });

  it('hands over a key source only at the preset\'s own address', () => {
    const own = localDetectTarget({ presetId: 'omlx', baseUrl: 'http://127.0.0.1:8000/v1/' })!;
    expect(own).toMatchObject({ presetId: 'omlx', url: 'http://127.0.0.1:8000/v1/models', apiKeyEnv: 'OMLX_API_KEY' });
    expect(own.apiKeyFile).toEqual({ path: '~/.omlx/settings.json', jsonPath: 'auth.api_key' });
    const elsewhere = localDetectTarget({ presetId: 'omlx', baseUrl: 'http://10.0.0.5:8000/v1' })!;
    expect(elsewhere.apiKeyEnv).toBeUndefined();
    expect(elsewhere.apiKeyFile).toBeUndefined();
    const keyless = localDetectTarget({ presetId: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1' })!;
    expect(keyless).toMatchObject({ url: 'http://127.0.0.1:1234/api/v0/models', kind: 'lmstudio' });
    expect(keyless.apiKeyEnv).toBeUndefined();
  });
});

describe('rankLocalCandidates', () => {
  const probe = (presetId: string, ok: boolean, models?: number): AiLocalServerProbe => {
    const preset = AI_ENGINE_PRESETS.find((p) => p.id === presetId)!;
    return { presetId, baseUrl: preset.baseUrl, ok, ...(models === undefined ? {} : { models }) };
  };
  const engine = (id: string, presetId: string, over: Partial<AiEngineConfig> = {}) => {
    const p = AI_ENGINE_PRESETS.find((x) => x.id === presetId)!;
    return { id, kind: p.kind, baseUrl: p.baseUrl, apiKeyEnv: p.apiKeyEnv, ...over };
  };
  const order = (probes: AiLocalServerProbe[], engines: ReturnType<typeof engine>[] = []) => rankLocalCandidates(probes, engines).map((c) => c.presetId);

  it('puts running servers first, the one with the most models ahead, then the silent ones, then those already added', () => {
    const probes = [probe('omlx', false), probe('lmstudio', true, 2), probe('ollama', true, 9), probe('llamacpp', false), probe('vllm', false)];
    expect(order(probes)).toEqual(['ollama', 'lmstudio', 'omlx', 'llamacpp', 'vllm']);
    // An added server drops to the end, running or not, so the first card is always something to set up.
    expect(order(probes, [engine('o', 'ollama')])).toEqual(['lmstudio', 'omlx', 'llamacpp', 'vllm', 'ollama']);
  });

  it('keeps the probe order on ties', () => {
    expect(order([probe('lmstudio', true, 3), probe('ollama', true, 3)])).toEqual(['lmstudio', 'ollama']);
    expect(order([probe('ollama', false), probe('lmstudio', false)])).toEqual(['ollama', 'lmstudio']);
    // A running server that did not say how many models counts as none.
    expect(order([probe('lmstudio', true), probe('ollama', true, 1)])).toEqual(['ollama', 'lmstudio']);
  });

  it('marks alreadyAdded with the engine id, and carries models and latency only for a server that answered', () => {
    const cards = rankLocalCandidates(
      [{ ...probe('lmstudio', true, 4), latencyMs: 12 }, { ...probe('ollama', false, 7), latencyMs: 3000 }],
      [engine('my-lms', 'lmstudio')],
    );
    expect(cards.find((c) => c.presetId === 'lmstudio')).toMatchObject({ running: true, alreadyAdded: true, engineId: 'my-lms', models: 4, latencyMs: 12 });
    const ollama = cards.find((c) => c.presetId === 'ollama')!;
    expect(ollama).toMatchObject({ running: false, alreadyAdded: false });
    expect(ollama).not.toHaveProperty('models');
    expect(ollama).not.toHaveProperty('engineId');
  });

  it('treats localhost, 127.0.0.1 and a trailing slash as the same address, and a different port as another server', () => {
    const lms = probe('lmstudio', true, 1);
    expect(rankLocalCandidates([lms], [engine('a', 'lmstudio', { baseUrl: 'http://localhost:1234/v1/' })])[0].alreadyAdded).toBe(true);
    expect(rankLocalCandidates([lms], [engine('a', 'lmstudio', { baseUrl: 'http://127.0.0.1:1235/v1' })])[0].alreadyAdded).toBe(false);
    // Same address, other kind: not this preset's engine.
    expect(rankLocalCandidates([lms], [engine('a', 'lmstudio', { kind: 'openai-compatible' })])[0].alreadyAdded).toBe(false);
  });

  it('oMLX and vLLM share :8000: both show Running, in preset order, and an engine claims only the card its key variable names', () => {
    const both = [probe('omlx', true, 2), probe('vllm', true, 2)];
    expect(order(both)).toEqual(['omlx', 'vllm']);
    // Today's behaviour: the card with more models leads, nothing about the key tells them apart on a probe.
    expect(order([probe('omlx', true, 1), probe('vllm', true, 5)])).toEqual(['vllm', 'omlx']);

    const added = (engines: ReturnType<typeof engine>[]) => Object.fromEntries(rankLocalCandidates(both, engines).map((c) => [c.presetId, c.alreadyAdded]));
    expect(added([engine('m', 'omlx')])).toEqual({ omlx: true, vllm: false });
    expect(added([engine('v', 'vllm')])).toEqual({ omlx: false, vllm: true });
    // A hand-made engine with no key variable at that address belongs to Custom, so neither card is Added.
    expect(added([{ id: 'x', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', apiKeyEnv: undefined }])).toEqual({ omlx: false, vllm: false });
    // The added one drops, the other leads.
    expect(order(both, [engine('m', 'omlx')])).toEqual(['vllm', 'omlx']);
    // oMLX asking for a key (probe not ok) while vLLM answers keyless: vLLM leads, oMLX reads Not running.
    expect(order([probe('omlx', false), probe('vllm', true, 1)])).toEqual(['vllm', 'omlx']);
  });
});

describe('hasUsableDefaultRoute', () => {
  const caps = { chat: true, stream: true };
  const make = (over: { engine?: Record<string, unknown>; model?: Record<string, unknown>; route?: unknown } = {}): AiSettings =>
    parseAiSettings({
      enabled: false,
      engines: [{ id: 'lms', name: 'LM Studio', kind: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', models: [{ id: 'gemma', capabilities: caps, ...over.model }], ...over.engine }],
      routing: { default: over.route === undefined ? { engineId: 'lms', modelId: 'gemma' } : over.route, fallback: 'none', tasks: {} },
    }, { onWarning: () => {} });

  it('needs a default route to an enabled engine\'s enabled chat model', () => {
    expect(hasUsableDefaultRoute(make())).toBe(true);
    expect(hasUsableDefaultRoute(make({ route: null }))).toBe(false);
    expect(hasUsableDefaultRoute(make({ route: { engineId: 'gone', modelId: 'gemma' } }))).toBe(false);
    expect(hasUsableDefaultRoute(make({ route: { engineId: 'lms', modelId: 'gone' } }))).toBe(false);
    expect(hasUsableDefaultRoute(make({ engine: { enabled: false } }))).toBe(false);
    expect(hasUsableDefaultRoute(make({ model: { enabled: false } }))).toBe(false);
    expect(hasUsableDefaultRoute(make({ model: { capabilities: { chat: false } } }))).toBe(false);
  });
});
