// In-editor document sidebar. As of 2.3.0 hosts three stacked sections —
// Properties (when frontmatter is present), Outline, Backlinks — plus a
// footer strip with modified time / word count / reading time.
//
// Visibility is binary across documents: pin on (`always`) shows the sidebar
// for every document; pin off (`never`) starts every document hidden. The
// toggle button can still surface it for the current session; nothing about
// that ad-hoc visibility persists.

import { countWords, readingMinutes } from '../wordCount';
import { formatRelativeTime } from './relativeTime';

type VsApi = { postMessage(msg: any): void };

export type OutlineVisibilityPref = 'always' | 'never';
export type OutlinePosition = 'left' | 'right';

interface Heading {
  level: number;
  text: string;
  anchor: string;
  pos: number;
}

interface BacklinkItem {
  uri: string;
  displayPath: string;
  line: number;
  lineText?: string;
}

interface FrontmatterEntry {
  key: string;
  /** Either a scalar string or an array of strings (for `tags: [a, b]`-style). */
  value: string | string[];
}

interface InitOptions {
  editor: any;
  vscode: VsApi;
  anchorFn: (text: string) => string;
  /**
   * Invoked when the user edits properties inline. The callback owns the
   * serialize-and-post step; the sidebar just produces the new entries list.
   */
  onPropertiesChange?: (entries: FrontmatterEntry[]) => void;
}

const MIN_WIDTH = 160;
const MAX_WIDTH = 360;
const DEFAULT_WIDTH = 200;

let pref: OutlineVisibilityPref = 'never';
let position: OutlinePosition = 'right';
let width = DEFAULT_WIDTH;
let editorRef: any = null;
let vscodeRef: VsApi | null = null;
let anchorFnRef: (text: string) => string = (t) => t;
let activeAnchor = '';
let lastHeadingsKey = '';

let sidebarEl: HTMLElement | null = null;
let outlineListEl: HTMLElement | null = null;
let backlinksListEl: HTMLElement | null = null;
let backlinksCountEl: HTMLElement | null = null;
let backlinksSectionEl: HTMLElement | null = null;
let propertiesSectionEl: HTMLElement | null = null;
let propertiesListEl: HTMLElement | null = null;
let footerEl: HTMLElement | null = null;
let toggleEl: HTMLButtonElement | null = null;
let closeEl: HTMLButtonElement | null = null;
let handleEl: HTMLElement | null = null;
let pinButtonEl: HTMLButtonElement | null = null;
let positionToggleEl: HTMLButtonElement | null = null;

// Two pin states so the on/off difference is obvious:
//   PIN_SVG_OFF — outlined pin, tilted (looks loose / "about to fall out")
//   PIN_SVG_ON  — filled pin, upright (firmly stuck in)
// Combined with the .pinned CSS pill background, on/off is unmistakable.
const PIN_SVG_OFF = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform:rotate(45deg)"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
const PIN_SVG_ON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.5 2.5a1 1 0 0 0-1.7-.7l-1.4 1.4a2 2 0 0 0-.5 2l.3 1-3.8 3.8-1.2-.3a2 2 0 0 0-1.9.5l-1 1a1 1 0 0 0 0 1.4l4 4-4.5 4.5a1 1 0 1 0 1.4 1.4l4.5-4.5 4 4a1 1 0 0 0 1.4 0l1-1a2 2 0 0 0 .5-1.9l-.3-1.2 3.8-3.8 1 .3a2 2 0 0 0 2-.5l1.4-1.4a1 1 0 0 0-.7-1.7L14.5 2.5z"/></svg>';

// Side arrow icons — point to the *opposite* side (i.e. where clicking will move the sidebar to).
const SIDEBAR_ARROW_LEFT  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
const SIDEBAR_ARROW_RIGHT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';

// Discovery-toggle icon — outline rect + a filled pane on the side the sidebar
// lives on. Mirrors VS Code's own layout-sidebar codicons.
const SIDEBAR_ICON_LEFT  = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1"/><rect x="3" y="4" width="3" height="8" fill="currentColor" stroke="none"/></svg>';
const SIDEBAR_ICON_RIGHT = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1"/><rect x="10" y="4" width="3" height="8" fill="currentColor" stroke="none"/></svg>';

// Per-document section collapse state (mirrored from host).
const collapsedSections = new Set<string>(); // 'properties' | 'outline' | 'backlinks'

// True once the user has saved a collapse preference for this document (i.e.
// the host's per-doc map has an entry). While false, applyBacklinks /
// applyProperties auto-collapse their section when empty — the moment the
// user toggles anything, that auto behavior turns off for the rest of the
// session and the saved state takes over.
let hasUserCollapsePreference = false;

let currentBacklinks: BacklinkItem[] = [];
let lastBacklinksKey = '';
let currentProperties: FrontmatterEntry[] = [];
let propertiesEditable = false;
let propertiesChangeCb: ((entries: FrontmatterEntry[]) => void) | null = null;

// Footer state — updates whenever any input changes.
let docMtimeMs: number | null = null;
let docPlainText = '';
let footerTickTimer: number | null = null;

export function initOutlineSidebar(opts: InitOptions): void {
  editorRef = opts.editor;
  vscodeRef = opts.vscode;
  anchorFnRef = opts.anchorFn;
  propertiesChangeCb = opts.onPropertiesChange ?? null;

  sidebarEl = document.getElementById('mikedown-outline-sidebar');
  toggleEl = document.getElementById('mikedown-outline-toggle') as HTMLButtonElement | null;
  if (!sidebarEl || !toggleEl) return;

  buildSidebarSkeleton(sidebarEl);

  closeEl = sidebarEl.querySelector<HTMLButtonElement>('.outline-close');
  handleEl = sidebarEl.querySelector<HTMLElement>('.outline-resize-handle');

  setWidth(width);
  setPosition(position);
  setVisible(false);

  toggleEl.addEventListener('click', () => setVisible(true));
  closeEl?.addEventListener('click', () => setVisible(false));
  handleEl && wireResize(handleEl);

  editorRef.on('update', () => rebuildHeadings());
  editorRef.on('selectionUpdate', () => updateActiveFromCursor());
  wireScrollSpy();
  rebuildHeadings();

  // Footer refreshes the "modified X ago" string once a minute so it stays
  // accurate without spamming layout work.
  startFooterTick();

  // Ask the extension for our persisted prefs/state.
  vscodeRef.postMessage({ type: 'sidebarRequestState' });
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
  root.appendChild(backlinksSectionEl);

  // Properties — always visible (renders an empty-state placeholder when no
  // frontmatter exists). Lives below Backlinks so the editor's primary
  // navigation (Outline + Backlinks) gets priority at the top.
  propertiesSectionEl = document.createElement('section');
  propertiesSectionEl.className = 'sidebar-section properties-section';
  propertiesSectionEl.dataset.section = 'properties';
  propertiesSectionEl.appendChild(buildSectionHeader('Properties', 'properties'));
  propertiesListEl = document.createElement('div');
  propertiesListEl.className = 'sidebar-section-body properties-list';
  propertiesSectionEl.appendChild(propertiesListEl);
  root.appendChild(propertiesSectionEl);

  // Footer
  footerEl = document.createElement('div');
  footerEl.className = 'sidebar-footer';
  root.appendChild(footerEl);

  // Resize handle — same role as before
  const handle = document.createElement('div');
  handle.className = 'outline-resize-handle';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', 'Resize sidebar');
  root.appendChild(handle);

  renderBacklinksEmpty();
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
    const posBtn = document.createElement('button');
    posBtn.type = 'button';
    posBtn.className = 'outline-position-toggle';
    posBtn.style.marginLeft = 'auto';
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
      setVisible(false);
    });
  }

  const toggle = (): void => toggleSectionCollapsed(section);
  header.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    if (target.closest('.outline-close') || target.closest('.outline-pin') || target.closest('.outline-position-toggle')) return;
    toggle();
  });
  header.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      toggle();
    }
  });
  return header;
}

function toggleSectionCollapsed(section: string): void {
  if (collapsedSections.has(section)) collapsedSections.delete(section);
  else collapsedSections.add(section);
  // Any manual toggle counts as the user expressing a preference — disable
  // auto-collapse-when-empty for the rest of this session.
  hasUserCollapsePreference = true;
  applySectionCollapsedDom();
  vscodeRef?.postMessage({
    type: 'sidebarSectionCollapsed',
    section,
    collapsed: collapsedSections.has(section),
  });
}

function applySectionCollapsedDom(): void {
  if (!sidebarEl) return;
  sidebarEl.querySelectorAll<HTMLElement>('.sidebar-section').forEach((el) => {
    const name = el.dataset.section || '';
    el.classList.toggle('collapsed', collapsedSections.has(name));
    el.querySelector('.sidebar-section-header')?.setAttribute(
      'aria-expanded', collapsedSections.has(name) ? 'false' : 'true'
    );
  });
}

// ── External hooks (called from editor-main's message handler) ─────────────

export function applyOutlineState(state: {
  pref?: OutlineVisibilityPref;
  width?: number;
  position?: OutlinePosition;
  collapsedSections?: string[];
  hasUserCollapsePreference?: boolean;
}): void {
  if (typeof state.width === 'number') setWidth(state.width);
  if (state.position === 'left' || state.position === 'right') setPosition(state.position);
  if (state.pref === 'always' || state.pref === 'never') pref = state.pref;
  if (typeof state.hasUserCollapsePreference === 'boolean') {
    hasUserCollapsePreference = state.hasUserCollapsePreference;
  }
  if (Array.isArray(state.collapsedSections)) {
    collapsedSections.clear();
    for (const s of state.collapsedSections) collapsedSections.add(s);
    applySectionCollapsedDom();
  }
  applyVisibilityFromPref();
  updatePinState();
  updatePositionToggle();
}

/**
 * Apply the "collapse when empty" default for a section, but only if the user
 * hasn't yet saved a collapse preference for this document. Called from
 * applyBacklinks / applyProperties once the actual content is known.
 */
function autoCollapseIfEmpty(section: string, isEmpty: boolean): void {
  if (hasUserCollapsePreference) return;
  const wasCollapsed = collapsedSections.has(section);
  const shouldCollapse = isEmpty;
  if (wasCollapsed !== shouldCollapse) {
    if (shouldCollapse) collapsedSections.add(section);
    else collapsedSections.delete(section);
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
  vscodeRef?.postMessage({ type: 'sidebarSetPref', pref: next });
}

function updatePinState(): void {
  if (!pinButtonEl) return;
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
  if (!positionToggleEl) return;
  // The arrow points to the *other* side — i.e. where clicking will move the sidebar.
  const movingTo: OutlinePosition = position === 'right' ? 'left' : 'right';
  positionToggleEl.innerHTML = movingTo === 'left' ? SIDEBAR_ARROW_LEFT : SIDEBAR_ARROW_RIGHT;
  positionToggleEl.title = `Move sidebar to ${movingTo}`;
  positionToggleEl.setAttribute('aria-label', positionToggleEl.title);
}

export function applyBacklinks(items: BacklinkItem[]): void {
  currentBacklinks = items || [];
  autoCollapseIfEmpty('backlinks', currentBacklinks.length === 0);
  renderBacklinks();
}

export function applyProperties(
  entries: FrontmatterEntry[],
  opts?: { editable?: boolean }
): void {
  currentProperties = entries || [];
  propertiesEditable = opts?.editable !== false && propertiesChangeCb !== null;
  // Auto-collapse purely on actual property count. The editable "+ Add property"
  // affordance doesn't count as content — when the doc has no frontmatter,
  // collapse the section so the user can expand it on demand if they want to
  // add one. Once they manually toggle (or add anything), hasUserCollapsePreference
  // takes over and the auto rule stops applying.
  autoCollapseIfEmpty('properties', currentProperties.length === 0);
  renderProperties();
}

export function applyDocMeta(meta: { mtimeMs?: number | null }): void {
  if (typeof meta.mtimeMs === 'number') docMtimeMs = meta.mtimeMs;
  else if (meta.mtimeMs === null) docMtimeMs = null;
  renderFooter();
}

export function applyPlainText(plainText: string): void {
  docPlainText = plainText || '';
  renderFooter();
}

// ── Visibility ─────────────────────────────────────────────────────────────

function setVisible(visible: boolean): void {
  // Visibility is session-only when manually toggled; the pin pref is what
  // persists. Nothing posted back to the host on a manual show/hide.
  if (!sidebarEl || !toggleEl) return;
  sidebarEl.hidden = !visible;
  document.body.classList.toggle('mikedown-outline-open', visible);
  toggleEl.setAttribute('aria-expanded', visible ? 'true' : 'false');
  if (visible) {
    rebuildHeadings();
    updateActiveFromCursor();
    renderFooter();
  }
}

function applyVisibilityFromPref(): void {
  setVisible(pref === 'always');
}

// ── Width / resize ─────────────────────────────────────────────────────────

function setWidth(px: number): void {
  width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(px)));
  document.documentElement.style.setProperty('--mikedown-outline-width', `${width}px`);
}

function setPosition(next: OutlinePosition): void {
  position = next;
  document.body.classList.toggle('mikedown-outline-left', position === 'left');
  document.body.classList.toggle('mikedown-outline-right', position === 'right');
  if (toggleEl) {
    toggleEl.innerHTML = position === 'left' ? SIDEBAR_ICON_LEFT : SIDEBAR_ICON_RIGHT;
  }
}

function wireResize(handle: HTMLElement): void {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    sidebarEl?.classList.add('resizing');
    document.body.classList.add('mikedown-outline-resizing');
    const startX = e.clientX;
    const startWidth = width;

    const onMove = (ev: PointerEvent): void => {
      const delta = ev.clientX - startX;
      // On a right-anchored sidebar the handle lives on its left edge, so
      // dragging right (positive delta) shrinks the sidebar instead of growing it.
      setWidth(position === 'right' ? startWidth - delta : startWidth + delta);
    };
    const onUp = (ev: PointerEvent): void => {
      // Width is per-instance session state — the global default lives in
      // Settings → Appearance and only seeds newly-opened documents.
      handle.releasePointerCapture(ev.pointerId);
      sidebarEl?.classList.remove('resizing');
      document.body.classList.remove('mikedown-outline-resizing');
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
  if (!editorRef) return headings;
  const seen = new Map<string, number>();
  editorRef.state.doc.forEach((node: any, offset: number) => {
    if (node.type.name !== 'heading') return;
    const text = (node.textContent as string).trim();
    if (!text) return;
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
  if (!outlineListEl || sidebarEl?.hidden) return;
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
  for (const h of headings) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `outline-item level-${Math.max(1, Math.min(6, h.level))}`;
    item.dataset.anchor = h.anchor;
    item.title = h.text;
    item.textContent = h.text;
    item.addEventListener('click', () => scrollEditorToAnchor(h.anchor));
    outlineListEl.appendChild(item);
  }
  updateActiveFromCursor();
}

// ── Active-item tracking ───────────────────────────────────────────────────

function updateActiveFromCursor(): void {
  if (!editorRef || !outlineListEl || sidebarEl?.hidden) return;
  const from = editorRef.state.selection.from;
  let currentAnchor = '';
  const seen = new Map<string, number>();
  editorRef.state.doc.forEach((node: any, offset: number) => {
    if (node.type.name !== 'heading') return;
    const text = (node.textContent as string).trim();
    if (!text) return;
    const base = anchorFnRef(text);
    const count = seen.get(base) ?? 0;
    const anchor = count === 0 ? base : `${base}-${count}`;
    seen.set(base, count + 1);
    if (offset <= from) currentAnchor = anchor;
  });
  if (currentAnchor === activeAnchor) return;
  activeAnchor = currentAnchor;
  highlightActive();
}

function highlightActive(): void {
  if (!outlineListEl) return;
  const items = outlineListEl.querySelectorAll<HTMLElement>('.outline-item');
  let activeEl: HTMLElement | null = null;
  items.forEach((el) => {
    const on = el.dataset.anchor === activeAnchor;
    el.classList.toggle('active', on);
    if (on) activeEl = el;
  });
  if (activeEl) scrollActiveIntoView(activeEl);
}

function scrollActiveIntoView(el: HTMLElement): void {
  if (!outlineListEl) return;
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
  const editorContainer = document.getElementById('editor-container');
  if (!editorContainer) return;
  let scrollTimer: number | undefined;
  editorContainer.addEventListener('scroll', () => {
    if (sidebarEl?.hidden) return;
    clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(updateActiveFromScroll, 80) as unknown as number;
  });
}

function updateActiveFromScroll(): void {
  if (!outlineListEl || sidebarEl?.hidden) return;
  const editorContainer = document.getElementById('editor-container');
  if (!editorContainer) return;
  const headings = editorContainer.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6');
  if (headings.length === 0) return;
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
  if (currentAnchor === activeAnchor) return;
  activeAnchor = currentAnchor;
  highlightActive();
}

function scrollEditorToAnchor(anchor: string): void {
  const editorContainer = document.getElementById('editor-container');
  if (!editorContainer) return;
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
  if (!backlinksListEl || !backlinksCountEl) return;

  // Refresh the count badge
  const count = currentBacklinks.length;
  if (count > 0) {
    backlinksCountEl.hidden = false;
    backlinksCountEl.textContent = ` (${count})`;
  } else {
    backlinksCountEl.hidden = true;
    backlinksCountEl.textContent = '';
  }

  // Avoid rebuilding identical content (rapid resaves elsewhere in workspace).
  const key = currentBacklinks
    .map(b => `${b.uri}|${b.line}|${b.displayPath}|${b.lineText ?? ''}`)
    .join('\n');
  if (key === lastBacklinksKey) return;
  lastBacklinksKey = key;

  backlinksListEl.replaceChildren();
  if (count === 0) {
    renderBacklinksEmpty();
    return;
  }

  for (const item of currentBacklinks) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'backlinks-item';
    row.title = item.lineText
      ? `${item.displayPath} (line ${item.line})\n${item.lineText}`
      : `${item.displayPath} (line ${item.line})`;
    row.textContent = item.displayPath;
    row.addEventListener('click', () => {
      vscodeRef?.postMessage({
        type: 'openLink',
        href: item.uri,
        behavior: 'navigateCurrentTab',
      });
    });
    backlinksListEl.appendChild(row);
  }
}

function renderBacklinksEmpty(): void {
  if (!backlinksListEl) return;
  backlinksListEl.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'backlinks-empty';
  empty.textContent = 'No backlinks.';
  backlinksListEl.appendChild(empty);
}

// ── Properties rendering ───────────────────────────────────────────────────

function renderProperties(): void {
  if (!propertiesListEl || !propertiesSectionEl) return;
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

  const value = document.createElement('span');
  value.className = 'properties-value';
  if (Array.isArray(entry.value)) {
    value.classList.add('array');
    for (let pi = 0; pi < entry.value.length; pi++) {
      value.appendChild(buildPill(entry.value[pi], index, pi));
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

function buildPill(text: string, rowIdx: number, pillIdx: number): HTMLElement {
  const pill = document.createElement('span');
  pill.className = 'properties-pill';
  pill.dataset.pillIdx = String(pillIdx);

  const label = document.createElement('span');
  label.className = 'properties-pill-text';
  label.textContent = text;
  label.title = text;
  pill.appendChild(label);

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
      if (!entry || !Array.isArray(entry.value)) return;
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
  const valueEl = row.querySelector('.properties-value') as HTMLElement | null;
  const entry = currentProperties[index];
  if (!valueEl || !entry || Array.isArray(entry.value)) return;

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
  const keyEl = row.querySelector('.properties-key') as HTMLElement | null;
  const entry = currentProperties[index];
  if (!keyEl || !entry) return;

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
  if (!entry || !Array.isArray(entry.value)) return;

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
  if (!entry || !Array.isArray(entry.value)) return;

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
    if (next && rowEl.contains(next)) return;
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
    if (settled) return;
    settled = true;
    opts.commit();
  };
  const cancel = (): void => {
    if (settled) return;
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
  if (!propertiesChangeCb) return;
  // Update local snapshot immediately so a re-render between now and the
  // host round-trip doesn't blink the old values.
  currentProperties = next;
  propertiesChangeCb(next);
}

// ── Footer rendering ───────────────────────────────────────────────────────

function renderFooter(): void {
  if (!footerEl) return;
  const wc = countWords(docPlainText);
  const cc = docPlainText.length;
  const rt = readingMinutes(wc);
  const modPart = docMtimeMs !== null
    ? `Modified ${formatRelativeTime(docMtimeMs)}`
    : 'Modified —';
  const wordsLabel = wc === 1 ? 'word' : 'words';
  const charsLabel = cc === 1 ? 'char' : 'chars';
  const metricsPart = `${wc.toLocaleString()} ${wordsLabel} · ${cc.toLocaleString()} ${charsLabel} · ${rt} min read`;
  footerEl.replaceChildren();
  const row1 = document.createElement('div');
  row1.className = 'sidebar-footer-row';
  row1.textContent = modPart;
  const row2 = document.createElement('div');
  row2.className = 'sidebar-footer-row';
  row2.textContent = metricsPart;
  footerEl.appendChild(row1);
  footerEl.appendChild(row2);
}

function startFooterTick(): void {
  if (footerTickTimer !== null) return;
  // Once a minute, refresh the relative-time string. Cheap — it's a single
  // textContent write.
  footerTickTimer = window.setInterval(() => renderFooter(), 60_000) as unknown as number;
}
