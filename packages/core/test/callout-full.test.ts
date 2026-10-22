/**
 * Callout parse/serialize through the full extension set (createMikeDownEditor
 * with NoopHost). The minimal-editor tests in callout.test.ts miss
 * interactions with other extensions' markdown rules.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];
function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host: new NoopHost() });
  mounted.push({ handle, el });
  return { el, handle };
}
afterEach(() => {
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* ignore */ }
    el.remove();
  }
});

describe('callout with the full extension set', () => {
  const src = '> [!NOTE]\n> Text\n';

  it('loads the body once', () => {
    const { el, handle } = mount();
    handle.setMarkdown(src);
    expect(el.querySelector('blockquote[data-callout]')?.textContent).toBe('Text');
  });

  it('round-trips on save and on a second save', () => {
    const { handle } = mount();
    handle.setMarkdown(src);
    const first = handle.getMarkdown();
    expect(first.trim()).toBe('> [!NOTE]\n> Text');
    handle.setMarkdown(first);
    const second = handle.getMarkdown();
    expect(second.trim()).toBe('> [!NOTE]\n> Text');
  });
});
