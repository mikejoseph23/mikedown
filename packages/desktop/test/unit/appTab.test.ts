/**
 * The App tab inside core's real Settings modal (jsdom): rows render with
 * core's styling classes, the folder toggle follows the window, and Save
 * hands flat dotted keys (plus the reserved toggle and baseline keys) to
 * `host.saveSettings`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, type MikeDownEditorHandle, type MikeDownHost } from '@mikedown/core';
import { createAppTabSection } from '../../src/settings/appTab';
import { createDesktopSettingsStore } from '../../src/settings/desktopSettings';
import { createAppActions, MAC_DEFAULT_APP_STEPS } from '../../src/settings/appActions';
import { SAVE_FOR_FOLDER_KEY } from '../../src/settings/schema';
import { CORE_BASELINE_KEY } from '../../src/settings/store';

let handle: MikeDownEditorHandle | null = null;
afterEach(() => {
  handle?.destroy();
  handle = null;
  document.body.innerHTML = '';
});

function openModal(opts: { folder: string | null }): { saved: Array<Record<string, unknown>>; modal: HTMLElement; checkUpdates: ReturnType<typeof vi.fn> } {
  const saved: Array<Record<string, unknown>> = [];
  const checkUpdates = vi.fn();
  const store = createDesktopSettingsStore();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const host: MikeDownHost = {
    saveSettings: (patch) => { saved.push(patch as Record<string, unknown>); },
  };
  handle = createMikeDownEditor(container, {
    host,
    theme: 'auto',
    features: { sidebar: false, supportCard: false, sourceMode: true },
    extraSettingsSections: [createAppTabSection({
      settings: () => store.get(),
      folder: () => opts.folder,
      editorRoot: () => container.querySelector<HTMLElement>('.mikedown-root'),
      version: async () => '1.2.3',
      checkForUpdates: checkUpdates,
      setDefaultApp: () => undefined,
    })],
  });
  handle.command('openSettings', { tab: 'app' });
  const modal = document.querySelector<HTMLElement>('.settings-modal');
  if (!modal) {throw new Error('settings modal did not open');}
  return { saved, modal, checkUpdates };
}

describe('App tab', () => {
  it('adds an App tab after the core tabs, selected when asked for', () => {
    const { modal } = openModal({ folder: '/notes' });
    const tabs = [...modal.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.at(-1)?.textContent).toBe('App');
    expect(tabs.at(-1)?.getAttribute('aria-selected')).toBe('true');
    expect(modal.textContent).toContain('Versions to keep');
    expect(modal.textContent).toContain('Check for updates on launch');
    expect(modal.textContent).toContain('Set MikeDown as default for .md');
    expect(modal.textContent).toContain('Confirm before delete');
    expect(modal.textContent).toContain('Show hidden files');
    expect(modal.textContent).toContain('Check for Updates');
    // Reuses core's row styling.
    expect(modal.querySelectorAll('.settings-row').length).toBeGreaterThan(5);
  });

  it('shows the app version in About', async () => {
    const { modal } = openModal({ folder: null });
    await vi.waitFor(() => expect(modal.querySelector('[data-role="app-version"]')?.textContent).toBe('Version 1.2.3'));
  });

  it('disables Save for this folder in a lone-file window', () => {
    const { modal } = openModal({ folder: null });
    const toggle = modal.querySelector<HTMLInputElement>(`[data-setting="${SAVE_FOR_FOLDER_KEY}"]`);
    expect(toggle?.disabled).toBe(true);
  });

  it('Save sends flat keys, the toggle and the visual baseline', () => {
    const { saved, modal } = openModal({ folder: '/notes' });
    const toggle = modal.querySelector<HTMLInputElement>(`[data-setting="${SAVE_FOR_FOLDER_KEY}"]`);
    expect(toggle?.disabled).toBe(false);
    toggle!.checked = true;
    const keep = [...modal.querySelectorAll<HTMLInputElement>('input[type="number"]')].find((i) => i.value === '25');
    keep!.value = '10';
    (modal.querySelector('.settings-btn--primary') as HTMLButtonElement).click();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      'versioning.keep': 10,
      'versioning.maxSizeMB': 2,
      'updates.checkOnLaunch': true,
      'imagePaste.folder': 'images',
      'tree.showHidden': false,
      'tree.confirmDelete': true,
      [SAVE_FOR_FOLDER_KEY]: true,
    });
    expect(saved[0][CORE_BASELINE_KEY]).toBeTypeOf('object');
    // Core's own keys are in the same patch.
    expect(saved[0]).toHaveProperty('fontSize');
  });

  it('Check for Updates calls back', () => {
    const { modal, checkUpdates } = openModal({ folder: null });
    const btn = [...modal.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.startsWith('Check for Updates'));
    btn!.click();
    expect(checkUpdates).toHaveBeenCalledOnce();
  });
});

describe('app actions', () => {
  const base = () => ({
    dialogs: { toast: vi.fn(), info: vi.fn(async () => undefined) },
    appVersion: async () => '0.1.0',
    manualUpdateCheck: vi.fn(async () => undefined),
    openDefaultAppsSettings: async () => true,
    markAssociationsOffered: vi.fn(),
  });

  it('macOS explains the Finder route and records the offer', async () => {
    const deps = base();
    await createAppActions({ ...deps, isMac: true }).setDefaultApp();
    expect(deps.dialogs.info).toHaveBeenCalledWith(MAC_DEFAULT_APP_STEPS, expect.any(String));
    expect(deps.markAssociationsOffered).toHaveBeenCalled();
  });

  it('Windows opens Default apps settings', async () => {
    const deps = base();
    await createAppActions({ ...deps, isMac: false }).setDefaultApp();
    expect(deps.dialogs.info).not.toHaveBeenCalled();
    expect(deps.dialogs.toast).toHaveBeenCalled();
  });

  it('Check for Updates runs the updater\'s manual check', async () => {
    const deps = base();
    await createAppActions({ ...deps, isMac: true }).checkForUpdates();
    expect(deps.manualUpdateCheck).toHaveBeenCalledOnce();
  });
});
