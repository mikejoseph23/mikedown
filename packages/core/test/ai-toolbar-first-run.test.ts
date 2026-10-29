/**
 * The first-run panel with local server detection (M1): its states while a
 * detect promise is pending, found, not found and failed, the labels (tier 1
 * says "Turn on", tier 2 "Set up", a found server "Use LM Studio"), the one
 * click path and what it does when it fails, and the same through the real
 * editor with a fake host. Where "Set up" leads is the wizard's concern
 * (M1b-b), so only that it calls `onTurnOn` is checked here. The rest of the
 * panel (badge, disclaimer, privacy line) is in ai-toolbar.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
import { parseAiSettings, serializeAiSettings } from '../src/ai';
import type { AiEngineStatus, AiLocalServerProbe, AiSettings, MikeDownAiHost } from '../src/ai';
import { AI_DETECT_LOOKING } from '../src/ai-local-setup';
import { AI_FIRST_RUN_NONE, aiDetectFoundText, hideAiFirstRunPanel, showAiFirstRunPanel, type AiFirstRunDetection } from '../src/ai-toolbar';
import { hideToolbarDropdown } from '../src/toolbar-dropdown';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const found = (name = 'LM Studio', presetId = 'lmstudio', models?: number): AiFirstRunDetection => ({ kind: 'found', presetId, name, ...(models === undefined ? {} : { models }) });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('first-run panel states (detect promise)', () => {
  let anchor: HTMLButtonElement;
  const open = (opts: Partial<Parameters<typeof showAiFirstRunPanel>[0]> = {}) => {
    anchor = document.createElement('button');
    document.body.append(anchor);
    const onTurnOn = vi.fn();
    const panel = showAiFirstRunPanel({ anchor, onTurnOn, ...opts }).element;
    const $ = (fk: string) => panel.querySelector<HTMLButtonElement>(`[data-fk="ai-first-run:${fk}"]`)!;
    const status = () => panel.querySelector<HTMLElement>('.ai-first-run-status')!;
    return { panel, onTurnOn, primary: $('turn-on'), other: $('other'), cancel: $('cancel'), status };
  };

  afterEach(() => {
    hideAiFirstRunPanel();
    document.body.replaceChildren();
  });

  it('says it is looking while the promise is pending, with the normal "Set up" button already usable', async () => {
    const d = deferred<AiFirstRunDetection>();
    const p = open({ detect: () => d.promise, onUseLocal: async () => {} });
    expect(p.status().hidden).toBe(false);
    expect(p.status().textContent).toBe(AI_DETECT_LOOKING);
    expect(p.status().getAttribute('role')).toBe('status');
    expect(p.status().getAttribute('aria-live')).toBe('polite');
    expect(p.primary.textContent).toBe('Set up');
    expect(p.other.hidden).toBe(true);
    // Not waiting on the answer: Set up works at once.
    p.primary.click();
    expect(p.onTurnOn).toHaveBeenCalledOnce();
    d.resolve(found());
  });

  it('a found server makes "Use LM Studio" the primary button, with the count and "Set up another way…"', async () => {
    const p = open({ detect: async () => found('LM Studio', 'lmstudio', 3), onUseLocal: async () => {} });
    await tick();
    expect(p.primary.textContent).toBe('Use LM Studio');
    expect(p.other.hidden).toBe(false);
    expect(p.other.textContent).toBe('Set up another way…');
    expect(p.status().textContent).toBe('LM Studio is running on this computer, 3 models.');
    expect(p.status().dataset.state).toBe('found');
    expect(p.status().querySelector('.ai-first-run-dot')).not.toBeNull();
    // "Set up another way…" is the long way, not a second copy of the button.
    p.other.click();
    expect(p.onTurnOn).toHaveBeenCalledOnce();
  });

  it('names the server it found, with one model, no count, or another server', async () => {
    expect(aiDetectFoundText('Ollama', 1)).toBe('Ollama is running on this computer, 1 model.');
    expect(aiDetectFoundText('Ollama')).toBe('Ollama is running on this computer.');
    const p = open({ detect: async () => found('Ollama', 'ollama', 12), onUseLocal: async () => {} });
    await tick();
    expect(p.primary.textContent).toBe('Use Ollama');
  });

  it('none found: the cloud-first line, the plain "Set up" button, no other way', async () => {
    const p = open({ detect: async () => ({ kind: 'none' }), onUseLocal: async () => {} });
    await tick();
    expect(p.status().textContent).toBe(AI_FIRST_RUN_NONE);
    expect(p.status().dataset.state).toBe('none');
    expect(p.primary.textContent).toBe('Set up');
    expect(p.other.hidden).toBe(true);
  });

  it('quiet, a failed detect, or a host with no one-click path: the status line goes away and "Set up" stays', async () => {
    const quiet = open({ detect: async () => ({ kind: 'quiet' }), onUseLocal: async () => {} });
    await tick();
    expect(quiet.status().hidden).toBe(true);
    expect(quiet.primary.textContent).toBe('Set up');
    hideAiFirstRunPanel();

    const failed = open({ detect: async () => { throw new Error('bridge gone'); }, onUseLocal: async () => {} });
    await tick();
    expect(failed.status().hidden).toBe(true);
    expect(failed.primary.textContent).toBe('Set up');
    hideAiFirstRunPanel();

    // Found, but nothing to run it with: the old panel.
    const noHandler = open({ detect: async () => found() });
    await tick();
    expect(noHandler.primary.textContent).toBe('Set up');
    expect(noHandler.other.hidden).toBe(true);
  });

  it('tier 1 says "Turn on" and never looks', () => {
    const detect = vi.fn(async () => found());
    const p = open({ tier: 1, detect, onUseLocal: async () => {} });
    expect(p.primary.textContent).toBe('Turn on');
    expect(p.status().hidden).toBe(true);
    expect(detect).not.toHaveBeenCalled();
  });

  it('without a detect option the panel is the plain one', () => {
    const p = open();
    expect(p.primary.textContent).toBe('Set up');
    expect(p.status().hidden).toBe(true);
  });

  it('an answer that arrives after the panel closed changes nothing', async () => {
    const d = deferred<AiFirstRunDetection>();
    let signal!: AbortSignal;
    const p = open({ detect: (s) => { signal = s; return d.promise; }, onUseLocal: async () => {} });
    p.cancel.click();
    expect(signal.aborted).toBe(true);
    d.resolve(found());
    await tick();
    expect(p.primary.textContent).toBe('Set up');
    expect(p.panel.isConnected).toBe(false);
  });

  it('"Use LM Studio" sets that preset up, shows progress, locks the buttons, then closes', async () => {
    const run = deferred<void>();
    const onUseLocal = vi.fn(() => run.promise);
    const p = open({ detect: async () => found('LM Studio', 'lmstudio', 3), onUseLocal });
    await tick();
    p.primary.click();
    expect(onUseLocal).toHaveBeenCalledExactlyOnceWith('lmstudio');
    expect(p.status().textContent).toBe('Setting up LM Studio…');
    expect(p.status().dataset.state).toBe('working');
    expect([p.primary.disabled, p.other.disabled, p.cancel.disabled]).toEqual([true, true, true]);
    // Escape does not close a setup in progress.
    p.panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(p.panel.isConnected).toBe(true);
    run.resolve();
    await tick();
    expect(p.panel.isConnected).toBe(false);
    expect(p.onTurnOn).not.toHaveBeenCalled();
  });

  it('when the one-click setup fails, the reason shows and the panel is back to "Set up"', async () => {
    const onUseLocal = vi.fn(async () => { throw new Error('LM Studio has no chat model loaded or downloaded yet.'); });
    const p = open({ detect: async () => found(), onUseLocal });
    await tick();
    p.primary.click();
    await tick();
    expect(p.panel.isConnected).toBe(true);
    expect(p.status().dataset.state).toBe('error');
    expect(p.status().textContent).toBe('LM Studio has no chat model loaded or downloaded yet.');
    expect(p.primary.textContent).toBe('Set up');
    expect(p.primary.disabled).toBe(false);
    expect(p.other.hidden).toBe(true);
    expect(p.panel.querySelector<HTMLElement>('.ai-privacy-line')!.hidden).toBe(true);
    expect(document.activeElement).toBe(p.primary);
    // Now "Set up" is the plain long way, not another try at the same server.
    p.primary.click();
    expect(onUseLocal).toHaveBeenCalledOnce();
    expect(p.onTurnOn).toHaveBeenCalledOnce();
  });

  it('a failure with no message still says which server', async () => {
    const p = open({ detect: async () => found('Ollama', 'ollama'), onUseLocal: async () => { throw 'x'; } });
    await tick();
    p.primary.click();
    await tick();
    expect(p.status().textContent).toBe('Ollama could not be set up.');
  });
});

// ── Through the real editor ─────────────────────────────────────────────────

describe('first-run panel in the editor, with a host that finds local servers', () => {
  const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];
  const caps = { chat: true, stream: true, vision: false, json: true, tools: true, fim: false, embed: false, contextTokens: null };

  const PROBES: AiLocalServerProbe[] = [
    { presetId: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', ok: true, models: 2 },
    { presetId: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', ok: false },
  ];

  afterEach(() => {
    hideToolbarDropdown();
    hideAiFirstRunPanel();
    while (mounted.length) {
      const { handle, el } = mounted.pop()!;
      try { handle.destroy(); } catch { /* already destroyed */ }
      el.remove();
    }
    document.querySelectorAll('#mikedown-settings-overlay, #mikedown-ai-page-overlay, .ai-first-run').forEach((n) => n.remove());
  });

  /** A host that echoes saved AI settings back to the editor, as the real ones do. */
  function mountWithHost(opts: { probes?: AiLocalServerProbe[] | (() => Promise<AiLocalServerProbe[]>); discover?: (id: string) => Promise<AiEngineStatus> } = {}) {
    let raw: Record<string, unknown> = serializeAiSettings(parseAiSettings({ enabled: false }, { onWarning: () => {} })) as Record<string, unknown>;
    const saves: Array<Record<string, unknown>> = [];
    let handle!: MikeDownEditorHandle;
    const echo = () => {
      const settings: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) {settings[k.replace(/^ai\./, '')] = v;}
      handle.updateSettings({ ai: parseAiSettings(settings, { onWarning: () => {} }) });
    };
    const discoverModels = vi.fn(opts.discover ?? (async (id: string): Promise<AiEngineStatus> => ({ engineId: id, ok: true, isLocal: true, hasKey: false, models: [{ id: 'gemma-3', capabilities: caps, source: 'endpoint' as const, loaded: true }] })));
    const detectLocalServers = vi.fn(async () => (typeof opts.probes === 'function' ? opts.probes() : opts.probes ?? PROBES));
    const ai = { complete: vi.fn(), listEngines: vi.fn(async () => []), testEngine: vi.fn(), discoverModels, setSecret: vi.fn(async () => {}), detectLocalServers } as unknown as MikeDownAiHost;
    class Host extends NoopHost {
      ai = ai;
      saveSettings = vi.fn((patch: Record<string, unknown>) => {
        saves.push(patch);
        raw = { ...raw, ...patch };
        queueMicrotask(echo);
      });
    }
    const el = document.createElement('div');
    document.body.appendChild(el);
    handle = createMikeDownEditor(el, { host: new Host(), settings: { ai: parseAiSettings({ enabled: false }, { onWarning: () => {} }) } });
    mounted.push({ handle, el });
    const button = el.querySelector<HTMLButtonElement>('button[data-action="ai"]')!;
    const panel = () => document.querySelector<HTMLElement>('.ai-first-run');
    const primary = () => panel()?.querySelector<HTMLButtonElement>('[data-fk="ai-first-run:turn-on"]') ?? null;
    return { saves, discoverModels, detectLocalServers, button, panel, primary };
  }

  it('finds LM Studio when the panel opens and offers "Use LM Studio"', async () => {
    const t = mountWithHost();
    t.button.click();
    expect(t.panel()!.querySelector('.ai-first-run-status')!.textContent).toBe(AI_DETECT_LOOKING);
    await vi.waitFor(() => expect(t.primary()!.textContent).toBe('Use LM Studio'));
    expect(t.panel()!.querySelector('.ai-first-run-status')!.textContent).toBe('LM Studio is running on this computer, 2 models.');
    // Only asked because the user opened the panel, once.
    expect(t.detectLocalServers).toHaveBeenCalledOnce();
    expect(t.saves).toHaveLength(0);
  });

  it('offers "Set up" with the none-found line when nothing answers', async () => {
    const t = mountWithHost({ probes: PROBES.map((p) => ({ ...p, ok: false, models: undefined })) });
    t.button.click();
    await vi.waitFor(() => expect(t.panel()!.querySelector('.ai-first-run-status')!.textContent).toBe(AI_FIRST_RUN_NONE));
    expect(t.primary()!.textContent).toBe('Set up');
  });

  it('stays quiet when the host cannot answer', async () => {
    const failing = mountWithHost({ probes: async () => { throw new Error('no'); } });
    failing.button.click();
    await vi.waitFor(() => expect(failing.panel()!.querySelector<HTMLElement>('.ai-first-run-status')!.hidden).toBe(true));
    expect(failing.primary()!.textContent).toBe('Set up');
  });

  it('"Use LM Studio" saves the engine, then one patch with engines, routing and ai.enabled, and closes the panel', async () => {
    const t = mountWithHost();
    t.button.click();
    await vi.waitFor(() => expect(t.primary()!.textContent).toBe('Use LM Studio'));
    t.primary()!.click();
    await vi.waitFor(() => expect(t.panel()).toBeNull());
    // Early save to fetch (engines only), then the final patch.
    expect(t.saves.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(t.saves[0])).toEqual(['ai.engines']);
    const final = t.saves[t.saves.length - 1];
    expect(Object.keys(final).sort()).toEqual(['ai.enabled', 'ai.engines', 'ai.routing']);
    expect(final['ai.enabled']).toBe(true);
    expect((final['ai.routing'] as { default: { modelId: string } }).default.modelId).toBe('gemma-3');
    expect(t.discoverModels).toHaveBeenCalledOnce();
    // AI is on now: the button opens the menu, not the first-run panel.
    expect(t.button.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('when the fetch fails, the early-saved engine is removed from the host and the panel says why', async () => {
    const t = mountWithHost({ discover: async () => { throw new Error('connection refused'); } });
    t.button.click();
    await vi.waitFor(() => expect(t.primary()!.textContent).toBe('Use LM Studio'));
    t.primary()!.click();
    await vi.waitFor(() => expect(t.panel()!.querySelector('.ai-first-run-status')!.getAttribute('data-state')).toBe('error'));
    expect(t.panel()!.querySelector('.ai-first-run-status')!.textContent).toBe('Could not fetch the models from LM Studio: connection refused');
    expect(t.primary()!.textContent).toBe('Set up');
    const engineSaves = t.saves.filter((s) => 'ai.engines' in s);
    expect(engineSaves).toHaveLength(2);
    expect((engineSaves[0]['ai.engines'] as unknown[])).toHaveLength(1);
    expect((engineSaves[1]['ai.engines'] as unknown[])).toHaveLength(0);
    // AI was never turned on.
    expect(t.saves.some((s) => 'ai.enabled' in s)).toBe(false);
    expect(t.button.getAttribute('aria-haspopup')).toBe('dialog');
  });
});
