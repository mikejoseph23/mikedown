/**
 * The Engines page as the setup surface (T1; M1, M2, B3): the local cards
 * after a detection (Running, Not running, Added, Look again), what Done does
 * when the page was opened by "Set up" (`turnOnWhenDone`), and Discard after a
 * cloud card found its key in a variable (the engine the page saved early is
 * taken back). Own file so the wizard's tests (M1b-b) merge cleanly; the
 * Express form and the Allow cloud row are in ai-express-form.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAiSettings } from '../src/ai';
import type { AiEngineStatus, AiLocalServerProbe, AiSettings, MikeDownAiHost } from '../src/ai';
import { mountAiEnginesPage } from '../src/ai-engines-page';
import type { AiEnginesPageHandle } from '../src/ai-engines-page';
import { settingsSectionContext } from '../src/settings-rows';

const caps = { chat: true, stream: true, vision: false, json: true, tools: true, fim: false, embed: false, contextTokens: null };
const lmsEngine = { id: 'lms', name: 'LM Studio', kind: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', models: [{ id: 'gemma', capabilities: caps }] };
const omlxEngine = { id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', apiKeyEnv: 'OMLX_API_KEY', models: [] as unknown[] };
const route = (engineId: string, modelId: string) => ({ default: { engineId, modelId }, fallback: 'none', tasks: {} });
const NO_ROUTE = { default: null, fallback: 'none', tasks: {} };

const probed = (engineId: string, isLocal = true): AiEngineStatus => ({ engineId, ok: true, isLocal, hasKey: false, models: [] });
const listing = (engineId: string, ids: string[], over: Partial<AiEngineStatus> = {}): AiEngineStatus => ({
  engineId, ok: true, isLocal: true, hasKey: false, models: ids.map((id) => ({ id, capabilities: caps, source: 'endpoint' as const })), ...over,
});

const probe = (presetId: string, baseUrl: string, ok: boolean, models?: number): AiLocalServerProbe => ({ presetId, baseUrl, ok, ...(models === undefined ? {} : { models }) });
/** LM Studio running with 3 models, Ollama with 9, the rest silent. */
const PROBES: AiLocalServerProbe[] = [
  probe('omlx', 'http://127.0.0.1:8000/v1', false),
  probe('lmstudio', 'http://127.0.0.1:1234/v1', true, 3),
  probe('ollama', 'http://127.0.0.1:11434/v1', true, 9),
  probe('llamacpp', 'http://127.0.0.1:8080/v1', false),
  probe('vllm', 'http://127.0.0.1:8000/v1', false),
];

function settingsOf(engines: unknown[], over: { enabled?: boolean; routing?: Record<string, unknown>; allowCloud?: boolean } = {}): AiSettings {
  return parseAiSettings({ enabled: over.enabled ?? false, allowCloud: over.allowCloud ?? true, engines, routing: over.routing ?? NO_ROUTE }, { onWarning: () => {} });
}

interface Mounted {
  c: HTMLElement;
  page: AiEnginesPageHandle;
  ai: Record<'discoverModels' | 'listEngines' | 'setSecret' | 'detectLocalServers', ReturnType<typeof vi.fn>>;
  onDone: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
  host: () => AiSettings;
}

const containers: HTMLElement[] = [];
const pages: AiEnginesPageHandle[] = [];

function mountPage(engines: unknown[], over: {
  enabled?: boolean;
  routing?: Record<string, unknown>;
  turnOnWhenDone?: boolean;
  detect?: ((candidates: unknown) => Promise<AiLocalServerProbe[]>) | null;
  discover?: (id: string) => Promise<AiEngineStatus>;
  listEngines?: () => Promise<AiEngineStatus[]>;
  initial?: { engineId?: string };
} = {}): Mounted {
  const settings = settingsOf(engines, over);
  let hostSettings = settings;
  const ai = {
    complete: vi.fn(),
    listEngines: vi.fn(over.listEngines ?? (async (): Promise<AiEngineStatus[]> => [])),
    testEngine: vi.fn(),
    discoverModels: vi.fn(over.discover ?? (async (id: string) => probed(id))),
    setSecret: vi.fn(async () => {}),
    ...(over.detect === null ? {} : { detectLocalServers: vi.fn(over.detect ?? (async () => PROBES)) }),
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
    statuses: engines.filter((e) => (e as { baseUrl: string }).baseUrl.startsWith('http://')).map((e) => probed((e as { id: string }).id)),
    getHostSettings: () => hostSettings,
    saveNow,
    waitForSettings: async (accept) => (accept(hostSettings) ? hostSettings : null),
    onStatuses: vi.fn(),
    onDone,
    onCancel,
    turnOnWhenDone: over.turnOnWhenDone,
    initial: over.initial,
  });
  pages.push(page);
  return { c, page, ai: ai as Mounted['ai'], onDone, onCancel, host: () => hostSettings };
}

const q = <T extends HTMLElement = HTMLElement>(c: ParentNode, fk: string) => c.querySelector<T>(`[data-fk="${fk}"]`);
const click = (n: Element | null | undefined) => {
  if (!n) {throw new Error('click: no such element');}
  (n as HTMLElement).click();
};
/** Let a detection (and the fetches a click starts) run its course. */
const settle = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
  await vi.advanceTimersByTimeAsync(0);
};
const cardOf = (c: HTMLElement, presetId: string) => c.querySelector<HTMLElement>(`[data-fk="card:${presetId}"]`)!;
const localOrder = (c: HTMLElement) => Array.from(c.querySelectorAll('.ai-cards-group[data-family="local"] .ai-card-name')).map((n) => n.textContent);
const patchOf = (m: Mounted) => m.onDone.mock.calls[m.onDone.mock.calls.length - 1][0] as Record<string, unknown>;
const savedOf = (m: Mounted) => m.onDone.mock.calls[m.onDone.mock.calls.length - 1][1] as AiSettings;

beforeEach(() => { vi.useFakeTimers(); });

afterEach(() => {
  while (pages.length) {pages.pop()!.dispose();}
  while (containers.length) {containers.pop()!.remove();}
  vi.useRealTimers();
});

describe('local cards after a detection (M1)', () => {
  it('shows Running with the model count (leading), Not running, and Added for an engine already set up', async () => {
    const m = mountPage([lmsEngine]);
    click(q(m.c, 'nav:add'));
    await settle();
    expect(m.ai.detectLocalServers).toHaveBeenCalledOnce();
    // The host is asked about every local preset but Custom.
    expect((m.ai.detectLocalServers.mock.calls[0][0] as Array<{ presetId: string }>).map((x) => x.presetId)).toEqual(['omlx', 'lmstudio', 'ollama', 'llamacpp', 'vllm']);

    const ollama = cardOf(m.c, 'ollama');
    expect(ollama.dataset.state).toBe('running');
    expect(ollama.querySelector('.ai-card-state')?.textContent).toBe('Running · 9 models');
    expect(ollama.querySelector('.ai-card-dot')).not.toBeNull();
    expect(ollama.getAttribute('aria-label')).toBe('Add Ollama, running, 9 models');

    const lms = cardOf(m.c, 'lmstudio');
    expect(lms.dataset.state).toBe('added');
    expect(lms.querySelector('.ai-card-state')?.textContent).toBe('Added');
    expect(lms.getAttribute('aria-label')).toBe('LM Studio, added. Open it');

    const omlx = cardOf(m.c, 'omlx');
    expect(omlx.dataset.state).toBe('stopped');
    expect(omlx.querySelector('.ai-card-state')?.textContent).toBe('Not running');
    expect(omlx.querySelector('.ai-card-dot')).toBeNull();

    // Running first, then Not running, the Added card last; Custom was never asked, so it stays at the end.
    expect(localOrder(m.c)).toEqual(['Ollama', 'oMLX', 'llama.cpp server', 'vLLM', 'LM Studio', 'Custom OpenAI-compatible']);
    expect(cardOf(m.c, 'custom').querySelector('.ai-card-state')).toBeNull();
    // Cloud cards are not probed.
    expect(m.c.querySelector('.ai-cards-group[data-family="cloud"] .ai-card-state')).toBeNull();
  });

  it('says it is looking, then announces what it found; the Added card opens the engine instead of adding another', async () => {
    const m = mountPage([lmsEngine]);
    click(q(m.c, 'nav:add'));
    expect(m.c.querySelector('.ai-cards-detect-text')?.textContent).toBe('Looking for local AI servers…');
    expect(q(m.c, 'cards:look-again')!.getAttribute('aria-disabled')).toBe('true');
    await settle(100);
    expect(m.c.querySelector('[aria-live]')?.textContent).toBe('Running on this computer: Ollama, 9 models; LM Studio, 3 models, added.');
    expect(q(m.c, 'cards:look-again')!.hasAttribute('aria-disabled')).toBe(false);
    click(cardOf(m.c, 'lmstudio'));
    expect(m.c.querySelector('.ai-detail-title')?.textContent).toBe('LM Studio');
    expect(m.host().engines).toHaveLength(1);
  });

  it('Look again asks the host again and redraws; it is ignored while a look is running', async () => {
    let answer: AiLocalServerProbe[] = PROBES.map((p) => ({ ...p, ok: false, models: undefined }));
    const m = mountPage([lmsEngine], { detect: async () => answer });
    click(q(m.c, 'nav:add'));
    await settle();
    expect(cardOf(m.c, 'ollama').dataset.state).toBe('stopped');
    expect(m.c.querySelector('.ai-cards-detect-text')?.textContent).toBe('No local AI server found. Start LM Studio, Ollama or oMLX, then choose Look again.');

    answer = PROBES;
    click(q(m.c, 'cards:look-again'));
    expect(m.ai.detectLocalServers).toHaveBeenCalledTimes(2);
    // Clicking while it looks does nothing more.
    click(q(m.c, 'cards:look-again'));
    expect(m.ai.detectLocalServers).toHaveBeenCalledTimes(2);
    await settle();
    expect(cardOf(m.c, 'ollama').dataset.state).toBe('running');
    expect(m.c.querySelector('.ai-cards-detect-text')?.textContent).toBe('');
  });

  it('an engine added from a Running card turns its card into Added', async () => {
    const m = mountPage([lmsEngine]);
    click(q(m.c, 'nav:add'));
    await settle();
    click(cardOf(m.c, 'ollama'));
    click(q(m.c, 'nav:add'));
    await settle();
    expect(cardOf(m.c, 'ollama').dataset.state).toBe('added');
  });

  it('without detectLocalServers the cards are the plain ones: no states, no Look again', async () => {
    const m = mountPage([lmsEngine], { detect: null });
    click(q(m.c, 'nav:add'));
    await settle();
    expect(m.c.querySelector('.ai-card-state')).toBeNull();
    expect(q(m.c, 'cards:look-again')).toBeNull();
    expect(localOrder(m.c)).toEqual(['oMLX', 'LM Studio', 'Ollama', 'llama.cpp server', 'vLLM', 'Custom OpenAI-compatible']);
  });

  it('a detection that fails or answers nothing leaves the plain cards and says nothing false', async () => {
    const m = mountPage([lmsEngine], { detect: async () => { throw new Error('no bridge'); } });
    click(q(m.c, 'nav:add'));
    await settle(100);
    expect(m.c.querySelector('.ai-card-state')).toBeNull();
    expect(m.c.querySelector('.ai-cards-detect-text')?.textContent).toBe('');
    expect(m.c.querySelector('[aria-live]')?.textContent).toBe('Could not look for local AI servers.');
    expect(q(m.c, 'cards:look-again')).not.toBeNull();
  });

  it('the page with no engines opens on the cards and looks at once', async () => {
    const m = mountPage([]);
    await settle();
    expect(m.ai.detectLocalServers).toHaveBeenCalledOnce();
    expect(cardOf(m.c, 'ollama').dataset.state).toBe('running');
  });
});

describe('Done when the page was opened by Set up (B3)', () => {
  it('turns AI on when the result has a usable default route', () => {
    const m = mountPage([lmsEngine], { routing: route('lms', 'gemma'), turnOnWhenDone: true });
    expect(m.c.querySelector('.ai-page-title-note')?.textContent).toBe('AI turns on when you choose Done');
    click(q(m.c, 'page:done'));
    expect(patchOf(m)).toEqual({ 'ai.enabled': true });
    expect(savedOf(m).enabled).toBe(true);
  });

  it('leaves AI off without a usable route, and adds no ai.enabled to the patch', () => {
    for (const routing of [NO_ROUTE, route('lms', 'gone'), route('gone', 'gemma')]) {
      const m = mountPage([lmsEngine], { routing, turnOnWhenDone: true });
      click(q(m.c, 'page:done'));
      expect(patchOf(m)).not.toHaveProperty('ai.enabled');
      expect(savedOf(m).enabled).toBe(false);
    }
    // An enabled engine whose only model is switched off has no usable route either.
    const off = mountPage([{ ...lmsEngine, models: [{ id: 'gemma', enabled: false, capabilities: caps }] }], { routing: route('lms', 'gemma'), turnOnWhenDone: true });
    click(q(off.c, 'page:done'));
    expect(patchOf(off)).not.toHaveProperty('ai.enabled');
  });

  it('does not turn AI on when the page was not opened by Set up, whatever the route', () => {
    const m = mountPage([lmsEngine], { routing: route('lms', 'gemma') });
    expect(m.c.querySelector('.ai-page-title-note')).toBeNull();
    click(q(m.c, 'page:done'));
    expect(patchOf(m)).not.toHaveProperty('ai.enabled');
    expect(savedOf(m).enabled).toBe(false);
  });

  it('does not repeat ai.enabled when AI is already on', () => {
    const m = mountPage([lmsEngine], { enabled: true, routing: route('lms', 'gemma'), turnOnWhenDone: true });
    click(q(m.c, 'page:done'));
    expect(patchOf(m)).not.toHaveProperty('ai.enabled');
  });

  it('a card added and fetched during the session gives a route, so Done turns AI on with engines and routing', async () => {
    const m = mountPage([], { turnOnWhenDone: true, discover: async (id) => listing(id, ['gemma-3']) });
    await settle();
    click(cardOf(m.c, 'lmstudio'));
    await settle();
    click(q(m.c, 'page:done'));
    expect(Object.keys(patchOf(m)).sort()).toEqual(['ai.enabled', 'ai.engines', 'ai.routing']);
    expect(savedOf(m)).toMatchObject({ enabled: true, routing: { default: { modelId: 'gemma-3' } } });
  });

  it('Back leaves AI off and saves nothing', () => {
    const m = mountPage([lmsEngine], { routing: route('lms', 'gemma'), turnOnWhenDone: true });
    click(q(m.c, 'page:back'));
    expect(m.onCancel).toHaveBeenCalledOnce();
    expect(m.onDone).not.toHaveBeenCalled();
  });
});

describe('Discard after a cloud card found its key in a variable (M2 lookUpKey)', () => {
  /** The host reports a key in ANTHROPIC_API_KEY for whichever Anthropic engine the page saved. */
  function mountWithEnvKey(): Mounted {
    const m = mountPage([omlxEngine], { discover: async (id) => listing(id, ['claude-sonnet-5-5'], { isLocal: false, hasKey: true, keySource: 'env' }) });
    m.ai.listEngines.mockImplementation(async () => {
      const id = m.host().engines.find((e) => e.kind === 'anthropic')?.id;
      return id ? [{ ...probed(id, false), ok: null, hasKey: true, keySource: 'env' as const }] : [];
    });
    return m;
  }

  it('the engine is saved early to look the key up and fetch, and Discard removes it again', async () => {
    const m = mountWithEnvKey();
    click(q(m.c, 'nav:add'));
    click(m.c.querySelector('[aria-label="Add Anthropic"]'));
    await settle();
    const id = m.host().engines.find((e) => e.kind === 'anthropic')?.id;
    expect(id).toBeTruthy();
    expect(m.host().engines.map((e) => e.id)).toEqual(['omlx', id]);
    expect(m.ai.discoverModels).toHaveBeenCalledOnce();
    // The key came from the variable, so the page stored nothing.
    expect(m.ai.setSecret).not.toHaveBeenCalled();

    click(q(m.c, 'page:back'));
    click(q(m.c, 'page:discard'));
    expect(m.onCancel).toHaveBeenCalledOnce();
    expect(m.host().engines.map((e) => e.id)).toEqual(['omlx']);
    // No key of ours to drop, and the other engine's is untouched.
    expect(m.ai.setSecret).not.toHaveBeenCalledWith('omlx', null);
  });

  it('closing the page without Done or Back takes it back too, and Done keeps it', async () => {
    const closed = mountWithEnvKey();
    click(q(closed.c, 'nav:add'));
    click(closed.c.querySelector('[aria-label="Add Anthropic"]'));
    await settle();
    expect(closed.host().engines).toHaveLength(2);
    closed.page.dispose();
    expect(closed.host().engines.map((e) => e.id)).toEqual(['omlx']);

    const kept = mountWithEnvKey();
    click(q(kept.c, 'nav:add'));
    click(kept.c.querySelector('[aria-label="Add Anthropic"]'));
    await settle();
    click(q(kept.c, 'page:done'));
    expect(savedOf(kept).engines.map((e) => e.kind)).toEqual(['openai-compatible', 'anthropic']);
    expect(kept.host().engines).toHaveLength(2);
  });
});

describe('the Add engine view', () => {
  const openai = { id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY', models: [] as unknown[] };
  const groupOrder = (c: HTMLElement) => Array.from(c.querySelectorAll('.ai-cards-group')).map((g) => (g as HTMLElement).dataset.family);
  const NONE = PROBES.map((p) => ({ ...p, ok: false, models: undefined }));

  it('leads with the cloud cards while no local server answers', async () => {
    const m = mountPage([openai], { detect: async () => NONE });
    click(q(m.c, 'nav:add'));
    expect(groupOrder(m.c)).toEqual(['cloud', 'local']);
    await settle();
    expect(groupOrder(m.c)).toEqual(['cloud', 'local']);
  });

  it('moves the local group up when a server that is not added is running', async () => {
    const m = mountPage([openai]);
    click(q(m.c, 'nav:add'));
    expect(groupOrder(m.c)).toEqual(['cloud', 'local']);
    await settle();
    expect(groupOrder(m.c)).toEqual(['local', 'cloud']);
  });

  it('marks a cloud card Added when an engine for that provider exists, and opens it', () => {
    const m = mountPage([openai]);
    click(q(m.c, 'nav:add'));
    const card = cardOf(m.c, 'openai');
    expect(card.dataset.state).toBe('added');
    expect(card.querySelector('.ai-card-state')?.textContent).toBe('Added');
    expect(cardOf(m.c, 'anthropic').dataset.state).toBeUndefined();
    click(card);
    expect(m.c.querySelector('.ai-detail-title')?.textContent).toBe('OpenAI');
    expect(m.host().engines).toHaveLength(1);
  });

  it('drops "Nothing is sent until AI is on" once AI is on', () => {
    const off = mountPage([openai], { enabled: false });
    click(q(off.c, 'nav:add'));
    expect(off.c.querySelector('.ai-detail-sub')?.textContent).toContain('Nothing is sent until AI is on.');
    const on = mountPage([openai], { enabled: true });
    click(q(on.c, 'nav:add'));
    expect(on.c.querySelector('.ai-detail-sub')?.textContent).toContain('Two ways to connect');
    expect(on.c.querySelector('.ai-detail-sub')?.textContent).not.toContain('Nothing is sent');
  });
});
