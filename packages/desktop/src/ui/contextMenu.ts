/**
 * In-page context menu for the app chrome (tree, tab). Core has its own menu
 * for the editor; this one never touches `.mikedown-root`. ARIA `menu` /
 * `menuitem`, arrow keys, Home/End, Enter/Space, Escape, and a click outside
 * closes it. Focus returns to where it was.
 */

export interface MenuItem {
  label: string;
  /** Shown right-aligned, e.g. `⌫` or `F2`. */
  hint?: string;
  disabled?: boolean;
  run(): void;
}

/** `null` draws a separator. */
export type MenuEntry = MenuItem | null;

let open: { close(): void } | null = null;

export function closeContextMenu(): void {
  open?.close();
}

export function showContextMenu(x: number, y: number, entries: readonly MenuEntry[], opts: { label?: string } = {}): void {
  closeContextMenu();
  const previous = document.activeElement as HTMLElement | null;
  const menu = document.createElement('div');
  menu.className = 'mdapp-menu';
  menu.setAttribute('role', 'menu');
  if (opts.label) {menu.setAttribute('aria-label', opts.label);}
  menu.tabIndex = -1;

  const items: HTMLButtonElement[] = [];
  for (const entry of entries) {
    if (entry === null) {
      const sep = document.createElement('div');
      sep.className = 'mdapp-menu__sep';
      sep.setAttribute('role', 'separator');
      menu.appendChild(sep);
      continue;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mdapp-menu__item';
    btn.setAttribute('role', 'menuitem');
    btn.tabIndex = -1;
    btn.disabled = !!entry.disabled;
    if (entry.disabled) {btn.setAttribute('aria-disabled', 'true');}
    const label = document.createElement('span');
    label.textContent = entry.label;
    btn.appendChild(label);
    if (entry.hint) {
      const hint = document.createElement('span');
      hint.className = 'mdapp-menu__hint';
      hint.textContent = entry.hint;
      btn.appendChild(hint);
    }
    btn.addEventListener('click', () => {
      if (entry.disabled) {return;}
      close(false);
      entry.run();
    });
    menu.appendChild(btn);
    items.push(btn);
  }

  const enabled = (): HTMLButtonElement[] => items.filter((b) => !b.disabled);
  const focusAt = (i: number): void => {
    const list = enabled();
    if (list.length === 0) {return;}
    list[(i + list.length) % list.length].focus();
  };

  function onKey(e: KeyboardEvent): void {
    const list = enabled();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusAt(i + 1); break;
      case 'ArrowUp': e.preventDefault(); focusAt(i < 0 ? -1 : i - 1); break;
      case 'Home': e.preventDefault(); focusAt(0); break;
      case 'End': e.preventDefault(); focusAt(-1); break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); close(true); break;
      case 'Tab': e.preventDefault(); close(true); break;
      default: break;
    }
  }

  function onPointer(e: Event): void {
    if (!menu.contains(e.target as Node)) {close(false);}
  }

  function close(restoreFocus: boolean): void {
    if (!menu.isConnected) {return;}
    menu.remove();
    document.removeEventListener('mousedown', onPointer, true);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('resize', onBlur);
    open = null;
    if (restoreFocus) {previous?.focus?.();}
  }
  const onBlur = (): void => close(false);

  menu.addEventListener('keydown', onKey);
  menu.addEventListener('contextmenu', (e) => e.preventDefault());
  document.body.appendChild(menu);

  // Keep it on screen.
  const rect = menu.getBoundingClientRect();
  const left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4));
  const top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 4));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  document.addEventListener('mousedown', onPointer, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('resize', onBlur);
  open = { close: () => close(false) };
  focusAt(0);
}
