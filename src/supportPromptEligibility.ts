/**
 * Pure, unit-testable eligibility logic for the "A note from Mike" support
 * appeal (review / tell a colleague / open an issue). No `vscode` import —
 * every function here takes `now: number` explicitly (an injected clock)
 * instead of calling `Date.now()`, and persistence goes through the
 * `StateStore` interface instead of `vscode.Memento` directly, so this file
 * can be tested with plain fakes.
 *
 * State keys are unchanged from `src/nagPrompt.ts` (the module this replaces)
 * so existing installs keep their install date, ladder position, and
 * "Don't ask again" choice. `src/supportPrompt.ts` (M3) is the `vscode`-aware
 * wrapper that owns a real `StateStore` (`context.globalState`), URLs, and
 * message handling; it is the only caller of the functions below.
 *
 * Design note on "at most one auto show per VS Code session": that cap is
 * runtime-only (it must reset on every VS Code restart, never persisted), so
 * it is deliberately kept OUT of `isAutoEligible`'s pure state/session
 * inputs. The host (M3) tracks a single module-level boolean for the whole
 * VS Code session and simply skips calling `isAutoEligible` again once an
 * auto card has been shown, rather than threading that flag through here.
 */

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/** Named eligibility thresholds (Q1, resolved 2026-09-26). */
export const THRESHOLDS = {
  /** Minimum install age before the first auto show. */
  installAgeMs: 7 * DAY,
  /** Minimum distinct documents opened in MikeDown. */
  minDocOpens: 5,
  /** Minimum distinct local calendar days with an editing session. */
  minActiveDays: 3,
  /** Minimum `edit` messages from the webview in the current session. */
  minSessionEdits: 20,
  /** Minimum time between the session's first edit and the save. */
  minSessionDurationMs: 3 * MINUTE,
  /** Delay after a qualifying save before the card is posted. */
  cardDelayMs: 1500,
  /** "Maybe later" / close-without-choosing backoff ladder, capped. */
  ladderDays: [14, 30, 60, 90],
  /** Gap enforced after any CTA ("Tell a colleague" / "Open an issue"). */
  ctaGapDays: 60,
} as const;

/** globalState keys. Unchanged names are kept for backward compatibility. */
export const KEYS = {
  installDate: 'mikedown.nag.installDate',
  sessions: 'mikedown.nag.sessions',
  docOpens: 'mikedown.nag.docOpens',
  lastPrompt: 'mikedown.nag.lastPrompt',
  remindCount: 'mikedown.nag.remindCount',
  dismissed: 'mikedown.nag.dismissed',
  lastCtaAt: 'mikedown.nag.lastCtaAt',
  activeDays: 'mikedown.nag.activeDays',
  lastActiveDay: 'mikedown.nag.lastActiveDay',
  reviewedAt: 'mikedown.nag.reviewedAt',
} as const;

/** All persisted fields for the support prompt. */
export interface SupportPromptState {
  /** Epoch ms of first activation. */
  installDate: number;
  /** Number of activations recorded. */
  sessions: number;
  /** Number of MikeDown document opens recorded. */
  docOpens: number;
  /** Epoch ms the card was last actually shown (set only on `supportCardShown`). */
  lastPrompt: number;
  /** "Maybe later" / close-without-choosing count, drives the ladder. */
  remindCount: number;
  /** Sticky "Don't ask again" (auto show only; manual entry points still work). */
  dismissed: boolean;
  /** Epoch ms of the last CTA click (review / share / feedback). */
  lastCtaAt: number;
  /** Count of distinct local dates with an editing session. */
  activeDays: number;
  /** Local date (YYYY-MM-DD) of the most recent recorded editing session, or '' if none yet. */
  lastActiveDay: string;
  /** Epoch ms "Leave a review" was clicked, or null if never. Once set, auto show never fires again. */
  reviewedAt: number | null;
}

/** Returns a fresh default state, as if nothing has ever been persisted. */
export function defaultState(now: number): SupportPromptState {
  return {
    installDate: now,
    sessions: 0,
    docOpens: 0,
    lastPrompt: 0,
    remindCount: 0,
    dismissed: false,
    lastCtaAt: 0,
    activeDays: 0,
    lastActiveDay: '',
    reviewedAt: null,
  };
}

/**
 * Minimal persistence surface this module needs. Satisfied directly by
 * `vscode.Memento` (i.e. `context.globalState`) without importing `vscode`.
 */
export interface StateStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): void;
}

/** Reads a `SupportPromptState` out of a `StateStore`, filling in defaults for missing/legacy keys. */
export function readState(store: StateStore, now: number): SupportPromptState {
  return {
    installDate: store.get<number>(KEYS.installDate) ?? now,
    sessions: store.get<number>(KEYS.sessions) ?? 0,
    docOpens: store.get<number>(KEYS.docOpens) ?? 0,
    lastPrompt: store.get<number>(KEYS.lastPrompt) ?? 0,
    remindCount: store.get<number>(KEYS.remindCount) ?? 0,
    dismissed: store.get<boolean>(KEYS.dismissed) ?? false,
    lastCtaAt: store.get<number>(KEYS.lastCtaAt) ?? 0,
    activeDays: store.get<number>(KEYS.activeDays) ?? 0,
    lastActiveDay: store.get<string>(KEYS.lastActiveDay) ?? '',
    reviewedAt: store.get<number>(KEYS.reviewedAt) ?? null,
  };
}

/** Writes every field of a `SupportPromptState` back into a `StateStore`. */
export function writeState(store: StateStore, state: SupportPromptState): void {
  store.update(KEYS.installDate, state.installDate);
  store.update(KEYS.sessions, state.sessions);
  store.update(KEYS.docOpens, state.docOpens);
  store.update(KEYS.lastPrompt, state.lastPrompt);
  store.update(KEYS.remindCount, state.remindCount);
  store.update(KEYS.dismissed, state.dismissed);
  store.update(KEYS.lastCtaAt, state.lastCtaAt);
  store.update(KEYS.activeDays, state.activeDays);
  store.update(KEYS.lastActiveDay, state.lastActiveDay);
  store.update(KEYS.reviewedAt, state.reviewedAt);
}

/** Snapshot of the current panel's editing session, as tracked by `SessionTracker`. */
export interface EditSession {
  /** `edit` messages received from the webview so far in this session. */
  editCount: number;
  /** Epoch ms of the first `edit` message, or null if none yet. */
  firstEditAt: number | null;
}

/** Shared "does this session clear the bar" check, used by both `isAutoEligible` and `SessionTracker.isMeaningful`. */
function isSessionMeaningful(session: EditSession, now: number): boolean {
  return (
    session.editCount >= THRESHOLDS.minSessionEdits &&
    session.firstEditAt !== null &&
    now - session.firstEditAt >= THRESHOLDS.minSessionDurationMs
  );
}

/**
 * Backoff schedule for the next allowed auto show.
 *
 * After any CTA ("Tell a colleague" / "Open an issue") the ladder resets and
 * the next ask is allowed after `THRESHOLDS.ctaGapDays`, regardless of how
 * many "Maybe later"s preceded it. Otherwise the ladder extends
 * 14 -> 30 -> 60 -> 90 days (capped) based on `remindCount`.
 */
export function nextDelayMs(remindCount: number, hadCtaSinceLastPrompt: boolean): number {
  if (hadCtaSinceLastPrompt) return THRESHOLDS.ctaGapDays * DAY;
  const ladder = THRESHOLDS.ladderDays;
  const idx = Math.max(0, Math.min(remindCount, ladder.length - 1));
  return ladder[idx] * DAY;
}

/**
 * Whether the card may be shown automatically (after a qualifying save),
 * given the persisted state and the current panel's editing session. Does
 * NOT enforce "at most one auto show per VS Code session" — see the module
 * doc comment; the caller (M3) gates that separately before calling this.
 */
export function isAutoEligible(state: SupportPromptState, session: EditSession, now: number): boolean {
  if (state.dismissed) return false;
  if (state.reviewedAt !== null) return false;
  if (!isSessionMeaningful(session, now)) return false;
  if (now - state.installDate < THRESHOLDS.installAgeMs) return false;
  if (state.docOpens < THRESHOLDS.minDocOpens) return false;
  if (state.activeDays < THRESHOLDS.minActiveDays) return false;

  const hadCtaSinceLastPrompt = state.lastCtaAt > state.lastPrompt;
  const requiredGap = nextDelayMs(state.remindCount, hadCtaSinceLastPrompt);
  if (now - state.lastPrompt < requiredGap) return false;

  return true;
}

/** Actions the webview can report back via `{ type: 'supportAction', action }`. */
export type SupportAction = 'review' | 'share' | 'feedback' | 'later' | 'never' | 'close';

/**
 * Applies a user action to the persisted state. Does not set `lastPrompt` —
 * that is written only when the webview acks `supportCardShown` (M3), not
 * here, so a card that fails to render never counts as "asked".
 *
 * - `review`: sets `reviewedAt`; auto show never fires again (Q3).
 * - `share` / `feedback` ("Tell a colleague" / "Open an issue"): reset the
 *   ladder and record a CTA, giving a `ctaGapDays` gap before the next ask.
 * - `later` ("Maybe later") and `close` (dismissing without choosing):
 *   advance the ladder by one step.
 * - `never` ("Don't ask again"): sets `dismissed`, sticky for auto show only.
 */
export function applyAction(state: SupportPromptState, action: SupportAction, now: number): SupportPromptState {
  switch (action) {
    case 'review':
      return { ...state, reviewedAt: now };
    case 'share':
    case 'feedback':
      return { ...state, lastCtaAt: now, remindCount: 0 };
    case 'later':
    case 'close':
      return { ...state, remindCount: state.remindCount + 1 };
    case 'never':
      return { ...state, dismissed: true };
    default:
      return state;
  }
}

/** Local date as `YYYY-MM-DD`, derived purely from `now`. */
function localDateString(now: number): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Records an editing session against `activeDays` / `lastActiveDay`. Pure
 * and idempotent within the same local day — call it on the first edit of a
 * panel's session (or on save) without needing to track "have I already
 * counted today" elsewhere.
 */
export function recordActiveDay(state: SupportPromptState, now: number): SupportPromptState {
  const day = localDateString(now);
  if (state.lastActiveDay === day) return state;
  return { ...state, lastActiveDay: day, activeDays: state.activeDays + 1 };
}

/**
 * Tracks one panel's editing session: how many `edit` messages have arrived
 * and when the first one landed, so the host can decide (via
 * `isMeaningful`/`isAutoEligible`) whether a save follows real editing.
 * Kept as one instance per panel by the provider (M3).
 */
export class SessionTracker {
  private editCount = 0;
  private firstEditAt: number | null = null;

  /** Call for every `edit` message received from the webview. */
  public recordEdit(now: number): void {
    if (this.firstEditAt === null) this.firstEditAt = now;
    this.editCount += 1;
  }

  /** Whether this session (so far) clears the edit count + duration bar. */
  public isMeaningful(now: number): boolean {
    return isSessionMeaningful(this.snapshot(), now);
  }

  /** Clears the session, e.g. after a save has been evaluated. */
  public reset(): void {
    this.editCount = 0;
    this.firstEditAt = null;
  }

  /** A plain-data snapshot suitable for `isAutoEligible`. */
  public snapshot(): EditSession {
    return { editCount: this.editCount, firstEditAt: this.firstEditAt };
  }
}
