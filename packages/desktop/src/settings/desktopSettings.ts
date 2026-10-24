/**
 * Desktop-only settings (core-extraction-decisions.md section 6): the
 * image-paste policy the VS Code extension keeps under `mikedown.imagePaste.*`
 * and `imageResize.overwrite`, mirrored here with the same defaults. M2 keeps
 * them in memory; M5 (`store.ts`) persists the global and folder files and
 * adds the App tab to the Settings modal.
 */
import type { MikeDownSettings } from '@mikedown/core';
import type { ImagePasteSettings } from '@mikedown/core/shared/imagePaste';
import { DESKTOP_KEY_DEFAULTS, isDesktopKey, sanitizeDesktopValue, type DesktopKey, type SettingsRecord } from './schema';

export interface TreeSettings {
  /** Show dotfolders, `node_modules` and OS clutter files in the tree. */
  showHidden: boolean;
  /** Ask before moving to the Trash; "Don't ask again" turns it off (edge case 21). */
  confirmDelete: boolean;
}

export interface VersioningSettings {
  enabled: boolean;
  /** Snapshots kept per file (M6 prunes to this). */
  keep: number;
  /** Files over this size skip versioning. */
  maxSizeMB: number;
}

/**
 * Core's document sidebar (Outline / Backlinks / Properties), global for
 * every window. `visibility` is the pin: `always` opens the sidebar for every
 * document and new pane. `sectionPrefs` holds the sections the user collapsed
 * (true) or expanded (false); a section missing from it follows core's
 * collapse-when-empty rule.
 */
export interface OutlineSettings {
  visibility: 'always' | 'never';
  sectionPrefs: Record<string, boolean>;
}

export interface DesktopSettings {
  imagePaste: ImagePasteSettings;
  imageResize: { overwrite: boolean };
  tree: TreeSettings;
  versioning: VersioningSettings;
  updates: { checkOnLaunch: boolean };
  outline: OutlineSettings;
  /** The "make MikeDown the default for .md" offer was shown (M8 reads it). */
  fileAssociationsOffered: boolean;
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
  tree: { showHidden: false, confirmDelete: true },
  versioning: { enabled: true, keep: 25, maxSizeMB: 2 },
  updates: { checkOnLaunch: true },
  outline: { visibility: 'never', sectionPrefs: {} },
  fileAssociationsOffered: false,
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
  // Cmd/Ctrl+click on an unresolved [[wikilink]] creates the note next to the
  // current one (M3). Only folder windows have `createWikilink`, so a lone
  // file is unaffected.
  wikilinkCreateOnClick: true,
};

export interface DesktopSettingsStore {
  get(): DesktopSettings;
  /**
   * Merge a Settings-modal patch. Core-owned keys were already applied by the
   * editor; desktop keys arrive flat (`imagePaste.folder`) or nested
   * (`imagePaste: { folder }`), as the VS Code shell sends them.
   */
  apply(patch: Record<string, unknown>): void;
  /** Everything received so far. */
  pendingPatch(): Record<string, unknown>;
  /** Tree preferences (show hidden, delete confirmation); persisted by the settings manager. */
  setTree(patch: Partial<TreeSettings>): void;
  /** Document sidebar state (pin, collapsed sections); persisted by the settings manager. */
  setOutline(patch: Partial<OutlineSettings>): void;
  /** The merged files replace everything: defaults, then these dotted desktop keys. */
  load(flat: SettingsRecord): void;
  /** Current values as dotted keys (`versioning.keep`), for diffing patches. */
  flat(): SettingsRecord;
  /** `setTree` was called (the user toggled it in the tree); the manager saves it. */
  onTreeChange(fn: (patch: SettingsRecord) => void): void;
  /** `setOutline` was called (pin or section toggle in the sidebar); the manager saves it. */
  onOutlineChange(fn: (patch: SettingsRecord) => void): void;
}

function cloneSettings(from: DesktopSettings): DesktopSettings {
  return {
    imagePaste: { ...from.imagePaste },
    imageResize: { ...from.imageResize },
    tree: { ...from.tree },
    versioning: { ...from.versioning },
    updates: { ...from.updates },
    outline: { visibility: from.outline.visibility, sectionPrefs: { ...from.outline.sectionPrefs } },
    fileAssociationsOffered: from.fileAssociationsOffered,
  };
}

export function createDesktopSettingsStore(initial: DesktopSettings = DEFAULT_DESKTOP_SETTINGS): DesktopSettingsStore {
  const current: DesktopSettings = cloneSettings(initial);
  const received: Record<string, unknown> = {};
  const treeListeners: Array<(patch: SettingsRecord) => void> = [];
  const outlineListeners: Array<(patch: SettingsRecord) => void> = [];

  /** Set one dotted desktop key; unknown keys and wrong types are ignored. */
  function setKey(key: string, value: unknown): void {
    if (value === undefined || !isDesktopKey(key)) {return;}
    const checked = sanitizeDesktopValue(key, value);
    if (!checked.ok) {return;}
    if (key === 'fileAssociationsOffered') {
      current.fileAssociationsOffered = checked.value as boolean;
      return;
    }
    const dot = key.indexOf('.');
    const group = current[key.slice(0, dot) as 'imagePaste'] as unknown as Record<string, unknown>;
    group[key.slice(dot + 1)] = checked.value;
  }

  function flat(): SettingsRecord {
    const out: SettingsRecord = {};
    for (const key of Object.keys(DESKTOP_KEY_DEFAULTS) as DesktopKey[]) {
      if (key === 'fileAssociationsOffered') {out[key] = current.fileAssociationsOffered;}
      else {
        const dot = key.indexOf('.');
        out[key] = (current[key.slice(0, dot) as 'imagePaste'] as unknown as Record<string, unknown>)[key.slice(dot + 1)];
      }
    }
    return out;
  }

  return {
    get: () => current,
    apply(patch) {
      for (const [key, value] of Object.entries(patch)) {
        received[key] = value;
        if (value && typeof value === 'object' && ['imagePaste', 'imageResize', 'versioning', 'updates', 'tree', 'outline'].includes(key)) {
          for (const [k, v] of Object.entries(value as Record<string, unknown>)) {setKey(`${key}.${k}`, v);}
        } else if (key === 'imagePasteEnabled') {
          setKey('imagePaste.enabled', value);
        } else {
          setKey(key, value);
        }
      }
    },
    pendingPatch: () => ({ ...received }),
    setTree(patch) {
      Object.assign(current.tree, patch);
      const flatPatch: SettingsRecord = {};
      for (const [k, v] of Object.entries(patch)) {
        received[`tree.${k}`] = v;
        flatPatch[`tree.${k}`] = v;
      }
      for (const fn of treeListeners) {fn(flatPatch);}
    },
    setOutline(patch) {
      const flatPatch: SettingsRecord = {};
      for (const [k, v] of Object.entries(patch)) {
        const key = `outline.${k}`;
        if (!isDesktopKey(key) || !sanitizeDesktopValue(key, v).ok) {continue;}
        setKey(key, v);
        received[key] = v;
        flatPatch[key] = v;
      }
      if (Object.keys(flatPatch).length === 0) {return;}
      for (const fn of outlineListeners) {fn(flatPatch);}
    },
    load(values) {
      Object.assign(current, cloneSettings(DEFAULT_DESKTOP_SETTINGS));
      // Keep the cleanup policy the schema does not expose.
      current.imagePaste.cleanupUnreferenced = initial.imagePaste.cleanupUnreferenced;
      for (const [key, value] of Object.entries(values)) {setKey(key, value);}
    },
    flat,
    onTreeChange: (fn) => { treeListeners.push(fn); },
    onOutlineChange: (fn) => { outlineListeners.push(fn); },
  };
}
