/**
 * Mod-/ toggles source mode in the core, in both the rich editor and the
 * source view, unless the host owns the shortcut (hostOwnsShortcuts).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

function mount(options: Record<string, unknown> = {}) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host: new NoopHost(), initialMarkdown: '# Hi\n', ...options });
  mounted.push({ handle, el });
  return { el, handle };
}

// Mode switches finish scroll restoration on a 10ms timer; let it run before teardown.
afterEach(async () => {
  await new Promise(r => setTimeout(r, 30));
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
});

const inSource = (el: HTMLElement) => {
  const box = el.querySelector<HTMLElement>('.mikedown-source-container');
  return !!box && box.style.display !== 'none' && !!box.querySelector('.cm-editor');
};

function pressModSlash(target: Element): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'Slash', ctrlKey: true, bubbles: true, cancelable: true }));
}

describe('Mod-/ source toggle', () => {
  it('toggles into and out of source mode when the core owns the shortcut', () => {
    const { el } = mount();
    expect(inSource(el)).toBe(false);
    pressModSlash(el.querySelector('.ProseMirror')!);
    expect(inSource(el)).toBe(true);
    pressModSlash(el.querySelector('.cm-content')!);
    expect(inSource(el)).toBe(false);
  });

  it('does nothing when the host owns the shortcut', () => {
    const { el, handle } = mount({ hostOwnsShortcuts: true });
    pressModSlash(el.querySelector('.ProseMirror')!);
    expect(inSource(el)).toBe(false);
    // The host's own binding still toggles through the command.
    handle.command('toggleSource');
    expect(inSource(el)).toBe(true);
    pressModSlash(el.querySelector('.cm-content')!);
    expect(inSource(el)).toBe(true);
  });
});
