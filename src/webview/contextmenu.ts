import { Editor } from '@tiptap/core';

export interface ContextMenuItem {
  label: string;
  action: () => void;
  separator?: false;
  disabled?: boolean;
}
export interface ContextMenuSeparator { separator: true; }
export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

let menuEl: HTMLElement | null = null;

export function showContextMenu(
  editor: Editor,
  x: number,
  y: number,
  items: ContextMenuEntry[]
): void {
  hideContextMenu();

  menuEl = document.createElement('div');
  menuEl.id = 'mikedown-context-menu';
  menuEl.setAttribute('role', 'menu');

  items.forEach(item => {
    if ('separator' in item && item.separator) {
      const sep = document.createElement('div');
      sep.className = 'cm-separator';
      menuEl!.appendChild(sep);
      return;
    }
    const el = document.createElement('div');
    el.className = 'cm-item' + ((item as ContextMenuItem).disabled ? ' cm-disabled' : '');
    el.textContent = (item as ContextMenuItem).label;
    el.setAttribute('role', 'menuitem');
    if (!(item as ContextMenuItem).disabled) {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        hideContextMenu();
        (item as ContextMenuItem).action();
      });
    }
    menuEl!.appendChild(el);
  });

  document.body.appendChild(menuEl);

  // Position: keep within viewport
  const vw = window.innerWidth, vh = window.innerHeight;
  const rect = menuEl.getBoundingClientRect();
  const left = Math.min(x, vw - rect.width - 4);
  const top = Math.min(y, vh - rect.height - 4);
  menuEl.style.left = `${Math.max(4, left)}px`;
  menuEl.style.top = `${Math.max(4, top)}px`;
}

export function hideContextMenu(): void {
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
}

export function buildTextMenu(editor: Editor): ContextMenuEntry[] {
  return [
    { label: `${editor.isActive('bold') ? '✓ ' : ''}Bold`, action: () => editor.chain().focus().toggleBold().run(), disabled: editor.isActive('codeBlock') },
    { label: `${editor.isActive('italic') ? '✓ ' : ''}Italic`, action: () => editor.chain().focus().toggleItalic().run(), disabled: editor.isActive('codeBlock') },
    { label: `${editor.isActive('strike') ? '✓ ' : ''}Strikethrough`, action: () => editor.chain().focus().toggleStrike().run(), disabled: editor.isActive('codeBlock') },
    { separator: true },
    { label: 'Heading 1', action: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: 'Heading 2', action: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'Heading 3', action: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: 'Paragraph', action: () => editor.chain().focus().setParagraph().run() },
    { separator: true },
    { label: 'Bullet List', action: () => editor.chain().focus().toggleBulletList().run() },
    { label: 'Ordered List', action: () => editor.chain().focus().toggleOrderedList().run() },
    { label: 'Task List', action: () => editor.chain().focus().toggleTaskList().run() },
    { label: 'Blockquote', action: () => editor.chain().focus().toggleBlockquote().run() },
    { separator: true },
    { label: 'Insert Link…', action: () => (window as any).__mikedownShowLinkDialog?.() },
    { label: 'Insert Image…', action: () => (window as any).__mikedownShowImageDialog?.() },
    { label: 'Insert Table', action: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { label: 'Horizontal Rule', action: () => editor.chain().focus().setHorizontalRule().run() },
  ];
}

export function buildLinkMenu(editor: Editor, href: string): ContextMenuEntry[] {
  const vscode = (window as any).acquireVsCodeApi ? (window as any).__vscode : null;
  return [
    { label: 'Open Link', action: () => { if (vscode) vscode.postMessage({ type: 'openLink', href }); } },
    { label: 'Copy Link', action: () => navigator.clipboard?.writeText(href).catch(() => {}) },
    { label: 'Edit Link…', action: () => {
      const newHref = window.prompt('Edit link URL:', href);
      if (newHref !== null) editor.chain().focus().extendMarkRange('link').setLink({ href: newHref }).run();
    }},
    { label: 'Remove Link', action: () => editor.chain().focus().extendMarkRange('link').unsetLink().run() },
  ];
}

export function buildTableMenu(editor: Editor): ContextMenuEntry[] {
  return [
    { label: 'Insert Row Above', action: () => editor.chain().focus().addRowBefore().run() },
    { label: 'Insert Row Below', action: () => editor.chain().focus().addRowAfter().run() },
    { label: 'Remove Row', action: () => editor.chain().focus().deleteRow().run() },
    { separator: true },
    { label: 'Insert Column Left', action: () => editor.chain().focus().addColumnBefore().run() },
    { label: 'Insert Column Right', action: () => editor.chain().focus().addColumnAfter().run() },
    { label: 'Remove Column', action: () => editor.chain().focus().deleteColumn().run() },
    { separator: true },
    { label: 'Align Left', action: () => editor.chain().focus().setCellAttribute('textAlign', 'left').run() },
    { label: 'Align Center', action: () => editor.chain().focus().setCellAttribute('textAlign', 'center').run() },
    { label: 'Align Right', action: () => editor.chain().focus().setCellAttribute('textAlign', 'right').run() },
    { separator: true },
    { label: 'Delete Table', action: () => editor.chain().focus().deleteTable().run() },
  ];
}

export function buildImageMenu(editor: Editor, imgEl: HTMLImageElement): ContextMenuEntry[] {
  return [
    { label: 'Edit Image…', action: () => imgEl.click() }, // triggers M7 popover
    { label: 'Remove Image', action: () => {
      const pos = editor.view.posAtDOM(imgEl, 0);
      editor.view.dispatch(editor.view.state.tr.delete(pos, pos + 1));
    }},
    { label: 'Copy Image Path', action: () => navigator.clipboard?.writeText(imgEl.getAttribute('src') || '').catch(() => {}) },
  ];
}
