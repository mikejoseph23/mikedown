/**
 * The toolbar's AI button: when it shows, what a click opens, and the small
 * first-run panel it opens while AI is off.
 *
 * The button shows only for a host with an AI adapter (`host.ai` and the
 * `ai` feature) and while `ai.showToolbarButton` is on. With AI off, a click
 * opens the first-run panel: the Experimental badge, the disclaimer, and
 * "Turn on and set up" (which turns AI on through the normal saveSettings
 * path and opens setup) or Cancel. With AI on, a click opens a menu of AI
 * actions plus "Manage engines…".
 *
 * Toolbar chrome only: nothing here touches the editor document or its DOM.
 */

import type { AiSettings } from './ai';
import type { AiHostTier } from './ai-settings-model';
import { button, el, experimentalBadge, experimentalDisclaimer, nextId } from './ai-settings-dom';
import { getPortal } from './portal';
import type { ToolbarDropdownEntry } from './toolbar-dropdown';

export type AiToolbarButtonMode = 'hidden' | 'firstRun' | 'menu';

/** What the button does: hidden without AI support or when turned off in settings. */
export function aiToolbarButtonMode(hasAiHost: boolean, settings: Pick<AiSettings, 'enabled' | 'showToolbarButton'>): AiToolbarButtonMode {
  if (!hasAiHost || !settings.showToolbarButton) {return 'hidden';}
  return settings.enabled ? 'menu' : 'firstRun';
}

/** The patch "Turn on and set up" sends through `host.saveSettings`. */
export const AI_TURN_ON_PATCH = { 'ai.enabled': true } as const;

/** Where "Turn on and set up" lands. */
export type AiSetupTarget =
  | { kind: 'page'; engineId?: string }
  | { kind: 'tab' };

/**
 * After turning AI on: a tier-2 host opens the AI Engines page on the
 * default route's engine (its Express form), else the first engine, else the
 * quick-start cards. A tier-1 host routes by itself, so it gets the AI tab.
 */
export function aiSetupTarget(tier: AiHostTier, settings: Pick<AiSettings, 'engines' | 'routing'>): AiSetupTarget {
  if (tier !== 2) {return { kind: 'tab' };}
  const byRoute = settings.routing.default?.engineId;
  const engineId = byRoute && settings.engines.some((e) => e.id === byRoute) ? byRoute : settings.engines[0]?.id;
  return engineId ? { kind: 'page', engineId } : { kind: 'page' };
}

// ── The menu (AI on) ────────────────────────────────────────────────────────

/** An AI menu entry: enabled, or disabled with the reason as its hint; null leaves it out. */
export type AiToolbarEntryState = { enabled: true } | { enabled: false; hint: string } | null;

export interface AiToolbarMenuInput {
  /** Rewrite selection: null leaves it out (read-only), otherwise enabled or disabled with a hint. */
  rewrite: AiToolbarEntryState;
  /** "Summarize document…": absent or null leaves it out. A disabled hint carries the router's reason (D15). */
  summarize?: AiToolbarEntryState;
  /** "Suggest titles…": absent or null leaves it out. */
  titles?: AiToolbarEntryState;
  /** True for a host with an engine registry ("Manage engines…"); otherwise "AI settings…". */
  canManageEngines: boolean;
  icons: { rewrite: string; manage: string; summarize?: string; titles?: string };
  onRewrite(): void;
  onSummarize?(): void;
  onSuggestTitles?(): void;
  onManage(): void;
}

export function aiToolbarMenuEntries(input: AiToolbarMenuInput): ToolbarDropdownEntry[] {
  const entries: ToolbarDropdownEntry[] = [];
  const add = (id: string, label: string, icon: string, state: AiToolbarEntryState | undefined, run: () => void): void => {
    if (!state) {return;}
    entries.push({
      type: 'action',
      id,
      label,
      icon,
      hint: state.enabled ? undefined : state.hint,
      isDisabled: () => !state.enabled,
      action: run,
    });
  };
  // Flat entries, no submenus (D14).
  add('ai-rewrite', 'Rewrite selection', input.icons.rewrite, input.rewrite, () => input.onRewrite());
  add('ai-summarize', 'Summarize document…', input.icons.summarize ?? input.icons.rewrite, input.summarize, () => input.onSummarize?.());
  add('ai-titles', 'Suggest titles…', input.icons.titles ?? input.icons.rewrite, input.titles, () => input.onSuggestTitles?.());
  if (entries.length > 0) {entries.push({ type: 'separator' });}
  entries.push({
    type: 'action',
    id: 'ai-manage',
    label: input.canManageEngines ? 'Manage engines…' : 'AI settings…',
    icon: input.icons.manage,
    action: () => input.onManage(),
  });
  return entries;
}

// ── The first-run panel (AI off) ────────────────────────────────────────────

export interface AiFirstRunPanelOptions {
  anchor: HTMLElement;
  /** "Turn on and set up". The panel is already closed. */
  onTurnOn(): void;
}

export interface AiFirstRunPanelHandle {
  readonly element: HTMLElement;
  /** Close without turning anything on. */
  close(): void;
}

let openPanel: { element: HTMLElement; close(restore: boolean): void } | null = null;

export function isAiFirstRunPanelOpen(): boolean {
  return openPanel !== null;
}

export function hideAiFirstRunPanel(): void {
  openPanel?.close(false);
}

/** Open the panel under `anchor` (one at a time) and focus "Turn on and set up". */
export function showAiFirstRunPanel(opts: AiFirstRunPanelOptions): AiFirstRunPanelHandle {
  hideAiFirstRunPanel();
  const { anchor } = opts;

  const panel = el('div', 'ai-first-run');
  panel.setAttribute('role', 'dialog');
  const titleId = nextId('ai-first-run-title');
  const textId = nextId('ai-first-run-text');
  panel.setAttribute('aria-labelledby', titleId);
  panel.setAttribute('aria-describedby', textId);

  const head = el('div', 'ai-experimental-head');
  const title = el('span', 'ai-experimental-title', 'AI features');
  title.id = titleId;
  head.append(title, experimentalBadge());
  const text = experimentalDisclaimer();
  text.id = textId;

  const actions = el('div', 'ai-first-run-actions');
  const cancel = button('settings-btn settings-btn--secondary', 'Cancel', { fk: 'ai-first-run:cancel' });
  const turnOn = button('settings-btn settings-btn--primary', 'Turn on and set up', { fk: 'ai-first-run:turn-on' });
  actions.append(cancel, turnOn);
  panel.append(head, text, actions);

  let closed = false;
  function close(restore: boolean): void {
    if (closed) {return;}
    closed = true;
    document.removeEventListener('mousedown', onOutside, true);
    panel.removeEventListener('keydown', onKeydown);
    panel.remove();
    if (openPanel?.element === panel) {openPanel = null;}
    if (restore && anchor.isConnected) {anchor.focus({ preventScroll: true });}
  }

  function onOutside(e: MouseEvent): void {
    const target = e.target as Node;
    // The anchor toggles the panel itself.
    if (!panel.contains(target) && !anchor.contains(target)) {close(false);}
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      // Two buttons: keep Tab between them.
      e.preventDefault();
      (document.activeElement === turnOn ? cancel : turnOn).focus();
    }
  }

  cancel.addEventListener('click', () => close(true));
  turnOn.addEventListener('click', () => {
    close(false);
    opts.onTurnOn();
  });
  panel.addEventListener('keydown', onKeydown);
  document.addEventListener('mousedown', onOutside, true);

  getPortal().appendChild(panel);
  position(panel, anchor);
  openPanel = { element: panel, close };
  turnOn.focus({ preventScroll: true });

  return { element: panel, close: () => close(true) };
}

/** Below the anchor (above when there is no room), inside the editor's box and the viewport. */
function position(panel: HTMLElement, anchor: HTMLElement): void {
  const a = anchor.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const bounds = anchor.closest('.mikedown-root')?.getBoundingClientRect();
  const minLeft = Math.max(8, (bounds?.left ?? 0) + 8);
  const maxLeft = Math.min(vw, bounds?.right ?? vw) - p.width - 8;
  const left = Math.max(minLeft, Math.min(a.left + a.width / 2 - p.width / 2, maxLeft));
  const below = vh - a.bottom >= p.height + 6 || vh - a.bottom >= a.top;
  const top = below ? a.bottom + 6 : a.top - p.height - 6;
  panel.style.left = `${left}px`;
  panel.style.top = `${Math.max(8, Math.min(top, vh - p.height - 8))}px`;
}
