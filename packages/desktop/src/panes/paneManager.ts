/**
 * Panes and tabs on screen (M4). One `createMikeDownEditor` per pane, bound
 * to the active tab's `DocumentModel` through `attach`; the layout itself is
 * the data tree in `paneLayout.ts`, and every change goes through it so the
 * session file can serialise it as is.
 *
 * Each pane: a tab strip (ARIA `tablist` / `tab`, arrow keys, Home/End,
 * middle-click and the × close, pointer-drag reorder across panes, a
 * context menu), an info bar for the document's notice, the editor and an
 * image viewer. Tabs show a dirty dot, a lock badge for read-only documents
 * and the "still downloading" state with Retry (edge case 10). Focus follows
 * click; the focused pane is where shortcuts, the window title and the
 * status footer look.
 *
 * Splits render as nested flex boxes with a draggable divider. A pane whose
 * last tab closes disappears unless it is the only one.
 */
import type { MikeDownEditorHandle, MikeDownStats, MikeDownViewState } from '@mikedown/core';
import type { DocumentModel, DocumentRegistry } from '../documents/documentModel';
import { fileName } from '../documents/documentModel';
import { formatAccelerator, SHORTCUTS, type AppCommand } from '../menu/shortcuts';
import { createImageViewer, type ImageViewer } from '../ui/imageViewer';
import {
  activateTab,
  activeTab,
  closeTab as layoutCloseTab,
  closeTabs as layoutCloseTabs,
  createPane,
  cycleTab,
  findPane,
  moveTab,
  moveTabToPane,
  openTab as layoutOpenTab,
  panes as allPanes,
  renameDoc as layoutRenameDoc,
  resizeSplit,
  setTabViewState,
  splitPane as layoutSplitPane,
  tabsShowing,
  type LayoutNode,
  type PaneNode,
  type SplitNode,
} from './paneLayout';

export type Layout = LayoutNode<MikeDownViewState>;

export interface PaneEditor {
  handle: MikeDownEditorHandle;
  /** Last stats the editor reported, for the footer when the pane gains focus. */
  stats: MikeDownStats | null;
}

export interface PaneManagerDeps {
  /** Where the panes render (the main column). */
  root: HTMLElement;
  registry: DocumentRegistry;
  isMac: boolean;
  /** Build a core editor for a pane. `paneId` lets the host find its pane's document. */
  createEditor(container: HTMLElement, paneId: string): MikeDownEditorHandle;
  /** `asset://` URL for an image tab. */
  assetUrl(path: string): string;
  /** The user asked to close a tab (×, middle-click, Cmd+W, menu): the controller decides (dirty prompt) and calls `closeTab`. */
  requestClose(paneId: string, index: number): void;
  requestCloseOthers(paneId: string, index: number): void;
  requestCloseSaved(paneId: string): void;
  requestCloseAll(paneId: string): void;
  /** Right-click on a tab: the controller adds its document entries after the tab ones. */
  tabContextEntries(doc: DocumentModel): Array<{ label: string; disabled?: boolean; run(): void } | null>;
  showContextMenu(x: number, y: number, entries: Array<{ label: string; hint?: string; disabled?: boolean; run(): void } | null>, label: string): void;
  /** Cloud placeholder: try the read again. */
  retry(doc: DocumentModel): void;
  /** Anything about the layout or the active tabs changed (session save, title, window state). */
  onLayoutChanged(): void;
  onFocusChanged(paneId: string): void;
  /** The strip's leading slot (sidebar toggle) and trailing actions are the app's. */
  leading?: HTMLElement;
  trailing?: (paneId: string) => HTMLElement | null;
  /** Double-click on the empty part of a strip (editors open a new document there). */
  emptyStripDoubleClick?: () => void;
}

export interface PaneManager {
  readonly el: HTMLElement;
  layout(): Layout;
  focusedPaneId(): string;
  focusedPane(): PaneNode<MikeDownViewState>;
  setFocused(paneId: string, opts?: { focusEditor?: boolean }): void;
  editor(paneId: string): PaneEditor | null;
  editors(): PaneEditor[];
  /** Remember what a pane's editor last reported (stats arrive partial: document and/or selection). */
  noteStats(paneId: string, stats: MikeDownStats): void;
  /** The document the focused pane shows. */
  activeDoc(paneId?: string): DocumentModel | null;
  activeHandle(): MikeDownEditorHandle | null;
  /** Open (or activate) a document in a pane, default the focused one. */
  open(doc: DocumentModel, opts?: { paneId?: string; focus?: boolean }): void;
  closeTab(paneId: string, index: number): void;
  closeTabs(paneId: string, which: (doc: DocumentModel) => boolean): void;
  activate(paneId: string, index: number): void;
  cycle(delta: number): void;
  split(direction: 'row' | 'column', paneId?: string): void;
  /** Replace the layout (session restore). Tabs refer to documents already in the registry. */
  setLayout(layout: Layout, focusedPane: string): void;
  /** Live view state of a pane's active tab. */
  viewState(paneId: string): MikeDownViewState | undefined;
  /** Re-read a document's tab labels and the notice (dirty, lock, state). */
  refreshDoc(doc: DocumentModel): void;
  /** A document was re-keyed (Save As): tabs follow. */
  renameDoc(from: string, to: string): void;
  /** Re-apply `doc.sourceMode` / `readOnly` to the panes showing it. */
  applyMode(doc: DocumentModel): void;
  /** Index of the tab showing `doc` in a pane, or -1. */
  tabIndex(paneId: string, doc: DocumentModel): number;
  focusActiveEditor(): void;
}

const ICONS = {
  splitRight: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><rect x="1.75" y="2.5" width="12.5" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 2.5v11" stroke="currentColor" stroke-width="1.2"/></svg>',
  splitDown: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><rect x="1.75" y="2.5" width="12.5" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M1.75 8h12.5" stroke="currentColor" stroke-width="1.2"/></svg>',
  close: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  lock: '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
};

const DRAG_THRESHOLD_PX = 5;
/** Below this editor width the document sidebar narrows to its minimum. */
const NARROW_PANE_PX = 560;

function label(command: AppCommand, isMac: boolean): string {
  const row = SHORTCUTS.find((s) => s.command === command);
  return row ? `${row.label} (${formatAccelerator(row.accelerator, isMac)})` : command;
}

interface PaneView {
  id: string;
  el: HTMLElement;
  strip: HTMLElement;
  tabs: HTMLElement;
  actions: HTMLElement;
  notice: HTMLElement;
  noticeText: HTMLElement;
  noticeBtn: HTMLButtonElement;
  body: HTMLElement;
  editorEl: HTMLElement;
  handle: MikeDownEditorHandle;
  viewer: ImageViewer;
  stats: MikeDownStats | null;
  /** The document attached to the editor right now. */
  attached: DocumentModel | null;
  detach: (() => void) | null;
  docOff: Array<() => void>;
  /** Watches the editor's width for the narrow-pane sidebar rule (panes.css). */
  resize: ResizeObserver | null;
}

export function createPaneManager(deps: PaneManagerDeps): PaneManager {
  const el = document.createElement('div');
  el.className = 'mdapp-panes';
  deps.root.appendChild(el);

  const views = new Map<string, PaneView>();
  let layout: Layout = createPane<MikeDownViewState>();
  let focused = (layout as PaneNode<MikeDownViewState>).id;
  let structureKey = '';

  // ── Pane views ────────────────────────────────────────────────────────

  function createView(id: string): PaneView {
    const pane = document.createElement('section');
    pane.className = 'mdapp-pane';
    pane.dataset.paneId = id;
    pane.tabIndex = -1;
    pane.innerHTML = `
      <div class="mdapp-pane__strip">
        <div class="mdapp-pane__leading"></div>
        <div class="mdapp-tabs" role="tablist" aria-label="Open documents"></div>
        <div class="mdapp-pane__actions">
          <span class="mdapp-pane__trailing"></span>
          <button type="button" class="mdapp-iconbtn" data-action="split-right">${ICONS.splitRight}</button>
          <button type="button" class="mdapp-iconbtn" data-action="split-down">${ICONS.splitDown}</button>
        </div>
      </div>
      <div class="mdapp-notice mdapp-pane__notice" role="status" hidden>
        <span class="mdapp-notice__text"></span>
        <button type="button" class="mdapp-btn mdapp-btn--toolbar mdapp-notice__action" hidden></button>
      </div>
      <div class="mdapp-pane__body">
        <div class="mdapp-pane__editor"></div>
      </div>`;
    const q = <T extends HTMLElement>(sel: string): T => pane.querySelector(sel) as T;
    const editorEl = q<HTMLElement>('.mdapp-pane__editor');
    const body = q<HTMLElement>('.mdapp-pane__body');
    const splitRight = q<HTMLButtonElement>('[data-action="split-right"]');
    const splitDown = q<HTMLButtonElement>('[data-action="split-down"]');
    splitRight.title = label('splitRight', deps.isMac);
    splitRight.setAttribute('aria-label', 'Split Right');
    splitDown.title = label('splitDown', deps.isMac);
    splitDown.setAttribute('aria-label', 'Split Down');
    splitRight.addEventListener('click', () => split('row', id));
    splitDown.addEventListener('click', () => split('column', id));
    const trailing = deps.trailing?.(id);
    if (trailing) {q<HTMLElement>('.mdapp-pane__trailing').appendChild(trailing);}

    const handle = deps.createEditor(editorEl, id);
    const viewer = createImageViewer(body, editorEl);
    const view: PaneView = {
      id,
      el: pane,
      strip: q('.mdapp-pane__strip'),
      tabs: q('.mdapp-tabs'),
      actions: q('.mdapp-pane__actions'),
      notice: q('.mdapp-pane__notice'),
      noticeText: q('.mdapp-notice__text'),
      noticeBtn: q<HTMLButtonElement>('.mdapp-notice__action'),
      body,
      editorEl,
      handle,
      viewer,
      stats: null,
      attached: null,
      detach: null,
      docOff: [],
      resize: null,
    };
    // Core's document sidebar in a narrow pane: a slimmer column (panes.css).
    if (typeof ResizeObserver !== 'undefined') {
      view.resize = new ResizeObserver((entries) => {
        const width = entries[entries.length - 1]?.contentRect.width ?? 0;
        editorEl.classList.toggle('mdapp-pane__editor--narrow', width > 0 && width < NARROW_PANE_PX);
      });
      view.resize.observe(editorEl);
    }
    pane.addEventListener('pointerdown', () => setFocused(id), { capture: true });
    pane.addEventListener('focusin', () => { if (focused !== id) {setFocused(id);} });
    wireTabStrip(view);
    views.set(id, view);
    return view;
  }

  function destroyView(view: PaneView): void {
    view.resize?.disconnect();
    detachDoc(view);
    try { view.handle.destroy(); } catch (err) { console.warn('MikeDown: editor teardown failed', err); }
    view.el.remove();
    views.delete(view.id);
  }

  // ── Document binding ──────────────────────────────────────────────────

  function detachDoc(view: PaneView): void {
    if (!view.attached) {return;}
    const doc = view.attached;
    // Remember where the user was in this tab.
    if (doc.kind !== 'image') {
      try { layout = setTabViewState(layout, view.id, doc.id, view.handle.getViewState()); } catch { /* editor gone */ }
    }
    view.detach?.();
    view.detach = null;
    for (const off of view.docOff) {off();}
    view.docOff = [];
    view.attached = null;
  }

  function attachDoc(view: PaneView, doc: DocumentModel, viewState: MikeDownViewState | undefined): void {
    detachDoc(view);
    view.attached = doc;
    if (doc.kind === 'image' && doc.path) {
      view.viewer.show(doc.path, deps.assetUrl(doc.path), () => {
        const i = findPane(layout, view.id)?.tabs.findIndex((t) => t.docId === doc.id) ?? -1;
        if (i >= 0) {deps.requestClose(view.id, i);}
      });
    } else {
      view.viewer.hide();
      // Put the editor in the view the tab wants before loading, so a large
      // file bound for source mode is never parsed into the rich view (core
      // loads lazily in source mode). Emptying first keeps the switch cheap.
      const want = viewState ?? { sourceMode: doc.sourceMode, cursor: 0, scrollTop: 0 };
      if (view.handle.getViewState().sourceMode !== want.sourceMode) {
        view.handle.setMarkdown('', { pristine: true });
        view.handle.setViewState({ sourceMode: want.sourceMode });
      }
      view.detach = doc.attach(view.handle);
      view.handle.setViewState({ cursor: want.cursor, scrollTop: want.scrollTop });
    }
    view.docOff.push(doc.on('state', () => renderNotice(view)));
    renderNotice(view);
  }

  /** Make each pane's editor show its active tab. */
  function syncActiveDocs(): void {
    for (const pane of allPanes(layout)) {
      const view = views.get(pane.id);
      if (!view) {continue;}
      const tab = activeTab(pane);
      const doc = tab ? deps.registry.byId(tab.docId) ?? null : null;
      if (!doc) {
        if (view.attached) {detachDoc(view);}
        view.handle.setMarkdown('', { pristine: true });
        view.viewer.hide();
        renderNotice(view);
        continue;
      }
      if (view.attached === doc) {continue;}
      attachDoc(view, doc, tab?.viewState);
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  function structureOf(node: Layout): string {
    return node.kind === 'pane' ? node.id : `(${node.direction}:${node.children.map(structureOf).join(',')})`;
  }

  function renderTree(node: Layout, into: HTMLElement): void {
    if (node.kind === 'pane') {
      const view = views.get(node.id) ?? createView(node.id);
      into.appendChild(view.el);
      return;
    }
    const split = document.createElement('div');
    split.className = `mdapp-split mdapp-split--${node.direction}`;
    node.children.forEach((child, i) => {
      if (i > 0) {split.appendChild(createDivider(node, i));}
      const cell = document.createElement('div');
      cell.className = 'mdapp-split__cell';
      cell.style.flex = `${node.sizes[i] ?? 1} 1 0`;
      renderTree(child, cell);
      split.appendChild(cell);
    });
    into.appendChild(split);
  }

  function createDivider(split: SplitNode<MikeDownViewState>, index: number): HTMLElement {
    const divider = document.createElement('div');
    divider.className = 'mdapp-split__divider';
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-orientation', split.direction === 'row' ? 'vertical' : 'horizontal');
    divider.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const parent = divider.parentElement as HTMLElement;
      const cells = [...parent.querySelectorAll<HTMLElement>(':scope > .mdapp-split__cell')];
      const a = cells[index - 1];
      const b = cells[index];
      if (!a || !b) {return;}
      const horizontal = split.direction === 'row';
      const start = horizontal ? e.clientX : e.clientY;
      const sizeA = horizontal ? a.getBoundingClientRect().width : a.getBoundingClientRect().height;
      const sizeB = horizontal ? b.getBoundingClientRect().width : b.getBoundingClientRect().height;
      const total = sizeA + sizeB;
      const weights = [...split.sizes];
      const pair = weights[index - 1] + weights[index];
      document.body.classList.add('mdapp-resizing');
      const move = (ev: PointerEvent): void => {
        const delta = (horizontal ? ev.clientX : ev.clientY) - start;
        const fracA = Math.max(0.1, Math.min(0.9, (sizeA + delta) / total));
        weights[index - 1] = pair * fracA;
        weights[index] = pair * (1 - fracA);
        a.style.flex = `${weights[index - 1]} 1 0`;
        b.style.flex = `${weights[index]} 1 0`;
      };
      const up = (): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.classList.remove('mdapp-resizing');
        layout = resizeSplit(layout, split, weights);
        deps.onLayoutChanged();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    return divider;
  }

  function render(): void {
    const key = structureOf(layout);
    if (key !== structureKey) {
      structureKey = key;
      const keep = new Set(allPanes(layout).map((p) => p.id));
      for (const view of [...views.values()]) {
        if (!keep.has(view.id)) {destroyView(view);}
      }
      el.replaceChildren();
      renderTree(layout, el);
      placeLeading();
    }
    for (const pane of allPanes(layout)) {renderStrip(pane);}
    syncActiveDocs();
    const ids = allPanes(layout).map((p) => p.id);
    if (!ids.includes(focused)) {focused = ids[0];}
    for (const view of views.values()) {view.el.classList.toggle('mdapp-pane--focused', view.id === focused);}
    deps.onLayoutChanged();
  }

  /** The sidebar toggle lives in the first (top-left) pane's strip. */
  function placeLeading(): void {
    if (!deps.leading) {return;}
    const first = allPanes(layout)[0];
    const view = views.get(first.id);
    const slot = view?.el.querySelector('.mdapp-pane__leading');
    if (slot && deps.leading.parentElement !== slot) {slot.appendChild(deps.leading);}
  }

  function renderStrip(pane: PaneNode<MikeDownViewState>): void {
    const view = views.get(pane.id);
    if (!view) {return;}
    const existing = [...view.tabs.querySelectorAll<HTMLElement>('.mdapp-tab')];
    const next: HTMLElement[] = [];
    pane.tabs.forEach((tab, i) => {
      const doc = deps.registry.byId(tab.docId);
      if (!doc) {return;}
      let tabEl = existing.find((t) => t.dataset.docId === tab.docId);
      if (!tabEl) {tabEl = createTab(view, tab.docId);}
      updateTab(tabEl, doc, i === pane.active, i);
      next.push(tabEl);
    });
    for (const old of existing) {if (!next.includes(old)) {old.remove();}}
    next.forEach((t, i) => { if (view.tabs.children[i] !== t) {view.tabs.insertBefore(t, view.tabs.children[i] ?? null);} });
    view.el.classList.toggle('mdapp-pane--empty', pane.tabs.length === 0);
  }

  function createTab(view: PaneView, docId: string): HTMLElement {
    const tab = document.createElement('div');
    tab.className = 'mdapp-tab';
    tab.setAttribute('role', 'tab');
    tab.dataset.docId = docId;
    tab.innerHTML = `
      <span class="mdapp-tab__lock" hidden>${ICONS.lock}</span>
      <span class="mdapp-tab__name"></span>
      <span class="mdapp-tab__state" hidden></span>
      <span class="mdapp-tab__dot" hidden aria-label="Unsaved changes">●</span>
      <span class="mdapp-tab__close" aria-hidden="true">${ICONS.close}</span>`;
    // Not a button: a control inside role="tab" is a nested-interactive axe
    // violation. Keyboard users close with Cmd/Ctrl+W (and the tab context menu).
    const close = tab.querySelector('.mdapp-tab__close') as HTMLElement;
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = indexOfTab(view, tab);
      if (i >= 0) {deps.requestClose(view.id, i);}
    });
    close.addEventListener('pointerdown', (e) => e.stopPropagation());
    return tab;
  }

  function indexOfTab(view: PaneView, tab: HTMLElement): number {
    return [...view.tabs.querySelectorAll('.mdapp-tab')].indexOf(tab);
  }

  function updateTab(tab: HTMLElement, doc: DocumentModel, active: boolean, index: number): void {
    const name = tab.querySelector('.mdapp-tab__name') as HTMLElement;
    const dot = tab.querySelector('.mdapp-tab__dot') as HTMLElement;
    const lock = tab.querySelector('.mdapp-tab__lock') as HTMLElement;
    const state = tab.querySelector('.mdapp-tab__state') as HTMLElement;
    const close = tab.querySelector('.mdapp-tab__close') as HTMLElement;
    const title = fileName(doc);
    name.textContent = title;
    dot.hidden = !doc.dirty;
    lock.hidden = !doc.readOnly || doc.kind === 'image' || doc.state !== 'ready';
    lock.title = doc.readOnlyReason ?? 'Read-only';
    lock.setAttribute('aria-label', lock.title);
    tab.classList.toggle('mdapp-tab--dirty', doc.dirty);
    tab.classList.toggle('mdapp-tab--readonly', doc.readOnly && doc.kind !== 'image');
    tab.classList.toggle('mdapp-tab--active', active);
    tab.classList.toggle('mdapp-tab--loading', doc.state === 'loading');
    tab.classList.toggle('mdapp-tab--downloading', doc.state === 'downloading');
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    tab.tabIndex = active ? 0 : -1;
    tab.title = doc.path ?? 'Unsaved document';
    tab.setAttribute('aria-label', `${title}${doc.dirty ? ', unsaved changes' : ''}${doc.readOnly && doc.kind !== 'image' ? ', read-only' : ''}`);
    tab.dataset.index = String(index);
    close.title = `Close ${title}`;
    if (doc.state === 'downloading') {
      state.hidden = false;
      state.replaceChildren();
      // Text only: Retry is a button in the pane's info bar (a button inside a tab is nested-interactive).
      state.textContent = 'still downloading…';
    } else if (doc.state === 'loading') {
      state.hidden = false;
      state.textContent = 'loading…';
    } else {
      state.hidden = true;
      state.textContent = '';
    }
  }

  function renderNotice(view: PaneView): void {
    const doc = view.attached;
    const notice = doc?.notice ?? null;
    // The cloud-placeholder state (edge 10) has no notice of its own; its Retry lives here.
    const downloading = !notice && doc?.state === 'downloading' && doc.path ? doc : null;
    view.notice.hidden = !notice && !downloading;
    view.noticeText.textContent = notice?.text ?? (downloading ? 'This file is a cloud placeholder that has not finished downloading.' : '');
    const action = notice?.action ?? (downloading ? { label: 'Retry', run: () => deps.retry(downloading) } : null);
    view.noticeBtn.hidden = !action;
    view.noticeBtn.textContent = action?.label ?? '';
    view.noticeBtn.onclick = action ? () => action.run() : null;
  }

  // ── Tab strip interaction ─────────────────────────────────────────────

  function wireTabStrip(view: PaneView): void {
    const tabAt = (target: EventTarget | null): HTMLElement | null => (target as HTMLElement | null)?.closest?.('.mdapp-tab') as HTMLElement | null;

    view.tabs.addEventListener('click', (e) => {
      const tab = tabAt(e.target);
      if (!tab) {return;}
      activate(view.id, indexOfTab(view, tab));
    });
    // Middle click closes; preventDefault on mousedown stops autoscroll.
    view.tabs.addEventListener('mousedown', (e) => { if (e.button === 1) {e.preventDefault();} });
    view.tabs.addEventListener('auxclick', (e) => {
      if (e.button !== 1) {return;}
      const tab = tabAt(e.target);
      if (!tab) {return;}
      e.preventDefault();
      deps.requestClose(view.id, indexOfTab(view, tab));
    });
    view.tabs.addEventListener('dblclick', (e) => {
      if (!tabAt(e.target)) {deps.emptyStripDoubleClick?.();}
    });
    view.tabs.addEventListener('contextmenu', (e) => {
      const tab = tabAt(e.target);
      if (!tab) {return;}
      e.preventDefault();
      openTabMenu(view, indexOfTab(view, tab), e.clientX, e.clientY);
    });
    view.tabs.addEventListener('keydown', (e) => {
      const tab = tabAt(e.target);
      if (!tab) {return;}
      const pane = findPane(layout, view.id);
      if (!pane) {return;}
      const i = indexOfTab(view, tab);
      const n = pane.tabs.length;
      let next: number | null = null;
      switch (e.key) {
        case 'ArrowRight': next = (i + 1) % n; break;
        case 'ArrowLeft': next = (i - 1 + n) % n; break;
        case 'Home': next = 0; break;
        case 'End': next = n - 1; break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          activate(view.id, i);
          focusActiveEditor();
          return;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          deps.requestClose(view.id, i);
          return;
        case 'ContextMenu':
        case 'F10':
          if (e.key === 'F10' && !e.shiftKey) {return;}
          e.preventDefault();
          {
            const r = tab.getBoundingClientRect();
            openTabMenu(view, i, r.left + 12, r.bottom);
          }
          return;
        default:
          return;
      }
      e.preventDefault();
      activate(view.id, next);
      (view.tabs.children[next] as HTMLElement | undefined)?.focus();
    });

    // Pointer drag: reorder within the strip or move to another pane.
    view.tabs.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) {return;}
      const tab = tabAt(e.target);
      if (!tab) {return;}
      const from = indexOfTab(view, tab);
      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      let ghost: HTMLElement | null = null;
      let marker: HTMLElement | null = null;
      let target: { view: PaneView; index: number } | null = null;

      const place = (ev: PointerEvent): void => {
        const over = document.elementFromPoint(ev.clientX, ev.clientY);
        const stripEl = over?.closest('.mdapp-tabs') as HTMLElement | null;
        const paneEl = over?.closest('.mdapp-pane') as HTMLElement | null;
        const dest = stripEl ? [...views.values()].find((v) => v.tabs === stripEl) : paneEl ? views.get(paneEl.dataset.paneId ?? '') : undefined;
        marker?.remove();
        marker = null;
        if (!dest) { target = null; return; }
        const tabs = [...dest.tabs.querySelectorAll<HTMLElement>('.mdapp-tab')];
        let index = tabs.length;
        for (let i = 0; i < tabs.length; i++) {
          const r = tabs[i].getBoundingClientRect();
          if (ev.clientX < r.left + r.width / 2) { index = i; break; }
        }
        target = { view: dest, index };
        marker = document.createElement('div');
        marker.className = 'mdapp-tab__marker';
        const anchor = tabs[index];
        if (anchor) {dest.tabs.insertBefore(marker, anchor);}
        else {dest.tabs.appendChild(marker);}
      };
      const move = (ev: PointerEvent): void => {
        if (!dragging) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) {return;}
          dragging = true;
          ghost = tab.cloneNode(true) as HTMLElement;
          ghost.className = 'mdapp-tab mdapp-tab--ghost';
          document.body.appendChild(ghost);
          document.body.classList.add('mdapp-dragging');
        }
        if (ghost) {
          ghost.style.left = `${ev.clientX + 8}px`;
          ghost.style.top = `${ev.clientY + 8}px`;
        }
        place(ev);
      };
      const up = (): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        marker?.remove();
        ghost?.remove();
        document.body.classList.remove('mdapp-dragging');
        if (!dragging || !target) {return;}
        if (target.view === view) {
          layout = moveTab(layout, view.id, from, target.index);
        } else {
          layout = moveTabToPane(layout, view.id, from, target.view.id, target.index);
          focused = target.view.id;
        }
        render();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  function openTabMenu(view: PaneView, index: number, x: number, y: number): void {
    const pane = findPane(layout, view.id);
    const tab = pane?.tabs[index];
    const doc = tab ? deps.registry.byId(tab.docId) : undefined;
    if (!pane || !doc) {return;}
    const others = pane.tabs.length > 1;
    const saved = pane.tabs.some((t) => !(deps.registry.byId(t.docId)?.dirty ?? false));
    deps.showContextMenu(x, y, [
      { label: 'Close', hint: formatAccelerator('CmdOrCtrl+W', deps.isMac), run: () => deps.requestClose(view.id, index) },
      { label: 'Close Others', disabled: !others, run: () => deps.requestCloseOthers(view.id, index) },
      { label: 'Close Saved', disabled: !saved, run: () => deps.requestCloseSaved(view.id) },
      { label: 'Close All', run: () => deps.requestCloseAll(view.id) },
      null,
      { label: 'Split Right', hint: formatAccelerator('CmdOrCtrl+\\', deps.isMac), run: () => split('row', view.id) },
      { label: 'Split Down', hint: formatAccelerator('CmdOrCtrl+Shift+\\', deps.isMac), run: () => split('column', view.id) },
      null,
      ...deps.tabContextEntries(doc),
    ], fileName(doc));
  }

  // ── Operations ────────────────────────────────────────────────────────

  function setFocused(paneId: string, opts?: { focusEditor?: boolean }): void {
    if (!views.has(paneId)) {return;}
    const changed = focused !== paneId;
    focused = paneId;
    for (const view of views.values()) {view.el.classList.toggle('mdapp-pane--focused', view.id === focused);}
    if (opts?.focusEditor) {focusActiveEditor();}
    if (changed) {deps.onFocusChanged(paneId);}
  }

  function focusActiveEditor(): void {
    const view = views.get(focused);
    if (!view) {return;}
    if (view.attached?.kind === 'image') {(view.el.querySelector('[data-action="back"]') as HTMLElement | null)?.focus(); return;}
    if (!view.attached) {view.el.focus(); return;}
    view.handle.focus();
  }

  function activate(paneId: string, index: number): void {
    layout = activateTab(layout, paneId, index);
    focused = paneId;
    render();
    deps.onFocusChanged(paneId);
  }

  function split(direction: 'row' | 'column', paneId = focused): void {
    const source = views.get(paneId);
    if (source?.attached && source.attached.kind !== 'image') {
      // The new pane starts where this one is.
      layout = setTabViewState(layout, paneId, source.attached.id, source.handle.getViewState());
    }
    layout = layoutSplitPane(layout, paneId, direction);
    const fresh = allPanes(layout).find((p) => !views.has(p.id));
    render();
    if (fresh) {setFocused(fresh.id, { focusEditor: true });}
  }

  const manager: PaneManager = {
    el,
    layout: () => layout,
    focusedPaneId: () => focused,
    focusedPane: () => findPane(layout, focused) ?? allPanes(layout)[0],
    setFocused,
    editor: (paneId) => {
      const v = views.get(paneId);
      return v ? { handle: v.handle, stats: v.stats } : null;
    },
    editors: () => [...views.values()].map((v) => ({ handle: v.handle, stats: v.stats })),
    noteStats(paneId, stats) {
      const view = views.get(paneId);
      if (view) {view.stats = { ...view.stats, ...stats };}
    },
    activeDoc: (paneId = focused) => views.get(paneId)?.attached ?? null,
    activeHandle: () => views.get(focused)?.handle ?? null,
    open(doc, opts) {
      const paneId = opts?.paneId ?? focused;
      layout = layoutOpenTab(layout, paneId, doc.id);
      focused = paneId;
      render();
      deps.onFocusChanged(paneId);
      if (opts?.focus !== false) {focusActiveEditor();}
    },
    closeTab(paneId, index) {
      const pane = findPane(layout, paneId);
      const tab = pane?.tabs[index];
      layout = layoutCloseTab(layout, paneId, index);
      render();
      if (tab && tabsShowing(layout, tab.docId).length === 0) {
        const doc = deps.registry.byId(tab.docId);
        if (doc) {deps.registry.close(doc);}
      }
      focusActiveEditor();
    },
    closeTabs(paneId, which) {
      const pane = findPane(layout, paneId);
      if (!pane) {return;}
      const closing = pane.tabs.filter((t) => { const d = deps.registry.byId(t.docId); return !!d && which(d); }).map((t) => t.docId);
      layout = layoutCloseTabs(layout, paneId, (t) => closing.includes(t.docId));
      render();
      for (const id of closing) {
        if (tabsShowing(layout, id).length === 0) {
          const doc = deps.registry.byId(id);
          if (doc) {deps.registry.close(doc);}
        }
      }
      focusActiveEditor();
    },
    activate,
    cycle(delta) {
      layout = cycleTab(layout, focused, delta);
      render();
      focusActiveEditor();
    },
    split,
    setLayout(next, focusedPane) {
      for (const view of views.values()) {detachDoc(view);}
      layout = next;
      focused = focusedPane;
      structureKey = '';
      render();
      deps.onFocusChanged(focused);
    },
    viewState(paneId) {
      const view = views.get(paneId);
      if (!view?.attached || view.attached.kind === 'image') {return undefined;}
      try { return view.handle.getViewState(); } catch { return undefined; }
    },
    refreshDoc(doc) {
      for (const { paneId } of tabsShowing(layout, doc.id)) {
        const pane = findPane(layout, paneId);
        if (pane) {renderStrip(pane);}
      }
      for (const view of views.values()) {if (view.attached === doc) {renderNotice(view);}}
    },
    renameDoc(from, to) {
      layout = layoutRenameDoc(layout, from, to);
      render();
    },
    applyMode(doc) {
      for (const view of views.values()) {
        if (view.attached !== doc || doc.kind === 'image') {continue;}
        view.handle.setReadOnly(doc.readOnly);
        if (view.handle.getViewState().sourceMode !== doc.sourceMode) {view.handle.setViewState({ sourceMode: doc.sourceMode });}
        renderNotice(view);
      }
    },
    tabIndex(paneId, doc) {
      return findPane(layout, paneId)?.tabs.findIndex((t) => t.docId === doc.id) ?? -1;
    },
    focusActiveEditor,
  };

  // Keep the empty pane's editor sane and the registry informed.
  deps.registry.onChange((doc, event) => {
    if (event === 'closed') {
      const showing = tabsShowing(layout, doc.id);
      if (showing.length) {
        layout = layoutCloseTabs(layout, showing[0].paneId, (t) => t.docId === doc.id);
        for (const s of showing.slice(1)) {layout = layoutCloseTabs(layout, s.paneId, (t) => t.docId === doc.id);}
        render();
      }
      return;
    }
    if (event === 'dirty' || event === 'path' || event === 'state') {manager.refreshDoc(doc);}
  });

  render();
  return manager;
}
