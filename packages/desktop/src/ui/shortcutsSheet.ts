/**
 * Help > Keyboard Shortcuts: every chord in the command table, grouped by
 * menu, formatted for the platform (`⌘S` / `Ctrl+S`). Read-only; the keymap
 * is fixed in v1 (edge case 23).
 */
import { buildMenuSpec, type MenuNode } from '../menu/menuSpec';
import { formatAccelerator, rowsFor } from '../menu/shortcuts';

export interface ShortcutGroup {
  title: string;
  rows: Array<{ label: string; keys: string }>;
}

/** Groups in menu order; a command with a second chord (Ctrl+PageDown) lists both. */
export function shortcutGroups(isMac: boolean): ShortcutGroup[] {
  const rows = rowsFor(isMac);
  const groups: ShortcutGroup[] = [];
  const seen = new Set<string>();
  const collect = (nodes: MenuNode[], into: ShortcutGroup): void => {
    for (const n of nodes) {
      if (n.kind === 'submenu') {collect(n.items, into);}
      if (n.kind !== 'item' || seen.has(n.id)) {continue;}
      const chords = rows.filter((r) => r.command === n.id && r.accelerator).map((r) => formatAccelerator(r.accelerator!, isMac));
      if (!chords.length) {continue;}
      seen.add(n.id);
      into.rows.push({ label: n.label.replace(/…$/, ''), keys: [...new Set(chords)].join('  or  ') });
    }
  };
  for (const menu of buildMenuSpec(isMac)) {
    if (menu.kind !== 'submenu') {continue;}
    const group: ShortcutGroup = { title: menu.label === 'MikeDown' ? 'App' : menu.label, rows: [] };
    collect(menu.items, group);
    if (group.rows.length) {groups.push(group);}
  }
  return groups;
}

export function showShortcutsSheet(isMac: boolean, root: HTMLElement = document.body): void {
  document.querySelector('.mdapp-modal-backdrop--shortcuts')?.remove();
  const previous = document.activeElement as HTMLElement | null;
  const backdrop = document.createElement('div');
  backdrop.className = 'mdapp-modal-backdrop mdapp-modal-backdrop--shortcuts';
  const modal = document.createElement('div');
  modal.className = 'mdapp-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Keyboard Shortcuts');
  const title = document.createElement('p');
  title.className = 'mdapp-modal__message';
  title.textContent = 'Keyboard Shortcuts';
  const body = document.createElement('div');
  body.className = 'mdapp-shortcuts';
  body.tabIndex = 0;
  for (const g of shortcutGroups(isMac)) {
    const h = document.createElement('h3');
    h.textContent = g.title;
    const table = document.createElement('table');
    for (const r of g.rows) {
      const tr = table.insertRow();
      tr.insertCell().textContent = r.label;
      tr.insertCell().textContent = r.keys;
    }
    body.append(h, table);
  }
  const actions = document.createElement('div');
  actions.className = 'mdapp-modal__actions';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'mdapp-btn mdapp-btn--primary';
  close.textContent = 'Close';
  actions.appendChild(close);
  modal.append(title, body, actions);
  backdrop.appendChild(modal);
  const finish = (): void => {
    backdrop.remove();
    previous?.focus?.();
  };
  close.addEventListener('click', finish);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) {finish();} });
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(); }
  });
  root.appendChild(backdrop);
  close.focus();
}
