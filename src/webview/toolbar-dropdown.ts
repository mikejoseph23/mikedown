/**
 * Toolbar Dropdown — reusable popover menu anchored to toolbar buttons.
 *
 * Supports action items, separators, and mini-rows (horizontal icon strips).
 * Keyboard navigable, auto-positions, only one open at a time.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ToolbarDropdownItem {
  type: 'action';
  id: string;
  label: string;
  icon?: string;       // HTML string (SVG or span)
  isActive?: () => boolean;
  action: () => void;
}

export interface ToolbarDropdownSeparator {
  type: 'separator';
}

export interface ToolbarDropdownMiniRow {
  type: 'mini-row';
  items: Array<{
    id: string;
    icon: string;
    title: string;
    isActive?: () => boolean;
    action: () => void;
  }>;
}

export type ToolbarDropdownEntry = ToolbarDropdownItem | ToolbarDropdownSeparator | ToolbarDropdownMiniRow;

// ── Module state ─────────────────────────────────────────────────────────────

let dropdownEl: HTMLElement | null = null;
let onCloseCallback: (() => void) | null = null;
let focusedIndex = -1;
/** All focusable elements (action items + mini-row buttons) in DOM order */
let focusableEls: HTMLElement[] = [];

// ── Public API ───────────────────────────────────────────────────────────────

export function showToolbarDropdown(
  anchorEl: HTMLElement,
  items: ToolbarDropdownEntry[],
  onClose?: () => void,
): void {
  // Close any existing dropdown first
  hideToolbarDropdown();

  onCloseCallback = onClose ?? null;
  focusedIndex = -1;
  focusableEls = [];

  // Build DOM
  dropdownEl = document.createElement('div');
  dropdownEl.id = 'toolbar-dropdown';
  dropdownEl.setAttribute('role', 'menu');

  for (const entry of items) {
    switch (entry.type) {
      case 'action':
        dropdownEl.appendChild(buildActionItem(entry));
        break;
      case 'separator':
        dropdownEl.appendChild(buildSeparator());
        break;
      case 'mini-row':
        dropdownEl.appendChild(buildMiniRow(entry));
        break;
    }
  }

  document.body.appendChild(dropdownEl);

  // Position relative to anchor
  positionDropdown(dropdownEl, anchorEl);

  // Trigger open animation on next frame
  requestAnimationFrame(() => {
    dropdownEl?.classList.add('toolbar-dropdown-visible');
  });

  // Attach global listeners (delayed so the current click doesn't immediately close)
  requestAnimationFrame(() => {
    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('keydown', handleKeyDown, true);
  });
}

export function hideToolbarDropdown(): void {
  if (!dropdownEl) return;

  document.removeEventListener('mousedown', handleClickOutside, true);
  document.removeEventListener('keydown', handleKeyDown, true);

  dropdownEl.remove();
  dropdownEl = null;
  focusableEls = [];
  focusedIndex = -1;

  if (onCloseCallback) {
    const cb = onCloseCallback;
    onCloseCallback = null;
    cb();
  }
}

export function isToolbarDropdownOpen(): boolean {
  return dropdownEl !== null;
}

export function updateDropdownActiveStates(): void {
  if (!dropdownEl) return;

  // Update action items
  const actionItems = dropdownEl.querySelectorAll<HTMLElement>('.tdd-item[data-tdd-id]');
  actionItems.forEach((el) => {
    const getter = activeGetters.get(el);
    if (getter) {
      el.classList.toggle('tdd-active', getter());
    }
  });

  // Update mini-row buttons
  const miniButtons = dropdownEl.querySelectorAll<HTMLElement>('.tdd-mini-btn[data-tdd-id]');
  miniButtons.forEach((el) => {
    const getter = activeGetters.get(el);
    if (getter) {
      el.classList.toggle('tdd-active', getter());
    }
  });
}

// ── Active-state registry ────────────────────────────────────────────────────

/** Map from DOM element to its isActive() getter */
const activeGetters = new WeakMap<HTMLElement, () => boolean>();

// ── DOM builders ─────────────────────────────────────────────────────────────

function buildActionItem(item: ToolbarDropdownItem): HTMLElement {
  const el = document.createElement('div');
  el.className = 'tdd-item';
  el.setAttribute('role', 'menuitem');
  el.setAttribute('tabindex', '-1');
  el.dataset.tddId = item.id;

  // Active indicator dot
  const dot = document.createElement('span');
  dot.className = 'tdd-item-active-indicator';
  el.appendChild(dot);

  // Icon (optional)
  if (item.icon) {
    const iconWrap = document.createElement('span');
    iconWrap.className = 'tdd-item-icon';
    // Use a template element to safely parse the HTML string
    const tmpl = document.createElement('template');
    tmpl.innerHTML = item.icon.trim();
    iconWrap.appendChild(tmpl.content);
    el.appendChild(iconWrap);
  }

  // Label
  const label = document.createElement('span');
  label.className = 'tdd-item-label';
  label.textContent = item.label;
  el.appendChild(label);

  // Active state
  if (item.isActive) {
    activeGetters.set(el, item.isActive);
    if (item.isActive()) {
      el.classList.add('tdd-active');
    }
  }

  // Click handler
  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideToolbarDropdown();
    item.action();
  });

  // Hover moves focus indicator
  el.addEventListener('mouseenter', () => {
    setFocusedIndex(focusableEls.indexOf(el));
  });

  focusableEls.push(el);
  return el;
}

function buildSeparator(): HTMLElement {
  const sep = document.createElement('div');
  sep.className = 'tdd-separator';
  sep.setAttribute('role', 'separator');
  return sep;
}

function buildMiniRow(entry: ToolbarDropdownMiniRow): HTMLElement {
  const row = document.createElement('div');
  row.className = 'tdd-mini-row';
  row.setAttribute('role', 'group');

  for (const btn of entry.items) {
    const el = document.createElement('button');
    el.className = 'tdd-mini-btn';
    el.setAttribute('role', 'menuitem');
    el.setAttribute('tabindex', '-1');
    el.title = btn.title;
    el.dataset.tddId = btn.id;

    // Icon via template
    const tmpl = document.createElement('template');
    tmpl.innerHTML = btn.icon.trim();
    el.appendChild(tmpl.content);

    // Active state
    if (btn.isActive) {
      activeGetters.set(el, btn.isActive);
      if (btn.isActive()) {
        el.classList.add('tdd-active');
      }
    }

    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideToolbarDropdown();
      btn.action();
    });

    el.addEventListener('mouseenter', () => {
      setFocusedIndex(focusableEls.indexOf(el));
    });

    focusableEls.push(el);
    row.appendChild(el);
  }

  return row;
}

// ── Positioning ──────────────────────────────────────────────────────────────

function positionDropdown(menu: HTMLElement, anchor: HTMLElement): void {
  const anchorRect = anchor.getBoundingClientRect();
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  // We need a layout pass to measure the menu
  menu.style.visibility = 'hidden';
  menu.style.display = 'block';
  const menuRect = menu.getBoundingClientRect();
  menu.style.visibility = '';

  // Center horizontally relative to anchor, clamp to viewport
  let left = anchorRect.left + anchorRect.width / 2 - menuRect.width / 2;
  left = Math.max(4, Math.min(left, vw - menuRect.width - 4));

  // Prefer below the anchor, flip above if not enough room
  const gapBelow = vh - anchorRect.bottom;
  const gapAbove = anchorRect.top;
  let top: number;

  if (gapBelow >= menuRect.height + 4 || gapBelow >= gapAbove) {
    // Place below
    top = anchorRect.bottom + 4;
  } else {
    // Place above
    top = anchorRect.top - menuRect.height - 4;
  }

  top = Math.max(4, Math.min(top, vh - menuRect.height - 4));

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

// ── Keyboard navigation ──────────────────────────────────────────────────────

function setFocusedIndex(index: number): void {
  // Clear previous
  if (focusedIndex >= 0 && focusedIndex < focusableEls.length) {
    focusableEls[focusedIndex].classList.remove('tdd-focused');
  }

  focusedIndex = index;

  if (focusedIndex >= 0 && focusedIndex < focusableEls.length) {
    focusableEls[focusedIndex].classList.add('tdd-focused');
    focusableEls[focusedIndex].focus();
  }
}

function handleKeyDown(e: KeyboardEvent): void {
  if (!dropdownEl) return;

  switch (e.key) {
    case 'Escape':
    case 'Tab':
      e.preventDefault();
      e.stopPropagation();
      hideToolbarDropdown();
      break;

    case 'ArrowDown': {
      e.preventDefault();
      e.stopPropagation();
      const next = focusedIndex < focusableEls.length - 1 ? focusedIndex + 1 : 0;
      setFocusedIndex(next);
      break;
    }

    case 'ArrowUp': {
      e.preventDefault();
      e.stopPropagation();
      const prev = focusedIndex > 0 ? focusedIndex - 1 : focusableEls.length - 1;
      setFocusedIndex(prev);
      break;
    }

    case 'Enter':
    case ' ': {
      e.preventDefault();
      e.stopPropagation();
      if (focusedIndex >= 0 && focusedIndex < focusableEls.length) {
        const el = focusableEls[focusedIndex];
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }
      break;
    }
  }
}

// ── Click-outside ────────────────────────────────────────────────────────────

function handleClickOutside(e: MouseEvent): void {
  if (!dropdownEl) return;
  const target = e.target as Node;
  if (!dropdownEl.contains(target)) {
    hideToolbarDropdown();
  }
}
