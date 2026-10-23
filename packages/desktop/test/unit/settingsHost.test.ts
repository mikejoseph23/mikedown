import { describe, expect, it, vi } from 'vitest';
import { TauriHost } from '../../src/host/tauriHost';
import { createPathOps } from '../../src/host/pathOps';
import { createDesktopSettingsStore } from '../../src/settings/desktopSettings';

describe('desktop store (persisted shape)', () => {
  it('load() resets to defaults first, then applies dotted keys', () => {
    const store = createDesktopSettingsStore();
    store.apply({ 'versioning.keep': 3 });
    store.load({ 'tree.showHidden': true });
    expect(store.get().versioning.keep).toBe(25);
    expect(store.get().tree.showHidden).toBe(true);
    expect(store.flat()['tree.showHidden']).toBe(true);
    expect(store.flat()['versioning.keep']).toBe(25);
  });

  it('tells listeners when the tree prefs change', () => {
    const store = createDesktopSettingsStore();
    const seen: Array<Record<string, unknown>> = [];
    store.onTreeChange((p) => seen.push(p));
    store.setTree({ confirmDelete: false });
    expect(seen).toEqual([{ 'tree.confirmDelete': false }]);
  });
});

describe('TauriHost.saveSettings with a settings manager', () => {
  function makeHost(persist?: (patch: Record<string, unknown>, opts?: { silent?: boolean }) => Promise<void>) {
    const store = createDesktopSettingsStore();
    const notify = vi.fn();
    const host = new TauriHost({
      doc: () => null,
      path: createPathOps('posix'),
      fs: { assetUrl: (p: string) => p },
      settings: store,
      persistSettings: persist,
      images: { uploadImage: vi.fn(), pickImage: vi.fn(), resizeImage: vi.fn() } as never,
      app: { onModelChanged: vi.fn(), onStats: vi.fn(), openPath: vi.fn(), notify },
    });
    return { host, store, notify };
  }

  it('hands the patch over without applying it first', () => {
    const persist = vi.fn(async () => undefined);
    const { host, store, notify } = makeHost(persist);
    host.saveSettings({ 'versioning.keep': 8 }, { silent: true });
    expect(persist).toHaveBeenCalledWith({ 'versioning.keep': 8 }, { silent: true });
    expect(store.get().versioning.keep).toBe(25);
    expect(notify).not.toHaveBeenCalled();
  });

  it('reports a failed save', async () => {
    const { host, notify } = makeHost(async () => { throw new Error('disk full'); });
    host.saveSettings({ fontSize: 20 });
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('disk full'), { error: true }));
  });

  it('without a manager it still applies for the session', () => {
    const { host, store } = makeHost();
    host.saveSettings({ 'versioning.keep': 8 }, { silent: true });
    expect(store.get().versioning.keep).toBe(8);
  });
});
