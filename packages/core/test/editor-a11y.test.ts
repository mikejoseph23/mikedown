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
});
