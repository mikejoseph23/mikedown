/**
 * Toolbar edit mode (Customize Toolbar…): entry points, the edit-mode state,
 * the tray, Done, the Settings modal's discard confirm, deferred incoming
 * layouts, destroy while editing, pointer drag over faked geometry, and the
 * keyboard editor (roving focus, pick up / move / drop, remove, add, live
 * announcements, focus on entry and exit).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, DEFAULT_TOOLBAR_LAYOUT, NoopHost, TOOLBAR_ITEM_IDS, type MikeDownEditorHandle, type MikeDownHost } from '../src/index';
import { hideToolbarDropdown } from '../src/toolbar-dropdown';
import { hideContextMenu } from '../src/contextmenu';
import { TOOLBAR_EDIT_INSTRUCTIONS, toolbarDropSlot, toolbarGridNeighbor, type ToolbarSlotRect } from '../src/toolbar-customize';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';
import { fakeToolbarGeometry } from './toolbar-geometry';

stubLayoutMeasurement();

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

function mount(host: MikeDownHost = new NoopHost(), options: Record<string, unknown> = {}) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host, ...options });
  mounted.push({ handle, el });
  return { el, handle, toolbar: el.querySelector<HTMLElement>('.mikedown-toolbar')! };
}

afterEach(() => {
  hideToolbarDropdown();
  hideContextMenu();
  document.querySelectorAll('#mikedown-settings-overlay').forEach((n) => n.remove());
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const saving = () => {
  const saveSettings = vi.fn();
  return { host: { onChange() {}, saveSettings } as MikeDownHost, saveSettings };
};

/** The toolbar's direct children as ids, `|` and `~`. */
function order(toolbar: HTMLElement): string[] {
  return (Array.from(toolbar.children) as HTMLElement[]).map((c) => {
    if (c.classList.contains('toolbar-separator')) {return '|';}
    if (c.classList.contains('toolbar-spacer')) {return '~';}
    return c.dataset.action ?? '?';
  });
}

const tray = (el: HTMLElement) => el.querySelector<HTMLElement>('.mikedown-toolbar-tray');
const trayTokens = (el: HTMLElement) =>
  Array.from(tray(el)!.querySelectorAll<HTMLElement>('.toolbar-tray-item')).map((t) => t.dataset.token);
const trayButton = (el: HTMLElement, cls: 'toolbar-tray-done' | 'toolbar-tray-reset') =>
  tray(el)!.querySelector<HTMLButtonElement>(`.${cls}`)!;

/** Right-click the toolbar; returns the context menu's labels. */
function rightClick(toolbar: HTMLElement): { labels: string[]; event: MouseEvent } {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 10 });
  toolbar.dispatchEvent(event);
  const labels = Array.from(document.querySelectorAll('#mikedown-context-menu .cm-item-label')).map((n) => n.textContent ?? '');
  return { labels, event };
}

function enterViaContextMenu(toolbar: HTMLElement): void {
  rightClick(toolbar);
  const item = Array.from(document.querySelectorAll<HTMLElement>('#mikedown-context-menu .cm-item'))
    .find((n) => n.textContent?.includes('Customize Toolbar'))!;
  item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
}

/** Open More ⋯ and return its entries' labels. */
function moreLabels(toolbar: HTMLElement): string[] {
  toolbar.querySelector<HTMLButtonElement>('button[data-action="more"]')!.click();
  return Array.from(document.querySelectorAll('#toolbar-dropdown .tdd-item-label')).map((n) => n.textContent ?? '');
}

const custom = { version: 1, items: ['textFormat', 'listBlock', 'insert', '|', 'undo', 'redo', '|', 'settings', 'more'], seen: [...TOOLBAR_ITEM_IDS] };

describe('entry points', () => {
  it('right-click on the toolbar offers Customize Toolbar…', () => {
    const { toolbar } = mount();
    const { labels, event } = rightClick(toolbar);
    expect(labels).toEqual(['Customize Toolbar…']);
    expect(event.defaultPrevented).toBe(true);
  });

  it('More ⋯ ends with Customize Toolbar…', () => {
    const { toolbar } = mount();
    const labels = moreLabels(toolbar);
    expect(labels[labels.length - 1]).toBe('Customize Toolbar…');
  });

  it('More ⋯ entry enters edit mode', () => {
    const { el, toolbar } = mount();
    moreLabels(toolbar);
    const entry = Array.from(document.querySelectorAll<HTMLElement>('#toolbar-dropdown .tdd-item'))
      .find((n) => n.textContent?.includes('Customize Toolbar'))!;
    entry.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(toolbar.classList.contains('toolbar-editing')).toBe(true);
    expect(tray(el)).not.toBeNull();
  });

  it('none of them exist when features.customizeToolbar is false', () => {
    const { toolbar } = mount(new NoopHost(), { features: { customizeToolbar: false } });
    const { labels, event } = rightClick(toolbar);
    expect(labels).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(moreLabels(toolbar)).not.toContain('Customize Toolbar…');
  });
});

describe('edit mode state', () => {
  it('wraps, suspends overflow, shows More, relabels the toolbar and disables buttons', () => {
    const { el, toolbar } = mount();
    toolbar.querySelector('button[data-action="undo"]')!.classList.add('toolbar-overflowed');
    enterViaContextMenu(toolbar);
    expect(toolbar.classList.contains('toolbar-editing')).toBe(true);
    expect(toolbar.getAttribute('aria-label')).toBe('Customize toolbar');
    expect(toolbar.querySelectorAll('.toolbar-overflowed')).toHaveLength(0);
    expect(toolbar.querySelector<HTMLElement>('button[data-action="more"]')!.hidden).toBe(false);
    const buttons = Array.from(toolbar.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(5);
    // Movable items are toggle buttons (pick up / drop); fixed ones and the
    // buttons inside a group are aria-disabled.
    const stop = (b: HTMLButtonElement) => b.parentElement === toolbar;
    const fixed = (b: HTMLButtonElement) => b.classList.contains('toolbar-item-fixed');
    expect(buttons.filter((b) => !stop(b) || fixed(b)).every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(buttons.filter((b) => stop(b) && !fixed(b)).every((b) => b.getAttribute('aria-pressed') === 'false' && !b.hasAttribute('aria-disabled'))).toBe(true);
    expect(toolbar.querySelector('[data-action="textFormat"]')!.classList.contains('toolbar-item-fixed')).toBe(true);
    expect(toolbar.querySelector('[data-action="undo"]')!.classList.contains('toolbar-item-movable')).toBe(true);
    // The tray sits right after the toolbar, inside the root, outside the editor container.
    const root = el.querySelector<HTMLElement>('.mikedown-root')!;
    expect(toolbar.nextElementSibling).toBe(tray(el));
    expect(tray(el)!.parentElement).toBe(root);
    expect(root.querySelector('.mikedown-editor-container .mikedown-toolbar-tray')).toBeNull();
  });

  it('makes toolbar buttons inert', () => {
    const { toolbar } = mount();
    enterViaContextMenu(toolbar);
    toolbar.querySelector<HTMLButtonElement>('button[data-action="settings"]')!.click();
    expect(document.querySelector('#mikedown-settings-overlay')).toBeNull();
    toolbar.querySelector<HTMLButtonElement>('button[data-action="listBlock"]')!.click();
    expect(document.querySelector('#toolbar-dropdown')).toBeNull();
  });

  it('right-click while editing shows no menu', () => {
    const { toolbar } = mount();
    enterViaContextMenu(toolbar);
    hideContextMenu();
    expect(rightClick(toolbar).labels).toEqual([]);
  });

  it('Done restores normal mode', () => {
    const { el, toolbar } = mount();
    const before = order(toolbar);
    enterViaContextMenu(toolbar);
    trayButton(el, 'toolbar-tray-done').click();
    expect(toolbar.classList.contains('toolbar-editing')).toBe(false);
    expect(toolbar.getAttribute('aria-label')).toBe('Formatting toolbar');
    expect(tray(el)).toBeNull();
    expect(toolbar.querySelectorAll('[aria-disabled]')).toHaveLength(0);
    expect(toolbar.querySelectorAll('.toolbar-item-fixed, .toolbar-item-movable')).toHaveLength(0);
    expect(order(toolbar)).toEqual(before);
    // Buttons work again.
    toolbar.querySelector<HTMLButtonElement>('button[data-action="settings"]')!.click();
    expect(document.querySelector('#mikedown-settings-overlay')).not.toBeNull();
  });

  it('Escape is Done', () => {
    const { el, toolbar } = mount();
    enterViaContextMenu(toolbar);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(toolbar.classList.contains('toolbar-editing')).toBe(false);
    expect(tray(el)).toBeNull();
  });

  it('leaves the editor selection where it was', () => {
    const { toolbar, handle } = mount();
    handle.setMarkdown('Hello world\n');
    handle.setViewState({ cursor: 4 });
    const before = handle.getViewState().cursor;
    enterViaContextMenu(toolbar);
    toolbar.querySelector<HTMLButtonElement>('button[data-action="selectAll"]')!.click();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(handle.getViewState().cursor).toBe(before);
  });
});

describe('tray', () => {
  it('holds Separator and Flexible Space on the default layout', () => {
    const { el, toolbar } = mount();
    enterViaContextMenu(toolbar);
    expect(trayTokens(el)).toEqual(['|', '~']);
    expect(trayButton(el, 'toolbar-tray-reset').disabled).toBe(true);
    expect(tray(el)!.querySelector('.toolbar-tray-heading')!.textContent).toBe('Drag items onto the toolbar');
  });

  it('lists available items missing from the layout, in default order', () => {
    const { el, toolbar } = mount(new NoopHost(), { settings: { toolbarLayout: custom } });
    enterViaContextMenu(toolbar);
    // ai, headingNumbers and share are unavailable with this host and settings.
    expect(trayTokens(el)).toEqual(['link', 'emoji', 'sourceToggle', 'selectAll', 'zoom', 'themeToggle', '|', '~']);
    const labels = Array.from(tray(el)!.querySelectorAll('.toolbar-tray-label')).map((n) => n.textContent);
    expect(labels).toContain('Insert Emoji');
    expect(labels.slice(-2)).toEqual(['Separator', 'Flexible Space']);
    // Tiles show the item's icon, never a nested button.
    expect(tray(el)!.querySelector('.toolbar-tray-item[data-token="emoji"] svg')).not.toBeNull();
    expect(tray(el)!.querySelectorAll('.toolbar-tray-item button')).toHaveLength(0);
    expect(trayButton(el, 'toolbar-tray-reset').disabled).toBe(false);
  });
});

describe('Done', () => {
  it('saves nothing when nothing changed', () => {
    const { host, saveSettings } = saving();
    const { el, toolbar } = mount(host);
    enterViaContextMenu(toolbar);
    trayButton(el, 'toolbar-tray-done').click();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('saves null once after Reset to Default', () => {
    const { host, saveSettings } = saving();
    const { el, toolbar } = mount(host, { settings: { toolbarLayout: custom } });
    const baseline = order(mount().toolbar);
    enterViaContextMenu(toolbar);
    trayButton(el, 'toolbar-tray-reset').click();
    expect(order(toolbar)).toEqual(baseline);
    expect(trayTokens(el)).toEqual(['|', '~']);
    trayButton(el, 'toolbar-tray-done').click();
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSettings).toHaveBeenCalledWith({ toolbarLayout: null });
    expect(order(toolbar)).toEqual(baseline);
  });

  it('defers an incoming layout while editing and applies it after an unchanged Done (D8)', () => {
    const { el, toolbar, handle } = mount();
    const before = order(toolbar);
    enterViaContextMenu(toolbar);
    handle.updateSettings({ toolbarLayout: custom });
    expect(order(toolbar)).toEqual(before);
    trayButton(el, 'toolbar-tray-done').click();
    expect(order(toolbar)).toEqual(custom.items);
  });

  it('keeps the user layout over an incoming one after a changed Done (D8)', () => {
    const { host, saveSettings } = saving();
    const { el, toolbar, handle } = mount(host, { settings: { toolbarLayout: custom } });
    enterViaContextMenu(toolbar);
    trayButton(el, 'toolbar-tray-reset').click();
    const edited = order(toolbar);
    handle.updateSettings({ toolbarLayout: { ...custom, items: ['textFormat', 'undo', 'settings', 'more'] } });
    expect(order(toolbar)).toEqual(edited);
    trayButton(el, 'toolbar-tray-done').click();
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(order(toolbar)).toEqual(edited);
  });
});

describe('Settings modal Customize Toolbar…', () => {
  function openToolbarTab(handle: MikeDownEditorHandle): void {
    handle.command('openSettings');
    document.querySelector<HTMLElement>('.settings-tab[data-tab-id="toolbar"]')!.click();
  }
  const customizeBtn = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.settings-modal .settings-btn'))
    .find((b) => b.textContent === 'Customize Toolbar…')!;

  it('closes a clean modal and enters edit mode', () => {
    const { el, toolbar, handle } = mount();
    openToolbarTab(handle);
    customizeBtn().click();
    expect(document.querySelector('#mikedown-settings-overlay')).toBeNull();
    expect(toolbar.classList.contains('toolbar-editing')).toBe(true);
    expect(tray(el)).not.toBeNull();
  });

  it('asks before discarding unsaved changes: Keep Editing stays, Discard proceeds', () => {
    const { host, saveSettings } = saving();
    const { toolbar, handle } = mount(host);
    openToolbarTab(handle);
    const box = document.querySelector<HTMLInputElement>('.settings-modal input[type="checkbox"]')!;
    box.checked = !box.checked;
    customizeBtn().click();

    const confirm = document.querySelector<HTMLElement>('.settings-modal .settings-confirm')!;
    expect(confirm).not.toBeNull();
    expect(confirm.getAttribute('role')).toBe('alertdialog');
    expect(confirm.textContent).toContain('Discard unsaved changes?');
    const button = (label: string) => Array.from(confirm.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === label)!;

    button('Keep Editing').click();
    expect(document.querySelector('.settings-confirm')).toBeNull();
    expect(document.querySelector('#mikedown-settings-overlay')).not.toBeNull();
    expect(toolbar.classList.contains('toolbar-editing')).toBe(false);

    customizeBtn().click();
    const again = document.querySelector<HTMLElement>('.settings-modal .settings-confirm')!;
    Array.from(again.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Discard')!.click();
    expect(document.querySelector('#mikedown-settings-overlay')).toBeNull();
    expect(toolbar.classList.contains('toolbar-editing')).toBe(true);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('Escape in the confirm closes only the confirm', () => {
    const { handle } = mount();
    openToolbarTab(handle);
    const box = document.querySelector<HTMLInputElement>('.settings-modal input[type="checkbox"]')!;
    box.checked = !box.checked;
    customizeBtn().click();
    document.querySelector('.settings-confirm')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.settings-confirm')).toBeNull();
    expect(document.querySelector('#mikedown-settings-overlay')).not.toBeNull();
  });
});

describe('instances', () => {
  it('destroy() while editing removes the tray and its listeners', () => {
    const { el, toolbar, handle } = mount();
    enterViaContextMenu(toolbar);
    const trayEl = tray(el)!;
    handle.destroy();
    expect(trayEl.isConnected).toBe(false);
    expect(document.querySelector('.mikedown-toolbar-tray')).toBeNull();
    expect(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))).not.toThrow();
  });

  it('edit mode in one editor leaves another untouched', () => {
    const a = mount();
    const b = mount();
    enterViaContextMenu(a.toolbar);
    expect(a.toolbar.classList.contains('toolbar-editing')).toBe(true);
    expect(b.toolbar.classList.contains('toolbar-editing')).toBe(false);
    expect(tray(b.el)).toBeNull();
    expect(b.toolbar.querySelectorAll('[aria-disabled]')).toHaveLength(0);
  });
});

// ── Pointer drag over faked geometry ─────────────────────────────────────────

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON() {} }) as DOMRect;

/** Lay the toolbar out as one 30px-per-child row at y 0–40 and the tray at y 40–200. */
function fakeGeometry(el: HTMLElement, toolbar: HTMLElement): void {
  toolbar.getBoundingClientRect = () => rect(0, 0, 1000, 40);
  (Array.from(toolbar.children) as HTMLElement[]).forEach((child, i) => {
    child.getBoundingClientRect = () => rect(i * 30, 4, 30, 32);
  });
  tray(el)!.getBoundingClientRect = () => rect(0, 40, 1000, 160);
}

function pointer(type: string, target: EventTarget, x: number, y: number): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
}

describe('pointer drag', () => {
  it('drags a tray tile onto the toolbar', () => {
    const { host, saveSettings } = saving();
    const { el, toolbar } = mount(host);
    enterViaContextMenu(toolbar);
    fakeGeometry(el, toolbar);
    const tile = tray(el)!.querySelector<HTMLElement>('.toolbar-tray-item[data-token="~"]')!;
    pointer('pointerdown', tile, 10, 100);
    pointer('pointermove', tile, 12, 100); // under the 4px threshold: no drag yet
    expect(el.querySelector('.mikedown-toolbar-ghost')).toBeNull();
    pointer('pointermove', tile, 62, 20); // between child 1 and child 2
    expect(el.querySelector('.mikedown-toolbar-ghost')).not.toBeNull();
    expect(el.querySelector<HTMLElement>('.mikedown-toolbar-drop-line')!.hidden).toBe(false);
    pointer('pointerup', tile, 62, 20);
    expect(el.querySelector('.mikedown-toolbar-ghost')).toBeNull();
    expect(order(toolbar).slice(0, 3)).toEqual(['textFormat', 'listBlock', '~']);
    trayButton(el, 'toolbar-tray-done').click();
    expect(saveSettings).toHaveBeenCalledTimes(1);
    const saved = (saveSettings.mock.calls[0][0] as { toolbarLayout: { items: string[] } }).toolbarLayout;
    expect(saved.items.slice(0, 3)).toEqual(['textFormat', 'listBlock', '~']);
  });

  it('drags a toolbar item to the tray to remove it, and moves one along the toolbar', () => {
    const { el, toolbar } = mount();
    enterViaContextMenu(toolbar);
    fakeGeometry(el, toolbar);
    const emoji = toolbar.querySelector<HTMLElement>('button[data-action="emoji"]')!;
    pointer('pointerdown', emoji, 135, 20);
    pointer('pointermove', emoji, 135, 120);
    expect(tray(el)!.classList.contains('is-drop-target')).toBe(true);
    pointer('pointerup', emoji, 135, 120);
    expect(order(toolbar)).not.toContain('emoji');
    expect(trayTokens(el)).toEqual(['emoji', '|', '~']);

    fakeGeometry(el, toolbar);
    const undo = toolbar.querySelector<HTMLElement>('button[data-action="undo"]')!;
    const at = order(toolbar).indexOf('undo');
    pointer('pointerdown', undo, at * 30 + 15, 20);
    pointer('pointermove', undo, 32, 20); // just right of Text Format's midpoint
    pointer('pointerup', undo, 32, 20);
    expect(order(toolbar).slice(0, 2)).toEqual(['textFormat', 'undo']);
  });

  it('does not drag Text Format, Settings or More, and pointercancel drops nothing', () => {
    const { el, toolbar } = mount();
    enterViaContextMenu(toolbar);
    fakeGeometry(el, toolbar);
    const before = order(toolbar);
    const settings = toolbar.querySelector<HTMLElement>('button[data-action="settings"]')!;
    pointer('pointerdown', settings, 400, 20);
    pointer('pointermove', settings, 400, 120);
    expect(el.querySelector('.mikedown-toolbar-ghost')).toBeNull();
    pointer('pointerup', settings, 400, 120);
    expect(order(toolbar)).toEqual(before);

    const undo = toolbar.querySelector<HTMLElement>('button[data-action="undo"]')!;
    pointer('pointerdown', undo, 200, 20);
    pointer('pointermove', undo, 200, 120);
    pointer('pointercancel', undo, 200, 120);
    expect(el.querySelector('.mikedown-toolbar-ghost')).toBeNull();
    expect(order(toolbar)).toEqual(before);
  });
});

describe('toolbarDropSlot', () => {
  const row = (n: number, top = 0, start = 0): ToolbarSlotRect[] =>
    Array.from({ length: n }, (_, i) => ({ left: start + i * 30, right: start + i * 30 + 30, top, bottom: top + 30 }));

  it('picks the gap by item midpoints and clamps to the movable range', () => {
    const rects = row(5);
    expect(toolbarDropSlot(rects, 50, 10, 1, 4)!.slot).toBe(2);
    expect(toolbarDropSlot(rects, 40, 10, 1, 4)!.slot).toBe(1);
    expect(toolbarDropSlot(rects, 0, 10, 1, 4)!.slot).toBe(1); // never before the first item
    expect(toolbarDropSlot(rects, 999, 10, 1, 4)!.slot).toBe(4); // never after the last (More)
    expect(toolbarDropSlot(rects, 50, 10, 1, 4)!.x).toBe(60);
  });

  it('follows wrapped rows', () => {
    const rects = [...row(4, 0), ...row(3, 32)];
    const at = toolbarDropSlot(rects, 40, 45, 1, 6)!;
    expect(at.slot).toBe(5);
    expect(at.top).toBe(32);
    // Past the end of the first row: after its last item, line on that row.
    const end = toolbarDropSlot(rects, 500, 10, 1, 6)!;
    expect(end.slot).toBe(4);
    expect(end.top).toBe(0);
    expect(end.x).toBe(121);
  });

  it('returns null for an empty toolbar', () => {
    expect(toolbarDropSlot([], 0, 0, 0, 0)).toBeNull();
  });
});

// ── Keyboard (M5, D11) ──────────────────────────────────────────────────────

/** Press `key` on whatever has focus (keydown bubbles to the editor's handlers). */
function press(key: string): void {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}
function pressN(key: string, n: number): void { for (let i = 0; i < n; i++) {press(key);} }

/** What has focus, as a toolbar token, `tray:<token>`, or a description. */
function focused(toolbar: HTMLElement): string {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body) {return 'body';}
  if (a.parentElement === toolbar) {return order(toolbar)[Array.from(toolbar.children).indexOf(a)];}
  if (a.classList.contains('toolbar-tray-item')) {return `tray:${a.dataset.token}`;}
  return a.className || a.tagName;
}

const spoken = (el: HTMLElement) => (tray(el)?.querySelector('.toolbar-tray-status')?.textContent ?? '').trim();
const stops = (toolbar: HTMLElement) => (Array.from(toolbar.children) as HTMLElement[]).filter((c) => c.getAttribute('tabindex') === '0');
const savedItems = (saveSettings: ReturnType<typeof vi.fn>) =>
  (saveSettings.mock.calls[0][0] as { toolbarLayout: { items: string[] } | null }).toolbarLayout?.items;

/** Focus the toolbar item `token` with the arrow keys, from wherever focus is in the toolbar. */
function arrowTo(toolbar: HTMLElement, token: string): void {
  press('Home');
  pressN('ArrowRight', order(toolbar).indexOf(token));
  expect(focused(toolbar)).toBe(token);
}

function enterViaSettings(toolbar: HTMLElement, handle: MikeDownEditorHandle): void {
  handle.command('openSettings');
  document.querySelector<HTMLElement>('.settings-tab[data-tab-id="toolbar"]')!.click();
  Array.from(document.querySelectorAll<HTMLButtonElement>('.settings-modal .settings-btn'))
    .find((b) => b.textContent === 'Customize Toolbar…')!.click();
  expect(toolbar.classList.contains('toolbar-editing')).toBe(true);
}

describe('keyboard: focus', () => {
  it('focuses the first movable item on entry, with one tab stop in the toolbar and one in the tray', () => {
    const { el, toolbar } = mount();
    enterViaContextMenu(toolbar);
    expect(focused(toolbar)).toBe('listBlock');
    expect(stops(toolbar)).toEqual([toolbar.children[1]]);
    const tiles = Array.from(tray(el)!.querySelectorAll<HTMLElement>('.toolbar-tray-item'));
    expect(tiles.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1']);
  });

  it('arrow keys move along the toolbar, into the tray and back', () => {
    const { toolbar } = mount();
    enterViaContextMenu(toolbar);
    press('ArrowRight');
    expect(focused(toolbar)).toBe('link');
    expect(stops(toolbar)).toEqual([toolbar.children[2]]);
    press('ArrowLeft');
    press('ArrowLeft');
    expect(focused(toolbar)).toBe('textFormat');
    press('ArrowLeft'); // no wrap
    expect(focused(toolbar)).toBe('textFormat');
    press('End');
    expect(focused(toolbar)).toBe('more');
    press('ArrowRight'); // past the end of the toolbar: the tray
    expect(focused(toolbar)).toBe('tray:|');
    press('ArrowRight');
    expect(focused(toolbar)).toBe('tray:~');
    press('ArrowRight'); // no wrap
    expect(focused(toolbar)).toBe('tray:~');
    press('ArrowUp'); // one row of tiles: up goes back to the toolbar's stop
    expect(focused(toolbar)).toBe('more');
    press('ArrowDown'); // and down returns to the tray's stop
    expect(focused(toolbar)).toBe('tray:~');
    press('Home');
    press('ArrowLeft');
    expect(focused(toolbar)).toBe('more');
  });

  it('gives separators and spacers a name and a stop in edit mode, and restores everything on Done', () => {
    const layout = { version: 1, items: ['textFormat', 'undo', '~', 'redo', '|', 'link', 'settings', 'more'], seen: [...TOOLBAR_ITEM_IDS] };
    const { el, toolbar } = mount(new NoopHost(), { settings: { toolbarLayout: layout } });
    const sep = () => toolbar.querySelector<HTMLElement>('.toolbar-separator')!;
    const spacer = () => toolbar.querySelector<HTMLElement>('.toolbar-spacer')!;
    enterViaContextMenu(toolbar);
    expect(sep().getAttribute('role')).toBe('button');
    expect(sep().getAttribute('aria-label')).toBe('Separator');
    expect(spacer().getAttribute('aria-label')).toBe('Flexible Space');
    expect(spacer().hasAttribute('aria-hidden')).toBe(false);
    arrowTo(toolbar, '~');
    expect(document.activeElement).toBe(spacer());

    trayButton(el, 'toolbar-tray-done').click();
    expect(sep().getAttribute('role')).toBe('separator');
    expect(sep().hasAttribute('tabindex')).toBe(false);
    expect(sep().hasAttribute('aria-label')).toBe(false);
    expect(spacer().getAttribute('aria-hidden')).toBe('true');
    expect(spacer().hasAttribute('role')).toBe(false);
    const buttons = Array.from(toolbar.querySelectorAll('button'));
    expect(buttons.every((b) => b.getAttribute('tabindex') === '0')).toBe(true);
    expect(toolbar.querySelectorAll('[aria-pressed], [aria-disabled], .toolbar-item-grabbed')).toHaveLength(0);
  });

  it('turns the Zoom group into one named stop, its buttons hidden, and back', () => {
    const { el, toolbar } = mount();
    const zoom = toolbar.querySelector<HTMLElement>('[data-action="zoom"]')!;
    enterViaContextMenu(toolbar);
    expect(zoom.getAttribute('role')).toBe('button');
    expect(zoom.getAttribute('aria-label')).toBe('Zoom');
    expect(Array.from(zoom.querySelectorAll('button')).every((b) => b.getAttribute('aria-hidden') === 'true' && b.getAttribute('tabindex') === '-1')).toBe(true);
    trayButton(el, 'toolbar-tray-done').click();
    expect(zoom.getAttribute('role')).toBe('group');
    expect(zoom.hasAttribute('tabindex')).toBe(false);
    expect(Array.from(zoom.querySelectorAll('button')).every((b) => !b.hasAttribute('aria-hidden') && b.getAttribute('tabindex') === '0')).toBe(true);
  });

  it('Done gives focus back to the first toolbar item when the opener is gone (Settings modal)', () => {
    const { toolbar, handle } = mount();
    enterViaSettings(toolbar, handle);
    expect(focused(toolbar)).toBe('listBlock');
    press('Escape');
    expect(toolbar.classList.contains('toolbar-editing')).toBe(false);
    expect(document.activeElement).toBe(toolbar.querySelector('button[data-action="textFormat"]'));
  });

  it('Done leaves focus alone when the user had moved into the document', () => {
    const { el, toolbar } = mount();
    enterViaContextMenu(toolbar);
    const pm = el.querySelector<HTMLElement>('.ProseMirror')!;
    pm.focus();
    trayButton(el, 'toolbar-tray-done').click();
    expect(document.activeElement).toBe(pm);
  });

  it('announces how the keyboard works once, shortly after entry', async () => {
    const { el, toolbar } = mount();
    enterViaContextMenu(toolbar);
    expect(spoken(el)).toBe('');
    await new Promise((r) => setTimeout(r, 200));
    expect(spoken(el)).toBe(TOOLBAR_EDIT_INSTRUCTIONS);
    expect(tray(el)!.querySelector('.toolbar-tray-status')!.getAttribute('aria-live')).toBe('polite');
  });
});

describe('keyboard: pick up, move, drop', () => {
  it('Space picks an item up, arrows move it a slot at a time, Enter drops it', () => {
    const { host, saveSettings } = saving();
    const { el, toolbar } = mount(host);
    enterViaContextMenu(toolbar);
    arrowTo(toolbar, 'undo');
    const undo = toolbar.querySelector<HTMLElement>('button[data-action="undo"]')!;
    const total = order(toolbar).length;

    press(' ');
    expect(undo.getAttribute('aria-pressed')).toBe('true');
    expect(undo.classList.contains('toolbar-item-grabbed')).toBe(true);
    expect(spoken(el)).toContain(`Picked up Undo, position 7 of ${total}.`);

    press('ArrowRight');
    expect(order(toolbar).slice(5, 9)).toEqual(['|', 'redo', 'undo', '|']);
    expect(spoken(el)).toBe(`Moved Undo to position 8 of ${total}.`);
    expect(document.activeElement).toBe(undo);
    expect(undo.getAttribute('aria-pressed')).toBe('true');

    press('ArrowRight');
    press('ArrowRight');
    expect(order(toolbar).slice(5, 11)).toEqual(['|', 'redo', '|', 'sourceToggle', 'undo', '|']);
    expect(spoken(el)).toBe(`Moved Undo to position 10 of ${total}.`);

    press('Enter');
    expect(undo.getAttribute('aria-pressed')).toBe('false');
    expect(undo.classList.contains('toolbar-item-grabbed')).toBe(false);
    expect(spoken(el)).toBe(`Dropped Undo at position 10 of ${total}.`);
    press('ArrowRight'); // dropped: arrows move focus again
    expect(focused(toolbar)).toBe('|');

    trayButton(el, 'toolbar-tray-done').click();
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(savedItems(saveSettings)).toEqual(['textFormat', 'listBlock', 'link', 'insert', 'emoji', 'headingNumbers', 'ai', '|', 'redo', '|', 'sourceToggle', 'undo', '|', 'share', 'selectAll', '|', 'zoom', '|', 'themeToggle', 'settings', 'more']);
  });

  it('Home and End move a picked-up item to the first and last movable slot', () => {
    const { el, toolbar } = mount();
    enterViaContextMenu(toolbar);
    arrowTo(toolbar, 'undo');
    press('Enter');
    press('Home');
    expect(order(toolbar).slice(0, 3)).toEqual(['textFormat', 'undo', 'listBlock']);
    press('End');
    expect(order(toolbar).slice(-3)).toEqual(['settings', 'undo', 'more']);
    press('ArrowRight');
    expect(spoken(el)).toBe('Undo is already last.');
    expect(order(toolbar).slice(-3)).toEqual(['settings', 'undo', 'more']);
  });

  it('Escape with an item picked up puts it back and stays in edit mode; the next Escape is Done', () => {
    const { host, saveSettings } = saving();
    const { el, toolbar } = mount(host);
    enterViaContextMenu(toolbar);
    const before = order(toolbar);
    arrowTo(toolbar, 'undo');
    press(' ');
    pressN('ArrowLeft', 3);
    expect(order(toolbar)).not.toEqual(before);
    press('Escape');
    expect(order(toolbar)).toEqual(before);
    expect(toolbar.classList.contains('toolbar-editing')).toBe(true);
    expect(focused(toolbar)).toBe('undo');
    expect(toolbar.querySelector('button[data-action="undo"]')!.getAttribute('aria-pressed')).toBe('false');
    expect(spoken(el)).toBe(`Move cancelled. Undo is back at position 7 of ${before.length}.`);
    press('Escape');
    expect(toolbar.classList.contains('toolbar-editing')).toBe(false);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('Tab away from a picked-up item drops it where it is', () => {
    const { el, toolbar } = mount();
    enterViaContextMenu(toolbar);
    arrowTo(toolbar, 'redo');
    press(' ');
    press('ArrowLeft');
    trayButton(el, 'toolbar-tray-done').focus(); // where Tab goes
    expect(toolbar.querySelector('.toolbar-item-grabbed')).toBeNull();
    expect(order(toolbar).slice(5, 8)).toEqual(['|', 'redo', 'undo']);
    expect(spoken(el)).toMatch(/^Dropped Redo at position 7 of/);
  });

  it('a separator skips over another separator instead of merging with it', () => {
    const layout = { version: 1, items: ['textFormat', 'undo', '|', 'redo', '|', 'link', 'settings', 'more'], seen: [...TOOLBAR_ITEM_IDS] };
    const { toolbar } = mount(new NoopHost(), { settings: { toolbarLayout: layout } });
    enterViaContextMenu(toolbar);
    press('Home');
    pressN('ArrowRight', 2);
    expect(focused(toolbar)).toBe('|');
    press(' ');
    press('ArrowRight');
    expect(order(toolbar)).toEqual(['textFormat', 'undo', 'redo', '|', 'link', '|', 'settings', 'more']);
  });

  it('Text Format, Settings and More are focusable but say they cannot be moved', () => {
    const { el, toolbar } = mount();
    enterViaContextMenu(toolbar);
    const before = order(toolbar);
    press('Home');
    expect(focused(toolbar)).toBe('textFormat');
    expect(toolbar.children[0].getAttribute('aria-disabled')).toBe('true');
    press(' ');
    expect(spoken(el)).toBe('Text Format cannot be moved.');
    expect(toolbar.querySelector('.toolbar-item-grabbed')).toBeNull();
    press('Delete');
    expect(spoken(el)).toBe('Text Format cannot be moved.');
    press('End');
    press('Backspace');
    expect(spoken(el)).toBe('More cannot be moved.');
    press('ArrowLeft');
    press('Enter');
    expect(spoken(el)).toBe('Settings cannot be moved.');
    expect(order(toolbar)).toEqual(before);
  });
});

describe('keyboard: remove and add', () => {
  it('Delete sends an item to the tray and focuses the item after it', () => {
    const { el, toolbar } = mount();
    enterViaContextMenu(toolbar);
    arrowTo(toolbar, 'emoji');
    press('Delete');
    expect(order(toolbar)).not.toContain('emoji');
    expect(trayTokens(el)).toEqual(['emoji', '|', '~']);
    expect(spoken(el)).toBe('Removed Insert Emoji.');
    expect(focused(toolbar)).toBe('|');
    press('Backspace'); // the separator goes too; focus moves on to Undo
    expect(focused(toolbar)).toBe('undo');
    expect(spoken(el)).toBe('Removed Separator.');
  });

  it('Enter on a tray tile adds it after the last focused toolbar item, and focus stays in the tray', () => {
    const { el, toolbar } = mount();
    enterViaContextMenu(toolbar);
    arrowTo(toolbar, 'link');
    press('ArrowDown');
    expect(focused(toolbar)).toBe('tray:|');
    press('Enter');
    expect(order(toolbar).slice(1, 5)).toEqual(['listBlock', 'link', '|', 'insert']);
    expect(spoken(el)).toBe(`Added Separator at position 4 of ${order(toolbar).length}.`);
    expect(focused(toolbar)).toBe('tray:|');
    press('ArrowRight');
    press(' '); // a second add goes after the first
    expect(order(toolbar).slice(1, 6)).toEqual(['listBlock', 'link', '|', '~', 'insert']);
    expect(focused(toolbar)).toBe('tray:~');
    // The toolbar's stop follows the last addition.
    press('ArrowUp');
    expect(focused(toolbar)).toBe('~');
  });

  it('says so instead of merging a separator into its neighbour', () => {
    const { el, toolbar } = mount();
    enterViaContextMenu(toolbar);
    const before = order(toolbar);
    arrowTo(toolbar, 'redo'); // followed by a separator
    press('ArrowDown');
    press('Enter');
    expect(order(toolbar)).toEqual(before);
    expect(spoken(el)).toBe('There is already a Separator there.');
  });

  it('a click on a tray tile adds it too, but not a keyboard-synthesized click', () => {
    const { el, toolbar } = mount();
    enterViaContextMenu(toolbar);
    arrowTo(toolbar, 'emoji');
    press('Delete');
    arrowTo(toolbar, 'redo');
    const emojiTile = tray(el)!.querySelector<HTMLElement>('.toolbar-tray-item[data-token="emoji"]')!;
    emojiTile.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(order(toolbar).slice(5, 8)).toEqual(['undo', 'redo', 'emoji']);
    expect(trayTokens(el)).toEqual(['|', '~']);
    // Enter/Space already add on keydown; the click a browser synthesizes after (detail 0) adds nothing.
    tray(el)!.querySelector<HTMLElement>('.toolbar-tray-item[data-token="~"]')!.click();
    expect(order(toolbar)).not.toContain('~');
  });

  it('the review flow: from Settings, move Undo three right, remove Emoji, add a Separator, Escape', () => {
    const { host, saveSettings } = saving();
    const { el, toolbar, handle } = mount(host);
    handle.setMarkdown('Hello world\n');
    handle.setViewState({ cursor: 4 });
    enterViaSettings(toolbar, handle);

    pressN('ArrowRight', 5);
    expect(focused(toolbar)).toBe('undo');
    press(' ');
    pressN('ArrowRight', 3);
    press(' ');
    press('Home');
    pressN('ArrowRight', 4);
    expect(focused(toolbar)).toBe('emoji');
    press('Delete');
    pressN('ArrowLeft', 2);
    expect(focused(toolbar)).toBe('link');
    press('ArrowDown');
    press('ArrowRight');
    expect(focused(toolbar)).toBe('tray:|');
    press('Enter');
    press('Escape');

    expect(toolbar.classList.contains('toolbar-editing')).toBe(false);
    expect(tray(el)).toBeNull();
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(savedItems(saveSettings)).toEqual(['textFormat', 'listBlock', 'link', '|', 'insert', 'headingNumbers', 'ai', '|', 'redo', '|', 'sourceToggle', 'undo', '|', 'share', 'selectAll', '|', 'zoom', '|', 'themeToggle', 'settings', 'more']);
    expect(el.querySelector('.ProseMirror')!.contains(document.activeElement)).toBe(false);
    expect(handle.getViewState().cursor).toBe(4);
  });
});

describe('toolbarGridNeighbor', () => {
  const tile = (left: number, top: number): ToolbarSlotRect => ({ left, right: left + 80, top, bottom: top + 60 });
  // Two rows: 0 1 2 / 3 4
  const rects = [tile(0, 0), tile(90, 0), tile(180, 0), tile(0, 70), tile(90, 70)];

  it('moves to the nearest tile in the row above or below', () => {
    expect(toolbarGridNeighbor(rects, 1, 'down')).toBe(4);
    expect(toolbarGridNeighbor(rects, 2, 'down')).toBe(4);
    expect(toolbarGridNeighbor(rects, 3, 'up')).toBe(0);
  });

  it('returns null past the first or last row', () => {
    expect(toolbarGridNeighbor(rects, 0, 'up')).toBeNull();
    expect(toolbarGridNeighbor(rects, 4, 'down')).toBeNull();
    expect(toolbarGridNeighbor([], 0, 'down')).toBeNull();
  });
});

// ── T2: gaps found against D7, D8, D9, D11 and D16 ───────────────────────────

const tick = (ms = 40) => new Promise<void>((r) => setTimeout(r, ms));
const savedLayout = (saveSettings: ReturnType<typeof vi.fn>, call = 0) =>
  (saveSettings.mock.calls[call][0] as { toolbarLayout: { version: number; items: string[]; seen: string[] } | null }).toolbarLayout;

describe('Done: what is saved (D7)', () => {
  it('saves the whole serialized layout exactly once, and a second Escape saves nothing more', () => {
    const { host, saveSettings } = saving();
    const { toolbar } = mount(host);
    enterViaContextMenu(toolbar);
    arrowTo(toolbar, 'undo');
    press(' ');
    press('ArrowRight');
    press('Enter');
    expect(saveSettings).not.toHaveBeenCalled(); // edits apply live, nothing is saved until Done
    press('Escape');
    expect(saveSettings).toHaveBeenCalledTimes(1);
    const layout = savedLayout(saveSettings)!;
    expect(layout.version).toBe(1);
    expect(layout.items.slice(7, 10)).toEqual(['|', 'redo', 'undo']);
    expect(layout.seen).toEqual(expect.arrayContaining([...TOOLBAR_ITEM_IDS]));
    press('Escape');
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  it('moving an item and putting it back is no change: nothing saved, and a deferred layout applies', () => {
    const { host, saveSettings } = saving();
    const { toolbar, handle } = mount(host);
    enterViaContextMenu(toolbar);
    arrowTo(toolbar, 'undo');
    press(' ');
    press('ArrowRight');
    press('ArrowLeft');
    press(' ');
    handle.updateSettings({ toolbarLayout: custom });
    press('Escape');
    expect(saveSettings).not.toHaveBeenCalled();
    expect(order(toolbar)).toEqual(custom.items);
  });

  it('saves null when keyboard edits end on the default layout', () => {
    const baseline = order(mount().toolbar);
    const withoutEmoji = { version: 1, items: DEFAULT_TOOLBAR_LAYOUT.items.filter((t) => t !== 'emoji'), seen: [...TOOLBAR_ITEM_IDS] };
    const { host, saveSettings } = saving();
    const { toolbar } = mount(host, { settings: { toolbarLayout: withoutEmoji } });
    enterViaContextMenu(toolbar);
    expect(order(toolbar)).not.toContain('emoji');
    arrowTo(toolbar, 'insert');
    press('ArrowDown');
    expect(focused(toolbar)).toBe('tray:emoji');
    press('Enter');
    expect(order(toolbar)).toEqual(baseline);
    press('Escape');
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSettings).toHaveBeenCalledWith({ toolbarLayout: null });
  });
});

describe('Deferred layouts while editing (D8)', () => {
  it('holds an incoming layout back: no re-render, the tray and working layout stay as they were', () => {
    const { el, toolbar, handle } = mount();
    enterViaContextMenu(toolbar);
    const before = order(toolbar);
    const tokens = trayTokens(el);
    handle.updateSettings({ toolbarLayout: custom });
    expect(order(toolbar)).toEqual(before);
    expect(trayTokens(el)).toEqual(tokens);
    expect(toolbar.classList.contains('toolbar-editing')).toBe(true);
  });

  it('applies a deferred null as the default layout after an unchanged Done', () => {
    const baseline = order(mount().toolbar);
    const { toolbar, handle } = mount(new NoopHost(), { settings: { toolbarLayout: custom } });
    enterViaContextMenu(toolbar);
    handle.updateSettings({ toolbarLayout: null });
    expect(order(toolbar)).toEqual(custom.items);
    press('Escape');
    expect(order(toolbar)).toEqual(baseline);
  });

  it('applies the last of several deferred layouts', () => {
    const second = { ...custom, items: ['textFormat', 'redo', 'settings', 'more'] };
    const { toolbar, handle } = mount();
    enterViaContextMenu(toolbar);
    handle.updateSettings({ toolbarLayout: custom });
    handle.updateSettings({ toolbarLayout: second });
    press('Escape');
    expect(order(toolbar)).toEqual(second.items);
  });

  it('drops a deferred layout once the user has changed something, for good', () => {
    const { host, saveSettings } = saving();
    const { toolbar, handle } = mount(host);
    enterViaContextMenu(toolbar);
    handle.updateSettings({ toolbarLayout: custom });
    arrowTo(toolbar, 'undo');
    press('Delete');
    press('Escape');
    const mine = order(toolbar);
    expect(mine).not.toContain('undo');
    expect(mine).not.toEqual(custom.items);
    expect(saveSettings).toHaveBeenCalledTimes(1);
    // A later, unchanged session must not bring the dropped layout back.
    enterViaContextMenu(toolbar);
    press('Escape');
    expect(order(toolbar)).toEqual(mine);
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  it('applies updates immediately again once editing is over', () => {
    const { toolbar, handle } = mount();
    enterViaContextMenu(toolbar);
    press('Escape');
    handle.updateSettings({ toolbarLayout: custom });
    expect(order(toolbar)).toEqual(custom.items);
  });
});

describe('Overflow while editing (D9)', () => {
  /** A narrow toolbar (some buttons overflow) with a captured ResizeObserver callback. */
  function narrow(extra: Record<string, unknown> = {}) {
    const width = { value: 120 };
    fakeToolbarGeometry(() => width.value);
    const callbacks: Array<() => void> = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(private cb: (entries: unknown[], observer: unknown) => void) {}
      // Everything that observes the toolbar (the editor's overflow, the tray's positioning) is fired.
      observe(target: Element) { if (target.classList.contains('mikedown-toolbar')) { callbacks.push(() => this.cb([], this)); } }
      unobserve() {}
      disconnect() {}
    });
    const m = mount(new NoopHost(), extra);
    const overflowed = () => m.toolbar.querySelectorAll('.toolbar-overflowed').length;
    const more = m.toolbar.querySelector<HTMLButtonElement>('button.toolbar-more')!;
    return { ...m, width, resize: () => callbacks.forEach((fire) => fire()), overflowed, more };
  }

  const enterViaMore = (more: HTMLElement) => {
    more.click();
    Array.from(document.querySelectorAll<HTMLElement>('#toolbar-dropdown .tdd-item'))
      .find((n) => n.textContent?.includes('Customize Toolbar'))!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  };

  it('clears every overflowed item on entry, ignores resizes while editing, and re-flows on Done', async () => {
    const { el, toolbar, width, resize, overflowed, more } = narrow();
    expect(overflowed()).toBeGreaterThan(0);
    expect(more.hidden).toBe(false);

    enterViaContextMenu(toolbar);
    expect(overflowed()).toBe(0);
    expect(more.hidden).toBe(false);

    width.value = 60;
    resize();
    await tick();
    expect(overflowed()).toBe(0);
    expect(toolbar.classList.contains('toolbar-editing')).toBe(true);

    trayButton(el, 'toolbar-tray-done').click();
    expect(overflowed()).toBeGreaterThan(0);
    expect(more.hidden).toBe(false);
    expect(toolbar.firstElementChild!.classList.contains('toolbar-overflowed')).toBe(false);
  });

  it('a resize after Done is handled again', async () => {
    const { toolbar, width, resize, overflowed } = narrow();
    enterViaContextMenu(toolbar);
    press('Escape');
    expect(overflowed()).toBeGreaterThan(0);
    width.value = 5000;
    resize();
    await tick();
    expect(overflowed()).toBe(0);
  });

  it('Done from the More ⋯ entry puts focus back on More while it is still shown', () => {
    const { toolbar, more } = narrow();
    enterViaMore(more);
    expect(toolbar.classList.contains('toolbar-editing')).toBe(true);
    press('Escape');
    expect(more.hidden).toBe(false);
    expect(document.activeElement).toBe(more);
  });

  it('falls back to the first toolbar button when More is hidden again after Done', () => {
    const { toolbar, more, width } = narrow();
    enterViaMore(more);
    width.value = 5000;
    press('Escape');
    expect(more.hidden).toBe(true);
    expect(document.activeElement).toBe(toolbar.querySelector('button[data-action="textFormat"]'));
  });
});

describe('keyboard: loose ends (D11)', () => {
  it('Delete on a picked-up item drops it and sends it to the tray', () => {
    const { el, toolbar } = mount();
    enterViaContextMenu(toolbar);
    arrowTo(toolbar, 'undo');
    press(' ');
    press('ArrowRight');
    press('Delete');
    expect(toolbar.querySelector('.toolbar-item-grabbed')).toBeNull();
    expect(order(toolbar)).not.toContain('undo');
    expect(trayTokens(el)).toEqual(['undo', '|', '~']);
    expect(spoken(el)).toBe('Removed Undo.');
  });

  it('adding while Settings was the last focused item lands before More', () => {
    const { toolbar } = mount();
    enterViaContextMenu(toolbar);
    arrowTo(toolbar, 'settings');
    press('ArrowDown');
    press('Enter');
    expect(order(toolbar).slice(-4)).toEqual(['themeToggle', 'settings', '|', 'more']);
  });

  it('Reset to Default moves focus to Done and announces it', () => {
    const { el, toolbar } = mount(new NoopHost(), { settings: { toolbarLayout: custom } });
    enterViaContextMenu(toolbar);
    trayButton(el, 'toolbar-tray-reset').focus();
    trayButton(el, 'toolbar-tray-reset').click();
    expect(document.activeElement).toBe(trayButton(el, 'toolbar-tray-done'));
    expect(spoken(el)).toBe('Toolbar reset to the default layout.');
  });

  it('a host setting that changes which items exist re-renders the edit mode without ending it', () => {
    const { el, toolbar, handle } = mount();
    enterViaContextMenu(toolbar);
    arrowTo(toolbar, 'undo');
    press(' ');
    handle.updateSettings({ headingNumbering: 'fromH2' } as never);
    expect(order(toolbar)).toContain('headingNumbers');
    expect(toolbar.classList.contains('toolbar-editing')).toBe(true);
    expect(tray(el)).not.toBeNull();
    press('Escape'); // the pick-up is cancelled first, edit mode stays
    expect(toolbar.classList.contains('toolbar-editing')).toBe(true);
  });
});

describe('two editors on one page (D16)', () => {
  /** Two editors whose hosts share one store; a save is broadcast to both, as VS Code does. */
  function pair(settings: Record<string, unknown> = {}) {
    const handles: MikeDownEditorHandle[] = [];
    const saves: unknown[] = [];
    const hostOf = (): MikeDownHost => ({
      onChange() {},
      saveSettings: (patch: { toolbarLayout?: unknown }) => {
        saves.push(patch.toolbarLayout);
        handles.forEach((h) => h.updateSettings({ toolbarLayout: patch.toolbarLayout } as never));
      },
    });
    const a = mount(hostOf(), { settings });
    const b = mount(hostOf(), { settings });
    handles.push(a.handle, b.handle);
    const broadcast = (value: unknown) => handles.forEach((h) => h.updateSettings({ toolbarLayout: value } as never));
    return { a, b, saves, broadcast };
  }

  it("keyboard edits in one leave the other's toolbar and tray alone until the host broadcasts Done", () => {
    const { a, b, saves } = pair();
    const untouched = order(b.toolbar);
    enterViaContextMenu(a.toolbar);
    arrowTo(a.toolbar, 'undo');
    press(' ');
    pressN('ArrowRight', 2);
    press(' ');
    expect(order(a.toolbar)).not.toEqual(untouched);
    expect(order(b.toolbar)).toEqual(untouched);
    expect(tray(b.el)).toBeNull();
    expect(saves).toHaveLength(0);

    press('Escape');
    expect(saves).toHaveLength(1);
    expect(order(b.toolbar)).toEqual(order(a.toolbar));
    expect(order(b.toolbar)).not.toEqual(untouched);
    expect(a.toolbar.classList.contains('toolbar-editing')).toBe(false);
  });

  it('a broadcast from elsewhere re-renders the idle editor at once and the editing one after Done', () => {
    const { a, b, broadcast } = pair();
    enterViaContextMenu(a.toolbar);
    const mineBefore = order(a.toolbar);
    broadcast(custom);
    expect(order(b.toolbar)).toEqual(custom.items);
    expect(order(a.toolbar)).toEqual(mineBefore);
    press('Escape');
    expect(order(a.toolbar)).toEqual(custom.items);
  });

  it("Escape pressed in the other editor does not end this one's edit mode", () => {
    const { a, b } = pair();
    enterViaContextMenu(a.toolbar);
    const bButton = b.toolbar.querySelector<HTMLElement>('button[data-action="undo"]')!;
    bButton.focus();
    bButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(a.toolbar.classList.contains('toolbar-editing')).toBe(true);
    expect(tray(a.el)).not.toBeNull();
  });

  it('both can be in edit mode at once, and Done in one leaves the other editing', () => {
    const { a, b, saves } = pair();
    enterViaContextMenu(a.toolbar);
    enterViaContextMenu(b.toolbar);
    expect(tray(a.el)).not.toBeNull();
    expect(tray(b.el)).not.toBeNull();
    trayButton(a.el, 'toolbar-tray-done').click();
    expect(tray(a.el)).toBeNull();
    expect(tray(b.el)).not.toBeNull();
    expect(b.toolbar.classList.contains('toolbar-editing')).toBe(true);
    trayButton(b.el, 'toolbar-tray-done').click();
    expect(saves).toHaveLength(0);
  });

  it('destroying the editor that is customizing leaves the other one working', () => {
    const { a, b } = pair();
    enterViaContextMenu(a.toolbar);
    a.handle.destroy();
    b.handle.updateSettings({ toolbarLayout: custom } as never);
    expect(order(b.toolbar)).toEqual(custom.items);
    enterViaContextMenu(b.toolbar);
    expect(tray(b.el)).not.toBeNull();
  });
});
