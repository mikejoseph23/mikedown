/**
 * The settings manager (M5): reads the global and folder files, merges them
 * (shallow per key, folder wins), applies the result to the desktop store and
 * every editor, routes saves to the right file and tells the other windows.
 *
 * Rules it keeps:
 *
 * - A corrupt file loads as defaults for that file and is never overwritten
 *   automatically; the banner offers "Open file" and "Reset to defaults" and
 *   only the click writes (edge case 16). Saves aimed at a corrupt file are
 *   refused with a toast.
 * - `.mikedown/` is created only when a save is routed to the folder (the
 *   modal's "Save for this folder" toggle), by the Rust write command.
 * - The folder file holds only keys that differ from what the window already
 *   had, so it stays a small override rather than a copy of the global file.
 * - A folder `imagePaste.folder` pointing outside the folder is dropped with a
 *   reason in the banner (edge case 29).
 */
import type { MikeDownSettings } from '@mikedown/core';
import type { PathOps } from '@mikedown/core/shared/imagePaste';
import { DESKTOP_CORE_SETTING_DEFAULTS, type DesktopSettingsStore } from './desktopSettings';
import {
  flattenPatch,
  isDesktopKey,
  mergeSettings,
  parseSettingsText,
  sameValue,
  sanitizeDesktopValue,
  SAVE_FOR_FOLDER_KEY,
  splitCoreAndDesktop,
  validateFolderOverride,
  type SettingsRecord,
} from './schema';
import type { SettingsApi, SettingsChangedEvent, SettingsScope } from './settingsApi';

/** Reserved patch key: the visual core values the App section read when the modal opened. */
export const CORE_BASELINE_KEY = 'app.coreBaseline';

/**
 * What core's Settings modal shows for a key nobody has set. Used to tell a
 * changed core key from an untouched one when only the changes may be saved.
 */
export const CORE_KEY_DEFAULTS: Partial<MikeDownSettings> = {
  ctrlWheelZoom: true,
  renderMermaidDiagrams: true,
  renderMath: true,
  tagsEnabled: true,
  linkClickBehavior: 'openNewTab',
  headingNumbering: 'off',
  slashCommandsEnabled: true,
  slashCommandsDateFormat: 'iso',
  slashCommandsTimeZone: 'local',
  markdownNormalization: 'preserve',
  normalizationStyle: { boldMarker: '**', italicMarker: '*', listMarker: '-', headingStyle: 'atx' },
  spellCheckLanguage: 'en',
  spellCheckIgnoreCodeBlocks: true,
  spellCheckUserWords: [],
  ...DESKTOP_CORE_SETTING_DEFAULTS,
};

export interface BannerAction {
  label: string;
  run(): void;
}
export interface BannerItem {
  id: string;
  message: string;
  actions: BannerAction[];
}
export interface SettingsBanner {
  show(items: BannerItem[]): void;
  clear(): void;
}

export interface SettingsManagerDeps {
  api: SettingsApi;
  path: PathOps;
  store: DesktopSettingsStore;
  /** The window's open folder, if any. */
  folder(): string | null;
  /** Window label, so a window ignores its own change event. */
  windowLabel: string;
  /** Push core settings to every editor (`handle.updateSettings`). */
  applyCore(patch: Partial<MikeDownSettings>): void;
  /** Desktop-side effects of changed values (tree refresh, …). Called after every load. */
  desktopChanged?(prev: SettingsRecord, next: SettingsRecord): void;
  banner: SettingsBanner;
  notify(message: string, opts?: { error?: boolean }): void;
  /** Open a file in the OS default app ("Open file" in the banner). */
  openFile(path: string): Promise<void> | void;
}

interface FileState {
  scope: SettingsScope;
  path: string;
  /** Parsed flat values; empty when the file is missing or corrupt. */
  values: SettingsRecord;
  /** Set when the file exists but is not a JSON object. */
  corrupt: string | null;
}

export interface SettingsManager {
  /** Read both files and apply the merged result everywhere. */
  load(): Promise<void>;
  /** `host.saveSettings`: route the patch to the global or folder file. */
  save(patch: Record<string, unknown>, opts?: { silent?: boolean; force?: boolean }): Promise<void>;
  /** Core settings every new editor starts with. */
  coreSettings(): Partial<MikeDownSettings>;
  /** Desktop defaults, merged files; dotted desktop keys plus core keys. */
  effective(): SettingsRecord;
  /** True when the folder file exists and the last load read it. */
  folderFileState(): { exists: boolean; path: string | null };
  resetFile(scope: SettingsScope): Promise<void>;
  /** Subscribe to other windows' saves. Resolves to the unsubscribe function. */
  listen(): Promise<() => void>;
}

export function createSettingsManager(deps: SettingsManagerDeps): SettingsManager {
  const { api, store, path } = deps;
  let globalFile: FileState = { scope: 'global', path: '', values: {}, corrupt: null };
  let folderFile: FileState | null = null;
  let loadedFolder: string | null = null;
  let core: SettingsRecord = {};
  let lastCoreApplied: SettingsRecord = {};
  let lastDesktop: SettingsRecord = store.flat();
  /** Core values the modal showed after the last save (exact baseline for the next diff). */
  let knownCore: SettingsRecord = {};
  let overrideProblems: string[] = [];

  async function readFile(scope: SettingsScope, folder: string | null): Promise<FileState> {
    let info: { path: string; text: string | null } | null = null;
    try {
      info = (await api.read(scope, folder)) ?? null;
    } catch (err) {
      console.warn(`MikeDown: ${scope} settings unreadable`, err);
    }
    const parsed = parseSettingsText(info?.text ?? null);
    return {
      scope,
      path: info?.path ?? '',
      values: parsed.ok ? parsed.value : {},
      corrupt: parsed.ok ? null : parsed.error,
    };
  }

  function showBanner(): void {
    const items: BannerItem[] = [];
    for (const file of [globalFile, folderFile]) {
      if (!file?.corrupt) {continue;}
      const which = file.scope === 'global' ? 'Your settings file' : "This folder's settings file";
      items.push({
        id: `corrupt-${file.scope}`,
        message: `${which} could not be read (${file.corrupt}), so defaults are in use. The file has not been changed.`,
        actions: [
          { label: 'Open file', run: () => { void Promise.resolve(deps.openFile(file.path)).catch((err: unknown) => deps.notify(String(err), { error: true })); } },
          { label: 'Reset to defaults', run: () => { void manager.resetFile(file.scope); } },
        ],
      });
    }
    for (const [i, reason] of overrideProblems.entries()) {
      items.push({
        id: `override-${i}`,
        message: reason,
        actions: folderFile?.path
          ? [{ label: 'Open file', run: () => { void Promise.resolve(deps.openFile(folderFile!.path)).catch(() => { /* gone */ }); } }]
          : [],
      });
    }
    if (items.length) {deps.banner.show(items);} else {deps.banner.clear();}
  }

  const manager: SettingsManager = {
    async load() {
      const folder = deps.folder();
      globalFile = await readFile('global', null);
      folderFile = folder ? await readFile('folder', folder) : null;
      loadedFolder = folder;

      overrideProblems = [];
      let folderValues: SettingsRecord = {};
      if (folderFile && folder && !folderFile.corrupt) {
        const checked = validateFolderOverride(folderFile.values, folder, path);
        folderValues = checked.value;
        overrideProblems = checked.problems.map((p) => p.reason);
      }

      const merged = mergeSettings(globalFile.values, folderValues);
      const { core: coreValues, desktop } = splitCoreAndDesktop(merged);
      const prev = lastDesktop;
      store.load(desktop);
      lastDesktop = store.flat();

      core = coreValues;
      knownCore = {};
      // A key a previous folder set and this one does not falls back to the
      // global value (or stays as it was when no file has it).
      const toApply: SettingsRecord = { ...DESKTOP_CORE_SETTING_DEFAULTS, ...core };
      for (const key of Object.keys(lastCoreApplied)) {
        if (!(key in toApply) && key in globalFile.values) {toApply[key] = globalFile.values[key];}
      }
      lastCoreApplied = toApply;
      deps.applyCore(toApply as Partial<MikeDownSettings>);
      deps.desktopChanged?.(prev, lastDesktop);
      showBanner();
    },

    async save(rawPatch, opts) {
      const flat = flattenPatch(rawPatch);
      const wantsFolder = flat[SAVE_FOR_FOLDER_KEY] === true;
      const folder = deps.folder();
      const toFolder = wantsFolder && !!folder;
      const baseline = (flat[CORE_BASELINE_KEY] ?? {}) as SettingsRecord;
      const { core: coreIn, desktop: desktopIn } = splitCoreAndDesktop(flat);

      // The editors and the store take the patch right away (the modal already
      // applied the visual ones live); persistence follows.
      const changes: SettingsRecord = {};
      const current = store.flat();
      for (const [key, value] of Object.entries(desktopIn)) {
        if (!isDesktopKey(key)) {continue;}
        const checked = sanitizeDesktopValue(key, value);
        if (!checked.ok) {continue;}
        // `force`: the store already holds the value (a tree toggle), so a diff would find nothing.
        if (opts?.force || !sameValue(checked.value, current[key])) {changes[key] = checked.value;}
      }
      for (const [key, value] of Object.entries(coreIn)) {
        const base = key in knownCore ? knownCore[key]
          : key in core ? core[key]
          : key in baseline && baseline[key] !== '' ? baseline[key]
          : (CORE_KEY_DEFAULTS as SettingsRecord)[key];
        if (base === undefined) {
          // Nothing to compare with: a global save keeps it, a folder override
          // would otherwise copy the whole modal into the folder file.
          if (!toFolder) {changes[key] = value;}
        } else if (!sameValue(value, base)) {
          changes[key] = value;
        }
      }
      knownCore = { ...knownCore, ...coreIn };

      if (Object.keys(changes).length === 0) {
        if (!opts?.silent) {deps.notify('Settings saved.');}
        return;
      }

      const scope: SettingsScope = toFolder ? 'folder' : 'global';
      let toWrite = changes;
      if (scope === 'folder' && folder) {
        const checked = validateFolderOverride(changes, folder, path);
        toWrite = checked.value;
        if (checked.problems.length) {deps.notify(checked.problems.map((p) => p.reason).join(' '), { error: true });}
      }

      // Another window may have written since we loaded: merge into what is on disk now.
      const fresh = await readFile(scope, scope === 'folder' ? folder : null);
      if (fresh.corrupt) {
        deps.notify('The settings file is damaged, so nothing was saved. Use Open file or Reset to defaults in the banner.', { error: true });
        // Keep the session consistent with what the user just chose.
        store.apply(toWrite);
        const { core: sessionCore } = splitCoreAndDesktop(toWrite);
        deps.applyCore(sessionCore as Partial<MikeDownSettings>);
        return;
      }
      if (Object.keys(toWrite).length === 0) {return;}
      const next = { ...fresh.values, ...toWrite };
      const text = `${JSON.stringify(next, null, 2)}\n`;
      try {
        await api.write(scope, scope === 'folder' ? folder : null, text);
      } catch (err) {
        deps.notify(`Could not save settings: ${String(err)}`, { error: true });
        return;
      }
      const keepKnown = knownCore;
      await manager.load();
      knownCore = keepKnown;
      void api.emitChanged({ from: deps.windowLabel, scope, folder: scope === 'folder' ? folder : null }).catch(() => { /* not under Tauri */ });
      if (!opts?.silent) {
        deps.notify(scope === 'folder' ? 'Settings saved for this folder.' : 'Settings saved.');
      }
    },

    coreSettings: () => ({ ...DESKTOP_CORE_SETTING_DEFAULTS, ...core }) as Partial<MikeDownSettings>,
    effective: () => ({ ...store.flat(), ...DESKTOP_CORE_SETTING_DEFAULTS, ...core }),
    folderFileState: () => ({ exists: !!folderFile && (folderFile.corrupt !== null || Object.keys(folderFile.values).length > 0), path: folderFile?.path ?? null }),

    async resetFile(scope) {
      const folder = deps.folder();
      if (scope === 'folder' && !folder) {return;}
      try {
        await api.write(scope, scope === 'folder' ? folder : null, '{}\n');
      } catch (err) {
        deps.notify(`Could not reset the settings file: ${String(err)}`, { error: true });
        return;
      }
      await manager.load();
      void api.emitChanged({ from: deps.windowLabel, scope, folder: scope === 'folder' ? folder : null }).catch(() => { /* not under Tauri */ });
      deps.notify('Settings reset to defaults.');
    },

    async listen() {
      const unlisten = await api.onChanged((e: SettingsChangedEvent) => {
        if (e.from === deps.windowLabel) {return;}
        // Another folder's override does not concern this window.
        if (e.scope === 'folder' && e.folder !== loadedFolder) {return;}
        void manager.load();
      });
      return unlisten;
    },
  };
  return manager;
}
