/**
 * AI UI polish (setup plan M5): engine-named errors with "Open <engine>"
 * (F9), the toolbar button's running state (U5), the same AI list for a
 * Copilot route (U1), and the first-run panel's local vs cloud line (U9).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
import { aiErrorCopy, makeAiError, parseAiSettings } from '../src/ai';
import type { AiCompletionRequest, AiCompletionResult, AiEngineStatus, AiSettings, MikeDownAiHost } from '../src/ai';
import { AI_FIRST_RUN_WHERE, hideAiFirstRunPanel, showAiFirstRunPanel } from '../src/ai-toolbar';
import { hideToolbarDropdown } from '../src/toolbar-dropdown';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const CHAT = { chat: true, stream: true, vision: false, json: true, tools: false, fim: false, embed: false, contextTokens: 32768 };

describe('aiErrorCopy with the engine (F9)', () => {
  it('names the engine for unreachable, auth and modelNotFound, and points at it', () => {
    expect(aiErrorCopy('auth', { engine: 'Anthropic' })).toMatchObject({
      title: 'Key rejected',
      message: expect.stringMatching(/^Anthropic refused the API key\./),
      action: 'openEngine',
    });
    expect(aiErrorCopy('unreachable', { engine: 'oMLX' }).message).toMatch(/^oMLX did not answer\./);
    expect(aiErrorCopy('modelNotFound', { engine: 'oMLX' }).action).toBe('openEngine');
  });

  it('stays generic without an engine, and for codes that are not about one engine', () => {
    expect(aiErrorCopy('auth').action).toBe('openSettings');
    expect(aiErrorCopy('rateLimited', { engine: 'oMLX' })).toEqual(aiErrorCopy('rateLimited'));
  });
});

// ── In the editor ───────────────────────────────────────────────────────────

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];
afterEach(() => {
  hideToolbarDropdown();
  hideAiFirstRunPanel();
  for (const { handle, el } of mounted.splice(0)) {
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  document.querySelectorAll('.mikedown-ai-rewrite, #mikedown-settings-overlay, #mikedown-ai-page-overlay').forEach((n) => n.remove());
});

function mount(ai: MikeDownAiHost, settings: AiSettings): { handle: MikeDownEditorHandle; el: HTMLElement } {
  class Host extends NoopHost { ai = ai; }
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host: new Host(), initialMarkdown: 'Hello world.\n', hostOwnsShortcuts: true, settings: { ai: settings } as never });
  mounted.push({ handle, el });
  return { handle, el };
}

function localSettings(): AiSettings {
  return parseAiSettings({
    enabled: true,
    engines: [{ id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', models: [{ id: 'qwen', capabilities: CHAT, capabilitiesSource: 'user' }] }],
    routing: { default: { engineId: 'omlx', modelId: 'qwen' }, fallback: 'none', tasks: {} },
  }, { onWarning: () => {} });
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) {await new Promise((r) => setTimeout(r, 0));}
};
const popover = () => document.querySelector<HTMLElement>('.mikedown-ai-rewrite');
const popoverButton = (label: string) => [...(popover()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent === label);

async function rewriteShorter(handle: MikeDownEditorHandle): Promise<void> {
  handle.tiptap.commands.setTextSelection({ from: 1, to: 13 });
  handle.command('aiRewrite');
  [...popover()!.querySelectorAll<HTMLButtonElement>('.ai-rw-chip')].find((b) => b.dataset.variant === 'shorter')!.click();
  await settle();
}

describe('popover errors open the failing engine (F9)', () => {
  it('auth: the copy names the engine and "Open oMLX" opens the AI Engines page on it', async () => {
    const ai = { complete: vi.fn(async () => { throw makeAiError('auth', 'HTTP 401'); }), listEngines: vi.fn(async () => []) } as unknown as MikeDownAiHost;
    const { handle } = mount(ai, localSettings());
    await settle();
    await rewriteShorter(handle);
    expect(popover()?.dataset.phase).toBe('error');
    expect(popover()?.querySelector('.ai-rw-error-message')?.textContent).toMatch(/^oMLX refused the API key\./);
    const open = popoverButton('Open oMLX')!;
    expect(open.classList.contains('ai-rw-btn--primary')).toBe(true);
    expect(popoverButton('Open AI settings')).toBeUndefined();
    open.click();
    expect(popover()).toBeNull();
    expect(document.querySelector('#mikedown-ai-page-overlay')).not.toBeNull();
    expect(document.querySelector('[data-fk="nav:eng:omlx"]')?.getAttribute('aria-current')).toBe('true');
  });

  it('a code that is not about one engine keeps Open AI settings', async () => {
    const ai = { complete: vi.fn(async () => { throw makeAiError('contextOverflow', 'too long'); }), listEngines: vi.fn(async () => []) } as unknown as MikeDownAiHost;
    const { handle } = mount(ai, localSettings());
    await settle();
    await rewriteShorter(handle);
    expect(popoverButton('Open AI settings')).toBeDefined();
  });
});

describe('toolbar AI button running state (U5)', () => {
  it('pulses while the popover runs a request, and stops when it is done', async () => {
    let finish: (() => void) | null = null;
    const ai = {
      complete: vi.fn((req: AiCompletionRequest, onToken: (d: string) => void) => new Promise<AiCompletionResult>((resolve) => {
        finish = () => {
          onToken('Short.');
          resolve({ text: 'Short.', served: { engineId: 'omlx', engineName: 'oMLX', modelId: 'qwen', isLocal: true }, finishReason: 'stop' });
        };
      })),
      listEngines: vi.fn(async () => []),
    } as unknown as MikeDownAiHost;
    const { handle, el } = mount(ai, localSettings());
    await settle();
    const button = () => el.querySelector<HTMLButtonElement>('button[data-action="ai"]')!;
    expect(button().classList.contains('is-ai-running')).toBe(false);
    await rewriteShorter(handle);
    expect(popover()?.dataset.phase).toBe('running');
    expect(button().classList.contains('is-ai-running')).toBe(true);
    finish!();
    await settle();
    expect(popover()?.dataset.phase).toBe('done');
    expect(button().classList.contains('is-ai-running')).toBe(false);
  });
});

describe('the AI menu with a Copilot route (U1)', () => {
  const copilot = (): AiSettings => parseAiSettings({
    enabled: true,
    allowCloud: true,
    engines: [{ id: 'cp', name: 'GitHub Copilot', kind: 'vscode-lm', baseUrl: '', models: [{ id: 'copilot/gpt-4o', capabilities: CHAT, capabilitiesSource: 'user' }] }],
    routing: { default: { engineId: 'cp', modelId: 'copilot/gpt-4o' }, fallback: 'none', tasks: {} },
  }, { onWarning: () => {} });
  const status: AiEngineStatus = { engineId: 'cp', ok: true, isLocal: false, hasKey: false, models: [] };
  const frame = () => new Promise((r) => setTimeout(r, 40));

  async function openMenu(el: HTMLElement): Promise<HTMLElement[]> {
    el.querySelector<HTMLButtonElement>('button[data-action="ai"]')!.click();
    await frame();
    return [...document.querySelectorAll<HTMLElement>('#toolbar-dropdown .tdd-item')];
  }

  it('a host that does not report Copilot: every entry disabled with the router\'s reason', async () => {
    const ai = { complete: vi.fn(), listEngines: vi.fn(async () => []) } as unknown as MikeDownAiHost;
    const { el } = mount(ai, copilot());
    await settle();
    const items = await openMenu(el);
    const byId = (id: string) => items.find((i) => i.dataset.tddId === id)!;
    for (const id of ['ai-rewrite', 'ai-explain', 'ai-translate', 'ai-summarize', 'ai-titles']) {
      expect(byId(id).getAttribute('aria-disabled'), id).toBe('true');
      expect(byId(id).querySelector('.tdd-item-hint')?.textContent, id).toMatch(/GitHub Copilot uses an engine kind this app does not support/);
    }
  });

  it('a host that reports Copilot: the entries run, and there is no Thinking row (Copilot has no levels)', async () => {
    const ai = { complete: vi.fn(), listEngines: vi.fn(async () => [status]) } as unknown as MikeDownAiHost;
    const { el } = mount(ai, copilot());
    // The statuses arrive after the editor's short debounce.
    await new Promise((r) => setTimeout(r, 200));
    await settle();
    const items = await openMenu(el);
    expect(items.find((i) => i.dataset.tddId === 'ai-translate')!.getAttribute('aria-disabled')).not.toBe('true');
    expect(items.find((i) => i.dataset.tddId === 'ai-summarize')!.getAttribute('aria-disabled')).not.toBe('true');
    expect(document.querySelector('#toolbar-dropdown .tdd-seg[data-tdd-id="ai-thinking"]')).toBeNull();
  });
});

describe('first-run panel: local vs cloud (U9)', () => {
  it('says it in one line under the disclaimer, and gives way to the privacy line when a server is found', async () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    let found!: (r: { kind: 'found'; presetId: string; name: string }) => void;
    const handle = showAiFirstRunPanel({
      anchor,
      onTurnOn: vi.fn(),
      detect: () => new Promise((resolve) => { found = resolve; }),
      onUseLocal: vi.fn(async () => {}),
    });
    const where = handle.element.querySelector<HTMLElement>('.ai-first-run-where')!;
    expect(where.textContent).toBe(AI_FIRST_RUN_WHERE);
    expect(where.hidden).toBe(false);
    expect(where.previousElementSibling?.classList.contains('ai-disclaimer')).toBe(true);
    found({ kind: 'found', presetId: 'lmstudio', name: 'LM Studio' });
    await settle();
    expect(where.hidden).toBe(true);
    expect(handle.element.querySelector<HTMLElement>('.ai-privacy-line')!.hidden).toBe(false);
    handle.close();
    anchor.remove();
  });
});
