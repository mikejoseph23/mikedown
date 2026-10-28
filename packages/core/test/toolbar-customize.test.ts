/**
 * Toolbar edit mode (Customize Toolbar…): entry points, the edit-mode state,
 * the tray, Done, the Settings modal's discard confirm, deferred incoming
 * layouts, destroy while editing, and pointer drag over faked geometry.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, NoopHost, TOOLBAR_ITEM_IDS, type MikeDownEditorHandle, type MikeDownHost } from '../src/index';
import { hideToolbarDropdown } from '../src/toolbar-dropdown';
import { hideContextMenu } from '../src/contextmenu';
import { toolbarDropSlot, type ToolbarSlotRect } from '../src/toolbar-customize';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

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
    expect(buttons.every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);
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
