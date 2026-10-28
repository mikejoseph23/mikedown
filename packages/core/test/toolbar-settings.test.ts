/**
 * `settings.toolbarLayout` plumbing: the initial layout, live updates through
 * `updateSettings`, `null` as the default, `features.customizeToolbar` and the
 * Settings modal's Toolbar tab.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, DEFAULT_FEATURES, NoopHost, type MikeDownEditorHandle, type MikeDownHost } from '../src/index';
import { TOOLBAR_ITEM_IDS } from '../src/index';
import { hideToolbarDropdown } from '../src/toolbar-dropdown';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

function mount(host: MikeDownHost = new NoopHost(), options: Record<string, unknown> = {}) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host, ...options });
  mounted.push({ handle, el });
  return { el, handle };
}

afterEach(() => {
  hideToolbarDropdown();
  document.querySelectorAll('#mikedown-settings-overlay').forEach((n) => n.remove());
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  vi.restoreAllMocks();
});

/** `data-action` ids of the toolbar's direct children, groups kept as one, separators as `|`, spacers as `~`. */
function order(el: HTMLElement): string[] {
  const toolbar = el.querySelector<HTMLElement>('.mikedown-toolbar')!;
  return (Array.from(toolbar.children) as HTMLElement[]).map((c) => {
    if (c.classList.contains('toolbar-separator')) {return '|';}
    if (c.classList.contains('toolbar-spacer')) {return '~';}
    return c.dataset.action ?? '?';
  });
}

const custom = { version: 1, items: ['textFormat', 'redo', 'undo', '|', 'settings', 'more'], seen: [...TOOLBAR_ITEM_IDS] };
const customOrder = ['textFormat', 'redo', 'undo', '|', 'settings', 'more'];

function openToolbarTab(handle: MikeDownEditorHandle): HTMLElement | null {
  handle.command('openSettings');
  return document.querySelector<HTMLElement>('.settings-tab[data-tab-id="toolbar"]');
}

function resetButton(): HTMLButtonElement {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.settings-modal .settings-btn'))
    .find((b) => b.textContent === 'Reset to Default')!;
}

describe('settings.toolbarLayout', () => {
  it('renders the default layout when absent, null or invalid', () => {
    const baseline = order(mount().el);
    expect(order(mount(new NoopHost(), { settings: { toolbarLayout: null } }).el)).toEqual(baseline);
    expect(order(mount(new NoopHost(), { settings: { toolbarLayout: 'nonsense' } }).el)).toEqual(baseline);
  });

  it('applies an initial layout', () => {
    const { el } = mount(new NoopHost(), { settings: { toolbarLayout: custom } });
    expect(order(el)).toEqual(customOrder);
  });

  it('re-renders on updateSettings and returns to the default on null', () => {
    const { el, handle } = mount();
    const baseline = order(el);
    handle.updateSettings({ toolbarLayout: custom });
    expect(order(el)).toEqual(customOrder);
    handle.updateSettings({ toolbarLayout: null });
    expect(order(el)).toEqual(baseline);
  });

  it('leaves the layout alone when a patch does not mention it', () => {
    const { el, handle } = mount(new NoopHost(), { settings: { toolbarLayout: custom } });
    handle.updateSettings({ fontSize: 18 });
    expect(order(el)).toEqual(customOrder);
  });

  it('applies the layout even when features.customizeToolbar is false', () => {
    const { el } = mount(new NoopHost(), { features: { customizeToolbar: false }, settings: { toolbarLayout: custom } });
    expect(order(el)).toEqual(customOrder);
  });
});

describe('features.customizeToolbar', () => {
  it('defaults to true', () => {
    expect(DEFAULT_FEATURES.customizeToolbar).toBe(true);
  });
});

describe('Settings modal Toolbar tab', () => {
  it('has Customize Toolbar and Reset to Default, Reset disabled on the default layout', () => {
    const { handle } = mount();
    expect(openToolbarTab(handle)).not.toBeNull();
    const labels = Array.from(document.querySelectorAll('.settings-modal .settings-btn')).map((b) => b.textContent);
    expect(labels).toContain('Customize Toolbar…');
    expect(resetButton().disabled).toBe(true);
  });

  it('Reset to Default saves null, restores the default and disables itself', () => {
    const saveSettings = vi.fn();
    const { el, handle } = mount({ onChange() {}, saveSettings });
    const baseline = order(el);
    handle.updateSettings({ toolbarLayout: custom });
    openToolbarTab(handle);
    const reset = resetButton();
    expect(reset.disabled).toBe(false);
    reset.click();
    expect(saveSettings).toHaveBeenCalledWith({ toolbarLayout: null });
    expect(order(el)).toEqual(baseline);
    expect(reset.disabled).toBe(true);
  });

  it('is left out when features.customizeToolbar is false', () => {
    const { handle } = mount(new NoopHost(), { features: { customizeToolbar: false } });
    expect(openToolbarTab(handle)).toBeNull();
    expect(document.querySelector('.settings-modal')).not.toBeNull();
  });
});
