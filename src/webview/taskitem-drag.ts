/**
 * Task-list item with HTML5 drag handle.
 *
 * Hover over a task item to reveal a drag handle (⋮⋮) to the left of the
 * checkbox. Click-and-drag the handle to reorder items within a task list or
 * move them to a different task list. ProseMirror's built-in drag/drop
 * handles the slice insertion — when dragging a `taskItem` into a plain
 * bullet list or paragraph, PM inserts a new `taskList` as a sibling so the
 * task-item type is preserved.
 *
 * Clicking the checkbox toggles via a transaction (the stock click-to-toggle
 * path is bypassed because we own the NodeView DOM).
 */

import { TaskItem } from '@tiptap/extension-task-item';
import { NodeSelection } from '@tiptap/pm/state';

export const DraggableTaskItem = TaskItem.extend({
  draggable: true,

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const li = document.createElement('li');
      li.classList.add('task-list-item');
      li.setAttribute('data-checked', String(!!node.attrs.checked));

      const handle = document.createElement('span');
      handle.className = 'mikedown-taskitem-handle';
      handle.contentEditable = 'false';
      handle.draggable = true;
      handle.setAttribute('aria-label', 'Drag to reorder');
      handle.setAttribute('title', 'Drag to reorder');
      handle.textContent = '⋮⋮';

      const label = document.createElement('label');
      label.contentEditable = 'false';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!node.attrs.checked;
      const bullet = document.createElement('span');
      label.append(checkbox, bullet);

      const content = document.createElement('div');

      li.append(handle, label, content);

      // Toggle checked via transaction. We own the NodeView DOM, so the stock
      // TipTap click-to-toggle doesn't fire.
      checkbox.addEventListener('change', () => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos == null) return;
        editor.view.dispatch(
          editor.view.state.tr.setNodeAttribute(pos, 'checked', checkbox.checked),
        );
      });

      // HTML5 native drag: put a NodeSelection on the task item, then let
      // ProseMirror's built-in dragstart take over (it reads state.selection
      // and sets view.dragging for us).
      handle.addEventListener('dragstart', (e) => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos == null) return;
        const { view } = editor;
        view.dispatch(
          view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)),
        );
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          const rect = li.getBoundingClientRect();
          e.dataTransfer.setDragImage(li, 12, Math.min(18, rect.height / 2));
        }
      });

      return {
        dom: li,
        contentDOM: content,
        update(updated) {
          if (updated.type !== node.type) return false;
          const checked = !!updated.attrs.checked;
          li.setAttribute('data-checked', String(checked));
          if (checkbox.checked !== checked) checkbox.checked = checked;
          return true;
        },
        // Let the checkbox change event and the handle dragstart run without
        // ProseMirror trying to take over.
        stopEvent(e) {
          if (handle.contains(e.target as Node)) return true;
          if (label.contains(e.target as Node) && e.type !== 'mousedown') return true;
          return false;
        },
        ignoreMutation(mutation) {
          if (mutation.target === li && mutation.attributeName === 'data-checked') return true;
          if (handle.contains(mutation.target as Node)) return true;
          if (label.contains(mutation.target as Node)) return true;
          return false;
        },
      };
    };
  },
});
