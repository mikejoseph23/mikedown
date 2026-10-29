/**
 * Opening a document with the sidebar already showing must leave the Outline
 * at its first heading. TipTap's setContent parks the cursor at the end of the
 * document for a moment (the history reset then moves it back to the start
 * without a selectionUpdate), and the outline used to follow that transient
 * cursor down to the last heading and scroll its list to the bottom.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, type MikeDownEditorHandle } from '../src/index';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const ROW_HEIGHT = 20;
const LIST_HEIGHT = 60;

describe('outline list on document load', () => {
  const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];
  afterEach(() => {
    while (mounted.length) {
      const { handle, el } = mounted.pop()!;
      try { handle.destroy(); } catch { /* already destroyed */ }
      el.remove();
    }
    vi.restoreAllMocks();
  });

  function mountWithSidebarOpen() {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Fake a short scrolling list: each row is ROW_HEIGHT tall, stacked.
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains('outline-row')) {return 0;}
      return [...this.parentElement!.children].indexOf(this) * ROW_HEIGHT;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(ROW_HEIGHT);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(LIST_HEIGHT);
    const scrollTo = vi.fn();
    HTMLElement.prototype.scrollTo = scrollTo as any;

    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = createMikeDownEditor(el, { host: { onChange() {} }, initialMarkdown: '', features: { sidebar: true } });
    mounted.push({ handle, el });
    handle.command('toggleSidebar');
    const active = () => [...el.querySelectorAll('.outline-item.active')].map((n) => n.textContent);
    return { el, handle, active, scrollTo };
  }

  const DOC = Array.from({ length: 12 }, (_, i) => `## Section ${i + 1}\n\nBody ${i + 1}.\n`).join('\n');

  it('keeps the first heading active and does not scroll the list to the bottom', async () => {
    const s = mountWithSidebarOpen();
    s.handle.setMarkdown(DOC);
    await Promise.resolve();
    await Promise.resolve();
    expect(s.active()).toEqual(['Section 1']);
    const downward = s.scrollTo.mock.calls.filter(([opts]) => (opts?.top ?? 0) > 0);
    expect(downward).toEqual([]);
  });

  it('reloading with the outline already filled does not jump to the last heading', async () => {
    const s = mountWithSidebarOpen();
    s.handle.setMarkdown(DOC);
    await Promise.resolve();
    s.scrollTo.mockClear();
    s.handle.setMarkdown(DOC.replace(/Section/g, 'Part'));
    await Promise.resolve();
    expect(s.active()).toEqual(['Part 1']);
    expect(s.scrollTo.mock.calls.filter(([opts]) => (opts?.top ?? 0) > 0)).toEqual([]);
  });

  it('still follows the cursor once the user moves it', async () => {
    const s = mountWithSidebarOpen();
    s.handle.setMarkdown(DOC);
    await Promise.resolve();
    const ed = s.handle.tiptap;
    let pos = 0;
    ed.state.doc.forEach((node, offset) => { if (node.textContent === 'Section 10') {pos = offset + 1;} });
    ed.commands.setTextSelection(pos);
    expect(s.active()).toEqual(['Section 10']);
    await Promise.resolve();
    // Row 10 sits at 9 * 20 = 180, below the 60px view: scroll so it shows.
    expect(s.scrollTo).toHaveBeenLastCalledWith({ top: 9 * ROW_HEIGHT + ROW_HEIGHT - LIST_HEIGHT + 4, behavior: 'smooth' });
  });
});
