/**
 * Per-feature switches: every available feature can be turned off on its own,
 * a feature that is off is hidden (never merely disabled), one feature's
 * switch never touches another's, and a launch that finds its feature off
 * gets a notice instead of nothing.
 */
import { describe, expect, it } from 'vitest';
import { AI_FEATURES, parseAiSettings, resolveAiFeature } from '../src/ai';
import type { AiSettings, MikeDownAiHost } from '../src/ai';
import { aiFeatureAvailability, aiFeatureOffNotice } from '../src/ai-request';

const CHAT = { chat: true, stream: true } as const;

function settings(over: Record<string, unknown> = {}): AiSettings {
  return parseAiSettings({
    enabled: true,
    allowCloud: false,
    engines: [{ id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', models: [{ id: 'qwen', capabilities: CHAT, capabilitiesSource: 'user' }] }],
    routing: { default: { engineId: 'omlx', modelId: 'qwen' }, fallback: 'none', tasks: {} },
    ...over,
  }, { onWarning: () => {} });
}

// A tier-1 host routes by itself, so availability turns on the switches alone.
const tier1: MikeDownAiHost = { complete: async () => { throw new Error('not called'); } };

const AVAILABLE = AI_FEATURES.filter((f) => f.status === 'available').map((f) => f.id);

describe('feature switches', () => {
  it('has the launchable features the editor wires up', () => {
    expect(AVAILABLE).toEqual(expect.arrayContaining(['rewrite', 'summary', 'title', 'frontmatter']));
  });

  it.each(AVAILABLE)('%s is on by default and hidden once switched off', (id) => {
    expect(aiFeatureAvailability(tier1, settings(), [], {}, id)).toEqual({ state: 'enabled' });
    const off = settings({ features: { [id]: { enabled: false } } });
    expect(resolveAiFeature(off.features, id).enabled).toBe(false);
    expect(aiFeatureAvailability(tier1, off, [], {}, id)).toEqual({ state: 'hidden' });
  });

  it.each(AVAILABLE)('switching %s off leaves every other feature on', (id) => {
    const off = settings({ features: { [id]: { enabled: false } } });
    for (const other of AVAILABLE.filter((o) => o !== id)) {
      expect(aiFeatureAvailability(tier1, off, [], {}, other), other).toEqual({ state: 'enabled' });
    }
  });

  it('keeps a feature off after a round trip through settings, task override included', () => {
    const s = settings({ features: { summary: { enabled: false, task: 'chat' } } });
    expect(resolveAiFeature(s.features, 'summary')).toMatchObject({ enabled: false, task: 'chat' });
    expect(resolveAiFeature(parseAiSettings(JSON.parse(JSON.stringify(s)), { onWarning: () => {} }).features, 'summary').enabled).toBe(false);
  });

  it('opts ghost text in separately: off by default', () => {
    expect(resolveAiFeature(settings().features, 'ghostText').enabled).toBe(false);
  });
});

describe('aiFeatureOffNotice', () => {
  it('names the feature that is off', () => {
    const s = settings({ features: { title: { enabled: false } } });
    expect(aiFeatureOffNotice(tier1, s, 'title')).toBe('Suggest titles is turned off in the AI settings.');
    expect(aiFeatureOffNotice(tier1, s, 'summary')).toBeNull();
  });

  it('says AI is off when the master switch is', () => {
    expect(aiFeatureOffNotice(tier1, settings({ enabled: false }), 'rewrite')).toMatch(/AI is turned off/);
  });

  it('stays quiet without an AI host or when the feature is on', () => {
    expect(aiFeatureOffNotice(undefined, settings({ enabled: false }), 'rewrite')).toBeNull();
    expect(aiFeatureOffNotice(tier1, settings(), 'frontmatter')).toBeNull();
  });
});
