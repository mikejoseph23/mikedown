import * as vscode from 'vscode';
import {
  KEYS,
  THRESHOLDS,
  StateStore,
  SupportAction,
  SessionTracker,
  readState,
  writeState,
  isAutoEligible,
  applyAction,
  recordActiveDay,
} from './supportPromptEligibility';
import { CARD_COPY, SHARE_MESSAGE, FALLBACK_NOTICE_TEXT, BUTTON_LABELS } from './supportCopy';

export { SessionTracker } from './supportPromptEligibility';

const DAY = 24 * 60 * 60 * 1000;

/** Review / share / issue URLs. Carried over unchanged from the removed `src/nagPrompt.ts`. */
const URLS = {
  review: 'https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor&ssr=false#review-details',
  share: 'https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor',
  issue: 'https://github.com/mikejoseph23/mikedown/issues/new',
} as const;

export type SupportCardReason = 'auto' | 'manual';

/**
 * Host-side (`vscode`-aware) wrapper around the pure eligibility module in
 * `supportPromptEligibility.ts`. Owns `globalState` persistence, the review /
 * share / issue URLs, and every side effect: opening URLs, writing the
 * clipboard, and the single remaining native notice (`mikedown.support`
 * fallback, Q2 resolved). One instance is created once by
 * `MarkdownEditorProvider` and lives for the extension host's lifetime, so
 * `autoShownThisSession` — the "at most one auto show per VS Code session"
 * cap the eligibility module deliberately excludes (see its doc comment) —
 * is a plain instance field here rather than persisted state.
 */
export class SupportPrompt {
  private readonly store: StateStore;
  private autoShownThisSession = false;
  /** One-shot dev override: treat the next save's session as meaningful regardless of real edit activity. */
  private devForceMeaningfulNextSave = false;
  /** Which `showSupportCard` reason is awaiting an ack (`supportCardShown` or `busy`) for a given panel. */
  private readonly pendingReason = new WeakMap<vscode.WebviewPanel, SupportCardReason>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.store = context.globalState;
  }

  /** Call once on activation. Records the session and seeds `installDate` (mirrors the old `NagPrompt`). */
  public recordActivation(): void {
    const now = Date.now();
    const state = readState(this.store, now);
    writeState(this.store, { ...state, sessions: state.sessions + 1 });
  }

  /** Call whenever a MikeDown editor opens a document (engagement signal). */
  public recordDocOpen(): void {
    const now = Date.now();
    const state = readState(this.store, now);
    writeState(this.store, { ...state, docOpens: state.docOpens + 1 });
  }

  /** Call for every `edit` message from the webview — updates the active-day streak (no-op after the first edit of a given local day). */
  public recordEdit(now: number): void {
    const state = readState(this.store, now);
    const updated = recordActiveDay(state, now);
    if (updated !== state) {
      writeState(this.store, updated);
    }
  }

  /**
   * Called from the provider's existing per-panel `onDidSaveTextDocument`
   * handler, after its current work. If the state is eligible and the panel
   * is still visible 1.5s from now, posts the auto support card. A no-op
   * most of the time — most saves are not preceded by a "meaningful" session
   * per `THRESHOLDS`, and at most one auto card is shown per VS Code session.
   */
  public onSaveAfterSession(panel: vscode.WebviewPanel, document: vscode.TextDocument, session: SessionTracker): void {
    if (this.autoShownThisSession) {
      return;
    }
    if (document.uri.scheme !== 'file') {
      return;
    }
    if (!panel.visible) {
      return;
    }

    const now = Date.now();
    const state = readState(this.store, now);
    const forceMeaningful = this.devForceMeaningfulNextSave;
    const snapshot = forceMeaningful
      ? { editCount: THRESHOLDS.minSessionEdits, firstEditAt: now - THRESHOLDS.minSessionDurationMs }
      : session.snapshot();
    if (forceMeaningful) {
      this.devForceMeaningfulNextSave = false;
    }

    if (!isAutoEligible(state, snapshot, now)) {
      return;
    }

    setTimeout(() => {
      if (this.autoShownThisSession) {
        return;
      }
      if (!panel.visible) {
        return;
      }
      this.postCard(panel, 'auto');
    }, THRESHOLDS.cardDelayMs);
  }

  /** `mikedown.support` command (and other manual entry points, M6+) when a MikeDown panel is available. */
  public showManual(panel: vscode.WebviewPanel): void {
    this.postCard(panel, 'manual');
  }

  private postCard(panel: vscode.WebviewPanel, reason: SupportCardReason): void {
    this.pendingReason.set(panel, reason);
    void panel.webview.postMessage({ type: 'showSupportCard', reason, copy: CARD_COPY });
  }

  /** Webview → host `{ type: 'busy' }` — another card or the Settings modal was open, so nothing rendered. Not a show: `lastPrompt` is left untouched. */
  public onBusy(panel: vscode.WebviewPanel): void {
    this.pendingReason.delete(panel);
  }

  /** Webview → host `{ type: 'supportCardShown' }` — the only place `lastPrompt` is written. */
  public onCardShown(panel: vscode.WebviewPanel): void {
    const reason = this.pendingReason.get(panel);
    this.pendingReason.delete(panel);

    const now = Date.now();
    const state = readState(this.store, now);
    writeState(this.store, { ...state, lastPrompt: now });

    if (reason === 'auto') {
      this.autoShownThisSession = true;
    }
  }

  /** Webview → host `{ type: 'supportAction', action }`. */
  public handleAction(panel: vscode.WebviewPanel, action: SupportAction): void {
    const now = Date.now();
    const state = readState(this.store, now);
    writeState(this.store, applyAction(state, action, now));

    switch (action) {
      case 'review':
        void vscode.env.openExternal(vscode.Uri.parse(URLS.review));
        break;
      case 'feedback':
        void vscode.env.openExternal(vscode.Uri.parse(URLS.issue));
        break;
      case 'share':
        void vscode.env.clipboard.writeText(SHARE_MESSAGE).then(() => {
          void panel.webview.postMessage({ type: 'supportCopied' });
        });
        break;
      case 'later':
      case 'never':
      case 'close':
        break;
    }
  }

  /**
   * `mikedown.support` command when no MikeDown panel is open anywhere. The
   * only native notice left (Q2 resolved) — same five buttons as the
   * in-webview card, since there is no card to fall back to.
   */
  public showFallbackNotice(): void {
    const { review, share, feedback, later, never } = BUTTON_LABELS;
    void vscode.window.showInformationMessage(FALLBACK_NOTICE_TEXT, review, share, feedback, later, never).then(choice => {
      const now = Date.now();
      const state = readState(this.store, now);

      let action: SupportAction;
      if (choice === review) {
        action = 'review';
      } else if (choice === share) {
        action = 'share';
      } else if (choice === feedback) {
        action = 'feedback';
      } else if (choice === later) {
        action = 'later';
      } else if (choice === never) {
        action = 'never';
      } else {
        action = 'close'; // dismissed via X / Esc without choosing
      }

      writeState(this.store, applyAction(state, action, now));

      // No confirmation UI is possible here (no webview) — the clipboard
      // write is silent, same as any other native-toast button click.
      if (action === 'review') {
        void vscode.env.openExternal(vscode.Uri.parse(URLS.review));
      } else if (action === 'feedback') {
        void vscode.env.openExternal(vscode.Uri.parse(URLS.issue));
      } else if (action === 'share') {
        void vscode.env.clipboard.writeText(SHARE_MESSAGE);
      }
    });
  }

  /** Dev-only quick pick action: "Clear all support prompt state" — deletes every `mikedown.nag.*` key. */
  public devResetAll(): void {
    for (const key of Object.values(KEYS)) {
      void this.context.globalState.update(key, undefined);
    }
    this.autoShownThisSession = false;
    this.devForceMeaningfulNextSave = false;
  }

  /** Dev-only quick pick action: "Make eligible now" — backdates state and arms the next save to count as a meaningful session. */
  public devMakeEligibleNow(): void {
    const now = Date.now();
    const state = readState(this.store, now);
    writeState(this.store, {
      ...state,
      installDate: now - 30 * DAY,
      docOpens: 5,
      activeDays: 3,
      lastPrompt: 0,
      dismissed: false,
      reviewedAt: null,
    });
    this.autoShownThisSession = false;
    this.devForceMeaningfulNextSave = true;
  }
}
