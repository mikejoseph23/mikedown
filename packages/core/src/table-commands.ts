import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { isInTable, selectedRect } from '@tiptap/pm/tables';
import { showTableGridPicker } from './tablepicker';

function isMac(): boolean {
  return typeof navigator !== 'undefined'
    && (navigator.platform?.startsWith('Mac') || navigator.userAgent.includes('Macintosh'));
}

/** Cmd on macOS, Ctrl elsewhere. */
export function hasModKey(event: KeyboardEvent): boolean {
  return isMac() ? event.metaKey : event.ctrlKey;
}

/** Add a row above or below the cursor's row and put the cursor in it, same column. */
export function addRowAndFocus(editor: Editor, where: 'above' | 'below'): boolean {
  const ok = where === 'below'
    ? editor.chain().focus().addRowAfter().run()
    : editor.chain().focus().addRowBefore().run();
  if (!ok) {return false;}
  const { state, view } = editor;
  if (!isInTable(state)) {return true;}
  const rect = selectedRect(state);
  const row = where === 'below' ? rect.bottom : rect.top - 1;
  if (row < 0 || row >= rect.map.height) {return true;}
  const cellPos = rect.tableStart + rect.map.map[row * rect.map.width + rect.left];
  view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(cellPos + 1))));
  return true;
}

/**
 * Select the whole table around the cursor as a node, so copy, cut and
 * Backspace act on the table.
 */
export function selectTable(editor: Editor): boolean {
  const { state, view } = editor;
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'table') {
      view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, $from.before(d))));
      view.focus();
      return true;
    }
  }
  return false;
}

/**
 * Open the table size picker at the cursor (the Insert Table command and the
 * right-click Insert > Table). Deferred a tick: menu items act on mousedown,
 * and the document mousedown that follows would close a picker opened now.
 */
export function showTablePickerAtCursor(editor: Editor): void {
  setTimeout(() => {
    if (editor.isDestroyed) {return;}
    let rect: { left: number; right: number; top: number; bottom: number };
    try {
      rect = editor.view.coordsAtPos(editor.state.selection.from);
    } catch {
      rect = editor.view.dom.getBoundingClientRect();
    }
    showTableGridPicker(editor, rect);
  }, 0);
}
