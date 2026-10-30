/**
 * Menu-bar commands (`handle.command`) for hosts with native menus: headings,
 * paragraph, find, insert table/link/image and font zoom. Each mirrors an
 * existing toolbar action; rich-text edits are no-ops in source mode.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

function mount(markdown = 'Hello\n') {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host: new NoopHost(), initialMarkdown: markdown, hostOwnsShortcuts: true });
  mounted.push({ handle, el });
  return { el, handle };
}

afterEach(async () => {
  await new Promise(r => setTimeout(r, 30));
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  document.querySelectorAll('[role="dialog"]').forEach(n => (n.parentElement && n.parentElement !== document.body ? n.parentElement : n).remove());
});

describe('menu commands', () => {
  it('heading1..6 toggle the block and paragraph resets it', () => {
    const { handle } = mount('Hello\n');
    handle.command('heading2');
    expect(handle.getMarkdown().trim()).toBe('## Hello');
    handle.command('heading6');
    expect(handle.getMarkdown().trim()).toBe('###### Hello');
    handle.command('paragraph');
    expect(handle.getMarkdown().trim()).toBe('Hello');
  });

  it('headings are a no-op in source mode', () => {
    const { handle } = mount('Hello\n');
    handle.command('toggleSource');
    handle.command('heading1');
    expect(handle.getMarkdown().trim()).toBe('Hello');
  });

  it('insertTable opens the table size picker; a pick inserts the table', async () => {
    const { handle } = mount('Hello\n');
    handle.command('insertTable');
    await new Promise(r => setTimeout(r, 0));
    const cell = document.querySelector<HTMLElement>('#mikedown-table-picker .tp-cell[data-row="3"][data-col="3"]');
    expect(cell).not.toBeNull();
    cell!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const md = handle.getMarkdown();
    expect(md).toMatch(/\|.*\|.*\|.*\|/);
    expect(md).toMatch(/\| *:?-+:? *\|/);
    expect(document.getElementById('mikedown-table-picker')).toBeNull();
  });

  it('openFind focuses the find bar input', () => {
    const { handle } = mount('Hello\n');
    handle.command('openFind');
    expect((document.activeElement as HTMLElement | null)?.tagName).toBe('INPUT');
  });

  it('insertLink and insertImage open their dialogs', () => {
    const { handle } = mount('Hello\n');
    handle.command('insertLink');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    document.querySelectorAll('[role="dialog"]').forEach(n => (n.parentElement && n.parentElement !== document.body ? n.parentElement : n).remove());
    handle.command('insertImage');
    expect(document.querySelector('[aria-label="Insert Image"]')).not.toBeNull();
  });

  // Issue #12: with only the caret in a link, Update and an empty URL must
  // still reach the whole link.
  it('editing a link with only the caret in it updates the whole link', () => {
    const { handle } = mount('###### Six\n\nSee [the note](#old) here.\n');
    let caret = -1;
    handle.tiptap.state.doc.descendants((node, at) => {
      if (caret < 0 && node.isText && node.text?.includes('the note')) {caret = at + node.text.indexOf('the note') + 3;}
    });
    expect(caret).toBeGreaterThan(0);
    handle.tiptap.commands.setTextSelection(caret);
    handle.command('insertLink');
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    input.value = '#six';
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent === 'Update')!.click();
    expect(handle.getMarkdown()).toContain('See [the note](#six) here.');

    handle.tiptap.commands.setTextSelection(caret);
    handle.command('insertLink');
    document.querySelector<HTMLInputElement>('[role="dialog"] input')!.value = '';
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent === 'Update')!.click();
    expect(handle.getMarkdown()).toContain('See the note here.');
  });

  it('zoomIn / zoomOut / zoomReset step the editor font size', () => {
    const { el, handle } = mount('Hello\n');
    const size = (): number => {
      const root = el.querySelector<HTMLElement>('.mikedown-root');
      const v = root?.style.getPropertyValue('--mikedown-font-size') || document.documentElement.style.getPropertyValue('--mikedown-font-size');
      return parseInt(v || '0', 10);
    };
    handle.command('zoomIn');
    const up = size();
    handle.command('zoomOut');
    handle.command('zoomOut');
    expect(up - size()).toBe(2);
    handle.command('zoomReset');
    expect(size()).toBe(15);
  });
});
