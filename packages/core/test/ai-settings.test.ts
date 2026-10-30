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
  parseLocalNetworksText,
  parseRequestOverrides,
  removeEngine,
  routePairs,
  taskRequirements,
  taskRouteNote,
  toggleModelCapability,
  uniqueEngineId,
} from '../src/ai-settings-model';
import { AI_EXPERIMENTAL_DISCLAIMER } from '../src/ai-settings-dom';
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
    expect(noRoute).toMatchObject({ text: 'AI: no model chosen', tone: 'none' });
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

/** Type into a field the way a paste does, then press Enter (the key field stores on Enter). */
function typeAndEnter(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
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
  document.querySelectorAll('#mikedown-settings-overlay, #mikedown-ai-page-overlay').forEach((n) => n.remove());
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
    expect(document.querySelector<HTMLElement>('.settings-tab[aria-selected="true"]')?.dataset.tabId).toBe('ai');
    const panel = document.querySelector('.settings-panel--ai')!;
    expect(panel.textContent).toContain('Enable AI features');
    expect(panel.textContent).toContain('Rewrite selection');
    expect(panel.textContent).toContain('Coming later');
    expect(panel.textContent).not.toContain('Allow cloud engines');
    expect(panel.querySelector('.ai-engines, .ai-empty')).toBeNull();
  });

  it('a tier-2 host gets engines, routing and the AI tab last, marked Experimental', () => {
    class Tier2 extends NoopHost { ai = tier2(); }
    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = createMikeDownEditor(el, { host: new Tier2(), spellcheckDictionaryUrl: '/dict', settings: { ai: settings() } });
    mounted.push({ handle, el });
    handle.command('openAiSettings');
    const tabs = Array.from(document.querySelectorAll<HTMLElement>('.settings-tab'));
    expect(tabs.map((t) => t.dataset.tabId)).toEqual(['appearance', 'toolbar', 'behavior', 'markdown', 'spelling', 'hotkeys', 'ai']);
    expect(tabs.at(-1)?.querySelector('.ai-experimental-badge')?.textContent).toBe('Experimental');
    expect(document.querySelector('.settings-panel--ai .ai-experimental-intro')?.textContent).toContain(AI_EXPERIMENTAL_DISCLAIMER);
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

  it('shows a compact engine list, the default route and Manage engines…', () => {
    class Host extends NoopHost { ai = tier2(); }
    const handle = mount(new Host(), settings());
    handle.command('openAiSettings');
    const panel = document.querySelector('.settings-panel--ai')!;
    const rows = Array.from(panel.querySelectorAll('.ai-engines [role="listitem"]'));
    expect(rows).toHaveLength(3);
    // Name, pill, dot and switch only: no Edit, star or Delete on the tab.
    expect(panel.querySelector('[aria-label="Edit oMLX"], [aria-label="Delete oMLX"], .ai-form')).toBeNull();
    expect(rows[0].querySelector('.ai-pill--local')).not.toBeNull();
    expect(rows[0].querySelector('.ai-status')).not.toBeNull();
    expect(rows[0].querySelector('input[role="switch"]')).not.toBeNull();
    expect(panel.querySelector('.ai-route-line')?.textContent).toContain('oMLX · Qwen Flash');
    expect(byText('.settings-btn', 'Manage engines…')).toBeTruthy();
  });

  it('Manage engines… opens the page over the modal; Done saves and the tab keeps its own edits', () => {
    const saveSettings = vi.fn();
    class Host extends NoopHost { ai = tier2(); saveSettings = saveSettings; }
    const handle = mount(new Host(), settings());
    handle.command('openAiSettings');
    // An unsaved tab edit, then the page.
    click(byText('.settings-label', 'Allow cloud engines'));
    const manage = byText('.settings-btn', 'Manage engines…')!;
    manage.focus();
    click(manage);
    const page = document.querySelector('#mikedown-ai-page-overlay .ai-page-frame')!;
    expect(page.getAttribute('role')).toBe('dialog');
    expect(page.getAttribute('aria-modal')).toBe('true');
    expect(document.querySelector('.settings-modal')).not.toBeNull();
    // The page started from the tab's draft: Anthropic is not blocked any more.
    expect(page.querySelector('.ai-pill--blocked')).toBeNull();

    click(page.querySelector('[data-fk="nav:eng:lms"]'));
    const enabled = page.querySelector<HTMLInputElement>('[data-fk="nav:eng:lms:enabled"]')!;
    enabled.checked = false;
    enabled.dispatchEvent(new Event('change', { bubbles: true }));
    click(byText('.ai-page-done', 'Done'));
    expect(document.querySelector('#mikedown-ai-page-overlay')).toBeNull();
    // Only what the page changed is saved now; the tab's Allow cloud waits for Save.
    expect(Object.keys(saveSettings.mock.calls[0][0])).toEqual(['ai.engines']);
    expect(document.activeElement?.textContent).toBe('Manage engines…');

    click(byText('.settings-btn--primary', 'Save to Settings'));
    const patch = saveSettings.mock.calls[1][0] as Record<string, unknown>;
    expect(Object.keys(patch).filter((k) => k.startsWith('ai.'))).toEqual(['ai.allowCloud']);
  });

  it('Change… opens the page on routing', () => {
    class Host extends NoopHost { ai = tier2(); }
    const handle = mount(new Host(), settings());
    handle.command('openAiSettings');
    click(document.querySelector('[data-fk="route:change"]'));
    expect(document.querySelector('[data-fk="nav:routing"]')?.getAttribute('aria-current')).toBe('true');
    expect(document.activeElement?.getAttribute('data-fk')).toBe('route:default');
  });
});

describe('AI Engines page in the editor', () => {
  const openPage = (handle: MikeDownEditorHandle) => handle.command('openAiSettings', { page: true });

  it('openAiSettings with page opens the page directly; a tier-1 host gets the tab', () => {
    class Host extends NoopHost { ai = tier2(); }
    const handle = mount(new Host(), settings());
    openPage(handle);
    expect(document.querySelector('.settings-modal')).toBeNull();
    expect(document.querySelector('.ai-page-title')?.textContent).toBe('AI Engines');
    // The status bar command lands on the first list item.
    expect(document.activeElement?.getAttribute('data-fk')).toBe('nav:eng:omlx');

    class Tier1 extends NoopHost { ai = { complete: vi.fn() } as unknown as MikeDownAiHost; }
    const t1 = mount(new Tier1());
    t1.command('openAiSettings', { page: true });
    expect(document.querySelector<HTMLElement>('.settings-tab[aria-selected="true"]')?.dataset.tabId).toBe('ai');
  });

  it('deleting an engine asks first, then drops its key on Done', async () => {
    const ai = tier2();
    const saveSettings = vi.fn();
    class Host extends NoopHost { ai = ai; saveSettings = saveSettings; }
    const handle = mount(new Host(), settings());
    openPage(handle);
    click(document.querySelector('[data-fk="nav:eng:claude"]'));
    click(document.querySelector('[aria-label="Delete Anthropic"]'));
    expect(document.querySelector('.ai-confirm')?.textContent).toContain('Delete Anthropic?');
    click(byText('.ai-confirm .settings-btn', 'Delete'));
    expect(Array.from(document.querySelectorAll('.ai-nav-name')).map((n) => n.textContent).slice(0, 2)).toEqual(['oMLX', 'LM Studio']);
    expect(ai.setSecret).not.toHaveBeenCalled();
    click(byText('.ai-page-done', 'Done'));
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
    openPage(handle);
    // oMLX is the first engine, so its form is open. The key file sits under Advanced, collapsed by default.
    expect(document.querySelector('[data-fk="eng:omlx:keyfile-path"]')).toBeNull();
    click(document.querySelector('[data-fk="eng:omlx:advanced"]'));
    const path = document.querySelector<HTMLInputElement>('[data-fk="eng:omlx:keyfile-path"]')!;
    const json = document.querySelector<HTMLInputElement>('[data-fk="eng:omlx:keyfile-json"]')!;
    expect([path.value, json.value]).toEqual(['~/.omlx/settings.json', 'auth.api_key']);
    expect(document.body.textContent).toContain('Key file');

    const edit = (input: HTMLInputElement, value: string) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
    edit(json, 'auth.token');
    click(byText('.ai-page-done', 'Done'));
    const saved = (saveSettings.mock.calls[0][0]['ai.engines'] as Array<Record<string, any>>).find((e) => e.id === 'omlx')!;
    expect(saved.apiKeyFile).toEqual({ path: '~/.omlx/settings.json', jsonPath: 'auth.token', future: true });
    expect(saved.apiKeyEnv).toBe('OMLX_API_KEY');

    openPage(handle);
    click(document.querySelector('[data-fk="eng:omlx:advanced"]'));
    edit(document.querySelector<HTMLInputElement>('[data-fk="eng:omlx:keyfile-json"]')!, '');
    click(byText('.ai-page-done', 'Done'));
    const cleared = (saveSettings.mock.calls[1][0]['ai.engines'] as Array<Record<string, any>>).find((e) => e.id === 'omlx')!;
    expect(cleared).not.toHaveProperty('apiKeyFile');
  });

  it('stores a key through setSecret straight away, never in the patch', async () => {
    const listed: AiEngineStatus = {
      engineId: 'claude', ok: true, isLocal: false, hasKey: true,
      models: [{ id: 'claude-sonnet-5-5', capabilities: { chat: true, stream: true, vision: true, json: true, tools: true, fim: false, embed: false, contextTokens: 200000 }, source: 'endpoint' }],
    };
    const ai = tier2({ discoverModels: vi.fn(async () => listed) });
    const saveSettings = vi.fn();
    class Host extends NoopHost { ai = ai; saveSettings = saveSettings; }
    const handle = mount(new Host(), settings());
    openPage(handle);
    click(document.querySelector('[data-fk="nav:eng:claude"]'));
    const key = document.querySelector<HTMLInputElement>('input[type="password"]')!;
    typeAndEnter(key, 'sk-secret');
    await vi.waitFor(() => expect(ai.setSecret).toHaveBeenCalledWith('claude', 'sk-secret'));
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('input[type="password"]')?.placeholder).toBe('Stored'));
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('');
    click(byText('.ai-page-done', 'Done'));
    expect(JSON.stringify(saveSettings.mock.calls)).not.toContain('sk-secret');
  });

  it('test connection reports the result inline and in the live region', async () => {
    const status: AiEngineStatus = { engineId: 'omlx', ok: true, isLocal: true, hasKey: false, latencyMs: 42, models: [] };
    const ai = tier2({ testEngine: vi.fn(async () => status) });
    class Host extends NoopHost { ai = ai; }
    const handle = mount(new Host(), settings());
    openPage(handle);
    click(byText('.settings-btn', 'Test connection'));
    await vi.waitFor(() => expect(document.querySelector('.ai-result')?.textContent).toContain('Connected in 42 ms'));
    expect(ai.testEngine).toHaveBeenCalledWith('omlx');
    expect(document.querySelector('.ai-nav-item .ai-status')?.getAttribute('data-state')).toBe('ok');
    expect(document.querySelector('.ai-detail-actions .ai-status')?.textContent).toBe('42 ms');
    await vi.waitFor(() => expect(document.querySelector('.ai-page .ai-live')?.textContent).toContain('oMLX: Connected in 42 ms'));
  });

  it('Test connection is enabled and focused again once the test finishes', async () => {
    const status: AiEngineStatus = { engineId: 'omlx', ok: true, isLocal: true, hasKey: false, latencyMs: 14, models: [] };
    const ai = tier2({ testEngine: vi.fn(async () => status) });
    class Host extends NoopHost { ai = ai; }
    const handle = mount(new Host(), settings());
    openPage(handle);
    const before = byText('.settings-btn', 'Test connection') as HTMLButtonElement;
    before.focus();
    click(before);
    const busy = document.querySelector<HTMLButtonElement>('[data-fk="eng:omlx:test"]')!;
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    await vi.waitFor(() => expect(document.querySelector('.ai-result')?.textContent).toContain('Connected in 14 ms'));
    const after = document.querySelector<HTMLButtonElement>('[data-fk="eng:omlx:test"]')!;
    expect(after.textContent).toBe('Test connection');
    expect(after.disabled).toBe(false);
    expect(after.hasAttribute('aria-disabled')).toBe(false);
    expect(document.activeElement).toBe(after);
  });

  it('Back with unsaved changes asks; discarding drops a key stored for an engine the host never saw, keeps the rest', async () => {
    const ai = tier2();
    class Host extends NoopHost { ai = ai; saveSettings = vi.fn(); }
    const handle = mount(new Host(), settings());
    openPage(handle);
    // A key for a saved engine, then a new engine with its own key.
    click(document.querySelector('[data-fk="nav:eng:claude"]'));
    typeAndEnter(document.querySelector<HTMLInputElement>('input[type="password"]')!, 'sk-saved');
    await vi.waitFor(() => expect(ai.setSecret).toHaveBeenCalledWith('claude', 'sk-saved'));
    click(document.querySelector('[data-fk="nav:add"]'));
    click(document.querySelector('[aria-label="Add OpenRouter"]'));
    const key = () => document.querySelector<HTMLInputElement>('.ai-page-detail input[type="password"]')!;
    // A new cloud engine opens with focus on its key field (design call 2).
    expect(document.activeElement).toBe(key());
    typeAndEnter(key(), 'sk-new');
    await vi.waitFor(() => expect(ai.setSecret).toHaveBeenCalledWith(expect.stringMatching(/^openrouter-/), 'sk-new'));
    const newId = (ai.setSecret as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;

    // Escape is Back: unsaved, so it asks first (in the page, not window.confirm).
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.ai-page-confirm')?.textContent).toContain('Discard changes?');
    expect(document.activeElement?.textContent).toBe('Keep editing');
    click(byText('.ai-page-confirm .settings-btn', 'Discard'));
    expect(document.querySelector('#mikedown-ai-page-overlay')).toBeNull();
    expect(ai.setSecret).toHaveBeenCalledWith(newId, null);
    expect(ai.setSecret).not.toHaveBeenCalledWith('claude', null);
  });

  it('a clean Back closes at once', () => {
    class Host extends NoopHost { ai = tier2(); }
    const handle = mount(new Host(), settings());
    openPage(handle);
    click(document.querySelector('[data-fk="page:back"]'));
    expect(document.querySelector('#mikedown-ai-page-overlay')).toBeNull();
  });
});

describe('models table under Advanced (the M3 controls, moved)', () => {
  const edit = (input: HTMLInputElement | HTMLTextAreaElement, value: string, type = 'input') => {
    input.value = value;
    input.dispatchEvent(new Event(type, { bubbles: true }));
  };
  const fk = (key: string) => document.querySelector<HTMLElement>(`[data-fk="${key}"]`)!;

  /** The page on oMLX with Advanced open, and a Host that records what Done saves. */
  function openAdvanced(extra: Record<string, unknown> = {}) {
    const saveSettings = vi.fn();
    class Host extends NoopHost { ai = tier2(); saveSettings = saveSettings; }
    const handle = mount(new Host(), settings(extra));
    handle.command('openAiSettings', { page: true });
    click(fk('eng:omlx:advanced'));
    const savedModels = () => {
      click(byText('.ai-page-done', 'Done'));
      const engines = saveSettings.mock.calls[0][0]['ai.engines'] as Array<{ id: string; models: Array<Record<string, any>> }>;
      return engines.find((e) => e.id === 'omlx')!.models;
    };
    return { saveSettings, savedModels };
  }

  it('a capability chip toggles, marks the row edited, and saves as a user edit', () => {
    const { savedModels } = openAdvanced();
    const chip = fk('model:omlx:qwen3.8-flash:chip-vision');
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    click(chip);
    expect(fk('model:omlx:qwen3.8-flash:chip-vision').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.ai-model .ai-source')?.textContent).toBe('edited');
    expect(savedModels()[0]).toMatchObject({ capabilitiesSource: 'user', capabilities: { vision: true } });
  });

  it('the context size takes 32k, and refuses nonsense without changing the model', () => {
    const { savedModels } = openAdvanced();
    const ctx = fk('model:omlx:qwen3.8-flash:context') as HTMLInputElement;
    expect(ctx.value).toBe('262144');
    edit(ctx, 'lots', 'change');
    expect(fk('model:omlx:qwen3.8-flash:context').getAttribute('aria-invalid')).toBe('true');
    edit(fk('model:omlx:qwen3.8-flash:context') as HTMLInputElement, '32k', 'change');
    expect(savedModels()[0].capabilities.contextTokens).toBe(32768);
  });

  it('the request overrides editor validates JSON, saves it, and the Thinking column reads it', () => {
    const { savedModels } = openAdvanced();
    click(fk('model:omlx:qwen3.8-flash:overrides'));
    expect(fk('model:omlx:qwen3.8-flash:overrides').getAttribute('aria-expanded')).toBe('true');
    const area = () => fk('model:omlx:qwen3.8-flash:overrides-text') as HTMLTextAreaElement;
    edit(area(), '{ oops');
    expect(area().getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelector('.ai-overrides .ai-field-error')?.textContent).not.toBe('');
    edit(area(), '{ "reasoning_effort": "low", "temperature": 0.3 }');
    expect(area().hasAttribute('aria-invalid')).toBe(false);
    expect(savedModels()[0].requestOverrides).toEqual({ reasoning_effort: 'low', temperature: 0.3 });
  });

  it('shows the Thinking level written by the overrides editor, in the table and in Express', () => {
    openAdvanced();
    click(fk('model:omlx:qwen3.8-flash:overrides'));
    edit(fk('model:omlx:qwen3.8-flash:overrides-text') as HTMLTextAreaElement, '{ "reasoning_effort": "high" }');
    // Express and the table show the same level on the next render.
    click(fk('eng:omlx:advanced'));
    click(fk('eng:omlx:advanced'));
    expect((fk('model:omlx:qwen3.8-flash:thinking') as HTMLSelectElement).value).toBe('high');
    expect((fk('eng:omlx:thinking') as HTMLSelectElement).value).toBe('high');
  });

  it('adds a model by hand, refuses a duplicate, and removes it again (with its routes)', () => {
    const { saveSettings } = openAdvanced();
    const input = () => fk('eng:omlx:add-model') as HTMLInputElement;
    edit(input(), 'minimax-m3');
    click(fk('eng:omlx:add-model-btn'));
    expect(document.querySelector('[data-fk="model:omlx:minimax-m3:enabled"]')).not.toBeNull();
    expect(document.body.textContent).toContain('added by hand');
    expect(document.activeElement).toBe(input());

    edit(input(), 'minimax-m3');
    click(fk('eng:omlx:add-model-btn'));
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelector('.ai-model-add + .ai-field-error')?.textContent).toContain('already in the list');

    click(fk('model:omlx:minimax-m3:remove'));
    expect(document.querySelector('[data-fk="model:omlx:minimax-m3:enabled"]')).toBeNull();
    // Back where it started: nothing to save.
    click(byText('.ai-page-done', 'Done'));
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('removing the default route\'s model clears that route', () => {
    const base = settings();
    const withGone = { ...base, engines: base.engines.map((e) => (e.id === 'omlx' ? { ...e, models: e.models.map((m) => ({ ...m, missing: true })) } : e)) } as AiSettings;
    const saveSettings = vi.fn();
    class Host extends NoopHost { ai = tier2(); saveSettings = saveSettings; }
    const handle = mount(new Host(), withGone);
    handle.command('openAiSettings', { page: true });
    click(fk('eng:omlx:advanced'));
    expect(document.querySelector('[data-fk="model:omlx:qwen3.8-flash:enabled"]')!.closest('.ai-model')!.classList.contains('is-missing')).toBe(true);
    expect(document.querySelector('.ai-model .ai-tag--missing')?.textContent).toBe('not listed');
    click(fk('model:omlx:qwen3.8-flash:remove'));
    click(byText('.ai-page-done', 'Done'));
    expect(saveSettings.mock.calls[0][0]['ai.routing'].default).toBeNull();
  });

  it('a display name is kept next to the id, and clearing it brings the id back', () => {
    const { savedModels } = openAdvanced();
    const label = () => fk('model:omlx:qwen3.8-flash:label') as HTMLInputElement;
    expect(label().value).toBe('Qwen Flash');
    edit(label(), 'Qwen, fast');
    expect(savedModels()[0].label).toBe('Qwen, fast');
  });

  it('turning a model off in the table takes it out of the Default model list', () => {
    openAdvanced();
    const options = () => Array.from((fk('eng:omlx:default-model') as HTMLSelectElement).options).map((o) => o.value);
    expect(options()).toEqual(['qwen3.8-flash']);
    const check = fk('model:omlx:qwen3.8-flash:enabled') as HTMLInputElement;
    check.checked = false;
    check.dispatchEvent(new Event('change', { bubbles: true }));
    expect((fk('eng:omlx:default-model') as HTMLSelectElement).disabled).toBe(true);
  });
});

describe('AI tab order and naming (U3, U8)', () => {
  it('intro, master switch, Engines, Allow cloud, toolbar button, Features; task pickers folded under Advanced', () => {
    class Host extends NoopHost { ai = tier2(); }
    const handle = mount(new Host(), settings());
    handle.command('openAiSettings');
    const panel = document.querySelector<HTMLElement>('.settings-panel--ai')!;
    const text = panel.textContent ?? '';
    const order = ['AI features', 'Enable AI features', 'Engines', 'Allow cloud engines', 'Show AI button on the toolbar', 'Features'].map((t) => text.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The task pickers are folded until asked for.
    const toggle = panel.querySelector<HTMLButtonElement>('[data-fk="features:advanced"]')!;
    expect(toggle.textContent).toBe('Advanced: task per feature');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const tasks = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(tasks.hidden).toBe(true);
    expect(tasks.querySelector('[data-fk="feature:rewrite:task"]')).not.toBeNull();
    expect(panel.querySelector('.ai-feature [data-fk="feature:rewrite:task"]')).toBeNull();
    toggle.click();
    expect(tasks.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('a tier-1 host has no Advanced: it routes by itself', () => {
    class Tier1 extends NoopHost { ai = { complete: vi.fn() } as unknown as MikeDownAiHost; }
    const handle = mount(new Tier1());
    handle.command('openAiSettings');
    expect(document.querySelector('[data-fk="features:advanced"]')).toBeNull();
  });

  it('the page names Tasks, the star says Use by default, and Fetch models becomes Refresh models once there is a list', () => {
    class Host extends NoopHost { ai = tier2(); }
    const handle = mount(new Host(), settings());
    handle.command('openAiSettings', { page: true });
    const navNames = Array.from(document.querySelectorAll('.ai-nav-name')).map((n) => n.textContent);
    expect(navNames).toContain('Tasks');
    expect(navNames).not.toContain('Routing');
    // oMLX is the default; LM Studio is not.
    click(document.querySelector('[data-fk="nav:eng:lms"]'));
    const star = document.querySelector<HTMLButtonElement>('[data-fk="eng:lms:star"]')!;
    expect(star.textContent).toBe('Use by default');
    expect(star.title).toBe('Use this engine by default');
    expect(document.querySelector('[data-fk="eng:lms:fetch"]')?.textContent).toBe('Refresh models');
  });

  it('Q2: Enable AI features ticked on the tab, then engines saved on the page, saves ai.enabled with them', () => {
    const saveSettings = vi.fn();
    class Host extends NoopHost { ai = tier2(); saveSettings = saveSettings; }
    const handle = mount(new Host(), { ...settings(), enabled: false });
    handle.command('openAiSettings');
    click(byText('.settings-label', 'Enable AI features'));
    click(document.querySelector('[data-fk="manage-engines"]'));
    click(document.querySelector('[data-fk="nav:eng:lms"]'));
    click(document.querySelector('[data-fk="eng:lms:star"]'));
    click(document.querySelector('[data-fk="page:done"]'));
    const patch = saveSettings.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(patch['ai.enabled']).toBe(true);
    expect(patch).toHaveProperty('ai.routing');
    // The tab stays ticked, and saving it again sends no second ai.enabled.
    expect(document.querySelector<HTMLInputElement>('[data-fk="ai-enabled"]')?.checked).toBe(true);
    click(byText('.settings-btn--primary', 'Save to Settings'));
    expect(saveSettings.mock.calls.at(-1)![0]).not.toHaveProperty('ai.enabled');
  });

  it('Q2: a page opened from the tab without a pending enable does not turn AI on', () => {
    const saveSettings = vi.fn();
    class Host extends NoopHost { ai = tier2(); saveSettings = saveSettings; }
    const handle = mount(new Host(), { ...settings(), enabled: false });
    handle.command('openAiSettings');
    click(document.querySelector('[data-fk="manage-engines"]'));
    click(document.querySelector('[data-fk="nav:eng:lms"]'));
    click(document.querySelector('[data-fk="eng:lms:star"]'));
    click(document.querySelector('[data-fk="page:done"]'));
    expect(saveSettings.mock.calls.at(-1)![0]).not.toHaveProperty('ai.enabled');
  });
});

describe('Local networks field on the AI tab', () => {
  const field = () => document.querySelector<HTMLTextAreaElement>('[data-fk="ai-local-networks"]')!;
  const type = (text: string) => {
    field().value = text;
    field().dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('parses lines and commas, dedupes, and restores the defaults when blank', () => {
    expect(parseLocalNetworksText(' 10.0.98.0/24\n.TS.net, 10.0.98.0/24 ')).toEqual({ ok: true, value: ['10.0.98.0/24', '.ts.net'] });
    expect(parseLocalNetworksText('  \n ')).toEqual({ ok: true, value: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'] });
  });

  it('refuses a malformed range or host name, naming the entry', () => {
    for (const bad of ['10.0.0.0/33', '300.1.1.1', '10.0.0', 'http://x.example', 'a b/c']) {
      expect(parseLocalNetworksText(bad).ok, bad).toBe(false);
    }
    const r = parseLocalNetworksText('10.0.98.0/24 10.0.0.0/40');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('10.0.0.0/40');
  });

  it('sits folded under Advanced, shows the current list and saves only when changed', () => {
    const saveSettings = vi.fn();
    class Host extends NoopHost { ai = tier2(); saveSettings = saveSettings; }
    const handle = mount(new Host(), settings({ localNetworks: ['10.0.98.0/24'] }));
    handle.command('openAiSettings');
    const toggle = document.querySelector<HTMLButtonElement>('[data-fk="local-networks:advanced"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)!.hidden).toBe(true);
    toggle.click();
    expect(field().value).toBe('10.0.98.0/24');
    click(byText('.settings-btn--primary', 'Save to Settings'));
    expect(Object.keys(saveSettings.mock.calls[0][0]).filter((k) => k.startsWith('ai.'))).toEqual([]);

    handle.command('openAiSettings');
    type('10.0.98.0/24\n.ts.net');
    click(byText('.settings-btn--primary', 'Save to Settings'));
    const patch = saveSettings.mock.calls[1][0] as Record<string, unknown>;
    expect(Object.keys(patch).filter((k) => k.startsWith('ai.'))).toEqual(['ai.localNetworks']);
    expect(patch['ai.localNetworks']).toEqual(['10.0.98.0/24', '.ts.net']);
  });

  it('a bad entry shows an error and leaves the draft alone; blank saves the defaults', () => {
    const saveSettings = vi.fn();
    class Host extends NoopHost { ai = tier2(); saveSettings = saveSettings; }
    const handle = mount(new Host(), settings({ localNetworks: ['10.0.98.0/24'] }));
    handle.command('openAiSettings');
    type('10.0.98.0/99');
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(field().getAttribute('aria-describedby')!)!.textContent).toContain('10.0.98.0/99');
    click(byText('.settings-btn--primary', 'Save to Settings'));
    expect(Object.keys(saveSettings.mock.calls[0][0]).filter((k) => k.startsWith('ai.'))).toEqual([]);

    handle.command('openAiSettings');
    type('');
    expect(field().hasAttribute('aria-invalid')).toBe(false);
    click(byText('.settings-btn--primary', 'Save to Settings'));
    expect((saveSettings.mock.calls[1][0] as Record<string, unknown>)['ai.localNetworks']).toEqual(['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']);
  });

  it('a tier-1 host has no field: it has no engines of its own', () => {
    class Tier1 extends NoopHost { ai = { complete: vi.fn() } as unknown as MikeDownAiHost; }
    const handle = mount(new Tier1());
    handle.command('openAiSettings');
    expect(field()).toBeNull();
  });
});

describe('AI tab lifecycle', () => {
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
    expect(chip.textContent).toBe('AI: no model chosen');
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
    expect(chip.title).toMatch(/ Click for AI settings\.$/);
    handle.setAiServed({ engineId: 'claude', engineName: 'Anthropic', modelId: 'claude-sonnet-5-5', isLocal: false }, { viaFallback: true });
    expect(chip.textContent).toBe('AI: cloud · Anthropic · claude-sonnet-5-5 (fallback)');
    expect(chip.dataset.tone).toBe('cloud');
    chip.click();
    expect(document.querySelector<HTMLElement>('.settings-tab[aria-selected="true"]')?.dataset.tabId).toBe('ai');
  });

  it('opens the page on routing when nothing can be routed', () => {
    class Host extends NoopHost { ai = tier2(); }
    mount(new Host(), settings({ routing: { default: null, fallback: 'none', tasks: {} } }));
    const chip = document.querySelector<HTMLButtonElement>('[data-testid="sidebar-ai-chip"]')!;
    expect(chip.textContent).toBe('AI: no model chosen');
    // The tooltip says what a click opens (U7).
    expect(chip.title).toMatch(/ Click to choose a model\.$/);
    chip.focus();
    chip.click();
    expect(document.querySelector('.settings-modal')).toBeNull();
    expect(document.querySelector('[data-fk="nav:routing"]')?.getAttribute('aria-current')).toBe('true');
    // Back returns focus to the chip.
    click(document.querySelector('[data-fk="page:back"]'));
    expect(document.activeElement).toBe(chip);
  });

  it('stays hidden while AI was never set up', () => {
    class Host extends NoopHost { ai = tier2(); }
    mount(new Host());
    expect(document.querySelector<HTMLButtonElement>('[data-testid="sidebar-ai-chip"]')?.hidden).toBe(true);
  });
});

describe('Cloud consents row on the AI tab (T2)', () => {
  const records = [
    { engineId: 'claude', answer: 'allow' as const, at: 200, scope: 'workspace' as const },
    { engineId: 'gone', answer: 'never' as const, at: 100, scope: 'workspace' as const },
  ];
  const flush = async () => { for (let i = 0; i < 5; i++) {await Promise.resolve();} };

  it('lists the stored answers with the engine name (or the id when the engine is gone) and a Forget button each', async () => {
    class Host extends NoopHost { ai = tier2({ listConsents: vi.fn(async () => records), forgetConsent: vi.fn(async () => {}) }); }
    const handle = mount(new Host(), settings());
    handle.command('openAiSettings');
    await flush();
    const items = Array.from(document.querySelectorAll('.ai-consents-list .ai-consent'));
    expect(items.map((i) => i.querySelector('.ai-consent-text')?.textContent)).toEqual([
      'Anthropic · this workspace · Allowed',
      'gone · this workspace · Not allowed',
    ]);
    expect(document.querySelector('.ai-consents-empty')).toBeNull();
    expect(document.querySelector('[aria-label="Forget the answer for Anthropic"]')).not.toBeNull();
  });

  it('shows the empty text when nothing is stored', async () => {
    class Host extends NoopHost { ai = tier2({ listConsents: vi.fn(async () => []), forgetConsent: vi.fn(async () => {}) }); }
    const handle = mount(new Host(), settings());
    handle.command('openAiSettings');
    await flush();
    expect(document.querySelector('.ai-consents-empty')?.textContent).toBe('No cloud engine has been allowed here.');
    expect(document.querySelector('.ai-consents-list')).toBeNull();
  });

  it('Forget calls the host with the engine id, then lists again', async () => {
    let stored = [...records];
    const forgetConsent = vi.fn(async (id: string) => { stored = stored.filter((r) => r.engineId !== id); });
    const listConsents = vi.fn(async () => stored);
    class Host extends NoopHost { ai = tier2({ listConsents, forgetConsent }); }
    const handle = mount(new Host(), settings());
    handle.command('openAiSettings');
    await flush();
    click(document.querySelector('[data-fk="consent-forget:claude"]'));
    await flush();
    expect(forgetConsent).toHaveBeenCalledWith('claude');
    expect(listConsents).toHaveBeenCalledTimes(2);
    expect(Array.from(document.querySelectorAll('.ai-consent-text')).map((n) => n.textContent)).toEqual(['gone · this workspace · Not allowed']);
  });

  it('a failing Forget shows the error and keeps the list', async () => {
    const forgetConsent = vi.fn(async () => { throw { code: 'unknown', message: 'could not write' }; });
    class Host extends NoopHost { ai = tier2({ listConsents: vi.fn(async () => records), forgetConsent }); }
    const handle = mount(new Host(), settings());
    handle.command('openAiSettings');
    await flush();
    click(document.querySelector('[data-fk="consent-forget:claude"]'));
    await flush();
    expect(document.querySelector('.ai-consents')?.textContent).toContain('could not write');
    expect(document.querySelectorAll('.ai-consent')).toHaveLength(2);
  });

  it('a host that cannot list consents gets no row', () => {
    class Host extends NoopHost { ai = tier2(); }
    const handle = mount(new Host(), settings());
    handle.command('openAiSettings');
    expect(document.querySelector('.ai-consents')).toBeNull();
    expect(document.body.textContent).not.toContain('Cloud consents');
  });
});
