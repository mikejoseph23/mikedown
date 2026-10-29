/**
 * Express engine form (M3b), tested through its DOM. The form is mounted by
 * the AI Engines page, so these tests mount the page and drive the form like
 * a user. The pure helpers behind it (`autoFetchDecision`, `popularModels`,
 * `thinkingOverrides`...) are covered in ai-express-model.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAiSettings, thinkingLevelFrom } from '../src/ai';
import type { AiEngineStatus, AiSettings, MikeDownAiHost } from '../src/ai';
import { mountAiEnginesPage } from '../src/ai-engines-page';
import type { AiEnginesPageHandle, AiEnginesPageOptions } from '../src/ai-engines-page';
import { settingsSectionContext } from '../src/settings-rows';

// ── Fixtures ────────────────────────────────────────────────────────────────

const caps = { chat: true, stream: true, vision: false, json: true, tools: true, fim: false, embed: false, contextTokens: null };
const modelRow = (id: string, over: Record<string, unknown> = {}) => ({ id, enabled: true, capabilities: caps, capabilitiesSource: 'endpoint', ...over });

const claude = { id: 'claude', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKeyEnv: 'ANTHROPIC_API_KEY', models: [] as unknown[] };
const omlx = { id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', apiKeyEnv: 'OMLX_API_KEY', models: [] as unknown[] };
const lms = { id: 'lms', name: 'LM Studio', kind: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', models: [] as unknown[] };
const mine = { id: 'mine', name: 'My server', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:9999/v1', models: [] as unknown[] };
const openrouter = { id: 'or', name: 'OpenRouter', kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY', models: [] as unknown[] };

type RawEngine = typeof claude;

const NO_ROUTING = { default: null, fallback: 'none', tasks: {} };

function settingsOf(engines: RawEngine[], routing: Record<string, unknown> = NO_ROUTING, allowCloud = true): AiSettings {
  return parseAiSettings({ enabled: true, allowCloud, engines, routing }, { onWarning: () => {} });
}

const probed = (engineId: string, isLocal = true): AiEngineStatus => ({ engineId, ok: true, isLocal, hasKey: false, models: [] });

function listing(engineId: string, ids: string[], over: Partial<AiEngineStatus> = {}): AiEngineStatus {
  return {
    engineId,
    ok: true,
    isLocal: true,
    hasKey: false,
    models: ids.map((id) => ({ id, capabilities: caps, source: 'endpoint' as const })),
    ...over,
  };
}

/** A dozen ids shaped like Anthropic's list: current aliases first, dated snapshots after. */
const ANTHROPIC_IDS = [
  'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-1',
  'claude-sonnet-4-5-20250929', 'claude-opus-4-1-20250805', 'claude-haiku-4-5-20251001',
  'claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-7-sonnet-20250219',
  'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307',
];

interface Mounted {
  c: HTMLElement;
  page: AiEnginesPageHandle;
  ai: { discoverModels: ReturnType<typeof vi.fn>; setSecret: ReturnType<typeof vi.fn>; testEngine: ReturnType<typeof vi.fn>; listEngines: ReturnType<typeof vi.fn> };
  onDone: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
  saveNow: ReturnType<typeof vi.fn>;
  host: () => AiSettings;
}

const containers: HTMLElement[] = [];
const pages: AiEnginesPageHandle[] = [];

/** Mount the page over `engines`. `saveNow` is wired to a fake host that echoes saved engines. */
function mountPage(engines: RawEngine[], over: {
  routing?: Record<string, unknown>;
  statuses?: AiEngineStatus[];
  discover?: (id: string) => Promise<AiEngineStatus>;
  initial?: AiEnginesPageOptions['initial'];
  allowCloud?: boolean;
  listEngines?: () => Promise<AiEngineStatus[]>;
  host?: Partial<MikeDownAiHost>;
} = {}): Mounted {
  const settings = settingsOf(engines, over.routing, over.allowCloud ?? true);
  // Local engines are probed unless the test says otherwise, so opening a form fetches nothing.
  const statuses = over.statuses ?? engines.filter((e) => !e.baseUrl.startsWith('https')).map((e) => probed(e.id));
  let hostSettings = settings;
  const ai = {
    complete: vi.fn(),
    listEngines: vi.fn(over.listEngines ?? (async (): Promise<AiEngineStatus[]> => [])),
    testEngine: vi.fn(),
    discoverModels: vi.fn(over.discover ?? (async (id: string) => probed(id))),
    setSecret: vi.fn(async () => {}),
    ...over.host,
  };
  const saveNow = vi.fn((patch: Record<string, unknown>) => {
    if (patch['ai.engines']) {
      hostSettings = { ...hostSettings, engines: parseAiSettings({ enabled: true, engines: patch['ai.engines'] }, { onWarning: () => {} }).engines };
    }
  });
  const onDone = vi.fn();
  const onCancel = vi.fn();
  const c = document.createElement('div');
  document.body.appendChild(c);
  containers.push(c);
  const page = mountAiEnginesPage(c, settingsSectionContext(() => {}), {
    ai: ai as unknown as MikeDownAiHost,
    settings,
    statuses,
    getHostSettings: () => hostSettings,
    saveNow,
    waitForSettings: async (accept) => (accept(hostSettings) ? hostSettings : null),
    onStatuses: vi.fn(),
    onDone,
    onCancel,
    initial: over.initial,
  });
  pages.push(page);
  return { c, page, ai, onDone, onCancel, saveNow, host: () => hostSettings };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const q = <T extends HTMLElement = HTMLElement>(c: ParentNode, fk: string) => c.querySelector<T>(`[data-fk="${fk}"]`);
const click = (n: Element | null | undefined) => {
  if (!n) {throw new Error('click: no such element');}
  (n as HTMLElement).click();
};
const key = (n: Element | null | undefined, k: string) => n!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

function type(input: HTMLInputElement | null, value: string): void {
  input!.value = value;
  input!.dispatchEvent(new Event('input', { bubbles: true }));
}

function choose(select: HTMLSelectElement | null, value: string): void {
  select!.value = value;
  select!.dispatchEvent(new Event('change', { bubbles: true }));
}

const labels = (c: HTMLElement) => Array.from(c.querySelectorAll('.ai-sheet:not(.ai-sheet--advanced) > .ai-sheet-row > .ai-sheet-label')).map((n) => n.textContent);
const optionIds = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('.ai-option')).map((n) => n.dataset.modelId);
const enabledIds = (s: AiSettings, engineId: string) => s.engines.find((e) => e.id === engineId)!.models.filter((m) => m.enabled).map((m) => m.id);

/** The settings the page handed to Done. */
function saved(m: Mounted): AiSettings {
  click(q(m.c, 'page:done'));
  return m.onDone.mock.calls[m.onDone.mock.calls.length - 1][1] as AiSettings;
}
const patchOf = (m: Mounted) => m.onDone.mock.calls[m.onDone.mock.calls.length - 1][0] as Record<string, unknown>;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Let the 600 ms key settle timer fire and the fetch it starts run its course. */
async function settle(ms = 600): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => { vi.useFakeTimers(); });

afterEach(() => {
  while (pages.length) {pages.pop()!.dispose();}
  while (containers.length) {containers.pop()!.remove();}
  vi.useRealTimers();
});

// ── Field sets ──────────────────────────────────────────────────────────────

describe('Express fields per preset family', () => {
  it('a cloud engine shows its key with the provider hint, and no URL', () => {
    const m = mountPage([claude]);
    expect(m.c.querySelector('.ai-form')?.getAttribute('data-family')).toBe('cloud');
    expect(labels(m.c)).toEqual(['Name', 'API key', 'Default model', 'Enabled']);
    expect(q(m.c, 'eng:claude:key')).not.toBeNull();
    expect(q(m.c, 'eng:claude:url')).toBeNull();
    // With no key stored, the note (subscription vs API key, Get a key links) sits over the field and replaces the hint link.
    expect(m.c.querySelector('.ai-sheet > .ai-wizard-subscription')).not.toBeNull();
    expect(m.c.querySelector('.ai-wizard-subscription-links')?.textContent).toContain('Get a key: Anthropic API keys');
    expect(m.c.querySelector<HTMLAnchorElement>('.ai-wizard-subscription a')?.getAttribute('href')).toBe('https://platform.claude.com/settings/keys');
    expect(m.c.querySelector('.ai-key-caption a.ai-key-link')).toBeNull();
    // The picker is part of the sheet too, between the key and the default model.
    expect(m.c.querySelector('.ai-picker')).not.toBeNull();
  });

  it('a local engine that expects a key shows URL then key', () => {
    const m = mountPage([omlx]);
    expect(m.c.querySelector('.ai-form')?.getAttribute('data-family')).toBe('local');
    expect(labels(m.c)).toEqual(['Name', 'Base URL', 'API key', 'Default model', 'Enabled']);
    expect(q<HTMLInputElement>(m.c, 'eng:omlx:url')!.value).toBe('http://127.0.0.1:8000/v1');
  });

  it('a local engine with no auth shows the URL only; its key waits under Advanced', () => {
    const m = mountPage([lms]);
    expect(labels(m.c)).toEqual(['Name', 'Base URL', 'Default model', 'Enabled']);
    expect(q(m.c, 'eng:lms:key')).toBeNull();
    click(q(m.c, 'eng:lms:advanced'));
    expect(q(m.c, 'eng:lms:key')).not.toBeNull();
  });

  it('a Custom server shows its key up front', () => {
    const m = mountPage([mine]);
    expect(labels(m.c)).toEqual(['Name', 'Base URL', 'API key', 'Default model', 'Enabled']);
    expect(m.c.querySelector('.ai-key-caption')?.textContent).toBe('Leave blank if the server has no auth.');
  });

  it('shows Stored for a key the host already holds', () => {
    const m = mountPage([claude], { statuses: [{ ...probed('claude', false), hasKey: true }] });
    expect(q<HTMLInputElement>(m.c, 'eng:claude:key')!.placeholder).toBe('Stored');
    expect(q(m.c, 'eng:claude:key-clear')).not.toBeNull();
    expect(m.c.querySelector('.ai-key-state')?.textContent).toBe('Stored');
    // Once a key is stored the subscription note is gone.
    expect(m.c.querySelector('.ai-wizard-subscription')).toBeNull();
  });
});

describe('key source caption', () => {
  const withFile = { ...omlx, apiKeyFile: { path: '~/.omlx/settings.json', jsonPath: 'auth.api_key' } };
  const hasKey = (keySource?: 'file' | 'stored' | 'env'): AiEngineStatus => ({ ...probed('omlx'), hasKey: true, ...(keySource ? { keySource } : {}) });
  const caption = (m: Mounted) => m.c.querySelector('.ai-key-caption')?.textContent ?? '';
  const placeholder = (m: Mounted) => q<HTMLInputElement>(m.c, 'eng:omlx:key')!.placeholder;

  it('says the key came from the file when the host says so, with nothing to clear', () => {
    const m = mountPage([withFile], { statuses: [hasKey('file')] });
    expect(placeholder(m)).toBe('Found');
    expect(caption(m)).toBe('Key found in ~/.omlx/settings.json. Paste a key to use another one.');
    expect(q(m.c, 'eng:omlx:key-clear')).toBeNull();
  });

  it('B1: names the variable a key came from, with nothing to clear', () => {
    const m = mountPage([omlx], { statuses: [hasKey('env')] });
    expect(placeholder(m)).toBe('Found');
    expect(caption(m)).toBe('Key found in OMLX_API_KEY. Paste a key to use another one.');
    expect(q(m.c, 'eng:omlx:key-clear')).toBeNull();
  });

  it('says Stored when the host says the key is stored, even for an engine with a key file', () => {
    const m = mountPage([withFile], { statuses: [hasKey('stored')] });
    expect(placeholder(m)).toBe('Stored');
    expect(m.c.querySelector('.ai-key-state')?.textContent).toBe('Stored');
  });

  it('keeps guessing from the engine settings when the host does not say', () => {
    const m = mountPage([withFile], { statuses: [hasKey()] });
    expect(placeholder(m)).toBe('Found');
    expect(caption(m)).toContain('(or stored here)');
  });
});

describe('Advanced fold', () => {
  const engineWithModels = { ...claude, models: [modelRow('claude-sonnet-5-5'), modelRow('claude-haiku-5-5', { enabled: false })] };

  it('is collapsed on open and reveals the full models table when expanded', () => {
    const m = mountPage([engineWithModels]);
    const toggle = q(m.c, 'eng:claude:advanced')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const panel = m.c.querySelector<HTMLElement>(`#${toggle.getAttribute('aria-controls')}`)!;
    expect(panel.hidden).toBe(true);
    expect(m.c.querySelector('.ai-models, [data-fk="eng:claude:add-model"], [data-fk="eng:claude:url"]')).toBeNull();

    click(toggle);
    const open = q(m.c, 'eng:claude:advanced')!;
    expect(open.getAttribute('aria-expanded')).toBe('true');
    const shown = m.c.querySelector<HTMLElement>(`#${open.getAttribute('aria-controls')}`)!;
    expect(shown.hidden).toBe(false);
    expect(shown.querySelectorAll('.ai-model')).toHaveLength(2);
    // The full M3 table: capability chips, context size, overrides, thinking, add by hand.
    expect(shown.querySelector('.ai-chips')).not.toBeNull();
    expect(q(shown, 'model:claude:claude-sonnet-5-5:context')).not.toBeNull();
    expect(q(shown, 'model:claude:claude-sonnet-5-5:overrides')).not.toBeNull();
    expect(q(shown, 'model:claude:claude-sonnet-5-5:thinking')).not.toBeNull();
    expect(q(shown, 'eng:claude:add-model')).not.toBeNull();
    // A cloud engine's URL, locality, key variable and key file live here.
    for (const fk of ['url', 'locality', 'env', 'keyfile-path', 'discovery']) {expect(q(shown, `eng:claude:${fk}`), fk).not.toBeNull();}
  });

  it('remembers an open fold per engine while the page is open', () => {
    const m = mountPage([engineWithModels, omlx]);
    click(q(m.c, 'eng:claude:advanced'));
    click(q(m.c, 'nav:eng:omlx'));
    expect(q(m.c, 'eng:omlx:advanced')!.getAttribute('aria-expanded')).toBe('false');
    click(q(m.c, 'nav:eng:claude'));
    expect(q(m.c, 'eng:claude:advanced')!.getAttribute('aria-expanded')).toBe('true');
  });
});

// ── Fetching ────────────────────────────────────────────────────────────────

describe('auto-fetch on a cloud key', () => {
  it('fires once when the key settles, not on every keystroke, and stores the key first', async () => {
    const m = mountPage([claude], { discover: async (id) => listing(id, ANTHROPIC_IDS, { isLocal: false, hasKey: true }) });
    type(q<HTMLInputElement>(m.c, 'eng:claude:key'), 'sk-a');
    await vi.advanceTimersByTimeAsync(300);
    type(q<HTMLInputElement>(m.c, 'eng:claude:key'), 'sk-ab');
    await vi.advanceTimersByTimeAsync(300);
    type(q<HTMLInputElement>(m.c, 'eng:claude:key'), 'sk-abc');
    await vi.advanceTimersByTimeAsync(599);
    expect(m.ai.setSecret).not.toHaveBeenCalled();
    expect(m.ai.discoverModels).not.toHaveBeenCalled();

    await settle(1);
    expect(m.ai.setSecret).toHaveBeenCalledOnce();
    expect(m.ai.setSecret).toHaveBeenCalledWith('claude', 'sk-abc');
    expect(m.ai.discoverModels).toHaveBeenCalledOnce();
    expect(m.ai.discoverModels).toHaveBeenCalledWith('claude');
    // Discovery runs host side against the stored key, so it is stored first.
    expect(m.ai.setSecret.mock.invocationCallOrder[0]).toBeLessThan(m.ai.discoverModels.mock.invocationCallOrder[0]);

    // Nothing else is waiting.
    await settle(5000);
    expect(m.ai.discoverModels).toHaveBeenCalledOnce();
    // The field goes back to its write-only state.
    expect(q<HTMLInputElement>(m.c, 'eng:claude:key')!.value).toBe('');
    expect(q<HTMLInputElement>(m.c, 'eng:claude:key')!.placeholder).toBe('Stored');
  });

  it('Enter settles the key at once', async () => {
    const m = mountPage([claude], { discover: async (id) => listing(id, ANTHROPIC_IDS, { isLocal: false }) });
    const input = q<HTMLInputElement>(m.c, 'eng:claude:key');
    type(input, 'sk-now');
    key(input, 'Enter');
    await settle(0);
    expect(m.ai.setSecret).toHaveBeenCalledWith('claude', 'sk-now');
    expect(m.ai.discoverModels).toHaveBeenCalledOnce();
  });

  it('an emptied key field fetches nothing', async () => {
    const m = mountPage([claude]);
    type(q<HTMLInputElement>(m.c, 'eng:claude:key'), 'sk-x');
    await vi.advanceTimersByTimeAsync(200);
    type(q<HTMLInputElement>(m.c, 'eng:claude:key'), '');
    await settle(2000);
    expect(m.ai.setSecret).not.toHaveBeenCalled();
    expect(m.ai.discoverModels).not.toHaveBeenCalled();
  });

  it('a second paste drops the first discovery and its result', async () => {
    const first = deferred<AiEngineStatus>();
    const second = deferred<AiEngineStatus>();
    const m = mountPage([claude]);
    m.ai.discoverModels.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);

    type(q<HTMLInputElement>(m.c, 'eng:claude:key'), 'sk-one');
    await settle();
    expect(m.ai.discoverModels).toHaveBeenCalledTimes(1);

    // Pasted again while the first discovery is still out.
    type(q<HTMLInputElement>(m.c, 'eng:claude:key'), 'sk-two');
    await settle();
    // One discovery per engine at a time: the second waits for the first.
    expect(m.ai.discoverModels).toHaveBeenCalledTimes(1);

    first.resolve(listing('claude', ['claude-sonnet-4-old'], { isLocal: false }));
    await settle(0);
    expect(m.ai.discoverModels).toHaveBeenCalledTimes(2);
    expect(m.c.querySelector('[data-model-id="claude-sonnet-4-old"]')).toBeNull();

    second.resolve(listing('claude', ['claude-sonnet-5-5'], { isLocal: false }));
    await settle(0);
    expect(m.ai.setSecret.mock.calls.map((c) => c[1])).toEqual(['sk-one', 'sk-two']);
    const result = saved(m);
    expect(result.engines[0].models.map((x) => x.id)).toEqual(['claude-sonnet-5-5']);
  });
});

describe('auto-fetch on a cloud key from a variable or file (B2)', () => {
  it('fetches on open when the host has a key and the engine has no models yet', async () => {
    const m = mountPage([claude], {
      statuses: [{ ...probed('claude', false), ok: null, hasKey: true, keySource: 'env' }],
      discover: async (id) => listing(id, ANTHROPIC_IDS, { isLocal: false, hasKey: true, keySource: 'env' }),
    });
    await settle(0);
    expect(m.ai.discoverModels).toHaveBeenCalledOnce();
    expect(m.ai.setSecret).not.toHaveBeenCalled();
    expect(m.c.querySelector('[data-model-id="claude-sonnet-5-5"]')).not.toBeNull();
  });

  it('a new cloud engine asks the host for a key from its variable, then fetches', async () => {
    let hostHasIt = false;
    const m = mountPage([omlx], {
      discover: async (id) => listing(id, ANTHROPIC_IDS, { isLocal: false, hasKey: true, keySource: 'env' }),
    });
    m.ai.listEngines.mockImplementation(async () => {
      hostHasIt = true;
      const id = m.host().engines.find((e) => e.kind === 'anthropic')?.id;
      return id ? [{ ...probed(id, false), ok: null, hasKey: true, keySource: 'env' }] : [];
    });
    click(q(m.c, 'nav:add'));
    click(m.c.querySelector('[aria-label="Add Anthropic"]'));
    await settle(0);
    expect(hostHasIt).toBe(true);
    expect(m.ai.discoverModels).toHaveBeenCalledOnce();
    expect(m.c.querySelector('.ai-key-caption')?.textContent).toBe('Key found in ANTHROPIC_API_KEY. Paste a key to use another one.');
  });

  it('a new cloud engine without a key found anywhere waits for the key field', async () => {
    const m = mountPage([omlx]);
    click(q(m.c, 'nav:add'));
    click(m.c.querySelector('[aria-label="Add Anthropic"]'));
    await settle(0);
    expect(m.ai.listEngines).toHaveBeenCalled();
    expect(m.ai.discoverModels).not.toHaveBeenCalled();
  });
});

describe('Allow cloud on the Engines page (F4)', () => {
  it('the cloud cards carry the switch, one line and the privacy card folded', () => {
    const m = mountPage([omlx], { allowCloud: false });
    click(q(m.c, 'nav:add'));
    const cloud = m.c.querySelector('.ai-cards-group[data-family="cloud"]')!;
    const toggle = q<HTMLInputElement>(cloud, 'cards:allow-cloud')!;
    expect(toggle.checked).toBe(false);
    expect(cloud.querySelector('.ai-cloud-access-line')?.textContent).toBe('Text you ask about is sent to the provider over the internet.');
    const details = cloud.querySelector<HTMLDetailsElement>('details.ai-cloud-access-privacy')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('.ai-privacy-summary')?.textContent).toBe('What this means');
    // Every cloud preset's policy, once each.
    expect(details.querySelectorAll('a.ai-privacy-link')).toHaveLength(7);
    // The switch sits above the cards.
    expect(cloud.querySelector('.ai-cloud-access')!.compareDocumentPosition(cloud.querySelector('.ai-cards-grid')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('flipping it edits the draft, and Done saves it with the rest', () => {
    const m = mountPage([omlx], { allowCloud: false });
    click(q(m.c, 'nav:add'));
    const toggle = q<HTMLInputElement>(m.c, 'cards:allow-cloud')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    expect(saved(m).allowCloud).toBe(true);
    expect(patchOf(m)['ai.allowCloud']).toBe(true);
  });

  it('a cloud engine added while it is off says so with a button, not the bare pill', () => {
    const m = mountPage([omlx], { allowCloud: false });
    click(q(m.c, 'nav:add'));
    click(m.c.querySelector('[aria-label="Add Anthropic"]'));
    const head = m.c.querySelector('.ai-detail-head')!;
    expect(head.querySelector('.ai-pill--blocked')).toBeNull();
    expect(head.querySelector('.ai-cloud-off .ai-note-text')?.textContent).toBe('Cloud engines are off, so nothing is sent to Anthropic yet.');
    const id = m.c.querySelector<HTMLElement>('.ai-nav-item.is-selected')!.dataset.engineId!;
    click(q(head, `eng:${id}:allow-cloud`));
    expect(m.c.querySelector('.ai-cloud-off')).toBeNull();
    expect(m.c.querySelector('.ai-detail-head')?.textContent).toContain('Cloud engines are on. Choose Done to save.');
    expect(document.activeElement).toBe(q(m.c, `eng:${id}:star`));
    expect(saved(m).allowCloud).toBe(true);
    expect(patchOf(m)['ai.allowCloud']).toBe(true);
  });

  it('a successful model fetch turns the grey dot into a reached one (F8)', async () => {
    const m = mountPage([claude], { statuses: [{ ...probed('claude', false), ok: null }], discover: async (id) => listing(id, ANTHROPIC_IDS, { isLocal: false, latencyMs: 42 }) });
    expect(m.c.querySelector('.ai-detail-head .ai-status')?.getAttribute('data-state')).toBe('unknown');
    type(q<HTMLInputElement>(m.c, 'eng:claude:key'), 'sk-1');
    await settle();
    const badge = m.c.querySelector('.ai-detail-head .ai-status')!;
    expect(badge.getAttribute('data-state')).toBe('ok');
    expect(badge.textContent).toBe('42 ms');
  });
});

describe('key variable caption per host (F10)', () => {
  it('a host without shell variables points at the key file', () => {
    const m = mountPage([claude], { host: { shellEnv: false } });
    click(q(m.c, 'eng:claude:advanced'));
    const row = q(m.c, 'eng:claude:env')!.closest('.ai-sheet-row')!;
    expect(row.querySelector('.ai-caption')?.textContent).toBe('This app does not read shell variables when opened from the Dock; use the key file or paste the key.');
  });

  it('other hosts keep the general caption', () => {
    const m = mountPage([claude]);
    click(q(m.c, 'eng:claude:advanced'));
    const row = q(m.c, 'eng:claude:env')!.closest('.ai-sheet-row')!;
    expect(row.querySelector('.ai-caption')?.textContent).toContain('Used when no key is stored');
  });
});

describe('auto-fetch on a local server', () => {
  it('fetches when the URL settles, and not again for the same address', async () => {
    const m = mountPage([omlx], { discover: async (id) => listing(id, ['qwen']) });
    expect(m.ai.discoverModels).not.toHaveBeenCalled();
    const url = q<HTMLInputElement>(m.c, 'eng:omlx:url');
    type(url, 'http://127.0.0.1:8001/v1');
    // Typing alone does not fetch; the change on blur does.
    await settle(2000);
    expect(m.ai.discoverModels).not.toHaveBeenCalled();
    url!.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(0);
    expect(m.ai.discoverModels).toHaveBeenCalledOnce();
    expect(m.ai.discoverModels).toHaveBeenCalledWith('omlx');

    // Blurring the same address again is not a reason to ask again.
    q<HTMLInputElement>(m.c, 'eng:omlx:url')!.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(0);
    expect(m.ai.discoverModels).toHaveBeenCalledOnce();
  });

  it('fetches on first open of an engine the host never probed', async () => {
    const m = mountPage([omlx], { statuses: [], discover: async (id) => listing(id, ['qwen']) });
    await settle(0);
    expect(m.ai.discoverModels).toHaveBeenCalledOnce();
    expect(m.c.querySelector('[data-model-id="qwen"]')).not.toBeNull();
  });

  it('treats a status with no answer yet as never probed', async () => {
    const m = mountPage([omlx], { statuses: [{ ...probed('omlx'), ok: null }] });
    await settle(0);
    expect(m.ai.discoverModels).toHaveBeenCalledOnce();
  });

  it('does not fetch on open when the engine was probed, nor for a cloud engine', async () => {
    const m = mountPage([omlx, claude], { statuses: [probed('omlx'), { ...probed('claude', false), ok: null }] });
    await settle(5000);
    click(q(m.c, 'nav:eng:claude'));
    await settle(5000);
    expect(m.ai.discoverModels).not.toHaveBeenCalled();
  });

  it('never fetches when the model list is manual', async () => {
    const m = mountPage([{ ...omlx, discovery: 'manual' } as RawEngine], { statuses: [] });
    await settle(0);
    expect(m.ai.discoverModels).not.toHaveBeenCalled();
    expect(q<HTMLButtonElement>(m.c, 'eng:omlx:fetch')!.disabled).toBe(true);
  });
});

describe('no discovery on a plain save', () => {
  it('Done after editing fetches nothing and sends only the changed key', async () => {
    const m = mountPage([omlx, claude]);
    type(q<HTMLInputElement>(m.c, 'eng:omlx:name'), 'oMLX at home');
    click(q(m.c, 'page:done'));
    await settle(5000);
    expect(m.ai.discoverModels).not.toHaveBeenCalled();
    expect(Object.keys(patchOf(m))).toEqual(['ai.engines']);
  });
});

// ── Failures ────────────────────────────────────────────────────────────────

describe('failure states', () => {
  const note = (c: HTMLElement) => c.querySelector<HTMLElement>('.ai-fetch-note');

  it('local unreachable: names the address and the app, offers Retry, and Retry recovers', async () => {
    const m = mountPage([omlx]);
    m.ai.discoverModels
      .mockResolvedValueOnce({ engineId: 'omlx', ok: false, isLocal: true, hasKey: false, error: 'connect ECONNREFUSED 127.0.0.1:8000', models: [] })
      .mockResolvedValueOnce(listing('omlx', ['qwen'], { models: [{ id: 'qwen', capabilities: caps, source: 'endpoint', loaded: true }] }));
    click(q(m.c, 'eng:omlx:fetch'));
    await settle(0);
    expect(note(m.c)?.classList.contains('ai-fetch-note--unreachable')).toBe(true);
    expect(note(m.c)?.getAttribute('role')).toBe('status');
    expect(note(m.c)?.textContent).toContain('Nothing answered at http://127.0.0.1:8000/v1. Is oMLX running?');

    click(q(m.c, 'eng:omlx:retry'));
    await settle(0);
    expect(m.ai.discoverModels).toHaveBeenCalledTimes(2);
    expect(note(m.c)).toBeNull();
    expect(m.c.querySelector('[data-model-id="qwen"]')).not.toBeNull();
  });

  it('names LM Studio, the Custom preset as "the server", and a hand-made engine by its own name', async () => {
    const down = (id: string): AiEngineStatus => ({ engineId: id, ok: false, isLocal: true, hasKey: false, error: 'fetch failed: could not reach the server', models: [] });
    const custom = { id: 'cust', name: 'Custom OpenAI-compatible', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', models: [] as unknown[] };
    const m = mountPage([lms, custom, mine], { discover: async (id) => down(id) });
    click(q(m.c, 'eng:lms:fetch'));
    await settle(0);
    expect(note(m.c)?.textContent).toContain('Nothing answered at http://127.0.0.1:1234/v1. Is LM Studio running?');
    click(q(m.c, 'nav:eng:cust'));
    click(q(m.c, 'eng:cust:fetch'));
    await settle(0);
    expect(note(m.c)?.textContent).toContain('Nothing answered at http://127.0.0.1:8000/v1. Is the server running?');
    click(q(m.c, 'nav:eng:mine'));
    click(q(m.c, 'eng:mine:fetch'));
    await settle(0);
    expect(note(m.c)?.textContent).toContain('Is My server running?');
  });

  it('cloud auth: says which host rejected the key and puts focus back in the key field', async () => {
    const m = mountPage([claude], { discover: async (id) => ({ engineId: id, ok: false, isLocal: false, hasKey: true, error: 'HTTP 401 Unauthorized', models: [] }) });
    type(q<HTMLInputElement>(m.c, 'eng:claude:key'), 'sk-bad');
    await settle();
    expect(note(m.c)?.classList.contains('ai-fetch-note--auth')).toBe(true);
    expect(note(m.c)?.textContent).toContain('Key rejected by api.anthropic.com.');
    const input = q<HTMLInputElement>(m.c, 'eng:claude:key')!;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input);
    // The text stays so it can be corrected.
    expect(input.value).toBe('sk-bad');
  });

  it('auth Retry runs the key fetch again and clears the note on success', async () => {
    const m = mountPage([claude]);
    m.ai.discoverModels
      .mockResolvedValueOnce({ engineId: 'claude', ok: false, isLocal: false, hasKey: true, error: 'invalid x-api-key', models: [] })
      .mockResolvedValueOnce(listing('claude', ANTHROPIC_IDS, { isLocal: false }));
    type(q<HTMLInputElement>(m.c, 'eng:claude:key'), 'sk-bad');
    await settle();
    expect(note(m.c)?.classList.contains('ai-fetch-note--auth')).toBe(true);
    click(q(m.c, 'eng:claude:retry'));
    await settle(0);
    expect(m.ai.discoverModels).toHaveBeenCalledTimes(2);
    expect(note(m.c)).toBeNull();
    expect(q<HTMLInputElement>(m.c, 'eng:claude:key')!.getAttribute('aria-invalid')).toBeNull();
  });

  it('an empty list reads as information, not an error', async () => {
    const m = mountPage([omlx], { discover: async (id) => probed(id) });
    click(q(m.c, 'eng:omlx:fetch'));
    await settle(0);
    expect(note(m.c)?.classList.contains('ai-fetch-note--empty')).toBe(true);
    expect(note(m.c)?.querySelector('.ai-note--info')).not.toBeNull();
    expect(note(m.c)?.textContent).toContain('Server is up but no models are loaded.');
    expect(q(m.c, 'eng:omlx:retry')).not.toBeNull();
  });

  it('a host error reads as "Could not fetch models"', async () => {
    const m = mountPage([omlx]);
    m.ai.discoverModels.mockRejectedValueOnce(new Error('the app had a problem'));
    click(q(m.c, 'eng:omlx:fetch'));
    await settle(0);
    expect(note(m.c)?.textContent).toContain('Could not fetch models: the app had a problem');
  });

  it('a typed id is still accepted while the fetch is failing', async () => {
    const m = mountPage([omlx], { discover: async (id) => ({ engineId: id, ok: false, isLocal: true, hasKey: false, error: 'ECONNREFUSED', models: [] }) });
    click(q(m.c, 'eng:omlx:fetch'));
    await settle(0);
    const pick = q<HTMLInputElement>(m.c, 'eng:omlx:pick')!;
    type(pick, 'qwen3-coder-30b');
    key(pick, 'Enter');
    expect(m.c.querySelector('[data-model-id="qwen3-coder-30b"]')?.textContent).toContain('typed in');
    expect(saved(m).engines[0].models[0]).toMatchObject({ id: 'qwen3-coder-30b', enabled: true, manual: true });
  });
});

// ── Models: typed ids, OPEN-12, Popular, auto-pick ──────────────────────────

describe('typed model ids', () => {
  it('become a manual model with guessed capabilities, enabled', () => {
    const m = mountPage([omlx]);
    const pick = q<HTMLInputElement>(m.c, 'eng:omlx:pick')!;
    type(pick, 'qwen3-coder-30b');
    key(pick, 'Enter');
    const model = saved(m).engines[0].models[0];
    expect(model).toMatchObject({ id: 'qwen3-coder-30b', enabled: true, manual: true, capabilitiesSource: 'heuristic' });
    expect(model.capabilities.chat).toBe(true);
  });

  it('ignore an empty field and re-enable a model that is already listed', () => {
    const m = mountPage([{ ...omlx, models: [modelRow('qwen', { enabled: false })] }]);
    const pick = q<HTMLInputElement>(m.c, 'eng:omlx:pick') ?? (click(q(m.c, 'eng:omlx:type-open')), q<HTMLInputElement>(m.c, 'eng:omlx:pick')!);
    key(pick, 'Enter');
    expect(m.c.querySelector('.ai-option.is-on')).toBeNull();
    type(q<HTMLInputElement>(m.c, 'eng:omlx:pick'), 'qwen');
    key(q(m.c, 'eng:omlx:pick'), 'Enter');
    expect(enabledIds(saved(m), 'omlx')).toEqual(['qwen']);
  });
});

describe('OPEN-12: enabled state after a fetch', () => {
  it('cloud: new models arrive off, except the auto-picked default', async () => {
    const m = mountPage([claude], { discover: async (id) => listing(id, ANTHROPIC_IDS, { isLocal: false }) });
    type(q<HTMLInputElement>(m.c, 'eng:claude:key'), 'sk-x');
    await settle();
    const result = saved(m);
    expect(result.engines[0].models).toHaveLength(ANTHROPIC_IDS.length);
    expect(enabledIds(result, 'claude')).toEqual(['claude-sonnet-5-5']);
    expect(m.c.querySelector('.ai-models-count')?.textContent).toBe('12 models, 1 picked');
  });

  it('cloud: models already picked stay picked across a later fetch', async () => {
    const m = mountPage([{ ...claude, models: [modelRow('claude-opus-5-5')] }], { discover: async (id) => listing(id, ANTHROPIC_IDS, { isLocal: false }) });
    click(q(m.c, 'eng:claude:fetch'));
    await settle(0);
    // Something was already picked, so nothing is auto-picked on top of it.
    expect(enabledIds(saved(m), 'claude')).toEqual(['claude-opus-5-5']);
  });

  it('local, nothing loaded and no sizes: nothing is guessed, the form asks for a pick', async () => {
    const m = mountPage([omlx], { discover: async (id) => listing(id, ['glm-5.3', 'gemma', 'llama']) });
    click(q(m.c, 'eng:omlx:fetch'));
    await settle(0);
    expect(enabledIds(saved(m), 'omlx')).toEqual([]);
    expect(m.c.querySelector('.ai-pick-note')?.textContent).toBe('Pick a model to start with. No chat model is loaded in oMLX, so none was chosen for you.');
    // Picking one clears it.
    click(m.c.querySelector('[data-model-id="gemma"]'));
    expect(m.c.querySelector('.ai-pick-note')).toBeNull();
  });

  it('local, nothing loaded: the largest model whose reported size fits this machine is the default', async () => {
    const GB = 1024 ** 3;
    const sized = (id: string) => {
      const s = listing(id, ['glm-5.3', 'deepseek-v4-flash', 'qwen3.8-27b', 'gemma-4-26b']);
      [439, 175, 16, 15].forEach((gb, i) => { s.models[i].sizeBytes = gb * GB; });
      return s;
    };
    const hardwareInfo = async () => ({ arch: 'arm64', platform: 'darwin', totalMemoryBytes: 64 * GB, appleSilicon: true });
    const m = mountPage([omlx], { discover: async (id) => sized(id), host: { hardwareInfo } });
    await settle(0);
    click(q(m.c, 'eng:omlx:fetch'));
    await settle(0);
    const result = saved(m);
    expect(enabledIds(result, 'omlx')).toEqual(['qwen3.8-27b']);
    // The first engine that can chat becomes the default route.
    expect(result.routing.default).toEqual({ engineId: 'omlx', modelId: 'qwen3.8-27b' });
    expect(m.c.querySelector('.ai-pick-note')).toBeNull();
    // The reported size sets the tag, not the count in the id.
    expect(m.c.querySelector('[data-model-id="deepseek-v4-flash"] .ai-tag--size')?.textContent).toBe('too large');
  });

  it('local: a loaded model further down the list is the default, not the first one', async () => {
    const loadedLater = (id: string) => {
      const s = listing(id, ['glm-5.3', 'minimax-m3', 'qwen3.6-35b-a3b', 'gemma']);
      s.models[2].loaded = true;
      return s;
    };
    const m = mountPage([omlx], { discover: async (id) => loadedLater(id) });
    click(q(m.c, 'eng:omlx:fetch'));
    await settle(0);
    const result = saved(m);
    expect(enabledIds(result, 'omlx')).toEqual(['qwen3.6-35b-a3b']);
    expect(result.routing.default).toEqual({ engineId: 'omlx', modelId: 'qwen3.6-35b-a3b' });
    expect(m.c.querySelector('.ai-models-count')?.textContent).toBe('4 models, 1 picked');
  });
});

describe('Popular group and the auto-picked default', () => {
  it('leads with the newest model per family, matched from the fetched list', async () => {
    const m = mountPage([claude], { discover: async (id) => listing(id, ANTHROPIC_IDS, { isLocal: false }) });
    type(q<HTMLInputElement>(m.c, 'eng:claude:key'), 'sk-x');
    await settle();
    expect(Array.from(m.c.querySelectorAll('.ai-listbox-heading')).map((n) => n.textContent)).toEqual(['Popular', 'All models']);
    const groups = Array.from(m.c.querySelectorAll('.ai-listbox-items'));
    expect(Array.from(groups[0].querySelectorAll<HTMLElement>('.ai-option')).map((n) => n.dataset.modelId)).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5']);
    // The rest is still listed, searchable and unpicked.
    expect(groups[1].querySelectorAll('.ai-option')).toHaveLength(9);
    expect(groups[1].querySelector('[data-model-id="claude-fable-5-1"]')).not.toBeNull();
  });

  it('the first cloud fetch with nothing picked enables the pick and makes it the Default model', async () => {
    const m = mountPage([claude], { discover: async (id) => listing(id, ANTHROPIC_IDS, { isLocal: false }) });
    type(q<HTMLInputElement>(m.c, 'eng:claude:key'), 'sk-x');
    await settle();
    const select = q<HTMLSelectElement>(m.c, 'eng:claude:default-model')!;
    expect(select.value).toBe('claude-sonnet-5-5');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['claude-sonnet-5-5']);
    // No default route existed, so this one becomes it: key = done.
    expect(saved(m).routing.default).toEqual({ engineId: 'claude', modelId: 'claude-sonnet-5-5' });
  });

  it('leaves another engine\'s default route alone', async () => {
    const m = mountPage([omlx, claude], {
      routing: { default: { engineId: 'omlx', modelId: 'qwen' }, fallback: 'none', tasks: {} },
      discover: async (id) => listing(id, ANTHROPIC_IDS, { isLocal: false }),
    });
    click(q(m.c, 'nav:eng:claude'));
    type(q<HTMLInputElement>(m.c, 'eng:claude:key'), 'sk-x');
    await settle();
    const result = saved(m);
    expect(enabledIds(result, 'claude')).toEqual(['claude-sonnet-5-5']);
    expect(result.routing.default).toEqual({ engineId: 'omlx', modelId: 'qwen' });
    expect(patchOf(m)).not.toHaveProperty('ai.routing');
  });
});

describe('picking models', () => {
  const twelve = { ...claude, models: ANTHROPIC_IDS.map((id, i) => modelRow(id, { enabled: i === 0 })) };

  it('picking a chat model sets routing.default when none exists', () => {
    const m = mountPage([{ ...claude, models: [modelRow('claude-sonnet-5-5', { enabled: false })] }]);
    const option = m.c.querySelector<HTMLElement>('[data-model-id="claude-sonnet-5-5"]')!;
    expect(option.getAttribute('aria-selected')).toBe('false');
    click(option);
    expect(m.c.querySelector('[data-model-id="claude-sonnet-5-5"]')!.getAttribute('aria-selected')).toBe('true');
    expect(saved(m).routing.default).toEqual({ engineId: 'claude', modelId: 'claude-sonnet-5-5' });
  });

  it('the count line and Default model follow the picks', () => {
    const m = mountPage([twelve]);
    expect(m.c.querySelector('.ai-models-count')?.textContent).toBe('12 models, 1 picked');
    click(m.c.querySelector('[data-model-id="claude-opus-5-5"]'));
    expect(m.c.querySelector('.ai-models-count')?.textContent).toBe('12 models, 2 picked');
    expect(Array.from(q<HTMLSelectElement>(m.c, 'eng:claude:default-model')!.options).map((o) => o.value)).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5']);
    click(m.c.querySelector('[data-model-id="claude-opus-5-5"]'));
    expect(Array.from(q<HTMLSelectElement>(m.c, 'eng:claude:default-model')!.options).map((o) => o.value)).toEqual(['claude-sonnet-5-5']);
  });
});

// ── Default model and thinking ──────────────────────────────────────────────

describe('Default model', () => {
  const two = (e: RawEngine) => ({ ...e, models: [modelRow('a'), modelRow('b'), modelRow('c', { enabled: false })] });

  it('lists only the enabled models', () => {
    const m = mountPage([two(omlx)]);
    expect(Array.from(q<HTMLSelectElement>(m.c, 'eng:omlx:default-model')!.options).map((o) => o.value)).toEqual(['a', 'b']);
  });

  it('is disabled until a model is picked', () => {
    const m = mountPage([omlx]);
    const select = q<HTMLSelectElement>(m.c, 'eng:omlx:default-model')!;
    expect(select.disabled).toBe(true);
    expect(select.options[0].textContent).toBe('Pick a model above');
  });

  it('writes routing.default when this is the default engine', () => {
    const m = mountPage([two(omlx)], { routing: { default: { engineId: 'omlx', modelId: 'a' }, fallback: 'none', tasks: {} } });
    expect(q<HTMLSelectElement>(m.c, 'eng:omlx:default-model')!.value).toBe('a');
    choose(q(m.c, 'eng:omlx:default-model'), 'b');
    const result = saved(m);
    expect(result.routing.default).toEqual({ engineId: 'omlx', modelId: 'b' });
    expect(Object.keys(patchOf(m)).sort()).toEqual(['ai.engines', 'ai.routing']);
  });

  it('leaves the route alone on any other engine, and only reorders its models', () => {
    const m = mountPage([two(omlx), two(claude)], { routing: { default: { engineId: 'omlx', modelId: 'a' }, fallback: 'none', tasks: {} } });
    click(q(m.c, 'nav:eng:claude'));
    choose(q(m.c, 'eng:claude:default-model'), 'b');
    const result = saved(m);
    expect(result.routing.default).toEqual({ engineId: 'omlx', modelId: 'a' });
    expect(patchOf(m)).not.toHaveProperty('ai.routing');
    // The chosen model goes first, so the star and a routing row pick it.
    expect(result.engines.find((e) => e.id === 'claude')!.models.map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('Thinking level', () => {
  const withModel = (e: RawEngine, over: Record<string, unknown> = {}) => ({ ...e, models: [modelRow('m1', over)] });
  const overrides = (s: AiSettings, engineId: string) => s.engines.find((e) => e.id === engineId)!.models[0].requestOverrides;
  const choices = (m: Mounted, id: string) => Array.from(q<HTMLSelectElement>(m.c, `eng:${id}:thinking`)!.options).map((o) => o.textContent);

  it('Anthropic has Low, Medium and High, no Off, and writes the native fields', () => {
    const m = mountPage([withModel(claude)]);
    expect(choices(m, 'claude')).toEqual(['Default', 'Low', 'Medium', 'High']);
    choose(q(m.c, 'eng:claude:thinking'), 'high');
    const result = saved(m);
    expect(overrides(result, 'claude')).toEqual({ thinking: { type: 'adaptive' }, output_config: { effort: 'high' } });
    expect(thinkingLevelFrom('anthropic', overrides(result, 'claude'))).toBe('high');
  });

  it('round-trips: a saved level is what the next form shows', () => {
    const m = mountPage([withModel(claude, { requestOverrides: { thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } } })]);
    expect(q<HTMLSelectElement>(m.c, 'eng:claude:thinking')!.value).toBe('medium');
    // The Advanced table's column shows the same level.
    click(q(m.c, 'eng:claude:advanced'));
    expect(q<HTMLSelectElement>(m.c, 'model:claude:m1:thinking')!.value).toBe('medium');
  });

  it('keeps unrelated override keys when the level changes or is cleared', () => {
    const m = mountPage([withModel(claude, { requestOverrides: { temperature: 0.2, output_config: { format: 'compact' } } })]);
    choose(q(m.c, 'eng:claude:thinking'), 'low');
    choose(q(m.c, 'eng:claude:thinking'), 'medium');
    expect(overrides(saved(m), 'claude')).toEqual({
      temperature: 0.2,
      thinking: { type: 'adaptive' },
      output_config: { format: 'compact', effort: 'medium' },
    });

    const again = mountPage([withModel(claude, { requestOverrides: { temperature: 0.2, thinking: { type: 'adaptive' }, output_config: { format: 'compact', effort: 'high' } } })]);
    choose(q(again.c, 'eng:claude:thinking'), '');
    expect(overrides(saved(again), 'claude')).toEqual({ temperature: 0.2, output_config: { format: 'compact' } });
  });

  it('a local OpenAI-compatible server gets Off through the chat template, tiers through reasoning_effort', () => {
    const m = mountPage([withModel(omlx)]);
    expect(choices(m, 'omlx')).toEqual(['Default', 'Off', 'Low', 'Medium', 'High']);
    choose(q(m.c, 'eng:omlx:thinking'), 'off');
    const off = saved(m);
    expect(overrides(off, 'omlx')).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    expect(thinkingLevelFrom('openai-compatible', overrides(off, 'omlx'))).toBe('off');

    const tier = mountPage([withModel(omlx, { requestOverrides: { chat_template_kwargs: { enable_thinking: false } } })]);
    expect(q<HTMLSelectElement>(tier.c, 'eng:omlx:thinking')!.value).toBe('off');
    choose(q(tier.c, 'eng:omlx:thinking'), 'high');
    expect(overrides(saved(tier), 'omlx')).toEqual({ reasoning_effort: 'high' });
  });

  it('a cloud OpenAI-compatible server gets Off as reasoning_effort none', () => {
    const m = mountPage([withModel(openrouter)]);
    choose(q(m.c, 'eng:or:thinking'), 'off');
    expect(overrides(saved(m), 'or')).toEqual({ reasoning_effort: 'none' });
  });

  it('LM Studio is On or Off', () => {
    const m = mountPage([withModel(lms)]);
    expect(choices(m, 'lms')).toEqual(['Default', 'Off', 'On']);
    choose(q(m.c, 'eng:lms:thinking'), 'medium');
    expect(overrides(saved(m), 'lms')).toEqual({ reasoning_effort: 'medium' });
  });

  it('applies to the Default model, not the first one', () => {
    const e = { ...omlx, models: [modelRow('a'), modelRow('b', { requestOverrides: { reasoning_effort: 'low' } })] };
    const m = mountPage([e], { routing: { default: { engineId: 'omlx', modelId: 'b' }, fallback: 'none', tasks: {} } });
    expect(q<HTMLSelectElement>(m.c, 'eng:omlx:thinking')!.value).toBe('low');
    choose(q(m.c, 'eng:omlx:thinking'), 'high');
    const result = saved(m);
    expect(result.engines[0].models.find((x) => x.id === 'b')!.requestOverrides).toEqual({ reasoning_effort: 'high' });
    expect(result.engines[0].models.find((x) => x.id === 'a')!.requestOverrides).toBeUndefined();
  });

  it('hides the control for a kind with no known mapping', () => {
    const m = mountPage([withModel({ ...omlx, kind: 'future-kind' } as RawEngine)]);
    expect(q(m.c, 'eng:omlx:thinking')).toBeNull();
    expect(q(m.c, 'eng:omlx:default-model')).not.toBeNull();
  });
});

// ── Combobox ────────────────────────────────────────────────────────────────

describe('models combobox', () => {
  const big = { ...claude, models: ANTHROPIC_IDS.map((id, i) => modelRow(id, { enabled: i === 0 })) };
  const pick = (m: Mounted) => q<HTMLInputElement>(m.c, 'eng:claude:pick')!;
  const active = (m: Mounted) => m.c.querySelector<HTMLElement>('.ai-option.is-active');

  it('is a combobox over a multiselectable listbox, shown for a long list', () => {
    const m = mountPage([big]);
    const input = pick(m);
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    const list = m.c.querySelector<HTMLElement>(`#${input.getAttribute('aria-controls')}`)!;
    expect(list.getAttribute('role')).toBe('listbox');
    expect(list.getAttribute('aria-multiselectable')).toBe('true');
    expect(input.placeholder).toBe('Search 12 models, or type an id');
    expect(m.c.querySelectorAll('[role="option"]')).toHaveLength(12);
  });

  it('a short list has no field until you ask to type an id', () => {
    const m = mountPage([{ ...claude, models: [modelRow('claude-sonnet-5-5')] }]);
    expect(pick(m)).toBeNull();
    const list = q(m.c, 'eng:claude:models')!;
    expect(list.getAttribute('role')).toBe('listbox');
    expect(list.tabIndex).toBe(0);
    click(q(m.c, 'eng:claude:type-open'));
    expect(pick(m)).not.toBeNull();
    expect(document.activeElement).toBe(pick(m));
  });

  it('Up and Down move the highlight through aria-activedescendant, wrapping at the ends', () => {
    const m = mountPage([big]);
    const input = pick(m);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    key(input, 'ArrowDown');
    expect(active(m)?.dataset.modelId).toBe('claude-sonnet-5-5');
    expect(input.getAttribute('aria-activedescendant')).toBe(active(m)!.id);
    key(input, 'ArrowDown');
    expect(active(m)?.dataset.modelId).toBe('claude-opus-5-5');
    key(input, 'ArrowUp');
    key(input, 'ArrowUp');
    // Wrapped to the last row.
    expect(active(m)?.dataset.modelId).toBe('claude-3-haiku-20240307');
    expect(input.getAttribute('aria-activedescendant')).toBe(active(m)!.id);
  });

  it('Enter toggles the highlighted row and keeps focus in the field', () => {
    const m = mountPage([big]);
    const input = pick(m);
    input.focus();
    key(input, 'ArrowDown');
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(m.c.querySelector('[data-model-id="claude-opus-5-5"]')!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(pick(m));
    key(pick(m), 'Enter');
    expect(m.c.querySelector('[data-model-id="claude-opus-5-5"]')!.getAttribute('aria-selected')).toBe('false');
  });

  it('typing filters by id, highlights the first hit and says so when nothing matches', () => {
    const m = mountPage([big]);
    type(pick(m), 'HAIKU');
    expect(optionIds(m.c)).toEqual(['claude-haiku-5-5', 'claude-haiku-4-5-20251001', 'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307']);
    expect(active(m)?.dataset.modelId).toBe('claude-haiku-5-5');
    type(pick(m), 'zzz');
    expect(m.c.querySelectorAll('.ai-option')).toHaveLength(0);
    expect(m.c.querySelector('.ai-listbox-empty')?.textContent).toBe('No model matches “zzz”. Press Enter to add it by id.');
    key(pick(m), 'Enter');
    expect(m.c.querySelector('[data-model-id="zzz"]')?.textContent).toContain('typed in');
  });

  it('Escape clears the filter first and does not close the page; a calm field lets it through', () => {
    const m = mountPage([big]);
    type(pick(m), 'opus');
    key(pick(m), 'Escape');
    expect(pick(m).value).toBe('');
    expect(m.c.querySelectorAll('.ai-option')).toHaveLength(12);
    expect(m.onCancel).not.toHaveBeenCalled();
    // Nothing left to clear: Escape reaches the page, which is Back.
    key(pick(m), 'Escape');
    expect(m.onCancel).toHaveBeenCalledOnce();
  });

  it('loaded models lead on LM Studio and models the server stopped listing go last', () => {
    const e = { ...lms, models: [modelRow('a'), modelRow('b'), modelRow('gone', { missing: true })] };
    const m = mountPage([e], { statuses: [listing('lms', ['a', 'b'], { models: [
      { id: 'a', capabilities: caps, source: 'endpoint', loaded: false },
      { id: 'b', capabilities: caps, source: 'endpoint', loaded: true },
    ] })] });
    expect(optionIds(m.c)).toEqual(['b', 'a', 'gone']);
    expect(m.c.querySelector('[data-model-id="b"] .ai-tag--loaded')).not.toBeNull();
    expect(m.c.querySelector('[data-model-id="gone"]')!.classList.contains('is-missing')).toBe(true);
    expect(m.c.querySelector('[data-model-id="gone"] .ai-tag--missing')?.textContent).toBe('not listed');
  });
});

// ── Quick-start cards ───────────────────────────────────────────────────────

describe('quick-start cards', () => {
  it('come in two labelled groups with the explainer, one card per preset', () => {
    const m = mountPage([omlx]);
    click(q(m.c, 'nav:add'));
    const groups = Array.from(m.c.querySelectorAll('.ai-cards-group'));
    // Cloud first, as in the setup wizard.
    expect(groups.map((g) => g.querySelector('.ai-cards-heading')?.textContent)).toEqual(['Cloud API key', 'Run on this machine']);
    for (const g of groups) {
      expect(g.getAttribute('aria-labelledby')).toBe(g.querySelector('.ai-cards-heading')!.id);
      expect(g.querySelector('.ai-cards-explainer')?.textContent).not.toBe('');
    }
    const names = (g: Element) => Array.from(g.querySelectorAll('.ai-card-name')).map((n) => n.textContent);
    expect(names(groups[1])).toEqual(['oMLX', 'LM Studio', 'Ollama', 'llama.cpp server', 'vLLM', 'Custom OpenAI-compatible']);
    expect(names(groups[0])).toEqual(['Anthropic', 'OpenAI', 'OpenRouter', 'Google Gemini', 'Groq', 'Mistral', 'DeepSeek']);
  });

  it('each card is labelled "Add <name>" and shows its caption', () => {
    const m = mountPage([omlx]);
    click(q(m.c, 'nav:add'));
    const card = m.c.querySelector<HTMLElement>('[aria-label="Add Anthropic"]')!;
    expect(card.querySelector('.ai-card-caption')?.textContent).toBe('Claude models, API key from Anthropic');
    expect(card.querySelector('svg, .ai-glyph')).not.toBeNull();
    expect(m.c.querySelectorAll('.ai-card')).toHaveLength(13);
  });

  it('with no engines the same grid is the empty state', () => {
    const m = mountPage([]);
    expect(m.c.querySelector('.ai-detail-title')?.textContent).toBe('No engines yet');
    expect(m.c.querySelectorAll('.ai-cards-group')).toHaveLength(2);
    expect(m.c.querySelector('.ai-detail-sub')?.textContent).toContain('Two ways to connect');
  });

  it('picking a cloud card focuses its key; a local server card focuses the heading, not its address', () => {
    const m = mountPage([omlx]);
    click(q(m.c, 'nav:add'));
    click(m.c.querySelector('[aria-label="Add Anthropic"]'));
    expect(document.activeElement).toBe(m.c.querySelector('.ai-page-detail input[type="password"]'));
    expect(m.c.querySelector('.ai-detail-title')?.textContent).toBe('Anthropic');
    click(q(m.c, 'nav:add'));
    click(m.c.querySelector('[aria-label="Add LM Studio"]'));
    // A stray keystroke must not wipe the preset address.
    expect(document.activeElement?.classList.contains('ai-detail-title')).toBe(true);
    expect(document.activeElement?.textContent).toBe('LM Studio');
    const url = m.c.querySelector<HTMLInputElement>('[data-fk^="eng:lm-studio"][data-fk$=":url"]')!;
    expect(url.value).toBe('http://127.0.0.1:1234/v1');
  });

  it('a new Custom engine still lands on its address, the first thing to type', () => {
    const m = mountPage([omlx]);
    click(q(m.c, 'nav:add'));
    click(m.c.querySelector('[aria-label="Add Custom OpenAI-compatible"]'));
    const url = document.activeElement as HTMLInputElement;
    expect(url.dataset.fk).toMatch(/:url$/);
  });

  it('a new local engine fetches its models right away, from the preset address', async () => {
    const m = mountPage([omlx], { discover: async (id) => listing(id, ['gemma']) });
    click(q(m.c, 'nav:add'));
    click(m.c.querySelector('[aria-label="Add LM Studio"]'));
    await settle(0);
    expect(m.ai.discoverModels).toHaveBeenCalledOnce();
    expect(m.ai.discoverModels.mock.calls[0][0]).toMatch(/^lm-studio/);
  });
});

// ── Discarding ──────────────────────────────────────────────────────────────

describe('discarding an engine added in this session', () => {
  async function addAnthropicWithKey(m: Mounted): Promise<string> {
    click(q(m.c, 'nav:add'));
    click(m.c.querySelector('[aria-label="Add Anthropic"]'));
    type(m.c.querySelector<HTMLInputElement>('.ai-page-detail input[type="password"]'), 'sk-new');
    await settle();
    return m.ai.setSecret.mock.calls[0][0] as string;
  }

  it('onDiscarded drops the key of an engine the host never saved', async () => {
    const m = mountPage([omlx]);
    const id = await addAnthropicWithKey(m);
    expect(m.ai.setSecret).toHaveBeenCalledWith(id, 'sk-new');
    click(q(m.c, 'page:back'));
    expect(m.c.querySelector('.ai-page-confirm')?.textContent).toContain('Discard changes?');
    click(q(m.c, 'page:discard'));
    expect(m.onCancel).toHaveBeenCalledOnce();
    expect(m.ai.setSecret).toHaveBeenLastCalledWith(id, null);
    expect(m.ai.setSecret).not.toHaveBeenCalledWith('omlx', null);
  });

  it('takes back the engine the fetch saved early, and its key', async () => {
    const m = mountPage([omlx]);
    const id = await addAnthropicWithKey(m);
    // Fetching needed the host to know the engine, so it was saved before Done.
    expect(m.host().engines.map((e) => e.id)).toEqual(['omlx', id]);
    click(q(m.c, 'page:back'));
    click(q(m.c, 'page:discard'));
    expect(m.host().engines.map((e) => e.id)).toEqual(['omlx']);
    expect(m.ai.setSecret).toHaveBeenLastCalledWith(id, null);
  });

  it('closing the page without Done or Back counts as a discard too', async () => {
    const m = mountPage([omlx]);
    const id = await addAnthropicWithKey(m);
    expect(m.host().engines.map((e) => e.id)).toEqual(['omlx', id]);
    m.page.dispose();
    expect(m.host().engines.map((e) => e.id)).toEqual(['omlx']);
    expect(m.ai.setSecret).toHaveBeenLastCalledWith(id, null);
    expect(m.onDone).not.toHaveBeenCalled();
  });

  it('keeps both when Done is chosen', async () => {
    const m = mountPage([omlx], { discover: async (id) => listing(id, ANTHROPIC_IDS, { isLocal: false }) });
    const id = await addAnthropicWithKey(m);
    const result = saved(m);
    expect(result.engines.map((e) => e.id)).toEqual(['omlx', id]);
    expect(m.ai.setSecret).not.toHaveBeenCalledWith(id, null);
    expect(JSON.stringify(m.onDone.mock.calls)).not.toContain('sk-new');
  });
});
