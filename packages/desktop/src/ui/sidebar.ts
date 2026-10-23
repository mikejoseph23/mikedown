/**
 * The folder sidebar's frame (M3): a header with the folder name and the
 * New File / New Folder / Show Hidden / Collapse buttons, the tree (or an
 * empty state in a lone-file window, edge case 4), and a resize handle.
 * Collapsible (`CmdOrCtrl+B`), resizable by mouse or arrow keys on the
 * handle, and the width is remembered per machine (browser storage until M5's
 * settings file; a missing or blocked store just means the default width).
 */

export interface SidebarActions {
  newFile(): void;
  newFolder(): void;
  toggleHidden(): void;
  openFolder(): void;
  /** Lone-file empty state: reopen on the document's folder. */
  openContainingFolder(): void;
  /** Collapse state changed (the tab strip's toggle mirrors it). */
  visibilityChanged(visible: boolean): void;
}

export interface Sidebar {
  readonly el: HTMLElement;
  setFolder(folder: { name: string; path: string } | null): void;
  setTreeEl(tree: HTMLElement): void;
  setShowHidden(on: boolean): void;
  /** Lone-file empty state: whether Open Containing Folder applies. */
  setCanOpenContaining(can: boolean): void;
  isVisible(): boolean;
  setVisible(visible: boolean): void;
  toggle(): void;
  width(): number;
}

export const SIDEBAR_MIN = 160;
export const SIDEBAR_MAX = 600;
export const SIDEBAR_DEFAULT = 260;
const WIDTH_KEY = 'mikedown.desktop.sidebarWidth';

export function clampSidebarWidth(px: number, windowWidth: number): number {
  const max = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, windowWidth - 320));
  return Math.round(Math.max(SIDEBAR_MIN, Math.min(max, px)));
}

function loadWidth(): number {
  try {
    const raw = window.localStorage.getItem(WIDTH_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : SIDEBAR_DEFAULT;
  } catch {
    return SIDEBAR_DEFAULT;
  }
}

function saveWidth(px: number): void {
  try { window.localStorage.setItem(WIDTH_KEY, String(px)); } catch { /* storage blocked */ }
}

const ICONS = {
  newFile: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M4 1.75h5l3 3v9.5H4z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 7.5v4M6 9.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  newFolder: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M1.75 3.5h4.1l1.4 1.5h7v7.5H1.75z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 7.25v3.5M6.25 9h3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  hidden: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M1.5 8s2.4-4.25 6.5-4.25S14.5 8 14.5 8s-2.4 4.25-6.5 4.25S1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="1.9" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  collapse: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><rect x="1.75" y="2.5" width="12.5" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6 2.5v11" stroke="currentColor" stroke-width="1.2"/></svg>',
};

export function createSidebar(actions: SidebarActions, opts: { newFileLabel: string; newFolderLabel: string; toggleLabel: string }): Sidebar {
  const el = document.createElement('aside');
  el.className = 'mdapp-sidebar';
  el.setAttribute('aria-label', 'Folder');
  el.innerHTML = `
    <div class="mdapp-sidebar__header">
      <span class="mdapp-sidebar__title"></span>
      <span class="mdapp-sidebar__actions">
        <button type="button" class="mdapp-iconbtn" data-action="new-file">${ICONS.newFile}</button>
        <button type="button" class="mdapp-iconbtn" data-action="new-folder">${ICONS.newFolder}</button>
        <button type="button" class="mdapp-iconbtn" data-action="hidden" aria-pressed="false">${ICONS.hidden}</button>
        <button type="button" class="mdapp-iconbtn" data-action="collapse">${ICONS.collapse}</button>
      </span>
    </div>
    <div class="mdapp-sidebar__body"></div>
    <div class="mdapp-sidebar__empty" hidden>
      <p>No folder is open. Open one to browse, create and organise its notes here.</p>
      <button type="button" class="mdapp-btn mdapp-btn--primary" data-action="open-folder">Open Folder…</button>
      <button type="button" class="mdapp-btn" data-action="open-containing">Open Containing Folder</button>
    </div>
    <div class="mdapp-sidebar__resizer" role="separator" aria-orientation="vertical" aria-label="Resize folder sidebar" tabindex="0"></div>`;

  const title = el.querySelector('.mdapp-sidebar__title') as HTMLElement;
  const body = el.querySelector('.mdapp-sidebar__body') as HTMLElement;
  const empty = el.querySelector('.mdapp-sidebar__empty') as HTMLElement;
  const headerActions = el.querySelector('.mdapp-sidebar__actions') as HTMLElement;
  const resizer = el.querySelector('.mdapp-sidebar__resizer') as HTMLElement;
  const btn = (name: string): HTMLButtonElement => el.querySelector(`[data-action="${name}"]`) as HTMLButtonElement;
  const labels: Record<string, string> = {
    'new-file': opts.newFileLabel,
    'new-folder': opts.newFolderLabel,
    hidden: 'Show Hidden Files',
    collapse: opts.toggleLabel,
  };
  for (const [name, label] of Object.entries(labels)) {
    btn(name).setAttribute('aria-label', label.replace(/ \(.*\)$/, ''));
    btn(name).title = label;
  }

  let visible = true;
  let width = clampSidebarWidth(loadWidth(), window.innerWidth);
  let hasFolder = false;

  function applyWidth(): void {
    el.style.width = `${width}px`;
    resizer.setAttribute('aria-valuenow', String(width));
    resizer.setAttribute('aria-valuemin', String(SIDEBAR_MIN));
    resizer.setAttribute('aria-valuemax', String(SIDEBAR_MAX));
  }
  applyWidth();

  btn('new-file').addEventListener('click', () => actions.newFile());
  btn('new-folder').addEventListener('click', () => actions.newFolder());
  btn('hidden').addEventListener('click', () => actions.toggleHidden());
  btn('collapse').addEventListener('click', () => setVisible(false));
  btn('open-folder').addEventListener('click', () => actions.openFolder());
  btn('open-containing').addEventListener('click', () => actions.openContainingFolder());

  // ── Resize ──────────────────────────────────────────────────────────────
  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    document.body.classList.add('mdapp-resizing');
    const move = (ev: MouseEvent): void => {
      width = clampSidebarWidth(startW + ev.clientX - startX, window.innerWidth);
      applyWidth();
    };
    const up = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('mdapp-resizing');
      saveWidth(width);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  resizer.addEventListener('dblclick', () => {
    width = SIDEBAR_DEFAULT;
    applyWidth();
    saveWidth(width);
  });
  resizer.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 40 : 10;
    if (e.key === 'ArrowLeft') {width = clampSidebarWidth(width - step, window.innerWidth);}
    else if (e.key === 'ArrowRight') {width = clampSidebarWidth(width + step, window.innerWidth);}
    else if (e.key === 'Home') {width = SIDEBAR_MIN;}
    else if (e.key === 'End') {width = clampSidebarWidth(SIDEBAR_MAX, window.innerWidth);}
    else {return;}
    e.preventDefault();
    applyWidth();
    saveWidth(width);
  });
  window.addEventListener('resize', () => {
    const w = clampSidebarWidth(width, window.innerWidth);
    if (w !== width) {
      width = w;
      applyWidth();
    }
  });

  function setVisible(v: boolean): void {
    if (v === visible) {return;}
    visible = v;
    el.hidden = !v;
    actions.visibilityChanged(v);
  }

  return {
    el,
    setFolder(folder) {
      hasFolder = !!folder;
      title.textContent = folder ? folder.name : 'No Folder';
      title.title = folder?.path ?? '';
      body.hidden = !folder;
      empty.hidden = !!folder;
      headerActions.hidden = !folder;
      // The collapse button stays reachable either way.
      if (!folder) {
        headerActions.hidden = false;
        for (const name of ['new-file', 'new-folder', 'hidden']) {btn(name).hidden = true;}
      } else {
        for (const name of ['new-file', 'new-folder', 'hidden']) {btn(name).hidden = false;}
      }
    },
    setTreeEl(tree) {
      body.replaceChildren(tree);
    },
    setShowHidden(on) {
      btn('hidden').setAttribute('aria-pressed', on ? 'true' : 'false');
      btn('hidden').classList.toggle('mdapp-iconbtn--on', on);
      btn('hidden').title = on ? 'Hide Hidden Files' : 'Show Hidden Files';
    },
    setCanOpenContaining(can) {
      btn('open-containing').hidden = !can || hasFolder;
    },
    isVisible: () => visible,
    setVisible,
    toggle: () => setVisible(!visible),
    width: () => width,
  };
}
