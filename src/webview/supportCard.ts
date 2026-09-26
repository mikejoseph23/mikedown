/**
 * "A note from Mike" support card (review-appeal-planning.md M5).
 *
 * A quiet floating note in the bottom right corner of the webview. It is a
 * sibling of the editor, appended straight to `document.body`, and never
 * touches `editor.view.dom` or anything inside the ProseMirror tree.
 *
 * Every user facing string comes from the `copy` payload of the host's
 * `showSupportCard` message (`CARD_COPY` in `src/supportCopy.ts`); this module
 * hardcodes none of the appeal copy, including the corner × button's
 * accessible name (`copy.closeLabel`).
 *
 * Styling uses VS Code theme tokens only (with fallbacks) so it follows light,
 * dark, and high contrast themes, plus MikeDown's own force light / force dark
 * editor theme override.
 */

export type SupportCardAction = 'review' | 'share' | 'feedback' | 'later' | 'never' | 'close';

/** Avatar slot. `initial` today; `image` lets a small photo drop in without layout changes. */
export type SupportCardAvatar =
  | { kind: 'initial'; text: string }
  | { kind: 'image'; src: string; alt?: string };

/** Mirrors `SupportCardCopy` in `src/supportCopy.ts` (kept local so the avatar slot can widen first). */
export interface SupportCardCopy {
  title: string;
  body: string;
  avatar: SupportCardAvatar;
  buttons: {
    review: string;
    share: string;
    feedback: string;
    later: string;
    never: string;
  };
  copiedConfirmation: string;
  /** Accessible name and tooltip of the corner × button. */
  closeLabel: string;
}

export interface ShowSupportCardOptions {
  reason: 'auto' | 'manual';
  copy: SupportCardCopy;
  /** Called for every button click (and Esc, as `close`). The card has already closed itself for close-type actions. */
  onAction: (action: SupportCardAction) => void;
  /** Called when the card closes while focus was inside it, so focus can go back to the editor. */
  restoreFocus?: () => void;
}

const ROOT_ID = 'mikedown-support-card';
const STYLE_ID = 'mikedown-support-card-style';
const TITLE_ID = 'mikedown-support-card-title';
const COPIED_MS = 2000;
const EXIT_MS = 120;

interface OpenCard {
  root: HTMLElement;
  shareBtn: HTMLButtonElement;
  shareLabel: string;
  copied: string;
  copiedTimer: number | undefined;
  opts: ShowSupportCardOptions;
}

let current: OpenCard | null = null;

export function isSupportCardOpen(): boolean {
  return current !== null;
}

export function showSupportCard(opts: ShowSupportCardOptions): void {
  // A second show replaces the first outright (no exit animation).
  if (current) {
    teardown(current, false);
    current = null;
  }
  ensureStyles();

  const { copy } = opts;
  const root = document.createElement('section');
  root.id = ROOT_ID;
  root.className = 'support-card';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-labelledby', TITLE_ID);
  root.setAttribute('data-testid', 'support-card');

  // ── Header: avatar + title + close ──
  const header = document.createElement('header');
  header.className = 'support-card-header';

  header.appendChild(buildAvatar(copy.avatar));

  const title = document.createElement('h2');
  title.id = TITLE_ID;
  title.className = 'support-card-title';
  title.textContent = copy.title;
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'support-card-close';
  const closeLabel = copy.closeLabel || 'Close';
  closeBtn.setAttribute('aria-label', closeLabel);
  closeBtn.title = closeLabel;
  closeBtn.setAttribute('data-action', 'close');
  closeBtn.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
  header.appendChild(closeBtn);
  root.appendChild(header);

  // ── Body: the letter, paragraph by paragraph ──
  const body = document.createElement('div');
  body.className = 'support-card-body';
  const paragraphs = copy.body.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  paragraphs.forEach((text, i) => {
    const p = document.createElement('p');
    p.textContent = text;
    // A short final line with no sentence punctuation is the sign off ("Mike").
    if (i === paragraphs.length - 1 && paragraphs.length > 1 && text.length <= 24 && !/[.!?]$/.test(text)) {
      p.className = 'support-card-signoff';
    }
    body.appendChild(p);
  });
  root.appendChild(body);

  // ── Actions ──
  const actions = document.createElement('div');
  actions.className = 'support-card-actions';

  const reviewBtn = makeButton(copy.buttons.review, 'review', 'support-card-btn support-card-btn--primary');
  const shareBtn = makeButton(copy.buttons.share, 'share', 'support-card-btn support-card-btn--secondary');
  const feedbackBtn = makeButton(copy.buttons.feedback, 'feedback', 'support-card-btn support-card-btn--secondary');
  actions.append(reviewBtn, shareBtn, feedbackBtn);
  root.appendChild(actions);

  const quiet = document.createElement('div');
  quiet.className = 'support-card-quiet';
  const laterBtn = makeButton(copy.buttons.later, 'later', 'support-card-link');
  const sep = document.createElement('span');
  sep.className = 'support-card-sep';
  sep.setAttribute('aria-hidden', 'true');
  sep.textContent = '·';
  const neverBtn = makeButton(copy.buttons.never, 'never', 'support-card-link');
  quiet.append(laterBtn, sep, neverBtn);
  root.appendChild(quiet);

  const card: OpenCard = {
    root,
    shareBtn,
    shareLabel: copy.buttons.share,
    copied: copy.copiedConfirmation,
    copiedTimer: undefined,
    opts,
  };

  root.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('button[data-action]') as HTMLButtonElement | null;
    if (!btn || !root.contains(btn)) return;
    handleAction(card, btn.dataset.action as SupportCardAction);
  });

  // Esc only closes when focus is inside the card (the listener lives on the card).
  root.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleAction(card, 'close');
    }
  });

  document.body.appendChild(root);
  current = card;

  // Enter transition: next frame so the initial state paints first.
  requestAnimationFrame(() => {
    if (current === card) root.classList.add('is-open');
  });

  if (opts.reason === 'manual') {
    reviewBtn.focus({ preventScroll: true });
  }
}

/** Close the card without posting an action (e.g. host teardown). */
export function hideSupportCard(): void {
  if (!current) return;
  const card = current;
  current = null;
  teardown(card, true);
}

/** Host confirmed the share line is on the clipboard: show the confirmation on the share button for 2s. */
export function showSupportCopied(): void {
  const card = current;
  if (!card) return;
  const btn = card.shareBtn;
  btn.classList.add('is-copied');
  btn.replaceChildren(checkGlyph(), document.createTextNode(card.copied));
  if (card.copiedTimer !== undefined) window.clearTimeout(card.copiedTimer);
  card.copiedTimer = window.setTimeout(() => {
    card.copiedTimer = undefined;
    btn.classList.remove('is-copied');
    btn.textContent = card.shareLabel;
  }, COPIED_MS);
}

// ── Internals ────────────────────────────────────────────────────────────────

function handleAction(card: OpenCard, action: SupportCardAction): void {
  if (current !== card) return;
  // Share keeps the card open to show the Copied confirmation; everything else closes it.
  if (action !== 'share') {
    current = null;
    teardown(card, true);
  }
  card.opts.onAction(action);
}

function teardown(card: OpenCard, animate: boolean): void {
  if (card.copiedTimer !== undefined) window.clearTimeout(card.copiedTimer);
  const hadFocus = card.root.contains(document.activeElement);
  const { root } = card;
  root.removeAttribute('id');
  root.setAttribute('aria-hidden', 'true');
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (animate && !reduced && root.classList.contains('is-open')) {
    root.classList.remove('is-open');
    root.classList.add('is-closing');
    window.setTimeout(() => root.remove(), EXIT_MS);
  } else {
    root.remove();
  }
  if (hadFocus) card.opts.restoreFocus?.();
}

function makeButton(label: string, action: SupportCardAction, className: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.dataset.action = action;
  btn.textContent = label;
  return btn;
}

function buildAvatar(avatar: SupportCardAvatar): HTMLElement {
  if (avatar.kind === 'image') {
    const img = document.createElement('img');
    img.className = 'support-card-avatar support-card-avatar--image';
    img.src = avatar.src;
    img.alt = avatar.alt ?? '';
    return img;
  }
  const span = document.createElement('span');
  span.className = 'support-card-avatar support-card-avatar--initial';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = avatar.text;
  return span;
}

function checkGlyph(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'support-card-check');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M3.5 8.5l3 3 6-7');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = SUPPORT_CARD_CSS;
  document.head.appendChild(style);
}

const SUPPORT_CARD_CSS = `
.support-card {
  --sc-bg: var(--vscode-editorWidget-background, var(--vscode-editor-background, #252526));
  --sc-fg: var(--vscode-editor-foreground, var(--vscode-foreground, #cccccc));
  --sc-title: var(--vscode-editorWidget-foreground, var(--vscode-foreground, #cccccc));
  --sc-border: var(--vscode-editorWidget-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.35)));
  --sc-shadow: var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));
  --sc-muted: var(--vscode-descriptionForeground, rgba(204, 204, 204, 0.7));
  --sc-focus: var(--vscode-focusBorder, #007fd4);
  --sc-primary-bg: var(--vscode-button-background, #0e639c);
  --sc-primary-fg: var(--vscode-button-foreground, #ffffff);
  --sc-primary-hover: var(--vscode-button-hoverBackground, var(--sc-primary-bg));
  --sc-secondary-bg: var(--vscode-button-secondaryBackground, #3a3d41);
  --sc-secondary-fg: var(--vscode-button-secondaryForeground, #ffffff);
  --sc-secondary-hover: var(--vscode-button-secondaryHoverBackground, var(--sc-secondary-bg));
  --sc-button-border: var(--vscode-button-border, transparent);
  --sc-hover: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.15));

  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 1040; /* above the editor and popovers, below the Settings modal (1050) */
  box-sizing: border-box;
  width: 380px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  padding: 16px 16px 12px;
  background: var(--sc-bg);
  color: var(--sc-fg);
  border: 1px solid var(--sc-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px var(--sc-shadow), 0 0 0 0.5px var(--sc-shadow);
  font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
  font-size: 13px;
  line-height: 1.5;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 150ms ease-out, transform 150ms ease-out;
}
.support-card.is-open { opacity: 1; transform: none; }
.support-card.is-closing {
  opacity: 0;
  transform: translateY(4px);
  transition-duration: 120ms;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .support-card, .support-card.is-closing { transition: none; transform: none; }
}
@media (max-width: 479px) {
  .support-card {
    left: 12px;
    right: 12px;
    bottom: 12px;
    width: auto;
    max-width: none;
    max-height: calc(100vh - 24px);
  }
}

.support-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 10px;
  flex: none;
}
.support-card-avatar {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  overflow: hidden;
  box-sizing: border-box;
}
.support-card-avatar--initial {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--sc-primary-bg);
  color: var(--sc-primary-fg);
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  user-select: none;
}
.support-card-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--sc-title);
  letter-spacing: 0.005em;
}
.support-card-close {
  flex: none;
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin: -4px -6px 0 0;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--sc-muted);
  cursor: pointer;
}
.support-card-close:hover { background: var(--sc-hover); color: var(--sc-fg); }

.support-card-body {
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-left: 38px; /* align the letter under the title, past the avatar */
  color: var(--sc-fg);
  user-select: text;
}
.support-card-body p { margin: 0 0 8px; }
.support-card-body p:last-child { margin-bottom: 0; }
.support-card-signoff { font-style: italic; color: var(--sc-muted); }

.support-card-actions {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 14px 0 0;
}
.support-card-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid var(--sc-button-border);
  border-radius: 4px;
  font: inherit;
  font-size: 12.5px;
  line-height: 18px;
  cursor: pointer;
  white-space: nowrap;
}
.support-card-btn--primary { background: var(--sc-primary-bg); color: var(--sc-primary-fg); }
.support-card-btn--primary:hover { background: var(--sc-primary-hover); }
.support-card-btn--secondary { background: var(--sc-secondary-bg); color: var(--sc-secondary-fg); }
.support-card-btn--secondary:hover { background: var(--sc-secondary-hover); }
.support-card-check { flex: none; }

.support-card-quiet {
  flex: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  margin: 8px 0 0 -6px; /* the links' own 6px padding lines their text up with the buttons */
  color: var(--sc-muted);
  font-size: 12px;
}
.support-card-link {
  padding: 2px 6px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--sc-muted);
  font: inherit;
  cursor: pointer;
}
.support-card-link:hover { color: var(--sc-fg); text-decoration: underline; text-underline-offset: 2px; }
.support-card-sep { opacity: 0.6; }

.support-card button:focus { outline: none; }
.support-card button:focus-visible {
  outline: 1px solid var(--sc-focus);
  outline-offset: 2px;
}

/* MikeDown force light / force dark editor theme: theme.css overrides the
   editor tokens but not the widget and button ones, so pin those here. */
body.mikedown-force-light .support-card {
  --sc-bg: var(--vscode-editorWidget-background, #f3f3f3);
  --sc-title: var(--vscode-editor-foreground, #1e1e1e);
  --sc-shadow: rgba(0, 0, 0, 0.16);
  --sc-secondary-bg: #e5e5e5;
  --sc-secondary-fg: #3b3b3b;
  --sc-secondary-hover: #cccccc;
  --sc-hover: rgba(0, 0, 0, 0.07);
}
body.mikedown-force-dark .support-card {
  --sc-title: var(--vscode-editor-foreground, #cccccc);
  --sc-shadow: rgba(0, 0, 0, 0.5);
  --sc-secondary-bg: #313131;
  --sc-secondary-fg: #cccccc;
  --sc-secondary-hover: #3c3c3c;
  --sc-hover: rgba(255, 255, 255, 0.08);
}

/* High contrast: borders carry the structure, no shadow. */
body.vscode-high-contrast .support-card,
body.vscode-high-contrast-light .support-card {
  --sc-border: var(--vscode-contrastBorder, currentColor);
  box-shadow: none;
}
body.vscode-high-contrast .support-card-avatar,
body.vscode-high-contrast-light .support-card-avatar {
  border: 1px solid var(--vscode-contrastBorder, currentColor);
}
body.vscode-high-contrast .support-card-btn,
body.vscode-high-contrast-light .support-card-btn {
  border-color: var(--vscode-button-border, var(--vscode-contrastBorder, currentColor));
}
body.vscode-high-contrast .support-card-close:hover,
body.vscode-high-contrast-light .support-card-close:hover,
body.vscode-high-contrast .support-card-btn:hover,
body.vscode-high-contrast-light .support-card-btn:hover {
  outline: 1px dashed var(--vscode-contrastActiveBorder, var(--sc-focus));
  outline-offset: 1px;
}
`;
