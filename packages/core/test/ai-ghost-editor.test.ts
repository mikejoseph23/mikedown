/**
 * Inline suggestions in the whole editor: the feature switch installs and
 * removes the plugin, a pause fires one request, a keystroke aborts it, and
 * the places and modes that must stay quiet do. `host.ai` is a fake whose
 * requests the test answers; keys are real `KeyboardEvent`s on the editor DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
import { makeAiError, parseAiSettings } from '../src/ai';
import type { AiCompletionRequest, AiCompletionResult, AiModelCapabilities, AiSettings, MikeDownAiHost } from '../src/ai';
import { aiGhostKey } from '../src/ai-ghost-plugin';
import { isEmojiAutocompleteOpen } from '../src/emojiautocomplete';
import { hideToolbarDropdown } from '../src/toolbar-dropdown';
import { caretAfterText, caretAtEnd, ghostSpans, ghostText, press, typeKey, typeText } from './ghost-test-utils';

const CHAT: AiModelCapabilities = { chat: true, stream: true, vision: false, json: true, tools: false, fim: false, embed: false, contextTokens: 32768 };
const SERVED = { engineId: 'omlx', engineName: 'oMLX', modelId: 'qwen', isLocal: true };

interface Call {
  req: AiCompletionRequest;
  signal: AbortSignal;
  /** Stream a piece, as an engine would. */
  token(delta: string): void;
  finish(text: string): void;
  fail(err: unknown): void;
}

function fakeAi(tier2 = true) {
  const calls: Call[] = [];
  const complete = vi.fn((req: AiCompletionRequest, onToken: (d: string) => void, signal: AbortSignal) =>
    new Promise<AiCompletionResult>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(makeAiError('cancelled')));
      calls.push({
        req,
        signal,
        token: onToken,
        finish: (text) => resolve({ text, served: SERVED, finishReason: 'stop' }),
        fail: reject,
      });
    }));
  const ai = { complete, ...(tier2 ? { listEngines: vi.fn(async () => []) } : {}) } as unknown as MikeDownAiHost;
  return { ai, calls, complete };
}

const LOCAL_ENGINE = { id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', models: [{ id: 'qwen', capabilities: CHAT, capabilitiesSource: 'user' }] };
const CLOUD_ENGINE = { id: 'cloud', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', models: [{ id: 'claude', capabilities: CHAT, capabilitiesSource: 'user' }] };

function aiSettings(ghost: Record<string, unknown> | null = { enabled: true, delayMs: 200 }, over: Record<string, unknown> = {}): AiSettings {
  const engine = over.engine === 'cloud' ? CLOUD_ENGINE : LOCAL_ENGINE;
  return parseAiSettings({
    enabled: true,
    allowCloud: over.engine === 'cloud',
    engines: [engine],
    routing: { default: { engineId: engine.id, modelId: engine.models[0].id }, fallback: 'none', tasks: {} },
    ...(ghost ? { features: { ghostText: ghost } } : {}),
    ...(over.enabled !== undefined ? { enabled: over.enabled } : {}),
  }, { onWarning: () => {} });
}

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

async function boot(ai: MikeDownAiHost, settings: AiSettings, markdown = 'Hello world') {
  class Host extends NoopHost { ai = ai; }
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host: new Host(), initialMarkdown: markdown, settings: { ai: settings } as never });
  mounted.push({ handle, el });
  await settle();
  const view = handle.tiptap.view;
  caretAtEnd(view);
  view.focus();
  return { handle, el, view, editor: handle.tiptap };
}

/** Real timers: let the AI chunk's import and the editor's `then` run. Call before `vi.useFakeTimers()`. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {await new Promise((r) => setTimeout(r, 0));}
}

/** Fake timers: move time and let the request's promises run. */
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

const hasPlugin = (view: { state: Parameters<typeof aiGhostKey.get>[0] }) => !!aiGhostKey.get(view.state);
const toast = () => document.querySelector<HTMLElement>('.mikedown-toast.visible');
const menuItem = (id: string) => document.querySelector<HTMLElement>(`#toolbar-dropdown .tdd-item[data-tdd-id="${id}"]`);

function openAiMenu(el: HTMLElement): void {
  el.querySelector<HTMLButtonElement>('button[data-action="ai"]')!.click();
}

beforeEach(() => {
  // The disclosure and consent copy are not in play; keep other tests' toasts out of the way.
  document.querySelectorAll('.mikedown-toast').forEach((n) => n.remove());
});

afterEach(() => {
  vi.useRealTimers();
  hideToolbarDropdown();
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  document.querySelectorAll('#mikedown-settings-overlay, #mikedown-ai-page-overlay, .ai-first-run').forEach((n) => n.remove());
});

describe('the feature switch', () => {
  it('off: no plugin, no timer, no request', async () => {
    const { ai, complete } = fakeAi();
    const { view } = await boot(ai, aiSettings(null));
    vi.useFakeTimers();
    expect(hasPlugin(view)).toBe(false);
    typeText(view, ' there');
    await advance(10_000);
    expect(complete).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('off in its own row, or with the AI master switch off, is the same', async () => {
    const { ai, complete } = fakeAi();
    const a = await boot(ai, aiSettings({ enabled: false }));
    expect(hasPlugin(a.view)).toBe(false);
    const b = await boot(ai, aiSettings({ enabled: true }, { enabled: false }));
    expect(hasPlugin(b.view)).toBe(false);
    vi.useFakeTimers();
    typeText(b.view, ' there');
    await advance(10_000);
    expect(complete).not.toHaveBeenCalled();
  });

  it('on: the plugin is installed', async () => {
    const { ai } = fakeAi();
    const { view } = await boot(ai, aiSettings());
    expect(hasPlugin(view)).toBe(true);
  });

  it('a settings broadcast installs and removes it; an unrelated one keeps the same plugin', async () => {
    const { ai } = fakeAi();
    const { handle, view } = await boot(ai, aiSettings(null));
    expect(hasPlugin(view)).toBe(false);
    handle.updateSettings({ ai: aiSettings({ enabled: true }) });
    await settle();
    expect(hasPlugin(view)).toBe(true);
    const plugin = aiGhostKey.get(view.state);

    // A different knob, and another AI setting: the session (and its latch) stay.
    handle.updateSettings({ ai: aiSettings({ enabled: true, delayMs: 900 }) });
    await settle();
    expect(aiGhostKey.get(view.state)).toBe(plugin);
    handle.updateSettings({ ai: { ...aiSettings({ enabled: true, delayMs: 900 }), showToolbarButton: false } });
    await settle();
    expect(aiGhostKey.get(view.state)).toBe(plugin);

    handle.updateSettings({ ai: aiSettings({ enabled: false }) });
    await settle();
    expect(hasPlugin(view)).toBe(false);
    handle.updateSettings({ ai: aiSettings({ enabled: true }) });
    await settle();
    expect(hasPlugin(view)).toBe(true);
  });

  it('turning it off clears a showing suggestion and stops the request', async () => {
    const { ai, calls } = fakeAi();
    const { handle, view } = await boot(ai, aiSettings());
    vi.useFakeTimers();
    typeKey(view, '!');
    await advance(200);
    calls[0].token('and more');
    expect(ghostText(view)).toBe('and more');
    handle.updateSettings({ ai: aiSettings({ enabled: false }) });
    expect(ghostSpans(view)).toHaveLength(0);
    expect(calls[0].signal.aborted).toBe(true);
  });

  it('destroy with the timer pending sends nothing', async () => {
    const { ai, complete } = fakeAi();
    const { handle, view } = await boot(ai, aiSettings());
    vi.useFakeTimers();
    typeKey(view, '!');
    handle.destroy();
    await advance(10_000);
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('a pause in typing', () => {
  it('fires one request after the idle delay and streams into the widget', async () => {
    const { ai, calls, complete } = fakeAi();
    const { view, el } = await boot(ai, aiSettings());
    vi.useFakeTimers();
    typeText(view, ', and');
    await advance(199);
    expect(complete).not.toHaveBeenCalled();
    await advance(1);
    expect(complete).toHaveBeenCalledTimes(1);

    const { req } = calls[0];
    expect(req.feature).toBe('ghostText');
    expect(JSON.stringify(req.messages)).toContain('Hello world, and');
    expect(el.querySelector('button[data-action="ai"]')!.classList.contains('is-ai-running')).toBe(true);

    calls[0].token(' then');
    await advance(0);
    expect(ghostText(view)).toBe(' then');
    calls[0].token(' some more');
    await advance(0);
    expect(ghostText(view)).toBe(' then some more');
    // The widget is not content.
    expect(view.state.doc.textContent).toBe('Hello world, and');

    calls[0].finish(' then some more');
    await advance(0);
    expect(ghostText(view)).toBe(' then some more');
    expect(el.querySelector('button[data-action="ai"]')!.classList.contains('is-ai-running')).toBe(false);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('Tab accepts it into the document', async () => {
    const { ai, calls } = fakeAi();
    const { view, handle, editor } = await boot(ai, aiSettings());
    vi.useFakeTimers();
    typeKey(view, '!');
    await advance(200);
    calls[0].token(' Then more.');
    await advance(0);
    expect(press(view, 'Tab').defaultPrevented).toBe(true);
    expect(handle.getMarkdown().trim()).toBe('Hello world! Then more.');
    expect(ghostSpans(view)).toHaveLength(0);
    editor.commands.undo();
    expect(handle.getMarkdown().trim()).toBe('Hello world!');
  });

  it('a keystroke aborts the request in flight and asks again after the next pause', async () => {
    const { ai, calls, complete } = fakeAi();
    const { view } = await boot(ai, aiSettings());
    vi.useFakeTimers();
    typeKey(view, '!');
    await advance(200);
    expect(calls[0].signal.aborted).toBe(false);
    typeKey(view, '?');
    expect(calls[0].signal.aborted).toBe(true);
    await advance(200);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(calls[1].signal.aborted).toBe(false);
    // The aborted one answering late changes nothing.
    calls[0].token(' stale');
    await advance(0);
    expect(ghostSpans(view)).toHaveLength(0);
  });

  it('a keystroke also clears a suggestion that was showing', async () => {
    const { ai, calls } = fakeAi();
    const { view } = await boot(ai, aiSettings());
    vi.useFakeTimers();
    typeKey(view, '!');
    await advance(200);
    calls[0].token('xyz');
    await advance(0);
    expect(ghostText(view)).toBe('xyz');
    typeKey(view, 'q');
    expect(ghostSpans(view)).toHaveLength(0);
  });

  it('undo and a host update trigger no request', async () => {
    const { ai, complete } = fakeAi();
    const { view, handle, editor } = await boot(ai, aiSettings());
    vi.useFakeTimers();
    typeKey(view, '!');
    editor.commands.undo();
    await advance(5000);
    expect(complete).not.toHaveBeenCalled();

    handle.setMarkdown('A document from the host');
    caretAtEnd(view);
    await advance(5000);
    expect(complete).not.toHaveBeenCalled();
  });

  it('an open emoji autocomplete suppresses it', async () => {
    const { ai, complete } = fakeAi();
    const { view } = await boot(ai, aiSettings(), 'Hello');
    vi.useFakeTimers();
    typeText(view, ' :smi');
    expect(isEmojiAutocompleteOpen()).toBe(true);
    await advance(5000);
    expect(complete).not.toHaveBeenCalled();
  });

  it('a tier 1 host (complete only) gets suggestions too', async () => {
    const { ai, complete } = fakeAi(false);
    const { view } = await boot(ai, aiSettings());
    vi.useFakeTimers();
    typeKey(view, '!');
    await advance(200);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('read-only dismisses a suggestion and sends nothing', async () => {
    const { ai, calls, complete } = fakeAi();
    const { view, handle } = await boot(ai, aiSettings());
    vi.useFakeTimers();
    typeKey(view, '!');
    await advance(200);
    calls[0].token('xyz');
    await advance(0);
    handle.setReadOnly(true);
    expect(ghostSpans(view)).toHaveLength(0);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

describe('source mode', () => {
  it('toggling to source clears a showing suggestion and stops the request, and typing in the hidden editor asks for nothing', async () => {
    const { ai, calls, complete } = fakeAi();
    const { view, handle } = await boot(ai, aiSettings());
    vi.useFakeTimers();
    typeKey(view, '!');
    await advance(200);
    calls[0].token('xyz');
    await advance(0);
    expect(ghostText(view)).toBe('xyz');

    handle.command('toggleSource');
    expect(ghostSpans(view)).toHaveLength(0);
    expect(calls[0].signal.aborted).toBe(true);

    typeKey(view, 'q');
    await advance(5000);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('back in rich text it asks again after the next keystroke', async () => {
    const { ai, complete } = fakeAi();
    const { view, handle } = await boot(ai, aiSettings());
    vi.useFakeTimers();
    handle.command('toggleSource');
    handle.command('toggleSource');
    caretAtEnd(view);
    view.focus();
    typeKey(view, '!');
    await advance(200);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('the menu entry says it is not available in source view', async () => {
    const { ai } = fakeAi();
    const { el, handle } = await boot(ai, aiSettings());
    handle.command('toggleSource');
    await settle();
    openAiMenu(el);
    expect(menuItem('ai-continuation')?.getAttribute('aria-disabled')).toBe('true');
    expect(menuItem('ai-continuation')?.textContent).toContain('Not available in source view');
  });
});

describe('what the document reads back while a suggestion shows', () => {
  async function showing(markdown = 'Hello world') {
    const { ai, calls } = fakeAi();
    const rig = await boot(ai, aiSettings(), markdown);
    vi.useFakeTimers();
    typeKey(rig.view, '!');
    await advance(200);
    calls[0].token('ghost words');
    await advance(0);
    expect(ghostText(rig.view)).toBe('ghost words');
    return rig;
  }

  it('getMarkdown and getText do not have it', async () => {
    const { handle, editor } = await showing();
    expect(handle.getMarkdown()).not.toContain('ghost');
    expect(editor.getText()).not.toContain('ghost');
  });

  it('getHtml has no widget, and asking for it dismisses the suggestion', async () => {
    const { handle, view } = await showing();
    const html = handle.getHtml();
    expect(html).not.toContain('mikedown-ghost');
    expect(html).not.toContain('ghost words');
    expect(ghostSpans(view)).toHaveLength(0);
  });

  it('a heading\'s anchor ignores the widget', async () => {
    const { ai, calls } = fakeAi();
    const clipboard = { writeText: vi.fn(async () => {}) };
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
    const { view } = await boot(ai, aiSettings(), '# The Title\n\nBody');
    vi.useFakeTimers();
    caretAfterText(view, 'The Title');
    view.focus();
    typeKey(view, '!');
    await advance(200);
    calls[0].token(' and more words');
    await advance(0);
    const heading = view.dom.querySelector<HTMLElement>('h1')!;
    expect(heading.textContent).toContain('and more words');
    // The click in the left margin copies the heading's link.
    heading.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: -5 }));
    expect(clipboard.writeText).toHaveBeenCalledWith('#the-title');
    expect(ghostSpans(view)).toHaveLength(1);
  });
});

describe('manual trigger', () => {
  it('the aiSuggestContinuation command fires once, with trigger set to manual', async () => {
    const { ai, calls, complete } = fakeAi();
    const { view, handle } = await boot(ai, aiSettings({ enabled: true, trigger: 'manual', delayMs: 200 }));
    vi.useFakeTimers();
    // Manual mode: typing alone asks for nothing.
    typeText(view, ', and');
    await advance(5000);
    expect(complete).not.toHaveBeenCalled();

    handle.command('aiSuggestContinuation');
    await advance(0);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(calls[0].req.messages)).toContain('Hello world, and');
    calls[0].token(' then');
    await advance(0);
    expect(ghostText(view)).toBe(' then');
  });

  it('with the feature off the command only says so', async () => {
    const { ai, complete } = fakeAi();
    const { handle } = await boot(ai, aiSettings({ enabled: false }));
    handle.command('aiSuggestContinuation');
    await settle();
    expect(complete).not.toHaveBeenCalled();
    expect(toast()?.textContent).toMatch(/Inline suggestions is turned off/);
  });

  it('the menu entry fires it too', async () => {
    const { ai, complete } = fakeAi();
    const { el } = await boot(ai, aiSettings({ enabled: true, trigger: 'manual' }));
    openAiMenu(el);
    const item = menuItem('ai-continuation')!;
    expect(item.getAttribute('aria-disabled')).toBeNull();
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await settle();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('the entry is not offered while the feature is off', async () => {
    const { ai } = fakeAi();
    const { el } = await boot(ai, aiSettings({ enabled: false }));
    openAiMenu(el);
    expect(document.querySelector('#toolbar-dropdown')).not.toBeNull();
    expect(menuItem('ai-continuation')).toBeNull();
  });
});

describe('errors', () => {
  it('a failed request shows no toast; the reason is on the menu entry', async () => {
    const { ai, calls } = fakeAi();
    const { view, el } = await boot(ai, aiSettings());
    vi.useFakeTimers();
    typeKey(view, '!');
    await advance(200);
    calls[0].fail(makeAiError('rateLimited', 'oMLX is busy, try again shortly'));
    await advance(0);
    expect(toast()).toBeNull();
    expect(ghostSpans(view)).toHaveLength(0);

    vi.useRealTimers();
    openAiMenu(el);
    const item = menuItem('ai-continuation')!;
    expect(item.getAttribute('aria-disabled')).toBeNull();
    expect(item.querySelector('.tdd-item-hint')?.textContent).toContain('oMLX is busy, try again shortly');
  });

  it('the reason goes away once a suggestion shows again', async () => {
    const { ai, calls } = fakeAi();
    const { view, el } = await boot(ai, aiSettings());
    vi.useFakeTimers();
    typeKey(view, '!');
    await advance(200);
    calls[0].fail(makeAiError('rateLimited', 'down'));
    await advance(0);
    // Backoff doubles the delay.
    typeKey(view, '?');
    await advance(5000);
    calls[1].token('works');
    await advance(0);
    vi.useRealTimers();
    openAiMenu(el);
    expect(menuItem('ai-continuation')!.querySelector('.tdd-item-hint')).toBeNull();
  });
});

describe('Local engines only', () => {
  it('with a cloud route and the default (on) it sends nothing, and the menu says why', async () => {
    const { ai, complete } = fakeAi();
    const { view, el } = await boot(ai, aiSettings({ enabled: true, delayMs: 200 }, { engine: 'cloud' }));
    vi.useFakeTimers();
    typeKey(view, '!');
    await advance(10_000);
    expect(complete).not.toHaveBeenCalled();
    expect(toast()).toBeNull();

    vi.useRealTimers();
    openAiMenu(el);
    const item = menuItem('ai-continuation')!;
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.textContent).toMatch(/local engines only/i);
  });

  it('a manual trigger sends nothing either', async () => {
    const { ai, complete } = fakeAi();
    const { handle } = await boot(ai, aiSettings({ enabled: true }, { engine: 'cloud' }));
    handle.command('aiSuggestContinuation');
    await settle();
    expect(complete).not.toHaveBeenCalled();
  });
});
