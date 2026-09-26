import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { SupportPrompt } from '../../src/supportPrompt';
import { KEYS } from '../../src/supportPromptEligibility';
import { SHARE_MESSAGE, BUTTON_LABELS, FALLBACK_NOTICE_TEXT } from '../../src/supportCopy';

/**
 * Fills gaps left by supportPrompt.test.ts / supportPromptEligibility.test.ts
 * while auditing the review-appeal hands-on checklist
 * (worker-summary-m9-hands-on.md) for automation:
 *
 *  - step 1: no card ever appears purely from the passage of time (no auto
 *    "startup nag" timer at all — only a real save event can trigger one).
 *  - step 12/13: "Don't ask again" / "Leave a review" are sticky across a
 *    simulated VS Code reload (a fresh SupportPrompt instance backed by the
 *    SAME persisted globalState), and manual entry points still work while
 *    auto-eligibility stays permanently blocked.
 *  - step 14: `showFallbackNotice` (the one native notice left) — every
 *    button choice, plus a bare dismissal, maps to the right side effect and
 *    the right persisted state.
 *  - the two "MikeDown (Dev): Reset Support Prompt State" quick-pick actions
 *    (`devResetAll` / `devMakeEligibleNow`), used to drive steps 10–13.
 */

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

function makeContext() {
  const map: Record<string, unknown> = {};
  const globalState = {
    get: vi.fn(<T>(key: string) => map[key] as T | undefined),
    update: vi.fn(async (key: string, value: unknown) => {
      map[key] = value;
    }),
  };
  return { context: { globalState } as unknown as vscode.ExtensionContext, map };
}

function makePanel() {
  return {
    visible: true,
    webview: { postMessage: vi.fn(async () => true) },
  } as unknown as vscode.WebviewPanel;
}

describe('SupportPrompt — no startup nag (checklist step 1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('activating, opening a doc, and letting two minutes pass never posts a card or a toast', async () => {
    const { context } = makeContext();
    const prompt = new SupportPrompt(context);
    const panel = makePanel();

    prompt.recordActivation();
    prompt.recordDocOpen();

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    expect(panel.webview.postMessage).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });
});

describe('SupportPrompt — dismissal survives a reload (checklist step 12)', () => {
  it('"Don\'t ask again" then a fresh instance on the same state never auto-shows again, but manual entry still works', async () => {
    const { context, map } = makeContext();
    const first = new SupportPrompt(context);
    const panel = makePanel();

    first.handleAction(panel, 'never');
    expect(map[KEYS.dismissed]).toBe(true);

    // Simulate "reload the window, no dev reset": a brand-new SupportPrompt
    // instance (autoShownThisSession resets) backed by the SAME globalState.
    const reloaded = new SupportPrompt(context);
    const doc = { uri: { scheme: 'file' } } as unknown as vscode.TextDocument;
    const meaningfulTracker = {
      snapshot: () => ({ editCount: 999, firstEditAt: Date.now() - 10 * 60 * 1000 }),
    } as any;

    reloaded.onSaveAfterSession(panel, doc, meaningfulTracker);
    await new Promise((r) => setTimeout(r, 0));
    expect(panel.webview.postMessage).not.toHaveBeenCalled();

    // Manual entry points still work regardless of the dismissal.
    reloaded.showManual(panel);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'showSupportCard', reason: 'manual' })
    );
  });
});

describe('SupportPrompt — a review survives a reload (checklist step 13)', () => {
  it('"Leave a review" then a fresh instance on the same state never auto-shows again, but manual entry still works', async () => {
    const { context, map } = makeContext();
    const first = new SupportPrompt(context);
    const panel = makePanel();

    first.handleAction(panel, 'review');
    expect(typeof map[KEYS.reviewedAt]).toBe('number');

    const reloaded = new SupportPrompt(context);
    const doc = { uri: { scheme: 'file' } } as unknown as vscode.TextDocument;
    const meaningfulTracker = {
      snapshot: () => ({ editCount: 999, firstEditAt: Date.now() - 10 * 60 * 1000 }),
    } as any;

    reloaded.onSaveAfterSession(panel, doc, meaningfulTracker);
    await new Promise((r) => setTimeout(r, 0));
    expect(panel.webview.postMessage).not.toHaveBeenCalled();

    reloaded.showManual(panel);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'showSupportCard', reason: 'manual' })
    );
  });
});

describe('SupportPrompt — dev quick-pick actions', () => {
  afterEach(() => vi.clearAllMocks());

  it('devResetAll clears every mikedown.nag.* key', () => {
    const { context, map } = makeContext();
    Object.assign(map, {
      [KEYS.installDate]: 123,
      [KEYS.docOpens]: 5,
      [KEYS.dismissed]: true,
      [KEYS.reviewedAt]: 456,
    });
    const prompt = new SupportPrompt(context);

    prompt.devResetAll();

    for (const key of Object.values(KEYS)) {
      expect(map[key]).toBeUndefined();
    }
  });

  it('devMakeEligibleNow backdates state so the very next meaningful save shows the card', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const { context } = makeContext();
      const prompt = new SupportPrompt(context);
      const panel = makePanel();
      const doc = { uri: { scheme: 'file' } } as unknown as vscode.TextDocument;

      prompt.devMakeEligibleNow();
      // devMakeEligibleNow arms `devForceMeaningfulNextSave`, so even a
      // trivial/empty session snapshot must count as meaningful.
      const trivialTracker = { snapshot: () => ({ editCount: 0, firstEditAt: null }) } as any;

      prompt.onSaveAfterSession(panel, doc, trivialTracker);
      await vi.advanceTimersByTimeAsync(2000);

      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'showSupportCard', reason: 'auto' })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SupportPrompt.showFallbackNotice (checklist step 14)', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows the fallback text with the five buttons, in order', () => {
    const { context } = makeContext();
    const prompt = new SupportPrompt(context);
    vi.mocked(vscode.window.showInformationMessage).mockReturnValue(Promise.resolve(undefined) as any);

    prompt.showFallbackNotice();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      FALLBACK_NOTICE_TEXT,
      BUTTON_LABELS.review,
      BUTTON_LABELS.share,
      BUTTON_LABELS.feedback,
      BUTTON_LABELS.later,
      BUTTON_LABELS.never
    );
  });

  it('"Leave a review" opens the review URL and records reviewedAt', async () => {
    const { context, map } = makeContext();
    const prompt = new SupportPrompt(context);
    vi.mocked(vscode.window.showInformationMessage).mockReturnValue(Promise.resolve(BUTTON_LABELS.review) as any);

    prompt.showFallbackNotice();
    await new Promise((r) => setTimeout(r, 0));

    expect(typeof map[KEYS.reviewedAt]).toBe('number');
    const arg = (vscode.env.openExternal as any).mock.calls[0][0];
    expect(arg.__uri).toContain('review-details');
  });

  it('"Tell a colleague" writes the approved share line to the clipboard', async () => {
    const { context } = makeContext();
    const prompt = new SupportPrompt(context);
    vi.mocked(vscode.window.showInformationMessage).mockReturnValue(Promise.resolve(BUTTON_LABELS.share) as any);

    prompt.showFallbackNotice();
    await new Promise((r) => setTimeout(r, 0));

    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(SHARE_MESSAGE);
  });

  it('"Open an issue" opens the issue URL', async () => {
    const { context } = makeContext();
    const prompt = new SupportPrompt(context);
    vi.mocked(vscode.window.showInformationMessage).mockReturnValue(Promise.resolve(BUTTON_LABELS.feedback) as any);

    prompt.showFallbackNotice();
    await new Promise((r) => setTimeout(r, 0));

    const arg = (vscode.env.openExternal as any).mock.calls[0][0];
    expect(arg.__uri).toContain('/issues/new');
  });

  it('"Maybe later" and dismissing without a choice both just advance the ladder (no external call)', async () => {
    for (const resolved of [BUTTON_LABELS.later, undefined]) {
      const { context, map } = makeContext();
      const prompt = new SupportPrompt(context);
      vi.mocked(vscode.window.showInformationMessage).mockReturnValue(Promise.resolve(resolved) as any);

      prompt.showFallbackNotice();
      await new Promise((r) => setTimeout(r, 0));

      expect(map[KEYS.remindCount]).toBe(1);
      expect(vscode.env.openExternal).not.toHaveBeenCalled();
      expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
    }
  });

  it('"Don\'t ask again" sets dismissed sticky', async () => {
    const { context, map } = makeContext();
    const prompt = new SupportPrompt(context);
    vi.mocked(vscode.window.showInformationMessage).mockReturnValue(Promise.resolve(BUTTON_LABELS.never) as any);

    prompt.showFallbackNotice();
    await new Promise((r) => setTimeout(r, 0));

    expect(map[KEYS.dismissed]).toBe(true);
  });
});
