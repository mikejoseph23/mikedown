/** AI settings tab (M3): the pure model behind it, and the tab and chip in the real Settings modal. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle, type MikeDownHost } from '../src/index';
import { AI_ENGINE_PRESETS, parseAiSettings } from '../src/ai';
import type { AiEngineStatus, AiSettings, MikeDownAiHost } from '../src/ai';
import {
  aiIndicatorState,
  changedAiPatch,
  engineFromPreset,
  engineIssues,
  mergeDiscoveryStatus,
  parseContextTokens,
  parseRequestOverrides,
  removeEngine,
  routePairs,
  taskRequirements,
  taskRouteNote,
  toggleModelCapability,
  uniqueEngineId,
} from '../src/ai-settings-model';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

function settings(over: Record<string, unknown> = {}): AiSettings {
  return parseAiSettings({
    enabled: true,
    allowCloud: false,
    engines: [
      {
        id: 'omlx',
        name: 'oMLX',
        kind: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:8000/v1',
        models: [{ id: 'qwen3.8-flash', label: 'Qwen Flash', capabilities: { chat: true, stream: true, vision: false, json: true, tools: true, fim: false, embed: false, contextTokens: 262144 }, capabilitiesSource: 'endpoint' }],
      },
      {
        id: 'lms',
        name: 'LM Studio',
        kind: 'lmstudio',
        baseUrl: 'http://127.0.0.1:1234/v1',
        models: [{ id: 'gemma-4-26b', capabilities: { chat: true, stream: true, vision: true, json: true, tools: true, fim: false, embed: false, contextTokens: 131072 }, capabilitiesSource: 'endpoint' }],
      },
      { id: 'claude', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', models: [{ id: 'claude-sonnet-5-5' }] },
    ],
    routing: { default: { engineId: 'omlx', modelId: 'qwen3.8-flash' }, fallback: 'anyLocal', tasks: {} },
    ...over,
  }, { onWarning: () => {} });
}

describe('AI settings model', () => {
  it('lists every pair, marking the ones that cannot serve a task with the reason', () => {
    const pairs = routePairs(settings(), [], taskRequirements('vision'));
    const byModel = Object.fromEntries(pairs.map((p) => [p.modelId, p]));
    expect(byModel['gemma-4-26b'].selectable).toBe(true);
    expect(byModel['qwen3.8-flash']).toMatchObject({ selectable: false, note: 'lacks vision' });
    // Cloud stays pickable while Allow cloud is off, with a note.
    expect(byModel['claude-sonnet-5-5']).toMatchObject({ selectable: true, note: 'blocked by Allow cloud' });
  });

  it('warns about a cloud engine with no key and no variable, not about a local one', () => {
    const s = settings();
    const claude = s.engines.find((e) => e.id === 'claude')!;
    expect(engineIssues(claude, s, false).map((i) => i.code)).toEqual(['noKey', 'cloudBlocked']);
    expect(engineIssues({ ...claude, apiKeyEnv: 'ANTHROPIC_API_KEY' }, s, false).map((i) => i.code)).toEqual(['cloudBlocked']);
    expect(engineIssues(claude, s, true).map((i) => i.code)).toEqual(['cloudBlocked']);
    // A key file counts like a variable.
    expect(engineIssues({ ...claude, apiKeyFile: { path: '~/k.json', jsonPath: 'key' } }, s, false).map((i) => i.code)).toEqual(['cloudBlocked']);
    expect(engineIssues(s.engines[0], s, false)).toEqual([]);
  });

  it('the oMLX preset brings its key file along as a copy', () => {
    const omlx = AI_ENGINE_PRESETS.find((p) => p.id === 'omlx')!;
    const engine = engineFromPreset(omlx, []);
    expect(engine.apiKeyFile).toEqual({ path: '~/.omlx/settings.json', jsonPath: 'auth.api_key' });
    expect(engine.apiKeyFile).not.toBe(omlx.apiKeyFile);
    expect(engineFromPreset(AI_ENGINE_PRESETS.find((p) => p.id === 'lmstudio')!, [])).not.toHaveProperty('apiKeyFile');
  });

  it('notes a task routed to a model that lacks a capability, with its fallback', () => {
    const s = settings({ routing: { default: { engineId: 'omlx', modelId: 'qwen3.8-flash' }, fallback: 'anyLocal', tasks: { vision: { engineId: 'omlx', modelId: 'qwen3.8-flash' } } } });
    const n = taskRouteNote(s, [], 'vision');
    expect(n?.level).toBe('warning');
    expect(n?.text).toContain('lacks vision');
    expect(n?.text).toContain('Falls back to LM Studio · gemma-4-26b');
    const none = taskRouteNote({ ...s, routing: { ...s.routing, fallback: 'none' } }, [], 'vision');
    expect(none?.text).toContain('Fallback is off');
    // A fine route says nothing.
    expect(taskRouteNote(s, [], 'rewrite')).toBeNull();
  });

  it('sends only the ai.* keys that changed', () => {
    const s = settings();
    expect(changedAiPatch(s, structuredClone(s))).toEqual({});
    expect(Object.keys(changedAiPatch(s, { ...s, allowCloud: true }))).toEqual(['ai.allowCloud']);
  });

  it('removing an engine clears the routes that point at it', () => {
    const s = settings({ routing: { default: { engineId: 'claude', modelId: 'claude-sonnet-5-5' }, fallback: 'anyLocal', tasks: { notes: { engineId: 'claude', modelId: 'claude-sonnet-5-5' }, vision: { engineId: 'lms', modelId: 'gemma-4-26b' } } } });
    const next = removeEngine(s, 'claude');
    expect(next.engines.map((e) => e.id)).toEqual(['omlx', 'lms']);
    expect(next.routing.default).toBeNull();
    expect(Object.keys(next.routing.tasks)).toEqual(['vision']);
  });

  it('a chip toggle makes the row a user edit and keeps unknown keys', () => {
    const model = { ...settings().engines[0].models[0], futureKey: 1 } as never;
    const next = toggleModelCapability(model, 'vision');
    expect(next.capabilities.vision).toBe(true);
    expect(next.capabilitiesSource).toBe('user');
    expect((next as unknown as { futureKey: number }).futureKey).toBe(1);
  });

  it('merges a discovery and marks models the server stopped listing', () => {
    const engine = settings().engines[0];
    const status: AiEngineStatus = {
      engineId: 'omlx', ok: true, isLocal: true, hasKey: false,
      models: [{ id: 'minimax-m3', capabilities: { chat: true, stream: true, vision: false, json: true, tools: true, fim: false, embed: false, contextTokens: null }, source: 'heuristic' }],
    };
    const merged = mergeDiscoveryStatus(engine, status);
    expect(merged.models.map((m) => [m.id, !!m.missing])).toEqual([['qwen3.8-flash', true], ['minimax-m3', false]]);
  });

  it('validates request overrides and context sizes', () => {
    expect(parseRequestOverrides('')).toEqual({ ok: true, value: undefined });
    expect(parseRequestOverrides('{"reasoning_effort":"low"}')).toEqual({ ok: true, value: { reasoning_effort: 'low' } });
    expect(parseRequestOverrides('[1]').ok).toBe(false);
    expect(parseRequestOverrides('{oops').ok).toBe(false);
    expect(parseContextTokens('32k')).toEqual({ ok: true, value: 32768 });
    expect(parseContextTokens(' 131,072 ')).toEqual({ ok: true, value: 131072 });
    expect(parseContextTokens('')).toEqual({ ok: true, value: null });
    expect(parseContextTokens('lots').ok).toBe(false);
  });

  it('never hands out an id an engine already has', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {ids.add(uniqueEngineId('oMLX', ids));}
    expect(ids.size).toBe(50);
  });

  it('indicator: hidden until set up, then off, route, served, no route, tier 1', () => {
    const base = { statuses: [], tier: 2 as const, served: null, viaFallback: false };
    expect(aiIndicatorState({ ...base, settings: parseAiSettings({}) })).toBeNull();
    expect(aiIndicatorState({ ...base, settings: { ...settings(), enabled: false } })?.text).toBe('AI: off');
    expect(aiIndicatorState({ ...base, settings: settings() })?.text).toBe('AI: local · oMLX · Qwen Flash');
    const served = aiIndicatorState({ ...base, settings: settings(), served: { engineId: 'claude', engineName: 'Anthropic', modelId: 'claude-sonnet-5-5', isLocal: false }, viaFallback: true });
    expect(served).toMatchObject({ text: 'AI: cloud · Anthropic · claude-sonnet-5-5 (fallback)', tone: 'cloud', fallback: true });
    const noRoute = aiIndicatorState({ ...base, settings: { ...settings(), routing: { default: null, fallback: 'none', tasks: {} } } });
    expect(noRoute).toMatchObject({ text: 'AI: no route', tone: 'none' });
    expect(aiIndicatorState({ ...base, tier: 1, settings: settings() })?.text).toBe('AI: on');
  });
});

// ── In the editor ───────────────────────────────────────────────────────────

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

function mount(host: MikeDownHost, ai?: AiSettings): MikeDownEditorHandle {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host, features: { sidebar: true }, settings: ai ? { ai } : undefined });
  mounted.push({ handle, el });
  return handle;
}

function tier2(over: Partial<MikeDownAiHost> = {}): MikeDownAiHost {
  return {
    complete: vi.fn(),
    listEngines: vi.fn(async () => []),
    testEngine: vi.fn(),
    discoverModels: vi.fn(),
    setSecret: vi.fn(async () => {}),
    ...over,
  } as unknown as MikeDownAiHost;
}

const tabLabels = () => Array.from(document.querySelectorAll('.settings-tab')).map((t) => t.textContent);
const click = (el: Element | null | undefined) => (el as HTMLElement).click();
const byText = (selector: string, text: string) => Array.from(document.querySelectorAll<HTMLElement>(selector)).find((n) => n.textContent?.trim() === text);

afterEach(() => {
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  document.querySelectorAll('#mikedown-settings-overlay').forEach((n) => n.remove());
});

describe('AI tab in the Settings modal', () => {
  it('is absent without host.ai', () => {
    const handle = mount(new NoopHost());
    handle.command('openSettings');
    expect(tabLabels()).not.toContain('AI');
    handle.command('openAiSettings');
    expect(document.querySelector('.settings-panel--ai')).toBeNull();
  });

  it('openAiSettings opens the AI tab; a tier-1 host gets the switch and features only', () => {
    class Tier1 extends NoopHost { ai = { complete: vi.fn() } as unknown as MikeDownAiHost; }
    const handle = mount(new Tier1());
    handle.command('openAiSettings');
    expect(document.querySelector('.settings-tab[aria-selected="true"]')?.textContent).toBe('AI');
    const panel = document.querySelector('.settings-panel--ai')!;
    expect(panel.textContent).toContain('Enable AI features');
    expect(panel.textContent).toContain('Rewrite selection');
    expect(panel.textContent).toContain('Coming later');
    expect(panel.textContent).not.toContain('Allow cloud engines');
    expect(panel.querySelector('.ai-engines, .ai-empty')).toBeNull();
  });

  it('a tier-2 host gets engines, routing and the AI tab right after Spelling', () => {
    class Tier2 extends NoopHost { ai = tier2(); }
    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = createMikeDownEditor(el, { host: new Tier2(), spellcheckDictionaryUrl: '/dict', settings: { ai: settings() } });
    mounted.push({ handle, el });
    handle.command('openAiSettings');
    expect(tabLabels().slice(3, 5)).toEqual(['Spelling', 'AI']);
    const names = Array.from(document.querySelectorAll('.ai-engine-name')).map((n) => n.textContent);
    expect(names).toEqual(['oMLX', 'LM Studio', 'Anthropic']);
    expect(document.querySelector('.ai-pill--blocked')?.textContent).toBe('blocked by Allow cloud');
    expect(document.body.textContent).toContain('Default model');
  });

  it('saving untouched settings sends no ai.* keys; a change sends only that key', () => {
    const saveSettings = vi.fn();
    class Host extends NoopHost { ai = tier2(); saveSettings = saveSettings; }
    const handle = mount(new Host(), settings());
    handle.command('openAiSettings');
    click(byText('.settings-btn--primary', 'Save to Settings'));
    expect(Object.keys(saveSettings.mock.calls[0][0]).filter((k) => k.startsWith('ai.'))).toEqual([]);

    handle.command('openAiSettings');
    click(byText('.settings-label', 'Allow cloud engines'));
    click(byText('.settings-btn--primary', 'Save to Settings'));
    const patch = saveSettings.mock.calls[1][0] as Record<string, unknown>;
    expect(Object.keys(patch).filter((k) => k.startsWith('ai.'))).toEqual(['ai.allowCloud']);
    expect(patch['ai.allowCloud']).toBe(true);
  });

  it('deleting an engine asks first, then drops its key on save', async () => {
    const ai = tier2();
    const saveSettings = vi.fn();
    class Host extends NoopHost { ai = ai; saveSettings = saveSettings; }
    const handle = mount(new Host(), settings());
    handle.command('openAiSettings');
    click(document.querySelector('[aria-label="Delete Anthropic"]'));
    expect(document.querySelector('.ai-confirm')?.textContent).toContain('Delete Anthropic?');
    click(byText('.ai-confirm .settings-btn', 'Delete'));
    expect(Array.from(document.querySelectorAll('.ai-engine-name')).map((n) => n.textContent)).toEqual(['oMLX', 'LM Studio']);
    expect(ai.setSecret).not.toHaveBeenCalled();
    click(byText('.settings-btn--primary', 'Save to Settings'));
    const engines = saveSettings.mock.calls[0][0]['ai.engines'] as Array<{ id: string }>;
    expect(engines.map((e) => e.id)).toEqual(['omlx', 'lms']);
    await Promise.resolve();
    expect(ai.setSecret).toHaveBeenCalledWith('claude', null);
  });

  it('edits the key file next to the variable, keeps its unknown keys, and never saves a half-filled pair', () => {
    const saveSettings = vi.fn();
    class Host extends NoopHost { ai = tier2(); saveSettings = saveSettings; }
    const base = settings();
    const withFile = {
      ...base,
      engines: base.engines.map((e) => (e.id === 'omlx' ? { ...e, apiKeyEnv: 'OMLX_API_KEY', apiKeyFile: { path: '~/.omlx/settings.json', jsonPath: 'auth.api_key', future: true } } : e)),
    } as AiSettings;
    const handle = mount(new Host(), withFile);
    handle.command('openAiSettings');
    click(document.querySelector('[aria-label="Edit oMLX"]'));
    const path = document.querySelector<HTMLInputElement>('[data-fk="eng:omlx:keyfile-path"]')!;
    const json = document.querySelector<HTMLInputElement>('[data-fk="eng:omlx:keyfile-json"]')!;
    expect([path.value, json.value]).toEqual(['~/.omlx/settings.json', 'auth.api_key']);
    expect(document.body.textContent).toContain('Key file');

    const edit = (input: HTMLInputElement, value: string) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
    edit(json, 'auth.token');
    click(byText('.settings-btn--primary', 'Save to Settings'));
    const saved = (saveSettings.mock.calls[0][0]['ai.engines'] as Array<Record<string, any>>).find((e) => e.id === 'omlx')!;
    expect(saved.apiKeyFile).toEqual({ path: '~/.omlx/settings.json', jsonPath: 'auth.token', future: true });
    expect(saved.apiKeyEnv).toBe('OMLX_API_KEY');

    handle.command('openAiSettings');
    click(document.querySelector('[aria-label="Edit oMLX"]'));
    edit(document.querySelector<HTMLInputElement>('[data-fk="eng:omlx:keyfile-json"]')!, '');
    click(byText('.settings-btn--primary', 'Save to Settings'));
    const cleared = (saveSettings.mock.calls[1][0]['ai.engines'] as Array<Record<string, any>>).find((e) => e.id === 'omlx')!;
    expect(cleared).not.toHaveProperty('apiKeyFile');
  });

  it('stores a key through setSecret straight away, never in the patch', async () => {
    const ai = tier2();
    const saveSettings = vi.fn();
    class Host extends NoopHost { ai = ai; saveSettings = saveSettings; }
    const handle = mount(new Host(), settings());
    handle.command('openAiSettings');
    click(document.querySelector('[aria-label="Edit Anthropic"]'));
    const key = document.querySelector<HTMLInputElement>('input[type="password"]')!;
    key.value = 'sk-secret';
    click(byText('.ai-key .settings-btn', 'Store'));
    await vi.waitFor(() => expect(ai.setSecret).toHaveBeenCalledWith('claude', 'sk-secret'));
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('input[type="password"]')?.placeholder).toBe('Stored'));
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('');
    click(byText('.settings-btn--primary', 'Save to Settings'));
    expect(JSON.stringify(saveSettings.mock.calls[0][0])).not.toContain('sk-secret');
  });

  it('test connection reports the result inline and in the live region', async () => {
    const status: AiEngineStatus = { engineId: 'omlx', ok: true, isLocal: true, hasKey: false, latencyMs: 42, models: [] };
    const ai = tier2({ testEngine: vi.fn(async () => status) });
    class Host extends NoopHost { ai = ai; }
    const handle = mount(new Host(), settings());
    handle.command('openAiSettings');
    click(document.querySelector('[aria-label="Edit oMLX"]'));
    click(byText('.settings-btn', 'Test connection'));
    await vi.waitFor(() => expect(document.querySelector('.ai-result')?.textContent).toContain('Connected in 42 ms'));
    expect(ai.testEngine).toHaveBeenCalledWith('omlx');
    expect(document.querySelector('.ai-status')?.getAttribute('data-state')).toBe('ok');
    await vi.waitFor(() => expect(document.querySelector('.ai-live')?.textContent).toContain('oMLX: Connected in 42 ms'));
  });
});

describe('AI tab lifecycle', () => {
  it('closing unsaved drops a key stored for an engine the host never saw, keeps the rest', async () => {
    const ai = tier2();
    class Host extends NoopHost { ai = ai; saveSettings = vi.fn(); }
    const handle = mount(new Host(), settings());
    handle.command('openAiSettings');
    // A key for a saved engine, then a new engine with its own key.
    click(document.querySelector('[aria-label="Edit Anthropic"]'));
    document.querySelector<HTMLInputElement>('input[type="password"]')!.value = 'sk-saved';
    click(byText('.ai-key .settings-btn', 'Store'));
    await vi.waitFor(() => expect(ai.setSecret).toHaveBeenCalledWith('claude', 'sk-saved'));
    click(document.querySelector('.ai-add-btn'));
    click(Array.from(document.querySelectorAll('.ai-menu-item')).find((n) => n.textContent?.includes('OpenRouter')));
    const key = () => document.querySelector<HTMLInputElement>('.ai-engine.is-open input[type="password"]')!;
    key().value = 'sk-new';
    click(byText('.ai-engine.is-open .ai-key .settings-btn', 'Store'));
    await vi.waitFor(() => expect(ai.setSecret).toHaveBeenCalledWith(expect.stringMatching(/^openrouter-/), 'sk-new'));
    const newId = (ai.setSecret as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;

    click(document.querySelector('.settings-close'));
    expect(document.querySelector('.settings-modal')).toBeNull();
    expect(ai.setSecret).toHaveBeenCalledWith(newId, null);
    expect(ai.setSecret).not.toHaveBeenCalledWith('claude', null);
  });

  it('statuses pushed while the tab is open update the engine dots', () => {
    class Host extends NoopHost { ai = tier2(); }
    const handle = mount(new Host(), settings());
    handle.command('openAiSettings');
    const dot = () => document.querySelector('.ai-engine .ai-status')?.getAttribute('data-state');
    expect(dot()).toBe('unknown');
    handle.setAiEngineStatuses([{ engineId: 'omlx', ok: false, isLocal: true, hasKey: false, error: 'ECONNREFUSED', models: [] }]);
    expect(dot()).toBe('error');
    expect(document.querySelector('.ai-engine .ai-status')?.getAttribute('title')).toContain('ECONNREFUSED');
  });

  it('listens to a host onAiEngines push when the host offers one', () => {
    let push: ((list: AiEngineStatus[]) => void) | null = null;
    class Host extends NoopHost {
      ai = tier2();
      onAiEngines(fn: (list: AiEngineStatus[]) => void) { push = fn; return () => { push = null; }; }
    }
    const handle = mount(new Host(), settings({ routing: { default: { engineId: 'omlx', modelId: 'qwen3.8-flash' }, fallback: 'none', tasks: {} } }));
    const chip = document.querySelector<HTMLButtonElement>('[data-testid="sidebar-ai-chip"]')!;
    expect(chip.textContent).toBe('AI: local · oMLX · Qwen Flash');
    push!([{ engineId: 'omlx', ok: false, isLocal: true, hasKey: false, models: [] }]);
    expect(chip.textContent).toBe('AI: no route');
    handle.destroy();
    expect(push).toBeNull();
  });
});

describe('AI indicator chip', () => {
  it('shows the served engine and opens the AI tab on click', () => {
    class Host extends NoopHost { ai = tier2(); }
    const handle = mount(new Host(), settings());
    const chip = document.querySelector<HTMLButtonElement>('[data-testid="sidebar-ai-chip"]')!;
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toBe('AI: local · oMLX · Qwen Flash');
    handle.setAiServed({ engineId: 'claude', engineName: 'Anthropic', modelId: 'claude-sonnet-5-5', isLocal: false }, { viaFallback: true });
    expect(chip.textContent).toBe('AI: cloud · Anthropic · claude-sonnet-5-5 (fallback)');
    expect(chip.dataset.tone).toBe('cloud');
    chip.click();
    expect(document.querySelector('.settings-tab[aria-selected="true"]')?.textContent).toBe('AI');
  });

  it('stays hidden while AI was never set up', () => {
    class Host extends NoopHost { ai = tier2(); }
    mount(new Host());
    expect(document.querySelector<HTMLButtonElement>('[data-testid="sidebar-ai-chip"]')?.hidden).toBe(true);
  });
});
