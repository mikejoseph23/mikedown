/**
 * `[ ]` / `[x]` in a table cell render as checkboxes in the core editor (so
 * every host, not just VS Code), and clicking one toggles the saved markdown.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createMikeDownEditor, type MikeDownEditorHandle } from '../src/index';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

let handle: MikeDownEditorHandle | null = null;
let el: HTMLElement | null = null;

afterEach(() => {
  handle?.destroy();
  el?.remove();
  handle = null;
  el = null;
});

describe('table checkboxes', () => {
  it('renders cell checkboxes and toggles the markdown on click', () => {
    el = document.createElement('div');
    document.body.appendChild(el);
    let saved = '';
    handle = createMikeDownEditor(el, {
      host: { onChange(md: string) { saved = md; } },
      initialMarkdown: '| Done | Task |\n| --- | --- |\n| [ ] | Milk |\n| [x] | Eggs |\n',
    });
    const boxes = () => Array.from(el!.querySelectorAll<HTMLInputElement>('td input.table-checkbox'));
    expect(boxes().map((b) => b.checked)).toEqual([false, true]);

    boxes()[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(boxes().map((b) => b.checked)).toEqual([true, true]);
    expect(saved).toContain("| [x] | Milk |");
    expect(saved).toContain("| [x] | Eggs |");
  });
});
