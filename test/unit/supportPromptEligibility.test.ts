import { describe, it, expect } from 'vitest';
import {
  THRESHOLDS,
  KEYS,
  StateStore,
  SupportPromptState,
  defaultState,
  readState,
  isAutoEligible,
  nextDelayMs,
  applyAction,
} from '../../src/supportPromptEligibility';

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

// Fixed injected clock — every test passes `now` explicitly rather than
// relying on Date.now(), matching the pure-function contract of the module
// under test.
const NOW = new Date('2026-01-01T00:00:00.000Z').getTime();

/** A state that clears every `isAutoEligible` bar, exactly at each threshold. */
function eligibleState(overrides: Partial<SupportPromptState> = {}): SupportPromptState {
  return {
    installDate: NOW - THRESHOLDS.installAgeMs,
    sessions: 1,
    docOpens: THRESHOLDS.minDocOpens,
    lastPrompt: 0,
    remindCount: 0,
    dismissed: false,
    lastCtaAt: 0,
    activeDays: THRESHOLDS.minActiveDays,
    lastActiveDay: '2025-12-31',
    reviewedAt: null,
    ...overrides,
  };
}

/** A session that exactly clears the edit-count + duration bar. */
function meaningfulSession(overrides: Partial<{ editCount: number; firstEditAt: number | null }> = {}) {
  return {
    editCount: THRESHOLDS.minSessionEdits,
    firstEditAt: NOW - THRESHOLDS.minSessionDurationMs,
    ...overrides,
  };
}

/** A minimal fake `StateStore` backed by a plain map, for readState() tests. */
function fakeStore(seed: Record<string, unknown>): StateStore {
  return {
    get: <T>(key: string) => seed[key] as T | undefined,
    update: () => {
      throw new Error('fakeStore is read-only in these tests');
    },
  };
}

describe('isAutoEligible', () => {
  it('is eligible when every threshold is exactly met', () => {
    expect(isAutoEligible(eligibleState(), meaningfulSession(), NOW)).toBe(true);
  });

  it('is not eligible before 7 days of install age', () => {
    const state = eligibleState({ installDate: NOW - (THRESHOLDS.installAgeMs - 1) });
    expect(isAutoEligible(state, meaningfulSession(), NOW)).toBe(false);
  });

  it('is eligible at exactly 7 days of install age', () => {
    const state = eligibleState({ installDate: NOW - THRESHOLDS.installAgeMs });
    expect(isAutoEligible(state, meaningfulSession(), NOW)).toBe(true);
  });

  it('is not eligible under 5 doc opens', () => {
    const state = eligibleState({ docOpens: THRESHOLDS.minDocOpens - 1 });
    expect(isAutoEligible(state, meaningfulSession(), NOW)).toBe(false);
  });

  it('is not eligible under 3 active days', () => {
    const state = eligibleState({ activeDays: THRESHOLDS.minActiveDays - 1 });
    expect(isAutoEligible(state, meaningfulSession(), NOW)).toBe(false);
  });

  it('is not eligible when the session is under 20 edits', () => {
    const session = meaningfulSession({ editCount: THRESHOLDS.minSessionEdits - 1 });
    expect(isAutoEligible(eligibleState(), session, NOW)).toBe(false);
  });

  it('is not eligible when the session is under 3 minutes', () => {
    const session = meaningfulSession({ firstEditAt: NOW - (THRESHOLDS.minSessionDurationMs - 1) });
    expect(isAutoEligible(eligibleState(), session, NOW)).toBe(false);
  });

  it('is not eligible when the session has no edits at all', () => {
    const session = meaningfulSession({ editCount: 0, firstEditAt: null });
    expect(isAutoEligible(eligibleState(), session, NOW)).toBe(false);
  });

  it('review stops auto show permanently, even if every other bar is cleared', () => {
    const state = eligibleState({ reviewedAt: NOW - DAY, lastPrompt: 0, remindCount: 0 });
    expect(isAutoEligible(state, meaningfulSession(), NOW)).toBe(false);
  });

  it('dismissed ("Don\'t ask again") is sticky, with no one-time exception', () => {
    // Every other field is perfectly eligible; dismissed alone must block it.
    const state = eligibleState({ dismissed: true });
    expect(isAutoEligible(state, meaningfulSession(), NOW)).toBe(false);
  });

  it('dismissed sticky via legacy mikedown.nag.dismissed key alone', () => {
    const store = fakeStore({
      [KEYS.installDate]: NOW - THRESHOLDS.installAgeMs,
      [KEYS.docOpens]: THRESHOLDS.minDocOpens,
      [KEYS.activeDays]: THRESHOLDS.minActiveDays,
      [KEYS.dismissed]: true,
    });
    const state = readState(store, NOW);
    expect(state.dismissed).toBe(true);
    expect(isAutoEligible(state, meaningfulSession(), NOW)).toBe(false);
  });

  describe('ladder gap (14/30/60/90, capped)', () => {
    const ladderCases: Array<[number, number]> = [
      [0, 14],
      [1, 30],
      [2, 60],
      [3, 90],
      [4, 90], // beyond the ladder's length — capped at the last rung
      [100, 90], // far beyond — still capped
    ];

    it.each(ladderCases)('remindCount %i requires a %i day gap', (remindCount, expectedDays) => {
      expect(nextDelayMs(remindCount, false)).toBe(expectedDays * DAY);
    });

    it('is not eligible until the ladder gap for the current remindCount has elapsed', () => {
      const state = eligibleState({ remindCount: 1, lastPrompt: NOW - (30 * DAY - 1) });
      expect(isAutoEligible(state, meaningfulSession(), NOW)).toBe(false);
    });

    it('is eligible exactly at the ladder gap for the current remindCount', () => {
      const state = eligibleState({ remindCount: 1, lastPrompt: NOW - 30 * DAY });
      expect(isAutoEligible(state, meaningfulSession(), NOW)).toBe(true);
    });

    it('caps the gap at the ladder\'s last rung (90 days) past remindCount 3', () => {
      const state = eligibleState({ remindCount: 12, lastPrompt: NOW - 90 * DAY });
      expect(isAutoEligible(state, meaningfulSession(), NOW)).toBe(true);
    });
  });

  describe('CTA gap (60 days)', () => {
    it('nextDelayMs ignores remindCount entirely once a CTA is pending', () => {
      expect(nextDelayMs(0, true)).toBe(THRESHOLDS.ctaGapDays * DAY);
      expect(nextDelayMs(3, true)).toBe(THRESHOLDS.ctaGapDays * DAY);
      expect(nextDelayMs(100, true)).toBe(THRESHOLDS.ctaGapDays * DAY);
    });

    it('is not eligible until 60 days after a CTA click (Tell a colleague / Open an issue)', () => {
      const state = eligibleState({
        remindCount: 0,
        lastPrompt: NOW - 25 * DAY,
        lastCtaAt: NOW - 20 * DAY, // more recent than lastPrompt -> CTA gap applies
      });
      expect(isAutoEligible(state, meaningfulSession(), NOW)).toBe(false);
    });

    it('is eligible exactly 60 days after a CTA click', () => {
      const state = eligibleState({
        remindCount: 0,
        lastPrompt: NOW - 60 * DAY,
        lastCtaAt: NOW - 60 * DAY,
      });
      expect(isAutoEligible(state, meaningfulSession(), NOW)).toBe(true);
    });

    it('CTA gap only applies when the CTA is more recent than the last prompt', () => {
      // lastCtaAt is older than lastPrompt (a CTA click long ago, then a
      // later "Maybe later"), so the ladder gap applies, not the CTA gap.
      const state = eligibleState({
        remindCount: 0,
        lastCtaAt: NOW - 90 * DAY,
        lastPrompt: NOW - 14 * DAY,
      });
      expect(isAutoEligible(state, meaningfulSession(), NOW)).toBe(true);
    });
  });

  describe('"at most one auto show per session" is deliberately NOT enforced here', () => {
    // Per the module doc comment, this cap is runtime-only and lives in
    // src/supportPrompt.ts's `autoShownThisSession` flag, not in this pure
    // function — isAutoEligible has no notion of "already shown" and must
    // keep returning true on repeated calls with unchanged state. The actual
    // per-session cap is exercised in test/unit/supportPrompt.test.ts.
    it('keeps returning true on repeated calls with the same eligible state', () => {
      const state = eligibleState();
      const session = meaningfulSession();
      expect(isAutoEligible(state, session, NOW)).toBe(true);
      expect(isAutoEligible(state, session, NOW)).toBe(true);
      expect(isAutoEligible(state, session, NOW)).toBe(true);
    });
  });

  describe('legacy state (only old mikedown.nag.* keys present)', () => {
    it('evaluates correctly when only the pre-M2 keys are set', () => {
      // installDate, sessions, docOpens, lastPrompt, remindCount, dismissed
      // existed before M2; lastCtaAt/activeDays/lastActiveDay/reviewedAt are
      // new fields that a pre-existing install will never have written.
      const store = fakeStore({
        [KEYS.installDate]: NOW - 30 * DAY,
        [KEYS.sessions]: 42,
        [KEYS.docOpens]: THRESHOLDS.minDocOpens + 10,
        [KEYS.lastPrompt]: 0,
        [KEYS.remindCount]: 0,
        [KEYS.dismissed]: false,
      });
      const state = readState(store, NOW);

      expect(state.lastCtaAt).toBe(0);
      expect(state.activeDays).toBe(0);
      expect(state.lastActiveDay).toBe('');
      expect(state.reviewedAt).toBeNull();

      // Never eligible on legacy state alone: activeDays defaults to 0,
      // under the 3-day bar, even though docOpens/installDate clear theirs.
      expect(isAutoEligible(state, meaningfulSession(), NOW)).toBe(false);

      // Once activeDays/lastActiveDay catch up (recorded going forward),
      // the same legacy install becomes eligible without any migration step.
      const caughtUp = { ...state, activeDays: THRESHOLDS.minActiveDays };
      expect(isAutoEligible(caughtUp, meaningfulSession(), NOW)).toBe(true);
    });

    it('a totally fresh store (no keys at all) behaves like defaultState', () => {
      const store = fakeStore({});
      const state = readState(store, NOW);
      expect(state).toEqual(defaultState(NOW));
      expect(isAutoEligible(state, meaningfulSession(), NOW)).toBe(false);
    });
  });
});

describe('applyAction', () => {
  it('review sets reviewedAt and touches nothing else', () => {
    const state = eligibleState({ reviewedAt: null });
    const next = applyAction(state, 'review', NOW);
    expect(next.reviewedAt).toBe(NOW);
    expect(next.remindCount).toBe(state.remindCount);
    expect(next.dismissed).toBe(state.dismissed);
    expect(next.lastCtaAt).toBe(state.lastCtaAt);
  });

  it.each(['share', 'feedback'] as const)('%s resets the ladder and records a CTA', (action) => {
    const state = eligibleState({ remindCount: 3, lastCtaAt: 0 });
    const next = applyAction(state, action, NOW);
    expect(next.lastCtaAt).toBe(NOW);
    expect(next.remindCount).toBe(0);
  });

  it.each(['later', 'close'] as const)('%s advances the ladder by one step', (action) => {
    const state = eligibleState({ remindCount: 1 });
    const next = applyAction(state, action, NOW);
    expect(next.remindCount).toBe(2);
  });

  it('never sets dismissed sticky', () => {
    const state = eligibleState({ dismissed: false });
    const next = applyAction(state, 'never', NOW);
    expect(next.dismissed).toBe(true);
  });

  it('does not write lastPrompt for any action (only supportCardShown does, in M3)', () => {
    for (const action of ['review', 'share', 'feedback', 'later', 'never', 'close'] as const) {
      const state = eligibleState({ lastPrompt: 12345 });
      const next = applyAction(state, action, NOW);
      expect(next.lastPrompt).toBe(12345);
    }
  });
});
