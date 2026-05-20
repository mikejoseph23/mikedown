// In-editor outline sidebar. Renders a compact heading list to the left of
// the editor, tracks the active heading as the cursor moves, supports
// click-to-navigate, drag-to-resize, and a discovery toggle.
//
// State persistence (width, visibility preference, per-document last state)
// is round-tripped to the extension via postMessage; this module just emits
// the intent and applies updates when they come back.

type VsApi = { postMessage(msg: any): void };

export type OutlineVisibilityPref = 'always' | 'never' | 'remember';

interface Heading {
  level: number;
  text: string;
  anchor: string;
  pos: number;
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
let perDocRememberedVisible = false;
let width = DEFAULT_WIDTH;
let editorRef: any = null;
let vscodeRef: VsApi | null = null;
let anchorFnRef: (text: string) => string = (t) => t;
let activeAnchor = '';
let lastHeadingsKey = '';

let sidebarEl: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let toggleEl: HTMLButtonElement | null = null;
let closeEl: HTMLButtonElement | null = null;
let handleEl: HTMLElement | null = null;

export function initOutlineSidebar(opts: InitOptions): void {
  editorRef = opts.editor;
  vscodeRef = opts.vscode;
  anchorFnRef = opts.anchorFn;

  sidebarEl = document.getElementById('mikedown-outline-sidebar');
  toggleEl = document.getElementById('mikedown-outline-toggle') as HTMLButtonElement | null;
  if (!sidebarEl || !toggleEl) return;

  listEl = sidebarEl.querySelector<HTMLElement>('.outline-list');
  closeEl = sidebarEl.querySelector<HTMLButtonElement>('.outline-close');
  handleEl = sidebarEl.querySelector<HTMLElement>('.outline-resize-handle');

  setWidth(width);
  setVisible(false, { silent: true });

  toggleEl.addEventListener('click', () => setVisible(true));
  closeEl?.addEventListener('click', () => setVisible(false));
  handleEl && wireResize(handleEl);

  editorRef.on('update', () => rebuildHeadings());
  editorRef.on('selectionUpdate', () => updateActiveFromCursor());
  wireScrollSpy();
  rebuildHeadings();

  // Ask the extension for our persisted prefs/state.
  vscodeRef.postMessage({ type: 'outlineRequestState' });
}

// ── External hooks (called from editor-main's message handler) ─────────────

export function applyOutlineState(state: {
  pref?: OutlineVisibilityPref;
  width?: number;
  rememberedVisible?: boolean;
}): void {
  if (typeof state.width === 'number') setWidth(state.width);
  if (state.pref) pref = state.pref;
  if (typeof state.rememberedVisible === 'boolean') {
    perDocRememberedVisible = state.rememberedVisible;
  }
  applyVisibilityFromPref();
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
  }
}

function applyVisibilityFromPref(): void {
  let visible: boolean;
  if (pref === 'always') visible = true;
  else if (pref === 'never') visible = false;
  else visible = perDocRememberedVisible; // 'remember'
  setVisible(visible, { silent: true });
}

// ── Width / resize ─────────────────────────────────────────────────────────

function setWidth(px: number): void {
  width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(px)));
  document.documentElement.style.setProperty('--mikedown-outline-width', `${width}px`);
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
      setWidth(startWidth + (ev.clientX - startX));
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
  if (!listEl || sidebarEl?.hidden) return;
  const headings = collectHeadings();
  const key = headings.map(h => `${h.level}|${h.anchor}|${h.text}`).join('\n');
  if (key === lastHeadingsKey) {
    updateActiveFromCursor();
    return;
  }
  lastHeadingsKey = key;

  listEl.replaceChildren();
  if (headings.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'outline-empty';
    empty.textContent = 'No headings yet';
    listEl.appendChild(empty);
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
    listEl.appendChild(item);
  }
  updateActiveFromCursor();
}

// ── Active-item tracking ───────────────────────────────────────────────────

function updateActiveFromCursor(): void {
  if (!editorRef || !listEl || sidebarEl?.hidden) return;
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
  if (!listEl) return;
  const items = listEl.querySelectorAll<HTMLElement>('.outline-item');
  let activeEl: HTMLElement | null = null;
  items.forEach((el) => {
    const on = el.dataset.anchor === activeAnchor;
    el.classList.toggle('active', on);
    if (on) activeEl = el;
  });
  if (activeEl) scrollActiveIntoView(activeEl);
}

function scrollActiveIntoView(el: HTMLElement): void {
  if (!listEl) return;
  const itemTop = el.offsetTop;
  const itemBottom = itemTop + el.offsetHeight;
  const viewTop = listEl.scrollTop;
  const viewBottom = viewTop + listEl.clientHeight;
  if (itemTop < viewTop) {
    listEl.scrollTo({ top: itemTop - 4, behavior: 'smooth' });
  } else if (itemBottom > viewBottom) {
    listEl.scrollTo({ top: itemBottom - listEl.clientHeight + 4, behavior: 'smooth' });
  }
}

// ── Scroll spy: update active item when the editor scrolls (e.g. anchor-link clicks) ──

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
  if (!listEl || sidebarEl?.hidden) return;
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

// ── Click → scroll editor ──────────────────────────────────────────────────

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
