/** AI Engines page (M3c): smoke tests of `mountAiEnginesPage` on its own, outside the editor. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAiSettings } from '../src/ai';
import type { AiSettings, MikeDownAiHost } from '../src/ai';
import { mountAiEnginesPage } from '../src/ai-engines-page';
import type { AiEnginesPageOptions } from '../src/ai-engines-page';
import { settingsSectionContext } from '../src/settings-rows';

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
});

describe('mountAiEnginesPage', () => {
  it('renders into its container only, and dispose leaves it empty', () => {
    const c = container();
    const before = document.body.children.length;
    const page = mountAiEnginesPage(c, settingsSectionContext(() => {}), options());
    expect(document.body.children.length).toBe(before);
    expect(c.querySelector('.ai-page-title')?.textContent).toBe('AI Engines');
    expect(Array.from(c.querySelectorAll('.ai-nav-name')).map((n) => n.textContent)).toEqual(['oMLX', 'Anthropic', 'Routing', 'Add engine']);
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
    expect(c.querySelector('.ai-detail-title')?.textContent).toBe('Routing');
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
});
