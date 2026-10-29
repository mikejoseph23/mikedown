/**
 * The toolbar's AI button: when it shows, what a click opens, and the small
 * first-run panel it opens while AI is off.
 *
 * The button shows only for a host with an AI adapter (`host.ai` and the
 * `ai` feature) and while `ai.showToolbarButton` is on. With AI off, a click
 * opens the first-run panel: the title, one line of what AI does, the
 * Experimental badge and disclaimer, and Cancel plus one primary button. On
 * a host that can look for local servers (`host.ai.detectLocalServers`) the
 * panel looks while it is open: a running server makes the primary button
 * "Use LM Studio" (one click: engine, models, default route, AI on) with
 * "Set up another way…" beside it, and one privacy line whose "Learn more"
 * opens the AI Engines page too; otherwise the primary is "Set up", which
 * opens the AI Engines page, and AI turns on only at its Done (B3). A tier-1
 * host routes by itself: its button is "Turn on" and lands on the AI tab.
 * With AI on, a click opens a menu of AI actions plus "Manage engines…",
 * under a Thinking row when the routed model can think.
 *
 * Toolbar chrome only: nothing here touches the editor document or its DOM.
 */

import type { AiSettings, AiThinkingChoice, AiThinkingLevel } from './ai';
import type { AiHostTier } from './ai-settings-model';
import { button, el, experimentalBadge, experimentalDisclaimer, nextId, privacyLine } from './ai-settings-dom';
import { AI_DETECT_LOOKING, AI_DETECT_NONE } from './ai-local-setup';
import { getPortal } from './portal';
import type { ToolbarDropdownEntry } from './toolbar-dropdown';

export { aiToolbarButtonMode, type AiToolbarButtonMode } from './ai-lite';

/** The patch "Turn on" (tier 1) sends through `host.saveSettings`. Tier 2 turns AI on at the Engines page's Done instead. */
export const AI_TURN_ON_PATCH = { 'ai.enabled': true } as const;

/** Where "Set up" (or "Turn on") lands. */
export type AiSetupTarget =
  | { kind: 'page'; engineId?: string }
  | { kind: 'tab' };

/**
 * "Set up": a tier-2 host opens the AI Engines page on the
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
  /**
   * The Thinking row at the top: Default plus the levels the routed model's
   * kind can express. Absent hides it (no model that can think).
   */
  thinking?: AiToolbarThinkingRow;
  /** True for a host with an engine registry ("Manage engines…"); otherwise "AI settings…". */
  canManageEngines: boolean;
  icons: { rewrite: string; manage: string; summarize?: string; titles?: string };
  onRewrite(): void;
  onSummarize?(): void;
  onSuggestTitles?(): void;
  onManage(): void;
}

export interface AiToolbarThinkingRow {
  /** `thinkingChoices(kind)` for the routed model (non-empty). */
  choices: AiThinkingChoice[];
  /** The remembered level; null is Default (the model's own). */
  value(): AiThinkingLevel | null;
  onChange(level: AiThinkingLevel | null): void;
}

const THINKING_DEFAULT = 'default';

/** The menu's Thinking row: the popover dial's pill, with Default first. */
function thinkingRowEntry(row: AiToolbarThinkingRow): ToolbarDropdownEntry {
  // The dial's labels: Medium shortened to Med.
  const short = (label: string): string => (label === 'Medium' ? 'Med' : label);
  return {
    type: 'segmented',
    id: 'ai-thinking',
    label: 'Thinking',
    title: 'Thinking level for the next AI requests',
    options: [
      { value: THINKING_DEFAULT, label: 'Default', title: 'Thinking: the model\'s default' },
      ...row.choices.map((c) => ({ value: c.level, label: short(c.label), title: `Thinking: ${c.label}` })),
    ],
    value: () => row.value() ?? THINKING_DEFAULT,
    onChange: (v) => row.onChange(v === THINKING_DEFAULT ? null : v as AiThinkingLevel),
    classes: { group: 'ai-rw-think', label: 'ai-rw-think-label', segment: 'ai-rw-think-seg' },
  };
}

export function aiToolbarMenuEntries(input: AiToolbarMenuInput): ToolbarDropdownEntry[] {
  const entries: ToolbarDropdownEntry[] = [];
  if (input.thinking && input.thinking.choices.length > 0) {
    entries.push(thinkingRowEntry(input.thinking), { type: 'separator' });
  }
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
  if (entries.length > 0 && entries[entries.length - 1].type !== 'separator') {entries.push({ type: 'separator' });}
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

/** What local server detection found, for the panel. */
export type AiFirstRunDetection =
  /** A server is running and not set up yet: the primary button offers it. */
  | { kind: 'found'; presetId: string; name: string; models?: number }
  /** Nothing answered: say so, with where to go instead. */
  | { kind: 'none' }
  /** Nothing new to offer (a running server is already set up, or detection failed): say nothing. */
  | { kind: 'quiet' };

export interface AiFirstRunPanelOptions {
  anchor: HTMLElement;
  /** 1: the host routes by itself, so the button only turns AI on ("Turn on"). Default 2 ("Set up"). */
  tier?: AiHostTier;
  /** "Set up" (or "Turn on", or "Set up another way…"). The panel is already closed. */
  onTurnOn(): void;
  /** Look for local servers while the panel is open. Aborted when it closes. */
  detect?(signal: AbortSignal): Promise<AiFirstRunDetection>;
  /** "Use LM Studio": set it up and turn AI on. Rejects with an Error whose message the panel shows. */
  onUseLocal?(presetId: string): Promise<void>;
}

export interface AiFirstRunPanelHandle {
  readonly element: HTMLElement;
  /** Close without turning anything on. */
  close(): void;
}

/** The one line of verbs under the title (U9). */
export const AI_FIRST_RUN_VERBS = 'Rewrite, translate, explain, summarize, suggest titles and tags.';

/** "LM Studio is running on this computer, 3 models." */
export function aiDetectFoundText(name: string, models?: number): string {
  const count = models === undefined ? '' : `, ${models} ${models === 1 ? 'model' : 'models'}`;
  return `${name} is running on this computer${count}.`;
}

let openPanel: { element: HTMLElement; close(restore: boolean): void } | null = null;

export function isAiFirstRunPanelOpen(): boolean {
  return openPanel !== null;
}

export function hideAiFirstRunPanel(): void {
  openPanel?.close(false);
}

/**
 * Open the panel under `anchor` (one at a time) and focus its primary button.
 * With `detect`, a quiet status line looks for local servers; when one is
 * running, the primary button becomes "Use <name>" and "Set up another way…"
 * opens setup as before.
 */
export function showAiFirstRunPanel(opts: AiFirstRunPanelOptions): AiFirstRunPanelHandle {
  hideAiFirstRunPanel();
  const { anchor } = opts;
  const tier1 = opts.tier === 1;
  const setUpLabel = tier1 ? 'Turn on' : 'Set up';

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
  const verbs = el('p', 'ai-first-run-verbs', AI_FIRST_RUN_VERBS);
  const text = experimentalDisclaimer();
  text.id = textId;

  // Detection and setup progress: one quiet line, read out as it changes.
  const status = el('div', 'ai-first-run-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;

  const actions = el('div', 'ai-first-run-actions');
  const other = button('ai-link-btn ai-first-run-other', 'Set up another way…', { fk: 'ai-first-run:other' });
  other.hidden = true;
  const cancel = button('settings-btn settings-btn--secondary', 'Cancel', { fk: 'ai-first-run:cancel' });
  const primary = button('settings-btn settings-btn--primary', setUpLabel, { fk: 'ai-first-run:turn-on' });
  actions.append(other, cancel, primary);
  // Beside "Set up another way…" (which can lead to a cloud engine): local vs cloud in one line.
  const privacy = privacyLine(() => setUp());
  privacy.hidden = true;
  const learnMore = privacy.querySelector<HTMLButtonElement>('button')!;
  panel.append(head, verbs, text, status, privacy, actions);

  let found: Extract<AiFirstRunDetection, { kind: 'found' }> | null = null;
  let busy = false;
  const detectAbort = new AbortController();

  function setStatus(state: 'looking' | 'found' | 'none' | 'working' | 'error' | 'hidden', line = ''): void {
    status.hidden = state === 'hidden';
    status.dataset.state = state;
    status.replaceChildren();
    if (state === 'hidden') {return;}
    if (state === 'found') {
      const dot = el('span', 'ai-first-run-dot');
      dot.setAttribute('aria-hidden', 'true');
      status.append(dot);
    }
    status.append(el('span', '', line));
  }

  let closed = false;
  function close(restore: boolean): void {
    if (closed) {return;}
    closed = true;
    detectAbort.abort();
    document.removeEventListener('mousedown', onOutside, true);
    panel.removeEventListener('keydown', onKeydown);
    panel.remove();
    if (openPanel?.element === panel) {openPanel = null;}
    if (restore && anchor.isConnected) {anchor.focus({ preventScroll: true });}
  }

  function onOutside(e: MouseEvent): void {
    const target = e.target as Node;
    // The anchor toggles the panel itself. A setup in progress keeps it open.
    if (!busy && !panel.contains(target) && !anchor.contains(target)) {close(false);}
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!busy) {close(true);}
    } else if (e.key === 'Tab') {
      // Keep Tab on the panel's buttons.
      const order = [learnMore, other, cancel, primary].filter((b) => !b.hidden && !b.closest('[hidden]') && !b.disabled);
      if (order.length === 0) {return;}
      e.preventDefault();
      const at = order.indexOf(document.activeElement as HTMLButtonElement);
      const next = at < 0 ? 0 : (at + (e.shiftKey ? order.length - 1 : 1)) % order.length;
      order[next].focus();
    }
  }

  function setUp(): void {
    close(false);
    opts.onTurnOn();
  }

  async function useLocal(server: Extract<AiFirstRunDetection, { kind: 'found' }>): Promise<void> {
    if (!opts.onUseLocal) {return;}
    busy = true;
    for (const b of [learnMore, other, cancel, primary]) {b.disabled = true;}
    setStatus('working', `Setting up ${server.name}…`);
    try {
      await opts.onUseLocal(server.presetId);
      busy = false;
      close(true);
    } catch (err) {
      busy = false;
      if (closed) {return;}
      // Back to the plain panel: setup the long way is one click away.
      found = null;
      for (const b of [learnMore, other, cancel, primary]) {b.disabled = false;}
      other.hidden = true;
      privacy.hidden = true;
      primary.textContent = setUpLabel;
      setStatus('error', err instanceof Error && err.message ? err.message : `${server.name} could not be set up.`);
      primary.focus({ preventScroll: true });
    }
  }

  cancel.addEventListener('click', () => close(true));
  other.addEventListener('click', () => setUp());
  primary.addEventListener('click', () => {
    if (found) {void useLocal(found);} else {setUp();}
  });
  panel.addEventListener('keydown', onKeydown);
  document.addEventListener('mousedown', onOutside, true);

  if (opts.detect && !tier1) {
    setStatus('looking', AI_DETECT_LOOKING);
    void opts.detect(detectAbort.signal).then(
      (result) => {
        if (closed || busy) {return;}
        if (result.kind === 'found' && opts.onUseLocal) {
          found = result;
          primary.textContent = `Use ${result.name}`;
          other.hidden = false;
          privacy.hidden = false;
          setStatus('found', aiDetectFoundText(result.name, result.models));
        } else if (result.kind === 'none') {
          setStatus('none', AI_DETECT_NONE);
        } else {
          setStatus('hidden');
        }
        position(panel, anchor);
      },
      () => { if (!closed && !busy) {setStatus('hidden');} },
    );
  }

  getPortal().appendChild(panel);
  position(panel, anchor);
  openPanel = { element: panel, close };
  primary.focus({ preventScroll: true });

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
