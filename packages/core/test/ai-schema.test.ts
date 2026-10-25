// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  AI_ENGINE_PRESETS,
  AI_SETTINGS_KEYS,
  DEFAULT_LOCAL_NETWORKS,
  defaultAiSettings,
  generateAiId,
  isKnownEngineKind,
  parseAiSettings,
  serializeAiSettings,
} from '@mikedown/core/ai';

const quiet = () => {};
const engine = (over: Record<string, unknown> = {}) => ({ name: 'oMLX', baseUrl: 'http://127.0.0.1:8000/v1', ...over });

describe('defaults', () => {
  it('has AI off, cloud blocked, anyLocal fallback and RFC 1918 local networks', () => {
    const s = defaultAiSettings();
    expect(s).toEqual({
      enabled: false,
      allowCloud: false,
      engines: [],
      routing: { default: null, fallback: 'anyLocal', tasks: {} },
      features: {},
      localNetworks: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
    });
    expect(Object.keys(s).sort()).toEqual([...AI_SETTINGS_KEYS].sort());
  });

  it('returns a fresh object each time (no shared mutable defaults)', () => {
    const a = defaultAiSettings();
    a.localNetworks.push('1.2.3.4/32');
    expect(defaultAiSettings().localNetworks).toEqual([...DEFAULT_LOCAL_NETWORKS]);
  });

  it('undefined and null give the defaults without a warning', () => {
    const warn = vi.fn();
    expect(parseAiSettings(undefined, { onWarning: warn })).toEqual(defaultAiSettings());
    expect(parseAiSettings(null, { onWarning: warn })).toEqual(defaultAiSettings());
    expect(parseAiSettings({}, { onWarning: warn })).toEqual(defaultAiSettings());
    expect(warn).not.toHaveBeenCalled();
  });

  it('a non-object gives the defaults with one warning, never a throw', () => {
    const warn = vi.fn();
    expect(parseAiSettings('nope', { onWarning: warn })).toEqual(defaultAiSettings());
    expect(parseAiSettings([1, 2], { onWarning: warn })).toEqual(defaultAiSettings());
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('fills engine and model defaults', () => {
    const s = parseAiSettings({ engines: [engine({ models: [{ id: 'm' }] })] }, { onWarning: quiet });
    const e = s.engines[0];
    expect(e).toMatchObject({ name: 'oMLX', kind: 'openai-compatible', enabled: true, locality: 'auto', discovery: 'auto' });
    expect(e.apiKeyEnv).toBeUndefined();
    expect(e.models[0]).toMatchObject({ id: 'm', enabled: true, capabilitiesSource: 'heuristic' });
    expect(e.models[0].capabilities.chat).toBe(true);
  });

  it('names an engine after its base URL when it has no name', () => {
    const s = parseAiSettings({ engines: [{ baseUrl: 'http://x:1/v1' }] }, { onWarning: quiet });
    expect(s.engines[0].name).toBe('http://x:1/v1');
  });

  it('accepts the nested object, flat ai.* keys and { ai: {...} }', () => {
    const nested = parseAiSettings({ enabled: true, allowCloud: true }, { onWarning: quiet });
    const flat = parseAiSettings({ 'ai.enabled': true, 'ai.allowCloud': true }, { onWarning: quiet });
    const wrapped = parseAiSettings({ ai: { enabled: true, allowCloud: true } }, { onWarning: quiet });
    expect(nested.enabled && nested.allowCloud).toBe(true);
    expect(flat).toEqual(nested);
    expect(wrapped).toEqual(nested);
  });

  it('keeps a user-edited localNetworks list and drops blank entries', () => {
    const s = parseAiSettings({ localNetworks: ['10.0.98.0/24', '  ', 5, '.ts.net'] }, { onWarning: quiet });
    expect(s.localNetworks).toEqual(['10.0.98.0/24', '.ts.net']);
  });
});

describe('unknown keys are preserved', () => {
  const raw = {
    enabled: true,
    futureTop: { a: 1 },
    engines: [
      engine({
        id: 'e1',
        futureEngine: 'x',
        models: [{ id: 'm1', futureModel: [1, 2], capabilities: { chat: true, futureCap: 1 } }],
      }),
    ],
    routing: { default: { engineId: 'e1', modelId: 'm1', futureRoute: true }, tasks: { vision: { engineId: 'e1', modelId: 'm1' } }, futureRouting: 1 },
    features: { rewrite: { enabled: false, futureFeature: 'y' }, newThing: { enabled: true } },
  };

  it('on the top level, engines, models, routing, routes and feature entries', () => {
    const s = parseAiSettings(raw, { onWarning: quiet }) as any;
    expect(s.futureTop).toEqual({ a: 1 });
    expect(s.engines[0].futureEngine).toBe('x');
    expect(s.engines[0].models[0].futureModel).toEqual([1, 2]);
    expect(s.routing.futureRouting).toBe(1);
    expect(s.routing.default.futureRoute).toBe(true);
    expect(s.features.rewrite.futureFeature).toBe('y');
    expect(s.features.newThing).toEqual({ enabled: true });
  });

  it('through serialize and parse again', () => {
    const first = parseAiSettings(raw, { onWarning: quiet });
    const patch = serializeAiSettings(first);
    expect(patch['ai.futureTop']).toEqual({ a: 1 });
    const again = parseAiSettings(patch, { onWarning: quiet }) as any;
    expect(again.futureTop).toEqual({ a: 1 });
    expect(again.engines[0].futureEngine).toBe('x');
    expect(again.engines[0].models[0].futureModel).toEqual([1, 2]);
    expect(again.routing.default.futureRoute).toBe(true);
    expect(again.features.rewrite.futureFeature).toBe('y');
  });

  it('keeps an engine of an unknown kind (a newer version\'s) instead of dropping it', () => {
    const s = parseAiSettings({ engines: [engine({ id: 'e1', kind: 'quantum-llm' })] }, { onWarning: quiet });
    expect(s.engines).toHaveLength(1);
    expect(s.engines[0].kind).toBe('quantum-llm');
    expect(isKnownEngineKind('quantum-llm')).toBe(false);
    expect(isKnownEngineKind('lmstudio')).toBe(true);
    expect(serializeAiSettings(s)['ai.engines']).toMatchObject([{ kind: 'quantum-llm' }]);
  });
});

describe('ids', () => {
  it('generates a missing engine id once and calls the generator once per engine', () => {
    const generateId = vi.fn((name: string) => `gen-${name}`);
    const s = parseAiSettings({ engines: [engine(), engine({ name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' })] }, { generateId, onWarning: quiet });
    expect(s.engines.map((e) => e.id)).toEqual(['gen-oMLX', 'gen-LM Studio']);
    expect(generateId).toHaveBeenCalledTimes(2);
  });

  it('is stable across parse, serialize, parse: the second parse generates nothing', () => {
    const first = parseAiSettings({ engines: [engine()] }, { onWarning: quiet });
    const generateId = vi.fn(() => 'should-not-be-used');
    const second = parseAiSettings(serializeAiSettings(first), { generateId, onWarning: quiet });
    expect(generateId).not.toHaveBeenCalled();
    expect(second.engines[0].id).toBe(first.engines[0].id);
    const third = parseAiSettings(serializeAiSettings(second), { onWarning: quiet });
    expect(third.engines[0].id).toBe(first.engines[0].id);
  });

  it('keeps ids the user or an earlier version saved', () => {
    const s = parseAiSettings({ engines: [engine({ id: 'omlx-studio' })] }, { onWarning: quiet });
    expect(s.engines[0].id).toBe('omlx-studio');
  });

  it('gives a repeated engine id a fresh one, with a warning', () => {
    const warn = vi.fn();
    const s = parseAiSettings({ engines: [engine({ id: 'dup' }), engine({ id: 'dup', name: 'Second' })] }, { onWarning: warn });
    expect(s.engines).toHaveLength(2);
    expect(s.engines[0].id).toBe('dup');
    expect(s.engines[1].id).not.toBe('dup');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('never hands out an id that is already taken, even if the generator repeats itself', () => {
    const answers = ['a', 'a', 'b'];
    const s = parseAiSettings({ engines: [engine(), engine({ name: 'Two' })] }, { generateId: () => answers.shift()!, onWarning: quiet });
    expect(s.engines.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('generateAiId makes slugged, distinct ids and handles empty names', () => {
    const a = generateAiId('oMLX (Mac Studio)');
    expect(a).toMatch(/^omlx-mac-studio-[a-z0-9]{6}$/);
    expect(generateAiId('oMLX (Mac Studio)')).not.toBe(a);
    expect(generateAiId('')).toMatch(/^engine-[a-z0-9]{8}$/);
    expect(generateAiId('!!!')).toMatch(/^engine-[a-z0-9]{8}$/);
  });
});

describe('malformed entries are dropped with a warning, never thrown', () => {
  it('drops an engine with no baseUrl (or not an object)', () => {
    const warn = vi.fn();
    const s = parseAiSettings({ engines: [{ name: 'broken' }, 'text', null, engine({ id: 'ok' })] }, { onWarning: warn });
    expect(s.engines.map((e) => e.id)).toEqual(['ok']);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('ignores a non-array engines value', () => {
    const warn = vi.fn();
    expect(parseAiSettings({ engines: { a: 1 } }, { onWarning: warn }).engines).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('drops models with no id and repeated ids', () => {
    const warn = vi.fn();
    const s = parseAiSettings({ engines: [engine({ id: 'e', models: [{ label: 'no id' }, { id: '  ' }, { id: 'm' }, { id: 'm', label: 'again' }, 7] })] }, { onWarning: warn });
    expect(s.engines[0].models.map((m) => m.id)).toEqual(['m']);
    expect(s.engines[0].models[0].label).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it('clears a default route missing either id, and drops task routes the same way', () => {
    const warn = vi.fn();
    const s = parseAiSettings(
      {
        routing: {
          default: { engineId: 'e' },
          tasks: { a: { engineId: 'e', modelId: 'm' }, b: { modelId: 'm' }, c: 'x', d: null },
        },
      },
      { onWarning: warn },
    );
    expect(s.routing.default).toBeNull();
    expect(Object.keys(s.routing.tasks)).toEqual(['a']);
    // default, b and c warn; an explicit null task is a quiet "no override".
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('falls back to anyLocal for an unknown fallback mode', () => {
    const warn = vi.fn();
    expect(parseAiSettings({ routing: { fallback: 'whatever' } }, { onWarning: warn }).routing.fallback).toBe('anyLocal');
    expect(warn).toHaveBeenCalledTimes(1);
    for (const mode of ['none', 'default', 'anyLocal', 'any']) {
      expect(parseAiSettings({ routing: { fallback: mode } }, { onWarning: quiet }).routing.fallback).toBe(mode);
    }
  });

  it('ignores wrong-typed routing, features and localNetworks values', () => {
    const warn = vi.fn();
    const s = parseAiSettings({ routing: 'x', features: [1], localNetworks: 'lan', enabled: 'yes', allowCloud: 1 }, { onWarning: warn });
    expect(s.routing).toEqual(defaultAiSettings().routing);
    expect(s.features).toEqual({});
    expect(s.localNetworks).toEqual([...DEFAULT_LOCAL_NETWORKS]);
    expect(s.enabled).toBe(false);
    expect(s.allowCloud).toBe(false);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('drops feature entries that are not objects and ignores a non-object requestOverrides', () => {
    const warn = vi.fn();
    const s = parseAiSettings(
      { features: { good: { enabled: false, task: 'vision' }, bad: true }, engines: [engine({ id: 'e', models: [{ id: 'm', requestOverrides: 'x' }] })] },
      { onWarning: warn },
    );
    expect(s.features).toEqual({ good: { enabled: false, task: 'vision' } });
    expect(s.engines[0].models[0].requestOverrides).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('defaults to console.warn when no onWarning is given', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      parseAiSettings({ engines: [{ name: 'broken' }] });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('never throws on garbage', () => {
    const garbage = [0, true, 'x', [], [[]], { engines: [[], {}, { baseUrl: 5 }], routing: { tasks: [] }, features: { a: null } }, { 'ai.engines': 'x' }];
    for (const g of garbage) {
      expect(() => parseAiSettings(g, { onWarning: quiet })).not.toThrow();
    }
  });
});

describe('models', () => {
  it('fills capabilities from the id heuristics when none are saved', () => {
    const s = parseAiSettings({ engines: [engine({ id: 'e', models: [{ id: 'gemma-4-31b-it' }] })] }, { onWarning: quiet });
    expect(s.engines[0].models[0].capabilities).toMatchObject({ vision: true, contextTokens: 131072 });
    expect(s.engines[0].models[0].capabilitiesSource).toBe('heuristic');
  });

  it('keeps saved capabilities and their source, completing missing fields from the id', () => {
    const s = parseAiSettings(
      { engines: [engine({ id: 'e', models: [{ id: 'gemma-4-31b-it', capabilities: { vision: false }, capabilitiesSource: 'user' }] })] },
      { onWarning: quiet },
    );
    const m = s.engines[0].models[0];
    expect(m.capabilities.vision).toBe(false);
    expect(m.capabilities.json).toBe(true);
    expect(m.capabilitiesSource).toBe('user');
  });

  it('treats an unknown capabilitiesSource as heuristic', () => {
    const s = parseAiSettings({ engines: [engine({ id: 'e', models: [{ id: 'm', capabilities: {}, capabilitiesSource: 'oracle' }] })] }, { onWarning: quiet });
    expect(s.engines[0].models[0].capabilitiesSource).toBe('heuristic');
  });

  it('keeps an explicit null context window instead of the heuristic guess', () => {
    const s = parseAiSettings({ engines: [engine({ id: 'e', models: [{ id: 'm', capabilities: { contextTokens: null } }] })] }, { onWarning: quiet });
    expect(s.engines[0].models[0].capabilities.contextTokens).toBeNull();
  });

  it('keeps label, enabled, requestOverrides, missing and manual flags', () => {
    const s = parseAiSettings(
      { engines: [engine({ id: 'e', models: [{ id: 'm', label: 'Mine', enabled: false, requestOverrides: { reasoning_effort: 'low' }, missing: true, manual: true }] })] },
      { onWarning: quiet },
    );
    expect(s.engines[0].models[0]).toMatchObject({ label: 'Mine', enabled: false, requestOverrides: { reasoning_effort: 'low' }, missing: true, manual: true });
  });
});

describe('serializeAiSettings', () => {
  it('returns one ai.<key> per top-level key, deep-copied', () => {
    const s = parseAiSettings({ enabled: true, engines: [engine({ id: 'e' })] }, { onWarning: quiet });
    const patch = serializeAiSettings(s);
    expect(Object.keys(patch).sort()).toEqual(AI_SETTINGS_KEYS.map((k) => `ai.${k}`).sort());
    expect(patch['ai.enabled']).toBe(true);
    (patch['ai.engines'] as any[])[0].name = 'mutated';
    expect(s.engines[0].name).toBe('oMLX');
  });

  it('round-trips a full settings object unchanged', () => {
    const first = parseAiSettings(
      {
        enabled: true,
        allowCloud: true,
        engines: [engine({ id: 'e', apiKeyEnv: 'OMLX_API_KEY', locality: 'local', discovery: 'manual', models: [{ id: 'm', label: 'M', requestOverrides: { a: { b: 1 } } }] })],
        routing: { default: { engineId: 'e', modelId: 'm' }, fallback: 'any', tasks: { vision: { engineId: 'e', modelId: 'm' } } },
        features: { rewrite: { enabled: true, task: 'rewrite' } },
        localNetworks: ['10.0.98.0/24'],
      },
      { onWarning: quiet },
    );
    expect(parseAiSettings(serializeAiSettings(first), { onWarning: quiet })).toEqual(first);
  });

  it('carries no secrets: an api key field on an engine is not a known key, and only apiKeyEnv is saved by name', () => {
    const s = parseAiSettings({ engines: [engine({ id: 'e', apiKeyEnv: 'ANTHROPIC_API_KEY' })] }, { onWarning: quiet });
    expect(JSON.stringify(serializeAiSettings(s))).toContain('ANTHROPIC_API_KEY');
    expect(s.engines[0]).not.toHaveProperty('apiKey');
  });

  describe('apiKeyFile', () => {
    const file = { path: '~/.omlx/settings.json', jsonPath: 'auth.api_key' };

    it('parses and round-trips a key file, trimming both parts and keeping unknown keys', () => {
      const s = parseAiSettings({ engines: [engine({ id: 'e', apiKeyFile: { path: '  ~/.omlx/settings.json ', jsonPath: ' auth.api_key ', extra: 1 } })] }, { onWarning: quiet });
      expect(s.engines[0].apiKeyFile).toEqual({ ...file, extra: 1 });
      const again = parseAiSettings(serializeAiSettings(s), { onWarning: quiet });
      expect(again.engines[0].apiKeyFile).toEqual({ ...file, extra: 1 });
      expect(serializeAiSettings(s)['ai.engines']).toEqual([expect.objectContaining({ apiKeyFile: { ...file, extra: 1 } })]);
    });

    it('drops a malformed key file with a warning and keeps the engine', () => {
      for (const bad of ['~/x', 7, null, [], { path: '~/x' }, { jsonPath: 'a' }, { path: '', jsonPath: 'a' }, { path: '~/x', jsonPath: ' ' }, { path: 1, jsonPath: 'a' }]) {
        const warn = vi.fn();
        const s = parseAiSettings({ engines: [engine({ id: 'e', apiKeyFile: bad })] }, { onWarning: warn });
        expect(s.engines).toHaveLength(1);
        expect(s.engines[0].apiKeyFile).toBeUndefined();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('apiKeyFile'));
      }
    });

    it('is absent unless set, and the oMLX preset sets it beside the variable', () => {
      expect(parseAiSettings({ engines: [engine({ id: 'e' })] }, { onWarning: quiet }).engines[0]).not.toHaveProperty('apiKeyFile');
      const omlx = AI_ENGINE_PRESETS.find((p) => p.id === 'omlx')!;
      expect(omlx.apiKeyEnv).toBe('OMLX_API_KEY');
      expect(omlx.apiKeyFile).toEqual(file);
      expect(AI_ENGINE_PRESETS.filter((p) => p.id !== 'omlx').some((p) => p.apiKeyFile)).toBe(false);
    });
  });
});
