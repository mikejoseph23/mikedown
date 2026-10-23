import { describe, expect, it } from 'vitest';
import { createDesktopSettingsStore, DEFAULT_DESKTOP_SETTINGS, DESKTOP_CORE_SETTING_DEFAULTS } from '../../src/settings/desktopSettings';

describe('desktop settings store (M2: in memory)', () => {
  it('starts from the extension defaults', () => {
    const s = createDesktopSettingsStore().get();
    expect(s.imagePaste.folder).toBe('images');
    expect(s.imagePaste.filenamePattern).toBe('${docName}-${timestamp}');
    expect(s.imagePaste.maxSizeMB).toBe(10);
    expect(s.imageResize.overwrite).toBe(true);
    expect(s).not.toBe(DEFAULT_DESKTOP_SETTINGS);
  });

  it('applies flat and nested image keys and keeps the raw patch for M5', () => {
    const store = createDesktopSettingsStore();
    store.apply({ 'imagePaste.folder': 'assets', fontSize: 18 });
    store.apply({ imagePaste: { altText: 'filename', bogus: 1 }, 'imageResize.overwrite': false });
    const s = store.get();
    expect(s.imagePaste.folder).toBe('assets');
    expect(s.imagePaste.altText).toBe('filename');
    expect(s.imageResize.overwrite).toBe(false);
    expect((s.imagePaste as unknown as Record<string, unknown>).bogus).toBeUndefined();
    expect(store.pendingPatch()).toMatchObject({ 'imagePaste.folder': 'assets', fontSize: 18 });
  });

  it('does not leak between stores', () => {
    const a = createDesktopSettingsStore();
    a.apply({ 'imagePaste.folder': 'x' });
    expect(createDesktopSettingsStore().get().imagePaste.folder).toBe('images');
  });

  it('seeds core with a capped content width and spell check on', () => {
    // Must match an option in the core Settings modal width select, or the
    // modal opens with nothing selected.
    expect(DESKTOP_CORE_SETTING_DEFAULTS.contentWidth).toBe('900px');
    expect(DESKTOP_CORE_SETTING_DEFAULTS.spellCheckEnabled).toBe(true);
  });
});
