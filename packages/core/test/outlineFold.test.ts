/**
 * Foldable outline headings: the pure descendant/fold logic, and the sidebar
 * wiring (chevrons, Fold all / Unfold all, folds kept across edits, the active
 * heading falling back to its nearest visible ancestor).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasDescendants, hiddenByFolds, nearestVisibleIndex } from '../src/outlineFold';
import { createMikeDownEditor, type MikeDownEditorHandle } from '../src/index';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

describe('outline fold logic', () => {
  // H1 A, H2 B, H3 C, H2 D, H1 E, H3 F (skipped level), H2 G
  const levels = [1, 2, 3, 2, 1, 3, 2];
  const none = levels.map(() => false);
  const foldAt = (...idx: number[]) => levels.map((_, i) => idx.includes(i));

  it('finds headings with descendants, including across a skipped level', () => {
    expect(hasDescendants(levels)).toEqual([true, true, false, false, true, false, false]);
    expect(hasDescendants([])).toEqual([]);
    expect(hasDescendants([3, 2, 1])).toEqual([false, false, false]);
  });

  it('hides descendants up to the next same-or-higher heading', () => {
    expect(hiddenByFolds(levels, none)).toEqual(none);
    expect(hiddenByFolds(levels, foldAt(1))).toEqual([false, false, true, false, false, false, false]);
    expect(hiddenByFolds(levels, foldAt(0))).toEqual([false, true, true, true, false, false, false]);
    // H3 F is under E but G (H2) is not under F.
    expect(hiddenByFolds(levels, foldAt(5))).toEqual(none);
    expect(hiddenByFolds(levels, foldAt(4))).toEqual([false, false, false, false, false, true, true]);
  });

  it('nested folds stay hidden under a folded ancestor and resurface when it unfolds', () => {
    expect(hiddenByFolds(levels, foldAt(0, 1))).toEqual([false, true, true, true, false, false, false]);
    expect(hiddenByFolds(levels, foldAt(1))[3]).toBe(false);
  });

  it('maps a hidden active heading to its nearest visible ancestor', () => {
    const hidden = hiddenByFolds(levels, foldAt(0, 1));
    expect(nearestVisibleIndex(hidden, 2)).toBe(0);
    expect(nearestVisibleIndex(hidden, 4)).toBe(4);
    expect(nearestVisibleIndex(hiddenByFolds(levels, foldAt(1)), 2)).toBe(1);
    expect(nearestVisibleIndex(hidden, -1)).toBe(-1);
  });
});

describe('outline folding in the sidebar', () => {
  const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];
  afterEach(() => {
    while (mounted.length) {
      const { handle, el } = mounted.pop()!;
      try { handle.destroy(); } catch { /* already destroyed */ }
      el.remove();
    }
    vi.restoreAllMocks();
  });

  function mount(markdown: string) {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = createMikeDownEditor(el, { host: { onChange() {} }, initialMarkdown: markdown, features: { sidebar: true } });
    mounted.push({ handle, el });
    handle.command('toggleSidebar');
    const row = (text: string) => [...el.querySelectorAll<HTMLElement>('.outline-row')]
      .find((r) => r.querySelector('.outline-item')?.textContent === text)!;
    const visible = () => [...el.querySelectorAll<HTMLElement>('.outline-row')]
      .filter((r) => !r.hidden).map((r) => r.querySelector('.outline-item')!.textContent);
    return { el, handle, row, visible };
  }

  const DOC = '# Intro\n\n## Setup\n\n### Install\n\nText.\n\n## Usage\n\n# Appendix\n';

  it('puts a chevron only on headings with descendants and folds without navigating', () => {
    const s = mount(DOC);
    expect([...s.el.querySelectorAll('.outline-row')].map((r) => !!r.querySelector('.outline-fold')))
      .toEqual([true, true, false, false, false]);
    const scroll = vi.fn(); // jsdom has no scrollIntoView
    HTMLElement.prototype.scrollIntoView = scroll;
    const fold = s.row('Setup').querySelector<HTMLButtonElement>('.outline-fold')!;
    fold.click();
    expect(scroll).not.toHaveBeenCalled();
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(s.visible()).toEqual(['Intro', 'Setup', 'Usage', 'Appendix']);
    fold.click();
    expect(s.visible()).toEqual(['Intro', 'Setup', 'Install', 'Usage', 'Appendix']);
    s.row('Setup').querySelector<HTMLButtonElement>('.outline-item')!.click();
    expect(scroll).toHaveBeenCalledTimes(1);
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });

  it('Fold all / Unfold all in the Outline header', () => {
    const s = mount(DOC);
    s.el.querySelector<HTMLButtonElement>('.outline-fold-all')!.click();
    expect(s.visible()).toEqual(['Intro', 'Appendix']);
    // Section itself stays expanded.
    expect(s.el.querySelector('.outline-section')?.classList.contains('collapsed')).toBe(false);
    s.row('Intro').querySelector<HTMLButtonElement>('.outline-fold')!.click();
    expect(s.visible()).toEqual(['Intro', 'Setup', 'Usage', 'Appendix']);
    s.el.querySelector<HTMLButtonElement>('.outline-unfold-all')!.click();
    expect(s.visible()).toEqual(['Intro', 'Setup', 'Install', 'Usage', 'Appendix']);
  });

  it('keeps folds when the outline re-renders after an edit', () => {
    const s = mount(DOC);
    s.row('Setup').querySelector<HTMLButtonElement>('.outline-fold')!.click();
    s.handle.setMarkdown(DOC.replace('# Appendix', '# Appendix\n\n## Notes'));
    expect(s.visible()).toEqual(['Intro', 'Setup', 'Usage', 'Appendix', 'Notes']);
    expect(s.row('Setup').classList.contains('folded')).toBe(true);
  });

  it('highlights the nearest visible ancestor when the active heading is folded away', () => {
    const s = mount(DOC);
    const ed = s.handle.tiptap;
    let pos = 0;
    ed.state.doc.forEach((node, offset) => { if (node.textContent === 'Install') {pos = offset + 1;} });
    ed.commands.setTextSelection(pos);
    const active = () => [...s.el.querySelectorAll('.outline-item.active')].map((n) => n.textContent);
    expect(active()).toEqual(['Install']);
    s.row('Intro').querySelector<HTMLButtonElement>('.outline-fold')!.click();
    expect(active()).toEqual(['Intro']);
    s.el.querySelector<HTMLButtonElement>('.outline-unfold-all')!.click();
    expect(active()).toEqual(['Install']);
  });
});
