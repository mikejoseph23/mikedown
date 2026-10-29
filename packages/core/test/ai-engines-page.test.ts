/**
 * AI Engines page (M3c): `mountAiEnginesPage` on its own, outside the editor,
 * then the overlay host, the summary tab and the entry points in the real
 * editor. The Express form inside the page is tested in ai-express-form.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, NoopHost } from '../src/index';
import type { MikeDownEditorHandle } from '../src/index';
import { parseAiSettings } from '../src/ai';
import type { AiEngineStatus, AiSettings, MikeDownAiHost } from '../src/ai';
import { mountAiEnginesPage } from '../src/ai-engines-page';
import type { AiEnginesPageOptions } from '../src/ai-engines-page';
import { settingsSectionContext } from '../src/settings-rows';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

function settings(): AiSettings {
  return parseAiSettings({
    enabled: true,
    engines: [
      { id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', models: [{ id: 'qwen', capabilities: { chat: true, stream: true } }] },
      { id: 'claude', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', models: [{ id: 'claude-sonnet-5-5' }] },
    ],
    routing: { default: { engineId: 'omlx', modelId: 'qwen' }, fallback: 'anyLocal', tasks: {} },
  }, { onWarning: () => {} });
}

function options(over: Partial<AiEnginesPageOptions> = {}): AiEnginesPageOptions {
  const s = settings();
  const ai = { complete: vi.fn(), listEngines: vi.fn(async () => []), testEngine: vi.fn(), discoverModels: vi.fn(), setSecret: vi.fn(async () => {}) } as unknown as MikeDownAiHost;
  return {
    ai,
    settings: s,
    statuses: [],
    getHostSettings: () => s,
    waitForSettings: async () => null,
    onStatuses: vi.fn(),
    onDone: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
}

const containers: HTMLElement[] = [];
function container(): HTMLElement {
  const c = document.createElement('div');
  document.body.appendChild(c);
  containers.push(c);
  return c;
}
const click = (n: Element | null | undefined) => (n as HTMLElement).click();

afterEach(() => {
  while (containers.length) {containers.pop()!.remove();}
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('mountAiEnginesPage', () => {
  it('renders into its container only, and dispose leaves it empty', () => {
    const c = container();
    const before = document.body.children.length;
    const page = mountAiEnginesPage(c, settingsSectionContext(() => {}), options());
    expect(document.body.children.length).toBe(before);
    expect(c.querySelector('.ai-page-title')?.textContent).toBe('AI Engines');
    expect(Array.from(c.querySelectorAll('.ai-nav-name')).map((n) => n.textContent)).toEqual(['oMLX', 'Anthropic', 'Tasks', 'Add engine']);
    // The first engine is selected and its Express form is open.
    expect(c.querySelector('[data-fk="nav:eng:omlx"]')?.getAttribute('aria-current')).toBe('true');
    expect(c.querySelector('.ai-page-detail .ai-form')).not.toBeNull();
    page.dispose();
    expect(c.childNodes).toHaveLength(0);
  });

  it('Done emits only the changed ai.* keys and the settings they lead to', () => {
    const onDone = vi.fn();
    const c = container();
    mountAiEnginesPage(c, settingsSectionContext(() => {}), options({ onDone }));
    const enabled = c.querySelector<HTMLInputElement>('[data-fk="nav:eng:claude:enabled"]')!;
    enabled.checked = false;
    enabled.dispatchEvent(new Event('change', { bubbles: true }));
    click(c.querySelector('[data-fk="page:done"]'));
    const [patch, saved] = onDone.mock.calls[0] as [Record<string, unknown>, AiSettings];
    expect(Object.keys(patch)).toEqual(['ai.engines']);
    expect(saved.engines.find((e) => e.id === 'claude')?.enabled).toBe(false);
  });

  it('opens on routing when asked, and the routing section edits the draft', () => {
    const onDone = vi.fn();
    const c = container();
    const page = mountAiEnginesPage(c, settingsSectionContext(() => {}), options({ onDone, initial: { section: 'routing' } }));
    expect(c.querySelector('.ai-detail-title')?.textContent).toBe('Tasks');
    page.focus();
    expect(document.activeElement?.getAttribute('data-fk')).toBe('route:default');
    const fallback = c.querySelector<HTMLSelectElement>('[data-fk="route:fallback"]')!;
    fallback.value = 'none';
    fallback.dispatchEvent(new Event('change'));
    click(c.querySelector('[data-fk="page:done"]'));
    expect(onDone.mock.calls[0][0]).toEqual({ 'ai.routing': { default: { engineId: 'omlx', modelId: 'qwen' }, fallback: 'none', tasks: {} } });
  });

  it('goes to one column under 720 px: the list first, Back returns from a pushed detail', () => {
    let resize: ((entries: Array<{ contentRect: { width: number } }>) => void) | null = null;
    const RO = vi.fn(function (this: unknown, cb: typeof resize) { resize = cb; return { observe: vi.fn(), disconnect: vi.fn() }; });
    vi.stubGlobal('ResizeObserver', RO);
    try {
      const onCancel = vi.fn();
      const c = container();
      mountAiEnginesPage(c, settingsSectionContext(() => {}), options({ onCancel }));
      const root = c.querySelector<HTMLElement>('.ai-page')!;
      resize!([{ contentRect: { width: 640 } }]);
      expect(root.classList.contains('is-narrow')).toBe(true);
      expect(root.dataset.view).toBe('list');
      click(c.querySelector('[data-fk="nav:eng:claude"]'));
      expect(root.dataset.view).toBe('detail');
      click(c.querySelector('[data-fk="page:back"]'));
      expect(root.dataset.view).toBe('list');
      expect(onCancel).not.toHaveBeenCalled();
      click(c.querySelector('[data-fk="page:back"]'));
      expect(onCancel).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('mounts into a container outside the document and leaves the document alone', () => {
    const bodyBefore = document.body.innerHTML;
    const headBefore = document.head.innerHTML;
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const bodyWithOpener = document.body.innerHTML;
    // Not attached anywhere: a host can render the page off screen, or in a tab of its own.
    const detached = document.createElement('div');
    const page = mountAiEnginesPage(detached, settingsSectionContext(() => {}), options());
    expect(detached.querySelector('.ai-page')).not.toBeNull();
    expect(document.body.innerHTML).toBe(bodyWithOpener);
    expect(document.head.innerHTML).toBe(headBefore);
    // Mounting does not take focus; the host calls focus() when it wants it.
    expect(document.activeElement).toBe(opener);
    page.dispose();
    expect(detached.childNodes).toHaveLength(0);
    opener.remove();
    expect(document.body.innerHTML).toBe(bodyBefore);
  });

  it('two pages in two containers do not share state', () => {
    const a = container();
    const b = container();
    const onDoneA = vi.fn();
    const onDoneB = vi.fn();
    mountAiEnginesPage(a, settingsSectionContext(() => {}), options({ onDone: onDoneA }));
    mountAiEnginesPage(b, settingsSectionContext(() => {}), options({ onDone: onDoneB }));
    const enabled = a.querySelector<HTMLInputElement>('[data-fk="nav:eng:claude:enabled"]')!;
    enabled.checked = false;
    enabled.dispatchEvent(new Event('change', { bubbles: true }));
    expect(b.querySelector<HTMLInputElement>('[data-fk="nav:eng:claude:enabled"]')!.checked).toBe(true);
    click(a.querySelector('[data-fk="page:done"]'));
    click(b.querySelector('[data-fk="page:done"]'));
    expect(Object.keys(onDoneA.mock.calls[0][0])).toEqual(['ai.engines']);
    expect(onDoneB.mock.calls[0][0]).toEqual({});
  });

  it('dispose stops its timers and drops its listeners', async () => {
    vi.useFakeTimers();
    const onCancel = vi.fn();
    const onDone = vi.fn();
    const c = container();
    const opts = options({ onCancel, onDone, statuses: [{ engineId: 'omlx', ok: true, isLocal: true, hasKey: false, models: [] }] });
    const page = mountAiEnginesPage(c, settingsSectionContext(() => {}), opts);
    const root = c.querySelector('.ai-page')!;
    page.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(c.childNodes).toHaveLength(0);
    // The detached page no longer reacts, and nothing was saved or reported.
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(opts.ai.discoverModels).not.toHaveBeenCalled();
  });

  it('Escape is Back and nothing underneath sees it', () => {
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    try {
      const onCancel = vi.fn();
      const c = container();
      const page = mountAiEnginesPage(c, settingsSectionContext(() => {}), options({ onCancel }));
      page.focus();
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(onCancel).toHaveBeenCalledOnce();
      expect(seen).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', seen);
    }
  });

  it('a clean Back closes; a dirty Back asks first, and Keep editing returns to the page', () => {
    const onCancel = vi.fn();
    const c = container();
    mountAiEnginesPage(c, settingsSectionContext(() => {}), options({ onCancel }));
    const enabled = c.querySelector<HTMLInputElement>('[data-fk="nav:eng:claude:enabled"]')!;
    enabled.checked = false;
    enabled.dispatchEvent(new Event('change', { bubbles: true }));

    click(c.querySelector('[data-fk="page:back"]'));
    expect(onCancel).not.toHaveBeenCalled();
    const sheet = c.querySelector('.ai-page-confirm')!;
    expect(sheet.getAttribute('role')).toBe('alertdialog');
    expect(sheet.textContent).toContain('Discard changes?');
    expect(document.activeElement?.getAttribute('data-fk')).toBe('page:keep');
    // The page behind is inert while the question is open.
    expect((c.querySelector('.ai-page-body') as HTMLElement).inert).toBe(true);

    click(c.querySelector('[data-fk="page:keep"]'));
    expect(c.querySelector('.ai-page-confirm')).toBeNull();
    expect((c.querySelector('.ai-page-body') as HTMLElement).inert).toBe(false);
    expect(document.activeElement?.getAttribute('data-fk')).toBe('page:back');
    expect(c.querySelector<HTMLInputElement>('[data-fk="nav:eng:claude:enabled"]')!.checked).toBe(false);

    // Escape on the question also keeps editing; a second Back asks again and Discard closes.
    click(c.querySelector('[data-fk="page:back"]'));
    c.querySelector('.ai-page')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(c.querySelector('.ai-page-confirm')).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    click(c.querySelector('[data-fk="page:back"]'));
    click(c.querySelector('[data-fk="page:discard"]'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('a clean Back closes without asking', () => {
    const onCancel = vi.fn();
    const c = container();
    mountAiEnginesPage(c, settingsSectionContext(() => {}), options({ onCancel }));
    click(c.querySelector('[data-fk="page:back"]'));
    expect(c.querySelector('.ai-page-confirm')).toBeNull();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('Done with nothing changed sends an empty patch', () => {
    const onDone = vi.fn();
    const c = container();
    mountAiEnginesPage(c, settingsSectionContext(() => {}), options({ onDone }));
    click(c.querySelector('[data-fk="page:done"]'));
    expect(onDone.mock.calls[0][0]).toEqual({});
  });

  it('Done sends engines and routing only when each changed', () => {
    const onDone = vi.fn();
    const c = container();
    mountAiEnginesPage(c, settingsSectionContext(() => {}), options({ onDone }));
    const enabled = c.querySelector<HTMLInputElement>('[data-fk="nav:eng:claude:enabled"]')!;
    enabled.checked = false;
    enabled.dispatchEvent(new Event('change', { bubbles: true }));
    click(c.querySelector('[data-fk="nav:routing"]'));
    const fallback = c.querySelector<HTMLSelectElement>('[data-fk="route:fallback"]')!;
    fallback.value = 'default';
    fallback.dispatchEvent(new Event('change'));
    click(c.querySelector('[data-fk="page:done"]'));
    const [patch] = onDone.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(patch).sort()).toEqual(['ai.engines', 'ai.routing']);
    // Master switch, Allow cloud and features belong to the tab: never in this patch.
    expect(Object.keys(patch).every((k) => k === 'ai.engines' || k === 'ai.routing')).toBe(true);
  });

  it('the routing section edits the default model and a task route, and the list shows the default', () => {
    const onDone = vi.fn();
    const c = container();
    mountAiEnginesPage(c, settingsSectionContext(() => {}), options({ onDone, initial: { section: 'routing' } }));
    const select = (fk: string) => c.querySelector<HTMLSelectElement>(`[data-fk="${fk}"]`)!;
    expect(select('route:default').value).toBe('omlx\u0000qwen');
    // The list entry restates the default route.
    expect(c.querySelector('[data-fk="nav:routing"] .ai-nav-sub')?.textContent).toContain('oMLX');

    const choices = Array.from(select('route:default').options).map((o) => o.textContent);
    // Cloud is pickable while Allow cloud is off, with a note.
    expect(choices.some((t) => t?.startsWith('Anthropic · claude-sonnet-5-5'))).toBe(true);
    select('route:default').value = 'claude\u0000claude-sonnet-5-5';
    select('route:default').dispatchEvent(new Event('change'));
    expect(c.querySelector('[data-fk="nav:routing"] .ai-nav-sub')?.textContent).toContain('Anthropic');
    // A task can take its own route.
    const task = c.querySelector<HTMLSelectElement>('[data-fk^="route:task:"]')!;
    const taskId = task.dataset.fk!.replace('route:task:', '');
    task.value = 'omlx\u0000qwen';
    task.dispatchEvent(new Event('change'));
    click(c.querySelector('[data-fk="page:done"]'));
    const [patch] = onDone.mock.calls[0] as [{ 'ai.routing': { default: unknown; tasks: Record<string, unknown> } }];
    expect(patch['ai.routing'].default).toEqual({ engineId: 'claude', modelId: 'claude-sonnet-5-5' });
    expect(patch['ai.routing'].tasks[taskId]).toEqual({ engineId: 'omlx', modelId: 'qwen' });
  });

  it('under 720 px Escape steps back out of a pushed detail before it closes the page; wide again shows both panes', () => {
    let resize: ((entries: Array<{ contentRect: { width: number } }>) => void) | null = null;
    vi.stubGlobal('ResizeObserver', vi.fn(function (this: unknown, cb: typeof resize) { resize = cb; return { observe: vi.fn(), disconnect: vi.fn() }; }));
    try {
      const onCancel = vi.fn();
      const c = container();
      mountAiEnginesPage(c, settingsSectionContext(() => {}), options({ onCancel }));
      const root = c.querySelector<HTMLElement>('.ai-page')!;
      expect(root.dataset.view).toBe('both');
      resize!([{ contentRect: { width: 640 } }]);
      expect(root.dataset.view).toBe('list');
      click(c.querySelector('[data-fk="nav:routing"]'));
      expect(root.dataset.view).toBe('detail');
      expect(document.activeElement?.classList.contains('ai-detail-title')).toBe(true);
      expect(c.querySelector('[data-fk="page:back"]')?.getAttribute('aria-label')).toBe('Back to the list');
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(root.dataset.view).toBe('list');
      // Focus returns to the entry that was pushed.
      expect(document.activeElement?.getAttribute('data-fk')).toBe('nav:routing');
      expect(onCancel).not.toHaveBeenCalled();
      resize!([{ contentRect: { width: 900 } }]);
      expect(root.classList.contains('is-narrow')).toBe(false);
      expect(root.dataset.view).toBe('both');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('opens straight onto an engine\'s detail when narrow and asked for one', () => {
    vi.stubGlobal('ResizeObserver', vi.fn(function (this: unknown) { return { observe: vi.fn(), disconnect: vi.fn() }; }));
    try {
      const c = container();
      vi.spyOn(c, 'getBoundingClientRect').mockReturnValue({ width: 600 } as DOMRect);
      mountAiEnginesPage(c, settingsSectionContext(() => {}), options({ initial: { engineId: 'claude' } }));
      const root = c.querySelector<HTMLElement>('.ai-page')!;
      expect(root.classList.contains('is-narrow')).toBe(true);
      expect(root.dataset.view).toBe('detail');
      expect(c.querySelector('.ai-detail-title')?.textContent).toBe('Anthropic');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows the status dots from the statuses it was given', () => {
    const statuses: AiEngineStatus[] = [
      { engineId: 'omlx', ok: true, isLocal: true, hasKey: false, models: [] },
      { engineId: 'claude', ok: false, isLocal: false, hasKey: false, error: 'HTTP 401', models: [] },
    ];
    const c = container();
    mountAiEnginesPage(c, settingsSectionContext(() => {}), options({ statuses }));
    const dot = (id: string) => c.querySelector(`[data-fk="nav:eng:${id}"] .ai-status`)?.getAttribute('data-state');
    expect(dot('omlx')).toBe('ok');
    expect(dot('claude')).toBe('error');
  });
});

// ── In the editor: overlay host, summary tab, entry points ──────────────────

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

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

function mountEditor(ai: MikeDownAiHost | undefined, aiSettings?: AiSettings, hostOver: Record<string, unknown> = {}): MikeDownEditorHandle {
  class Host extends NoopHost {}
  const host = Object.assign(new Host(), ai ? { ai } : {}, hostOver);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host, features: { sidebar: true }, settings: aiSettings ? { ai: aiSettings } : undefined });
  mounted.push({ handle, el });
  return handle;
}

afterEach(() => {
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  document.querySelectorAll('#mikedown-settings-overlay, #mikedown-ai-page-overlay').forEach((n) => n.remove());
});

const frame = () => document.querySelector<HTMLElement>('#mikedown-ai-page-overlay .ai-page-frame');
const byText = (selector: string, text: string) => Array.from(document.querySelectorAll<HTMLElement>(selector)).find((n) => n.textContent?.trim() === text);
const escape = () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
const focusables = (scope: HTMLElement) => Array.from(scope.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))
  .filter((n) => !(n as HTMLButtonElement).disabled && !n.closest('[inert], [hidden]'));

describe('the page as a dialog in the editor', () => {
  it('is a modal dialog labelled by its title', () => {
    const handle = mountEditor(tier2(), settings());
    handle.command('openAiSettings', { page: true });
    const dialog = frame()!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = dialog.querySelector('.ai-page-title')!;
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
    expect(title.textContent).toBe('AI Engines');
    // One page at a time: opening again replaces it.
    handle.command('openAiSettings', { page: true });
    expect(document.querySelectorAll('#mikedown-ai-page-overlay')).toHaveLength(1);
  });

  it('traps Tab inside the page, both ways', () => {
    // jsdom has no layout, and the trap skips what has no client rects.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    const handle = mountEditor(tier2(), settings());
    handle.command('openAiSettings', { page: true });
    const dialog = frame()!;
    const list = focusables(dialog);
    expect(list.length).toBeGreaterThan(3);
    const first = list[0];
    const last = list[list.length - 1];
    expect(first.dataset.fk).toBe('page:back');

    last.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    first.dispatchEvent(backward);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);

    // In the middle Tab is left to the browser.
    list[1].focus();
    const middle = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    list[1].dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(false);
  });

  it('puts focus back on the control that opened it, on Back and on Done', () => {
    const handle = mountEditor(tier2(), settings());
    const opener = document.createElement('button');
    opener.textContent = 'Open';
    document.body.appendChild(opener);
    try {
      opener.focus();
      handle.command('openAiSettings', { page: true });
      expect(frame()!.contains(document.activeElement)).toBe(true);
      (document.querySelector('[data-fk="page:back"]') as HTMLElement).click();
      expect(frame()).toBeNull();
      expect(document.activeElement).toBe(opener);

      handle.command('openAiSettings', { page: true });
      (document.querySelector('[data-fk="page:done"]') as HTMLElement).click();
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
    }
  });

  it('Escape closes the page and leaves the Settings modal under it open', () => {
    const handle = mountEditor(tier2(), settings());
    handle.command('openAiSettings');
    const manage = byText('.settings-btn', 'Manage engines…') as HTMLElement;
    manage.focus();
    manage.click();
    expect(frame()).not.toBeNull();
    escape();
    expect(frame()).toBeNull();
    expect(document.querySelector('.settings-modal')).not.toBeNull();
    expect(document.activeElement?.textContent).toBe('Manage engines…');
  });

  it('the host tears the page down without saving when the editor is destroyed', () => {
    const saveSettings = vi.fn();
    const handle = mountEditor(tier2(), settings(), { saveSettings });
    handle.command('openAiSettings', { page: true });
    const enabled = document.querySelector<HTMLInputElement>('[data-fk="nav:eng:claude:enabled"]')!;
    enabled.checked = false;
    enabled.dispatchEvent(new Event('change', { bubbles: true }));
    handle.destroy();
    mounted.pop()!.el.remove();
    expect(frame()).toBeNull();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('closing the Settings modal closes a page opened from it, saving nothing', () => {
    const saveSettings = vi.fn();
    const handle = mountEditor(tier2(), settings(), { saveSettings });
    handle.command('openAiSettings');
    (byText('.settings-btn', 'Manage engines…') as HTMLElement).click();
    expect(frame()).not.toBeNull();
    (document.querySelector('.settings-close') as HTMLElement).click();
    expect(frame()).toBeNull();
    expect(document.querySelector('.settings-modal')).toBeNull();
    expect(saveSettings).not.toHaveBeenCalled();
  });
});

describe('the AI tab as a summary', () => {
  it('shows the default route, a status dot per engine and a switch, and no engine forms', () => {
    const handle = mountEditor(tier2(), settings());
    handle.setAiEngineStatuses([
      { engineId: 'omlx', ok: true, isLocal: true, hasKey: false, models: [] },
      { engineId: 'claude', ok: false, isLocal: false, hasKey: false, error: 'HTTP 401', models: [] },
    ]);
    handle.command('openAiSettings');
    const panel = document.querySelector('.settings-panel--ai')!;
    expect(panel.querySelector('.ai-route-line')?.textContent).toContain('oMLX · qwen');
    const rows = Array.from(panel.querySelectorAll('.ai-engines--compact [role="listitem"]'));
    expect(rows.map((r) => r.querySelector('.ai-engine-name')?.textContent)).toEqual(['oMLX', 'Anthropic']);
    expect(rows.map((r) => r.querySelector('.ai-status')?.getAttribute('data-state'))).toEqual(['ok', 'error']);
    expect(rows.every((r) => r.querySelector('input[role="switch"]'))).toBe(true);
    expect(panel.querySelector('.ai-form, [data-fk$=":key"], [data-fk="route:default"]')).toBeNull();
  });

  it('Manage engines… opens the page on the first engine; an engine\'s name opens it on that engine', () => {
    const handle = mountEditor(tier2(), settings());
    handle.command('openAiSettings');
    (byText('.settings-btn', 'Manage engines…') as HTMLElement).click();
    expect(document.querySelector('[data-fk="nav:eng:omlx"]')?.getAttribute('aria-current')).toBe('true');
    (document.querySelector('[data-fk="page:back"]') as HTMLElement).click();

    (document.querySelector('[data-fk="eng:claude:open"]') as HTMLElement).click();
    expect(document.querySelector('[data-fk="nav:eng:claude"]')?.getAttribute('aria-current')).toBe('true');
    expect(document.querySelector('.ai-detail-title')?.textContent).toBe('Anthropic');
  });

  it('Change… lands on routing with focus on the default model', () => {
    const handle = mountEditor(tier2(), settings());
    handle.command('openAiSettings');
    (document.querySelector('[data-fk="route:change"]') as HTMLElement).click();
    expect(document.querySelector('[data-fk="nav:routing"]')?.getAttribute('aria-current')).toBe('true');
    expect(document.activeElement?.getAttribute('data-fk')).toBe('route:default');
  });

  it('with no engines the tab offers Add engine… and the page opens on the cards', () => {
    const handle = mountEditor(tier2(), parseAiSettings({ enabled: true }));
    handle.command('openAiSettings');
    const panel = document.querySelector('.settings-panel--ai')!;
    expect(panel.textContent).toContain('No engines yet');
    expect(panel.querySelector('.ai-engines--compact')).toBeNull();
    (byText('.settings-btn', 'Add engine…') as HTMLElement).click();
    expect(document.querySelectorAll('#mikedown-ai-page-overlay .ai-cards-group')).toHaveLength(2);
    expect(document.activeElement?.getAttribute('data-fk')).toBe('card:anthropic');
  });
});

describe('entry points', () => {
  it('openAiSettings opens the tab, or the page with { page: true }; the first list entry has focus', () => {
    const handle = mountEditor(tier2(), settings());
    handle.command('openAiSettings');
    expect(document.querySelector<HTMLElement>('.settings-tab[aria-selected="true"]')?.dataset.tabId).toBe('ai');
    expect(frame()).toBeNull();
    (document.querySelector('.settings-modal .settings-close, .settings-modal [aria-label="Close"]') as HTMLElement | null)?.click();
    document.querySelector('#mikedown-settings-overlay')?.remove();

    handle.command('openAiSettings', { page: true });
    expect(frame()).not.toBeNull();
    expect(document.querySelector('.settings-modal')).toBeNull();
    expect(document.activeElement?.getAttribute('data-fk')).toBe('nav:eng:omlx');
  });

  it('the sidebar chip opens the tab when there is a route, and the page when there is none', () => {
    const withRoute = mountEditor(tier2(), settings());
    const chip = document.querySelector<HTMLButtonElement>('[data-testid="sidebar-ai-chip"]')!;
    chip.click();
    expect(document.querySelector<HTMLElement>('.settings-tab[aria-selected="true"]')?.dataset.tabId).toBe('ai');
    expect(frame()).toBeNull();
    withRoute.destroy();
    mounted.pop()!.el.remove();
    document.querySelector('#mikedown-settings-overlay')?.remove();

    mountEditor(tier2(), { ...settings(), routing: { default: null, fallback: 'none', tasks: {} } });
    const bare = document.querySelector<HTMLButtonElement>('[data-testid="sidebar-ai-chip"]')!;
    expect(bare.textContent).toBe('AI: no model chosen');
    bare.click();
    expect(document.querySelector('.settings-modal')).toBeNull();
    expect(document.querySelector('[data-fk="nav:routing"]')?.getAttribute('aria-current')).toBe('true');
  });

  it('with no route and no engines the chip opens the page on the cards', () => {
    mountEditor(tier2(), parseAiSettings({ enabled: true }));
    const chip = document.querySelector<HTMLButtonElement>('[data-testid="sidebar-ai-chip"]')!;
    chip.click();
    expect(document.querySelectorAll('#mikedown-ai-page-overlay .ai-cards-group')).toHaveLength(2);
  });
});

describe('a tier 1 host', () => {
  class Tier1 extends NoopHost { ai = { complete: vi.fn() } as unknown as MikeDownAiHost; }

  it('gets the switch and the features, with no engine list, route line or button', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = createMikeDownEditor(el, { host: new Tier1(), features: { sidebar: true } });
    mounted.push({ handle, el });
    handle.command('openAiSettings');
    const panel = document.querySelector('.settings-panel--ai')!;
    expect(panel.querySelector('.ai-master')).not.toBeNull();
    expect(panel.querySelector('.ai-engines, .ai-route-line, [data-fk="manage-engines"], .ai-summary-empty, [data-fk="ai-allow-cloud"]')).toBeNull();
    expect(byText('.settings-btn', 'Manage engines…')).toBeUndefined();
    expect(byText('.settings-btn', 'Add engine…')).toBeUndefined();
  });

  it('{ page: true } falls back to the tab, and the page never opens', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = createMikeDownEditor(el, { host: new Tier1(), features: { sidebar: true } });
    mounted.push({ handle, el });
    handle.command('openAiSettings', { page: true });
    expect(frame()).toBeNull();
    expect(document.querySelector<HTMLElement>('.settings-tab[aria-selected="true"]')?.dataset.tabId).toBe('ai');
  });
});
