/**
 * Approved user-facing copy for the "A note from Mike" support appeal
 * (review-appeal-planning.md M1, approved by Mike 2026-09-26 — see
 * `review-appeal-copy.md` for rationale and the sign-off note). This is the
 * single source of that copy: `src/supportPrompt.ts` sends `CARD_COPY`
 * verbatim inside every `showSupportCard` message so the webview never
 * hardcodes a support-appeal string, and reuses `SHARE_MESSAGE` /
 * `FALLBACK_NOTICE_TEXT` for the clipboard write and the `mikedown.support`
 * fallback notice respectively.
 *
 * No `vscode` import — this module is plain data, shareable with the
 * (future) webview-side render code via the message payload rather than an
 * import, since the webview bundle cannot import anything that pulls in
 * `vscode`.
 */

/** Card button labels, keyed by the `supportAction` they post. */
export const BUTTON_LABELS = {
  review: 'Leave a review',
  share: 'Tell a colleague',
  feedback: 'Open an issue',
  later: 'Maybe later',
  never: "Don't ask again",
} as const;

/** Shape of the `copy` payload sent inside `{ type: 'showSupportCard', reason, copy }`. */
export interface SupportCardCopy {
  title: string;
  body: string;
  avatar: { kind: 'initial'; text: string };
  buttons: typeof BUTTON_LABELS;
  copiedConfirmation: string;
}

export const CARD_COPY: SupportCardCopy = {
  title: 'A note from Mike',
  body:
    "Thanks for using MikeDown.\n\n" +
    "I built it for myself. I'd spent years in split pane previews and wanted markdown to feel like having a few Word documents open. It's been my main editor ever since, and nearly every feature came from using it daily. I'm accidentally proud of how it turned out.\n\n" +
    "It's just me, and it's easy to miss on the Marketplace. A review, or a word to a colleague who uses VS Code, helps more than you'd think. Bug or idea? Open an issue. I reply fast.\n\n" +
    "Mike",
  avatar: { kind: 'initial', text: 'M' },
  buttons: BUTTON_LABELS,
  copiedConfirmation: 'Copied. Paste it anywhere.',
};

/** Written to the clipboard by the `share` ("Tell a colleague") action — a neutral line, not Mike's voice (Q7). */
export const SHARE_MESSAGE =
  'Check out MikeDown, a WYSIWYG markdown editor for VS Code: https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor';

/** `mikedown.support` fallback notice text when no MikeDown editor is open — the only native notice left (Q2). */
export const FALLBACK_NOTICE_TEXT = 'Open a markdown file in MikeDown to see how you can support the project.';
