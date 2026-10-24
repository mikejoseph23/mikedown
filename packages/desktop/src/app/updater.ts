/**
 * Update checks and the update controller (M10, edge case 17; engine in U1).
 *
 * - Cadence (the constants below are the one place): the first silent check
 *   runs `FIRST_CHECK_DELAY_MS` after launch, then every `CHECK_INTERVAL_MS`.
 *   Each window ticks every `TICK_MS` and asks the host to `claim` the check,
 *   so the app checks once per interval however many windows are open. Every
 *   failure (offline, bad manifest, signature) is logged and swallowed; the
 *   user hears only "update available". The host also keeps a skipped version
 *   and a Remind Me Later snooze, and filters silent checks with them.
 * - Manual (Help > Check for Updates…, the App tab button): explicit feedback
 *   for each outcome, and it clears skip and snooze first (in the host). A
 *   manual check while a download is running does not restart it.
 * - The controller holds the state the UI renders:
 *   `idle → available → downloading → verifying → ready → installing | failed`.
 *   The host emits the same states to every window (`applyHostState`), plus
 *   download progress (`applyProgress`).
 * - "Update available" is the found-notice (`ui/updateToast.ts`), whose View
 *   opens the update window (`ui/updateWindow.ts`); a manual check opens the
 *   window directly. Install and Relaunch downloads and verifies, then runs
 *   the usual quit handshake (dirty-file dialog, sessions), installs and
 *   relaunches.
 *
 * Direct channel only: a store build (`MIKEDOWN_CHANNEL=store`) never starts
 * the timers, and the Check for Updates entries are hidden.
 */
import type { UpdateChannel, UpdateInfo, UpdateProgress, UpdaterApi, UpdateState, UpdateStateEvent } from './updaterApi';

/** First silent check after launch. */
export const FIRST_CHECK_DELAY_MS = 10 * 1000;
/** One silent check per this interval, app-wide. */
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
/** How often each window asks for the claim. */
export const TICK_MS = 15 * 60 * 1000;

export const MESSAGES = {
  checking: 'Checking for updates…',
  upToDate: (v: string) => `MikeDown is up to date (version ${v}).`,
  couldNotCheck: "Couldn't reach the update server. Check your connection and try again.",
  badFeed: 'The update feed returned an unexpected response. Try again later.',
  installFailed: "The update couldn't be installed. Please try again, or download it from the MikeDown website.",
  downloading: (v: string) => `Downloading MikeDown ${v}…`,
  installing: (v: string) => `Installing MikeDown ${v}…`,
};

export interface UpdatePrompt {
  /**
   * Offer the update: the found-notice, or the update window when `manual`
   * (the user asked) or when the window is already open. `later` hides the
   * notice for the session.
   */
  show(info: UpdateInfo, actions: { restartNow(): void; later(): void }, opts?: { manual?: boolean }): void;
  /** Hide the found-notice. The window closes itself (it follows the snapshot). */
  hide(): void;
  /** True while the update window is open and showing progress and failures itself. */
  showsProgress?(): boolean;
}

/**
 * Which manual-check failure line to show, from the host's error text.
 * Transport failures (offline, DNS, TLS, timeout) are "couldn't reach";
 * a manifest the plugin could not use (bad JSON, missing platform, a
 * non-success status, a bad signature field) is "unexpected response".
 */
export function classifyCheckError(error: unknown): 'network' | 'feed' {
  const text = String(error);
  if (/release JSON|platforms|expected value|invalid type|missing field|unknown variant|semver|signature|base64|could not be decoded|trailing characters|EOF while parsing|unexpected character/i.test(text)) {
    return 'feed';
  }
  return 'network';
}

export interface UpdaterDeps {
  api: UpdaterApi;
  prompt: UpdatePrompt;
  toast(message: string, opts?: { error?: boolean; ms?: number }): void;
  checkOnLaunch(): boolean;
  /** A silent check found an update (only in the window that ran the check). */
  onSilentFound?(info: UpdateInfo): void;
  appVersion(): Promise<string>;
  setInterval(fn: () => void, ms: number): unknown;
  setTimeout(fn: () => void, ms: number): unknown;
}

export interface UpdaterSnapshot {
  state: UpdateState;
  /** The pending update, once a check has found one. */
  info: UpdateInfo | null;
  /** Latest download progress; null outside `downloading`. */
  progress: UpdateProgress | null;
  /** Host error text when `state` is `failed`. */
  error: string | null;
}

export interface UpdaterController {
  /** Resolves the channel, then schedules the launch check and the tick. */
  start(): Promise<void>;
  /** One silent check if this window wins the claim. */
  tick(): Promise<void>;
  manualCheck(): Promise<void>;
  /** The host announced an update (from any window's check). */
  announce(info: UpdateInfo): void;
  /** The host's phase changed (any window's action). */
  applyHostState(e: UpdateStateEvent): void;
  applyProgress(p: UpdateProgress): void;
  restartNow(): Promise<void>;
  /** Skip This Version. */
  skip(): Promise<void>;
  /** Remind Me Later (host default 14 days). */
  snooze(days?: number): Promise<void>;
  getSnapshot(): UpdaterSnapshot;
  subscribe(fn: (s: UpdaterSnapshot) => void): () => void;
  channel(): UpdateChannel;
}

const BUSY: ReadonlySet<UpdateState> = new Set(['downloading', 'verifying', 'installing']);

export function createUpdater(deps: UpdaterDeps): UpdaterController {
  let dismissed: string | null = null;
  let started = false;
  let channel: UpdateChannel = 'direct';
  let snap: UpdaterSnapshot = { state: 'idle', info: null, progress: null, error: null };
  const listeners = new Set<(s: UpdaterSnapshot) => void>();

  const log = (line: string) => deps.api.log(line).catch(() => { /* nothing left to tell */ });

  const set = (patch: Partial<UpdaterSnapshot>) => {
    snap = { ...snap, ...patch };
    for (const fn of [...listeners]) {fn(snap);}
  };

  const isBusy = () => BUSY.has(snap.state);

  const showPrompt = (info: UpdateInfo, manual = false) => {
    deps.prompt.show(info, {
      restartNow: () => { void controller.restartNow(); },
      later: () => {
        dismissed = info.version;
        deps.prompt.hide();
      },
    }, { manual });
  };

  /** Re-read the host's phase after an action, in case an event was missed. */
  const refresh = async () => {
    try {
      const s = await deps.api.status();
      controller.applyHostState({ state: s.phase, version: s.version, error: null });
    } catch { /* keep what we have */ }
  };

  const announce = (info: UpdateInfo, manual: boolean) => {
    const sameReady = snap.state === 'ready' && snap.info?.version === info.version;
    set({
      info,
      ...(isBusy() || sameReady ? {} : { state: 'available' as const, progress: null, error: null }),
    });
    if (manual) {
      showPrompt(info, true);
      return;
    }
    if (isBusy() || dismissed === info.version) {return;}
    showPrompt(info);
  };

  const controller: UpdaterController = {
    async start() {
      if (started) {return;}
      started = true;
      try {
        const s = await deps.api.status();
        channel = s.channel;
        if (s.phase !== 'idle') {controller.applyHostState({ state: s.phase, version: s.version, error: null });}
      } catch { /* not under Tauri, or the host is old: assume direct */ }
      if (channel === 'store') {return;}
      deps.setTimeout(() => { void controller.tick(); }, FIRST_CHECK_DELAY_MS);
      deps.setInterval(() => { void controller.tick(); }, TICK_MS);
    },

    async tick() {
      if (channel === 'store' || !deps.checkOnLaunch()) {return;}
      try {
        if (!(await deps.api.claim(CHECK_INTERVAL_MS))) {return;}
        // A found update arrives through `announce` (the host emits to all windows).
        const info = await deps.api.check(false);
        if (info) {deps.onSilentFound?.(info);}
      } catch (e) {
        // The host already logged a failed check; this covers an invoke that never got there.
        void log(`silent check error: ${String(e)}`);
      }
    },

    async manualCheck() {
      if (isBusy()) {
        // Never restart a download or install that is already running; show
        // its progress instead.
        if (snap.info) {
          showPrompt(snap.info, true);
          return;
        }
        const v = '';
        deps.toast(snap.state === 'installing' ? MESSAGES.installing(v) : MESSAGES.downloading(v), { ms: 5000 });
        return;
      }
      deps.toast(MESSAGES.checking, { ms: 10_000 });
      let info: UpdateInfo | null;
      try {
        info = await deps.api.check(true);
      } catch (e) {
        void log(`manual check error: ${String(e)}`);
        deps.toast(classifyCheckError(e) === 'feed' ? MESSAGES.badFeed : MESSAGES.couldNotCheck, { error: true, ms: 6000 });
        return;
      }
      if (!info) {
        let v = '';
        try { v = await deps.appVersion(); } catch { /* version unknown */ }
        deps.toast(v ? MESSAGES.upToDate(v) : 'MikeDown is up to date.', { ms: 5000 });
        return;
      }
      // The event normally shows the prompt; a manual check shows it even
      // after Later, since the user asked.
      dismissed = null;
      announce(info, true);
    },

    announce(info) {
      announce(info, false);
    },

    applyHostState(e) {
      const wasInstalling = snap.state === 'installing';
      if (e.state === 'idle') {
        set({ state: 'idle', info: null, progress: null, error: null });
        deps.prompt.hide();
        return;
      }
      const keepProgress = e.state === 'downloading' || e.state === 'verifying';
      set({ state: e.state, error: e.error, progress: keepProgress ? snap.progress : null });
      if (BUSY.has(e.state)) {
        deps.prompt.hide();
      } else if (e.state === 'ready' && snap.info && !wasInstalling && dismissed !== snap.info.version) {
        // Back to ready after a cancelled quit dialog (or a background download): offer it again.
        showPrompt(snap.info);
      }
    },

    applyProgress(p) {
      set({ progress: p });
    },

    async restartNow() {
      if (isBusy()) {return;}
      deps.prompt.hide();
      // Synchronously, so a double click cannot start two installs.
      set({ state: 'downloading', progress: null, error: null });
      let version = snap.info?.version ?? '';
      if (!version) {
        try { version = (await deps.api.pending())?.version ?? ''; } catch { /* label only */ }
      }
      // The update window shows the progress itself when it is open.
      if (version && !deps.prompt.showsProgress?.()) {deps.toast(MESSAGES.downloading(version), { ms: 60_000 });}
      try {
        // Resolves once the download is verified and the quit handshake has
        // started; the app then restarts, or stays up if a window cancelled.
        await deps.api.install();
      } catch (e) {
        void log(`install error: ${String(e)}`);
        set({ state: 'failed', error: String(e) });
        if (!deps.prompt.showsProgress?.()) {deps.toast(MESSAGES.installFailed, { error: true, ms: 8000 });}
        return;
      }
      await refresh();
    },

    async skip() {
      const version = snap.info?.version;
      if (!version) {return;}
      try { await deps.api.skip(version); } catch (e) { void log(`skip error: ${String(e)}`); }
      dismissed = version;
      deps.prompt.hide();
      if (!isBusy()) {set({ state: 'idle', info: null, progress: null, error: null });}
    },

    async snooze(days) {
      try { await deps.api.snooze(days); } catch (e) { void log(`snooze error: ${String(e)}`); }
      if (snap.info) {dismissed = snap.info.version;}
      deps.prompt.hide();
    },

    getSnapshot: () => snap,

    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },

    channel: () => channel,
  };
  return controller;
}
