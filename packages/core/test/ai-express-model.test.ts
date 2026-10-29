/** Express engine form (M3b): the pure helpers behind it. The DOM tests live in ai-express-form.test.ts (T3b). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AI_ENGINE_PRESETS,
  AI_PRESET_FAMILIES,
  mergeDiscoveredModels,
  parseAiSettings,
  parseLmStudioModels,
  presetForEngine,
  thinkingChoices,
  thinkingLevelFrom,
  thinkingOverrides,
  withThinkingLevel,
} from '../src/ai';
import type { AiEngineConfig, AiEngineStatus, AiModelCapabilities, AiModelConfig, AiModelSizeTag, AiSettings, AiThinkingLevel } from '../src/ai';
import {
  AUTO_FETCH_KEY_DELAY_MS,
  applyDiscoveryForFamily,
  autoFetchDecision,
  autoPickDefault,
  chooseSetupModel,
  discoveryProblem,
  engineDefaultModelId,
  enginePreset,
  expressFields,
  groupPresets,
  localDefaultModelId,
  modelCountLine,
  modelPickerOptions,
  popularModels,
  setEngineDefaultModel,
  setModelPicked,
  setModelThinking,
  setupFields,
} from '../src/ai-settings-model';
import type { AutoFetchState } from '../src/ai-settings-model';

const FIXTURES = join(__dirname, '..', '..', '..', 'test', 'ai-fixtures');
const preset = (id: string) => AI_ENGINE_PRESETS.find((p) => p.id === id)!;
const chat: AiModelCapabilities = { chat: true, stream: true, vision: false, json: true, tools: true, fim: false, embed: false, contextTokens: null };
const model = (id: string, over: Partial<AiModelConfig> = {}): AiModelConfig => ({ id, enabled: false, capabilities: chat, capabilitiesSource: 'endpoint', ...over });
const ids = (list: Array<{ id: string }>) => list.map((m) => m.id);

function status(engineId: string, list: Array<{ id: string; loaded?: boolean; missing?: boolean; chat?: boolean }>, ok: boolean | null = true): AiEngineStatus {
  return {
    engineId,
    ok,
    isLocal: true,
    hasKey: false,
    models: list.map((m) => ({ id: m.id, capabilities: { ...chat, chat: m.chat ?? true }, source: 'endpoint' as const, ...(m.loaded !== undefined ? { loaded: m.loaded } : {}), ...(m.missing ? { missing: true } : {}) })),
  };
}

function engine(over: Partial<AiEngineConfig> = {}): AiEngineConfig {
  return { id: 'e1', name: 'E', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', enabled: true, locality: 'auto', discovery: 'auto', models: [], ...over };
}

function settingsWith(engines: AiEngineConfig[], def: AiSettings['routing']['default'] = null): AiSettings {
  const s = parseAiSettings({ enabled: true, engines: [] }, { onWarning: () => {} });
  return { ...s, engines, routing: { ...s.routing, default: def } };
}

describe('presets', () => {
  it('every preset has a family, a caption and a key hint, and no model ids', () => {
    for (const p of AI_ENGINE_PRESETS) {
      expect(['local', 'cloud', 'host']).toContain(p.family);
      expect(p.caption).not.toBe('');
      expect(p.keyHint).not.toBe('');
      expect(JSON.stringify(p)).not.toMatch(/"model"/);
    }
    expect(AI_PRESET_FAMILIES.map((f) => f.family)).toEqual(['local', 'cloud']);
    const groups = groupPresets(AI_ENGINE_PRESETS);
    expect(ids(groups.local)).toEqual(['omlx', 'lmstudio', 'ollama', 'llamacpp', 'vllm', 'custom']);
    expect(groups.cloud.every((p) => (p.popular ?? []).length > 0)).toBe(true);
    // VS Code's Copilot card is kept out of the cloud cards; it shows only where the host reports it.
    expect(ids(groups.host)).toEqual(['vscodelm']);
  });

  it('every cloud preset links its key page over https, and its caption no longer repeats the key hint', () => {
    for (const p of AI_ENGINE_PRESETS.filter((x) => x.family === 'cloud')) {
      expect(p.keyUrl, p.id).toMatch(/^https:\/\//);
      expect(p.caption, p.id).not.toBe(p.keyHint);
    }
  });

  it('finds the preset a saved engine came from', () => {
    expect(presetForEngine({ kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1/', apiKeyEnv: 'OMLX_API_KEY' })?.id).toBe('omlx');
    expect(presetForEngine({ kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', apiKeyEnv: 'VLLM_API_KEY' })?.id).toBe('vllm');
    expect(presetForEngine({ kind: 'anthropic', baseUrl: 'https://proxy.example.com' })?.id).toBe('anthropic');
    expect(presetForEngine({ kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1/' })?.id).toBe('openrouter');
    expect(presetForEngine({ kind: 'openai-compatible', baseUrl: 'https://api.x.ai/v1' })).toBeUndefined();
    // A hand-made engine on a cloud address gets the cloud form.
    expect(enginePreset(engine({ baseUrl: 'https://api.x.ai/v1' }), []).family).toBe('cloud');
    expect(enginePreset(engine({ baseUrl: 'http://10.0.0.5:9000/v1' }), ['10.0.0.0/8']).family).toBe('local');
  });
});

describe('expressFields', () => {
  it('cloud: key, never the URL; local: URL, key only when needed or Custom', () => {
    const cloud = expressFields(preset('anthropic'));
    expect(cloud.express).toEqual(['name', 'key', 'models', 'defaultModel', 'thinking', 'enabled']);
    expect(cloud.advanced).toContain('baseUrl');

    const omlx = expressFields(preset('omlx'));
    expect(omlx.express).toEqual(['name', 'baseUrl', 'key', 'models', 'defaultModel', 'thinking', 'enabled']);
    expect(omlx.advanced).not.toContain('key');

    const lms = expressFields(preset('lmstudio'));
    expect(lms.express).not.toContain('key');
    // Nothing is removed, only folded: the key moves under Advanced.
    expect(lms.advanced).toEqual(['kind', 'locality', 'key', 'keyEnv', 'keyFile', 'discovery', 'modelsTable']);

    expect(expressFields(preset('custom')).express).toContain('key');
  });

  it('setup mode keeps the key, the local URL and the models; a local key comes out of Advanced when asked', () => {
    expect(setupFields(preset('openai')).express).toEqual(['key', 'models']);
    expect(setupFields(preset('omlx')).express).toEqual(['baseUrl', 'key', 'models']);
    expect(setupFields(preset('vscodelm')).express).toEqual(['models']);
    const lms = setupFields(preset('lmstudio'));
    expect(lms.express).toEqual(['baseUrl', 'models']);
    expect(lms.advanced).toContain('key');
    const lmsKey = setupFields(preset('lmstudio'), { key: true });
    expect(lmsKey.express).toEqual(['baseUrl', 'key', 'models']);
    expect(lmsKey.advanced).not.toContain('key');
    // A cloud form already has its key in front.
    expect(setupFields(preset('openai'), { key: true }).express).toEqual(['key', 'models']);
  });
});

describe('Popular models and the auto-picked default', () => {
  const anthropicIds = [
    'claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-20250514', 'claude-opus-4-8',
    'claude-sonnet-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-3-5-sonnet-20241022',
  ];

  it('picks the newest id per family in rule order, by version before date', () => {
    const models = anthropicIds.map((id) => model(id));
    expect(ids(popularModels(preset('anthropic'), models))).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5']);
    // An older list still works: whatever is newest today wins.
    const older = ['claude-sonnet-4-20250514', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'].map((id) => model(id));
    expect(ids(popularModels(preset('anthropic'), older))).toEqual(['claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001']);
  });

  it('prefers an undated alias over its snapshots, and skips missing models', () => {
    const models = ['gpt-5.5-2026-01-01', 'gpt-5.5', 'gpt-5', 'gpt-5.5-mini', 'gpt-5-mini', 'gpt-5.5-pro'].map((id) => model(id));
    expect(ids(popularModels(preset('openai'), models))).toEqual(['gpt-5.5', 'gpt-5.5-mini']);
    const missing = [model('gpt-6', { missing: true }), model('gpt-5.5')];
    expect(ids(popularModels(preset('openai'), missing))).toEqual(['gpt-5.5']);
  });

  it('a `prefer` rule wins over plain version order (Mistral -latest aliases)', () => {
    const models = ['mistral-medium-2508', 'mistral-medium-latest', 'mistral-large-2411', 'mistral-large-latest'].map((id) => model(id));
    expect(ids(popularModels(preset('mistral'), models))).toEqual(['mistral-medium-latest', 'mistral-large-latest']);
  });

  it('auto-picks the first Popular chat model, the only chat model, or nothing', () => {
    expect(autoPickDefault(preset('anthropic'), anthropicIds.map((id) => model(id)))).toBe('claude-sonnet-5-5');
    const embedFirst = [model('openai/gpt-5.5', { capabilities: { ...chat, chat: false } }), model('google/gemini-3-pro')];
    expect(autoPickDefault(preset('openrouter'), embedFirst)).toBe('google/gemini-3-pro');
    expect(autoPickDefault(preset('deepseek'), [model('something-else')])).toBe('something-else');
    expect(autoPickDefault(preset('deepseek'), [model('a'), model('b')])).toBeNull();
    expect(autoPickDefault({ popular: [] }, [])).toBeNull();
  });
});

describe('thinking level', () => {
  const kinds = ['openai-compatible', 'openai', 'lmstudio', 'ollama', 'anthropic'] as const;

  it('round-trips every offered level through the request fields', () => {
    for (const kind of kinds) {
      for (const local of [true, false]) {
        for (const { level } of thinkingChoices(kind)) {
          const overrides = withThinkingLevel(kind, undefined, level, { local });
          expect(thinkingLevelFrom(kind, overrides), `${kind} ${level} local=${local}`).toBe(level);
        }
      }
    }
  });

  it('maps each kind onto its own fields', () => {
    expect(thinkingOverrides('anthropic', 'high')).toEqual({ thinking: { type: 'adaptive' }, output_config: { effort: 'high' } });
    // Current Anthropic models reject disabled thinking, so Off is not offered.
    expect(thinkingChoices('anthropic').map((c) => c.level)).toEqual(['low', 'medium', 'high']);
    expect(thinkingOverrides('anthropic', 'off')).toEqual({});
    expect(thinkingOverrides('openai', 'off')).toEqual({ reasoning_effort: 'none' });
    // oMLX and other local servers turn thinking off through the chat template.
    expect(thinkingOverrides('openai-compatible', 'off', { local: true })).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    expect(thinkingOverrides('openai-compatible', 'off', { local: false })).toEqual({ reasoning_effort: 'none' });
    expect(thinkingOverrides('openai-compatible', 'low', { local: true })).toEqual({ reasoning_effort: 'low' });
    expect(thinkingChoices('lmstudio').map((c) => c.label)).toEqual(['Off', 'On']);
    expect(thinkingLevelFrom('lmstudio', { reasoning_effort: 'high' })).toBe('medium');
    expect(thinkingChoices('some-future-kind')).toEqual([]);
  });

  it('keeps unrelated override keys, nested ones included, and drops empty containers', () => {
    const start = { temperature: 0.2, thinking_budget: 2048, chat_template_kwargs: { foo: 1 }, output_config: { format: { type: 'json' } } };
    const off = withThinkingLevel('openai-compatible', start, 'off', { local: true })!;
    expect(off).toEqual({ temperature: 0.2, thinking_budget: 2048, chat_template_kwargs: { foo: 1, enable_thinking: false }, output_config: { format: { type: 'json' } } });
    const low = withThinkingLevel('openai-compatible', off, 'low', { local: true })!;
    expect(low).toEqual({ temperature: 0.2, thinking_budget: 2048, chat_template_kwargs: { foo: 1 }, output_config: { format: { type: 'json' } }, reasoning_effort: 'low' });
    expect(withThinkingLevel('openai-compatible', low, null)).toEqual({ temperature: 0.2, thinking_budget: 2048, chat_template_kwargs: { foo: 1 }, output_config: { format: { type: 'json' } } });

    const claude = withThinkingLevel('anthropic', { output_config: { format: { type: 'json' } } }, 'medium')!;
    expect(claude).toEqual({ output_config: { format: { type: 'json' }, effort: 'medium' }, thinking: { type: 'adaptive' } });
    expect(withThinkingLevel('anthropic', claude, null)).toEqual({ output_config: { format: { type: 'json' } } });
    expect(withThinkingLevel('openai', { reasoning_effort: 'low' }, null)).toBeUndefined();
  });

  it('setModelThinking writes the model, keeping its other fields', () => {
    const m = model('qwen', { requestOverrides: { top_k: 20 }, label: 'Qwen' });
    const next = setModelThinking(m, 'openai-compatible', 'high' as AiThinkingLevel, true);
    expect(next).toMatchObject({ id: 'qwen', label: 'Qwen', requestOverrides: { top_k: 20, reasoning_effort: 'high' } });
    expect(setModelThinking(model('x', { requestOverrides: { reasoning_effort: 'low' } }), 'openai', null, false)).not.toHaveProperty('requestOverrides');
  });
});

describe('discovery and the enabled rule (OPEN-12)', () => {
  it('new models arrive off unless picked; on a local engine loaded ones arrive on', () => {
    const e = engine({ models: [model('kept', { enabled: true })] });
    const s = status('e1', [{ id: 'kept' }, { id: 'new-a' }, { id: 'new-b', loaded: true }]);
    expect(applyDiscoveryForFamily(e, s, 'local').models.map((m) => [m.id, m.enabled])).toEqual([['kept', true], ['new-a', false], ['new-b', true]]);
    expect(applyDiscoveryForFamily(e, s, 'cloud').models.map((m) => [m.id, m.enabled])).toEqual([['kept', true], ['new-a', false], ['new-b', false]]);
    expect(applyDiscoveryForFamily(e, s, 'cloud', ['new-b']).models.map((m) => [m.id, m.enabled])).toEqual([['kept', true], ['new-a', false], ['new-b', true]]);
    // A model already there keeps its own choice, even when off.
    const off = engine({ models: [model('kept', { enabled: false })] });
    expect(applyDiscoveryForFamily(off, s, 'local').models.find((m) => m.id === 'kept')?.enabled).toBe(false);
  });

  it('a new local engine ticks only its default (moved first) and the loaded models', () => {
    const fx = JSON.parse(readFileSync(join(FIXTURES, 'discovery/lmstudio-api-v0-models-loaded-later.json'), 'utf8'));
    const s: AiEngineStatus = { engineId: 'e1', ok: true, isLocal: true, hasKey: false, models: parseLmStudioModels(fx.response) };
    const next = applyDiscoveryForFamily(engine({ kind: 'lmstudio' }), s, 'local');
    expect(next.models[0].id).toBe(fx.expectedDefault);
    expect(next.models.filter((m) => m.enabled).map((m) => m.id)).toEqual(fx.expectedPicked);
    expect(next.models).toHaveLength(fx.response.data.length);
  });

  it('oMLX: the loaded chat model is the default; a loaded converter is not ticked', () => {
    const fx = JSON.parse(readFileSync(join(FIXTURES, 'discovery/omlx-models-status.json'), 'utf8'));
    const s: AiEngineStatus = { engineId: 'e1', ok: true, isLocal: true, hasKey: false, models: fx.expected };
    const next = applyDiscoveryForFamily(engine(), s, 'local');
    expect(next.models[0].id).toBe(fx.expectedDefault);
    expect(next.models.filter((m) => m.enabled).map((m) => m.id)).toEqual(fx.expectedPicked);
  });

  it('nothing loaded: the size hints choose, else the first chat model', () => {
    const s = status('e1', [{ id: 'glm-5.3' }, { id: 'embed-1', chat: false }, { id: 'llama-70b' }, { id: 'qwen3-8b' }, { id: 'qwen3-14b' }, { id: 'phi-4-3b' }]);
    const sizes: Record<string, AiModelSizeTag> = { 'llama-70b': 'too large', 'qwen3-8b': 'fits', 'qwen3-14b': 'fits', 'phi-4-3b': 'fits' };
    const pick = applyDiscoveryForFamily(engine(), s, 'local', [], (id) => sizes[id]);
    // The largest model that runs well, not the largest listed.
    expect(pick.models[0].id).toBe('qwen3-14b');
    expect(pick.models.filter((m) => m.enabled).map((m) => m.id)).toEqual(['qwen3-14b']);
    // Unknown hardware: the first chat model.
    expect(applyDiscoveryForFamily(engine(), s, 'local').models.filter((m) => m.enabled).map((m) => m.id)).toEqual(['glm-5.3']);
  });

  it('localDefaultModelId: loaded, then fits, then the smallest tight fit, then not too large', () => {
    const ms = ['embed', 'big-70b', 'mid-32b', 'mid-24b', 'odd'].map((id) => model(id, { capabilities: { ...chat, chat: id !== 'embed' } }));
    const sizes: Record<string, AiModelSizeTag> = { 'big-70b': 'too large', 'mid-32b': 'tight', 'mid-24b': 'tight' };
    expect(localDefaultModelId(ms, new Set(['embed', 'odd']), (id) => sizes[id])).toBe('odd');
    expect(localDefaultModelId(ms, new Set(), (id) => sizes[id])).toBe('mid-24b');
    expect(localDefaultModelId(ms, new Set(), (id) => (id === 'odd' ? undefined : 'too large'))).toBe('odd');
    expect(localDefaultModelId(ms.slice(0, 1), new Set(), () => undefined)).toBeNull();
  });

  it('a local engine that already has a pick gets no default on top', () => {
    const e = engine({ models: [model('mine', { enabled: true })] });
    const next = applyDiscoveryForFamily(e, status('e1', [{ id: 'mine' }, { id: 'other' }]), 'local');
    expect(next.models.map((m) => [m.id, m.enabled])).toEqual([['mine', true], ['other', false]]);
  });

  it('the hosts merge with the same rule', () => {
    const merged = mergeDiscoveredModels([], [{ id: 'a', capabilities: {}, source: 'heuristic' }], 'openai', { addEnabled: false });
    expect(merged[0].enabled).toBe(false);
    expect(mergeDiscoveredModels([], [{ id: 'a', capabilities: {}, source: 'heuristic' }], 'openai')[0].enabled).toBe(true);
  });
});

describe('models picker', () => {
  it('filters by id or label, loaded first on LM Studio, missing last', () => {
    const e = engine({
      kind: 'lmstudio',
      models: [model('alpha', { label: 'Alpha Chat', enabled: true }), model('beta', { missing: true }), model('gamma'), model('delta', { manual: true })],
    });
    const s = status('e1', [{ id: 'alpha' }, { id: 'gamma', loaded: true }, { id: 'delta' }]);
    expect(ids(modelPickerOptions(e, s))).toEqual(['gamma', 'alpha', 'delta', 'beta']);
    expect(ids(modelPickerOptions(e, s, 'CHAT'))).toEqual(['alpha']);
    expect(modelPickerOptions(e, s, 'ALP')[0]).toMatchObject({ name: 'Alpha Chat', hasLabel: true, enabled: true });
    // Not LM Studio: the engine's order, missing still last.
    expect(ids(modelPickerOptions({ ...e, kind: 'ollama' }, s))).toEqual(['alpha', 'gamma', 'delta', 'beta']);
    expect(modelCountLine(e)).toBe('3 models, 1 picked');
    expect(modelCountLine(engine())).toBe('No models yet');
  });
});

describe('Default model', () => {
  it('is the default route model on the default engine, else the first enabled model', () => {
    const e = engine({ models: [model('a'), model('b', { enabled: true }), model('c', { enabled: true })] });
    expect(engineDefaultModelId(settingsWith([e]), 'e1')).toBe('b');
    expect(engineDefaultModelId(settingsWith([e], { engineId: 'e1', modelId: 'c' }), 'e1')).toBe('c');
  });

  it('setting it moves the model first, enables it, and writes the route only for the default engine (or when none exists)', () => {
    const e = engine({ models: [model('a', { enabled: true }), model('b')] });
    const other = engine({ id: 'e2', models: [model('x', { enabled: true })] });

    const fresh = setEngineDefaultModel(settingsWith([e]), 'e1', 'b');
    expect(fresh.engines[0].models.map((m) => [m.id, m.enabled])).toEqual([['b', true], ['a', true]]);
    expect(fresh.routing.default).toEqual({ engineId: 'e1', modelId: 'b' });

    const elsewhere = setEngineDefaultModel(settingsWith([e, other], { engineId: 'e2', modelId: 'x' }), 'e1', 'b');
    expect(elsewhere.routing.default).toEqual({ engineId: 'e2', modelId: 'x' });
    expect(elsewhere.engines[0].models[0].id).toBe('b');
  });

  it('picking a chat model with no default route makes it the default; unpicking the default moves the route', () => {
    const e = engine({ models: [model('a'), model('b'), model('emb', { capabilities: { ...chat, chat: false } })] });
    expect(setModelPicked(settingsWith([e]), 'e1', 'emb', true).routing.default).toBeNull();
    const picked = setModelPicked(settingsWith([e]), 'e1', 'a', true);
    expect(picked.routing.default).toEqual({ engineId: 'e1', modelId: 'a' });
    const both = setModelPicked(picked, 'e1', 'b', true);
    expect(both.routing.default).toEqual({ engineId: 'e1', modelId: 'a' });
    expect(setModelPicked(both, 'e1', 'a', false).routing.default).toEqual({ engineId: 'e1', modelId: 'b' });
    expect(setModelPicked(setModelPicked(both, 'e1', 'b', false), 'e1', 'a', false).routing.default).toBeNull();
  });

  it('the setup choice is the default and replaces only the model the form chose before', () => {
    const e = engine({ models: [model('a', { enabled: true }), model('b'), model('mine', { enabled: true })] });
    const chosen = chooseSetupModel(settingsWith([e], { engineId: 'e1', modelId: 'a' }), 'e1', 'b', 'a');
    expect(chosen.routing.default).toEqual({ engineId: 'e1', modelId: 'b' });
    expect(chosen.engines[0].models.map((m) => [m.id, m.enabled])).toEqual([['b', true], ['a', false], ['mine', true]]);
    // Choosing the same model again, or with nothing chosen before, turns nothing off.
    expect(chooseSetupModel(chosen, 'e1', 'b', 'b').engines[0].models.filter((m) => m.enabled).map((m) => m.id)).toEqual(['b', 'mine']);
    expect(chooseSetupModel(settingsWith([e]), 'e1', 'b').engines[0].models.filter((m) => m.enabled).map((m) => m.id)).toEqual(['b', 'a', 'mine']);
  });
});

describe('autoFetchDecision', () => {
  const cloud = (over: Partial<AutoFetchState> = {}): AutoFetchState => ({ event: 'key', family: 'cloud', key: '', baseUrl: 'https://api.anthropic.com', discovery: 'auto', ...over });
  const local = (over: Partial<AutoFetchState> = {}): AutoFetchState => ({ event: 'url', family: 'local', key: '', baseUrl: 'http://127.0.0.1:1234/v1', discovery: 'auto', ...over });

  it('cloud: fetches once the key settles, storing it first; an emptied key cancels', () => {
    const first = autoFetchDecision(null, cloud({ key: 'sk-1' }));
    expect(first).toMatchObject({ fetch: true, delayMs: AUTO_FETCH_KEY_DELAY_MS, storeKey: true, cancelPending: true });
    // Every keystroke restarts the wait (cancelPending), so only the settled value fetches.
    const typing = autoFetchDecision(cloud({ key: 'sk-1' }), cloud({ key: 'sk-12' }));
    expect(typing).toMatchObject({ fetch: true, cancelPending: true, delayMs: AUTO_FETCH_KEY_DELAY_MS });
    expect(autoFetchDecision(cloud({ key: 'sk-1' }), cloud({ key: '' }))).toMatchObject({ fetch: false, cancelPending: true });
    // The key a fetch already ran for does not fetch again.
    expect(autoFetchDecision(null, cloud({ key: 'sk-1', fetchedFor: first.fingerprint })).fetch).toBe(false);
    // A cloud form opening, or a URL edit under Advanced, does not fetch by itself.
    expect(autoFetchDecision(null, cloud({ event: 'open', key: '', neverProbed: true })).fetch).toBe(false);
    expect(autoFetchDecision(null, cloud({ event: 'url', key: 'sk-1' })).fetch).toBe(false);
  });

  it('cloud (B2): opening fetches when the host already has a key, the engine has no models and was never reached', () => {
    const open = (over: Partial<AutoFetchState>) => autoFetchDecision(null, cloud({ event: 'open', hasKey: true, modelCount: 0, neverProbed: true, ...over }));
    expect(open({})).toMatchObject({ fetch: true, delayMs: 0, storeKey: false });
    expect(open({ hasKey: false }).fetch).toBe(false);
    expect(open({ modelCount: 3 }).fetch).toBe(false);
    expect(open({ neverProbed: false }).fetch).toBe(false);
    expect(open({ discovery: 'manual' }).fetch).toBe(false);
  });

  it('local: fetches on a changed URL and on first open of a never-probed engine', () => {
    const changed = autoFetchDecision(null, local());
    expect(changed).toMatchObject({ fetch: true, delayMs: 0, storeKey: false });
    expect(autoFetchDecision(null, local({ fetchedFor: changed.fingerprint })).fetch).toBe(false);
    expect(autoFetchDecision(null, local({ baseUrl: 'not a url' })).fetch).toBe(false);
    expect(autoFetchDecision(null, local({ event: 'open', neverProbed: true })).fetch).toBe(true);
    expect(autoFetchDecision(null, local({ event: 'open', neverProbed: false })).fetch).toBe(false);
    // A key typed into a local form is stored, but does not fetch by itself.
    expect(autoFetchDecision(null, local({ event: 'key', key: 'k' })).fetch).toBe(false);
  });

  it('manual and Retry always run; save never does; manual discovery never auto-fetches', () => {
    expect(autoFetchDecision(null, cloud({ event: 'manual', key: 'sk' }))).toMatchObject({ fetch: true, delayMs: 0, storeKey: true });
    expect(autoFetchDecision(null, local({ event: 'retry', fetchedFor: 'url:http://127.0.0.1:1234/v1' })).fetch).toBe(true);
    expect(autoFetchDecision(null, local({ event: 'save' })).fetch).toBe(false);
    expect(autoFetchDecision(null, local({ discovery: 'manual' })).fetch).toBe(false);
    expect(autoFetchDecision(null, cloud({ key: 'sk', discovery: 'manual' })).fetch).toBe(false);
  });
});

describe('discoveryProblem', () => {
  const base = { family: 'local' as const, presetName: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', listed: 0 };

  it('has copy for unreachable, a rejected key and an empty list, and Retry on each', () => {
    expect(discoveryProblem({ ...base, ok: false, message: 'Could not reach 127.0.0.1:1234 (ECONNREFUSED).' }))
      .toEqual({ kind: 'unreachable', text: 'Nothing answered at http://127.0.0.1:1234/v1. Is LM Studio running?', retry: true });
    expect(discoveryProblem({ ...base, family: 'cloud', baseUrl: 'https://api.anthropic.com', ok: false, message: 'HTTP 401: invalid x-api-key' }))
      .toEqual({ kind: 'auth', text: 'Key rejected by api.anthropic.com.', focus: 'key', retry: true });
    expect(discoveryProblem({ ...base, ok: false, code: 'auth', message: 'nope' })?.kind).toBe('auth');
    expect(discoveryProblem({ ...base, ok: true, listed: 0 })).toMatchObject({ kind: 'empty', text: 'Server is up but no models are loaded.' });
    expect(discoveryProblem({ ...base, ok: true, listed: 3 })).toBeNull();
    expect(discoveryProblem({ ...base, ok: false, message: 'HTTP 500: boom' })).toMatchObject({ kind: 'other', retry: true });
  });
});
