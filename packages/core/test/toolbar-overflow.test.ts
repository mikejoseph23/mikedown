/**
 * The toolbar stays on one row at any width: buttons that don't fit move,
 * from the right, into the More (⋯) menu.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { layoutToolbarOverflow } from '../src/toolbar-overflow';
import { createMikeDownEditor, type MikeDownEditorHandle } from '../src/index';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

/**
 * Fake flex-row geometry: children sit left to right with their data-w width
 * (0 when not laid out); the toolbar is `width` wide.
 */
function fakeRow(toolbar: HTMLElement, width: number): void {
  const laidOut = (el: HTMLElement) =>
    !el.hidden && !el.classList.contains('toolbar-overflowed') && el.style.display !== 'none';
  toolbar.getBoundingClientRect = () => ({ left: 0, right: width, width, top: 0, bottom: 40, height: 40, x: 0, y: 0, toJSON() {} }) as DOMRect;
  for (const child of Array.from(toolbar.children) as HTMLElement[]) {
    child.getBoundingClientRect = () => {
      let x = 0;
      for (const el of Array.from(toolbar.children) as HTMLElement[]) {
        const w = laidOut(el) ? Number(el.dataset.w) : 0;
        if (el === child) {return { left: x, right: x + w, width: w, top: 0, bottom: 40, height: 40, x, y: 0, toJSON() {} } as DOMRect;}
        x += w;
      }
      return new DOMRect();
    };
  }
}

function makeToolbar(spec: string[]): HTMLElement {
  const toolbar = document.createElement('div');
  for (const item of spec) {
    const el = item === '|' ? document.createElement('div') : document.createElement('button');
    if (item === '|') {
      el.className = 'toolbar-separator';
      el.dataset.w = '7';
    } else {
      el.dataset.action = item;
      el.dataset.w = '30';
    }
    toolbar.appendChild(el);
  }
  const more = document.createElement('button');
  more.className = 'toolbar-more';
  more.dataset.w = '30';
  toolbar.appendChild(more);
  document.body.appendChild(toolbar);
  return toolbar;
}

const overflowed = (toolbar: HTMLElement) =>
  (Array.from(toolbar.querySelectorAll<HTMLElement>('.toolbar-overflowed'))).map((el) => el.dataset.action ?? '|');

let toolbarEl: HTMLElement | null = null;
let handle: MikeDownEditorHandle | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  toolbarEl?.remove();
  toolbarEl = null;
  handle?.destroy();
  host?.remove();
  handle = null;
  host = null;
});

describe('layoutToolbarOverflow', () => {
  const SPEC = ['format', 'lists', 'link', '|', 'undo', 'redo', '|', 'theme', 'settings'];

  it('hides More when everything fits', () => {
    toolbarEl = makeToolbar(SPEC);
    fakeRow(toolbarEl, 1000);
    layoutToolbarOverflow(toolbarEl);
    expect(overflowed(toolbarEl)).toEqual([]);
    expect(toolbarEl.querySelector<HTMLElement>('.toolbar-more')!.hidden).toBe(true);
  });

  it('moves buttons into More from the right and drops a dangling separator', () => {
    toolbarEl = makeToolbar(SPEC);
    // format, lists, link, |, undo, redo = 157px, plus More (30) = 187px.
    fakeRow(toolbarEl, 190);
    layoutToolbarOverflow(toolbarEl);
    expect(overflowed(toolbarEl)).toEqual(['|', 'theme', 'settings']);
    expect(toolbarEl.querySelector<HTMLElement>('.toolbar-more')!.hidden).toBe(false);

    fakeRow(toolbarEl, 150);
    layoutToolbarOverflow(toolbarEl);
    expect(overflowed(toolbarEl)).toEqual(['|', 'undo', 'redo', '|', 'theme', 'settings']);
  });

  it('never overflows the first button and restores everything when it widens', () => {
    toolbarEl = makeToolbar(SPEC);
    fakeRow(toolbarEl, 40);
    layoutToolbarOverflow(toolbarEl);
    expect(overflowed(toolbarEl)).not.toContain('format');
    expect(overflowed(toolbarEl)).toHaveLength(SPEC.length - 1);

    fakeRow(toolbarEl, 1000);
    layoutToolbarOverflow(toolbarEl);
    expect(overflowed(toolbarEl)).toEqual([]);
  });
});

describe('layoutToolbarOverflow with a group', () => {
  /** format, a group of two buttons (data-w 60, one child), theme, More. */
  function groupToolbar(): HTMLElement {
    const toolbar = makeToolbar(['format', 'theme']);
    const group = document.createElement('div');
    group.className = 'toolbar-group';
    group.dataset.action = 'zoom';
    group.dataset.w = '60';
    for (const id of ['zoomOut', 'zoomIn']) {
      const b = document.createElement('button');
      b.dataset.action = id;
      group.appendChild(b);
    }
    toolbar.insertBefore(group, toolbar.children[1]);
    return toolbar;
  }

  it('overflows the group as one child, never its buttons one by one', () => {
    toolbarEl = groupToolbar();
    // format 30 + group 60 + theme 30 = 120; at 100 theme goes, then the group (More takes theme's room).
    fakeRow(toolbarEl, 100);
    layoutToolbarOverflow(toolbarEl);
    expect(overflowed(toolbarEl)).toEqual(['zoom', 'theme']);
    expect(toolbarEl.querySelectorAll('.toolbar-group button.toolbar-overflowed')).toHaveLength(0);
    expect(toolbarEl.querySelector<HTMLElement>('.toolbar-more')!.hidden).toBe(false);
  });

  it('shows More when only a group overflowed', () => {
    toolbarEl = groupToolbar();
    toolbarEl.querySelector('[data-action="theme"]')!.remove();
    // format 30 + group 60 = 90 does not fit in 80; the group moves and More takes 30.
    fakeRow(toolbarEl, 80);
    layoutToolbarOverflow(toolbarEl);
    expect(overflowed(toolbarEl)).toEqual(['zoom']);
    expect(toolbarEl.querySelector<HTMLElement>('.toolbar-more')!.hidden).toBe(false);
  });
});

describe('More menu', () => {
  it('lists the overflowed buttons and runs them', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    let changed = 0;
    handle = createMikeDownEditor(host, { host: { onChange() { changed++; } }, initialMarkdown: 'Hello\n' });
    const toolbar = host.querySelector<HTMLElement>('.mikedown-toolbar')!;
    const more = toolbar.querySelector<HTMLButtonElement>('button.toolbar-more')!;
    expect(more).not.toBeNull();

    // Every button but the first one overflowed (as on a very narrow phone).
    const children = Array.from(toolbar.children) as HTMLElement[];
    children.slice(1).filter((el) => el !== more).forEach((el) => el.classList.add('toolbar-overflowed'));
    more.hidden = false;

    more.click();
    const menu = document.getElementById('toolbar-dropdown')!;
    const labels = Array.from(menu.querySelectorAll('.tdd-item-label')).map((el) => el.textContent);
    expect(labels).toContain('Undo (Cmd+Z)');
    expect(labels).toContain('Settings');
    expect(labels.some((l) => l?.startsWith('Reset Font Size'))).toBe(true);

    // Zoom In from the menu changes the font size like the button would.
    const before = getComputedStyle(host.querySelector('.mikedown-root') ?? host).getPropertyValue('--mikedown-font-size');
    const zoomIn = menu.querySelector<HTMLElement>('[data-tdd-id="more-zoomIn"]')!;
    zoomIn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const after = getComputedStyle(host.querySelector('.mikedown-root') ?? host).getPropertyValue('--mikedown-font-size');
    expect(after).not.toBe(before);
    expect(document.getElementById('toolbar-dropdown')).toBeNull();
    expect(changed).toBe(0);
  });
});
