/**
 * Update checks (M10, edge case 17).
 *
 * - Silent: on launch (when `updates.checkOnLaunch` is on) and then every
 *   24 h. Each window ticks hourly and asks the host to `claim` the check, so
 *   the app checks once per day however many windows are open. Every failure
 *   (offline, bad manifest, signature) is logged and swallowed; the user hears
 *   only "update available".
 * - Manual (Help > Check for Updates…, the App tab button): explicit feedback
 *   for each outcome: up to date, update available, could not check.
 * - "Update available" is a toast with Restart Now / Later. The host emits it
 *   to every window, so whichever window the user is in shows it.
 * - Restart Now downloads and verifies, then runs the usual quit handshake
 *   (dirty-file dialog, sessions), installs and relaunches.
 *
 * Stable channel only: the endpoint is fixed in `tauri.conf.json`.
 */
import type { UpdateInfo, UpdaterApi } from './updaterApi';

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const TICK_MS = 60 * 60 * 1000;

export const MESSAGES = {
  checking: 'Checking for updates…',
  upToDate: (v: string) => `MikeDown is up to date (version ${v}).`,
  couldNotCheck: 'Could not check for updates. Check your internet connection and try again.',
  installFailed: 'The update could not be installed. Try again later, or download it from the MikeDown website.',
  downloading: (v: string) => `Downloading MikeDown ${v}…`,
};

export interface UpdatePrompt {
  /** Show "MikeDown X is available" with Restart Now / Later. */
  show(info: UpdateInfo, actions: { restartNow(): void; later(): void }): void;
  hide(): void;
}

export interface UpdaterDeps {
  api: UpdaterApi;
  prompt: UpdatePrompt;
  toast(message: string, opts?: { error?: boolean; ms?: number }): void;
  checkOnLaunch(): boolean;
  appVersion(): Promise<string>;
  setInterval(fn: () => void, ms: number): unknown;
}

export interface UpdaterController {
  /** Launch check (if enabled) and the hourly tick. */
  start(): Promise<void>;
  /** One silent check if this window wins the claim. */
  tick(): Promise<void>;
  manualCheck(): Promise<void>;
  /** The host announced an update (from any window's check). */
  announce(info: UpdateInfo): void;
  restartNow(): Promise<void>;
}

export function createUpdater(deps: UpdaterDeps): UpdaterController {
  let dismissed: string | null = null;
  let installing = false;
  let started = false;

  const log = (line: string) => deps.api.log(line).catch(() => { /* nothing left to tell */ });

  const controller: UpdaterController = {
    async start() {
      if (started) {return;}
      started = true;
      if (deps.checkOnLaunch()) {await controller.tick();}
      deps.setInterval(() => { void controller.tick(); }, TICK_MS);
    },

    async tick() {
      if (!deps.checkOnLaunch()) {return;}
      try {
        if (!(await deps.api.claim(CHECK_INTERVAL_MS))) {return;}
        // A found update arrives through `announce` (the host emits to all windows).
        await deps.api.check(false);
      } catch (e) {
        // The host already logged a failed check; this covers an invoke that never got there.
        void log(`silent check error: ${String(e)}`);
      }
    },

    async manualCheck() {
      deps.toast(MESSAGES.checking, { ms: 10_000 });
      let info: UpdateInfo | null;
      try {
        info = await deps.api.check(true);
      } catch (e) {
        void log(`manual check error: ${String(e)}`);
        deps.toast(MESSAGES.couldNotCheck, { error: true, ms: 6000 });
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
      controller.announce(info);
    },

    announce(info) {
      if (installing || dismissed === info.version) {return;}
      deps.prompt.show(info, {
        restartNow: () => { void controller.restartNow(); },
        later: () => {
          dismissed = info.version;
          deps.prompt.hide();
        },
      });
    },

    async restartNow() {
      if (installing) {return;}
      installing = true;
      deps.prompt.hide();
      let version = '';
      try { version = (await deps.api.pending())?.version ?? ''; } catch { /* label only */ }
      if (version) {deps.toast(MESSAGES.downloading(version), { ms: 60_000 });}
      try {
        // Resolves once the download is verified and the quit handshake has
        // started; the app then restarts, or stays up if a window cancelled.
        await deps.api.install();
      } catch (e) {
        void log(`install error: ${String(e)}`);
        deps.toast(MESSAGES.installFailed, { error: true, ms: 8000 });
      } finally {
        installing = false;
      }
    },
  };
  return controller;
}
