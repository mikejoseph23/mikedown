/**
 * The setup wizard (M1b): the AI Engines page's 'wizard' section, mounted on
 * its own with a fake tier-2 host. Step 1 follows the recommendation (a
 * running server or Copilot leads, else the cloud cards), local sits under
 * Advanced with the hardware line, step 2 connects (the subscription note
 * over a cloud key field, Install links, size groups), step 3 is Done, which
 * turns AI on only with a usable route. Also the pieces M1b-b added around
 * it: the Copilot group on the page, the Copilot privacy card and consent
 * wording, the shared consent-step note, the session's scan cache.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, NoopHost } from '../src/index';
import { AI_ENGINE_PRESETS, AI_LOCAL_SMALL_MACHINE, aiConsentStepNote, aiConsentText, parseAiSettings } from '../src/ai';
import type { AiEngineStatus, AiHardwareInfo, AiHostEngineProbe, AiLocalServerProbe, AiSettings, MikeDownAiHost } from '../src/ai';
import { mountAiEnginesPage } from '../src/ai-engines-page';
import type { AiEnginesPageHandle, AiEnginesPageOptions } from '../src/ai-engines-page';
import { lastSetupScan, scanForSetup } from '../src/ai-local-setup';
import { privacyCard } from '../src/ai-settings-dom';
import { AI_SUBSCRIPTION_NOTE } from '../src/ai-setup-wizard';
import { settingsSectionContext } from '../src/settings-rows';

const GIB = 1024 ** 3;
const MAC_32: AiHardwareInfo = { arch: 'arm64', platform: 'darwin', totalMemoryBytes: 32 * GIB, appleSilicon: true };
const PC_8: AiHardwareInfo = { arch: 'x64', platform: 'win32', totalMemoryBytes: 8 * GIB, appleSilicon: false };

const chat = { chat: true, stream: true, vision: false, json: true, tools: true, fim: false, embed: false, contextTokens: null };
const embed = { ...chat, chat: false, stream: false, embed: true };

function listing(engineId: string, ids: string[], over: Partial<AiEngineStatus> = {}): AiEngineStatus {
  return {
    engineId,
    ok: true,
    isLocal: true,
    hasKey: false,
    models: ids.map((id) => ({ id, capabilities: id.includes('embed') ? embed : chat, source: 'endpoint' as const })),
    ...over,
  };
}

/** Every local candidate answers "not running", except the ones named (with their model counts). */
function servers(running: Record<string, number> = {}) {
  return vi.fn(async (candidates: { presetId: string; baseUrl: string }[]): Promise<AiLocalServerProbe[]> =>
    candidates.map((c) => (c.presetId in running
      ? { presetId: c.presetId, baseUrl: c.baseUrl, ok: true, models: running[c.presetId] }
      : { presetId: c.presetId, baseUrl: c.baseUrl, ok: false })));
}

const copilotProbe = (models: number): AiHostEngineProbe[] => [{ presetId: 'vscodelm', kind: 'vscode-lm', ok: models > 0, models }];

interface Mounted {
  c: HTMLElement;
  page: AiEnginesPageHandle;
  ai: MikeDownAiHost & { discoverModels: ReturnType<typeof vi.fn> };
  onDone: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
}

const containers: HTMLElement[] = [];
const pages: AiEnginesPageHandle[] = [];

function mount(over: {
  host?: Partial<MikeDownAiHost>;
  discover?: (id: string) => Promise<AiEngineStatus>;
  initial?: AiEnginesPageOptions['initial'];
  engines?: unknown[];
  turnOnWhenDone?: boolean;
} = {}): Mounted {
  const settings = parseAiSettings({ enabled: false, allowCloud: false, engines: over.engines ?? [] }, { onWarning: () => {} });
  let hostSettings: AiSettings = settings;
  const ai = {
    complete: vi.fn(),
    listEngines: vi.fn(async (): Promise<AiEngineStatus[]> => []),
    testEngine: vi.fn(),
    discoverModels: vi.fn(over.discover ?? (async (id: string) => listing(id, []))),
    setSecret: vi.fn(async () => {}),
    ...over.host,
  };
  const onDone = vi.fn();
  const onCancel = vi.fn();
  const c = document.createElement('div');
  document.body.appendChild(c);
  containers.push(c);
  const page = mountAiEnginesPage(c, settingsSectionContext(() => {}), {
    ai: ai as unknown as MikeDownAiHost,
    settings,
    statuses: [],
    getHostSettings: () => hostSettings,
    saveNow: (patch) => {
      if (patch['ai.engines']) {hostSettings = { ...hostSettings, engines: parseAiSettings({ engines: patch['ai.engines'] }, { onWarning: () => {} }).engines };}
    },
    waitForSettings: async (accept) => (accept(hostSettings) ? hostSettings : null),
    onStatuses: vi.fn(),
    onDone,
    onCancel,
    initial: over.initial ?? { section: 'wizard' },
    ...(over.turnOnWhenDone !== false ? { turnOnWhenDone: true } : {}),
  });
  pages.push(page);
  return { c, page, ai: ai as unknown as Mounted['ai'], onDone, onCancel };
}

const q = <T extends HTMLElement = HTMLElement>(c: ParentNode, fk: string) => c.querySelector<T>(`[data-fk="${fk}"]`);
const click = (n: Element | null | undefined) => {
  if (!n) {throw new Error('click: no such element');}
  (n as HTMLElement).click();
};
const flush = async (n = 4) => { for (let i = 0; i < n; i++) {await new Promise((r) => setTimeout(r, 0));} };
const text = (n: Element | null | undefined) => n?.textContent ?? '';
const stepLabel = (c: HTMLElement) => c.querySelector('.ai-wizard-steps')?.getAttribute('aria-label');
const title = (c: HTMLElement) => text(c.querySelector('.ai-wizard-title'));
/** The engine the wizard added (ids are generated). */
const addedId = (c: HTMLElement) => c.querySelector<HTMLElement>('.ai-form')!.id.replace('ai-engine-editor-', '');

afterEach(() => {
  while (pages.length) {pages.pop()!.dispose();}
  while (containers.length) {containers.pop()!.remove();}
  vi.restoreAllMocks();
});

describe('setup wizard: step 1 follows the recommendation', () => {
  it('a running server leads, with Connect a cloud provider under it and local under Advanced', async () => {
    const m = mount({ host: { detectLocalServers: servers({ lmstudio: 3 }), hardwareInfo: async () => MAC_32 } });
    expect(text(m.c.querySelector('.ai-page-title'))).toBe('Set up AI');
    expect(stepLabel(m.c)).toBe('Step 1 of 3');
    expect(q(m.c, 'page:done')!.hidden).toBe(true);
    expect(q(m.c, 'page:skip')!.hidden).toBe(false);
    await flush();
    const options = Array.from(m.c.querySelectorAll<HTMLElement>('.ai-wizard-option'));
    expect(options.map((o) => o.dataset.fk)).toEqual(['wiz:use:lmstudio', 'wiz:cloud']);
    expect(options[0].classList.contains('is-lead')).toBe(true);
    expect(text(options[0].querySelector('.ai-wizard-option-name'))).toBe('LM Studio is running on this Mac · 3 models');
    // The provider cards wait behind "Connect a cloud provider".
    expect(m.c.querySelector('[data-fk^="wiz:card:"]')).toBeNull();
    expect(q(m.c, 'wiz:advanced')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('with nothing running, the cloud cards lead with Allow cloud and the privacy card', async () => {
    const m = mount({ host: { detectLocalServers: servers(), hardwareInfo: async () => PC_8 } });
    await flush();
    expect(m.c.querySelector('.ai-wizard-options')).toBeNull();
    expect(q(m.c, 'wiz:allow-cloud')).not.toBeNull();
    expect(m.c.querySelector('.ai-wizard .ai-cloud-access-privacy')).not.toBeNull();
    expect(q(m.c, 'wiz:card:anthropic')).not.toBeNull();
    expect(q(m.c, 'wiz:card:openai')).not.toBeNull();
  });

  it('Advanced holds local with the hardware line', async () => {
    const big = mount({ host: { detectLocalServers: servers(), hardwareInfo: async () => MAC_32 } });
    await flush();
    const panel = big.c.querySelector<HTMLElement>('.ai-wizard-advanced-panel')!;
    expect(panel.hidden).toBe(true);
    click(q(big.c, 'wiz:advanced'));
    expect(big.c.querySelector<HTMLElement>('.ai-wizard-advanced-panel')!.hidden).toBe(false);
    expect(text(big.c.querySelector('.ai-wizard-hardware'))).toBe('Local is an option on this machine: Apple Silicon, 32 GB. Models up to about 30B parameters run well.');

    const small = mount({ host: { detectLocalServers: servers(), hardwareInfo: async () => PC_8 } });
    await flush();
    click(q(small.c, 'wiz:advanced'));
    expect(text(small.c.querySelector('.ai-wizard-hardware'))).toBe(AI_LOCAL_SMALL_MACHINE);
  });

  it('a host that can tell nothing gets the cloud layout at once, with no hardware line', () => {
    const m = mount();
    expect(q(m.c, 'wiz:card:anthropic')).not.toBeNull();
    click(q(m.c, 'wiz:advanced'));
    expect(m.c.querySelector('.ai-wizard-hardware')).toBeNull();
  });
});

describe('setup wizard: GitHub Copilot', () => {
  it('shows only when detectHostEngines reports a model, and leads then', async () => {
    const none = mount({ host: { detectLocalServers: servers() } });
    await flush();
    expect(q(none.c, 'wiz:use:copilot')).toBeNull();

    const zero = mount({ host: { detectHostEngines: async () => copilotProbe(0) } });
    await flush();
    expect(q(zero.c, 'wiz:use:copilot')).toBeNull();

    const yes = mount({ host: { detectLocalServers: servers(), detectHostEngines: async () => copilotProbe(2) } });
    await flush();
    const card = q(yes.c, 'wiz:use:copilot')!;
    expect(card.classList.contains('is-lead')).toBe(true);
    expect(text(card.querySelector('.ai-wizard-option-name'))).toBe('Use GitHub Copilot, no key needed');
    expect(text(card.querySelector('.ai-wizard-option-caption'))).toContain('VS Code also asks for its own permission the first time');
  });

  it('a running server still leads; Copilot is offered under it', async () => {
    const m = mount({ host: { detectLocalServers: servers({ ollama: 1 }), detectHostEngines: async () => copilotProbe(1) } });
    await flush();
    expect(Array.from(m.c.querySelectorAll<HTMLElement>('.ai-wizard-option')).map((o) => [o.dataset.fk, o.classList.contains('is-lead')]))
      .toEqual([['wiz:use:ollama', true], ['wiz:use:copilot', false], ['wiz:cloud', false]]);
  });

  it('one click: picks a default model, turns Allow cloud on, and Done turns AI on', async () => {
    const m = mount({
      host: { detectHostEngines: async () => copilotProbe(2) },
      discover: async (id) => listing(id, ['copilot/gpt-4o', 'copilot/claude-sonnet'], { isLocal: false }),
    });
    await flush();
    click(q(m.c, 'wiz:use:copilot'));
    await flush();
    expect(stepLabel(m.c)).toBe('Step 3 of 3');
    expect(title(m.c)).toBe('AI is ready: GitHub Copilot · copilot/gpt-4o, cloud');
    expect(text(m.c.querySelector('.ai-wizard-privacy'))).toContain('GitHub’s Copilot service');
    click(q(m.c, 'wiz:done'));
    const [patch, saved] = m.onDone.mock.calls[0] as [Record<string, unknown>, AiSettings];
    expect(patch['ai.enabled']).toBe(true);
    expect(patch['ai.allowCloud']).toBe(true);
    const engine = saved.engines[0];
    expect(engine.kind).toBe('vscode-lm');
    expect(saved.routing.default).toEqual({ engineId: engine.id, modelId: 'copilot/gpt-4o' });
  });
});

describe('setup wizard: step 2, cloud', () => {
  it('a provider card opens the key-first form with the subscription note right above the key field', async () => {
    const m = mount({ host: { detectLocalServers: servers() } });
    await flush();
    click(q(m.c, 'wiz:card:anthropic'));
    expect(stepLabel(m.c)).toBe('Step 2 of 3');
    expect(title(m.c)).toBe('Connect a cloud provider');
    // Choosing a cloud provider turns Allow cloud on in the draft (the consent step still asks per engine).
    expect(q<HTMLInputElement>(m.c, 'wiz:allow-cloud')!.checked).toBe(true);
    expect(q(m.c, 'wiz:card:anthropic')!.getAttribute('aria-pressed')).toBe('true');
    const note = m.c.querySelector<HTMLElement>('.ai-wizard-subscription')!;
    expect(text(note.querySelector('.ai-wizard-subscription-text'))).toBe(AI_SUBSCRIPTION_NOTE);
    expect(note.nextElementSibling?.classList.contains('ai-key-row')).toBe(true);
    const anthropic = AI_ENGINE_PRESETS.find((p) => p.id === 'anthropic')!;
    expect(Array.from(note.querySelectorAll('a')).map((a) => [a.textContent, a.getAttribute('href')]))
      .toEqual([['Anthropic API keys', anthropic.keyUrl], ['Pricing', anthropic.pricingUrl]]);
    // Nothing to route to yet: Continue waits.
    expect(q(m.c, 'wiz:continue')!.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows one privacy disclosure on the cloud step: What this means, not the form\'s What is sent too', async () => {
    const m = mount({ host: { detectLocalServers: servers() } });
    await flush();
    click(q(m.c, 'wiz:card:anthropic'));
    const summaries = Array.from(m.c.querySelectorAll('.ai-privacy-summary')).map((n) => n.textContent?.trim());
    expect(summaries).toEqual(['What this means']);
    expect(m.c.querySelector('.ai-form .ai-form-privacy')).toBeNull();
  });

  it('a key, then the models, then Continue; Back walks back through the steps', async () => {
    const m = mount({
      host: { detectLocalServers: servers() },
      discover: async (id) => listing(id, ['claude-haiku-5-5', 'claude-sonnet-5-5'], { isLocal: false, hasKey: true }),
    });
    await flush();
    click(q(m.c, 'wiz:card:anthropic'));
    const id = addedId(m.c);
    const key = q<HTMLInputElement>(m.c, `eng:${id}:key`)!;
    key.value = 'sk-test';
    key.dispatchEvent(new Event('input', { bubbles: true }));
    key.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush(8);
    expect(m.ai.setSecret).toHaveBeenCalledWith(id, 'sk-test');
    expect(q(m.c, 'wiz:continue')!.getAttribute('aria-disabled')).toBeNull();
    click(q(m.c, 'wiz:continue'));
    expect(stepLabel(m.c)).toBe('Step 3 of 3');
    expect(title(m.c)).toBe('AI is ready: Anthropic · claude-sonnet-5-5, cloud');
    expect(q(m.c, 'page:skip')!.hidden).toBe(true);

    click(q(m.c, 'page:back'));
    expect(stepLabel(m.c)).toBe('Step 2 of 3');
    expect(q(m.c, `eng:${id}:key`)).not.toBeNull();
    click(q(m.c, 'page:back'));
    expect(stepLabel(m.c)).toBe('Step 1 of 3');
    // Back from the first step leaves; something changed, so it asks first.
    click(q(m.c, 'page:back'));
    expect(q(m.c, 'page:keep')).not.toBeNull();
    expect(m.onCancel).not.toHaveBeenCalled();
  });

  it('Continue stays put without a chat model, and Skip leaves AI off', async () => {
    const m = mount({
      host: { detectLocalServers: servers() },
      discover: async (id) => listing(id, ['text-embed-3'], { isLocal: false, hasKey: true }),
    });
    await flush();
    click(q(m.c, 'wiz:card:openai'));
    const id = addedId(m.c);
    const key = q<HTMLInputElement>(m.c, `eng:${id}:key`)!;
    key.value = 'sk-test';
    key.dispatchEvent(new Event('input', { bubbles: true }));
    key.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush(8);
    click(q(m.c, 'wiz:continue'));
    expect(stepLabel(m.c)).toBe('Step 2 of 3');
    click(q(m.c, 'page:skip'));
    click(q(m.c, 'page:discard'));
    expect(m.onCancel).toHaveBeenCalledOnce();
    expect(m.onDone).not.toHaveBeenCalled();
  });

  it('switching provider takes back the engine the wizard added for the first one', async () => {
    const m = mount({
      host: { detectLocalServers: servers() },
      discover: async (id) => listing(id, ['gpt-5'], { isLocal: false, hasKey: true }),
    });
    await flush();
    click(q(m.c, 'wiz:card:anthropic'));
    const first = addedId(m.c);
    click(q(m.c, 'wiz:card:openai'));
    expect(q(m.c, 'wiz:card:anthropic')!.getAttribute('aria-pressed')).toBe('false');
    expect(q(m.c, 'wiz:card:openai')!.getAttribute('aria-pressed')).toBe('true');
    const id = addedId(m.c);
    expect(id).not.toBe(first);
    const key = q<HTMLInputElement>(m.c, `eng:${id}:key`)!;
    key.value = 'sk-test';
    key.dispatchEvent(new Event('input', { bubbles: true }));
    key.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush(8);
    click(q(m.c, 'wiz:continue'));
    click(q(m.c, 'wiz:done'));
    const saved = (m.onDone.mock.calls[0] as [unknown, AiSettings])[1];
    expect(saved.engines.map((e) => e.kind)).toEqual(['openai']);
  });
});

describe('setup wizard: step 2, local', () => {
  it('lists the servers, with Install links for the ones not running, and Look again', async () => {
    const m = mount({ host: { detectLocalServers: servers({ ollama: 2 }), hardwareInfo: async () => MAC_32 } });
    await flush();
    click(q(m.c, 'wiz:advanced'));
    click(q(m.c, 'wiz:local'));
    expect(stepLabel(m.c)).toBe('Step 2 of 3');
    const first = m.c.querySelector<HTMLElement>('.ai-wizard-server .ai-card')!;
    expect(first.dataset.fk).toBe('wiz:card:ollama');
    expect(first.dataset.state).toBe('running');
    const lms = q(m.c, 'wiz:card:lmstudio')!.closest('.ai-wizard-server')!;
    const install = lms.querySelector('a')!;
    expect(install.textContent).toBe('Install LM Studio');
    expect(install.getAttribute('href')).toBe(AI_ENGINE_PRESETS.find((p) => p.id === 'lmstudio')!.installUrl);
    expect(text(lms.querySelector('.ai-wizard-install'))).toContain('then come back and choose Look again');
    expect(q(m.c, 'wiz:look-again')).not.toBeNull();
  });

  it('the picker groups a local server\'s models by how they suit this machine', async () => {
    const m = mount({
      host: { detectLocalServers: servers({ lmstudio: 4 }), hardwareInfo: async () => MAC_32 },
      discover: async (id) => listing(id, ['qwen3-8b', 'llama-3.3-70b', 'qwen3-235b-a22b', 'mystery-model']),
    });
    await flush();
    click(q(m.c, 'wiz:advanced'));
    click(q(m.c, 'wiz:local'));
    click(q(m.c, 'wiz:card:lmstudio'));
    await flush(8);
    const groups = Array.from(m.c.querySelectorAll('.ai-listbox-group')).map((g) => [
      text(g.querySelector('.ai-listbox-heading')),
      Array.from(g.querySelectorAll<HTMLElement>('.ai-option')).map((o) => o.dataset.modelId),
    ]);
    expect(groups).toEqual([
      ['Runs well on this machine', ['qwen3-8b']],
      ['Likely too large for this machine', ['llama-3.3-70b', 'qwen3-235b-a22b']],
      ['Size not in the name', ['mystery-model']],
    ]);
    expect(text(m.c.querySelector('[data-model-id="qwen3-8b"] .ai-tag--size'))).toBe('fits');
    // A hint, not a gate: the large ones can be picked, and Continue works with the local default.
    expect(q(m.c, 'wiz:continue')!.getAttribute('aria-disabled')).toBeNull();
  });

  it('the running server\'s one click goes straight to Done, local', async () => {
    const m = mount({
      host: { detectLocalServers: servers({ lmstudio: 2 }), hardwareInfo: async () => MAC_32 },
      discover: async (id) => listing(id, ['text-embed-nomic', 'qwen3-8b']),
    });
    await flush();
    click(q(m.c, 'wiz:use:lmstudio'));
    await flush();
    expect(title(m.c)).toBe('AI is ready: LM Studio · qwen3-8b, local');
    expect(text(m.c.querySelector('.ai-wizard-privacy'))).toBe('A local engine keeps everything on this machine or your network.');
    click(q(m.c, 'wiz:done'));
    const [patch] = m.onDone.mock.calls[0] as [Record<string, unknown>];
    expect(patch['ai.enabled']).toBe(true);
    expect(patch['ai.allowCloud']).toBeUndefined();
  });

  it('a failed one click falls back to the server\'s form with the reason', async () => {
    const m = mount({
      host: { detectLocalServers: servers({ lmstudio: 2 }) },
      discover: async (id) => ({ engineId: id, ok: false, isLocal: true, hasKey: false, models: [], error: 'HTTP 500' }),
    });
    await flush();
    click(q(m.c, 'wiz:use:lmstudio'));
    await flush();
    expect(stepLabel(m.c)).toBe('Step 2 of 3');
    expect(text(m.c.querySelector('.ai-wizard-error'))).toBe('HTTP 500');
    expect(m.c.querySelector('.ai-wizard .ai-form')).not.toBeNull();
  });
});

describe('setup wizard: Done and leaving', () => {
  it('without turnOnWhenDone, Done saves the engine but leaves ai.enabled alone', async () => {
    const m = mount({
      turnOnWhenDone: false,
      host: { detectLocalServers: servers({ ollama: 1 }) },
      discover: async (id) => listing(id, ['llama3.2:3b']),
    });
    await flush();
    click(q(m.c, 'wiz:use:ollama'));
    await flush();
    click(q(m.c, 'wiz:done'));
    const [patch] = m.onDone.mock.calls[0] as [Record<string, unknown>];
    expect('ai.enabled' in patch).toBe(false);
    expect(patch['ai.engines']).toBeDefined();
  });

  it('Fine-tune in AI Engines leaves the wizard for the full page on the engine', async () => {
    const m = mount({
      host: { detectLocalServers: servers({ ollama: 1 }) },
      discover: async (id) => listing(id, ['llama3.2:3b']),
    });
    await flush();
    click(q(m.c, 'wiz:use:ollama'));
    await flush();
    click(q(m.c, 'wiz:open-engine'));
    expect(m.c.querySelector('.ai-wizard')).toBeNull();
    expect(text(m.c.querySelector('.ai-page-title'))).toBe('AI Engines');
    expect(q(m.c, 'page:done')!.hidden).toBe(false);
    expect(m.c.querySelector('.ai-nav-item.is-selected .ai-nav-name')?.textContent).toBe('Ollama');
    // Same session: Done still turns AI on with the route the wizard made.
    click(q(m.c, 'page:done'));
    expect((m.onDone.mock.calls[0] as [Record<string, unknown>])[0]['ai.enabled']).toBe(true);
  });

  it('Escape is Back inside the wizard', async () => {
    const m = mount({ host: { detectLocalServers: servers() } });
    await flush();
    click(q(m.c, 'wiz:card:anthropic'));
    expect(stepLabel(m.c)).toBe('Step 2 of 3');
    m.c.querySelector('.ai-page')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(stepLabel(m.c)).toBe('Step 1 of 3');
  });

  it('a tier-1 host never sees the wizard', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    containers.push(c);
    const settings = parseAiSettings({}, { onWarning: () => {} });
    const page = mountAiEnginesPage(c, settingsSectionContext(() => {}), {
      ai: { complete: vi.fn() } as unknown as MikeDownAiHost,
      settings,
      statuses: [],
      getHostSettings: () => settings,
      waitForSettings: async () => null,
      onStatuses: vi.fn(),
      onDone: vi.fn(),
      onCancel: vi.fn(),
      initial: { section: 'wizard' },
    });
    pages.push(page);
    expect(c.querySelector('.ai-wizard')).toBeNull();
    expect(text(c.querySelector('.ai-page-title'))).toBe('AI Engines');
  });
});

describe('around the wizard', () => {
  it('the page offers GitHub Copilot under Built into VS Code only when the host reports a model', async () => {
    const without = mount({ initial: {}, host: { detectHostEngines: async () => copilotProbe(0) } });
    await flush();
    expect(without.c.querySelector('.ai-cards-group[data-family="host"]')).toBeNull();
    const withIt = mount({ initial: {}, host: { detectHostEngines: async () => copilotProbe(1) } });
    await flush();
    expect(withIt.c.querySelector('.ai-cards-group[data-family="host"] .ai-cards-heading')?.textContent).toBe('Built into VS Code');
    expect(q(withIt.c, 'card:vscodelm')).not.toBeNull();
  });

  it('adding Copilot on the page picks its first chat model as the default', async () => {
    const m = mount({
      initial: {},
      host: { detectHostEngines: async () => copilotProbe(2) },
      discover: async (id) => listing(id, ['copilot/gpt-4.1', 'copilot/o4-mini'], { isLocal: false }),
    });
    await flush();
    click(q(m.c, 'card:vscodelm'));
    await flush(8);
    click(q(m.c, 'page:done'));
    const saved = (m.onDone.mock.calls[0] as [unknown, AiSettings])[1];
    expect(saved.routing.default?.modelId).toBe('copilot/gpt-4.1');
    expect(saved.engines[0].models.filter((x) => x.enabled).map((x) => x.id)).toEqual(['copilot/gpt-4.1']);
  });

  it('the page\'s cloud group uses the shared consent-step sentence', () => {
    const m = mount({ initial: {} });
    expect(text(m.c.querySelector('.ai-cloud-access-privacy .ai-privacy-extra'))).toBe(aiConsentStepNote(false));
  });

  it('the Copilot privacy card has no API key line and points at the plan', () => {
    const copilot = AI_ENGINE_PRESETS.find((p) => p.id === 'vscodelm')!;
    const card = privacyCard(copilot, { hostEngine: true });
    const lines = Array.from(card.querySelectorAll('.ai-privacy-lines li')).map((n) => n.textContent ?? '');
    expect(lines.some((l) => /API key/.test(l))).toBe(false);
    expect(lines[0]).toContain('GitHub’s Copilot service');
    expect(lines[0]).toContain('your Copilot plan');
    expect(card.querySelector('.ai-privacy-link')?.getAttribute('href')).toBe(copilot.policy!.url);
    // The cloud card keeps its key line.
    expect(privacyCard(null).textContent).toContain('API key');
  });

  it('the consent dialog reads naturally for Copilot', () => {
    const body = aiConsentText({ engineName: 'GitHub Copilot', host: 'GitHub Copilot', kind: 'vscode-lm', scopeWord: 'workspace', feature: 'rewrite' }).body;
    expect(body).not.toContain('is a cloud engine at GitHub Copilot');
    expect(body).toContain('GitHub Copilot is a cloud service built into VS Code.');
    expect(body).toContain('VS Code also asks for its own permission');
    // Other kinds are unchanged.
    expect(aiConsentText({ engineName: 'Anthropic', host: 'api.anthropic.com', kind: 'anthropic', scopeWord: 'workspace' }).body)
      .toContain('Anthropic is a cloud engine at api.anthropic.com.');
  });

  it('the scan is kept for the session and the hardware is asked once', async () => {
    const hardwareInfo = vi.fn(async () => MAC_32);
    const ai = { complete: vi.fn(), listEngines: vi.fn(), detectLocalServers: servers({ lmstudio: 1 }), hardwareInfo } as unknown as MikeDownAiHost;
    expect(lastSetupScan(ai)).toBeNull();
    const first = await scanForSetup(ai);
    expect(first.recommendation.path).toBe('runningLocal');
    expect(lastSetupScan(ai)).toBe(first);
    // The first-run panel passes its own probes: nothing is detected again.
    const second = await scanForSetup(ai, undefined, []);
    expect(second.recommendation.path).toBe('cloud');
    expect(lastSetupScan(ai)).toBe(second);
    expect(hardwareInfo).toHaveBeenCalledOnce();
    expect(ai.detectLocalServers).toHaveBeenCalledOnce();
  });

  it('the wizard lays out from the session\'s last scan at once', async () => {
    const host = { detectLocalServers: servers({ lmstudio: 3 }), hardwareInfo: async () => MAC_32 };
    const m = mount({ host });
    await flush();
    // Same host object, opened again: the lead card is there before any new scan lands.
    const c = document.createElement('div');
    document.body.appendChild(c);
    containers.push(c);
    const settings = parseAiSettings({}, { onWarning: () => {} });
    const again = mountAiEnginesPage(c, settingsSectionContext(() => {}), {
      ai: (m.ai as unknown as MikeDownAiHost),
      settings,
      statuses: [],
      getHostSettings: () => settings,
      waitForSettings: async () => null,
      onStatuses: vi.fn(),
      onDone: vi.fn(),
      onCancel: vi.fn(),
      initial: { section: 'wizard' },
    });
    pages.push(again);
    expect(q(c, 'wiz:use:lmstudio')).not.toBeNull();
  });
});

describe('the pending badge for a Copilot engine', () => {
  it('says "Sending to GitHub Copilot", with no address', async () => {
    const CHAT = { chat: true, stream: true, vision: false, json: false, tools: false, fim: false, embed: false, contextTokens: 8192 };
    class AiHost extends NoopHost {
      ai = {
        complete: () => new Promise<never>(() => {}),
        listEngines: async () => [{ engineId: 'cp', ok: true, isLocal: false, hasKey: false, models: [{ id: 'copilot/gpt-4o', capabilities: CHAT, source: 'endpoint' as const }] }],
        requestCloudConsent: async () => true,
      } as unknown as MikeDownAiHost;
    }
    const el = document.createElement('div');
    document.body.appendChild(el);
    containers.push(el);
    const ai = {
      enabled: true,
      allowCloud: true,
      engines: [{ id: 'cp', name: 'GitHub Copilot', kind: 'vscode-lm', baseUrl: '', models: [{ id: 'copilot/gpt-4o', capabilities: CHAT, capabilitiesSource: 'user' }] }],
      routing: { default: { engineId: 'cp', modelId: 'copilot/gpt-4o' }, fallback: 'none', tasks: {} },
    };
    const handle = createMikeDownEditor(el, { host: new AiHost(), initialMarkdown: 'Hello world.\n', hostOwnsShortcuts: true, settings: { ai } as never });
    try {
      // The statuses arrive a moment after mount (a Copilot engine routes only once the host lists it).
      await new Promise((r) => setTimeout(r, 200));
      handle.tiptap.commands.setTextSelection({ from: 1, to: 13 });
      handle.command('aiRewrite');
      const popover = document.querySelector<HTMLElement>('.mikedown-ai-rewrite')!;
      [...popover.querySelectorAll<HTMLButtonElement>('.ai-rw-chip')].find((b) => b.dataset.variant === 'shorter')!.click();
      await flush();
      const title = popover.querySelector<HTMLElement>('.ai-rw-badge')!.title;
      expect(title).toMatch(/^Sending to GitHub Copilot · [^.]+\. Sends /);
      expect(title).not.toContain(' at ');
    } finally {
      handle.destroy();
      document.querySelectorAll('.mikedown-ai-rewrite').forEach((n) => n.remove());
    }
  });
});
