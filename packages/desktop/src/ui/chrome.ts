/**
 * App chrome around the panes: the sidebar toggle that sits at the start of
 * the first pane's tab strip, the Open Containing Folder action each pane
 * strip can show (edge case 4), and the status footer with word count. The
 * tab strips themselves are the pane manager's (M4).
 */
import type { MikeDownStats } from '@mikedown/core';
import { countWords, readingMinutes } from '@mikedown/core/shared/wordCount';
import { formatAccelerator, SHORTCUTS } from '../menu/shortcuts';

export interface Chrome {
  /** The sidebar toggle button; the pane manager places it in the first strip. */
  readonly sidebarToggle: HTMLElement;
  /** Build an Open Containing Folder button for a pane strip. */
  folderButton(): HTMLButtonElement;
  setStats(stats: MikeDownStats): void;
  onOpenContainingFolder(fn: () => void): void;
  onToggleSidebar(fn: () => void): void;
  setSidebarVisible(visible: boolean): void;
  /** Hide Open Containing Folder when the document already lives in the open folder (or there is none). */
  setFolderButtonVisible(visible: boolean): void;
}

export function createChrome(root: HTMLElement, opts: { isMac: boolean }): Chrome {
  const status = document.createElement('footer');
  status.className = 'mdapp-status';
  status.innerHTML = `<span class="mdapp-status__words"></span><span class="mdapp-status__sel"></span>`;
  root.appendChild(status);
  const words = status.querySelector('.mdapp-status__words') as HTMLSpanElement;
  const sel = status.querySelector('.mdapp-status__sel') as HTMLSpanElement;

  const sidebarBtn = document.createElement('button');
  sidebarBtn.type = 'button';
  sidebarBtn.className = 'mdapp-iconbtn mdapp-top__sidebar';
  sidebarBtn.dataset.action = 'toggle-sidebar';
  sidebarBtn.setAttribute('aria-pressed', 'false');
  sidebarBtn.innerHTML = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false"><rect x="1.75" y="2.5" width="12.5" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6 2.5v11" stroke="currentColor" stroke-width="1.2"/></svg>';
  const sidebarRow = SHORTCUTS.find((s) => s.command === 'toggleSidebar');
  const sidebarLabel = sidebarRow?.label ?? 'Toggle Folder Sidebar';
  sidebarBtn.setAttribute('aria-label', sidebarLabel);
  sidebarBtn.title = sidebarRow ? `${sidebarLabel} (${formatAccelerator(sidebarRow.accelerator, opts.isMac)})` : sidebarLabel;
  let sidebarHandler: (() => void) | null = null;
  sidebarBtn.addEventListener('click', () => sidebarHandler?.());

  const folderRow = SHORTCUTS.find((s) => s.command === 'openContainingFolder');
  const folderLabel = folderRow?.label ?? 'Open Containing Folder';
  let folderHandler: (() => void) | null = null;
  const folderButtons = new Set<HTMLButtonElement>();
  let folderVisible = false;

  return {
    sidebarToggle: sidebarBtn,
    folderButton() {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mdapp-btn mdapp-btn--toolbar';
      btn.dataset.action = 'open-folder';
      btn.innerHTML = '<svg class="mdapp-btn__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M1.75 3.5h4.1l1.4 1.5h7a.75.75 0 0 1 .75.75v6.75a.75.75 0 0 1-.75.75H1.75a.75.75 0 0 1-.75-.75v-8.25a.75.75 0 0 1 .75-.75Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg><span class="mdapp-btn__label"></span>';
      (btn.querySelector('.mdapp-btn__label') as HTMLSpanElement).textContent = folderLabel;
      btn.setAttribute('aria-label', folderLabel);
      btn.title = folderRow ? `${folderRow.label} (${formatAccelerator(folderRow.accelerator, opts.isMac)})` : '';
      btn.hidden = !folderVisible;
      btn.addEventListener('click', () => folderHandler?.());
      folderButtons.add(btn);
      return btn;
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
      folderVisible = visible;
      for (const btn of folderButtons) {
        if (!btn.isConnected) { folderButtons.delete(btn); continue; }
        btn.hidden = !visible;
      }
    },
  };
}
