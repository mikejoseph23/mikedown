/**
 * Pure state-to-view mapping for the update window (U2) and the Settings
 * "Last checked" line. The wording is the spec in desktop-auto-update-plan.md
 * ("Update UX"); keep it here so the window and the tests share one copy.
 */
import type { UpdaterSnapshot } from '../app/updater';
import type { UpdateProgress } from '../app/updaterApi';

export const WEBSITE_URL = 'https://www.iadev.net/mikedown/';

export const UPDATE_TEXT = {
  title: 'A new version of MikeDown is available',
  subtitle: (next: string, current: string) =>
    current ? `MikeDown ${next} is available. You have ${current}.` : `MikeDown ${next} is available.`,
  major: 'This is a major update and may include important changes.',
  notesHeading: "What's new",
  noNotes: 'No release notes were provided for this version.',
  skip: 'Skip This Version',
  later: 'Remind Me Later',
  install: 'Install and Relaunch',
  hide: 'Hide',
  downloading: 'Downloading update…',
  downloadingPercent: (pct: number) => `Downloading update… ${pct}%`,
  verifying: 'Verifying…',
  ready: "Update ready. Install when you're ready.",
  installingWindows: 'Installing. MikeDown will reopen in a moment.',
  installingMac: 'Installing. MikeDown will relaunch in a moment.',
  failed: "The update couldn't be installed. Please try again, or download it from the MikeDown website.",
  websiteLink: 'MikeDown website',
  noticeTitle: (v: string) => `MikeDown ${v} is available`,
  noticeView: 'View',
  noticeClose: 'Close',
};

/**
 * What the window shows:
 * - `offer`: notes and the three buttons (available, or idle with an update in hand).
 * - `progress`: the buttons give way to a progress bar (downloading, verifying).
 * - `ready`: back to the buttons with the "Update ready" line (cancelled quit dialog).
 * - `installing`: the bar, indeterminate, and the reopen line.
 * - `failed`: the failure line with the website link, and the buttons to try again.
 */
export type UpdateWindowMode = 'offer' | 'progress' | 'ready' | 'installing' | 'failed';

export interface UpdateWindowView {
  mode: UpdateWindowMode;
  /** The line above the buttons or beside the bar; null in `offer`. */
  status: string | null;
  /** 0–100 for a determinate bar, null for indeterminate; undefined when no bar shows. */
  percent?: number | null;
  /** True when the three buttons show. */
  buttons: boolean;
  /** True when the status line is an error. */
  error: boolean;
  /** Show the website link (failure). */
  websiteLink: boolean;
}

/** Whole percent, clamped; null when the total is unknown. */
export function progressPercent(p: UpdateProgress | null): number | null {
  if (!p || !p.total || p.total <= 0) {return null;}
  return Math.max(0, Math.min(100, Math.floor((p.downloaded / p.total) * 100)));
}

export function updateWindowView(snap: Pick<UpdaterSnapshot, 'state' | 'progress'>, opts: { windows: boolean }): UpdateWindowView {
  switch (snap.state) {
    case 'downloading': {
      const pct = progressPercent(snap.progress);
      return {
        mode: 'progress',
        status: pct === null ? UPDATE_TEXT.downloading : UPDATE_TEXT.downloadingPercent(pct),
        percent: pct,
        buttons: false,
        error: false,
        websiteLink: false,
      };
    }
    case 'verifying':
      return { mode: 'progress', status: UPDATE_TEXT.verifying, percent: null, buttons: false, error: false, websiteLink: false };
    case 'installing':
      return {
        mode: 'installing',
        status: opts.windows ? UPDATE_TEXT.installingWindows : UPDATE_TEXT.installingMac,
        percent: null,
        buttons: false,
        error: false,
        websiteLink: false,
      };
    case 'ready':
      return { mode: 'ready', status: UPDATE_TEXT.ready, buttons: true, error: false, websiteLink: false };
    case 'failed':
      return { mode: 'failed', status: UPDATE_TEXT.failed, buttons: true, error: true, websiteLink: true };
    default:
      return { mode: 'offer', status: null, buttons: true, error: false, websiteLink: false };
  }
}

/**
 * Coarse progress for the live region, so a screen reader hears a phase
 * change and every quarter rather than ten updates a second.
 */
export function liveProgressText(view: UpdateWindowView): string {
  if (view.mode !== 'progress' || view.percent === null || view.percent === undefined) {return view.status ?? '';}
  const step = Math.floor(view.percent / 25) * 25;
  return step === 0 ? UPDATE_TEXT.downloading : UPDATE_TEXT.downloadingPercent(step);
}

/** Leading numeric part of a version: "2.0.1-rc.1" → [2, 0, 1]. */
function versionParts(v: string): number[] {
  return v.trim().replace(/^v/i, '').split(/[-+]/)[0].split('.').map((n) => parseInt(n, 10) || 0);
}

/** A major bump: the first number grows (0.x → 1.0, 1.x → 2.0; 0.1 → 0.2 is not). */
export function isMajorUpdate(current: string, next: string): boolean {
  if (!current || !next) {return false;}
  return (versionParts(next)[0] ?? 0) > (versionParts(current)[0] ?? 0);
}

/** "Last checked: …" in Settings. `at` and `now` are Unix ms. */
export function lastCheckedText(at: number | null | undefined, now: number): string {
  if (!at) {return 'Last checked: never';}
  return `Last checked: ${relativeTime(at, now)}`;
}

export function relativeTime(at: number, now: number): string {
  const s = Math.round((now - at) / 1000);
  if (s < 45) {return 'just now';}
  const m = Math.round(s / 60);
  if (m < 60) {return m === 1 ? '1 minute ago' : `${m} minutes ago`;}
  const h = Math.round(m / 60);
  if (h < 24) {return h === 1 ? '1 hour ago' : `${h} hours ago`;}
  const d = Math.round(h / 24);
  if (d < 30) {return d === 1 ? 'yesterday' : `${d} days ago`;}
  return new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
