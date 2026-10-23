/**
 * Desktop-only settings (core-extraction-decisions.md section 6): the
 * image-paste policy the VS Code extension keeps under `mikedown.imagePaste.*`
 * and `imageResize.overwrite`, mirrored here with the same defaults. M2 keeps
 * them in memory; M5 persists the global and folder files and adds the App
 * tab to the Settings modal.
 */
import type { MikeDownSettings } from '@mikedown/core';
import type { ImagePasteSettings } from '@mikedown/core/shared/imagePaste';

export interface DesktopSettings {
  imagePaste: ImagePasteSettings;
  imageResize: { overwrite: boolean };
}

/** Same defaults as `package.json#contributes.configuration` in the extension. */
export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  imagePaste: {
    enabled: true,
    folder: 'images',
    folderRelativeTo: 'document',
    filenamePattern: '${docName}-${timestamp}',
    pathStyle: 'relative',
    altText: 'empty',
    maxSizeMB: 10,
    // Orphan cleanup is not in v1 (edge case 15).
    cleanupUnreferenced: false,
  },
  imageResize: { overwrite: true },
};

/**
 * Core settings the desktop seeds at mount, where its defaults differ from
 * core's. Spell check is on (edge case 22). The content column is capped at
 * the Settings modal's "Wide (900px)" option, centered, so text and tables do
 * not span a wide window; "Full Width" in Settings still overrides it.
 */
export const DESKTOP_CORE_SETTING_DEFAULTS: Partial<MikeDownSettings> = {
  spellCheckEnabled: true,
  contentWidth: '900px',
};

export interface DesktopSettingsStore {
  get(): DesktopSettings;
  /**
   * Merge a Settings-modal patch. Core-owned keys were already applied by the
   * editor; desktop keys arrive flat (`imagePaste.folder`) or nested
   * (`imagePaste: { folder }`), as the VS Code shell sends them.
   */
  apply(patch: Record<string, unknown>): void;
  /** Everything received so far, for M5 to persist. */
  pendingPatch(): Record<string, unknown>;
}

export function createDesktopSettingsStore(initial: DesktopSettings = DEFAULT_DESKTOP_SETTINGS): DesktopSettingsStore {
  const current: DesktopSettings = {
    imagePaste: { ...initial.imagePaste },
    imageResize: { ...initial.imageResize },
  };
  const received: Record<string, unknown> = {};

  function setImagePaste(key: string, value: unknown): void {
    const ip = current.imagePaste as unknown as Record<string, unknown>;
    if (key in ip && value !== undefined) {ip[key] = value;}
  }

  return {
    get: () => current,
    apply(patch) {
      for (const [key, value] of Object.entries(patch)) {
        received[key] = value;
        if (key === 'imagePaste' && value && typeof value === 'object') {
          for (const [k, v] of Object.entries(value as Record<string, unknown>)) {setImagePaste(k, v);}
        } else if (key.startsWith('imagePaste.')) {
          setImagePaste(key.slice('imagePaste.'.length), value);
        } else if (key === 'imagePasteEnabled' && typeof value === 'boolean') {
          current.imagePaste.enabled = value;
        } else if (key === 'imageResize.overwrite' && typeof value === 'boolean') {
          current.imageResize.overwrite = value;
        } else if (key === 'imageResize' && value && typeof value === 'object') {
          const o = (value as { overwrite?: unknown }).overwrite;
          if (typeof o === 'boolean') {current.imageResize.overwrite = o;}
        }
      }
    },
    pendingPatch: () => ({ ...received }),
  };
}
