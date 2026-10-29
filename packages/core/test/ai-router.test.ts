// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SUMMARIZE_MIN_CONTEXT_TOKENS,
  getAiFeature,
  isRouteUsable,
  parseAiSettings,
  resolveRoute,
} from '@mikedown/core/ai';
import type { AiConsentState, AiEngineStatus, AiModelCapabilities, AiRouteResolution, AiSettings } from '@mikedown/core/ai';

const FIXTURES = join(__dirname, '..', '..', '..', 'test', 'ai-fixtures');
const scenarios: any[] = JSON.parse(readFileSync(join(FIXTURES, 'routing', 'scenarios.json'), 'utf8')).scenarios;

const strict = (raw: unknown): AiSettings =>
  parseAiSettings(raw, {
    onWarning: (m) => {
      throw new Error(m);
    },
  });

// ── Fixture scenarios ───────────────────────────────────────────────────────

describe('fixture scenarios', () => {
  for (const sc of scenarios) {
    it(sc.name, () => {
      const result = resolveRoute(strict(sc.settings), sc.statuses as AiEngineStatus[], sc.consent, sc.request);
      expect(result).toMatchObject(sc.expected);
      if (isRouteUsable(result)) {
        // A fallback always says why the preferred route was passed over; a direct hit never does.
        expect(typeof result.reason === 'string' && result.reason.length > 0).toBe(result.viaFallback);
        expect('unusable' in result).toBe(false);
      } else {
        expect(result.reason.length).toBeGreaterThan(0);
      }
    });
  }

  it('covers every unusable code the router can return that a user can fix', () => {
    const seen = new Set(scenarios.map((s) => s.expected.unusable).filter(Boolean));
    for (const code of ['aiDisabled', 'featureDisabled', 'noRoute', 'capability', 'cloudBlocked', 'probeFailed']) {
      expect(seen.has(code), code).toBe(true);
    }
  });
});

// ── A small registry for targeted tests ─────────────────────────────────────

const CHAT: AiModelCapabilities = { chat: true, stream: true, vision: false, json: true, tools: true, fim: false, embed: false, contextTokens: 131072 };
const model = (id: string, caps: Partial<AiModelCapabilities> = {}, extra: Record<string, unknown> = {}) => ({
  id,
  enabled: true,
  capabilities: { ...CHAT, ...caps },
  capabilitiesSource: 'user',
  ...extra,
});

interface Over {
  settings?: Record<string, unknown>;
  routing?: Record<string, unknown>;
  omlx?: Record<string, unknown>;
  lms?: Record<string, unknown>;
  claude?: Record<string, unknown>;
}

/** oMLX (local, two models), LM Studio (local, one vision model), Claude (cloud). Default = oMLX/main. */
function registry(over: Over = {}): AiSettings {
  return strict({
    enabled: true,
    allowCloud: false,
    engines: [
      {
        id: 'omlx',
        name: 'oMLX',
        kind: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:8000/v1',
        models: [model('main'), model('second')],
        ...over.omlx,
      },
      {
        id: 'lms',
        name: 'LM Studio',
        kind: 'lmstudio',
        baseUrl: 'http://127.0.0.1:1234/v1',
        models: [model('gemma', { vision: true })],
        ...over.lms,
      },
      {
        id: 'claude',
        name: 'Anthropic',
        kind: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        models: [model('claude-sonnet-5-5', { vision: true, contextTokens: 1000000 })],
        ...over.claude,
      },
    ],
    routing: { default: { engineId: 'omlx', modelId: 'main' }, fallback: 'anyLocal', tasks: {}, ...over.routing },
    ...over.settings,
  });
}

const down = (...ids: string[]): AiEngineStatus[] => ids.map((engineId) => ({ engineId, ok: false, isLocal: true, hasKey: false, models: [], error: 'ECONNREFUSED' }));
const up = (...ids: string[]): AiEngineStatus[] => ids.map((engineId) => ({ engineId, ok: true, isLocal: true, hasKey: false, models: [] }));

const rewrite = (s: AiSettings, statuses: AiEngineStatus[] = [], consent: AiConsentState = {}, opts: { feature?: string; task?: string } = {}): AiRouteResolution =>
  resolveRoute(s, statuses, consent, { feature: opts.feature ?? 'rewrite', task: opts.task });

const ok = (r: AiRouteResolution) => {
  if (!isRouteUsable(r)) {throw new Error(`expected a usable route, got ${r.unusable}: ${r.reason}`);}
  return r;
};
const unusable = (r: AiRouteResolution) => {
  if (isRouteUsable(r)) {throw new Error(`expected unusable, got ${r.engineId}/${r.modelId}`);}
  return r;
};

// ── Steps 1 and 2: switches and route choice ────────────────────────────────

describe('master switch, feature switch and route choice', () => {
  it('uses the default route and reports the task', () => {
    expect(ok(rewrite(registry()))).toEqual({ engineId: 'omlx', modelId: 'main', viaFallback: false, task: 'rewrite', isLocal: true, needsConsent: false });
  });

  it('master switch off is aiDisabled, even with a perfect registry', () => {
    expect(unusable(rewrite(registry({ settings: { enabled: false } }))).unusable).toBe('aiDisabled');
  });

  it('a feature turned off is featureDisabled; ghostText is off by default; unknown features are off', () => {
    expect(unusable(rewrite(registry({ settings: { features: { rewrite: { enabled: false } } } }))).unusable).toBe('featureDisabled');
    expect(unusable(rewrite(registry(), [], {}, { feature: 'ghostText' })).unusable).toBe('featureDisabled');
    expect(unusable(rewrite(registry(), [], {}, { feature: 'someFutureFeature' })).unusable).toBe('featureDisabled');
  });

  it('a feature switched on in settings routes by its own task, with unknown tasks falling to the default', () => {
    const s = registry({ settings: { features: { someFutureFeature: { enabled: true, task: 'brandNewTask' } } } });
    const r = ok(rewrite(s, [], {}, { feature: 'someFutureFeature' }));
    expect(r).toMatchObject({ engineId: 'omlx', modelId: 'main', task: 'brandNewTask' });
  });

  it('routing.tasks[task] beats the default; a task passed in the options beats the feature\'s own', () => {
    const s = registry({ routing: { tasks: { rewrite: { engineId: 'omlx', modelId: 'second' }, vision: { engineId: 'lms', modelId: 'gemma' } } } });
    expect(ok(rewrite(s))).toMatchObject({ modelId: 'second', task: 'rewrite' });
    expect(ok(rewrite(s, [], {}, { task: 'vision' }))).toMatchObject({ engineId: 'lms', modelId: 'gemma', task: 'vision' });
  });

  it('a feature\'s saved task override is followed', () => {
    const s = registry({
      settings: { features: { altText: { enabled: true, task: 'vision' }, rewrite: { enabled: true, task: 'vision' } } },
      routing: { tasks: { vision: { engineId: 'lms', modelId: 'gemma' } } },
    });
    expect(ok(rewrite(s)).engineId).toBe('lms');
  });

  it('no default and no task route is noRoute (and a fallback cannot invent one with mode none)', () => {
    const none = registry({ routing: { default: null, fallback: 'none' } });
    expect(unusable(rewrite(none)).unusable).toBe('noRoute');
  });

  it('no default with anyLocal still finds a local model by scanning the registry', () => {
    const r = ok(rewrite(registry({ routing: { default: null } })));
    expect(r).toMatchObject({ engineId: 'omlx', modelId: 'main', viaFallback: true });
  });
});

// ── Step 3: usability ───────────────────────────────────────────────────────

describe('usability checks on the preferred route (fallback none shows the raw reason)', () => {
  const strictNone = (over: Over = {}) => registry({ ...over, routing: { fallback: 'none', ...over.routing } });

  it('engine deleted', () => {
    const s = strictNone({ routing: { default: { engineId: 'gone', modelId: 'x' } } });
    expect(unusable(rewrite(s)).unusable).toBe('engineMissing');
  });

  it('model not in the engine', () => {
    const s = strictNone({ routing: { default: { engineId: 'omlx', modelId: 'nope' } } });
    expect(unusable(rewrite(s)).unusable).toBe('modelMissing');
  });

  it('disabled engine, disabled model', () => {
    expect(unusable(rewrite(strictNone({ omlx: { enabled: false } }))).unusable).toBe('engineDisabled');
    expect(unusable(rewrite(strictNone({ omlx: { models: [model('main', {}, { enabled: false })] } }))).unusable).toBe('modelDisabled');
  });

  it('an engine kind from a newer version is engineUnsupported', () => {
    expect(unusable(rewrite(strictNone({ omlx: { kind: 'quantum-llm' } }))).unusable).toBe('engineUnsupported');
  });

  it('a model flagged missing in settings, or by the last status, is modelNotListed', () => {
    expect(unusable(rewrite(strictNone({ omlx: { models: [model('main', {}, { missing: true })] } }))).unusable).toBe('modelNotListed');
    const status: AiEngineStatus = { engineId: 'omlx', ok: true, isLocal: true, hasKey: false, models: [{ id: 'main', capabilities: CHAT, source: 'endpoint', missing: true }] };
    expect(unusable(rewrite(strictNone(), [status])).unusable).toBe('modelNotListed');
  });

  it('a failed probe is probeFailed with the error in the reason; never probed (ok null) or no status is usable', () => {
    const r = unusable(rewrite(strictNone(), down('omlx')));
    expect(r.unusable).toBe('probeFailed');
    expect(r.reason).toContain('oMLX');
    expect(r.reason).toContain('ECONNREFUSED');
    const neverProbed: AiEngineStatus = { engineId: 'omlx', ok: null, isLocal: true, hasKey: false, models: [] };
    expect(isRouteUsable(rewrite(strictNone(), [neverProbed]))).toBe(true);
    expect(isRouteUsable(rewrite(strictNone(), []))).toBe(true);
    expect(isRouteUsable(rewrite(strictNone(), up('omlx')))).toBe(true);
  });

  it('a status for a different engine does not affect this one', () => {
    expect(isRouteUsable(rewrite(strictNone(), down('lms', 'claude')))).toBe(true);
  });
});

describe('capability gating', () => {
  it('vision routed to a model without vision is unusable (capability), naming the missing capability', () => {
    const s = registry({ routing: { fallback: 'none', tasks: { vision: { engineId: 'omlx', modelId: 'main' } } } });
    const r = unusable(rewrite(s, [], {}, { feature: 'altText' }));
    expect(r.unusable).toBe('capability');
    expect(r.reason).toContain('vision');
  });

  it('summarize needs only chat: a small or unknown context window is still usable (a preference, not a gate)', () => {
    expect(SUMMARIZE_MIN_CONTEXT_TOKENS).toBe(32768);
    const route = { default: { engineId: 'omlx', modelId: 'main' }, fallback: 'none' };
    for (const contextTokens of [8192, null, 32768]) {
      const s = registry({ omlx: { models: [model('main', { contextTokens })] }, routing: route });
      expect(isRouteUsable(rewrite(s, [], {}, { task: 'summarize' })), String(contextTokens)).toBe(true);
    }
    const noChat = registry({ omlx: { models: [model('main', { chat: false })] }, routing: route });
    expect(unusable(rewrite(noChat, [], {}, { task: 'summarize' })).unusable).toBe('capability');
  });

  it('structure needs chat only; notes and review still need JSON output', () => {
    const noJson = registry({ omlx: { models: [model('main', { json: false })] }, routing: { default: { engineId: 'omlx', modelId: 'main' }, fallback: 'none' } });
    expect(isRouteUsable(rewrite(noJson, [], {}, { task: 'structure' }))).toBe(true);
    for (const task of ['notes', 'review']) {
      expect(unusable(rewrite(noJson, [], {}, { task })).unusable, task).toBe('capability');
    }
    expect(isRouteUsable(rewrite(noJson, [], {}, { task: 'rewrite' }))).toBe(true);
  });

  it('the summary, frontmatter and title features are available and route on chat alone', () => {
    const noJson = registry({
      omlx: { models: [model('main', { json: false, contextTokens: 8192 })] },
      routing: { default: { engineId: 'omlx', modelId: 'main' }, fallback: 'none' },
    });
    for (const feature of ['summary', 'frontmatter', 'title']) {
      expect(getAiFeature(feature)?.status, feature).toBe('available');
      expect(isRouteUsable(rewrite(noJson, [], {}, { feature })), feature).toBe(true);
    }
  });

  it('rewrite needs chat and streaming', () => {
    const route = { default: { engineId: 'omlx', modelId: 'main' }, fallback: 'none' };
    expect(unusable(rewrite(registry({ omlx: { models: [model('main', { stream: false })] }, routing: route }))).unusable).toBe('capability');
    expect(unusable(rewrite(registry({ omlx: { models: [model('main', { chat: false })] }, routing: route }))).unusable).toBe('capability');
  });

  it('continue (ghost text) needs fim OR chat, plus streaming', () => {
    const route = { default: { engineId: 'omlx', modelId: 'main' }, fallback: 'none' };
    const feature = { ghostText: { enabled: true } };
    const fimOnly = registry({ settings: { features: feature }, omlx: { models: [model('main', { chat: false, fim: true })] }, routing: route });
    expect(isRouteUsable(rewrite(fimOnly, [], {}, { feature: 'ghostText' }))).toBe(true);
    const chatOnly = registry({ settings: { features: feature }, omlx: { models: [model('main', { chat: true, fim: false })] }, routing: route });
    expect(isRouteUsable(rewrite(chatOnly, [], {}, { feature: 'ghostText' }))).toBe(true);
    const neither = registry({ settings: { features: feature }, omlx: { models: [model('main', { chat: false, fim: false })] }, routing: route });
    expect(unusable(rewrite(neither, [], {}, { feature: 'ghostText' })).unusable).toBe('capability');
  });

  it('a feature\'s own requirements add to the task\'s (altText wants vision even on a custom task)', () => {
    const s = registry({
      settings: { features: { altText: { enabled: true, task: 'rewrite' } } },
      routing: { fallback: 'none' },
    });
    expect(unusable(rewrite(s, [], {}, { feature: 'altText' })).unusable).toBe('capability');
  });

  it('the fallback scan skips models that lack the capability', () => {
    // oMLX is down; only LM Studio's gemma has vision, so it is the one picked.
    const s = registry({ routing: { tasks: { vision: { engineId: 'omlx', modelId: 'main' } } } });
    const r = ok(rewrite(s, down('omlx'), {}, { feature: 'altText' }));
    expect(r).toMatchObject({ engineId: 'lms', modelId: 'gemma', viaFallback: true });
  });
});

// ── Step 4: fallback modes ──────────────────────────────────────────────────

describe('fallback modes', () => {
  // Preferred route: omlx/second (a task route). Default: omlx/main. LM Studio is the other local engine.
  const withMode = (fallback: string, extra: Over = {}) =>
    registry({ ...extra, routing: { fallback, tasks: { rewrite: { engineId: 'omlx', modelId: 'second' } }, ...extra.routing } });
  const secondDisabled = { omlx: { models: [model('main'), model('second', {}, { enabled: false })] } };

  it('none: unusable, with the original reason, even though other routes work', () => {
    const r = unusable(rewrite(withMode('none', secondDisabled)));
    expect(r.unusable).toBe('modelDisabled');
    expect(r.task).toBe('rewrite');
  });

  it('default: tries the default route', () => {
    const r = ok(rewrite(withMode('default', secondDisabled)));
    expect(r).toMatchObject({ engineId: 'omlx', modelId: 'main', viaFallback: true });
    expect(r.reason).toMatch(/turned off/);
  });

  it('default: does not go beyond the default route (the default is down too: unusable)', () => {
    const r = unusable(rewrite(withMode('default'), down('omlx')));
    expect(r.unusable).toBe('probeFailed');
  });

  it('default: a default that equals the failed primary is not retried', () => {
    const s = registry({ routing: { fallback: 'default' }, omlx: { enabled: false } });
    expect(unusable(rewrite(s)).unusable).toBe('engineDisabled');
  });

  it('anyLocal: default first, then any local engine/model in registry order', () => {
    expect(ok(rewrite(withMode('anyLocal', secondDisabled)))).toMatchObject({ modelId: 'main', viaFallback: true });
    // Whole oMLX engine down: LM Studio serves.
    expect(ok(rewrite(withMode('anyLocal'), down('omlx')))).toMatchObject({ engineId: 'lms', modelId: 'gemma', viaFallback: true, isLocal: true });
  });

  it('anyLocal: scans models within an engine in order, before the next engine', () => {
    const s = registry({
      routing: { fallback: 'anyLocal', default: { engineId: 'omlx', modelId: 'main' } },
      omlx: { models: [model('main', {}, { enabled: false }), model('second')] },
    });
    expect(ok(rewrite(s))).toMatchObject({ engineId: 'omlx', modelId: 'second', viaFallback: true });
  });

  it('anyLocal: never reaches the cloud, even with allowCloud and consent', () => {
    const s = registry({ settings: { allowCloud: true }, routing: { fallback: 'anyLocal' } });
    const r = unusable(rewrite(s, down('omlx', 'lms'), { claude: true }));
    expect(r.unusable).toBe('probeFailed');
  });

  it('any: tries local first, cloud last', () => {
    const s = registry({ settings: { allowCloud: true }, routing: { fallback: 'any' } });
    expect(ok(rewrite(s, down('omlx'), { claude: true }))).toMatchObject({ engineId: 'lms', isLocal: true });
    expect(ok(rewrite(s, down('omlx', 'lms'), { claude: true }))).toMatchObject({ engineId: 'claude', modelId: 'claude-sonnet-5-5', viaFallback: true, isLocal: false, needsConsent: false });
  });

  it('any: still gated by allowCloud', () => {
    const s = registry({ settings: { allowCloud: false }, routing: { fallback: 'any' } });
    expect(isRouteUsable(rewrite(s, down('omlx', 'lms'), { claude: true }))).toBe(false);
  });

  it('any: still gated by refused consent', () => {
    const s = registry({ settings: { allowCloud: true }, routing: { fallback: 'any' } });
    expect(isRouteUsable(rewrite(s, down('omlx', 'lms'), { claude: false }))).toBe(false);
  });

  it('a cloud primary that is blocked falls back to the local default under default and anyLocal', () => {
    for (const fallback of ['default', 'anyLocal']) {
      const s = registry({ routing: { fallback, tasks: { notes: { engineId: 'claude', modelId: 'claude-sonnet-5-5' } } } });
      const r = ok(rewrite(s, [], {}, { task: 'notes' }));
      expect(r, fallback).toMatchObject({ engineId: 'omlx', modelId: 'main', viaFallback: true, isLocal: true });
      expect(r.reason, fallback).toMatch(/Allow cloud/);
    }
  });

  it('a cloud default does not rescue a failed local primary unless the mode is any', () => {
    const base = { settings: { allowCloud: true }, omlx: { enabled: false } };
    const cloudDefault = { default: { engineId: 'claude', modelId: 'claude-sonnet-5-5' }, tasks: { rewrite: { engineId: 'omlx', modelId: 'main' } } };
    for (const fallback of ['default', 'anyLocal']) {
      const s = registry({ ...base, routing: { fallback, ...cloudDefault }, lms: { enabled: false } });
      expect(isRouteUsable(rewrite(s, [], { claude: true })), fallback).toBe(false);
    }
    const any = registry({ ...base, routing: { fallback: 'any', ...cloudDefault }, lms: { enabled: false } });
    expect(ok(rewrite(any, [], { claude: true }))).toMatchObject({ engineId: 'claude', viaFallback: true });
  });

  it('a cloud primary with a cloud default stays in the cloud under default', () => {
    const s = registry({
      settings: { allowCloud: true },
      claude: { models: [model('claude-sonnet-5-5'), model('claude-haiku-5-5')] },
      routing: {
        fallback: 'default',
        default: { engineId: 'claude', modelId: 'claude-sonnet-5-5' },
        tasks: { rewrite: { engineId: 'claude', modelId: 'claude-haiku-5-5' } },
      },
    });
    const statuses: AiEngineStatus[] = [{ engineId: 'claude', ok: true, isLocal: false, hasKey: true, models: [{ id: 'claude-haiku-5-5', capabilities: CHAT, source: 'endpoint', missing: true }] }];
    expect(ok(rewrite(s, statuses, { claude: true }))).toMatchObject({ engineId: 'claude', modelId: 'claude-sonnet-5-5', viaFallback: true });
  });

  it('the fallback skips disabled and missing models and disabled engines', () => {
    const s = registry({
      routing: { default: null, fallback: 'anyLocal' },
      omlx: { models: [model('main', {}, { enabled: false }), model('second', {}, { missing: true })] },
      lms: { models: [model('gemma-a', {}, { enabled: false }), model('gemma-b')] },
    });
    expect(ok(rewrite(s))).toMatchObject({ engineId: 'lms', modelId: 'gemma-b', viaFallback: true });
    const none = registry({
      routing: { default: null, fallback: 'anyLocal' },
      omlx: { enabled: false },
      lms: { models: [model('gemma', {}, { missing: true })] },
    });
    expect(isRouteUsable(rewrite(none))).toBe(false);
  });

  it('viaFallback is false when the preferred route serves and true (with a reason) otherwise', () => {
    const direct = ok(rewrite(registry()));
    expect(direct.viaFallback).toBe(false);
    expect(direct.reason).toBeUndefined();
    const viaFb = ok(rewrite(registry(), down('omlx')));
    expect(viaFb.viaFallback).toBe(true);
    expect(viaFb.reason).toMatch(/oMLX/);
  });
});

// ── Cloud gate and consent ──────────────────────────────────────────────────

describe('cloud is never reached without allowCloud plus consent', () => {
  const cloudRoute = { fallback: 'none', default: { engineId: 'claude', modelId: 'claude-sonnet-5-5' } };

  it('allowCloud off: cloudBlocked, whatever the consent map says', () => {
    const s = registry({ routing: cloudRoute });
    for (const consent of [{}, { claude: true }, { claude: false }]) {
      expect(unusable(rewrite(s, [], consent)).unusable).toBe('cloudBlocked');
    }
  });

  it('allowCloud on, never asked: usable but needsConsent, so the caller must ask before sending', () => {
    const s = registry({ settings: { allowCloud: true }, routing: cloudRoute });
    expect(ok(rewrite(s, [], {}))).toMatchObject({ engineId: 'claude', isLocal: false, needsConsent: true, viaFallback: false });
  });

  it('allowCloud on, consent granted: usable without asking', () => {
    const s = registry({ settings: { allowCloud: true }, routing: cloudRoute });
    expect(ok(rewrite(s, [], { claude: true }))).toMatchObject({ engineId: 'claude', needsConsent: false });
  });

  it('allowCloud on, consent refused: consentDenied with fallback none', () => {
    const s = registry({ settings: { allowCloud: true }, routing: cloudRoute });
    expect(unusable(rewrite(s, [], { claude: false })).unusable).toBe('consentDenied');
  });

  it('consent for one engine does not carry over to another', () => {
    const s = registry({ settings: { allowCloud: true }, routing: cloudRoute });
    expect(ok(rewrite(s, [], { omlx: true }))).toMatchObject({ needsConsent: true });
  });

  it('a local route never needs consent', () => {
    expect(ok(rewrite(registry({ settings: { allowCloud: true } }))).needsConsent).toBe(false);
  });

  it('locality can be pinned: a loopback engine pinned cloud is gated, a public one pinned local is not', () => {
    const gated = registry({ omlx: { locality: 'cloud' }, routing: { fallback: 'none' } });
    expect(unusable(rewrite(gated)).unusable).toBe('cloudBlocked');
    const open = registry({ claude: { locality: 'local' }, routing: cloudRoute });
    expect(ok(rewrite(open))).toMatchObject({ engineId: 'claude', isLocal: true, needsConsent: false });
  });

  it('a private-network engine is local through localNetworks, so it needs no gate', () => {
    const s = registry({ omlx: { baseUrl: 'http://10.0.98.4:8000/v1' }, settings: { localNetworks: ['10.0.98.0/24'] } });
    expect(ok(rewrite(s)).isLocal).toBe(true);
    const outside = registry({ omlx: { baseUrl: 'http://10.0.99.4:8000/v1' }, settings: { localNetworks: ['10.0.98.0/24'] }, routing: { fallback: 'none' } });
    expect(unusable(rewrite(outside)).unusable).toBe('cloudBlocked');
  });

  it('a refusal lets the fallback run, and the fallback result is local', () => {
    const s = registry({ settings: { allowCloud: true }, routing: { fallback: 'anyLocal', tasks: { notes: { engineId: 'claude', modelId: 'claude-sonnet-5-5' } } } });
    const r = ok(rewrite(s, [], { claude: false }, { task: 'notes' }));
    expect(r).toMatchObject({ engineId: 'omlx', viaFallback: true, isLocal: true, needsConsent: false });
    expect(r.reason).toMatch(/not allowed/);
  });
});

// ── Purity ──────────────────────────────────────────────────────────────────

describe('purity', () => {
  it('does not mutate its inputs and gives the same answer twice', () => {
    const s = registry({ settings: { allowCloud: true }, routing: { fallback: 'any' } });
    const statuses = down('omlx', 'lms');
    const consent = { claude: true };
    const before = JSON.stringify([s, statuses, consent]);
    const a = rewrite(s, statuses, consent);
    const b = rewrite(s, statuses, consent);
    expect(a).toEqual(b);
    expect(JSON.stringify([s, statuses, consent])).toBe(before);
  });
});

// ── Preferences order fallback candidates, never reject ─────────────────────

describe('task preferences (structure prefers JSON)', () => {
  const lost = { engineId: 'omlx', modelId: 'gone' };
  const structure = (over: Over = {}) =>
    registry({ ...over, routing: { default: { engineId: 'omlx', modelId: 'main' }, fallback: 'anyLocal', tasks: { structure: lost }, ...over.routing } });

  it('a fallback picks the JSON model first when two candidates qualify', () => {
    const s = structure({ omlx: { models: [model('main', { json: false }), model('second', { json: true })] } });
    const r = ok(rewrite(s, [], {}, { feature: 'title' }));
    expect(r).toMatchObject({ engineId: 'omlx', modelId: 'second', viaFallback: true });
  });

  it('without a JSON model the first candidate in order still serves', () => {
    const s = structure({
      omlx: { models: [model('main', { json: false }), model('second', { json: false })] },
      lms: { models: [model('gemma', { json: false })] },
    });
    expect(ok(rewrite(s, [], {}, { feature: 'title' }))).toMatchObject({ modelId: 'main', viaFallback: true });
  });

  it('the preferred model can be on a later engine', () => {
    const s = structure({ omlx: { models: [model('main', { json: false }), model('second', { json: false })] } });
    expect(ok(rewrite(s, [], {}, { feature: 'title' }))).toMatchObject({ engineId: 'lms', modelId: 'gemma' });
  });

  it('a usable chosen route is kept even when another model has JSON', () => {
    const s = registry({
      omlx: { models: [model('main', { json: false }), model('second', { json: true })] },
      routing: { tasks: { structure: { engineId: 'omlx', modelId: 'main' } } },
    });
    expect(ok(rewrite(s, [], {}, { feature: 'title' }))).toMatchObject({ modelId: 'main', viaFallback: false });
  });

  it('preferring JSON never moves a local route to the cloud', () => {
    const s = structure({
      settings: { allowCloud: true },
      omlx: { models: [model('main', { json: false })] },
      lms: { models: [model('gemma', { json: false })] },
    });
    const r = ok(rewrite(s, [], {}, { feature: 'title' }));
    expect(r.isLocal).toBe(true);
  });
});
