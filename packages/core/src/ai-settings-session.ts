/**
 * One editing session over the AI settings, shared by the Settings modal's AI
 * tab (`ai-settings.ts`) and the AI Engines page (`ai-engines-page.ts`): the
 * draft, the save patch, and the bookkeeping that keeps API keys and early
 * saves honest. No DOM; each view owns its own rendering and announcements.
 *
 * Everything edits a draft copy of the settings; `collect` gives only the
 * `ai.*` keys that changed. API keys never touch the draft: they go through
 * `host.ai.setSecret` as soon as a field settles, and a deleted engine's key
 * is dropped on `commit`. Test connection and fetching models need the host
 * to know the engine, so `ensureSaved` saves the engines first and waits for
 * the host's settings echo. `discard` takes back engines added in this
 * session that reached the host that way, and their keys.
 *
 * The page opened from the tab runs a child session (`fork`): it starts from
 * the tab's draft, shares what the session knows about the host (statuses,
 * stored keys), and on Done the tab `absorb`s the saved result.
 */

import { serializeAiSettings, toAiError } from './ai';
import type { AiEngineConfig, AiEngineStatus, AiKeySource, AiSettings, AiSettingsPatch, MikeDownAiHost } from './ai';
import type { AiHostTier } from './ai-settings-model';
import { aiHostTier, changedAiPatch, cloneAiSettings, connectionDiffers, removeEngine, withEngine } from './ai-settings-model';

export interface AiSettingsSessionOptions {
  ai: MikeDownAiHost;
  /** The settings the session starts from (the host's, or a parent session's draft). */
  settings: AiSettings;
  /** Last known engine statuses. */
  statuses: readonly AiEngineStatus[];
  /** The host's settings now (they change when the session saves engines before a test). */
  getHostSettings(): AiSettings;
  /** Persist an AI patch right away. Absent when the host cannot persist settings. */
  saveNow?(patch: AiSettingsPatch): void;
  /** Resolves with the host's next settings `accept` likes, or null after `timeoutMs`. */
  waitForSettings(accept: (s: AiSettings) => boolean, timeoutMs: number): Promise<AiSettings | null>;
  /** Fresh statuses (list, test, discover) for the editor's cache and the indicator. */
  onStatuses(statuses: AiEngineStatus[]): void;
  /** Statuses that arrive without the view asking (a host push, a settings refresh). Returns an unsubscribe. */
  subscribeStatuses?(listener: (statuses: AiEngineStatus[]) => void): () => void;
}

export interface AiSettingsSession {
  readonly ai: MikeDownAiHost;
  readonly tier: AiHostTier;
  /** Last known statuses by engine id (the engine form writes fresh ones here too). */
  readonly statuses: Map<string, AiEngineStatus>;
  /** The settings being edited. Views replace it with a new object on every change. */
  draft: AiSettings;
  /** What the draft started from, minus whatever a child session already saved. */
  readonly original: AiSettings;
  readonly options: AiSettingsSessionOptions;
  getEngine(id: string): AiEngineConfig | undefined;
  statusList(): AiEngineStatus[];
  hasKey(id: string): boolean;
  /** Where the engine's key comes from, when the host said (a key stored here counts as stored). */
  keySource(id: string): AiKeySource | undefined;
  /** Store or clear a key through `host.ai.setSecret`; resolves with an error message, or null when it worked. */
  setKey(id: string, value: string | null): Promise<string | null>;
  /** Make sure the host has this engine's connection fields before asking it to reach it. */
  ensureSaved(id: string): Promise<void>;
  /** True when Test and fetching will save the engine first. */
  savesFirst(id: string): boolean;
  /** Add an engine to the draft; it is taken back from the host if the session is discarded. */
  addEngine(engine: AiEngineConfig): void;
  /** Remove an engine (and the routes to it); its key is dropped on commit. */
  deleteEngine(id: string): void;
  updateEngine(id: string, patch: Partial<AiEngineConfig>): void;
  /** The `ai.*` keys that changed. */
  collect(): AiSettingsPatch;
  /** Closing now would lose something. */
  dirty(): boolean;
  /** Fresh statuses from the host (tier 2). Resolves true when they arrived. */
  refreshStatuses(): Promise<boolean>;
  /** Options for a child session that starts from this draft and shares what this one knows about the host. */
  fork(): AiSettingsSessionOptions & { keyOverride: Map<string, boolean>; statusMap: Map<string, AiEngineStatus> };
  /** A child saved `patch`, ending at `saved`: take it as the new draft, and as saved for those keys. */
  absorb(saved: AiSettings, patch: AiSettingsPatch): void;
  /** Closed without saving: take back engines added here that reached the host, drop their keys. */
  discard(): void;
  /** Saved: drop the keys of deleted engines. Returns a copy of the saved draft. */
  commit(): AiSettings;
}

/** How long Test and fetching models wait for the host to echo engines the session just saved. */
const SAVE_ECHO_TIMEOUT_MS = 4000;

export function createAiSettingsSession(
  options: AiSettingsSessionOptions & { keyOverride?: Map<string, boolean>; statusMap?: Map<string, AiEngineStatus> },
): AiSettingsSession {
  const { ai } = options;
  let original = cloneAiSettings(options.settings);
  let draft = cloneAiSettings(options.settings);
  // A child session shares its parent's map, so a test or fetch on the page freshens the tab's dots too (F8).
  const statuses = options.statusMap ?? new Map<string, AiEngineStatus>(options.statuses.map((s) => [s.engineId, s]));
  /** `hasKey` learned from Store / Clear, ahead of the next status (shared with child sessions). */
  const keyOverride = options.keyOverride ?? new Map<string, boolean>();
  /** Engines deleted in this session: their keys are dropped on commit. */
  const deleted = new Set<string>();
  /** Engines this session stored a key for; dropped again if the session is discarded before the engine is saved. */
  const keysStored = new Set<string>();
  /** Engines added in this session (taken back from the host if the session is discarded). */
  const added = new Set<string>();

  const getEngine = (id: string) => draft.engines.find((e) => e.id === id);
  const statusList = () => [...statuses.values()];

  const session: AiSettingsSession = {
    ai,
    tier: aiHostTier(ai),
    statuses,
    options,
    get draft() { return draft; },
    set draft(next: AiSettings) { draft = next; },
    get original() { return original; },
    getEngine,
    statusList,
    hasKey: (id) => keyOverride.get(id) ?? statuses.get(id)?.hasKey ?? false,
    keySource: (id) => {
      const stored = keyOverride.get(id);
      return stored === undefined ? statuses.get(id)?.keySource : stored ? 'stored' : undefined;
    },

    async setKey(id, value) {
      if (!getEngine(id) || !ai.setSecret) {return 'This app cannot store keys.';}
      try {
        await ai.setSecret(id, value);
        keyOverride.set(id, value !== null);
        if (value !== null) {keysStored.add(id);} else {keysStored.delete(id);}
        return null;
      } catch (err) {
        return `The key could not be ${value !== null ? 'stored' : 'cleared'}: ${toAiError(err).message}`;
      }
    },

    async ensureSaved(id) {
      const engine = getEngine(id);
      if (!engine || !options.saveNow) {return;}
      if (!connectionDiffers(options.getHostSettings().engines.find((e) => e.id === id), engine)) {return;}
      options.saveNow({ 'ai.engines': serializeAiSettings(draft)['ai.engines'] });
      await options.waitForSettings((s) => !connectionDiffers(s.engines.find((e) => e.id === id), engine), SAVE_ECHO_TIMEOUT_MS);
    },

    savesFirst(id) {
      const engine = getEngine(id);
      return !!options.saveNow && !!engine && connectionDiffers(options.getHostSettings().engines.find((e) => e.id === id), engine);
    },

    addEngine(engine) {
      draft = { ...draft, engines: [...draft.engines, engine] };
      added.add(engine.id);
    },

    deleteEngine(id) {
      if (!getEngine(id)) {return;}
      draft = removeEngine(draft, id);
      deleted.add(id);
    },

    updateEngine(id, patch) {
      const current = getEngine(id);
      if (current) {draft = withEngine(draft, { ...current, ...patch });}
    },

    collect: () => changedAiPatch(original, draft),

    dirty() {
      if (Object.keys(changedAiPatch(original, draft)).length > 0) {return true;}
      // An added engine that Test saved early and then deleted again still sits on the host.
      return options.getHostSettings().engines.some((e) => added.has(e.id) && !getEngine(e.id));
    },

    async refreshStatuses() {
      if (!ai.listEngines) {return false;}
      try {
        const list = await ai.listEngines();
        for (const s of list) {statuses.set(s.engineId, s);}
        options.onStatuses(statusList());
        return true;
      } catch {
        return false; // keep the last known statuses
      }
    },

    fork() {
      return { ...options, settings: cloneAiSettings(draft), statuses: statusList(), keyOverride, statusMap: statuses };
    },

    absorb(saved, patch) {
      draft = cloneAiSettings(saved);
      original = withSavedAiKeys(original, saved, patch);
    },

    discard() {
      // Engines added in this session reach the host early (Test and fetching
      // save them first). Closing without saving takes them back.
      const host = options.getHostSettings();
      if (options.saveNow && host.engines.some((e) => added.has(e.id))) {
        const kept = { ...host, engines: host.engines.filter((e) => !added.has(e.id)) };
        options.saveNow({ 'ai.engines': serializeAiSettings(kept)['ai.engines'] });
      }
      // The host keeps a key for an engine id it has never seen; if that
      // engine was never saved, nothing would ever clean it up.
      if (!ai.setSecret) {return;}
      const saved = new Set(host.engines.filter((e) => !added.has(e.id)).map((e) => e.id));
      for (const id of keysStored) {
        if (!saved.has(id)) {ai.setSecret(id, null).catch(() => { /* best effort */ });}
      }
    },

    commit() {
      if (ai.setSecret) {
        for (const id of deleted) {
          if (getEngine(id)) {continue;}
          ai.setSecret(id, null).catch(() => { /* the host also drops orphaned keys */ });
        }
      }
      return cloneAiSettings(draft);
    },
  };
  return session;
}

/** `base` with the fields `patch` saved taken from `saved` (`ai.engines` → `engines`, ...). */
export function withSavedAiKeys(base: AiSettings, saved: AiSettings, patch: AiSettingsPatch): AiSettings {
  const next = { ...base } as Record<string, unknown>;
  const from = saved as unknown as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    const field = key.replace(/^ai\./, '');
    if (field in from) {next[field] = JSON.parse(JSON.stringify(from[field]));}
  }
  return next as unknown as AiSettings;
}
