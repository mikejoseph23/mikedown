// @vitest-environment node
// Heuristics use the model ids installed on the Mac Studio
// (~/git/home-lab/local-ai/model-catalog.md and model-catalog/*.md).
import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_MODEL_TABLE,
  DEFAULT_CONTEXT_TOKENS,
  OPENAI_MODEL_TABLE,
  completeCapabilities,
  detectCapabilities,
  mergeDiscoveredModels,
  parseAiSettings,
} from '@mikedown/core/ai';
import type { AiDiscoveredModel, AiModelConfig } from '@mikedown/core/ai';

const caps = (id: string, kind?: Parameters<typeof detectCapabilities>[1]) => detectCapabilities(id, kind).capabilities;

describe('Qwen', () => {
  it('VL builds have vision, plain Qwen builds do not', () => {
    for (const id of ['qwen2.5-vl-7b-instruct', 'qwen3-vl-30b-a3b', 'Qwen3-VL-8B']) {
      expect(caps(id).vision, id).toBe(true);
    }
    for (const id of ['qwen2.5-7b-instruct', 'qwen3-8b', 'Qwen2-72B']) {
      expect(caps(id).vision, id).toBe(false);
    }
  });

  it('Qwen 3.5 and later, and the qwen4 preview, carry vision (per the catalog)', () => {
    for (const id of ['qwen3.5-122b-a10b', 'qwen/qwen3.6-35b-a3b', 'Qwen3.8-27B-MLX-8bit', 'tls20/Qwen3.8-Flash-Next-oQ5e-mtp', 'Jundot/Qwen3.8-Flash-Next-oQ4e-mtp']) {
      const c = caps(id);
      expect(c.vision, id).toBe(true);
      expect(c.json && c.tools && c.chat && c.stream, id).toBe(true);
      expect(c.contextTokens, id).toBe(262144);
    }
  });

  it('Qwen 3 (no point release) keeps the smaller window and no vision', () => {
    expect(caps('qwen3-8b')).toMatchObject({ vision: false, contextTokens: 40960 });
  });

  it('Coder builds get fill-in-the-middle and no vision, even on a 3.5+ line', () => {
    const next = caps('Qwen3-Coder-Next-MLX-8bit');
    expect(next).toMatchObject({ fim: true, vision: false, chat: true, contextTokens: 262144 });
    expect(caps('qwen2.5-coder-7b')).toMatchObject({ fim: true, vision: false, contextTokens: 32768 });
    expect(caps('qwen3.8-27b').fim).toBe(false);
  });
});

describe('Gemma', () => {
  it('Gemma 4 has vision, tools, JSON and a 131072 window', () => {
    for (const id of ['gemma-4-31b-it', 'gemma-4-26B-A4B-it-QAT-MLX-4bit', 'lmstudio-community/gemma-4-26B-A4B-it-QAT-MLX-4bit']) {
      expect(caps(id), id).toMatchObject({ chat: true, vision: true, json: true, tools: true, fim: false, embed: false, contextTokens: 131072 });
    }
  });

  it('Gemma 3 has vision but no tools; Gemma 2 has neither', () => {
    expect(caps('gemma-3-12b')).toMatchObject({ vision: true, tools: false });
    expect(caps('gemma-2-9b')).toMatchObject({ vision: false, tools: false, contextTokens: 8192 });
  });
});

describe('other local families', () => {
  it('MiniMax M3: JSON and tools, no vision, large window', () => {
    expect(caps('MiniMax-M3-4bit')).toMatchObject({ chat: true, json: true, tools: true, vision: false, contextTokens: 196608 });
  });

  it('DeepSeek V4 and Nemotron', () => {
    expect(caps('DeepSeek-V4-Flash-0731-MXFP4-MLX')).toMatchObject({ json: true, tools: true, vision: false, contextTokens: 1048576 });
    expect(caps('nvidia/nemotron-3-nano-4b')).toMatchObject({ json: true, tools: true, vision: false });
  });

  it('an id nothing matches is a plain chat model with the default window', () => {
    const d = detectCapabilities('totally-unknown-model');
    expect(d.family).toBeNull();
    expect(d.capabilities).toEqual({ chat: true, stream: true, vision: false, json: false, tools: false, fim: false, embed: false, contextTokens: DEFAULT_CONTEXT_TOKENS });
  });
});

describe('embedding and speech models are not chat models', () => {
  it('nomic-embed: embeddings only', () => {
    for (const id of ['nomic-embed-text-v1.5', 'text-embedding-nomic-embed-text-v1.5']) {
      expect(caps(id), id).toMatchObject({ embed: true, chat: false, stream: false, vision: false, json: false, tools: false });
    }
  });

  it('whisper is neither chat nor embed', () => {
    expect(caps('whisper-large-v3-turbo')).toMatchObject({ chat: false, embed: false });
  });
});

describe('cloud tables', () => {
  it('Anthropic: the longest prefix wins; unknown claude ids get the generic row', () => {
    expect(caps('claude-sonnet-5-5', 'anthropic')).toMatchObject({ chat: true, vision: true, json: true, tools: true, contextTokens: 1000000 });
    expect(caps('claude-haiku-4-5-20251001', 'anthropic').contextTokens).toBe(200000);
    expect(caps('claude-someday-9', 'anthropic')).toMatchObject({ vision: true, contextTokens: 200000 });
    expect(ANTHROPIC_MODEL_TABLE.some((r) => r.prefix === 'claude-')).toBe(true);
  });

  it('OpenAI: lines inherit their prefix row', () => {
    expect(caps('gpt-5-mini', 'openai')).toMatchObject({ vision: true, contextTokens: 400000 });
    expect(caps('gpt-4o-mini', 'openai')).toMatchObject({ vision: true, contextTokens: 128000 });
    expect(caps('text-embedding-3-small', 'openai')).toMatchObject({ embed: true, chat: false });
    expect(caps('whisper-1', 'openai').chat).toBe(false);
    expect(OPENAI_MODEL_TABLE.some((r) => r.prefix === 'gpt-')).toBe(true);
  });

  it('a claude id behind an aggregator (vendor/ prefix, openai-compatible) still uses the Anthropic table', () => {
    expect(caps('anthropic/claude-sonnet-5-5', 'openai-compatible')).toMatchObject({ vision: true, contextTokens: 1000000 });
  });

  it('a local engine\'s ids are not caught by the cloud tables', () => {
    expect(caps('gpt-oss-120b', 'openai-compatible').contextTokens).toBe(131072);
  });
});

describe('endpoint metadata wins over heuristics', () => {
  it('completeCapabilities: endpoint values replace the guess, the rest comes from the id', () => {
    const c = completeCapabilities({ vision: false, contextTokens: 4096 }, 'gemma-4-31b-it');
    expect(c.vision).toBe(false);
    expect(c.contextTokens).toBe(4096);
    expect(c.tools).toBe(true);
  });

  it('a missing, null or non-positive context window falls back to the id', () => {
    for (const contextTokens of [undefined, null, 0, -5] as any[]) {
      expect(completeCapabilities({ contextTokens }, 'gemma-4-31b-it').contextTokens).toBe(131072);
    }
  });

  it('merging a new discovery uses endpoint values and records the source', () => {
    const found: AiDiscoveredModel[] = [{ id: 'qwen3-8b', capabilities: { vision: true, contextTokens: 8000 }, source: 'endpoint' }];
    const [m] = mergeDiscoveredModels([], found, 'lmstudio');
    expect(m.capabilities).toMatchObject({ vision: true, contextTokens: 8000, json: true });
    expect(m.capabilitiesSource).toBe('endpoint');
    expect(m.enabled).toBe(true);
  });

  it('a bare listing is stamped heuristic', () => {
    const [m] = mergeDiscoveredModels([], [{ id: 'gemma-4-31b-it', capabilities: {}, source: 'heuristic' }]);
    expect(m.capabilitiesSource).toBe('heuristic');
    expect(m.capabilities.vision).toBe(true);
  });
});

describe('re-discovery keeps user edits', () => {
  const edited: AiModelConfig = {
    id: 'qwen3-8b',
    label: 'My Qwen',
    enabled: false,
    capabilities: { ...caps('qwen3-8b'), vision: true, contextTokens: 99999 },
    capabilitiesSource: 'user',
    requestOverrides: { reasoning_effort: 'low' },
  };

  it('user capabilities, label, enabled and overrides survive a re-discovery', () => {
    const [m] = mergeDiscoveredModels([edited], [{ id: 'qwen3-8b', label: 'Qwen3 8B', capabilities: { vision: false, contextTokens: 1 }, source: 'endpoint' }]);
    expect(m.capabilities).toEqual(edited.capabilities);
    expect(m.capabilitiesSource).toBe('user');
    expect(m.label).toBe('My Qwen');
    expect(m.enabled).toBe(false);
    expect(m.requestOverrides).toEqual({ reasoning_effort: 'low' });
  });

  it('endpoint and heuristic rows are refreshed', () => {
    const old: AiModelConfig = { ...edited, capabilitiesSource: 'heuristic', capabilities: { ...edited.capabilities, vision: false } };
    const [m] = mergeDiscoveredModels([old], [{ id: 'qwen3-8b', capabilities: { vision: true }, source: 'endpoint' }]);
    expect(m.capabilities.vision).toBe(true);
    expect(m.capabilitiesSource).toBe('endpoint');
    expect(m.label).toBe('My Qwen');
  });

  it('adopts the endpoint label only when the model has none', () => {
    const noLabel = { ...edited, label: undefined };
    delete (noLabel as any).label;
    const [m] = mergeDiscoveredModels([noLabel], [{ id: 'qwen3-8b', label: 'Qwen3 8B', capabilities: {}, source: 'endpoint' }]);
    expect(m.label).toBe('Qwen3 8B');
  });

  it('survives a settings save and load as well', () => {
    const s = parseAiSettings({ engines: [{ id: 'e', baseUrl: 'http://127.0.0.1:1234/v1', kind: 'lmstudio', models: [edited] }] }, { onWarning: () => {} });
    const [m] = mergeDiscoveredModels(s.engines[0].models, [{ id: 'qwen3-8b', capabilities: { vision: false }, source: 'endpoint' }], 'lmstudio');
    expect(m.capabilities.vision).toBe(true);
    expect(m.capabilities.contextTokens).toBe(99999);
  });
});

describe('mergeDiscoveredModels bookkeeping', () => {
  const model = (id: string, extra: Partial<AiModelConfig> = {}): AiModelConfig => ({
    id,
    enabled: true,
    capabilities: caps(id),
    capabilitiesSource: 'heuristic',
    ...extra,
  });

  it('marks saved models the endpoint no longer lists as missing, keeping them', () => {
    const merged = mergeDiscoveredModels([model('a'), model('b')], [{ id: 'a', capabilities: {}, source: 'heuristic' }]);
    expect(merged.map((m) => m.id)).toEqual(['a', 'b']);
    expect(merged[0].missing).toBeUndefined();
    expect(merged[1].missing).toBe(true);
  });

  it('leaves manual models alone when they are not listed', () => {
    const merged = mergeDiscoveredModels([model('hand', { manual: true })], []);
    expect(merged[0].missing).toBeUndefined();
  });

  it('clears missing when a model comes back', () => {
    const merged = mergeDiscoveredModels([model('a', { missing: true })], [{ id: 'a', capabilities: {}, source: 'heuristic' }]);
    expect('missing' in merged[0]).toBe(false);
  });

  it('appends new models in discovery order, ignoring duplicate ids in one listing', () => {
    const merged = mergeDiscoveredModels(
      [model('a')],
      [
        { id: 'z', capabilities: {}, source: 'heuristic' },
        { id: 'a', capabilities: {}, source: 'heuristic' },
        { id: 'y', capabilities: {}, source: 'heuristic' },
        { id: 'z', capabilities: { vision: true }, source: 'endpoint' },
      ],
    );
    expect(merged.map((m) => m.id)).toEqual(['a', 'z', 'y']);
    expect(merged[1].capabilities.vision).toBe(false);
  });

  it('does not mutate its inputs', () => {
    const existing = [model('a')];
    const snapshot = JSON.stringify(existing);
    mergeDiscoveredModels(existing, []);
    expect(JSON.stringify(existing)).toBe(snapshot);
  });
});
