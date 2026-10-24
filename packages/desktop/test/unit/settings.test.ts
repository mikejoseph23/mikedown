import { describe, expect, it, vi } from 'vitest';
import { createPathOps } from '../../src/host/pathOps';
import { createDesktopSettingsStore } from '../../src/settings/desktopSettings';
import {
  flattenPatch,
  mergeSettings,
  parseSettingsText,
  SAVE_FOR_FOLDER_KEY,
  validateFolderOverride,
} from '../../src/settings/schema';
import type { SettingsApi, SettingsChangedEvent, SettingsFileInfo, SettingsScope } from '../../src/settings/settingsApi';
import { CORE_BASELINE_KEY, createSettingsManager, type BannerItem, type SettingsBanner } from '../../src/settings/store';

const path = createPathOps('posix');
const GLOBAL = '/appdata/settings.json';
const folderFile = (folder: string): string => `${folder}/.mikedown/settings.json`;

/** In-memory stand-in for the Rust commands plus the Tauri event bus. */
function createWorld() {
  const files = new Map<string, string>();
  const writes: Array<{ scope: SettingsScope; path: string }> = [];
  const listeners: Array<(e: SettingsChangedEvent) => void> = [];
  const api: SettingsApi = {
    async read(scope, folder): Promise<SettingsFileInfo> {
      const p = scope === 'global' ? GLOBAL : folderFile(folder as string);
      return { path: p, text: files.get(p) ?? null };
    },
    async write(scope, folder, text): Promise<SettingsFileInfo> {
      const p = scope === 'global' ? GLOBAL : folderFile(folder as string);
      JSON.parse(text);
      files.set(p, text);
      writes.push({ scope, path: p });
      return { path: p, text };
    },
    async emitChanged(event) { for (const l of listeners) {l(event);} },
    async onChanged(handler) { listeners.push(handler); return () => { listeners.splice(listeners.indexOf(handler), 1); }; },
    async openDefaultAppsSettings() { return false; },
  };
  return { files, writes, api };
}

function createWindow(world: ReturnType<typeof createWorld>, opts: { label?: string; folder?: string | null } = {}) {
  const store = createDesktopSettingsStore();
  const state = { folder: opts.folder ?? null };
  const applied: Array<Record<string, unknown>> = [];
  const banners: BannerItem[][] = [];
  const toasts: string[] = [];
  const banner: SettingsBanner = {
    show: (items) => { banners.push(items); },
    clear: () => { banners.push([]); },
  };
  const manager = createSettingsManager({
    api: world.api,
    path,
    store,
    folder: () => state.folder,
    windowLabel: opts.label ?? 'main',
    applyCore: (patch) => { applied.push({ ...patch }); },
    banner,
    notify: (m) => { toasts.push(m); },
    openFile: vi.fn(),
  });
  return { store, state, manager, applied, banners, toasts, lastBanner: () => banners.at(-1) ?? [] };
}

describe('schema', () => {
  it('flattens nested desktop groups and bare tree keys', () => {
    expect(flattenPatch({ imagePaste: { folder: 'a' }, confirmDelete: false, fontSize: 18 })).toEqual({
      'imagePaste.folder': 'a',
      'tree.confirmDelete': false,
      fontSize: 18,
    });
  });

  it('merges shallowly per top-level key, later layers win', () => {
    const merged = mergeSettings({ fontSize: 14, 'versioning.keep': 25, normalizationStyle: { a: 1 } }, { 'versioning.keep': 10, normalizationStyle: { b: 2 } });
    expect(merged).toEqual({ fontSize: 14, 'versioning.keep': 10, normalizationStyle: { b: 2 } });
  });

  it('parses empty as empty and reports bad JSON or non-objects as errors', () => {
    expect(parseSettingsText(null)).toEqual({ ok: true, value: {} });
    expect(parseSettingsText('  ')).toEqual({ ok: true, value: {} });
    expect(parseSettingsText('{ nope').ok).toBe(false);
    expect(parseSettingsText('[1]').ok).toBe(false);
    expect(parseSettingsText('{"imagePaste":{"folder":"x"}}')).toEqual({ ok: true, value: { 'imagePaste.folder': 'x' } });
  });

  describe('folder override validation (edge 29)', () => {
    it('rejects an absolute imagePaste.folder outside the folder, with a reason', () => {
      const { value, problems } = validateFolderOverride({ 'imagePaste.folder': '/etc/images', 'versioning.keep': 5 }, '/notes', path);
      expect(value).toEqual({ 'versioning.keep': 5 });
      expect(problems).toHaveLength(1);
      expect(problems[0].reason).toContain('/etc/images');
      expect(problems[0].reason).toContain('outside this folder');
    });

    it('keeps relative folders and absolute ones inside the folder', () => {
      expect(validateFolderOverride({ 'imagePaste.folder': 'assets/${docName}' }, '/notes', path).problems).toEqual([]);
      expect(validateFolderOverride({ 'imagePaste.folder': '/notes/media' }, '/notes', path).problems).toEqual([]);
    });

    it('rejects home-relative folders and sibling prefixes', () => {
      expect(validateFolderOverride({ 'imagePaste.folder': '~/pics' }, '/notes', path).problems).toHaveLength(1);
      expect(validateFolderOverride({ 'imagePaste.folder': '/notes-other/img' }, '/notes', path).problems).toHaveLength(1);
    });
  });
});

describe('settings manager: load and merge', () => {
  it('uses defaults when no file exists and creates nothing', async () => {
    const world = createWorld();
    const win = createWindow(world, { folder: '/notes' });
    await win.manager.load();
    expect(win.store.get().versioning.keep).toBe(25);
    expect(world.writes).toEqual([]);
    expect(win.lastBanner()).toEqual([]);
  });

  it('merges the global file with the folder override, folder wins', async () => {
    const world = createWorld();
    world.files.set(GLOBAL, JSON.stringify({ fontSize: 20, 'versioning.keep': 40, 'tree.showHidden': true }));
    world.files.set(folderFile('/notes'), JSON.stringify({ 'versioning.keep': 10 }));
    const win = createWindow(world, { folder: '/notes' });
    await win.manager.load();
    expect(win.store.get().versioning.keep).toBe(10);
    expect(win.store.get().tree.showHidden).toBe(true);
    expect(win.applied.at(-1)).toMatchObject({ fontSize: 20 });

    // Another folder: the override is gone, the global value shows (25 -> 40 here).
    win.state.folder = '/other';
    await win.manager.load();
    expect(win.store.get().versioning.keep).toBe(40);
  });

  it('opening another folder shows the default again when only the folder set it', async () => {
    const world = createWorld();
    world.files.set(folderFile('/a'), JSON.stringify({ 'versioning.keep': 10 }));
    const win = createWindow(world, { folder: '/a' });
    await win.manager.load();
    expect(win.store.get().versioning.keep).toBe(10);
    win.state.folder = '/b';
    await win.manager.load();
    expect(win.store.get().versioning.keep).toBe(25);
  });

  it('ignores a stored editorTheme: the app follows the OS', async () => {
    const world = createWorld();
    world.files.set(GLOBAL, JSON.stringify({ editorTheme: 'dark', fontSize: 17 }));
    const win = createWindow(world);
    await win.manager.load();
    expect(win.applied.at(-1)).not.toHaveProperty('editorTheme');
    expect(win.applied.at(-1)).toMatchObject({ fontSize: 17 });
  });

  it('drops invalid desktop values and keeps the default', async () => {
    const world = createWorld();
    world.files.set(GLOBAL, JSON.stringify({ 'versioning.keep': 'many', 'imagePaste.altText': 'shout', 'tree.confirmDelete': false }));
    const win = createWindow(world);
    await win.manager.load();
    expect(win.store.get().versioning.keep).toBe(25);
    expect(win.store.get().imagePaste.altText).toBe('empty');
    expect(win.store.get().tree.confirmDelete).toBe(false);
  });
});

describe('settings manager: corrupt files (edge 16)', () => {
  it('falls back to defaults, shows a banner with both actions and leaves the file alone', async () => {
    const world = createWorld();
    world.files.set(GLOBAL, '{ "fontSize": 18, oops');
    const win = createWindow(world);
    await win.manager.load();
    expect(win.store.get().versioning.keep).toBe(25);
    expect(win.applied.at(-1)).not.toHaveProperty('fontSize');
    const banner = win.lastBanner();
    expect(banner).toHaveLength(1);
    expect(banner[0].actions.map((a) => a.label)).toEqual(['Open file', 'Reset to defaults']);
    expect(world.writes).toEqual([]);
    expect(world.files.get(GLOBAL)).toBe('{ "fontSize": 18, oops');
  });

  it('refuses to save into a corrupt file and keeps the session value', async () => {
    const world = createWorld();
    world.files.set(GLOBAL, 'garbage');
    const win = createWindow(world);
    await win.manager.load();
    await win.manager.save({ 'versioning.keep': 7 });
    expect(world.files.get(GLOBAL)).toBe('garbage');
    expect(world.writes).toEqual([]);
    expect(win.toasts.join(' ')).toContain('damaged');
    expect(win.store.get().versioning.keep).toBe(7);
  });

  it('Reset to defaults writes a fresh file only when clicked', async () => {
    const world = createWorld();
    world.files.set(GLOBAL, 'garbage');
    const win = createWindow(world);
    await win.manager.load();
    expect(world.writes).toEqual([]);
    win.lastBanner()[0].actions[1].run();
    await vi.waitFor(() => expect(world.writes).toHaveLength(1));
    expect(world.files.get(GLOBAL)).toBe('{}\n');
    await vi.waitFor(() => expect(win.lastBanner()).toEqual([]));
  });

  it('a corrupt folder file does not stop the global one from applying', async () => {
    const world = createWorld();
    world.files.set(GLOBAL, JSON.stringify({ 'versioning.keep': 30 }));
    world.files.set(folderFile('/notes'), '{');
    const win = createWindow(world, { folder: '/notes' });
    await win.manager.load();
    expect(win.store.get().versioning.keep).toBe(30);
    expect(win.lastBanner()[0].id).toBe('corrupt-folder');
  });

  it('shows the reason when a folder override points outside the folder', async () => {
    const world = createWorld();
    world.files.set(folderFile('/notes'), JSON.stringify({ 'imagePaste.folder': '/tmp/out', 'versioning.keep': 12 }));
    const win = createWindow(world, { folder: '/notes' });
    await win.manager.load();
    expect(win.store.get().imagePaste.folder).toBe('images');
    expect(win.store.get().versioning.keep).toBe(12);
    expect(win.lastBanner().some((b) => b.message.includes('/tmp/out'))).toBe(true);
  });
});

describe('settings manager: save routing', () => {
  it('writes global changes to the global file, never creating the folder file', async () => {
    const world = createWorld();
    const win = createWindow(world, { folder: '/notes' });
    await win.manager.load();
    await win.manager.save({ fontFamily: 'Georgia, serif', 'versioning.keep': 12 });
    expect(world.writes).toEqual([{ scope: 'global', path: GLOBAL }]);
    expect(JSON.parse(world.files.get(GLOBAL) as string)).toMatchObject({ fontFamily: 'Georgia, serif', 'versioning.keep': 12 });
    expect(world.files.has(folderFile('/notes'))).toBe(false);
    // Applied to the store and the editors after the write.
    expect(win.store.get().versioning.keep).toBe(12);
    expect(win.applied.at(-1)).toMatchObject({ fontFamily: 'Georgia, serif' });
  });

  it('Save for this folder writes only the changed key to .mikedown/settings.json', async () => {
    const world = createWorld();
    world.files.set(GLOBAL, JSON.stringify({ fontSize: 18 }));
    const win = createWindow(world, { folder: '/notes' });
    await win.manager.load();
    // What the modal sends: every core key as shown, every App key, the toggle.
    await win.manager.save({
      fontSize: 18,
      ctrlWheelZoom: true,
      renderMath: true,
      linkClickBehavior: 'openNewTab',
      contentWidth: '900px',
      spellCheckUserWords: [],
      fontFamily: 'Georgia, serif',
      'versioning.enabled': true,
      'versioning.keep': 10,
      'versioning.maxSizeMB': 2,
      'tree.showHidden': false,
      'imagePaste.folder': 'images',
      [SAVE_FOR_FOLDER_KEY]: true,
      // The editor was showing the default font before; fonts equal to it are untouched.
      [CORE_BASELINE_KEY]: { fontSize: 18, fontFamily: 'Georgia, serif', headingFontFamily: '', contentWidth: '900px' },
    });
    expect(world.writes).toEqual([{ scope: 'folder', path: folderFile('/notes') }]);
    expect(JSON.parse(world.files.get(folderFile('/notes')) as string)).toEqual({ 'versioning.keep': 10 });
    // The global file was not touched.
    expect(world.files.get(GLOBAL)).toBe(JSON.stringify({ fontSize: 18 }));
    expect(win.store.get().versioning.keep).toBe(10);

    win.state.folder = '/other';
    await win.manager.load();
    expect(win.store.get().versioning.keep).toBe(25);
  });

  it('ignores Save for this folder in a lone-file window and saves globally', async () => {
    const world = createWorld();
    const win = createWindow(world, { folder: null });
    await win.manager.load();
    await win.manager.save({ 'versioning.keep': 9, [SAVE_FOR_FOLDER_KEY]: true });
    expect(world.writes).toEqual([{ scope: 'global', path: GLOBAL }]);
  });

  it('writes nothing when the modal is saved with no changes', async () => {
    const world = createWorld();
    const win = createWindow(world, { folder: '/notes' });
    await win.manager.load();
    await win.manager.save({ 'versioning.keep': 25, 'tree.showHidden': false, ctrlWheelZoom: true, [SAVE_FOR_FOLDER_KEY]: true });
    expect(world.writes).toEqual([]);
  });

  it('keeps keys it does not know when it rewrites a file', async () => {
    const world = createWorld();
    world.files.set(GLOBAL, JSON.stringify({ somethingNew: [1, 2], fontSize: 16 }));
    const win = createWindow(world);
    await win.manager.load();
    await win.manager.save({ 'updates.checkOnLaunch': false });
    expect(JSON.parse(world.files.get(GLOBAL) as string)).toEqual({ somethingNew: [1, 2], fontSize: 16, 'updates.checkOnLaunch': false });
  });

  it('rejects an out-of-folder image folder on a folder save', async () => {
    const world = createWorld();
    const win = createWindow(world, { folder: '/notes' });
    await win.manager.load();
    await win.manager.save({ 'imagePaste.folder': '/var/images', 'versioning.keep': 3, [SAVE_FOR_FOLDER_KEY]: true });
    expect(JSON.parse(world.files.get(folderFile('/notes')) as string)).toEqual({ 'versioning.keep': 3 });
    expect(win.toasts.join(' ')).toContain('outside this folder');
  });

  it('a tree toggle (already applied to the store) is still persisted with force', async () => {
    const world = createWorld();
    const win = createWindow(world);
    await win.manager.load();
    win.store.setTree({ showHidden: true });
    await win.manager.save({ 'tree.showHidden': true }, { silent: true, force: true });
    expect(JSON.parse(world.files.get(GLOBAL) as string)).toEqual({ 'tree.showHidden': true });
  });

  it('a silent save (wheel zoom) writes the font size without a toast', async () => {
    const world = createWorld();
    const win = createWindow(world);
    await win.manager.load();
    await win.manager.save({ fontSize: 22 }, { silent: true });
    expect(JSON.parse(world.files.get(GLOBAL) as string)).toEqual({ fontSize: 22 });
    expect(win.toasts).toEqual([]);
  });
});

describe('settings: document sidebar state (outline.*)', () => {
  it('the pin and collapsed sections persist globally and come back in a new window', async () => {
    const world = createWorld();
    const win = createWindow(world, { folder: '/notes' });
    await win.manager.load();
    const saves: Array<Promise<void>> = [];
    win.store.onOutlineChange((patch) => { saves.push(win.manager.save(patch, { silent: true, force: true })); });
    win.store.setOutline({ visibility: 'always' });
    await Promise.all(saves);
    win.store.setOutline({ sectionPrefs: { properties: true, backlinks: false } });
    await Promise.all(saves);
    // Global file, never the folder override; no toast.
    expect(JSON.parse(world.files.get(GLOBAL) as string)).toEqual({
      'outline.visibility': 'always',
      'outline.sectionPrefs': { properties: true, backlinks: false },
    });
    expect(world.files.has(folderFile('/notes'))).toBe(false);
    expect(win.toasts).toEqual([]);

    const next = createWindow(world, { label: 'w2' });
    await next.manager.load();
    expect(next.store.get().outline).toEqual({ visibility: 'always', sectionPrefs: { properties: true, backlinks: false } });
  });

  it('bad values in the file fall back to the defaults', () => {
    const store = createDesktopSettingsStore();
    store.load({ 'outline.visibility': 'sometimes', 'outline.sectionPrefs': ['properties'] });
    expect(store.get().outline).toEqual({ visibility: 'never', sectionPrefs: {} });
    store.load({ 'outline.sectionPrefs': { outline: true, tags: 'yes' } });
    expect(store.get().outline.sectionPrefs).toEqual({ outline: true });
  });

  it('setOutline ignores unknown values and does not notify for them', () => {
    const store = createDesktopSettingsStore();
    const seen: Array<Record<string, unknown>> = [];
    store.onOutlineChange((p) => seen.push(p));
    store.setOutline({ visibility: 'sideways' as never });
    expect(seen).toEqual([]);
    store.setOutline({ visibility: 'always' });
    expect(seen).toEqual([{ 'outline.visibility': 'always' }]);
    expect(store.get().outline.visibility).toBe('always');
  });
});

describe('settings manager: other windows', () => {
  it('a save in one window is re-read and applied by the other', async () => {
    const world = createWorld();
    const a = createWindow(world, { label: 'main' });
    const b = createWindow(world, { label: 'w-1' });
    await a.manager.load();
    await b.manager.load();
    await b.manager.listen();
    await a.manager.listen();

    await a.manager.save({ fontFamily: 'Georgia, serif', 'versioning.keep': 14 });
    await vi.waitFor(() => expect(b.store.get().versioning.keep).toBe(14));
    expect(b.applied.at(-1)).toMatchObject({ fontFamily: 'Georgia, serif' });
  });

  it('a window does not re-read its own change, and ignores another folder\'s override', async () => {
    const world = createWorld();
    const a = createWindow(world, { label: 'main', folder: '/a' });
    const b = createWindow(world, { label: 'w-1', folder: '/b' });
    await a.manager.load();
    await b.manager.load();
    await a.manager.listen();
    await b.manager.listen();
    const appliedBefore = b.applied.length;
    await a.manager.save({ 'versioning.keep': 5, [SAVE_FOR_FOLDER_KEY]: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(b.applied.length).toBe(appliedBefore);
    expect(b.store.get().versioning.keep).toBe(25);
  });
});
