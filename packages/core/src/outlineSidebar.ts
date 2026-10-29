// In-editor document sidebar. Hosts stacked sections — Outline, Backlinks,
// Tags (workspace-wide), Properties — plus a
// footer strip with modified time / word count / reading time.
//
// Each editor builds its own instance (`createOutlineSidebar`), so split panes
// and several editors on one page keep separate sidebars.
//
// Visibility is binary across documents: pin on (`always`) shows the sidebar
// for every document; pin off (`never`) starts every document hidden. The
// toggle button can still surface it for the current session; nothing about
// that ad-hoc visibility persists.

import { countWords, readingMinutes } from './shared/wordCount';
import { formatRelativeTime } from './relativeTime';
import type { BacklinkItem, MikeDownSidebarPrefs } from './host';
import type { AiIndicatorState, AiIndicatorTone } from './ai-settings-model';
import { hasDescendants, hiddenByFolds, nearestVisibleIndex } from './outlineFold';
import type { PropertySuggestions } from './ai/prompts/properties';
import type { PropertySuggestionPick } from './propertySuggestions';

export type OutlineVisibilityPref = 'always' | 'never';
export type OutlinePosition = 'left' | 'right';

interface Heading {
  level: number;
  text: string;
  anchor: string;
  pos: number;
}

interface FrontmatterEntry {
  key: string;
  /** Either a scalar string or an array of strings (for `tags: [a, b]`-style). */
  value: string | string[];
}

interface InitOptions {
  editor: any;
  /** The sidebar `<aside>` (rebuilt here) and its show button, owned by the editor instance. */
  sidebarEl: HTMLElement;
  toggleEl: HTMLButtonElement;
  /** The editor's scrolling container, for the outline's scroll spy. */
  scrollContainer: HTMLElement;
  /** Pref persistence (pin default, section collapse). Absent = in-memory only. */
  prefs?: MikeDownSidebarPrefs;
  /** Tag click in the Tags section or a Properties tag pill. */
  onOpenTag?: (tag: string) => void;
  /** Backlink row click: open the source beside this document. */
  onOpenBacklink?: (item: BacklinkItem) => void;
  anchorFn: (text: string) => string;
  /**
   * Invoked when the user edits properties inline. The callback owns the
   * serialize-and-post step; the sidebar just produces the new entries list.
   */
  onPropertiesChange?: (entries: FrontmatterEntry[]) => void;
  /** Footer "Support MikeDown" link clicked — the owner asks the host to open the card. */
  onSupportOpen?: () => void;
  /** Footer × clicked — the owner persists `mikedown.support.showSidebarLink = false`. */
  onSupportDismiss?: () => void;
  /** Footer AI chip clicked — the owner opens the AI settings tab. */
  onAiIndicatorClick?: () => void;
  /** Properties header Suggest (or "Try again") clicked — the owner runs the AI request. */
  onSuggestProperties?: () => void;
  /** A suggestion chip clicked: true when it was applied (the chip then goes). */
  onApplyPropertySuggestion?: (pick: PropertySuggestionPick) => boolean;
  /** The chips row closed while running (Cancel) — the owner aborts the request. */
  onCancelPropertySuggestions?: () => void;
}

/** Whether the Properties header shows Suggest, and whether it can be clicked. */
export type SuggestPropertiesAvailability =
  | { state: 'hidden' }
  | { state: 'disabled'; reason: string }
  | { state: 'enabled' };

export type PropertySuggestionsState = 'idle' | 'running' | 'error';

/** Entry point labels this module renders (subset of `ENTRY_COPY` in src/supportCopy.ts). */
export interface SupportLinkCopy {
  sidebarLink: string;
  dismissLabel: string;
  dismissConfirmation: string;
}

const MIN_WIDTH = 160;
const MAX_WIDTH = 360;
const DEFAULT_WIDTH = 200;
/**
 * Narrowest text column the docked sidebar may leave. Below it (split panes,
 * a narrow VS Code editor group) the sidebar steps aside: hidden, or an overlay
 * when opened there, and docked again once the editor is wide enough.
 */
export const MIN_TEXT_COLUMN_PX = 420;

// Two pin states so the on/off difference is obvious:
//   PIN_SVG_OFF — outlined pin, tilted (looks loose / "about to fall out")
//   PIN_SVG_ON  — filled pin, upright (firmly stuck in)
// Combined with the .pinned CSS pill background, on/off is unmistakable.
const PIN_SVG_OFF = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform:rotate(45deg)"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
const PIN_SVG_ON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.5 2.5a1 1 0 0 0-1.7-.7l-1.4 1.4a2 2 0 0 0-.5 2l.3 1-3.8 3.8-1.2-.3a2 2 0 0 0-1.9.5l-1 1a1 1 0 0 0 0 1.4l4 4-4.5 4.5a1 1 0 1 0 1.4 1.4l4.5-4.5 4 4a1 1 0 0 0 1.4 0l1-1a2 2 0 0 0 .5-1.9l-.3-1.2 3.8-3.8 1 .3a2 2 0 0 0 2-.5l1.4-1.4a1 1 0 0 0-.7-1.7L14.5 2.5z"/></svg>';

// Side arrow icons — point to the *opposite* side (i.e. where clicking will move the sidebar to).
const SIDEBAR_ARROW_LEFT  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
const SIDEBAR_ARROW_RIGHT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';

// Outline Fold all / Unfold all: chevrons pointing in / out.
const FOLD_ALL_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/></svg>';
const UNFOLD_ALL_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>';

// Discovery-toggle icon — outline rect + a filled pane on the side the sidebar
// lives on. Mirrors VS Code's own layout-sidebar codicons.
const SIDEBAR_ICON_LEFT  = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1"/><rect x="3" y="4" width="3" height="8" fill="currentColor" stroke="none"/></svg>';
const SIDEBAR_ICON_RIGHT = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1"/><rect x="10" y="4" width="3" height="8" fill="currentColor" stroke="none"/></svg>';

// Properties header Suggest: two sparkles.
const SPARKLE_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.5l1.7 4.8 4.8 1.7-4.8 1.7L10 16.5l-1.7-4.8L3.5 10l4.8-1.7z"/><path d="M18 14l.9 2.1 2.1.9-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z"/></svg>';

// Footer AI chip glyphs, 10px: a house for local, a cloud, a hollow ring when
// off or unrouted, a filled dot for a host that routes by itself.
const aiGlyph = (body: string) => `<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const AI_CHIP_GLYPHS: Record<AiIndicatorTone | 'warn', string> = {
  local: aiGlyph('<path d="M2.5 7.5L8 3l5.5 4.5M4 6.5V13h8V6.5"/>'),
  cloud: aiGlyph('<path d="M4.5 12.5h7a2.75 2.75 0 0 0 .3-5.48A4 4 0 0 0 4.1 7.6 2.5 2.5 0 0 0 4.5 12.5z"/>'),
  off: aiGlyph('<circle cx="8" cy="8" r="4.5"/>'),
  none: aiGlyph('<circle cx="8" cy="8" r="4.5"/><path d="M5 11l6-6"/>'),
  on: aiGlyph('<circle cx="8" cy="8" r="4" fill="currentColor"/>'),
  warn: aiGlyph('<path d="M8 2.2l6.2 11H1.8z"/><path d="M8 6.5v3M8 11.4v.1"/>'),
};

interface TagItem {
  tag: string;
  count: number;
}

/** One editor's sidebar. Each editor instance owns its own (split panes, several editors on a page). */
export interface OutlineSidebar {
  applyOutlineState(state: {
    pref?: OutlineVisibilityPref;
    width?: number;
    position?: OutlinePosition;
    sectionPrefs?: Record<string, boolean>;
  }): void;
  applyBacklinks(items: BacklinkItem[]): void;
  applyTags(items: TagItem[]): void;
  setTagsSectionEnabled(enabled: boolean): void;
  applyProperties(entries: FrontmatterEntry[], opts?: { editable?: boolean }): void;
  focusPropertiesSection(): void;
  applyDocMeta(meta: { mtimeMs?: number | null }): void;
  applyPlainText(plainText: string): void;
  toggleSidebarVisible(): void;
  /** True while the sidebar is showing. */
  isVisible(): boolean;
  applySupportLink(opts: { visible: boolean; copy?: SupportLinkCopy | null }): void;
  /** Show the AI indicator chip in the footer, or hide it with null. */
  applyAiIndicator(state: AiIndicatorState | null): void;
  /** Show, disable (with the reason as its tooltip) or hide the Properties header's Suggest button. */
  applySuggestAvailability(a: SuggestPropertiesAvailability): void;
  /**
   * The chips row under Properties: `running` shows a progress line and
   * `message` (the engine badge text, or "Fixing the answer format…");
   * `error` shows `message` with Try again; `idle` shows the chips of `s`,
   * or nothing when `s` is null.
   */
  applyPropertySuggestions(s: PropertySuggestions | null, state: PropertySuggestionsState, message?: string): void;
  /** Stop the footer clock and forget the DOM this instance was bound to. */
  destroy(): void;
}

/**
 * Build the sidebar into `opts.sidebarEl` and wire it to `opts.editor`. All
 * state lives in this closure, so two editors on one page keep separate
 * sidebars.
 */
export function createOutlineSidebar(opts: InitOptions): OutlineSidebar {
  let pref: OutlineVisibilityPref = 'never';
  let position: OutlinePosition = 'right';
  let width = DEFAULT_WIDTH;
  // Visibility: `wantVisible` is the session intent (pin pref, show/hide while
  // wide); `narrow` is measured; `overlayOpen` is a peek while narrow.
  let wantVisible = false;
  let narrow = false;
  let overlayOpen = false;
  let rootWidth = 0;
  let resizeObserver: ResizeObserver | null = null;
  let editorRef: any = null;
  let prefsRef: MikeDownSidebarPrefs | null = null;
  let openTagCb: ((tag: string) => void) | null = null;
  let openBacklinkCb: ((item: BacklinkItem) => void) | null = null;
  let anchorFnRef: (text: string) => string = (t) => t;
  let activeAnchor = '';
  let lastHeadingsKey = '';
  // Outline headings the user folded, by anchor, so re-renders on edits keep
  // them. Pruned on rebuild to headings that still have descendants.
  const foldedAnchors = new Set<string>();

  let sidebarEl: HTMLElement | null = null;
  let scrollContainerEl: HTMLElement | null = null;
  let outlineListEl: HTMLElement | null = null;
  let backlinksListEl: HTMLElement | null = null;
  let backlinksCountEl: HTMLElement | null = null;
  let backlinksSectionEl: HTMLElement | null = null;
  let tagsListEl: HTMLElement | null = null;
  let tagsCountEl: HTMLElement | null = null;
  let tagsSectionEl: HTMLElement | null = null;
  let propertiesSectionEl: HTMLElement | null = null;
  let propertiesListEl: HTMLElement | null = null;
  let footerEl: HTMLElement | null = null;
  let toggleEl: HTMLButtonElement | null = null;
  let closeEl: HTMLButtonElement | null = null;
  let handleEl: HTMLElement | null = null;
  let pinButtonEl: HTMLButtonElement | null = null;
  let positionToggleEl: HTMLButtonElement | null = null;

  // Per-document section collapse state (mirrored from host).
  const collapsedSections = new Set<string>(); // 'properties' | 'outline' | 'backlinks' | 'tags'

  // Sections the user has explicitly toggled at least once on this doc. Tracked
  // per-section (not a single global flag) so that toggling Outline doesn't
  // silence the auto-collapse-when-empty rule for Properties/Backlinks, and so
  // each of those two sections decides independently whether the auto rule
  // still applies.
  const userTouchedSections = new Set<string>();

  let currentBacklinks: BacklinkItem[] = [];
  // Set by the first applyBacklinks call; until then the section stays hidden.
  let backlinksReceived = false;
  let lastBacklinksKey = '';
  // Source docs (by uri) whose multi-link group the user has expanded. Persists
  // across re-renders so a workspace resave elsewhere doesn't collapse the view.
  const expandedBacklinkGroups = new Set<string>();
  let currentTags: TagItem[] = [];
  let lastTagsKey: string | null = null;
  let tagsSectionEnabled = true;
  let currentProperties: FrontmatterEntry[] = [];
  let propertiesEditable = false;
  let propertiesChangeCb: ((entries: FrontmatterEntry[]) => void) | null = null;

  // Footer state — updates whenever any input changes.
  let docMtimeMs: number | null = null;
  let docPlainText = '';
  let footerTickTimer: number | null = null;
  let footerRowsEl: HTMLElement | null = null;

  // Support appeal footer link (M6). Hidden until the host's first `settings`
  // broadcast delivers both the toggle and the approved copy.
  let supportLinkVisible = false;
  let supportLinkCopy: SupportLinkCopy | null = null;
  let supportOpenCb: (() => void) | null = null;
  let supportDismissCb: (() => void) | null = null;
  let supportStatusEl: HTMLElement | null = null;
  let supportStatusTimer: number | null = null;
  const SUPPORT_STATUS_MS = 4000;

  // AI indicator chip (which engine served the last request). Persistent, so
  // keyboard focus survives the footer's row re-renders.
  let aiChipEl: HTMLButtonElement | null = null;
  let aiIndicatorCb: (() => void) | null = null;
  let aiIndicator: AiIndicatorState | null = null;

  // Properties suggestions (AI): the header button and the chips row.
  let suggestBtnEl: HTMLButtonElement | null = null;
  let suggestRowEl: HTMLElement | null = null;
  let suggestAvailability: SuggestPropertiesAvailability = { state: 'hidden' };
  let suggestState: PropertySuggestionsState = 'idle';
  let suggestMessage = '';
  let suggestions: PropertySuggestions | null = null;
  let suggestCb: (() => void) | null = null;
  let applySuggestionCb: ((pick: PropertySuggestionPick) => boolean) | null = null;
  let cancelSuggestionsCb: (() => void) | null = null;

  function init(opts: InitOptions): void {
    editorRef = opts.editor;
    prefsRef = opts.prefs ?? null;
    openTagCb = opts.onOpenTag ?? null;
    openBacklinkCb = opts.onOpenBacklink ?? null;
    anchorFnRef = opts.anchorFn;
    propertiesChangeCb = opts.onPropertiesChange ?? null;
    supportOpenCb = opts.onSupportOpen ?? null;
    supportDismissCb = opts.onSupportDismiss ?? null;
    aiIndicatorCb = opts.onAiIndicatorClick ?? null;
    suggestCb = opts.onSuggestProperties ?? null;
    applySuggestionCb = opts.onApplyPropertySuggestion ?? null;
    cancelSuggestionsCb = opts.onCancelPropertySuggestions ?? null;

    sidebarEl = opts.sidebarEl;
    toggleEl = opts.toggleEl;
    scrollContainerEl = opts.scrollContainer;
    if (!sidebarEl || !toggleEl) {return;}

    buildSidebarSkeleton(sidebarEl);

    closeEl = sidebarEl.querySelector<HTMLButtonElement>('.outline-close');
    handleEl = sidebarEl.querySelector<HTMLElement>('.outline-resize-handle');

    setWidth(width);
    setPosition(position);
    setVisible(false);

    toggleEl.addEventListener('click', () => showByUser(true));
    closeEl?.addEventListener('click', () => showByUser(false));
    handleEl && wireResize(handleEl);
    watchWidth();

    editorRef.on('update', () => rebuildHeadings());
    editorRef.on('selectionUpdate', () => updateActiveFromCursor());
    wireScrollSpy();
    rebuildHeadings();

    // Footer refreshes the "modified X ago" string once a minute so it stays
    // accurate without spamming layout work.
    startFooterTick();

    // Ask the host for our persisted prefs/state.
    prefsRef?.requestState();
  }

  /**
   * Reconstruct the sidebar's inner DOM so multi-section layout markup lives
   * here (and not bloating the HTML template in markdownEditorProvider.ts).
   * Preserves the close button + resize handle that were declared inline.
   */
  function buildSidebarSkeleton(root: HTMLElement): void {
    // Wipe any prior children — the host HTML only contains a top header and
    // an .outline-list / .outline-resize-handle stub we want to replace.
    root.replaceChildren();

    // Outline — anchors the top of the stack so its header controls (position
    // toggle, pin, close) sit at the top of the sidebar where users expect.
    const outlineSection = document.createElement('section');
    outlineSection.className = 'sidebar-section outline-section';
    outlineSection.dataset.section = 'outline';
    outlineSection.appendChild(buildSectionHeader('Outline', 'outline', /* withClose */ true, /* withPin */ true));
    outlineListEl = document.createElement('nav');
    outlineListEl.className = 'sidebar-section-body outline-list';
    outlineListEl.setAttribute('role', 'navigation');
    outlineSection.appendChild(outlineListEl);
    root.appendChild(outlineSection);

    // Backlinks
    backlinksSectionEl = document.createElement('section');
    backlinksSectionEl.className = 'sidebar-section backlinks-section';
    backlinksSectionEl.dataset.section = 'backlinks';
    const blHeader = buildSectionHeader('Backlinks', 'backlinks');
    backlinksCountEl = document.createElement('span');
    backlinksCountEl.className = 'section-count';
    backlinksCountEl.hidden = true;
    blHeader.querySelector('.section-title')?.appendChild(backlinksCountEl);
    backlinksSectionEl.appendChild(blHeader);
    backlinksListEl = document.createElement('div');
    backlinksListEl.className = 'sidebar-section-body backlinks-list';
    backlinksSectionEl.appendChild(backlinksListEl);
    // Hidden until the host pushes backlinks: a host without a link index has
    // nothing to show here.
    backlinksSectionEl.hidden = !backlinksReceived;
    root.appendChild(backlinksSectionEl);

    // Tags — every tag in the workspace with its document count. Clicking one
    // runs the same QuickPick flow as Cmd/Ctrl+clicking an inline #tag.
    tagsSectionEl = document.createElement('section');
    tagsSectionEl.className = 'sidebar-section tags-section';
    tagsSectionEl.dataset.section = 'tags';
    tagsSectionEl.hidden = !tagsSectionEnabled;
    const tagsHeader = buildSectionHeader('Tags', 'tags');
    tagsCountEl = document.createElement('span');
    tagsCountEl.className = 'section-count';
    tagsCountEl.hidden = true;
    tagsHeader.querySelector('.section-title')?.appendChild(tagsCountEl);
    tagsSectionEl.appendChild(tagsHeader);
    tagsListEl = document.createElement('div');
    tagsListEl.className = 'sidebar-section-body tags-list';
    tagsSectionEl.appendChild(tagsListEl);
    root.appendChild(tagsSectionEl);

    // Properties — always visible (renders an empty-state placeholder when no
    // frontmatter exists). Lives below Backlinks so the editor's primary
    // navigation (Outline + Backlinks) gets priority at the top.
    propertiesSectionEl = document.createElement('section');
    propertiesSectionEl.className = 'sidebar-section properties-section';
    propertiesSectionEl.dataset.section = 'properties';
    const propsHeader = buildSectionHeader('Properties', 'properties');
    suggestBtnEl = document.createElement('button');
    suggestBtnEl.type = 'button';
    suggestBtnEl.className = 'properties-suggest-btn';
    suggestBtnEl.setAttribute('aria-label', 'Suggest properties with AI');
    suggestBtnEl.innerHTML = SPARKLE_SVG;
    suggestBtnEl.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (suggestAvailability.state === 'enabled') {suggestCb?.();}
    });
    propsHeader.appendChild(suggestBtnEl);
    propertiesSectionEl.appendChild(propsHeader);
    propertiesListEl = document.createElement('div');
    propertiesListEl.className = 'sidebar-section-body properties-list';
    propertiesSectionEl.appendChild(propertiesListEl);
    suggestRowEl = document.createElement('div');
    suggestRowEl.className = 'sidebar-section-body properties-suggest';
    suggestRowEl.setAttribute('data-testid', 'properties-suggest');
    propertiesSectionEl.appendChild(suggestRowEl);
    root.appendChild(propertiesSectionEl);
    renderSuggestButton();
    renderSuggestions();

    // Footer
    // Footer. The rows wrapper is rebuilt on every render (60s tick, edits);
    // the status line is persistent so its live region survives re-renders.
    footerEl = document.createElement('div');
    footerEl.className = 'sidebar-footer';
    footerRowsEl = document.createElement('div');
    footerRowsEl.className = 'sidebar-footer-rows';
    supportStatusEl = document.createElement('div');
    supportStatusEl.className = 'sidebar-footer-status';
    supportStatusEl.setAttribute('role', 'status');
    supportStatusEl.setAttribute('data-testid', 'sidebar-support-status');
    aiChipEl = document.createElement('button');
    aiChipEl.type = 'button';
    aiChipEl.className = 'sidebar-ai-chip';
    aiChipEl.setAttribute('data-testid', 'sidebar-ai-chip');
    aiChipEl.addEventListener('click', () => aiIndicatorCb?.());
    footerEl.append(aiChipEl, footerRowsEl, supportStatusEl);
    root.appendChild(footerEl);
    renderAiIndicator();

    // Resize handle — same role as before
    const handle = document.createElement('div');
    handle.className = 'outline-resize-handle';
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', 'Resize sidebar');
    root.appendChild(handle);

    renderBacklinksEmpty();
    lastTagsKey = null;
    renderTags();
    renderFooter();
  }

  function buildSectionHeader(label: string, section: string, withClose = false, withPin = false): HTMLElement {
    const header = document.createElement('div');
    header.className = 'sidebar-section-header';
    header.tabIndex = 0;
    header.setAttribute('role', 'button');
    header.setAttribute('aria-controls', `mikedown-section-${section}`);

    const chevron = document.createElement('span');
    chevron.className = 'section-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '▾';
    header.appendChild(chevron);

    const title = document.createElement('span');
    title.className = 'section-title';
    title.textContent = label;
    header.appendChild(title);

    // Position toggle + pin live on the Outline header (the sidebar's de-facto
    // master header). Position toggle flips left↔right; pin toggles between
    // 'always' (pinned open) and 'remember' (per-document) visibility.
    if (withPin) {
      const foldAll = document.createElement('button');
      foldAll.type = 'button';
      foldAll.className = 'outline-fold-all';
      foldAll.style.marginLeft = 'auto';
      foldAll.title = 'Fold all';
      foldAll.setAttribute('aria-label', 'Fold all outline headings');
      foldAll.innerHTML = FOLD_ALL_SVG;
      foldAll.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setAllFolded(true);
      });
      header.appendChild(foldAll);

      const unfoldAll = document.createElement('button');
      unfoldAll.type = 'button';
      unfoldAll.className = 'outline-unfold-all';
      unfoldAll.title = 'Unfold all';
      unfoldAll.setAttribute('aria-label', 'Unfold all outline headings');
      unfoldAll.innerHTML = UNFOLD_ALL_SVG;
      unfoldAll.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setAllFolded(false);
      });
      header.appendChild(unfoldAll);

      const posBtn = document.createElement('button');
      posBtn.type = 'button';
      posBtn.className = 'outline-position-toggle';
      header.appendChild(posBtn);
      positionToggleEl = posBtn;
      posBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        togglePosition();
      });
      updatePositionToggle();

      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'outline-pin';
      header.appendChild(pin);
      pinButtonEl = pin;
      pin.addEventListener('click', (ev) => {
        ev.stopPropagation();
        togglePin();
      });
      updatePinState();
    }

    // The close (×) button only lives on the Outline header for legacy reasons —
    // it dismisses the whole sidebar, not the section. Keeps the affordance
    // exactly where users learned it in 2.0.
    if (withClose) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'outline-close';
      close.setAttribute('aria-label', 'Close sidebar');
      close.title = 'Hide sidebar';
      close.textContent = '×';
      header.appendChild(close);
      close.addEventListener('click', (ev) => {
        ev.stopPropagation();
        showByUser(false);
      });
    }

    const toggle = (): void => toggleSectionCollapsed(section);
    header.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement;
      if (target.closest('.outline-close') || target.closest('.outline-pin') || target.closest('.outline-position-toggle')) {return;}
      toggle();
    });
    header.addEventListener('keydown', (ev) => {
      // Enter/Space on a header button activates that button, not the section.
      if ((ev.target as HTMLElement).closest('button')) {return;}
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        toggle();
      }
    });
    return header;
  }

  function toggleSectionCollapsed(section: string): void {
    if (collapsedSections.has(section)) {collapsedSections.delete(section);}
    else {collapsedSections.add(section);}
    // Once the user explicitly toggles a section, the auto-collapse-when-empty
    // rule stops applying to that section. Other sections are unaffected.
    userTouchedSections.add(section);
    applySectionCollapsedDom();
    prefsRef?.sectionCollapsed(section, collapsedSections.has(section));
  }

  function applySectionCollapsedDom(): void {
    if (!sidebarEl) {return;}
    sidebarEl.querySelectorAll<HTMLElement>('.sidebar-section').forEach((el) => {
      const name = el.dataset.section || '';
      el.classList.toggle('collapsed', collapsedSections.has(name));
      el.querySelector('.sidebar-section-header')?.setAttribute(
        'aria-expanded', collapsedSections.has(name) ? 'false' : 'true'
      );
    });
  }

  // ── External hooks (called from editor-main's message handler) ─────────────

  function applyOutlineState(state: {
    pref?: OutlineVisibilityPref;
    width?: number;
    position?: OutlinePosition;
    sectionPrefs?: Record<string, boolean>;
  }): void {
    if (typeof state.width === 'number') {setWidth(state.width);}
    if (state.position === 'left' || state.position === 'right') {setPosition(state.position);}
    if (state.pref === 'always' || state.pref === 'never') {pref = state.pref;}
    if (state.sectionPrefs && typeof state.sectionPrefs === 'object') {
      // Only mutate sections the user has explicitly toggled. Sections absent
      // from the map are still "auto-driven" — leaving their current collapsed
      // state alone is critical because applyProperties/applyBacklinks may have
      // already run (the `update` message lands before `sidebarState`) and set
      // collapsedSections via autoCollapseIfEmpty. Wiping unconditionally would
      // un-collapse those even though they have no content.
      userTouchedSections.clear();
      for (const [section, collapsed] of Object.entries(state.sectionPrefs)) {
        userTouchedSections.add(section);
        if (collapsed) {collapsedSections.add(section);}
        else {collapsedSections.delete(section);}
      }
      applySectionCollapsedDom();
    }
    applyVisibilityFromPref();
    updatePinState();
    updatePositionToggle();
  }

  /**
   * Apply the "collapse when empty" default for a section, but only if the user
   * hasn't explicitly toggled THIS section on this document. Each section's auto
   * rule lives or dies independently — collapsing Outline doesn't silence the
   * rule for Backlinks/Properties.
   */
  function autoCollapseIfEmpty(section: string, isEmpty: boolean): void {
    if (userTouchedSections.has(section)) {return;}
    const wasCollapsed = collapsedSections.has(section);
    const shouldCollapse = isEmpty;
    if (wasCollapsed !== shouldCollapse) {
      if (shouldCollapse) {collapsedSections.add(section);}
      else {collapsedSections.delete(section);}
      applySectionCollapsedDom();
    }
  }

  // ── Pin toggle ─────────────────────────────────────────────────────────────

  function togglePin(): void {
    // Pin writes to the global default so new documents inherit the state.
    // Other already-open panels aren't auto-updated — use "Apply to open
    // documents" in Settings to push to all open instances.
    const next: OutlineVisibilityPref = pref === 'always' ? 'never' : 'always';
    pref = next;
    updatePinState();
    setVisible(next === 'always');
    prefsRef?.setPref(next);
  }

  function updatePinState(): void {
    if (!pinButtonEl) {return;}
    const pinned = pref === 'always';
    pinButtonEl.classList.toggle('pinned', pinned);
    pinButtonEl.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    pinButtonEl.innerHTML = pinned ? PIN_SVG_ON : PIN_SVG_OFF;
    pinButtonEl.title = pinned
      ? 'Pinned open — click to unpin (also updates the default for new documents)'
      : 'Click to pin sidebar open (also updates the default for new documents)';
    pinButtonEl.setAttribute('aria-label', pinButtonEl.title);
  }

  // ── Position toggle ────────────────────────────────────────────────────────

  function togglePosition(): void {
    // Per-instance only — same rationale as togglePin.
    const next: OutlinePosition = position === 'right' ? 'left' : 'right';
    setPosition(next);
    updatePositionToggle();
  }

  function updatePositionToggle(): void {
    if (!positionToggleEl) {return;}
    // The arrow points to the *other* side — i.e. where clicking will move the sidebar.
    const movingTo: OutlinePosition = position === 'right' ? 'left' : 'right';
    positionToggleEl.innerHTML = movingTo === 'left' ? SIDEBAR_ARROW_LEFT : SIDEBAR_ARROW_RIGHT;
    positionToggleEl.title = `Move sidebar to ${movingTo}`;
    positionToggleEl.setAttribute('aria-label', positionToggleEl.title);
  }

  function applyBacklinks(items: BacklinkItem[]): void {
    backlinksReceived = true;
    if (backlinksSectionEl) {backlinksSectionEl.hidden = false;}
    currentBacklinks = items || [];
    autoCollapseIfEmpty('backlinks', currentBacklinks.length === 0);
    renderBacklinks();
  }

  function applyTags(items: TagItem[]): void {
    currentTags = Array.isArray(items) ? items.filter(t => t && typeof t.tag === 'string') : [];
    autoCollapseIfEmpty('tags', currentTags.length === 0);
    renderTags();
  }

  /** Show/hide the Tags section (`mikedown.tags.enabled`). */
  function setTagsSectionEnabled(enabled: boolean): void {
    tagsSectionEnabled = enabled;
    if (tagsSectionEl) {tagsSectionEl.hidden = !enabled;}
  }

  function applyProperties(
    entries: FrontmatterEntry[],
    opts?: { editable?: boolean }
  ): void {
    currentProperties = entries || [];
    propertiesEditable = opts?.editable !== false && propertiesChangeCb !== null;
    // Auto-collapse purely on actual property count. The editable "+ Add property"
    // affordance doesn't count as content — when the doc has no frontmatter,
    // collapse the section so the user can expand it on demand if they want to
    // add one. Once the user manually toggles this section, autoCollapseIfEmpty
    // bails for it (per-section opt-out).
    autoCollapseIfEmpty('properties', currentProperties.length === 0);
    renderProperties();
  }

  /**
   * M6: called right after the `/properties` slash command inserts an empty
   * frontmatter block. Surfaces the section the same way a user reaching for
   * it manually would — shows the sidebar, un-collapses Properties (bypassing
   * the auto-collapse-when-empty rule, same as an explicit user toggle), and
   * focuses the "+ Add property" trigger so the next keystroke can start
   * naming the first key.
   */
  function focusPropertiesSection(): void {
    showByUser(true);
    collapsedSections.delete('properties');
    userTouchedSections.add('properties');
    applySectionCollapsedDom();
    const trigger = propertiesListEl?.querySelector<HTMLButtonElement>('.properties-add-trigger');
    (trigger ?? propertiesSectionEl?.querySelector<HTMLElement>('.sidebar-section-header'))?.focus();
  }

  function applyDocMeta(meta: { mtimeMs?: number | null }): void {
    if (typeof meta.mtimeMs === 'number') {docMtimeMs = meta.mtimeMs;}
    else if (meta.mtimeMs === null) {docMtimeMs = null;}
    renderFooter();
  }

  function applyPlainText(plainText: string): void {
    docPlainText = plainText || '';
    renderFooter();
  }

  // ── Visibility ─────────────────────────────────────────────────────────────

  // Toggle path shared by the header discovery/close buttons and the
  // `mikedown.toggleSidebar` command (Ctrl+\ / Cmd+\) — routes through the same
  // setVisible so both entry points keep identical state.
  function toggleSidebarVisible(): void {
    if (!sidebarEl) {return;}
    showByUser(sidebarEl.hidden);
  }

  /**
   * The element that carries the sidebar's layout classes and width variable:
   * the editor's .mikedown-root (never <body>, so two editors stay independent).
   */
  function stateRoot(): HTMLElement | null {
    if (!sidebarEl) {return null;}
    return sidebarEl.closest<HTMLElement>('.mikedown-root') ?? sidebarEl.parentElement;
  }

  /** The session intent (pin pref, or a show/hide while wide). */
  function setVisible(visible: boolean): void {
    // Visibility is session-only when manually toggled; the pin pref is what
    // persists. Nothing posted back to the host on a manual show/hide.
    wantVisible = visible;
    if (!visible) {overlayOpen = false;}
    applyVisibility();
  }

  /** A user show/hide: while narrow it only opens or closes the overlay. */
  function showByUser(visible: boolean): void {
    if (!narrow) {setVisible(visible); return;}
    overlayOpen = visible;
    applyVisibility();
  }

  function applyVisibility(): void {
    if (!sidebarEl || !toggleEl) {return;}
    const shown = narrow ? overlayOpen : wantVisible;
    sidebarEl.hidden = !shown;
    const root = stateRoot();
    root?.classList.toggle('mikedown-outline-open', shown && !narrow);
    root?.classList.toggle('mikedown-outline-overlay', shown && narrow);
    root?.classList.toggle('mikedown-outline-narrow', narrow);
    toggleEl.setAttribute('aria-expanded', shown ? 'true' : 'false');
    if (shown) {
      rebuildHeadings();
      updateActiveFromCursor();
      renderFooter();
    }
  }

  /** Dock or step aside as the editor's width changes. */
  function watchWidth(): void {
    const root = stateRoot();
    if (!root || typeof ResizeObserver === 'undefined') {return;}
    resizeObserver = new ResizeObserver((entries) => {
      rootWidth = entries[entries.length - 1]?.contentRect.width ?? 0;
      updateNarrow();
    });
    resizeObserver.observe(root);
    // A click in the text dismisses the overlay.
    scrollContainerEl?.addEventListener('pointerdown', () => {
      if (narrow && overlayOpen) {showByUser(false);}
    });
  }

  function updateNarrow(): void {
    const next = rootWidth > 0 && rootWidth - width < MIN_TEXT_COLUMN_PX;
    if (next === narrow) {return;}
    narrow = next;
    overlayOpen = false;
    applyVisibility();
  }

  function applyVisibilityFromPref(): void {
    setVisible(pref === 'always');
  }

  // ── Width / resize ─────────────────────────────────────────────────────────

  function setWidth(px: number): void {
    width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(px)));
    stateRoot()?.style.setProperty('--mikedown-outline-width', `${width}px`);
    updateNarrow();
  }

  function setPosition(next: OutlinePosition): void {
    position = next;
    stateRoot()?.classList.toggle('mikedown-outline-left', position === 'left');
    stateRoot()?.classList.toggle('mikedown-outline-right', position === 'right');
    if (toggleEl) {
      toggleEl.innerHTML = position === 'left' ? SIDEBAR_ICON_LEFT : SIDEBAR_ICON_RIGHT;
    }
  }

  function wireResize(handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      sidebarEl?.classList.add('resizing');
      stateRoot()?.classList.add('mikedown-outline-resizing');
      const startX = e.clientX;
      const startWidth = width;

      const onMove = (ev: PointerEvent): void => {
        const delta = ev.clientX - startX;
        // On a right-anchored sidebar the handle lives on its left edge, so
        // dragging right (positive delta) shrinks the sidebar instead of growing it.
        const want = position === 'right' ? startWidth - delta : startWidth + delta;
        // Docked, a drag stops where the text column would get too narrow
        // (rather than tipping the sidebar into hiding mid-drag).
        setWidth(!narrow && rootWidth > 0 ? Math.min(want, rootWidth - MIN_TEXT_COLUMN_PX) : want);
      };
      const onUp = (ev: PointerEvent): void => {
        // Width is per-instance session state — the global default lives in
        // Settings → Appearance and only seeds newly-opened documents.
        handle.releasePointerCapture(ev.pointerId);
        sidebarEl?.classList.remove('resizing');
        stateRoot()?.classList.remove('mikedown-outline-resizing');
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    });
  }

  // ── Heading collection + rendering ─────────────────────────────────────────

  function collectHeadings(): Heading[] {
    const headings: Heading[] = [];
    if (!editorRef) {return headings;}
    const seen = new Map<string, number>();
    editorRef.state.doc.forEach((node: any, offset: number) => {
      if (node.type.name !== 'heading') {return;}
      const text = (node.textContent as string).trim();
      if (!text) {return;}
      const base = anchorFnRef(text);
      const count = seen.get(base) ?? 0;
      const anchor = count === 0 ? base : `${base}-${count}`;
      seen.set(base, count + 1);
      headings.push({
        level: node.attrs?.level ?? 1,
        text,
        anchor,
        pos: offset,
      });
    });
    return headings;
  }

  function rebuildHeadings(): void {
    if (!outlineListEl || sidebarEl?.hidden) {return;}
    const headings = collectHeadings();
    const key = headings.map(h => `${h.level}|${h.anchor}|${h.text}`).join('\n');
    if (key === lastHeadingsKey) {
      updateActiveFromCursor();
      return;
    }
    lastHeadingsKey = key;

    outlineListEl.replaceChildren();
    if (headings.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'outline-empty';
      empty.textContent = 'No headings yet';
      outlineListEl.appendChild(empty);
      return;
    }
    const foldable = hasDescendants(headings.map(h => h.level));
    const keep = new Set(headings.filter((_, i) => foldable[i]).map(h => h.anchor));
    for (const anchor of [...foldedAnchors]) {
      if (!keep.has(anchor)) {foldedAnchors.delete(anchor);}
    }
    headings.forEach((h, i) => {
      const level = Math.max(1, Math.min(6, h.level));
      const row = document.createElement('div');
      row.className = `outline-row level-${level}`;
      row.dataset.anchor = h.anchor;
      row.dataset.level = String(h.level);
      if (foldable[i]) {
        const fold = document.createElement('button');
        fold.type = 'button';
        fold.className = 'outline-fold';
        fold.innerHTML = '<span class="outline-fold-icon" aria-hidden="true">▾</span>';
        fold.addEventListener('click', () => toggleFold(h.anchor));
        row.appendChild(fold);
      }
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `outline-item level-${level}`;
      item.dataset.anchor = h.anchor;
      item.title = h.text;
      item.textContent = h.text;
      item.addEventListener('click', () => scrollEditorToAnchor(h.anchor));
      row.appendChild(item);
      outlineListEl!.appendChild(row);
    });
    applyFolds();
    updateActiveFromCursor();
  }

  // ── Folding ────────────────────────────────────────────────────────────────

  function outlineRows(): HTMLElement[] {
    return outlineListEl ? [...outlineListEl.querySelectorAll<HTMLElement>('.outline-row')] : [];
  }

  function toggleFold(anchor: string): void {
    if (foldedAnchors.has(anchor)) {foldedAnchors.delete(anchor);}
    else {foldedAnchors.add(anchor);}
    applyFolds();
    highlightActive();
  }

  function setAllFolded(fold: boolean): void {
    foldedAnchors.clear();
    if (fold) {
      outlineRows().forEach((row) => {
        if (row.querySelector('.outline-fold')) {foldedAnchors.add(row.dataset.anchor || '');}
      });
    }
    applyFolds();
    highlightActive();
  }

  function applyFolds(): void {
    const rows = outlineRows();
    const folded = rows.map(row => foldedAnchors.has(row.dataset.anchor || ''));
    const hidden = hiddenByFolds(rows.map(row => Number(row.dataset.level)), folded);
    rows.forEach((row, i) => {
      row.hidden = hidden[i];
      row.classList.toggle('folded', folded[i]);
      const fold = row.querySelector<HTMLButtonElement>('.outline-fold');
      if (!fold) {return;}
      const text = row.querySelector('.outline-item')?.textContent || '';
      fold.setAttribute('aria-expanded', folded[i] ? 'false' : 'true');
      fold.setAttribute('aria-label', `${folded[i] ? 'Unfold' : 'Fold'} ${text}`);
      fold.title = folded[i] ? 'Unfold' : 'Fold';
    });
  }

  // ── Active-item tracking ───────────────────────────────────────────────────

  function updateActiveFromCursor(): void {
    if (!editorRef || !outlineListEl || sidebarEl?.hidden) {return;}
    const from = editorRef.state.selection.from;
    let currentAnchor = '';
    const seen = new Map<string, number>();
    editorRef.state.doc.forEach((node: any, offset: number) => {
      if (node.type.name !== 'heading') {return;}
      const text = (node.textContent as string).trim();
      if (!text) {return;}
      const base = anchorFnRef(text);
      const count = seen.get(base) ?? 0;
      const anchor = count === 0 ? base : `${base}-${count}`;
      seen.set(base, count + 1);
      if (offset <= from) {currentAnchor = anchor;}
    });
    if (currentAnchor === activeAnchor) {return;}
    activeAnchor = currentAnchor;
    highlightActive();
  }

  function highlightActive(): void {
    if (!outlineListEl) {return;}
    // A heading inside a folded section lights up its nearest visible ancestor.
    const rows = outlineRows();
    const index = nearestVisibleIndex(
      rows.map(row => row.hidden),
      rows.findIndex(row => row.dataset.anchor === activeAnchor),
    );
    let activeEl: HTMLElement | null = null;
    rows.forEach((row, i) => {
      const el = row.querySelector<HTMLElement>('.outline-item');
      el?.classList.toggle('active', i === index);
      if (i === index) {activeEl = row;} // the row, so offsetTop isn't relative to it
    });
    if (activeEl) {scrollActiveIntoView(activeEl);}
  }

  function scrollActiveIntoView(el: HTMLElement): void {
    if (!outlineListEl) {return;}
    const itemTop = el.offsetTop;
    const itemBottom = itemTop + el.offsetHeight;
    const viewTop = outlineListEl.scrollTop;
    const viewBottom = viewTop + outlineListEl.clientHeight;
    if (itemTop < viewTop) {
      outlineListEl.scrollTo({ top: itemTop - 4, behavior: 'smooth' });
    } else if (itemBottom > viewBottom) {
      outlineListEl.scrollTo({ top: itemBottom - outlineListEl.clientHeight + 4, behavior: 'smooth' });
    }
  }

  // ── Scroll spy ─────────────────────────────────────────────────────────────

  function wireScrollSpy(): void {
    const editorContainer = scrollContainerEl;
    if (!editorContainer) {return;}
    let scrollTimer: number | undefined;
    editorContainer.addEventListener('scroll', () => {
      if (sidebarEl?.hidden) {return;}
      clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(updateActiveFromScroll, 80) as unknown as number;
    });
  }

  function updateActiveFromScroll(): void {
    if (!outlineListEl || sidebarEl?.hidden) {return;}
    const editorContainer = scrollContainerEl;
    if (!editorContainer) {return;}
    const headings = editorContainer.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6');
    if (headings.length === 0) {return;}
    const top = editorContainer.getBoundingClientRect().top + 60;
    const seen = new Map<string, number>();
    let currentAnchor = '';
    for (const h of headings) {
      const base = anchorFnRef(h.textContent || '');
      const count = seen.get(base) ?? 0;
      const anchor = count === 0 ? base : `${base}-${count}`;
      seen.set(base, count + 1);
      if (h.getBoundingClientRect().top <= top) {
        currentAnchor = anchor;
      } else {
        break;
      }
    }
    if (!currentAnchor) {
      const first = headings[0];
      currentAnchor = anchorFnRef(first.textContent || '');
    }
    if (currentAnchor === activeAnchor) {return;}
    activeAnchor = currentAnchor;
    highlightActive();
  }

  function scrollEditorToAnchor(anchor: string): void {
    const editorContainer = scrollContainerEl;
    if (!editorContainer) {return;}
    const headings = editorContainer.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6');
    const seen = new Map<string, number>();
    for (const h of headings) {
      const base = anchorFnRef(h.textContent || '');
      const count = seen.get(base) ?? 0;
      const id = count === 0 ? base : `${base}-${count}`;
      seen.set(base, count + 1);
      if (id === anchor) {
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
  }

  // ── Backlinks rendering ────────────────────────────────────────────────────

  function renderBacklinks(): void {
    if (!backlinksListEl || !backlinksCountEl) {return;}

    // Group occurrences by source document, preserving first-seen order.
    const groups = new Map<string, BacklinkItem[]>();
    for (const item of currentBacklinks) {
      const arr = groups.get(item.uri);
      if (arr) {arr.push(item);}
      else {groups.set(item.uri, [item]);}
    }

    // Badge shows the number of distinct source docs (one per top-level row).
    const docCount = groups.size;
    if (docCount > 0) {
      backlinksCountEl.hidden = false;
      backlinksCountEl.textContent = ` (${docCount})`;
    } else {
      backlinksCountEl.hidden = true;
      backlinksCountEl.textContent = '';
    }

    // Avoid rebuilding identical content (rapid resaves elsewhere in workspace).
    const key = currentBacklinks
      .map(b => `${b.uri}|${b.line}|${b.displayPath}|${b.lineText ?? ''}`)
      .join('\n');
    if (key === lastBacklinksKey) {return;}
    lastBacklinksKey = key;

    backlinksListEl.replaceChildren();
    if (docCount === 0) {
      renderBacklinksEmpty();
      return;
    }

    for (const [uri, items] of groups) {
      if (items.length === 1) {
        backlinksListEl.appendChild(buildBacklinkRow(items[0]));
      } else {
        backlinksListEl.appendChild(buildBacklinkGroup(uri, items));
      }
    }
  }

  /**
   * Open a backlink's source. A backlinks panel is a reference tool, so we open
   * the source beside the current doc ('openNewTab' → ViewColumn.Beside) — you
   * keep your place.
   */
  function attachBacklinkOpenHandlers(el: HTMLElement, item: BacklinkItem): void {
    el.addEventListener('click', () => {
      openBacklinkCb?.(item);
    });
  }

  /** A single backlink occurrence: navigates to the source on click. */
  function buildBacklinkRow(item: BacklinkItem): HTMLElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'backlinks-item';
    row.title = item.lineText
      ? `${item.displayPath} (line ${item.line})\n${item.lineText}`
      : `${item.displayPath} (line ${item.line})`;
    row.textContent = item.displayPath;
    attachBacklinkOpenHandlers(row, item);
    return row;
  }

  /** A source doc with >1 backlink: a collapsible header + per-link children. */
  function buildBacklinkGroup(uri: string, items: BacklinkItem[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'backlinks-group';

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'backlinks-group-header';

    const chevron = document.createElement('span');
    chevron.className = 'backlinks-group-chevron';
    chevron.textContent = '▸';

    const path = document.createElement('span');
    path.className = 'backlinks-group-path';
    path.textContent = items[0].displayPath;

    const count = document.createElement('span');
    count.className = 'backlinks-group-count';
    count.textContent = `(${items.length})`;

    header.append(chevron, path, count);
    header.title = `${items[0].displayPath} — ${items.length} links`;

    const children = document.createElement('div');
    children.className = 'backlinks-group-children';

    for (const item of items) {
      const child = document.createElement('button');
      child.type = 'button';
      child.className = 'backlinks-child';
      const text = item.lineText ? `L${item.line}: ${item.lineText}` : `Line ${item.line}`;
      child.textContent = text;
      child.title = item.lineText
        ? `${item.displayPath} (line ${item.line})\n${item.lineText}`
        : `${item.displayPath} (line ${item.line})`;
      attachBacklinkOpenHandlers(child, item);
      children.appendChild(child);
    }

    const setExpanded = (expanded: boolean) => {
      wrap.classList.toggle('expanded', expanded);
      chevron.textContent = expanded ? '▾' : '▸';
      children.hidden = !expanded;
    };
    setExpanded(expandedBacklinkGroups.has(uri));

    header.addEventListener('click', () => {
      const next = !expandedBacklinkGroups.has(uri);
      if (next) {expandedBacklinkGroups.add(uri);}
      else {expandedBacklinkGroups.delete(uri);}
      setExpanded(next);
    });

    wrap.append(header, children);
    return wrap;
  }

  // ── Tags rendering ─────────────────────────────────────────────────────────

  function renderTags(): void {
    if (!tagsListEl || !tagsCountEl) {return;}
    const sorted = [...currentTags].sort((a, b) => a.tag.localeCompare(b.tag));
    const key = sorted.map(t => `${t.tag}|${t.count}`).join('\n');
    if (key === lastTagsKey) {return;}
    lastTagsKey = key;

    tagsCountEl.hidden = sorted.length === 0;
    tagsCountEl.textContent = sorted.length ? ` (${sorted.length})` : '';

    tagsListEl.replaceChildren();
    if (sorted.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tags-empty';
      empty.textContent = 'No tags.';
      tagsListEl.appendChild(empty);
      return;
    }
    for (const t of sorted) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'tags-item';
      row.dataset.tag = t.tag;
      row.title = `Find documents tagged #${t.tag} (${t.count} document${t.count === 1 ? '' : 's'})`;
      const name = document.createElement('span');
      name.className = 'tags-item-name';
      name.textContent = `#${t.tag}`;
      const count = document.createElement('span');
      count.className = 'tags-item-count';
      count.textContent = String(t.count);
      row.append(name, count);
      row.addEventListener('click', () => {
        openTagCb?.(t.tag);
      });
      tagsListEl.appendChild(row);
    }
  }

  function renderBacklinksEmpty(): void {
    if (!backlinksListEl) {return;}
    backlinksListEl.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'backlinks-empty';
    empty.textContent = 'No backlinks.';
    backlinksListEl.appendChild(empty);
  }

  // ── Properties suggestions (AI) ────────────────────────────────────────────

  function applySuggestAvailability(a: SuggestPropertiesAvailability): void {
    suggestAvailability = a;
    renderSuggestButton();
  }

  function renderSuggestButton(): void {
    const btn = suggestBtnEl;
    if (!btn) {return;}
    const a = suggestAvailability;
    btn.hidden = a.state === 'hidden';
    // aria-disabled, not disabled: the reason tooltip must still show on hover.
    btn.setAttribute('aria-disabled', a.state === 'enabled' ? 'false' : 'true');
    btn.classList.toggle('disabled', a.state === 'disabled');
    btn.title = a.state === 'disabled' ? a.reason : 'Suggest properties with AI';
  }

  /** Show the sidebar with Properties expanded, so a run started elsewhere is visible. */
  function revealProperties(): void {
    if (sidebarEl?.hidden) {showByUser(true);}
    if (collapsedSections.has('properties')) {
      collapsedSections.delete('properties');
      applySectionCollapsedDom();
    }
    userTouchedSections.add('properties');
  }

  function applyPropertySuggestions(s: PropertySuggestions | null, state: PropertySuggestionsState, message?: string): void {
    suggestState = state;
    suggestMessage = message ?? '';
    suggestions = state === 'idle' && s ? { ...s, tags: [...s.tags] } : null;
    if (state !== 'idle' || s) {revealProperties();}
    renderSuggestions();
  }

  function suggestionCount(s: PropertySuggestions): number {
    return (s.title ? 1 : 0) + (s.description ? 1 : 0) + s.tags.length;
  }

  function textButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'properties-suggest-action';
    b.textContent = label;
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onClick();
    });
    return b;
  }

  function closeSuggestions(): void {
    suggestState = 'idle';
    suggestions = null;
    renderSuggestions();
  }

  function renderSuggestions(): void {
    const row = suggestRowEl;
    if (!row) {return;}
    row.replaceChildren();
    row.dataset.state = suggestState;
    row.hidden = suggestState === 'idle' && !suggestions;
    if (row.hidden) {return;}

    if (suggestState === 'running') {
      const bar = document.createElement('div');
      bar.className = 'properties-suggest-progress';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', 'Suggesting properties');
      const status = document.createElement('div');
      status.className = 'properties-suggest-status';
      status.setAttribute('role', 'status');
      const text = document.createElement('span');
      text.className = 'properties-suggest-message';
      text.textContent = suggestMessage || 'Suggesting…';
      text.title = text.textContent;
      status.append(text, textButton('Cancel', () => {
        closeSuggestions();
        cancelSuggestionsCb?.();
      }));
      row.append(bar, status);
      return;
    }

    if (suggestState === 'error') {
      const msg = document.createElement('div');
      msg.className = 'properties-suggest-error';
      msg.setAttribute('role', 'alert');
      msg.textContent = suggestMessage || 'The suggestions could not be made.';
      const actions = document.createElement('div');
      actions.className = 'properties-suggest-actions';
      actions.append(textButton('Try again', () => suggestCb?.()), textButton('Dismiss', closeSuggestions));
      row.append(msg, actions);
      return;
    }

    const s = suggestions!;
    if (suggestionCount(s) === 0) {
      const none = document.createElement('div');
      none.className = 'properties-suggest-status';
      none.setAttribute('role', 'status');
      const text = document.createElement('span');
      text.className = 'properties-suggest-message';
      text.textContent = 'No new suggestions.';
      none.append(text, textButton('Dismiss', closeSuggestions));
      row.appendChild(none);
      return;
    }

    const chips = document.createElement('div');
    chips.className = 'properties-suggest-chips';
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Suggested properties');
    if (s.title) {chips.appendChild(buildSuggestionChip({ kind: 'title', value: s.title }));}
    if (s.description) {chips.appendChild(buildSuggestionChip({ kind: 'description', value: s.description }));}
    for (const t of s.tags) {chips.appendChild(buildSuggestionChip({ kind: 'tag', tag: t.tag }, !t.known));}
    const actions = document.createElement('div');
    actions.className = 'properties-suggest-actions';
    actions.appendChild(textButton('Dismiss all', closeSuggestions));
    row.append(chips);
    // The answer was cut off: say so next to what did arrive.
    if (suggestMessage) {
      const note = document.createElement('div');
      note.className = 'properties-suggest-note';
      note.setAttribute('role', 'status');
      note.textContent = suggestMessage;
      row.appendChild(note);
    }
    row.appendChild(actions);
  }

  /** Remove `pick` from the shown suggestions; the row closes when none are left. */
  function dropSuggestion(pick: PropertySuggestionPick): void {
    const s = suggestions;
    if (!s) {return;}
    if (pick.kind === 'title') {delete s.title;}
    else if (pick.kind === 'description') {delete s.description;}
    else {s.tags = s.tags.filter((t) => t.tag !== pick.tag);}
    if (suggestionCount(s) === 0) {suggestions = null;}
  }

  /** After a chip goes: focus the chip now at `index` (or the last one), else the editor. */
  function focusChipAt(index: number): void {
    const buttons = suggestRowEl?.querySelectorAll<HTMLButtonElement>('.properties-suggest-apply') ?? [];
    const next = buttons[Math.min(index, buttons.length - 1)];
    if (next) {next.focus();}
    else {editorRef?.view?.focus?.();}
  }

  function chipIndex(chip: HTMLElement): number {
    return [...(suggestRowEl?.querySelectorAll('.properties-suggest-chip') ?? [])].indexOf(chip);
  }

  function buildSuggestionChip(pick: PropertySuggestionPick, isNew = false): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'properties-pill properties-suggest-chip';
    chip.dataset.kind = pick.kind;

    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'properties-suggest-apply';
    const label = document.createElement('span');
    label.className = 'properties-pill-text';
    if (pick.kind === 'tag') {
      chip.classList.add('tag');
      label.textContent = pick.tag;
      apply.append(label);
      if (isNew) {
        const mark = document.createElement('span');
        mark.className = 'properties-suggest-new';
        mark.textContent = 'new';
        apply.append(mark);
      }
      apply.title = `Add #${pick.tag} to tags${isNew ? ' (a new tag in this workspace)' : ''}`;
      apply.setAttribute('aria-label', `Add tag ${pick.tag}${isNew ? ', new' : ''}`);
    } else {
      const key = document.createElement('span');
      key.className = 'properties-suggest-key';
      key.textContent = pick.kind;
      label.textContent = pick.value;
      apply.append(key, label);
      apply.title = `Set ${pick.kind}: ${pick.value}`;
      apply.setAttribute('aria-label', `Set ${pick.kind} to ${pick.value}`);
    }
    apply.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const at = chipIndex(chip);
      if (!applySuggestionCb?.(pick)) {return;}
      dropSuggestion(pick);
      renderSuggestions();
      focusChipAt(at);
    });

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'properties-pill-x';
    x.textContent = '×';
    x.title = 'Dismiss';
    x.setAttribute('aria-label', pick.kind === 'tag' ? `Dismiss tag ${pick.tag}` : `Dismiss ${pick.kind}`);
    x.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const at = chipIndex(chip);
      dropSuggestion(pick);
      renderSuggestions();
      focusChipAt(at);
    });

    chip.append(apply, x);
    return chip;
  }

  // ── Properties rendering ───────────────────────────────────────────────────

  function renderProperties(): void {
    if (!propertiesListEl || !propertiesSectionEl) {return;}
    propertiesListEl.replaceChildren();
    propertiesSectionEl.hidden = false;
    propertiesListEl.classList.toggle('editable', propertiesEditable);

    if (currentProperties.length === 0 && !propertiesEditable) {
      const empty = document.createElement('div');
      empty.className = 'properties-empty';
      empty.textContent = 'No properties.';
      propertiesListEl.appendChild(empty);
      return;
    }

    for (let i = 0; i < currentProperties.length; i++) {
      propertiesListEl.appendChild(buildPropertyRow(currentProperties[i], i));
    }

    if (propertiesEditable) {
      propertiesListEl.appendChild(buildAddPropertyRow());
    }
  }

  function buildPropertyRow(entry: FrontmatterEntry, index: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'properties-row';
    row.dataset.idx = String(index);

    const key = document.createElement('span');
    key.className = 'properties-key';
    key.textContent = entry.key;
    key.title = entry.key;
    if (propertiesEditable) {
      key.classList.add('editable');
      key.addEventListener('click', (ev) => {
        ev.stopPropagation();
        beginEditKey(row, index);
      });
    }
    row.appendChild(key);

    // Tag keys (`tags` / `tag`) get clickable pills in read-only mode — clicking
    // finds documents sharing that tag. In edit mode the pill stays editable.
    const keyLower = entry.key.trim().toLowerCase();
    const isTag = (keyLower === 'tags' || keyLower === 'tag') && !propertiesEditable;

    const value = document.createElement('span');
    value.className = 'properties-value';
    if (Array.isArray(entry.value)) {
      value.classList.add('array');
      for (let pi = 0; pi < entry.value.length; pi++) {
        value.appendChild(buildPill(entry.value[pi], index, pi, isTag));
      }
      if (propertiesEditable) {
        value.appendChild(buildAddPillButton(index));
      }
    } else {
      if (entry.value) {
        value.textContent = entry.value;
        value.title = entry.value;
      } else if (propertiesEditable) {
        value.textContent = '—';
        value.classList.add('empty');
      }
      if (propertiesEditable) {
        value.classList.add('editable');
        value.addEventListener('click', (ev) => {
          ev.stopPropagation();
          beginEditValue(row, index);
        });
      }
    }
    row.appendChild(value);

    if (propertiesEditable) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'properties-delete';
      del.title = `Delete "${entry.key}"`;
      del.setAttribute('aria-label', del.title);
      del.textContent = '×';
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const next = currentProperties.filter((_, i) => i !== index);
        commitProperties(next);
      });
      row.appendChild(del);
    }

    return row;
  }

  function buildPill(text: string, rowIdx: number, pillIdx: number, isTag = false): HTMLElement {
    const pill = document.createElement('span');
    pill.className = 'properties-pill';
    pill.dataset.pillIdx = String(pillIdx);

    const label = document.createElement('span');
    label.className = 'properties-pill-text';
    label.textContent = text;
    label.title = text;
    pill.appendChild(label);

    if (isTag) {
      const tag = text.replace(/^#/, '');
      label.textContent = tag; // the `#` is supplied by CSS ::before
      label.title = `#${tag}`;
      pill.classList.add('tag');
      pill.title = `Find documents tagged #${tag}`;
      pill.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openTagCb?.(tag);
      });
      return pill;
    }

    if (propertiesEditable) {
      pill.classList.add('editable');
      label.addEventListener('click', (ev) => {
        ev.stopPropagation();
        beginEditPill(pill, rowIdx, pillIdx);
      });

      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'properties-pill-x';
      x.textContent = '×';
      x.title = `Remove "${text}"`;
      x.setAttribute('aria-label', x.title);
      x.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const entry = currentProperties[rowIdx];
        if (!entry || !Array.isArray(entry.value)) {return;}
        const newArr = entry.value.filter((_, i) => i !== pillIdx);
        const next = currentProperties.map((e, i) =>
          i === rowIdx ? { ...e, value: newArr } : e
        );
        commitProperties(next);
      });
      pill.appendChild(x);
    }
    return pill;
  }

  function buildAddPillButton(rowIdx: number): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'properties-pill-add';
    btn.title = 'Add item';
    btn.setAttribute('aria-label', 'Add item');
    btn.textContent = '+';
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      beginAddPill(btn, rowIdx);
    });
    return btn;
  }

  function buildAddPropertyRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'properties-row properties-add-row';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'properties-add-trigger';
    trigger.textContent = '+ Add property';
    trigger.addEventListener('click', (ev) => {
      ev.stopPropagation();
      beginAddProperty(row);
    });
    row.appendChild(trigger);

    return row;
  }

  // ── Inline edit transitions ────────────────────────────────────────────────

  function beginEditValue(row: HTMLElement, index: number): void {
    const valueEl = row.querySelector('.properties-value');
    const entry = currentProperties[index];
    if (!valueEl || !entry || Array.isArray(entry.value)) {return;}

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'properties-input';
    input.value = entry.value;
    valueEl.classList.remove('empty');
    valueEl.replaceChildren(input);
    input.focus();
    input.select();

    wireCommitCancel(input, {
      commit: () => {
        const next = currentProperties.map((e, i) =>
          i === index ? { ...e, value: input.value } : e
        );
        commitProperties(next);
      },
      cancel: () => renderProperties(),
    });
  }

  function beginEditKey(row: HTMLElement, index: number): void {
    const keyEl = row.querySelector('.properties-key');
    const entry = currentProperties[index];
    if (!keyEl || !entry) {return;}

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'properties-input properties-input-key';
    input.value = entry.key;
    keyEl.replaceChildren(input);
    input.focus();
    input.select();

    wireCommitCancel(input, {
      commit: () => {
        const newKey = input.value.trim();
        if (!newKey || newKey === entry.key) {
          renderProperties();
          return;
        }
        const next = currentProperties.map((e, i) =>
          i === index ? { ...e, key: newKey } : e
        );
        commitProperties(next);
      },
      cancel: () => renderProperties(),
    });
  }

  function beginEditPill(pillEl: HTMLElement, rowIdx: number, pillIdx: number): void {
    const entry = currentProperties[rowIdx];
    if (!entry || !Array.isArray(entry.value)) {return;}

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'properties-input properties-input-pill';
    input.value = entry.value[pillIdx];
    pillEl.replaceChildren(input);
    // Size the input roughly to its content (chip width grows with text).
    input.style.width = `${Math.max(40, input.value.length * 7 + 16)}px`;
    input.focus();
    input.select();

    wireCommitCancel(input, {
      commit: () => {
        const trimmed = input.value.trim();
        const arr = Array.isArray(entry.value) ? entry.value.slice() : [];
        if (!trimmed) {
          arr.splice(pillIdx, 1);
        } else {
          arr[pillIdx] = trimmed;
        }
        const next = currentProperties.map((e, i) =>
          i === rowIdx ? { ...e, value: arr } : e
        );
        commitProperties(next);
      },
      cancel: () => renderProperties(),
    });
  }

  function beginAddPill(triggerEl: HTMLElement, rowIdx: number): void {
    const entry = currentProperties[rowIdx];
    if (!entry || !Array.isArray(entry.value)) {return;}

    const wrap = document.createElement('span');
    wrap.className = 'properties-pill editable';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'properties-input properties-input-pill';
    input.placeholder = 'value';
    input.style.width = '60px';
    wrap.appendChild(input);
    triggerEl.replaceWith(wrap);
    input.focus();

    wireCommitCancel(input, {
      commit: () => {
        const trimmed = input.value.trim();
        if (!trimmed) {
          renderProperties();
          return;
        }
        const arr = Array.isArray(entry.value) ? entry.value.slice() : [];
        arr.push(trimmed);
        const next = currentProperties.map((e, i) =>
          i === rowIdx ? { ...e, value: arr } : e
        );
        commitProperties(next);
      },
      cancel: () => renderProperties(),
    });
  }

  function beginAddProperty(rowEl: HTMLElement): void {
    rowEl.replaceChildren();
    rowEl.classList.add('editing');

    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.className = 'properties-input properties-input-key';
    keyInput.placeholder = 'key';
    rowEl.appendChild(keyInput);

    const sep = document.createElement('span');
    sep.className = 'properties-add-sep';
    sep.textContent = ':';
    rowEl.appendChild(sep);

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'properties-input';
    valueInput.placeholder = 'value';
    rowEl.appendChild(valueInput);

    keyInput.focus();

    const tryCommit = (): void => {
      const k = keyInput.value.trim();
      if (!k) {
        renderProperties();
        return;
      }
      if (currentProperties.some(e => e.key === k)) {
        // Duplicate key — just bail to existing entry; keep UX simple.
        renderProperties();
        return;
      }
      const next: FrontmatterEntry[] = [
        ...currentProperties,
        { key: k, value: valueInput.value },
      ];
      commitProperties(next);
    };

    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (document.activeElement === keyInput) {
          valueInput.focus();
        } else {
          tryCommit();
        }
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        renderProperties();
      }
    };
    keyInput.addEventListener('keydown', onKey);
    valueInput.addEventListener('keydown', onKey);

    // Commit on focus leaving the row entirely (clicking outside).
    const onFocusOut = (ev: FocusEvent): void => {
      const next = ev.relatedTarget as Node | null;
      if (next && rowEl.contains(next)) {return;}
      rowEl.removeEventListener('focusout', onFocusOut);
      tryCommit();
    };
    rowEl.addEventListener('focusout', onFocusOut);
  }

  function wireCommitCancel(
    input: HTMLInputElement,
    opts: { commit: () => void; cancel: () => void }
  ): void {
    let settled = false;
    const commit = (): void => {
      if (settled) {return;}
      settled = true;
      opts.commit();
    };
    const cancel = (): void => {
      if (settled) {return;}
      settled = true;
      opts.cancel();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', () => commit());
  }

  function commitProperties(next: FrontmatterEntry[]): void {
    if (!propertiesChangeCb) {return;}
    // Update local snapshot immediately so a re-render between now and the
    // host round-trip doesn't blink the old values.
    currentProperties = next;
    propertiesChangeCb(next);
  }

  // ── Footer rendering ───────────────────────────────────────────────────────

  function renderFooter(): void {
    if (!footerEl || !footerRowsEl) {return;}
    const wc = countWords(docPlainText);
    const cc = docPlainText.length;
    const rt = readingMinutes(wc);
    const modPart = docMtimeMs !== null
      ? `Modified ${formatRelativeTime(docMtimeMs)}`
      : 'Modified —';
    const wordsLabel = wc === 1 ? 'word' : 'words';
    const charsLabel = cc === 1 ? 'char' : 'chars';
    const metricsPart = `${wc.toLocaleString()} ${wordsLabel} · ${cc.toLocaleString()} ${charsLabel} · ${rt} min read`;

    // Keep keyboard focus on the support link / × across re-renders (the 60s
    // tick and every edit rebuild the rows).
    const focusedTestId = footerRowsEl.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).getAttribute('data-testid')
      : null;

    footerRowsEl.replaceChildren();
    const row1 = document.createElement('div');
    row1.className = 'sidebar-footer-row';
    row1.textContent = modPart;
    const row2 = document.createElement('div');
    row2.className = 'sidebar-footer-row';
    if (supportLinkVisible && supportLinkCopy) {
      row2.classList.add('sidebar-footer-row--with-support');
      row2.appendChild(buildMetricsWithSupport(metricsPart, supportLinkCopy));
    } else {
      row2.textContent = metricsPart;
    }
    footerRowsEl.appendChild(row1);
    footerRowsEl.appendChild(row2);

    if (focusedTestId) {
      footerRowsEl.querySelector<HTMLElement>(`[data-testid="${focusedTestId}"]`)?.focus({ preventScroll: true });
    }
  }

  /**
   * Metrics + "♥ Support MikeDown" link + × on one line. Each item draws its
   * own leading middle dot; the wrapper is shifted left by one separator width
   * and clipped by the row, so whichever item starts a line has its dot hidden.
   * If the sidebar is too narrow, the link group wraps to its own line as a
   * whole (it never breaks mid label) and the metrics ellipsize as before.
   */
  function buildMetricsWithSupport(metricsPart: string, copy: SupportLinkCopy): HTMLElement {
    const items = document.createElement('div');
    items.className = 'sidebar-footer-items';

    const metrics = document.createElement('span');
    metrics.className = 'sidebar-footer-item sidebar-footer-metrics';
    metrics.textContent = metricsPart;

    const group = document.createElement('span');
    group.className = 'sidebar-footer-item sidebar-support-group';

    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'sidebar-support-link';
    link.setAttribute('data-testid', 'sidebar-support-link');
    link.textContent = copy.sidebarLink;
    link.addEventListener('click', () => supportOpenCb?.());

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'sidebar-support-dismiss';
    dismiss.setAttribute('data-testid', 'sidebar-support-dismiss');
    dismiss.setAttribute('aria-label', copy.dismissLabel);
    dismiss.title = copy.dismissLabel;
    dismiss.innerHTML = '<svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><path d="M1 1l6 6M7 1L1 7"/></svg>';
    dismiss.addEventListener('click', () => dismissSupportLink());

    group.append(link, dismiss);
    items.append(metrics, group);
    return items;
  }

  function dismissSupportLink(): void {
    const confirmation = supportLinkCopy?.dismissConfirmation ?? '';
    supportLinkVisible = false;
    renderFooter();
    supportDismissCb?.();
    if (!supportStatusEl || !confirmation) {return;}
    if (supportStatusTimer !== null) {window.clearTimeout(supportStatusTimer);}
    supportStatusEl.textContent = confirmation;
    supportStatusTimer = window.setTimeout(() => {
      supportStatusTimer = null;
      if (supportStatusEl) {supportStatusEl.textContent = '';}
    }, SUPPORT_STATUS_MS) as unknown as number;
  }

  /**
   * Show or hide the footer "Support MikeDown" link live, from the host's
   * `settings` broadcast (`mikedown.support.showSidebarLink` + entry copy).
   */
  function applySupportLink(opts: { visible: boolean; copy?: SupportLinkCopy | null }): void {
    if (opts.copy) {supportLinkCopy = opts.copy;}
    if (supportLinkVisible === opts.visible) {return;}
    supportLinkVisible = opts.visible;
    renderFooter();
  }

  /** The AI chip: tone drives the glyph and colour, text is ellipsized, the tooltip has the detail. */
  function applyAiIndicator(state: AiIndicatorState | null): void {
    aiIndicator = state;
    renderAiIndicator();
  }

  function renderAiIndicator(): void {
    const chip = aiChipEl;
    if (!chip) {return;}
    const state = aiIndicator;
    chip.hidden = !state;
    if (!state) {return;}
    chip.dataset.tone = state.tone;
    chip.classList.toggle('is-fallback', state.fallback);
    chip.classList.toggle('is-warn', state.warn);
    chip.title = state.title;
    chip.setAttribute('aria-label', `${state.text}. Open AI settings`);
    const glyph = document.createElement('span');
    glyph.className = 'sidebar-ai-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.innerHTML = AI_CHIP_GLYPHS[state.warn ? 'warn' : state.tone];
    const text = document.createElement('span');
    text.className = 'sidebar-ai-text';
    text.textContent = state.text;
    chip.replaceChildren(glyph, text);
  }

  /**
   * Stop the footer clock and forget the DOM this module was bound to. Called
   * when the owning editor is destroyed.
   */
  function destroyOutlineSidebar(): void {
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (footerTickTimer !== null) {
      window.clearInterval(footerTickTimer);
      footerTickTimer = null;
    }
    if (supportStatusTimer !== null) {
      window.clearTimeout(supportStatusTimer);
      supportStatusTimer = null;
    }
    editorRef = null;
    sidebarEl = null;
    toggleEl = null;
    scrollContainerEl = null;
    prefsRef = null;
    openTagCb = null;
    openBacklinkCb = null;
  }

  function startFooterTick(): void {
    if (footerTickTimer !== null) {return;}
    // Once a minute, refresh the relative-time string. Cheap — it's a single
    // textContent write.
    footerTickTimer = window.setInterval(() => renderFooter(), 60_000) as unknown as number;
  }

  init(opts);
  return {
    applyOutlineState,
    applyBacklinks,
    applyTags,
    setTagsSectionEnabled,
    applyProperties,
    focusPropertiesSection,
    applyDocMeta,
    applyPlainText,
    toggleSidebarVisible,
    applySupportLink,
    applyAiIndicator,
    applySuggestAvailability,
    applyPropertySuggestions,
    isVisible: () => !!sidebarEl && !sidebarEl.hidden,
    destroy: destroyOutlineSidebar,
  };
}

// ── Single-instance convenience API ────────────────────────────────────────
// The original module-level functions, kept for tests and hosts with one
// editor: they drive the most recently initialised sidebar.

let current: OutlineSidebar | null = null;

export function initOutlineSidebar(opts: InitOptions): void {
  current?.destroy();
  current = createOutlineSidebar(opts);
}
export function applyOutlineState(state: Parameters<OutlineSidebar['applyOutlineState']>[0]): void { current?.applyOutlineState(state); }
export function applyBacklinks(items: BacklinkItem[]): void { current?.applyBacklinks(items); }
export function applyTags(items: TagItem[]): void { current?.applyTags(items); }
export function setTagsSectionEnabled(enabled: boolean): void { current?.setTagsSectionEnabled(enabled); }
export function applyProperties(entries: FrontmatterEntry[], opts?: { editable?: boolean }): void { current?.applyProperties(entries, opts); }
export function focusPropertiesSection(): void { current?.focusPropertiesSection(); }
export function applyDocMeta(meta: { mtimeMs?: number | null }): void { current?.applyDocMeta(meta); }
export function applyPlainText(plainText: string): void { current?.applyPlainText(plainText); }
export function toggleSidebarVisible(): void { current?.toggleSidebarVisible(); }
export function applySupportLink(opts: { visible: boolean; copy?: SupportLinkCopy | null }): void { current?.applySupportLink(opts); }
export function destroyOutlineSidebar(): void {
  current?.destroy();
  current = null;
}
