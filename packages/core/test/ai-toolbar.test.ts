/** The toolbar's AI button: visibility, the first-run panel and its turn-on flow, the menu. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle, type MikeDownHost } from '../src/index';
import { defaultAiSettings, parseAiSettings } from '../src/ai';
import type { AiSettings, MikeDownAiHost } from '../src/ai';
import { AI_EXPERIMENTAL_DISCLAIMER } from '../src/ai-settings-dom';
import { aiMenuStatusLine, aiSetupTarget, aiToolbarButtonMode, aiToolbarMenuEntries, hideAiFirstRunPanel, showAiFirstRunPanel } from '../src/ai-toolbar';
import { hideToolbarDropdown, showToolbarDropdown } from '../src/toolbar-dropdown';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const quiet = { onWarning: () => {} };

function withEngine(over: Record<string, unknown> = {}): AiSettings {
  return parseAiSettings({
    enabled: true,
    engines: [
      { id: 'lms', name: 'LM Studio', kind: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', models: [{ id: 'gemma' }] },
      { id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', models: [{ id: 'qwen' }] },
    ],
    routing: { default: { engineId: 'omlx', modelId: 'qwen' }, fallback: 'anyLocal', tasks: {} },
    ...over,
  }, quiet);
}

describe('aiToolbarButtonMode', () => {
  const cases: Array<[boolean, boolean, boolean, string]> = [
    // host support, enabled, showToolbarButton → mode
    [false, false, false, 'hidden'],
    [false, false, true, 'hidden'],
    [false, true, false, 'hidden'],
    [false, true, true, 'hidden'],
    [true, false, false, 'hidden'],
    [true, true, false, 'hidden'],
    [true, false, true, 'firstRun'],
    [true, true, true, 'menu'],
  ];
  it.each(cases)('host %s, enabled %s, showToolbarButton %s → %s', (host, enabled, showToolbarButton, mode) => {
    expect(aiToolbarButtonMode(host, { enabled, showToolbarButton })).toBe(mode);
  });

  it('defaults to shown (first-run) for a host with AI support', () => {
    expect(aiToolbarButtonMode(true, defaultAiSettings())).toBe('firstRun');
  });
});

describe('aiSetupTarget', () => {
  it('tier 2: the default route engine, else the first engine, else the setup wizard', () => {
    expect(aiSetupTarget(2, withEngine())).toEqual({ kind: 'page', engineId: 'omlx' });
    expect(aiSetupTarget(2, withEngine({ routing: { default: null, fallback: 'anyLocal', tasks: {} } }))).toEqual({ kind: 'page', engineId: 'lms' });
    expect(aiSetupTarget(2, defaultAiSettings())).toEqual({ kind: 'wizard' });
  });

  it('tier 1 routes by itself: the AI tab', () => {
    expect(aiSetupTarget(1, withEngine())).toEqual({ kind: 'tab' });
  });
});

describe('aiToolbarMenuEntries', () => {
  const base = { icons: { rewrite: '', manage: '' }, onRewrite: () => {}, onManage: () => {} };

  it('Rewrite selection disabled with a hint, then Manage engines…', () => {
    const entries = aiToolbarMenuEntries({ ...base, rewrite: { enabled: false, hint: 'Select text first' }, canManageEngines: true });
    const actions = entries.filter((e) => e.type === 'action');
    expect(actions.map((e) => e.label)).toEqual(['Rewrite selection', 'Manage engines…']);
    expect(actions[0].isDisabled?.()).toBe(true);
    expect(actions[0].hint).toBe('Select text first');
    expect(actions[1].isDisabled?.()).toBeFalsy();
  });

  it('one reason shared by several items shows once as a status row, not under each item', () => {
    const reason = 'oMLX failed its last connection test: Could not reach http://127.0.0.1:8000 (ECONNREFUSED).';
    const off = { enabled: false as const, hint: reason };
    const retest = vi.fn();
    const entries = aiToolbarMenuEntries({
      ...base, rewrite: off, explain: off, translate: off, summarize: off, titles: off, properties: off, canManageEngines: true, onRetest: retest,
    });
    const status = entries.find((e) => e.type === 'status');
    expect(status).toMatchObject({ id: 'ai-status', label: "oMLX isn't reachable", detail: reason });
    const actions = entries.filter((e) => e.type === 'action');
    expect(actions.map((e) => e.label)).toEqual([
      'Look again', 'Rewrite selection', 'Explain selection', 'Translate…',
      'Summarize document…', 'Suggest titles…', 'Suggest properties', 'Manage engines…',
    ]);
    expect(actions.filter((e) => e.hint === reason)).toHaveLength(0);
    expect(actions.slice(1, 7).every((e) => e.isDisabled?.() && !e.hint)).toBe(true);
    actions[0].action();
    expect(retest).toHaveBeenCalledOnce();
  });

  it('per-item reasons stay when items differ', () => {
    const entries = aiToolbarMenuEntries({
      ...base,
      rewrite: { enabled: false, hint: 'Select text first' },
      explain: { enabled: false, hint: 'Select text first' },
      translate: { enabled: true },
      canManageEngines: true,
    });
    const actions = entries.filter((e) => e.type === 'action');
    expect(actions.map((e) => e.id)).toEqual(['ai-rewrite', 'ai-explain', 'ai-translate', 'ai-manage']);
    expect(actions[0].hint).toBe('Select text first');
    expect(actions[1].hint).toBe('Select text first');
  });

  it('a shared failure that is not a network one keeps its error as the detail', () => {
    expect(aiMenuStatusLine('LM Studio failed its last connection test: 401 Unauthorized')).toEqual({
      label: 'LM Studio failed its last connection test', detail: '401 Unauthorized',
    });
    expect(aiMenuStatusLine('No model is set for this task.')).toEqual({ label: 'No model is set for this task.' });
  });

  it('a read-only editor leaves Rewrite out; a tier-1 host gets AI settings…', () => {
    const entries = aiToolbarMenuEntries({ ...base, rewrite: null, canManageEngines: false });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'action', label: 'AI settings…' });
  });
});

// ── In the editor ───────────────────────────────────────────────────────────

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

function mount(host: MikeDownHost, ai?: AiSettings, readOnly = false): MikeDownEditorHandle {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host, readOnly, settings: ai ? { ai } : undefined });
  mounted.push({ handle, el });
  return handle;
}

function tier2(): MikeDownAiHost {
  return {
    complete: vi.fn(),
    listEngines: vi.fn(async () => []),
    testEngine: vi.fn(),
    discoverModels: vi.fn(async () => ({ models: [] })),
    setSecret: vi.fn(async () => {}),
  } as unknown as MikeDownAiHost;
}

const aiButton = () => mounted[mounted.length - 1]?.el.querySelector<HTMLButtonElement>('button[data-action="ai"]') ?? null;
const panel = () => document.querySelector<HTMLElement>('.ai-first-run');
const isShown = (b: HTMLElement | null) => !!b && b.style.display !== 'none';

afterEach(() => {
  hideToolbarDropdown();
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  document.querySelectorAll('#mikedown-settings-overlay, #mikedown-ai-page-overlay, .ai-first-run').forEach((n) => n.remove());
});

describe('toolbar AI button visibility', () => {
  it('is never there for a host with no AI adapter', () => {
    mount(new NoopHost(), withEngine());
    expect(aiButton()).toBeNull();
  });

  it('is never there when the host has AI but the ai feature is off', () => {
    class Host extends NoopHost { ai = tier2(); }
    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = createMikeDownEditor(el, { host: new Host(), features: { ai: false } });
    mounted.push({ handle, el });
    expect(aiButton()).toBeNull();
  });

  it('shows by default for a host with AI support, with an accessible name and tooltip', () => {
    class Host extends NoopHost { ai = tier2(); }
    mount(new Host());
    const b = aiButton()!;
    expect(isShown(b)).toBe(true);
    expect(b.getAttribute('aria-label')).toBe('AI Actions');
    expect(b.dataset.tip).toBe('AI Actions');
    expect(b.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('follows ai.showToolbarButton and ai.enabled as settings arrive', () => {
    class Host extends NoopHost { ai = tier2(); }
    const handle = mount(new Host(), parseAiSettings({ showToolbarButton: false }, quiet));
    expect(isShown(aiButton())).toBe(false);
    handle.updateSettings({ ai: parseAiSettings({ showToolbarButton: true, enabled: true }, quiet) });
    expect(isShown(aiButton())).toBe(true);
    expect(aiButton()!.getAttribute('aria-haspopup')).toBe('menu');
  });
});

describe('first-run panel (AI off)', () => {
  it('shows the badge, the disclaimer and two buttons; Cancel closes without saving', () => {
    const saveSettings = vi.fn();
    class Host extends NoopHost { ai = tier2(); saveSettings = saveSettings; }
    mount(new Host());
    aiButton()!.click();
    const p = panel()!;
    expect(p.getAttribute('role')).toBe('dialog');
    expect(p.querySelector('.ai-experimental-badge')?.textContent).toBe('Experimental');
    expect(p.textContent).toContain(AI_EXPERIMENTAL_DISCLAIMER);
    expect(document.activeElement?.textContent).toBe('Set up');
    (p.querySelector('[data-fk="ai-first-run:cancel"]') as HTMLButtonElement).click();
    expect(panel()).toBeNull();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(aiButton());
  });

  it('Escape closes it', () => {
    class Host extends NoopHost { ai = tier2(); }
    mount(new Host());
    aiButton()!.click();
    panel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel()).toBeNull();
  });

  it('Set up opens the AI Engines page on the setup wizard and leaves AI off until Done (B3)', () => {
    const saveSettings = vi.fn();
    class Host extends NoopHost { ai = tier2(); saveSettings = saveSettings; }
    mount(new Host());
    aiButton()!.click();
    (panel()!.querySelector('[data-fk="ai-first-run:turn-on"]') as HTMLButtonElement).click();
    expect(panel()).toBeNull();
    expect(saveSettings).not.toHaveBeenCalled();
    const page = document.querySelector('#mikedown-ai-page-overlay')!;
    expect(page).not.toBeNull();
    expect(page.querySelector('.ai-wizard')).not.toBeNull();
    expect(page.querySelector('.ai-page-title')?.textContent).toBe('Set up AI');
    // Back leaves AI off: the button still opens the first-run panel.
    (page.querySelector('.ai-page-back') as HTMLButtonElement).click();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(aiButton()!.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('with an engine already set up, the page opens on its Express form', () => {
    const saveSettings = vi.fn();
    class Host extends NoopHost { ai = tier2(); saveSettings = saveSettings; }
    mount(new Host(), withEngine({ enabled: false }));
    aiButton()!.click();
    (panel()!.querySelector('[data-fk="ai-first-run:turn-on"]') as HTMLButtonElement).click();
    expect(document.querySelector('[data-fk="nav:eng:omlx"]')?.getAttribute('aria-current')).toBe('true');
    expect(document.querySelector('#mikedown-ai-page-overlay .ai-form')).not.toBeNull();
    // Done turns AI on, once, because the engine has a usable default route.
    (document.querySelector('.ai-page-done') as HTMLButtonElement).click();
    expect(saveSettings.mock.calls.flatMap((c) => Object.keys(c[0] as object)).filter((k) => k === 'ai.enabled')).toHaveLength(1);
    expect(saveSettings).toHaveBeenCalledWith({ 'ai.enabled': true });
    expect(aiButton()!.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('a tier-1 host says Turn on, turns on and lands on the AI tab', () => {
    const saveSettings = vi.fn();
    class Host extends NoopHost { ai = { complete: vi.fn() } as unknown as MikeDownAiHost; saveSettings = saveSettings; }
    mount(new Host());
    aiButton()!.click();
    expect(panel()!.querySelector('[data-fk="ai-first-run:turn-on"]')?.textContent).toBe('Turn on');
    (panel()!.querySelector('[data-fk="ai-first-run:turn-on"]') as HTMLButtonElement).click();
    expect(saveSettings).toHaveBeenCalledWith({ 'ai.enabled': true });
    expect(document.querySelector<HTMLElement>('.settings-tab[aria-selected="true"]')?.dataset.tabId).toBe('ai');
    expect(document.querySelector<HTMLInputElement>('[data-fk="ai-enabled"]')?.checked).toBe(true);
  });
});

describe('AI menu (AI on)', () => {
  it('Rewrite selection is disabled with a hint when nothing is selected; Manage engines… opens the page', () => {
    class Host extends NoopHost { ai = tier2(); }
    mount(new Host(), withEngine());
    aiButton()!.click();
    const items = Array.from(document.querySelectorAll<HTMLElement>('#toolbar-dropdown .tdd-item'));
    expect(items.map((i) => i.querySelector('.tdd-item-label')?.textContent)).toEqual([
      'Rewrite selection', 'Explain selection', 'Translate…', 'Summarize document…', 'Suggest titles…', 'Manage engines…',
    ]);
    expect(items[0].getAttribute('aria-disabled')).toBe('true');
    expect(items[0].querySelector('.tdd-item-hint')?.textContent).toBe('Select text first');
    // Explain needs a selection too; Translate offers the whole document without one.
    expect(items[1].querySelector('.tdd-item-hint')?.textContent).toBe('Select text first');
    expect(items[2].getAttribute('aria-disabled')).not.toBe('true');
    items[5].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('#mikedown-ai-page-overlay')).not.toBeNull();
  });

  it('a read-only editor offers only Manage engines…', () => {
    class Host extends NoopHost { ai = tier2(); }
    mount(new Host(), withEngine(), true);
    aiButton()!.click();
    const labels = Array.from(document.querySelectorAll('#toolbar-dropdown .tdd-item-label')).map((n) => n.textContent);
    expect(labels).toEqual(['Manage engines…']);
  });
});

describe('AI menu: an unreachable engine and "Look again"', () => {
  const down = { engineId: 'omlx', ok: false, isLocal: true, hasKey: false, error: 'Could not reach http://127.0.0.1:8000 (ECONNREFUSED).', models: [] };
  const up = { engineId: 'omlx', ok: true, isLocal: true, hasKey: false, latencyMs: 4, models: [{ id: 'qwen', capabilities: { chat: true, stream: true, vision: false, json: true, tools: false, fim: false, embed: false, contextTokens: 32768 }, source: 'user' }] };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const statusRow = () => document.querySelector<HTMLElement>('#toolbar-dropdown .tdd-status');

  it('shows one non-focusable status row; Look again retests the engine and the row goes away', async () => {
    let current = down;
    const ai = { ...tier2(), listEngines: vi.fn(async () => [current]), testEngine: vi.fn(async () => (current = up)) } as unknown as MikeDownAiHost;
    class Host extends NoopHost { ai = ai; }
    const handle = mount(new Host(), withEngine({ routing: { default: { engineId: 'omlx', modelId: 'qwen' }, fallback: 'none', tasks: {} } }));
    handle.setAiEngineStatuses([down]);
    aiButton()!.click();
    const row = statusRow()!;
    expect(row.getAttribute('role')).toBe('status');
    expect(row.querySelector('.tdd-status-label')?.textContent).toBe("oMLX isn't reachable");
    expect(row.querySelector('.tdd-status-detail')?.textContent).toMatch(/ECONNREFUSED/);
    expect(row.hasAttribute('tabindex')).toBe(false);
    const look = document.querySelector<HTMLElement>('#toolbar-dropdown .tdd-item[data-tdd-id="ai-retest"]')!;
    expect(look.querySelector('.tdd-item-label')?.textContent).toBe('Look again');
    look.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await wait(100);
    expect(ai.testEngine).toHaveBeenCalledWith('omlx');
    // The menu opened again with the engine answering.
    expect(document.querySelector('#toolbar-dropdown')).not.toBeNull();
    expect(statusRow()).toBeNull();
  });

  it('a host without testEngine gets no Look again row', async () => {
    const ai = { ...tier2(), listEngines: vi.fn(async () => [down]), testEngine: undefined } as unknown as MikeDownAiHost;
    class Host extends NoopHost { ai = ai; }
    const handle = mount(new Host(), withEngine({ routing: { default: { engineId: 'omlx', modelId: 'qwen' }, fallback: 'none', tasks: {} } }));
    handle.setAiEngineStatuses([down]);
    aiButton()!.click();
    expect(statusRow()).not.toBeNull();
    expect(document.querySelector('#toolbar-dropdown [data-tdd-id="ai-retest"]')).toBeNull();
  });
});

describe('toolbar dropdown status entry', () => {
  it('renders without focus: arrows skip it and a click leaves the menu open', async () => {
    const run = vi.fn();
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    showToolbarDropdown(anchor, [
      { type: 'status', id: 's', label: 'Not reachable', detail: 'Details' },
      { type: 'action', id: 'a', label: 'First', action: run },
      { type: 'action', id: 'b', label: 'Second', action: run },
    ]);
    await new Promise((r) => setTimeout(r, 40));
    const status = document.querySelector<HTMLElement>('#toolbar-dropdown .tdd-status')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.querySelector('svg')).not.toBeNull();
    expect(status.getAttribute('tabindex')).toBeNull();
    const key = (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key('ArrowDown');
    expect(document.activeElement?.getAttribute('data-tdd-id')).toBe('a');
    key('ArrowUp');
    expect(document.activeElement?.getAttribute('data-tdd-id')).toBe('b');
    status.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('#toolbar-dropdown')).not.toBeNull();
    expect(run).not.toHaveBeenCalled();
    anchor.remove();
  });
});

describe('first-run panel: the privacy line beside "Set up another way…"', () => {
  afterEach(() => {
    hideAiFirstRunPanel();
    document.body.replaceChildren();
  });

  it('shows one privacy line once a local server is found; Learn more opens setup like the link beside it', async () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const onTurnOn = vi.fn();
    const panel = showAiFirstRunPanel({
      anchor,
      onTurnOn,
      detect: async () => ({ kind: 'found', presetId: 'lmstudio', name: 'LM Studio', models: 2 }),
      onUseLocal: async () => {},
    }).element;
    const line = panel.querySelector<HTMLElement>('.ai-privacy-line')!;
    expect(line.hidden).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(line.hidden).toBe(false);
    expect(panel.querySelectorAll('.ai-privacy-line')).toHaveLength(1);
    expect(panel.querySelectorAll('.ai-first-run-other')).toHaveLength(1);
    expect(line.textContent).toContain('A cloud engine sends text to the provider.');
    line.querySelector<HTMLButtonElement>('[data-fk="ai-privacy:learn-more"]')!.click();
    expect(onTurnOn).toHaveBeenCalledOnce();
    expect(panel.isConnected).toBe(false);
  });

  it('stays hidden when nothing is found', async () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const panel = showAiFirstRunPanel({ anchor, onTurnOn: vi.fn(), detect: async () => ({ kind: 'none' }), onUseLocal: async () => {} }).element;
    await Promise.resolve();
    await Promise.resolve();
    expect(panel.querySelector<HTMLElement>('.ai-privacy-line')!.hidden).toBe(true);
  });
});
