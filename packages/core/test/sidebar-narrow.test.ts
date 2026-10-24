/**
 * The document sidebar in a narrow editor: when docking it would leave the
 * text column under MIN_TEXT_COLUMN_PX it steps aside (auto-hidden, or an
 * overlay when the user opens it there) and docks again once the editor is
 * wide enough, without touching the persisted pin preference.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, type MikeDownEditorHandle, type MikeDownHost } from '../src/index';
import { MIN_TEXT_COLUMN_PX } from '../src/outlineSidebar';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

/** ResizeObserver stand-in: `resize(el, w)` reports a new width for `el`. */
class FakeResizeObserver {
  static all: FakeResizeObserver[] = [];
  targets = new Set<Element>();
  constructor(private cb: ResizeObserverCallback) { FakeResizeObserver.all.push(this); }
  observe(el: Element): void { this.targets.add(el); }
  unobserve(el: Element): void { this.targets.delete(el); }
  disconnect(): void { this.targets.clear(); }
  fire(el: Element, width: number): void {
    if (!this.targets.has(el)) {return;}
    this.cb([{ target: el, contentRect: { width, height: 600 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}
const resize = (el: Element, width: number) => FakeResizeObserver.all.forEach((o) => o.fire(el, width));

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];
let setPref: ReturnType<typeof vi.fn>;
let pinned: 'always' | 'never';

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const host: MikeDownHost = {
    onChange() {},
    sidebarPrefs: { requestState() {}, setPref, applyDefaults() {}, sectionCollapsed() {} },
  };
  const handle = createMikeDownEditor(el, { host, initialMarkdown: '# Title\n\nBody.\n', features: { sidebar: true } });
  mounted.push({ handle, el });
  handle.setSidebarState({ pref: pinned, width: 200 });
  const root = el.querySelector<HTMLElement>('.mikedown-root')!;
  return {
    root,
    sidebar: el.querySelector<HTMLElement>('.mikedown-outline-sidebar')!,
    toggle: el.querySelector<HTMLButtonElement>('.mikedown-outline-toggle')!,
    close: () => el.querySelector<HTMLButtonElement>('.outline-close')!.click(),
    editorArea: el.querySelector<HTMLElement>('.mikedown-editor-container')!,
  };
}

const WIDE = 200 + MIN_TEXT_COLUMN_PX + 100;
const NARROW = 200 + MIN_TEXT_COLUMN_PX - 100;

beforeEach(() => {
  FakeResizeObserver.all = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  setPref = vi.fn();
  pinned = 'never';
});

afterEach(() => {
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sidebar in a narrow editor', () => {
  it('auto-hides when the text column would get too narrow and docks again when wide', () => {
    const s = mount();
    resize(s.root, WIDE);
    s.toggle.click();
    expect(s.sidebar.hidden).toBe(false);
    expect(s.root.classList.contains('mikedown-outline-open')).toBe(true);

    resize(s.root, NARROW);
    expect(s.sidebar.hidden).toBe(true);
    expect(s.root.classList.contains('mikedown-outline-open')).toBe(false);
    expect(s.root.classList.contains('mikedown-outline-narrow')).toBe(true);

    resize(s.root, WIDE);
    expect(s.sidebar.hidden).toBe(false);
    expect(s.root.classList.contains('mikedown-outline-open')).toBe(true);
    expect(setPref).not.toHaveBeenCalled();
  });

  it('a pinned sidebar loaded into a narrow editor waits for room; the pin stays', () => {
    pinned = 'always';
    const s = mount();
    resize(s.root, NARROW);
    expect(s.sidebar.hidden).toBe(true);
    resize(s.root, WIDE);
    expect(s.sidebar.hidden).toBe(false);
    expect(s.root.querySelector('.outline-pin')?.getAttribute('aria-pressed')).toBe('true');
    expect(setPref).not.toHaveBeenCalled();
  });

  it('opening it while narrow shows an overlay that takes no width; a click in the text closes it', () => {
    const s = mount();
    resize(s.root, NARROW);
    s.toggle.click();
    expect(s.sidebar.hidden).toBe(false);
    expect(s.root.classList.contains('mikedown-outline-overlay')).toBe(true);
    expect(s.root.classList.contains('mikedown-outline-open')).toBe(false);

    s.editorArea.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(s.sidebar.hidden).toBe(true);
    expect(s.root.classList.contains('mikedown-outline-overlay')).toBe(false);
  });

  it('closing the overlay does not forget that it was open when wide', () => {
    const s = mount();
    resize(s.root, WIDE);
    s.toggle.click();
    resize(s.root, NARROW);
    s.toggle.click();
    expect(s.root.classList.contains('mikedown-outline-overlay')).toBe(true);
    s.close();
    expect(s.sidebar.hidden).toBe(true);
    resize(s.root, WIDE);
    expect(s.sidebar.hidden).toBe(false);
    expect(s.root.classList.contains('mikedown-outline-open')).toBe(true);
  });

  it('closing it while wide keeps it closed after a narrow round trip', () => {
    const s = mount();
    resize(s.root, WIDE);
    s.toggle.click();
    s.close();
    resize(s.root, NARROW);
    resize(s.root, WIDE);
    expect(s.sidebar.hidden).toBe(true);
  });
});
