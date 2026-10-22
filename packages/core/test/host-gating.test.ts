/**
 * Optional MikeDownHost methods gate their UI: an absent method removes the
 * feature instead of leaving a dead control. Also checks that two editors on
 * one page keep separate state.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle, type MikeDownHost } from '../src/index';
import { closeSlashMenu } from '../src/slashcommands';
import { hideToolbarDropdown } from '../src/toolbar-dropdown';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

function mount(host: MikeDownHost = new NoopHost(), options: Record<string, unknown> = {}) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host, ...options });
  mounted.push({ handle, el });
  return { el, handle };
}

const tick = () => new Promise<void>(r => setTimeout(r, 0));

afterEach(() => {
  closeSlashMenu();
  hideToolbarDropdown();
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  vi.restoreAllMocks();
});

// ── Image paste ──────────────────────────────────────────────────────────────

function pasteImage(handle: MikeDownEditorHandle): void {
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' });
  const clipboardData = {
    files: Object.assign([file], { item: (i: number) => (i === 0 ? file : null) }),
    items: [],
    types: ['Files'],
    getData: () => '',
  };
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  handle.tiptap.view.dom.dispatchEvent(event);
}

const imageCount = (handle: MikeDownEditorHandle) => handle.tiptap.view.dom.querySelectorAll('img').length;

describe('image paste', () => {
  it('is a no-op when the host has no uploadImage', async () => {
    const { handle } = mount();
    handle.setMarkdown('hello\n');
    const before = handle.getMarkdown();
    pasteImage(handle);
    await tick();
    expect(imageCount(handle)).toBe(0);
    expect(handle.getMarkdown()).toBe(before);
  });

  it('uploads and inserts the image when the host has uploadImage', async () => {
    const uploadImage = vi.fn().mockResolvedValue({ src: 'images/shot.png', alt: 'shot' });
    const { handle } = mount({ onChange() {}, uploadImage });
    handle.setMarkdown('hello\n');
    pasteImage(handle);
    await vi.waitFor(() => expect(imageCount(handle)).toBe(1));
    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(uploadImage.mock.calls[0][0]).toMatchObject({ mime: 'image/png', name: 'shot.png' });
  });
});

// ── Slash menu ───────────────────────────────────────────────────────────────

function openSlashMenu(handle: MikeDownEditorHandle): string[] {
  handle.setMarkdown('');
  const view = handle.tiptap.view;
  view.dispatch(view.state.tr.insertText('/'));
  const menu = document.getElementById('mikedown-slash-menu');
  expect(menu, 'slash menu should be open').not.toBeNull();
  return Array.from(menu!.querySelectorAll('.slash-menu-item')).map(r => (r as HTMLElement).dataset.command as string);
}

describe('slash menu', () => {
  it('has no /image without pickImage', () => {
    const { handle } = mount();
    const ids = openSlashMenu(handle);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).not.toContain('image');
  });

  it('has /image when the host provides pickImage', () => {
    const { handle } = mount({ onChange() {}, pickImage: async () => null });
    expect(openSlashMenu(handle)).toContain('image');
  });

  it('has no /properties when the sidebar feature is off, and has it when on', () => {
    const off = mount({ onChange() {}, pickImage: async () => null });
    expect(openSlashMenu(off.handle)).not.toContain('properties');
    off.handle.destroy();
    closeSlashMenu();
    const on = mount({ onChange() {}, pickImage: async () => null }, { features: { sidebar: true } });
    expect(openSlashMenu(on.handle)).toContain('properties');
  });
});

// ── Print / Share ────────────────────────────────────────────────────────────

const shareButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.mikedown-toolbar button[data-action="share"]');

/** Ids of the entries in the open toolbar dropdown. */
function dropdownIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.tdd-item')).map(n => n.dataset.tddId as string);
}

describe('print and share', () => {
  it('renders no Share button (the only carrier of print) without printDocument, viewInBrowser or exportHtml', () => {
    const { el } = mount();
    expect(el.querySelector('.mikedown-toolbar')).not.toBeNull();
    expect(shareButton(el)).toBeNull();
  });

  it('renders Share with a Print entry when the host has printDocument', () => {
    const printDocument = vi.fn();
    const { el, handle } = mount({ onChange() {}, printDocument });
    handle.setMarkdown('# Title\n');
    expect(shareButton(el)).not.toBeNull();
    shareButton(el)!.click();
    expect(dropdownIds()).toEqual(['print']);
    document.querySelector<HTMLElement>('.tdd-item[data-tdd-id="print"]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(printDocument).toHaveBeenCalledTimes(1);
    expect(printDocument.mock.calls[0][0]).toContain('Title');
  });

  it('keeps Share but drops the Print entry when the host only has viewInBrowser', () => {
    const { el } = mount({ onChange() {}, viewInBrowser: vi.fn() });
    expect(shareButton(el)).not.toBeNull();
    shareButton(el)!.click();
    expect(dropdownIds()).toEqual(['viewInBrowser']);
  });
});

// ── Two editors on one page ──────────────────────────────────────────────────

describe('two editors on one page', () => {
  it('keep independent content, change notifications, and toolbar active states', () => {
    const changesA = vi.fn();
    const changesB = vi.fn();
    const a = mount({ onChange: changesA });
    const b = mount({ onChange: changesB });
    a.handle.setMarkdown('alpha **bold** text\n');
    b.handle.setMarkdown('beta plain text\n');

    expect(a.handle.getMarkdown()).toContain('alpha');
    expect(b.handle.getMarkdown()).toContain('beta');
    expect(a.handle.getMarkdown()).not.toContain('beta');

    // Put A's caret inside the bold run; B's caret stays in plain text.
    const find = (h: MikeDownEditorHandle, needle: string) => {
      let pos = -1;
      h.tiptap.state.doc.descendants((n, p) => { if (pos < 0 && n.isText && n.text!.includes(needle)) pos = p + 1; });
      return pos;
    };
    a.handle.tiptap.commands.setTextSelection(find(a.handle, 'bold'));
    b.handle.tiptap.commands.setTextSelection(find(b.handle, 'plain'));

    const textFormatActive = (el: HTMLElement) =>
      el.querySelector('.mikedown-toolbar button[data-action="textFormat"]')!.classList.contains('active');
    expect(a.handle.tiptap.isActive('bold')).toBe(true);
    expect(b.handle.tiptap.isActive('bold')).toBe(false);
    expect(textFormatActive(a.el)).toBe(true);
    expect(textFormatActive(b.el)).toBe(false);

    // An edit in B reaches only B's host and leaves A's document alone.
    const aBefore = a.handle.getMarkdown();
    const view = b.handle.tiptap.view;
    view.dispatch(view.state.tr.insertText('X', 1));
    expect(changesB).toHaveBeenCalledTimes(1);
    expect(changesA).not.toHaveBeenCalled();
    expect(a.handle.getMarkdown()).toBe(aBefore);

    // Destroying one leaves the other working.
    a.handle.destroy();
    view.dispatch(view.state.tr.insertText('Y', 1));
    expect(changesB).toHaveBeenCalledTimes(2);
  });
});
