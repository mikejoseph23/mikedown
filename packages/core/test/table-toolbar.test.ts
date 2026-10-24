/**
 * The floating table toolbar shows only while the user is working in a table:
 * a document that ends with a table leaves the cursor in it on load, and the
 * toolbar used to appear then, before anything had focus.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
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

const TABLE_LAST = '# Notes\n\nIntro\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';
const toolbar = () => document.getElementById('mikedown-table-toolbar');

function mount(markdown: string): MikeDownEditorHandle {
  el = document.createElement('div');
  document.body.appendChild(el);
  handle = createMikeDownEditor(el, { host: { onChange() {} }, initialMarkdown: markdown });
  return handle;
}

describe('table toolbar visibility', () => {
  it('stays hidden on load when the document ends with a table', () => {
    mount(TABLE_LAST);
    expect(toolbar()).toBeNull();
  });

  it('stays hidden when a host reloads a document that ends with a table', () => {
    const h = mount('Plain\n');
    h.setMarkdown(TABLE_LAST);
    h.setMarkdown(TABLE_LAST + '\nMore\n\n| C |\n| --- |\n| 3 |\n', { pristine: false });
    expect(toolbar()).toBeNull();
  });

  it('shows once the focused cursor is in a table, and hides when it leaves', () => {
    const h = mount(TABLE_LAST);
    const tiptap = h.tiptap;
    const { doc } = tiptap.state;
    let cellPos = -1;
    doc.descendants((node, pos) => {
      if (cellPos < 0 && node.type.name === 'tableCell') {cellPos = pos + 2;}
      return cellPos < 0;
    });
    tiptap.view.focus();
    tiptap.view.dispatch(tiptap.state.tr.setSelection(TextSelection.create(tiptap.state.doc, cellPos)));
    expect(toolbar()).not.toBeNull();

    tiptap.view.dispatch(tiptap.state.tr.setSelection(TextSelection.atStart(tiptap.state.doc)));
    expect(toolbar()).toBeNull();
  });
});
