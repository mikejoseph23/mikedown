/**
 * OS notification for a silently found update (U2), posted only when no
 * MikeDown window is focused, so a user at the app sees just the in-window
 * notice. Only the window that ran the silent check calls `found`, so one
 * notification goes out however many windows are open; a version is
 * announced at most once a day.
 *
 * The notification plugin reports no click on desktop, but clicking a banner
 * activates the app, so the first window to gain focus within
 * `CLICK_WINDOW_MS` of the notification opens the update window (`onFocus`).
 * The shared state lives in localStorage, which every window of the app
 * shares. Permission is asked for the first time a notification is needed,
 * never at launch.
 */
import type { UpdateInfo } from '../app/updaterApi';

export const NOTIFIED_KEY = 'mikedown.updater.notified';
/** A focus this soon after the notification counts as clicking it. */
export const CLICK_WINDOW_MS = 10 * 60 * 1000;
/** The same version is not posted again within this. */
export const RENOTIFY_MS = 24 * 60 * 60 * 1000;

export interface NotifierDeps {
  /** True when any MikeDown window has focus. */
  anyWindowFocused(): Promise<boolean>;
  /** Ask for permission if needed; false when refused. */
  ensurePermission(): Promise<boolean>;
  post(title: string, body: string): void;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  now(): number;
}

export interface UpdateNotifier {
  /** A silent check in this window found `info`. */
  found(info: UpdateInfo): Promise<boolean>;
  /** This window gained focus: true (once) when it should open the update window for `version`. */
  onFocus(version: string | null): boolean;
}

interface Notified {
  version: string;
  at: number;
  /** Cleared once a window has opened the update window for it. */
  pending: boolean;
}

export function createUpdateNotifier(deps: NotifierDeps): UpdateNotifier {
  const read = (): Notified | null => {
    try {
      const raw = deps.storage?.getItem(NOTIFIED_KEY);
      if (!raw) {return null;}
      const v = JSON.parse(raw) as Partial<Notified>;
      return typeof v.version === 'string' && typeof v.at === 'number' ? { version: v.version, at: v.at, pending: !!v.pending } : null;
    } catch {
      return null;
    }
  };
  const write = (v: Notified) => {
    try { deps.storage?.setItem(NOTIFIED_KEY, JSON.stringify(v)); } catch { /* storage unavailable */ }
  };

  return {
    async found(info) {
      const prior = read();
      if (prior && prior.version === info.version && deps.now() - prior.at < RENOTIFY_MS) {return false;}
      try {
        if (await deps.anyWindowFocused()) {return false;}
        if (!(await deps.ensurePermission())) {return false;}
        deps.post(`MikeDown ${info.version} is available`, `You have ${info.currentVersion}. Click to see what's new.`);
      } catch {
        return false;
      }
      write({ version: info.version, at: deps.now(), pending: true });
      return true;
    },

    onFocus(version) {
      const n = read();
      if (!n || !n.pending || !version || n.version !== version) {return false;}
      if (deps.now() - n.at > CLICK_WINDOW_MS) {return false;}
      write({ ...n, pending: false });
      return true;
    },
  };
}
