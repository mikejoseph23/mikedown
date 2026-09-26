import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { SupportPrompt, SessionTracker } from '../../src/supportPrompt';
import { THRESHOLDS, KEYS } from '../../src/supportPromptEligibility';
import { SHARE_MESSAGE } from '../../src/supportCopy';

// Mock vscode module — pattern from test/unit/defaultEditorPrompt.test.ts.
// Only the surface src/supportPrompt.ts actually touches.
vi.mock('vscode', () => ({
  env: {
    openExternal: vi.fn(),
    clipboard: { writeText: vi.fn(async () => undefined) },
  },
  window: {
    showInformationMessage: vi.fn(),
  },
  Uri: {
    parse: vi.fn((s: string) => ({ toString: () => s, __uri: s })),
  },
}));

const DAY = 24 * 60 * 60 * 1000;

function makeContext() {
  const map: Record<string, unknown> = {};
  const updateCalls: Array<[string, unknown]> = [];
  const globalState = {
    get: vi.fn(<T>(key: string) => map[key] as T | undefined),
    update: vi.fn(async (key: string, value: unknown) => {
      map[key] = value;
      updateCalls.push([key, value]);
    }),
  };
  return {
    context: { globalState } as unknown as vscode.ExtensionContext,
    map,
    updateCalls,
  };
}

function makePanel() {
  return {
    visible: true,
    webview: { postMessage: vi.fn(async () => true) },
  } as unknown as vscode.WebviewPanel;
}

/** A globalState seed that clears every isAutoEligible bar. */
function eligibleSeed(now: number) {
  return {
    [KEYS.installDate]: now - THRESHOLDS.installAgeMs,
    [KEYS.docOpens]: THRESHOLDS.minDocOpens,
    [KEYS.activeDays]: THRESHOLDS.minActiveDays,
    [KEYS.lastPrompt]: 0,
    [KEYS.remindCount]: 0,
    [KEYS.dismissed]: false,
    [KEYS.lastCtaAt]: 0,
    [KEYS.reviewedAt]: null,
  };
}

function meaningfulTracker(now: number): SessionTracker {
  const tracker = new SessionTracker();
  // minSessionEdits edits, first one minSessionDurationMs ago.
  for (let i = 0; i < THRESHOLDS.minSessionEdits; i++) {
    tracker.recordEdit(now - THRESHOLDS.minSessionDurationMs);
  }
  return tracker;
}

describe('SupportPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('handleAction', () => {
    it.each([
      ['review', KEYS.reviewedAt] as const,
      ['share', KEYS.lastCtaAt] as const,
      ['feedback', KEYS.lastCtaAt] as const,
      ['never', KEYS.dismissed] as const,
    ])('%s writes %s', (action, key) => {
      const { context, map } = makeContext();
      const prompt = new SupportPrompt(context);
      const panel = makePanel();

      prompt.handleAction(panel, action);

      if (key === KEYS.dismissed) {
        expect(map[key]).toBe(true);
      } else {
        expect(map[key]).toBe(Date.now());
      }
    });

    it.each(['later', 'close'] as const)('%s advances remindCount', (action) => {
      const { context, map } = makeContext();
      map[KEYS.remindCount] = 1;
      const prompt = new SupportPrompt(context);
      const panel = makePanel();

      prompt.handleAction(panel, action);

      expect(map[KEYS.remindCount]).toBe(2);
    });

    it('share writes exactly the approved share line to the clipboard and posts supportCopied', async () => {
      const { context } = makeContext();
      const prompt = new SupportPrompt(context);
      const panel = makePanel();

      prompt.handleAction(panel, 'share');
      await vi.runOnlyPendingTimersAsync();

      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(SHARE_MESSAGE);
      expect(SHARE_MESSAGE.startsWith('Check out MikeDown')).toBe(true);
      expect(SHARE_MESSAGE).toMatch(/https:\/\/marketplace\.visualstudio\.com\/items\?itemName=interapp\.mikedown-editor/);
      expect(SHARE_MESSAGE).not.toMatch(/\bI\b|\bI'/);
      expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: 'supportCopied' });
    });

    it('review calls openExternal with the review URL', () => {
      const { context } = makeContext();
      const prompt = new SupportPrompt(context);
      const panel = makePanel();

      prompt.handleAction(panel, 'review');

      expect(vscode.env.openExternal).toHaveBeenCalledTimes(1);
      const arg = (vscode.env.openExternal as any).mock.calls[0][0];
      expect(arg.__uri).toBe(
        'https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor&ssr=false#review-details'
      );
    });

    it('feedback calls openExternal with the issue URL', () => {
      const { context } = makeContext();
      const prompt = new SupportPrompt(context);
      const panel = makePanel();

      prompt.handleAction(panel, 'feedback');

      expect(vscode.env.openExternal).toHaveBeenCalledTimes(1);
      const arg = (vscode.env.openExternal as any).mock.calls[0][0];
      expect(arg.__uri).toBe('https://github.com/mikejoseph23/mikedown/issues/new');
    });

    it('later/close/never do not call openExternal or the clipboard', () => {
      const { context } = makeContext();
      const prompt = new SupportPrompt(context);
      const panel = makePanel();

      prompt.handleAction(panel, 'later');
      prompt.handleAction(panel, 'close');
      prompt.handleAction(panel, 'never');

      expect(vscode.env.openExternal).not.toHaveBeenCalled();
      expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
    });
  });

  describe('lastPrompt is written only by onCardShown', () => {
    it('handleAction never writes lastPrompt, for any action', () => {
      for (const action of ['review', 'share', 'feedback', 'later', 'never', 'close'] as const) {
        const { context, map } = makeContext();
        map[KEYS.lastPrompt] = 999;
        const prompt = new SupportPrompt(context);
        const panel = makePanel();

        prompt.handleAction(panel, action);

        expect(map[KEYS.lastPrompt]).toBe(999);
      }
    });

    it('onBusy does not write lastPrompt', () => {
      const { context, map } = makeContext();
      map[KEYS.lastPrompt] = 999;
      const prompt = new SupportPrompt(context);
      const panel = makePanel();

      prompt.showManual(panel); // sets pendingReason
      prompt.onBusy(panel);

      expect(map[KEYS.lastPrompt]).toBe(999);
    });

    it('onCardShown writes lastPrompt to now', () => {
      const { context, map } = makeContext();
      const prompt = new SupportPrompt(context);
      const panel = makePanel();

      prompt.showManual(panel);
      prompt.onCardShown(panel);

      expect(map[KEYS.lastPrompt]).toBe(Date.now());
    });
  });

  describe('no toast or notice is shown on activation or after any timer', () => {
    it('recordActivation / recordDocOpen never call showInformationMessage', () => {
      const { context } = makeContext();
      const prompt = new SupportPrompt(context);

      prompt.recordActivation();
      prompt.recordDocOpen();

      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('an eligible onSaveAfterSession posts the webview card (not a toast) once its delay timer fires', async () => {
      const now = Date.now();
      const { context, map } = makeContext();
      Object.assign(map, eligibleSeed(now));
      const prompt = new SupportPrompt(context);
      const panel = makePanel();
      const doc = { uri: { scheme: 'file' } } as unknown as vscode.TextDocument;
      const tracker = meaningfulTracker(now);

      prompt.onSaveAfterSession(panel, doc, tracker);
      expect(panel.webview.postMessage).not.toHaveBeenCalled(); // not yet — waiting on cardDelayMs

      await vi.advanceTimersByTimeAsync(THRESHOLDS.cardDelayMs);

      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'showSupportCard', reason: 'auto' })
      );
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('a second eligible save in the same SupportPrompt instance does not show a second auto card', async () => {
      const now = Date.now();
      const { context, map } = makeContext();
      Object.assign(map, eligibleSeed(now));
      const prompt = new SupportPrompt(context);
      const panel = makePanel();
      const doc = { uri: { scheme: 'file' } } as unknown as vscode.TextDocument;

      prompt.onSaveAfterSession(panel, doc, meaningfulTracker(now));
      await vi.advanceTimersByTimeAsync(THRESHOLDS.cardDelayMs);
      // The card ack (supportCardShown) is what flips autoShownThisSession.
      prompt.onCardShown(panel);
      expect(panel.webview.postMessage).toHaveBeenCalledTimes(1);

      prompt.onSaveAfterSession(panel, doc, meaningfulTracker(now));
      await vi.advanceTimersByTimeAsync(THRESHOLDS.cardDelayMs);

      expect(panel.webview.postMessage).toHaveBeenCalledTimes(1);
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('an ineligible save never fires the timer or posts anything', async () => {
      const now = Date.now();
      const { context } = makeContext(); // empty store => far from eligible
      const prompt = new SupportPrompt(context);
      const panel = makePanel();
      const doc = { uri: { scheme: 'file' } } as unknown as vscode.TextDocument;

      prompt.onSaveAfterSession(panel, doc, meaningfulTracker(now));
      await vi.advanceTimersByTimeAsync(THRESHOLDS.cardDelayMs);

      expect(panel.webview.postMessage).not.toHaveBeenCalled();
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });
  });
});
