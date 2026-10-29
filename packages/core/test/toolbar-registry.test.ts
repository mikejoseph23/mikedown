/**
 * The toolbar's shape: which children appear, in what order, for which host
 * and settings. Written before the registry refactor and kept unchanged by it.
 *
 * A node hidden with `display:none` counts as absent (the registry leaves
 * unavailable items out of the DOM; the old code hid them), and a
 * `.toolbar-group` wrapper is flattened to its inner buttons.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, DEFAULT_TOOLBAR_LAYOUT, NoopHost, type MikeDownAiHost, type MikeDownEditorHandle, type MikeDownHost } from '../src/index';
import { hideToolbarDropdown } from '../src/toolbar-dropdown';
import { parseAiSettings } from '../src/ai';
import type { ToolbarLayoutToken } from '../src/toolbar-ids';
import { renderToolbar, resolveToolbarTokens, type ToolbarItemDef } from '../src/toolbar-registry';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

function mount(host: MikeDownHost, options: Record<string, unknown> = {}) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host, ...options });
  mounted.push({ handle, el });
  return { el, handle };
}

afterEach(() => {
  hideToolbarDropdown();
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
});

type Slot = [tag: string, id: string, display: string];

/** The toolbar's children as `[tag, data-action or 'separator', display]`, groups flattened, hidden nodes dropped. */
function sequence(el: HTMLElement): Slot[] {
  const toolbar = el.querySelector<HTMLElement>('.mikedown-toolbar')!;
  const out: Slot[] = [];
  const walk = (parent: HTMLElement) => {
    for (const child of Array.from(parent.children) as HTMLElement[]) {
      if (child.classList.contains('toolbar-group')) { walk(child); continue; }
      if (child.style.display === 'none') {continue;}
      const id = child.classList.contains('toolbar-separator') ? 'separator' : (child.dataset.action ?? '?');
      out.push([child.tagName.toLowerCase(), id, child.style.display]);
    }
  };
  walk(toolbar);
  return out;
}

const ids = (el: HTMLElement) => sequence(el).map(([, id]) => id);

const aiHost = (): MikeDownAiHost => ({
  complete: vi.fn(),
  listEngines: vi.fn(async () => []),
  testEngine: vi.fn(),
  discoverModels: vi.fn(async () => ({ models: [] })),
  setSecret: vi.fn(async () => {}),
}) as unknown as MikeDownAiHost;

const withBrowser = (): MikeDownHost => ({ onChange() {}, viewInBrowser() {} });

const HEAD = ['textFormat', 'listBlock', 'link', 'insert', 'emoji'];
const ZOOM = ['zoomOut', 'zoomReset', 'zoomIn'];

describe('toolbar contents', () => {
  it('default features and a host with viewInBrowser, no AI', () => {
    const { el } = mount(withBrowser());
    expect(ids(el)).toEqual([
      ...HEAD, 'separator',
      'undo', 'redo', 'separator',
      'sourceToggle', 'separator',
      'share', 'selectAll', 'separator',
      ...ZOOM, 'separator',
      'themeToggle', 'settings', 'more',
    ]);
    // Buttons are plain <button>s, separators plain <div>s, none with an inline display.
    for (const [tag, id, display] of sequence(el)) {
      expect(tag).toBe(id === 'separator' ? 'div' : 'button');
      expect(display).toBe('');
    }
  });

  it('features.sourceMode: false drops Source and its separator', () => {
    const { el } = mount(withBrowser(), { features: { sourceMode: false } });
    expect(ids(el)).toEqual([
      ...HEAD, 'separator',
      'undo', 'redo', 'separator',
      'share', 'selectAll', 'separator',
      ...ZOOM, 'separator',
      'themeToggle', 'settings', 'more',
    ]);
  });

  it('a host without share outputs has no Share button', () => {
    const { el } = mount(new NoopHost());
    expect(ids(el)).toEqual([
      ...HEAD, 'separator',
      'undo', 'redo', 'separator',
      'sourceToggle', 'separator',
      'selectAll', 'separator',
      ...ZOOM, 'separator',
      'themeToggle', 'settings', 'more',
    ]);
  });

  it('a host with AI shows the AI button after Emoji', () => {
    class Host extends NoopHost { ai = aiHost(); viewInBrowser() {} }
    const { el } = mount(new Host());
    expect(ids(el)).toEqual([
      ...HEAD, 'ai', 'separator',
      'undo', 'redo', 'separator',
      'sourceToggle', 'separator',
      'share', 'selectAll', 'separator',
      ...ZOOM, 'separator',
      'themeToggle', 'settings', 'more',
    ]);
  });

  it('ai.showToolbarButton: false hides the AI button', () => {
    class Host extends NoopHost { ai = aiHost(); }
    const { el } = mount(new Host(), { settings: { ai: { showToolbarButton: false } } });
    expect(ids(el)).not.toContain('ai');
  });

  it('headingNumbering: fromH1 shows the toggle after Emoji; off leaves it out', () => {
    const on = mount(withBrowser(), { settings: { headingNumbering: 'fromH1' } });
    expect(ids(on.el)).toEqual([
      ...HEAD, 'headingNumbers', 'separator',
      'undo', 'redo', 'separator',
      'sourceToggle', 'separator',
      'share', 'selectAll', 'separator',
      ...ZOOM, 'separator',
      'themeToggle', 'settings', 'more',
    ]);

    const off = mount(withBrowser(), { settings: { headingNumbering: 'off' } });
    expect(ids(off.el)).not.toContain('headingNumbers');
    expect(ids(off.el)).toEqual(ids(mount(withBrowser()).el));
  });

  it('headingNumbering changes after mount show and hide the toggle', () => {
    const { el, handle } = mount(withBrowser());
    expect(ids(el)).not.toContain('headingNumbers');
    handle.updateSettings({ headingNumbering: 'fromH2' });
    expect(ids(el).indexOf('headingNumbers')).toBe(HEAD.length);
    handle.updateSettings({ headingNumbering: 'off' });
    expect(ids(el)).not.toContain('headingNumbers');
  });
});

/** Minimal item definitions: a button per id, with optional availability, to drive `renderToolbar` directly. */
function fakeDefs(available: Partial<Record<string, () => boolean>> = {}): ToolbarItemDef[] {
  const ids = ['textFormat', 'undo', 'redo', 'emoji', 'settings', 'more'] as const;
  return ids.map((id) => ({
    id,
    label: id,
    kind: 'button' as const,
    removable: id !== 'textFormat' && id !== 'settings' && id !== 'more',
    available: available[id],
    render: () => {
      const b = document.createElement('button');
      b.dataset.action = id;
      return b;
    },
  }));
}

const domIds = (toolbar: HTMLElement) =>
  (Array.from(toolbar.children) as HTMLElement[]).map((c) =>
    c.classList.contains('toolbar-separator') ? '|' : c.classList.contains('toolbar-spacer') ? '~' : (c.dataset.action ?? '?'));

describe('renderToolbar with a custom token list', () => {
  it('renders the tokens in the given order', () => {
    const toolbar = document.createElement('div');
    renderToolbar(toolbar, fakeDefs(), ['textFormat', 'redo', 'undo', 'settings', 'more']);
    expect(domIds(toolbar)).toEqual(['textFormat', 'redo', 'undo', 'settings', 'more']);
  });

  it('renders a ~ as a flexible spacer and a | as a separator', () => {
    const toolbar = document.createElement('div');
    renderToolbar(toolbar, fakeDefs(), ['textFormat', 'undo', '~', 'redo', '|', 'settings', 'more']);
    expect(domIds(toolbar)).toEqual(['textFormat', 'undo', '~', 'redo', '|', 'settings', 'more']);
    const spacer = toolbar.querySelector('.toolbar-spacer')!;
    expect(spacer.tagName).toBe('DIV');
    expect(spacer.getAttribute('aria-hidden')).toBe('true');
    expect(toolbar.querySelector('.toolbar-separator')!.getAttribute('role')).toBe('separator');
  });

  it('skips an unknown id, and the divider it leaves doubled collapses', () => {
    const toolbar = document.createElement('div');
    const tokens = ['textFormat', 'undo', '|', 'hologram', '|', 'redo', 'settings', 'more'] as unknown as ToolbarLayoutToken[];
    const rendered = renderToolbar(toolbar, fakeDefs(), tokens);
    expect(domIds(toolbar)).toEqual(['textFormat', 'undo', '|', 'redo', 'settings', 'more']);
    expect(rendered).toEqual(['textFormat', 'undo', '|', 'redo', 'settings', 'more']);
  });

  it('trims leading and trailing dividers and collapses runs of the same kind', () => {
    const toolbar = document.createElement('div');
    renderToolbar(toolbar, fakeDefs(), ['~', 'textFormat', '|', '|', 'undo', '~', '~', 'redo', '|']);
    expect(domIds(toolbar)).toEqual(['textFormat', '|', 'undo', '~', 'redo']);
  });

  it('leaves unavailable items out of the DOM and collapses the separators around them', () => {
    let hidden = true;
    const defs = fakeDefs({ undo: () => !hidden });
    const toolbar = document.createElement('div');
    const tokens: ToolbarLayoutToken[] = ['textFormat', '|', 'undo', '|', 'redo', 'settings', 'more'];
    renderToolbar(toolbar, defs, tokens);
    expect(domIds(toolbar)).toEqual(['textFormat', '|', 'redo', 'settings', 'more']);
    expect(toolbar.querySelector('[data-action="undo"]')).toBeNull();

    hidden = false;
    expect(resolveToolbarTokens(defs, tokens)).toEqual(tokens);
    renderToolbar(toolbar, defs, tokens);
    expect(domIds(toolbar)).toEqual(['textFormat', '|', 'undo', '|', 'redo', 'settings', 'more']);
  });

  it('reuses an item element across passes so its listeners survive', () => {
    const defs = fakeDefs();
    const toolbar = document.createElement('div');
    renderToolbar(toolbar, defs, ['textFormat', 'undo', 'redo', 'settings', 'more']);
    const undo = toolbar.querySelector('[data-action="undo"]');
    renderToolbar(toolbar, defs, ['textFormat', 'redo', 'undo', 'settings', 'more']);
    expect(toolbar.querySelector('[data-action="undo"]')).toBe(undo);
  });
});

describe('refreshToolbarAvailability', () => {
  it('headingNumbering: off removes the toggle from the DOM and keeps the rest in order', () => {
    const { el, handle } = mount(withBrowser(), { settings: { headingNumbering: 'fromH1' } });
    const toolbar = el.querySelector<HTMLElement>('.mikedown-toolbar')!;
    expect(toolbar.querySelector('[data-action="headingNumbers"]')).not.toBeNull();
    const before = ids(el);
    handle.updateSettings({ headingNumbering: 'off' });
    expect(toolbar.querySelector('[data-action="headingNumbers"]')).toBeNull();
    expect(ids(el)).toEqual(before.filter((id) => id !== 'headingNumbers'));
  });

  it('headingNumbering back on puts the toggle in its layout slot', () => {
    const { el, handle } = mount(withBrowser(), { settings: { headingNumbering: 'off' } });
    handle.updateSettings({ headingNumbering: 'fromH1' });
    expect(ids(el).slice(0, HEAD.length + 1)).toEqual([...HEAD, 'headingNumbers']);
  });

  it('keeps the same toggle element and its listeners across a flip', () => {
    const { el, handle } = mount(withBrowser(), { settings: { headingNumbering: 'fromH1' } });
    const first = el.querySelector('[data-action="headingNumbers"]');
    handle.updateSettings({ headingNumbering: 'off' });
    handle.updateSettings({ headingNumbering: 'fromH2' });
    expect(el.querySelector('[data-action="headingNumbers"]')).toBe(first);
  });

  it('an AI showToolbarButton flip removes and restores the AI button', () => {
    class Host extends NoopHost { ai = aiHost(); }
    const quiet = { onWarning: () => {} };
    const { el, handle } = mount(new Host());
    expect(ids(el)).toContain('ai');
    handle.updateSettings({ ai: parseAiSettings({ enabled: true, showToolbarButton: false }, quiet) });
    expect(ids(el)).not.toContain('ai');
    expect(el.querySelector('.mikedown-toolbar [data-action="ai"]')).toBeNull();
    handle.updateSettings({ ai: parseAiSettings({ enabled: true, showToolbarButton: true }, quiet) });
    expect(ids(el).indexOf('ai')).toBe(HEAD.length);
  });

  it('does not rebuild the toolbar when availability did not change', () => {
    const { el, handle } = mount(withBrowser());
    const toolbar = el.querySelector<HTMLElement>('.mikedown-toolbar')!;
    const children = Array.from(toolbar.children);
    handle.updateSettings({ headingNumbering: 'off' });
    expect(Array.from(toolbar.children)).toEqual(children);
  });
});

describe('zoom group', () => {
  it('renders one .toolbar-group[data-action="zoom"] holding the three buttons with unchanged ids', () => {
    const { el } = mount(withBrowser());
    const toolbar = el.querySelector<HTMLElement>('.mikedown-toolbar')!;
    const groups = toolbar.querySelectorAll(':scope > .toolbar-group');
    expect(groups).toHaveLength(1);
    const group = groups[0] as HTMLElement;
    expect(group.dataset.action).toBe('zoom');
    expect(group.getAttribute('role')).toBe('group');
    const inner = Array.from(group.children) as HTMLElement[];
    expect(inner.map((c) => c.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON']);
    expect(inner.map((c) => c.dataset.action)).toEqual(ZOOM);
  });

  it('keeps the three buttons reachable by the data-action selectors other code uses', () => {
    const { el } = mount(withBrowser());
    for (const id of ZOOM) {
      expect(el.querySelector(`button[data-action="${id}"]`)).not.toBeNull();
    }
  });
});

describe('fontPicker (optional item)', () => {
  const withFontPicker = { version: 1, items: ['textFormat', 'listBlock', 'fontPicker', 'settings', 'more'], seen: [...DEFAULT_TOOLBAR_LAYOUT.seen] };

  it('is absent from the default toolbar', () => {
    const { el } = mount(withBrowser());
    expect(ids(el)).not.toContain('fontPicker');
  });

  it('renders as a labelled button where a saved layout puts it', () => {
    const { el } = mount(withBrowser(), { settings: { toolbarLayout: withFontPicker } });
    expect(ids(el)).toEqual(['textFormat', 'listBlock', 'fontPicker', 'settings', 'more']);
    const btn = el.querySelector<HTMLButtonElement>('button[data-action="fontPicker"]')!;
    expect(btn.getAttribute('aria-label')).toBe('Font Theme');
    expect(btn.dataset.tip).toBe('Font Theme');
  });

  it('opens the font theme list, and picking one saves the font settings', () => {
    const saveSettings = vi.fn();
    const { el } = mount({ onChange() {}, saveSettings } as MikeDownHost, { settings: { toolbarLayout: withFontPicker } });
    const btn = el.querySelector<HTMLButtonElement>('button[data-action="fontPicker"]')!;
    btn.click();
    const picker = el.querySelector('.mikedown-font-quick-picker')!;
    expect(picker).not.toBeNull();
    btn.click(); // a second press closes it
    expect(el.querySelector('.mikedown-font-quick-picker')).toBeNull();
    btn.click();
    const classic = Array.from(el.querySelectorAll<HTMLElement>('.mikedown-font-quick-picker > div'))
      .find((n) => n.textContent?.startsWith('Classic'))!;
    classic.click();
    expect(el.querySelector('.mikedown-font-quick-picker')).toBeNull();
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ fontFamily: expect.stringContaining('Georgia'), headingFontFamily: expect.stringContaining('Georgia') }));
  });
});
