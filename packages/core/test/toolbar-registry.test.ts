/**
 * The toolbar's shape: which children appear, in what order, for which host
 * and settings. Written before the registry refactor and kept unchanged by it.
 *
 * A node hidden with `display:none` counts as absent (the registry leaves
 * unavailable items out of the DOM; the old code hid them), and a
 * `.toolbar-group` wrapper is flattened to its inner buttons.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownAiHost, type MikeDownEditorHandle, type MikeDownHost } from '../src/index';
import { hideToolbarDropdown } from '../src/toolbar-dropdown';
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
