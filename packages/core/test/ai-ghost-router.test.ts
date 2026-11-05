// @vitest-environment node
/**
 * Routing for the `continue` task that Inline suggestions use: the localOnly
 * gate, the capability gate (a model needs `fim` or `chat`) and what the
 * `prefers` / fallback machinery really does with `fim`.
 */
import { describe, expect, it } from 'vitest';
import { getAiTask, isRouteUsable, parseAiSettings, resolveRoute } from '@mikedown/core/ai';
import type { AiEngineStatus, AiModelCapabilities, AiRouteResolution, AiSettings } from '@mikedown/core/ai';

const strict = (raw: unknown): AiSettings =>
  parseAiSettings(raw, {
    onWarning: (m) => {
      throw new Error(m);
    },
  });

const CAPS: AiModelCapabilities = { chat: true, stream: true, vision: false, json: false, tools: false, fim: false, embed: false, contextTokens: 8192 };
const model = (id: string, caps: Partial<AiModelCapabilities> = {}) => ({ id, enabled: true, capabilities: { ...CAPS, ...caps }, capabilitiesSource: 'user' });

const local = (id: string, models: unknown[], over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  kind: 'openai-compatible',
  baseUrl: `http://127.0.0.1:${id === 'a' ? 8000 : 8001}/v1`,
  models,
  ...over,
});
const cloud = (models: unknown[]) => ({ id: 'cloud', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', models });

function settings(over: { engines: unknown[]; default: [string, string] | null; fallback?: string; allowCloud?: boolean }): AiSettings {
  return strict({
    enabled: true,
    allowCloud: over.allowCloud ?? false,
    engines: over.engines,
    routing: { default: over.default ? { engineId: over.default[0], modelId: over.default[1] } : null, fallback: over.fallback ?? 'anyLocal', tasks: {} },
    features: { ghostText: { enabled: true } },
  });
}

const route = (s: AiSettings, statuses: AiEngineStatus[] = [], opts: { localOnly?: boolean } = {}): AiRouteResolution =>
  resolveRoute(s, statuses, {}, { feature: 'ghostText', ...opts });
const ok = (r: AiRouteResolution) => {
  if (!isRouteUsable(r)) {throw new Error(`expected a usable route, got ${r.unusable}: ${r.reason}`);}
  return r;
};
const unusable = (r: AiRouteResolution) => {
  if (isRouteUsable(r)) {throw new Error(`expected unusable, got ${r.engineId}/${r.modelId}`);}
  return r;
};
const down = (id: string): AiEngineStatus => ({ engineId: id, ok: false, isLocal: true, hasKey: false, models: [], error: 'ECONNREFUSED' });

describe('the continue task', () => {
  it('routes ghostText by the continue task, which needs streaming and fim or chat', () => {
    const def = getAiTask('continue');
    expect(def?.requires).toEqual({ stream: true });
    expect(def?.requiresAny).toEqual(['fim', 'chat']);
    expect(ok(route(settings({ engines: [local('a', [model('m')])], default: ['a', 'm'] }))).task).toBe('continue');
  });
});

describe('localOnly', () => {
  const s = settings({ engines: [cloud([model('claude', { contextTokens: 200000 })])], default: ['cloud', 'claude'], allowCloud: true });

  it('rejects a cloud route with cloudBlocked, even with Allow cloud on', () => {
    const r = unusable(route(s, [], { localOnly: true }));
    expect(r.unusable).toBe('cloudBlocked');
    expect(r.reason).toMatch(/local engines only/i);
  });

  it('without localOnly the same cloud route is usable (pending consent)', () => {
    expect(ok(route(s))).toMatchObject({ engineId: 'cloud', isLocal: false, needsConsent: true });
  });

  it('a local route is untouched by localOnly', () => {
    const l = settings({ engines: [local('a', [model('m')])], default: ['a', 'm'] });
    expect(ok(route(l, [], { localOnly: true }))).toMatchObject({ engineId: 'a', modelId: 'm', isLocal: true });
  });

  it('never falls back from a down local engine to cloud, even in fallback "any"', () => {
    const both = settings({ engines: [local('a', [model('m')]), cloud([model('claude')])], default: ['a', 'm'], fallback: 'any', allowCloud: true });
    const r = unusable(route(both, [down('a')], { localOnly: true }));
    expect(r.unusable).toBe('probeFailed');
    // Without localOnly "any" does reach the cloud engine.
    expect(ok(route(both, [down('a')]))).toMatchObject({ engineId: 'cloud', viaFallback: true });
  });
});

describe('capabilities', () => {
  it('rejects a model with neither fim nor chat', () => {
    const s = settings({ engines: [local('a', [model('embedder', { chat: false, fim: false })])], default: ['a', 'embedder'], fallback: 'none' });
    const r = unusable(route(s));
    expect(r.unusable).toBe('capability');
    expect(r.reason).toMatch(/lacks/);
  });

  it('accepts a chat-only model and a fim-only model', () => {
    const chat = settings({ engines: [local('a', [model('c', { chat: true, fim: false })])], default: ['a', 'c'], fallback: 'none' });
    const fim = settings({ engines: [local('a', [model('f', { chat: false, fim: true })])], default: ['a', 'f'], fallback: 'none' });
    expect(ok(route(chat)).modelId).toBe('c');
    expect(ok(route(fim)).modelId).toBe('f');
  });

  it('still needs streaming', () => {
    const s = settings({ engines: [local('a', [model('m', { stream: false })])], default: ['a', 'm'], fallback: 'none' });
    expect(unusable(route(s)).unusable).toBe('capability');
  });

  it('passes over an unfit default model for a fit one when the fallback allows', () => {
    const s = settings({ engines: [local('a', [model('embedder', { chat: false }), model('chatty')])], default: ['a', 'embedder'] });
    expect(ok(route(s))).toMatchObject({ modelId: 'chatty', viaFallback: true });
  });
});

describe('fim preference', () => {
  // The `continue` task declares no `prefers` (only `requiresAny: ['fim', 'chat']`), so the
  // router has no fim preference to apply. The chosen route is honoured as is, and among
  // fallback candidates the registry order decides. This pins that behaviour; if `continue`
  // gains `prefers: { fim: true }` the fallback test below flips on purpose.
  const engines = [local('a', [model('chat-only'), model('fim-model', { fim: true })])];

  it('the task has no prefers today', () => {
    expect(getAiTask('continue')?.prefers).toBeUndefined();
  });

  it('honours the chosen route even when another model has fim', () => {
    const s = settings({ engines, default: ['a', 'chat-only'] });
    expect(ok(route(s))).toMatchObject({ modelId: 'chat-only', viaFallback: false });
  });

  it('a fim model is routable like any other', () => {
    const s = settings({ engines, default: ['a', 'fim-model'] });
    expect(ok(route(s))).toMatchObject({ modelId: 'fim-model', viaFallback: false });
  });

  it('among local fallback candidates the registry order wins, not fim', () => {
    const s = settings({
      engines: [local('a', [model('dead')]), local('b', [model('chat-only'), model('fim-model', { fim: true })])],
      default: ['a', 'dead'],
    });
    const r = ok(route(s, [down('a')]));
    expect(r).toMatchObject({ engineId: 'b', modelId: 'chat-only', viaFallback: true });
  });
});
