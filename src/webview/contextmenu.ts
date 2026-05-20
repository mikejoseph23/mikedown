import { Editor } from '@tiptap/core';
import { hideTableToolbar } from './tablepicker';

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  action: () => void;
  separator?: false;
  submenu?: false;
  disabled?: boolean;
  isActive?: () => boolean;
}
export interface ContextMenuSeparator { separator: true; }
export interface ContextMenuSubmenu {
  submenu: true;
  label: string;
  items: ContextMenuEntry[];
}
export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator | ContextMenuSubmenu;

let menuEl: HTMLElement | null = null;
let submenuEl: HTMLElement | null = null;
let submenuHoverTimer: number | null = null;
let submenuOwnerEl: HTMLElement | null = null;

function clearSubmenuTimer(): void {
  if (submenuHoverTimer !== null) {
    clearTimeout(submenuHoverTimer);
    submenuHoverTimer = null;
  }
}

function hideSubmenu(): void {
  clearSubmenuTimer();
  if (submenuEl) {
    submenuEl.remove();
    submenuEl = null;
  }
  if (submenuOwnerEl) {
    submenuOwnerEl.classList.remove('cm-submenu-open');
    submenuOwnerEl = null;
  }
}

function buildMenuItemEl(item: ContextMenuItem): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cm-item' + (item.disabled ? ' cm-disabled' : '') + (item.isActive?.() ? ' cm-active' : '');
  el.setAttribute('role', 'menuitem');

  const indicator = document.createElement('span');
  indicator.className = 'cm-item-active-indicator';
  el.appendChild(indicator);

  const labelSpan = document.createElement('span');
  labelSpan.className = 'cm-item-label';
  labelSpan.textContent = item.label;
  el.appendChild(labelSpan);

  if (item.shortcut) {
    const shortcutSpan = document.createElement('span');
    shortcutSpan.className = 'cm-item-shortcut';
    shortcutSpan.textContent = item.shortcut;
    el.appendChild(shortcutSpan);
  }

  if (!item.disabled) {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      hideContextMenu();
      item.action();
    });
  }

  return el;
}

function buildSubmenuParentEl(entry: ContextMenuSubmenu): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cm-item cm-has-submenu';
  el.setAttribute('role', 'menuitem');
  el.setAttribute('aria-haspopup', 'true');

  const indicator = document.createElement('span');
  indicator.className = 'cm-item-active-indicator';
  el.appendChild(indicator);

  const labelSpan = document.createElement('span');
  labelSpan.className = 'cm-item-label';
  labelSpan.textContent = entry.label;
  el.appendChild(labelSpan);

  const chevron = document.createElement('span');
  chevron.className = 'cm-item-chevron';
  chevron.textContent = '▸';
  el.appendChild(chevron);

  const openSubmenu = (): void => {
    if (submenuOwnerEl === el && submenuEl) return;
    hideSubmenu();
    submenuOwnerEl = el;
    el.classList.add('cm-submenu-open');
    submenuEl = renderMenuContainer(entry.items, true);
    document.body.appendChild(submenuEl);
    positionSubmenu(submenuEl, el);
  };

  el.addEventListener('mouseenter', () => {
    clearSubmenuTimer();
    submenuHoverTimer = window.setTimeout(openSubmenu, 150);
  });

  el.addEventListener('mouseleave', () => {
    clearSubmenuTimer();
  });

  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openSubmenu();
  });

  return el;
}

function renderMenuContainer(items: ContextMenuEntry[], isSubmenu: boolean): HTMLElement {
  const container = document.createElement('div');
  container.id = isSubmenu ? 'mikedown-context-submenu' : 'mikedown-context-menu';
  container.setAttribute('role', 'menu');

  if (!isSubmenu) {
    container.addEventListener('mouseover', (e) => {
      const target = e.target as HTMLElement;
      const parent = target.closest('.cm-item');
      if (parent && !parent.classList.contains('cm-has-submenu')) {
        if (submenuOwnerEl && submenuOwnerEl !== parent) {
          clearSubmenuTimer();
          submenuHoverTimer = window.setTimeout(hideSubmenu, 150);
        }
      }
    });
  }

  items.forEach(item => {
    if ('separator' in item && item.separator) {
      const sep = document.createElement('div');
      sep.className = 'cm-separator';
      container.appendChild(sep);
      return;
    }
    if ('submenu' in item && item.submenu) {
      container.appendChild(buildSubmenuParentEl(item));
      return;
    }
    container.appendChild(buildMenuItemEl(item as ContextMenuItem));
  });

  return container;
}

function positionSubmenu(menu: HTMLElement, parent: HTMLElement): void {
  const parentRect = parent.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;

  menu.style.visibility = 'hidden';
  menu.style.left = '0px';
  menu.style.top = '0px';
  const rect = menu.getBoundingClientRect();

  const gapRight = vw - parentRect.right;
  const gapLeft = parentRect.left;
  let left: number;
  if (gapRight >= rect.width + 4 || gapRight >= gapLeft) {
    left = parentRect.right - 2;
  } else {
    left = parentRect.left - rect.width + 2;
  }
  left = Math.max(4, Math.min(left, vw - rect.width - 4));

  let top = parentRect.top - 4;
  top = Math.max(4, Math.min(top, vh - rect.height - 4));

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = '';
}

export function showContextMenu(
  editor: Editor,
  x: number,
  y: number,
  items: ContextMenuEntry[]
): void {
  hideContextMenu();
  hideTableToolbar();

  menuEl = renderMenuContainer(items, false);
  document.body.appendChild(menuEl);

  const vw = window.innerWidth, vh = window.innerHeight;
  const rect = menuEl.getBoundingClientRect();
  const left = Math.min(x, vw - rect.width - 4);
  const top = Math.min(y, vh - rect.height - 4);
  menuEl.style.left = `${Math.max(4, left)}px`;
  menuEl.style.top = `${Math.max(4, top)}px`;
}

export function hideContextMenu(): void {
  hideSubmenu();
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
}

export function buildTextMenu(editor: Editor): ContextMenuEntry[] {
  const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';
  const shift = navigator.platform.includes('Mac') ? '⇧' : 'Shift+';
  return [
    { label: 'Bold', shortcut: `${mod}B`, action: () => editor.chain().focus().toggleBold().run(), isActive: () => editor.isActive('bold') },
    { label: 'Italic', shortcut: `${mod}I`, action: () => editor.chain().focus().toggleItalic().run(), isActive: () => editor.isActive('italic') },
    { label: 'Strikethrough', shortcut: `${mod}${shift}S`, action: () => editor.chain().focus().toggleStrike().run(), isActive: () => editor.isActive('strike') },
    { label: 'Highlight', shortcut: `${mod}${shift}H`, action: () => editor.chain().focus().toggleHighlight().run(), isActive: () => editor.isActive('highlight') },
    { separator: true },
    {
      submenu: true,
      label: 'Heading',
      items: [
        { label: 'Paragraph', action: () => editor.chain().focus().setParagraph().run(), isActive: () => !editor.isActive('heading') && !editor.isActive('codeBlock') && !editor.isActive('blockquote') },
        { label: 'Heading 1', action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), isActive: () => editor.isActive('heading', { level: 1 }) },
        { label: 'Heading 2', action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), isActive: () => editor.isActive('heading', { level: 2 }) },
        { label: 'Heading 3', action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), isActive: () => editor.isActive('heading', { level: 3 }) },
      ],
    },
    {
      submenu: true,
      label: 'List',
      items: [
        { label: 'Bullet List', action: () => editor.chain().focus().toggleBulletList().run(), isActive: () => editor.isActive('bulletList') },
        { label: 'Ordered List', action: () => editor.chain().focus().toggleOrderedList().run(), isActive: () => editor.isActive('orderedList') },
        { label: 'Task List', action: () => editor.chain().focus().toggleTaskList().run(), isActive: () => editor.isActive('taskList') },
      ],
    },
    { label: 'Quote', action: () => editor.chain().focus().toggleBlockquote().run(), isActive: () => editor.isActive('blockquote') },
    {
      submenu: true,
      label: 'Callout',
      items: [
        { label: 'Note', action: () => editor.chain().focus().toggleCallout('note').run(), isActive: () => editor.isActive('callout', { kind: 'note' }) },
        { label: 'Tip', action: () => editor.chain().focus().toggleCallout('tip').run(), isActive: () => editor.isActive('callout', { kind: 'tip' }) },
        { label: 'Important', action: () => editor.chain().focus().toggleCallout('important').run(), isActive: () => editor.isActive('callout', { kind: 'important' }) },
        { label: 'Warning', action: () => editor.chain().focus().toggleCallout('warning').run(), isActive: () => editor.isActive('callout', { kind: 'warning' }) },
        { label: 'Caution', action: () => editor.chain().focus().toggleCallout('caution').run(), isActive: () => editor.isActive('callout', { kind: 'caution' }) },
      ],
    },
    { separator: true },
    {
      submenu: true,
      label: 'Insert',
      items: [
        { label: 'Link…', shortcut: `${mod}K`, action: () => (window as any).__mikedownShowLinkDialog?.() },
        { label: 'Image…', action: () => (window as any).__mikedownShowImageDialog?.() },
        { label: 'Table', action: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
        { label: 'Horizontal Rule', action: () => editor.chain().focus().setHorizontalRule().run() },
      ],
    },
    { separator: true },
    { label: 'Insert Emoji…', shortcut: `${mod};`, action: () => (window as any).__mikedownShowEmojiPicker?.() },
  ];
}

export function buildCodeBlockMenu(editor: Editor): ContextMenuEntry[] {
  return [
    {
      label: 'Set language…',
      action: () => (window as any).__mikedownShowLanguagePicker?.(),
    },
    {
      label: 'Copy code',
      action: () => {
        const text = getCurrentCodeBlockText(editor);
        if (text !== null) navigator.clipboard?.writeText(text).catch(() => {});
      },
    },
    { separator: true },
    {
      label: 'Delete code block',
      action: () => {
        const { state, dispatch } = editor.view;
        const $from = state.selection.$from;
        for (let depth = $from.depth; depth > 0; depth--) {
          const node = $from.node(depth);
          if (node.type.name === 'codeBlock') {
            const start = $from.before(depth);
            const end = $from.after(depth);
            dispatch(state.tr.delete(start, end));
            editor.view.focus();
            return;
          }
        }
      },
    },
  ];
}

function getCurrentCodeBlockText(editor: Editor): string | null {
  const $from = editor.state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === 'codeBlock') return node.textContent;
  }
  return null;
}

export function buildLinkMenu(editor: Editor, href: string): ContextMenuEntry[] {
  const vscode = (window as any).__vscode ?? null;
  const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';
  const isExternal = href.startsWith('http://') || href.startsWith('https://');
  const isMailto = /^mailto:/i.test(href);
  const isTel = /^tel:/i.test(href);
  const isUriScheme = isExternal || isMailto || isTel || /^(sms|ftp|ftps|news|nntp|magnet|irc|xmpp|skype|callto|geo|bitcoin):/i.test(href);
  const openLabel = isMailto ? 'Send Email' : isTel ? 'Call' : 'Open Link';
  const copyLabel = isMailto ? 'Copy Email Address' : isTel ? 'Copy Phone Number' : 'Copy Link';
  const copyValue = isMailto ? href.slice(7) : isTel ? href.slice(4) : href;
  return [
    {
      label: openLabel,
      shortcut: `${mod}Click`,
      action: () => { if (vscode) vscode.postMessage({ type: 'openLink', href, behavior: 'navigateCurrentTab' }); },
    },
    ...(isUriScheme ? [] : [{
      label: 'Open Link in New Tab',
      action: () => { if (vscode) vscode.postMessage({ type: 'openLink', href, behavior: 'openNewTab' }); },
    } as ContextMenuItem]),
    { separator: true } as ContextMenuSeparator,
    { label: copyLabel, action: () => navigator.clipboard?.writeText(copyValue).catch(() => {}) },
    { label: 'Edit Link…', action: () => {
      (window as any).__mikedownShowLinkDialog?.();
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

export interface ImageMenuActions {
  resize: (img: HTMLImageElement, percent: number) => void;
}

export function buildImageMenu(
  editor: Editor,
  imgEl: HTMLImageElement,
  actions?: ImageMenuActions
): ContextMenuEntry[] {
  const entries: ContextMenuEntry[] = [
    { label: 'Edit Image…', action: () => imgEl.click() }, // triggers M7 popover
    { label: 'Copy Image Path', action: () => navigator.clipboard?.writeText(imgEl.getAttribute('src') || '').catch(() => {}) },
  ];
  if (actions) {
    entries.push({ separator: true });
    entries.push({ label: 'Resize 75%', action: () => actions.resize(imgEl, 75) });
    entries.push({ label: 'Resize 50%', action: () => actions.resize(imgEl, 50) });
    entries.push({ label: 'Resize 25%', action: () => actions.resize(imgEl, 25) });
  }
  entries.push({ separator: true });
  entries.push({
    label: 'Remove Image',
    action: () => {
      const pos = editor.view.posAtDOM(imgEl, 0);
      editor.view.dispatch(editor.view.state.tr.delete(pos, pos + 1));
    },
  });
  return entries;
}
