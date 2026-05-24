// In-editor document sidebar. As of 2.3.0 hosts three stacked sections —
// Properties (when frontmatter is present), Outline, Backlinks — plus a
// footer strip with modified time / word count / reading time.
//
// State persistence (width, visibility preference, per-document last state,
// per-document section-collapsed state) is round-tripped to the extension
// via postMessage; this module just emits the intent and applies updates
// when they come back.

import { countWords, readingMinutes } from '../wordCount';
import { formatRelativeTime } from './relativeTime';

type VsApi = { postMessage(msg: any): void };

export type OutlineVisibilityPref = 'always' | 'never' | 'remember';
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
}

const MIN_WIDTH = 160;
const MAX_WIDTH = 360;
const DEFAULT_WIDTH = 200;

let pref: OutlineVisibilityPref = 'never';
let position: OutlinePosition = 'right';
let perDocRememberedVisible = false;
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

// Per-document section collapse state (mirrored from host).
const collapsedSections = new Set<string>(); // 'properties' | 'outline' | 'backlinks'

let currentBacklinks: BacklinkItem[] = [];
let lastBacklinksKey = '';
let currentProperties: FrontmatterEntry[] = [];

// Footer state — updates whenever any input changes.
let docMtimeMs: number | null = null;
let docPlainText = '';
let footerTickTimer: number | null = null;

export function initOutlineSidebar(opts: InitOptions): void {
  editorRef = opts.editor;
  vscodeRef = opts.vscode;
  anchorFnRef = opts.anchorFn;

  sidebarEl = document.getElementById('mikedown-outline-sidebar');
  toggleEl = document.getElementById('mikedown-outline-toggle') as HTMLButtonElement | null;
  if (!sidebarEl || !toggleEl) return;

  buildSidebarSkeleton(sidebarEl);

  closeEl = sidebarEl.querySelector<HTMLButtonElement>('.outline-close');
  handleEl = sidebarEl.querySelector<HTMLElement>('.outline-resize-handle');

  setWidth(width);
  setPosition(position);
  setVisible(false, { silent: true });

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
  vscodeRef.postMessage({ type: 'outlineRequestState' });
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

  // Properties (hidden when no frontmatter)
  propertiesSectionEl = document.createElement('section');
  propertiesSectionEl.className = 'sidebar-section properties-section';
  propertiesSectionEl.dataset.section = 'properties';
  propertiesSectionEl.hidden = true;
  propertiesSectionEl.appendChild(buildSectionHeader('Properties', 'properties'));
  propertiesListEl = document.createElement('div');
  propertiesListEl.className = 'sidebar-section-body properties-list';
  propertiesSectionEl.appendChild(propertiesListEl);
  root.appendChild(propertiesSectionEl);

  // Outline
  const outlineSection = document.createElement('section');
  outlineSection.className = 'sidebar-section outline-section';
  outlineSection.dataset.section = 'outline';
  outlineSection.appendChild(buildSectionHeader('Outline', 'outline', /* withClose */ true));
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

function buildSectionHeader(label: string, section: string, withClose = false): HTMLElement {
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
    if ((ev.target as HTMLElement).closest('.outline-close')) return;
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
  rememberedVisible?: boolean;
  collapsedSections?: string[];
}): void {
  if (typeof state.width === 'number') setWidth(state.width);
  if (state.position === 'left' || state.position === 'right') setPosition(state.position);
  if (state.pref) pref = state.pref;
  if (typeof state.rememberedVisible === 'boolean') {
    perDocRememberedVisible = state.rememberedVisible;
  }
  if (Array.isArray(state.collapsedSections)) {
    collapsedSections.clear();
    for (const s of state.collapsedSections) collapsedSections.add(s);
    applySectionCollapsedDom();
  }
  applyVisibilityFromPref();
}

export function applyBacklinks(items: BacklinkItem[]): void {
  currentBacklinks = items || [];
  // Open the Backlinks section by default when there's something to show;
  // collapse it if empty (unless the user has an explicit preference saved).
  if (currentBacklinks.length === 0 && !collapsedSections.has('backlinks')) {
    // soft-default — do not persist
  }
  renderBacklinks();
}

export function applyProperties(entries: FrontmatterEntry[]): void {
  currentProperties = entries || [];
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

function setVisible(visible: boolean, opts: { silent?: boolean } = {}): void {
  if (!sidebarEl || !toggleEl) return;
  sidebarEl.hidden = !visible;
  document.body.classList.toggle('mikedown-outline-open', visible);
  toggleEl.setAttribute('aria-expanded', visible ? 'true' : 'false');
  if (!opts.silent) {
    perDocRememberedVisible = visible;
    vscodeRef?.postMessage({ type: 'outlineSetVisible', visible });
  }
  if (visible) {
    rebuildHeadings();
    updateActiveFromCursor();
    renderFooter();
  }
}

function applyVisibilityFromPref(): void {
  let visible: boolean;
  if (pref === 'always') visible = true;
  else if (pref === 'never') visible = false;
  else visible = perDocRememberedVisible;
  setVisible(visible, { silent: true });
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
      handle.releasePointerCapture(ev.pointerId);
      sidebarEl?.classList.remove('resizing');
      document.body.classList.remove('mikedown-outline-resizing');
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      vscodeRef?.postMessage({ type: 'outlineSetWidth', width });
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

  if (currentProperties.length === 0) {
    propertiesSectionEl.hidden = true;
    return;
  }
  propertiesSectionEl.hidden = false;

  for (const entry of currentProperties) {
    const row = document.createElement('div');
    row.className = 'properties-row';

    const key = document.createElement('span');
    key.className = 'properties-key';
    key.textContent = entry.key;
    row.appendChild(key);

    const value = document.createElement('span');
    value.className = 'properties-value';
    if (Array.isArray(entry.value)) {
      for (const v of entry.value) {
        const pill = document.createElement('span');
        pill.className = 'properties-pill';
        pill.textContent = v;
        pill.title = v;
        value.appendChild(pill);
      }
    } else {
      value.textContent = entry.value;
      value.title = entry.value;
    }
    row.appendChild(value);

    propertiesListEl.appendChild(row);
  }
}

// ── Footer rendering ───────────────────────────────────────────────────────

function renderFooter(): void {
  if (!footerEl) return;
  const wc = countWords(docPlainText);
  const rt = readingMinutes(wc);
  const modPart = docMtimeMs !== null
    ? `Modified ${formatRelativeTime(docMtimeMs)}`
    : 'Modified —';
  const wordsLabel = wc === 1 ? 'word' : 'words';
  footerEl.textContent = `${modPart} · ${wc.toLocaleString()} ${wordsLabel} · ${rt} min read`;
}

function startFooterTick(): void {
  if (footerTickTimer !== null) return;
  // Once a minute, refresh the relative-time string. Cheap — it's a single
  // textContent write.
  footerTickTimer = window.setInterval(() => renderFooter(), 60_000) as unknown as number;
}
