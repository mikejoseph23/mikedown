/**
 * The persisted settings model (M5). Both files (`<app-data>/settings.json`,
 * `<folder>/.mikedown/settings.json`) hold one flat JSON object. Core keys
 * are `MikeDownSettings` names (`fontSize`); desktop keys are dotted
 * (`versioning.keep`), exactly as the Settings modal and the VS Code shell
 * send them. Merge is shallow per top-level key, folder wins. Pure: no IO.
 */
import type { PathOps } from '@mikedown/core/shared/imagePaste';
import { isInside } from '../tree/treeLogic';

/** Desktop-owned keys and their defaults. */
export const DESKTOP_KEY_DEFAULTS = {
  'versioning.enabled': true,
  'versioning.keep': 25,
  'versioning.maxSizeMB': 2,
  'updates.checkOnLaunch': true,
  'imagePaste.enabled': true,
  'imagePaste.folder': 'images',
  'imagePaste.folderRelativeTo': 'document',
  'imagePaste.filenamePattern': '${docName}-${timestamp}',
  'imagePaste.pathStyle': 'relative',
  'imagePaste.altText': 'empty',
  'imagePaste.maxSizeMB': 10,
  'imageResize.overwrite': true,
  'tree.showHidden': false,
  'tree.confirmDelete': true,
  'outline.visibility': 'never',
  'outline.sectionPrefs': {} as Record<string, boolean>,
  fileAssociationsOffered: false,
} as const;

export type DesktopKey = keyof typeof DESKTOP_KEY_DEFAULTS;
export type SettingsRecord = Record<string, unknown>;

/** Reserved patch key: the modal's "Save for this folder" toggle. Never persisted. */
export const SAVE_FOR_FOLDER_KEY = 'app.saveForFolder';

/** Keys that never reach the editors or the files (the app follows the OS theme). */
const IGNORED_CORE_KEYS = new Set(['editorTheme']);

const NESTED_DESKTOP_GROUPS = new Set(['versioning', 'updates', 'imagePaste', 'imageResize', 'tree', 'outline']);

export function isDesktopKey(key: string): key is DesktopKey {
  return Object.prototype.hasOwnProperty.call(DESKTOP_KEY_DEFAULTS, key);
}

/**
 * Accept the nested shape too (`imagePaste: { folder }`), so every patch ends
 * up flat. Bare `confirmDelete` / `showHidden` (as the plan lists them) map
 * to the `tree.` keys.
 */
export function flattenPatch(patch: SettingsRecord): SettingsRecord {
  const out: SettingsRecord = {};
  for (const [key, value] of Object.entries(patch)) {
    if (NESTED_DESKTOP_GROUPS.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as SettingsRecord)) {out[`${key}.${k}`] = v;}
    } else if (key === 'confirmDelete' || key === 'showHidden') {
      out[`tree.${key}`] = value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function splitCoreAndDesktop(flat: SettingsRecord): { core: SettingsRecord; desktop: SettingsRecord } {
  const core: SettingsRecord = {};
  const desktop: SettingsRecord = {};
  for (const [key, value] of Object.entries(flat)) {
    if (key === SAVE_FOR_FOLDER_KEY) {continue;}
    if (isDesktopKey(key)) {desktop[key] = value;}
    else if (!IGNORED_CORE_KEYS.has(key) && !key.includes('.')) {core[key] = value;}
  }
  return { core, desktop };
}

/** Same type as the default (and a known enum member); otherwise the key is dropped. */
export function sanitizeDesktopValue(key: DesktopKey, value: unknown): { ok: true; value: unknown } | { ok: false } {
  const def = DESKTOP_KEY_DEFAULTS[key] as unknown;
  if (typeof def === 'boolean') {return typeof value === 'boolean' ? { ok: true, value } : { ok: false };}
  if (typeof def === 'number') {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? { ok: true, value } : { ok: false };
  }
  if (def && typeof def === 'object') {
    // `outline.sectionPrefs`: section name to collapsed.
    if (!value || typeof value !== 'object' || Array.isArray(value)) {return { ok: false };}
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'boolean') {out[k] = v;}
    }
    return { ok: true, value: out };
  }
  if (typeof value !== 'string' || value.trim() === '') {return { ok: false };}
  const enums: Partial<Record<DesktopKey, string[]>> = {
    'imagePaste.folderRelativeTo': ['document', 'workspace'],
    'imagePaste.pathStyle': ['relative', 'workspace-absolute'],
    'imagePaste.altText': ['empty', 'filename', 'prompt'],
    'outline.visibility': ['always', 'never'],
  };
  const allowed = enums[key];
  if (allowed && !allowed.includes(value)) {return { ok: false };}
  return { ok: true, value };
}

export type ParsedSettings =
  | { ok: true; value: SettingsRecord }
  | { ok: false; error: string };

/** Parse a settings file. Missing or empty is an empty file; non-objects are corrupt. */
export function parseSettingsText(text: string | null): ParsedSettings {
  if (text === null || text.trim() === '') {return { ok: true, value: {} };}
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'the top level must be a JSON object' };
  }
  return { ok: true, value: flattenPatch(raw as SettingsRecord) };
}

export interface OverrideProblem {
  key: string;
  reason: string;
}

/**
 * Folder override validation (edge case 29): `imagePaste.folder` must not
 * resolve to an absolute path outside the folder. A rejected key is dropped
 * (the global value stays); the reason goes into the banner.
 */
export function validateFolderOverride(
  override: SettingsRecord,
  folder: string,
  path: PathOps,
): { value: SettingsRecord; problems: OverrideProblem[] } {
  const value: SettingsRecord = {};
  const problems: OverrideProblem[] = [];
  for (const [key, v] of Object.entries(override)) {
    if (key === 'imagePaste.folder' && typeof v === 'string') {
      const expanded = v.replace(/\$\{docName\}/g, 'doc');
      const home = /^~(?:[\\/]|$)/.test(expanded);
      const absolute = path.isAbsolute(expanded);
      if (home || (absolute && !isInside(folder, path.normalize(expanded), path))) {
        problems.push({
          key,
          reason: `imagePaste.folder "${v}" points outside this folder, so it was ignored. Use a path inside the folder.`,
        });
        continue;
      }
    }
    value[key] = v;
  }
  return { value, problems };
}

/** Shallow per-key merge, later layers win. */
export function mergeSettings(...layers: SettingsRecord[]): SettingsRecord {
  return Object.assign({}, ...layers);
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
