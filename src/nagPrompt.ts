import * as vscode from 'vscode';

/**
 * Periodic "are you enjoying MikeDown?" prompt shown as a native VS Code
 * information toast. State lives in `context.globalState` (per-install, not
 * per-workspace) under keys prefixed with `mikedown.nag.`.
 *
 * Schedule:
 *   • First prompt requires ≥7 days since install AND ≥3 documents opened.
 *   • Dismissing the toast (X / Esc) counts as "remind later" — backoff
 *     ladder 14 → 30 → 60 → 90 days, capped at 90.
 *   • Any CTA click (review / share / feedback) resets the ladder; next ask
 *     is in 30 days.
 *   • "Stop asking" is sticky — never shows again.
 */

type NagAction = 'review' | 'share' | 'issue' | 'remindLater' | 'neverAgain';

const DAY = 24 * 60 * 60 * 1000;

const URLS = {
  review: 'https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor&ssr=false#review-details',
  share:  'https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor',
  issue:  'https://github.com/mikejoseph23/mikedown/issues/new',
};

const KEYS = {
  installDate: 'mikedown.nag.installDate',
  sessions:    'mikedown.nag.sessions',
  docOpens:    'mikedown.nag.docOpens',
  lastPrompt:  'mikedown.nag.lastPrompt',
  remindCount: 'mikedown.nag.remindCount',
  dismissed:   'mikedown.nag.dismissed',
  lastCtaAt:   'mikedown.nag.lastCtaAt',
} as const;

const MESSAGE = "Is MikeDown making your markdown workflow better? It's hard for a small editor to stand out in a sea of plugins — if it's helping you, telling a coworker or leaving a review goes a long way. Found a bug or have an idea? Open an issue on GitHub.";

export class NagPrompt {
  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Call once on activation. Records the session and seeds installDate. */
  public recordActivation(): void {
    const g = this.context.globalState;
    if (!g.get<number>(KEYS.installDate)) {
      void g.update(KEYS.installDate, Date.now());
    }
    void g.update(KEYS.sessions, (g.get<number>(KEYS.sessions) ?? 0) + 1);
  }

  /** Call whenever a MikeDown editor opens a document (engagement signal). */
  public recordDocOpen(): void {
    const g = this.context.globalState;
    void g.update(KEYS.docOpens, (g.get<number>(KEYS.docOpens) ?? 0) + 1);
  }

  /**
   * Show the prompt if eligible. Idempotent — safe to call multiple times
   * per session; the lastPrompt write gates re-entry.
   */
  public maybeShow(): void {
    if (!this.isEligible()) return;
    this.showToast();
  }

  private isEligible(): boolean {
    const g = this.context.globalState;
    if (g.get<boolean>(KEYS.dismissed)) return false;

    const now = Date.now();
    const installDate = g.get<number>(KEYS.installDate) ?? now;
    const docOpens = g.get<number>(KEYS.docOpens) ?? 0;
    const lastPrompt = g.get<number>(KEYS.lastPrompt) ?? 0;
    const remindCount = g.get<number>(KEYS.remindCount) ?? 0;
    const lastCtaAt = g.get<number>(KEYS.lastCtaAt) ?? 0;

    if (now - installDate < 7 * DAY) return false;
    if (docOpens < 3) return false;

    const requiredGap = nextDelayMs(remindCount, lastCtaAt > lastPrompt);
    if (now - lastPrompt < requiredGap) return false;

    return true;
  }

  private showToast(): void {
    void this.context.globalState.update(KEYS.lastPrompt, Date.now());

    // VS Code truncates toast buttons past ~12 visible chars when there are
    // 4 of them — keep each label short. The longer pitch lives in MESSAGE;
    // buttons are just action verbs. Dismissing (X / Esc) counts as
    // "remind later" so we don't lose disengaged users.
    const REVIEW = 'Review';
    const SHARE  = 'Share';
    const ISSUE  = 'Feedback';
    const NEVER  = 'Stop asking';

    void vscode.window.showInformationMessage(MESSAGE, REVIEW, SHARE, ISSUE, NEVER).then(choice => {
      if (choice === REVIEW) {
        this.handleAction('review');
      } else if (choice === SHARE) {
        this.handleAction('share');
      } else if (choice === ISSUE) {
        this.handleAction('issue');
      } else if (choice === NEVER) {
        this.handleAction('neverAgain');
      } else {
        this.handleAction('remindLater');
      }
    });
  }

  private handleAction(action: NagAction): void {
    const g = this.context.globalState;
    switch (action) {
      case 'review':
      case 'share':
      case 'issue':
        void g.update(KEYS.lastCtaAt, Date.now());
        // CTAs reset the remind ladder — a CTA earns another ask sooner
        // than someone who keeps clicking "remind later".
        void g.update(KEYS.remindCount, 0);
        void vscode.env.openExternal(vscode.Uri.parse(URLS[action]));
        break;
      case 'remindLater':
        void g.update(KEYS.remindCount, (g.get<number>(KEYS.remindCount) ?? 0) + 1);
        break;
      case 'neverAgain':
        void g.update(KEYS.dismissed, true);
        break;
    }
  }
}

/**
 * Backoff schedule. After a CTA we ask again in 30 days regardless of how
 * many "remind later"s preceded it — the CTA is a fresh engagement signal.
 * After a plain remind-later we extend the ladder: 14 → 30 → 60 → 90 (cap).
 */
function nextDelayMs(remindCount: number, hadCtaSinceLastPrompt: boolean): number {
  if (hadCtaSinceLastPrompt) return 30 * DAY;
  const ladder = [14, 30, 60, 90];
  const idx = Math.max(0, Math.min(remindCount, ladder.length - 1));
  return ladder[idx] * DAY;
}
