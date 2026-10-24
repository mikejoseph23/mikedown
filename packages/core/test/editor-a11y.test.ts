/**
 * The contenteditable textbox has an accessible name (axe: aria-input-field-name),
 * so a screen reader announces more than "edit text".
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

describe('editor accessibility', () => {
  it('names the rich-text textbox and marks it multiline', () => {
    el = document.createElement('div');
    document.body.appendChild(el);
    handle = createMikeDownEditor(el, { host: { onChange() {} }, initialMarkdown: '# Hi\n\nBody\n' });
    const box = el.querySelector('.ProseMirror') as HTMLElement;
    expect(box.getAttribute('role')).toBe('textbox');
    expect(box.getAttribute('aria-label')).toBe('Document text');
    expect(box.getAttribute('aria-multiline')).toBe('true');
  });

  it('names each task checkbox after its item and follows edits', () => {
    el = document.createElement('div');
    document.body.appendChild(el);
    handle = createMikeDownEditor(el, {
      host: { onChange() {} },
      initialMarkdown: '- [ ] Buy milk\n- [x] Call **Sam**\n  - [ ] Sub task\n',
    });
    const boxes = () => Array.from(el!.querySelectorAll<HTMLInputElement>('li.task-list-item input[type="checkbox"]'));
    expect(boxes().map((b) => b.getAttribute('aria-label'))).toEqual(['Buy milk', 'Call Sam', 'Sub task']);

    handle.setMarkdown('- [ ] Buy oat milk\n', { pristine: false });
    expect(boxes().map((b) => b.getAttribute('aria-label'))).toEqual(['Buy oat milk']);
  });

  it('starts toolbar button names with their visible text', () => {
    el = document.createElement('div');
    document.body.appendChild(el);
    handle = createMikeDownEditor(el, { host: { onChange() {} }, initialMarkdown: '# Title\n\nBody\n' });
    const btn = (action: string) => el!.querySelector<HTMLButtonElement>(`.mikedown-toolbar button[data-action="${action}"]`)!;
    for (const action of ['textFormat', 'zoomReset']) {
      const visible = (btn(action).textContent ?? '').trim();
      expect(visible).not.toBe('');
      expect(btn(action).getAttribute('aria-label')!.startsWith(visible)).toBe(true);
    }
  });
});
