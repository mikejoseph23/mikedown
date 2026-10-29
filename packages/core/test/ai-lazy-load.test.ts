/** The AI UI loads on demand (ai-lite.ts): never without host.ai, and the editor works before it arrives. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle, type MikeDownHost } from '../src/index';
import { parseAiSettings, type MikeDownAiHost } from '../src/ai';
import { loadAiUi, loadedAiUi, registerAiUi } from '../src/ai-lite';
import * as aiUi from '../src/ai-ui';
import { hideToolbarDropdown } from '../src/toolbar-dropdown';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const quiet = { onWarning: () => {} };
const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

function mount(host: MikeDownHost, settings?: Parameters<typeof createMikeDownEditor>[1]['settings']): MikeDownEditorHandle {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host, settings });
  mounted.push({ handle, el });
  return handle;
}

function aiHost(): MikeDownAiHost {
  return { complete: vi.fn(), listEngines: vi.fn(async () => []) } as unknown as MikeDownAiHost;
}

const aiButton = () => mounted[mounted.length - 1]?.el.querySelector<HTMLButtonElement>('button[data-action="ai"]') ?? null;
const isShown = (b: HTMLElement | null) => !!b && b.style.display !== 'none';
const panel = () => document.querySelector<HTMLElement>('.ai-first-run');
/** Let the AI chunk's import() settle and the editor's then() run. */
async function settle(): Promise<void> {
  await loadAiUi();
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => registerAiUi(null));

afterEach(() => {
  hideToolbarDropdown();
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  document.querySelectorAll('#mikedown-settings-overlay, #mikedown-ai-page-overlay, .ai-first-run').forEach((n) => n.remove());
  // The other test files rely on the setup file's registration.
  registerAiUi(aiUi);
});

describe('AI UI loading', () => {
  it('is never loaded for a host without AI', async () => {
    mount(new NoopHost());
    await new Promise((r) => setTimeout(r, 0));
    expect(loadedAiUi()).toBeNull();
    expect(aiButton()).toBeNull();
  });

  it('starts loading with host.ai; the toolbar button is there before it arrives', async () => {
    class Host extends NoopHost { ai = aiHost(); }
    mount(new Host());
    expect(loadedAiUi()).toBeNull();
    expect(isShown(aiButton())).toBe(true);
    await settle();
    expect(loadedAiUi()).not.toBeNull();
  });

  it('a click before the AI UI arrives opens the first-run panel once it has', async () => {
    class Host extends NoopHost { ai = aiHost(); }
    mount(new Host());
    aiButton()!.click();
    expect(panel()).toBeNull();
    await settle();
    expect(panel()).not.toBeNull();
  });

  it('settings sent before it arrives apply: the button follows them at once, the rest after the load', async () => {
    class Host extends NoopHost { ai = aiHost(); }
    const handle = mount(new Host(), { ai: parseAiSettings({ showToolbarButton: false }, quiet) });
    expect(isShown(aiButton())).toBe(false);
    handle.updateSettings({ ai: parseAiSettings({ enabled: true }, quiet) });
    expect(isShown(aiButton())).toBe(true);
    await settle();
    expect(aiButton()!.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('the Settings modal opens on the AI tab once the AI UI is there', async () => {
    class Host extends NoopHost { ai = aiHost(); }
    const handle = mount(new Host());
    handle.command('openAiSettings');
    expect(document.querySelector('#mikedown-settings-overlay')).toBeNull();
    await settle();
    expect(document.querySelector('#mikedown-settings-overlay [data-tab-id="ai"]')).not.toBeNull();
  });
});
