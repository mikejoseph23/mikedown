/**
 * App chrome around the editor for the lone-file window (edge case 4): a
 * one-tab strip (name, dirty dot, lock badge), the Open Containing Folder
 * action, a notice bar, and the status footer with word count. M3 adds the
 * sidebar toggle at the start of the strip, hides Open Containing Folder
 * while the file already sits in the open folder, and a tab context menu.
 * M4 turns the strip into real tabs.
 */
import type { MikeDownStats } from '@mikedown/core';
import { countWords, readingMinutes } from '@mikedown/core/shared/wordCount';
import { formatAccelerator, SHORTCUTS } from '../menu/shortcuts';

export interface TabState {
  name: string;
  dirty: boolean;
  readOnly: boolean;
  readOnlyReason: string | null;
  /** Shown as the tab tooltip. */
  path: string | null;
}

export interface Chrome {
  setTab(state: TabState): void;
  setStats(stats: MikeDownStats): void;
  setNotice(text: string | null): void;
  onOpenContainingFolder(fn: () => void): void;
  /** Sidebar toggle at the start of the strip. */
  onToggleSidebar(fn: () => void): void;
  setSidebarVisible(visible: boolean): void;
  /** Hide Open Containing Folder when the document already lives in the open folder. */
  setFolderButtonVisible(visible: boolean): void;
  /** Right-click (or the context-menu key) on the tab. */
  onTabContextMenu(fn: (x: number, y: number) => void): void;
}

export function createChrome(root: HTMLElement, editorEl: HTMLElement, opts: { isMac: boolean }): Chrome {
  const top = document.createElement('header');
  top.className = 'mdapp-top';
  top.innerHTML = `
    <button type="button" class="mdapp-iconbtn mdapp-top__sidebar" data-action="toggle-sidebar" aria-pressed="false">
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false"><rect x="1.75" y="2.5" width="12.5" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6 2.5v11" stroke="currentColor" stroke-width="1.2"/></svg>
    </button>
    <div class="mdapp-tabs" role="tablist">
      <div class="mdapp-tab" role="tab" aria-selected="true" tabindex="0">
        <span class="mdapp-tab__lock" hidden title="Read-only">🔒</span>
        <span class="mdapp-tab__name"></span>
        <span class="mdapp-tab__dot" hidden aria-label="Unsaved changes">●</span>
      </div>
    </div>
    <div class="mdapp-top__actions">
      <button type="button" class="mdapp-btn mdapp-btn--toolbar" data-action="open-folder">
        <svg class="mdapp-btn__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M1.75 3.5h4.1l1.4 1.5h7a.75.75 0 0 1 .75.75v6.75a.75.75 0 0 1-.75.75H1.75a.75.75 0 0 1-.75-.75v-8.25a.75.75 0 0 1 .75-.75Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
        <span class="mdapp-btn__label"></span>
      </button>
    </div>`;
  const notice = document.createElement('div');
  notice.className = 'mdapp-notice';
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  const status = document.createElement('footer');
  status.className = 'mdapp-status';
  status.innerHTML = `<span class="mdapp-status__words"></span><span class="mdapp-status__sel"></span>`;

  // The strip and the footer span the window; the notice sits right above
  // the editor (which may be nested in the main column beside the sidebar).
  root.insertBefore(top, root.firstChild);
  (editorEl.parentElement ?? root).insertBefore(notice, editorEl);
  root.appendChild(status);

  const tab = top.querySelector('.mdapp-tab') as HTMLDivElement;
  const name = top.querySelector('.mdapp-tab__name') as HTMLSpanElement;
  const dot = top.querySelector('.mdapp-tab__dot') as HTMLSpanElement;
  const lock = top.querySelector('.mdapp-tab__lock') as HTMLSpanElement;
  const folderBtn = top.querySelector('[data-action="open-folder"]') as HTMLButtonElement;
  const folderRow = SHORTCUTS.find((s) => s.command === 'openContainingFolder');
  const folderLabel = folderRow?.label ?? 'Open Containing Folder';
  (folderBtn.querySelector('.mdapp-btn__label') as HTMLSpanElement).textContent = folderLabel;
  folderBtn.setAttribute('aria-label', folderLabel);
  folderBtn.title = folderRow ? `${folderRow.label} (${formatAccelerator(folderRow.accelerator, opts.isMac)})` : '';
  const words = status.querySelector('.mdapp-status__words') as HTMLSpanElement;
  const sel = status.querySelector('.mdapp-status__sel') as HTMLSpanElement;

  let folderHandler: (() => void) | null = null;
  folderBtn.addEventListener('click', () => folderHandler?.());

  const sidebarBtn = top.querySelector('[data-action="toggle-sidebar"]') as HTMLButtonElement;
  const sidebarRow = SHORTCUTS.find((s) => s.command === 'toggleSidebar');
  const sidebarLabel = sidebarRow?.label ?? 'Toggle Folder Sidebar';
  sidebarBtn.setAttribute('aria-label', sidebarLabel);
  sidebarBtn.title = sidebarRow ? `${sidebarLabel} (${formatAccelerator(sidebarRow.accelerator, opts.isMac)})` : sidebarLabel;
  let sidebarHandler: (() => void) | null = null;
  sidebarBtn.addEventListener('click', () => sidebarHandler?.());

  let tabMenuHandler: ((x: number, y: number) => void) | null = null;
  tab.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    tabMenuHandler?.(e.clientX, e.clientY);
  });
  tab.addEventListener('keydown', (e) => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const r = tab.getBoundingClientRect();
      tabMenuHandler?.(r.left + 12, r.bottom);
    }
  });

  return {
    setTab(state) {
      name.textContent = state.name;
      dot.hidden = !state.dirty;
      lock.hidden = !state.readOnly;
      lock.title = state.readOnlyReason ?? 'Read-only';
      tab.classList.toggle('mdapp-tab--dirty', state.dirty);
      tab.classList.toggle('mdapp-tab--readonly', state.readOnly);
      tab.title = state.path ?? 'Unsaved document';
      folderBtn.disabled = !state.path;
    },
    setStats(stats) {
      if (typeof stats.document === 'string') {
        const n = countWords(stats.document);
        const minutes = readingMinutes(n);
        words.textContent = `${n.toLocaleString()} ${n === 1 ? 'word' : 'words'} · ${minutes} min read`;
      }
      if (stats.selection !== undefined) {
        sel.textContent = stats.selection
          ? `${stats.selection.words.toLocaleString()} selected`
          : '';
      }
    },
    setNotice(text) {
      notice.hidden = !text;
      notice.textContent = text ?? '';
    },
    onOpenContainingFolder(fn) {
      folderHandler = fn;
    },
    onToggleSidebar(fn) {
      sidebarHandler = fn;
    },
    setSidebarVisible(visible) {
      sidebarBtn.setAttribute('aria-pressed', visible ? 'true' : 'false');
      sidebarBtn.classList.toggle('mdapp-iconbtn--on', visible);
    },
    setFolderButtonVisible(visible) {
      folderBtn.hidden = !visible;
    },
    onTabContextMenu(fn) {
      tabMenuHandler = fn;
    },
  };
}
