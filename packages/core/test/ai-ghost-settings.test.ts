// @vitest-environment node
/**
 * The `features.ghostText` knobs (decision D12): parsing, defaults, clamping,
 * and the round trip through `serializeAiSettings`.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  GHOST_DELAY_MS_DEFAULT,
  GHOST_DELAY_MS_MAX,
  GHOST_DELAY_MS_MIN,
  GHOST_MAX_TOKENS_DEFAULT,
  GHOST_MAX_TOKENS_MAX,
  GHOST_MAX_TOKENS_MIN,
  ghostTextOptions,
  parseAiSettings,
  resolveAiFeature,
  serializeAiSettings,
} from '@mikedown/core/ai';

const parse = (ghostText: unknown, warn: (m: string) => void = () => {}) => parseAiSettings({ features: { ghostText } }, { onWarning: warn });

describe('ghostTextOptions defaults', () => {
  it('is 400 ms, 48 tokens, auto, local only when nothing is saved', () => {
    const expected = { delayMs: 400, maxTokens: 48, trigger: 'auto', localOnly: true };
    expect(ghostTextOptions(undefined)).toEqual(expected);
    expect(ghostTextOptions({})).toEqual(expected);
    expect(ghostTextOptions({ ghostText: {} })).toEqual(expected);
    expect(ghostTextOptions(parse({ enabled: true }).features)).toEqual(expected);
    expect([GHOST_DELAY_MS_DEFAULT, GHOST_MAX_TOKENS_DEFAULT]).toEqual([400, 48]);
  });

  it('the feature is off until switched on', () => {
    expect(resolveAiFeature(parseAiSettings({}).features, 'ghostText').enabled).toBe(false);
    expect(resolveAiFeature(parse({ enabled: true }).features, 'ghostText').enabled).toBe(true);
  });
});

describe('ghostTextOptions clamping', () => {
  it('clamps the delay to 100 to 5000 ms and rounds it', () => {
    expect(ghostTextOptions(parse({ delayMs: 5 }).features).delayMs).toBe(GHOST_DELAY_MS_MIN);
    expect(ghostTextOptions(parse({ delayMs: 99999 }).features).delayMs).toBe(GHOST_DELAY_MS_MAX);
    expect(ghostTextOptions(parse({ delayMs: 250.6 }).features).delayMs).toBe(251);
    expect(ghostTextOptions(parse({ delayMs: 750 }).features).delayMs).toBe(750);
  });

  it('clamps the token budget to 8 to 256 and rounds it', () => {
    expect(ghostTextOptions(parse({ maxTokens: 0 }).features).maxTokens).toBe(GHOST_MAX_TOKENS_MIN);
    expect(ghostTextOptions(parse({ maxTokens: -3 }).features).maxTokens).toBe(GHOST_MAX_TOKENS_MIN);
    expect(ghostTextOptions(parse({ maxTokens: 9000 }).features).maxTokens).toBe(GHOST_MAX_TOKENS_MAX);
    expect(ghostTextOptions(parse({ maxTokens: 96.4 }).features).maxTokens).toBe(96);
  });

  it('clamps values that skipped the parser too', () => {
    expect(ghostTextOptions({ ghostText: { delayMs: 1, maxTokens: 1000 } })).toMatchObject({ delayMs: 100, maxTokens: 256 });
    expect(ghostTextOptions({ ghostText: { delayMs: Number.NaN, maxTokens: Infinity } })).toMatchObject({ delayMs: 400, maxTokens: 48 });
  });

  it('reads trigger and localOnly', () => {
    expect(ghostTextOptions(parse({ trigger: 'manual' }).features).trigger).toBe('manual');
    expect(ghostTextOptions(parse({ localOnly: false }).features).localOnly).toBe(false);
    expect(ghostTextOptions(parse({ localOnly: true }).features).localOnly).toBe(true);
  });
});

describe('bad types', () => {
  it('are warned about and dropped, leaving the defaults', () => {
    const warn = vi.fn();
    const s = parse({ delayMs: '400', maxTokens: null, trigger: 'sometimes', localOnly: 'yes', enabled: true }, warn);
    expect(warn).toHaveBeenCalledTimes(4);
    const messages = warn.mock.calls.map((c) => String(c[0]));
    for (const key of ['delayMs', 'maxTokens', 'trigger', 'localOnly']) {
      expect(messages.some((m) => m.includes(`features.ghostText.${key}`))).toBe(true);
    }
    expect(s.features.ghostText).toEqual({ enabled: true });
    expect(ghostTextOptions(s.features)).toEqual({ delayMs: 400, maxTokens: 48, trigger: 'auto', localOnly: true });
  });

  it('a non-finite number is dropped', () => {
    const warn = vi.fn();
    const s = parse({ delayMs: Number.POSITIVE_INFINITY }, warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(s.features.ghostText.delayMs).toBeUndefined();
  });

  it('knobs on another feature are left alone, not parsed as ghost text', () => {
    const warn = vi.fn();
    const s = parseAiSettings({ features: { rewrite: { enabled: true, delayMs: 'x' } } }, { onWarning: warn });
    expect(warn).not.toHaveBeenCalled();
    expect(s.features.rewrite).toMatchObject({ enabled: true, delayMs: 'x' });
  });
});

describe('serializeAiSettings', () => {
  it('round-trips the knobs', () => {
    const saved = { enabled: true, delayMs: 650, maxTokens: 96, trigger: 'manual', localOnly: false };
    const settings = parse(saved);
    const patch = serializeAiSettings(settings);
    expect((patch['ai.features'] as Record<string, unknown>).ghostText).toEqual(saved);

    const again = parseAiSettings({ features: patch['ai.features'] }, { onWarning: () => {} });
    expect(ghostTextOptions(again.features)).toEqual({ delayMs: 650, maxTokens: 96, trigger: 'manual', localOnly: false });
    expect(again.features.ghostText).toEqual(saved);
  });

  it('keeps an unknown ghostText key a newer version wrote', () => {
    const settings = parse({ enabled: true, futureKnob: 7 });
    const out = (serializeAiSettings(settings)['ai.features'] as Record<string, Record<string, unknown>>).ghostText;
    expect(out.futureKnob).toBe(7);
  });

  it('writes a copy, not the live object', () => {
    const settings = parse({ delayMs: 500 });
    const patch = serializeAiSettings(settings);
    (patch['ai.features'] as Record<string, Record<string, unknown>>).ghostText.delayMs = 999;
    expect(settings.features.ghostText.delayMs).toBe(500);
  });
});
