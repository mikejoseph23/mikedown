/**
 * The toolbar stays on one row at any width: buttons that don't fit move,
 * from the right, into the More (⋯) menu.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layoutToolbarOverflow } from '../src/toolbar-overflow';
import { createMikeDownEditor, type MikeDownEditorHandle } from '../src/index';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';
import { fakeToolbarGeometry } from './toolbar-geometry';

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
    const el = item === '|' || item === '~' ? document.createElement('div') : document.createElement('button');
    if (item === '|') {
      el.className = 'toolbar-separator';
      el.dataset.w = '7';
    } else if (item === '~') {
      // A flexible spacer squeezed to nothing by a full row.
      el.className = 'toolbar-spacer';
      el.dataset.w = '0';
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
  (Array.from(toolbar.querySelectorAll<HTMLElement>('.toolbar-overflowed'))).map((el) => el.dataset.action ?? (el.classList.contains('toolbar-spacer') ? '~' : '|'));

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
  vi.restoreAllMocks();
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

describe('layoutToolbarOverflow with a group, more cases', () => {
  function zoomToolbar(spec: string[]): HTMLElement {
    const toolbar = makeToolbar(spec);
    const group = document.createElement('div');
    group.className = 'toolbar-group';
    group.dataset.action = 'zoom';
    group.dataset.w = '60';
    for (const id of ['zoomOut', 'zoomReset', 'zoomIn']) {
      const b = document.createElement('button');
      b.dataset.action = id;
      group.appendChild(b);
    }
    toolbar.insertBefore(group, toolbar.querySelector('.toolbar-more'));
    return toolbar;
  }

  it('keeps the group in the row when it fits, with More hidden', () => {
    toolbarEl = zoomToolbar(['format', '|', 'theme']);
    fakeRow(toolbarEl, 1000);
    layoutToolbarOverflow(toolbarEl);
    expect(overflowed(toolbarEl)).toEqual([]);
    expect(toolbarEl.querySelector<HTMLElement>('.toolbar-more')!.hidden).toBe(true);
  });

  it('restores the group when the toolbar widens again', () => {
    toolbarEl = zoomToolbar(['format', '|', 'theme']);
    fakeRow(toolbarEl, 80);
    layoutToolbarOverflow(toolbarEl);
    expect(overflowed(toolbarEl)).toContain('zoom');
    fakeRow(toolbarEl, 1000);
    layoutToolbarOverflow(toolbarEl);
    expect(overflowed(toolbarEl)).toEqual([]);
  });

  it('drops the separator left dangling before an overflowed group', () => {
    toolbarEl = zoomToolbar(['format', 'theme', '|']);
    // The group sits after the trailing separator here, so it overflows first and the separator is trimmed.
    fakeRow(toolbarEl, 100);
    layoutToolbarOverflow(toolbarEl);
    const out = overflowed(toolbarEl);
    expect(out).toContain('zoom');
    expect(out).toContain('|');
    expect(toolbarEl.querySelectorAll('.toolbar-group button.toolbar-overflowed')).toHaveLength(0);
  });

  it('counts a group as listable, so More shows even with no loose button overflowed', () => {
    toolbarEl = zoomToolbar(['format']);
    fakeRow(toolbarEl, 70);
    layoutToolbarOverflow(toolbarEl);
    expect(overflowed(toolbarEl)).toEqual(['zoom']);
    expect(toolbarEl.querySelector<HTMLElement>('.toolbar-more')!.hidden).toBe(false);
  });
});

describe('layoutToolbarOverflow with a flexible spacer', () => {
  it('leaves a spacer in the row while everything fits', () => {
    toolbarEl = makeToolbar(['format', 'link', '~', 'undo', 'settings']);
    fakeRow(toolbarEl, 1000);
    layoutToolbarOverflow(toolbarEl);
    expect(overflowed(toolbarEl)).toEqual([]);
    expect(toolbarEl.querySelector<HTMLElement>('.toolbar-more')!.hidden).toBe(true);
  });

  it('overflows a squeezed spacer like a separator once the buttons after it spill', () => {
    toolbarEl = makeToolbar(['format', 'link', '~', 'undo', 'settings']);
    // format 30 + link 30 + spacer 0 = 60, plus More 30 = 90: undo and settings spill, then the trailing spacer is trimmed.
    fakeRow(toolbarEl, 95);
    layoutToolbarOverflow(toolbarEl);
    expect(overflowed(toolbarEl)).toEqual(['~', 'undo', 'settings']);
    expect(toolbarEl.querySelector<HTMLElement>('.toolbar-more')!.hidden).toBe(false);
  });

  it('never lets a spacer be the last visible thing before More', () => {
    toolbarEl = makeToolbar(['format', 'link', 'undo', '~', 'settings']);
    fakeRow(toolbarEl, 100);
    layoutToolbarOverflow(toolbarEl);
    const visible = (Array.from(toolbarEl.children) as HTMLElement[]).filter((el) => !el.classList.contains('toolbar-overflowed') && !el.hidden);
    const beforeMore = visible[visible.length - 2];
    expect(beforeMore.classList.contains('toolbar-spacer')).toBe(false);
  });

  it('trims trailing spacers and separators together', () => {
    toolbarEl = makeToolbar(['format', 'link', '|', '~', 'undo', 'settings']);
    // undo and settings spill; the separator and spacer they leave at the end of the row go with them.
    fakeRow(toolbarEl, 100);
    layoutToolbarOverflow(toolbarEl);
    expect(overflowed(toolbarEl)).toEqual(['|', '~', 'undo', 'settings']);
  });

  it('restores the spacer when the toolbar widens', () => {
    toolbarEl = makeToolbar(['format', 'link', '~', 'undo', 'settings']);
    fakeRow(toolbarEl, 95);
    layoutToolbarOverflow(toolbarEl);
    fakeRow(toolbarEl, 1000);
    layoutToolbarOverflow(toolbarEl);
    expect(overflowed(toolbarEl)).toEqual([]);
  });

  it('does not show More when only spacers and separators moved', () => {
    toolbarEl = makeToolbar(['format', '|', '~']);
    fakeRow(toolbarEl, 20);
    layoutToolbarOverflow(toolbarEl);
    expect(overflowed(toolbarEl)).toEqual(['|', '~']);
    expect(toolbarEl.querySelector<HTMLElement>('.toolbar-more')!.hidden).toBe(true);
  });

  it('never overflows a spacer in the first slot', () => {
    toolbarEl = makeToolbar(['~', 'link', 'undo']);
    fakeRow(toolbarEl, 20);
    layoutToolbarOverflow(toolbarEl);
    expect(overflowed(toolbarEl)).not.toContain('~');
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

  /**
   * Open the More menu with `overflow` marked overflowed and return its entry ids and labels.
   * Customize Toolbar is off unless `customize` is set, so the menu lists only the overflow.
   */
  function openMore(overflow: (toolbar: HTMLElement) => HTMLElement[], customize = false) {
    host = document.createElement('div');
    document.body.appendChild(host);
    handle = createMikeDownEditor(host, { host: { onChange() {} }, initialMarkdown: 'Hello\n', features: { customizeToolbar: customize } });
    const toolbar = host.querySelector<HTMLElement>('.mikedown-toolbar')!;
    const more = toolbar.querySelector<HTMLButtonElement>('button.toolbar-more')!;
    overflow(toolbar).forEach((el) => el.classList.add('toolbar-overflowed'));
    more.hidden = false;
    more.click();
    const menu = document.getElementById('toolbar-dropdown')!;
    return {
      toolbar,
      ids: Array.from(menu.querySelectorAll<HTMLElement>('[data-tdd-id]')).map((el) => el.dataset.tddId),
      separators: menu.querySelectorAll('.tdd-separator, [role="separator"]').length,
    };
  }

  it('ends with Customize Toolbar after a separator when customizing is on', () => {
    const { ids, separators } = openMore((t) => [t.querySelector<HTMLElement>('.toolbar-group[data-action="zoom"]')!], true);
    expect(ids).toEqual(['more-zoomOut', 'more-zoomReset', 'more-zoomIn', 'more-customizeToolbar']);
    expect(separators).toBe(1);
  });

  it('expands the zoom group into its three buttons, in order, and lists no wrapper', () => {
    const { ids } = openMore((t) => [t.querySelector<HTMLElement>('.toolbar-group[data-action="zoom"]')!]);
    expect(ids).toEqual(['more-zoomOut', 'more-zoomReset', 'more-zoomIn']);
  });

  it('skips a hidden button inside an overflowed group', () => {
    const { ids } = openMore((t) => {
      t.querySelector<HTMLElement>('[data-action="zoomReset"]')!.style.display = 'none';
      return [t.querySelector<HTMLElement>('.toolbar-group[data-action="zoom"]')!];
    });
    expect(ids).toEqual(['more-zoomOut', 'more-zoomIn']);
  });

  it('never lists a flexible spacer, and keeps the group beside it', () => {
    const { ids } = openMore((t) => {
      const spacer = document.createElement('div');
      spacer.className = 'toolbar-spacer';
      const group = t.querySelector<HTMLElement>('.toolbar-group[data-action="zoom"]')!;
      t.insertBefore(spacer, group);
      return [spacer, group];
    });
    expect(ids).toEqual(['more-zoomOut', 'more-zoomReset', 'more-zoomIn']);
  });

  it('puts a separator between a loose button and an expanded group, and none at the ends', () => {
    const { ids, separators } = openMore((t) => [
      t.querySelector<HTMLElement>('[data-action="selectAll"]')!,
      ...Array.from(t.querySelectorAll<HTMLElement>(':scope > .toolbar-separator')).filter((s) => s.nextElementSibling?.classList.contains('toolbar-group')),
      t.querySelector<HTMLElement>('.toolbar-group[data-action="zoom"]')!,
    ]);
    expect(ids).toEqual(['more-selectAll', 'more-zoomOut', 'more-zoomReset', 'more-zoomIn']);
    expect(separators).toBe(1);
  });
});

describe('a custom layout with a flexible spacer in a real editor', () => {
  const seen = ['textFormat', 'listBlock', 'insert', 'link', 'emoji', 'headingNumbers', 'ai', 'undo', 'redo', 'sourceToggle', 'share', 'selectAll', 'zoom', 'themeToggle', 'settings', 'more'];

  function mountWith(items: string[], width: { value: number }) {
    fakeToolbarGeometry(() => width.value);
    host = document.createElement('div');
    document.body.appendChild(host);
    handle = createMikeDownEditor(host, {
      host: { onChange() {} },
      initialMarkdown: 'Hello\n',
      settings: { toolbarLayout: { version: 1, items, seen } },
    });
    const toolbar = host.querySelector<HTMLElement>('.mikedown-toolbar')!;
    const ids = () => (Array.from(toolbar.children) as HTMLElement[]).map((c) => c.classList.contains('toolbar-spacer') ? '~' : c.classList.contains('toolbar-separator') ? '|' : c.dataset.action ?? '?');
    const hidden = () => (Array.from(toolbar.children) as HTMLElement[]).filter((c) => c.classList.contains('toolbar-overflowed')).map((c) => ids()[Array.from(toolbar.children).indexOf(c)]);
    return { toolbar, ids, hidden, spacer: toolbar.querySelector<HTMLElement>('.toolbar-spacer')! };
  }

  const ITEMS = ['textFormat', 'link', '~', 'undo', 'redo', 'settings', 'more'];

  it('lets the spacer take the free room and leaves every button in the row', () => {
    const width = { value: 1000 };
    const { toolbar, spacer, hidden } = mountWith(ITEMS, width);
    layoutToolbarOverflow(toolbar);
    expect(hidden()).toEqual([]);
    expect(spacer.getBoundingClientRect().width).toBe(1000 - 5 * 30);
    expect(toolbar.querySelector<HTMLElement>('.toolbar-more')!.hidden).toBe(true);
  });

  it('squeezes the spacer to 0 before any button overflows', () => {
    const width = { value: 150 }; // exactly the five buttons (More is hidden while they fit)
    const { toolbar, spacer, hidden } = mountWith(ITEMS, width);
    layoutToolbarOverflow(toolbar);
    expect(spacer.getBoundingClientRect().width).toBe(0);
    expect(hidden()).toEqual([]);
    expect(toolbar.querySelector<HTMLElement>('.toolbar-more')!.hidden).toBe(true);
  });

  it('then overflows buttons from the right, keeps the spacer in the row and never lists it in More', () => {
    const width = { value: 120 };
    const { toolbar, spacer, hidden } = mountWith(ITEMS, width);
    layoutToolbarOverflow(toolbar);
    expect(hidden()).toEqual(['redo', 'settings']);
    expect(spacer.classList.contains('toolbar-overflowed')).toBe(false);
    expect(spacer.getBoundingClientRect().width).toBe(0);
    const more = toolbar.querySelector<HTMLButtonElement>('button.toolbar-more')!;
    expect(more.hidden).toBe(false);
    more.click();
    const labels = Array.from(document.querySelectorAll('#toolbar-dropdown .tdd-item-label')).map((n) => n.textContent ?? '');
    expect(labels.slice(0, 2).join(' ')).toMatch(/Redo.*Settings/);
    expect(labels.some((l) => /spacer|flexible/i.test(l))).toBe(false);
  });

  it('restores the buttons and the spacer when the toolbar widens again', () => {
    const width = { value: 120 };
    const { toolbar, spacer, hidden } = mountWith(ITEMS, width);
    layoutToolbarOverflow(toolbar);
    expect(hidden().length).toBeGreaterThan(0);
    width.value = 1000;
    layoutToolbarOverflow(toolbar);
    expect(hidden()).toEqual([]);
    expect(spacer.getBoundingClientRect().width).toBe(1000 - 5 * 30);
  });

  it('keeps Text Format first when the layout puts a spacer right after it, even on a tiny toolbar', () => {
    const width = { value: 40 };
    const { toolbar, ids, hidden } = mountWith(['textFormat', '~', 'link', 'undo', 'settings', 'more'], width);
    layoutToolbarOverflow(toolbar);
    expect(ids()[0]).toBe('textFormat');
    expect(hidden()).not.toContain('textFormat');
    expect(hidden()).toContain('settings');
  });

  it('puts Text Format first and trims a leading spacer when the stored layout starts with one', () => {
    const width = { value: 1000 };
    const { ids } = mountWith(['~', 'link', 'textFormat', 'settings', 'more'], width);
    // Text Format moves to the front, then the leading spacer is trimmed (D15).
    expect(ids().slice(0, 3)).toEqual(['textFormat', 'link', 'settings']);
  });
});
