/**
 * The native menu bar as data (edge case 23), built from the command table
 * in `shortcuts.ts` and handed to Rust (`menu_set`, `src-tauri/src/menu.rs`),
 * which turns it into a Tauri `Menu`. Labels and accelerators come from the
 * table rows; this file only decides the order, the submenus, the separators
 * and the OS conventions:
 *
 * - macOS: an app menu (About, Settings… `Cmd+,`, Services, Hide, Quit
 *   `Cmd+Q`); File ends with Close Window; the Window menu is the system one.
 * - Windows: Settings… under File, Exit (`Alt+F4`) at the end of File, About
 *   under Help.
 *
 * `predefined` items are the OS's own (clipboard, Services, Hide, Minimize):
 * the webview needs the native Cut/Copy/Paste items for the clipboard on
 * macOS. `Open Recent` is filled at runtime (`menu_set_recents`).
 */
import { rowFor, type CommandId } from './shortcuts';

export type PredefinedRole =
  | 'about' | 'services' | 'hide' | 'hideOthers' | 'showAll'
  | 'cut' | 'copy' | 'paste' | 'selectAll'
  | 'minimize' | 'maximize' | 'fullscreen' | 'bringAllToFront';

export type MenuNode =
  | { kind: 'item'; id: string; label: string; accelerator?: string; enabled?: boolean }
  | { kind: 'separator' }
  | { kind: 'predefined'; role: PredefinedRole }
  | { kind: 'submenu'; id?: string; label: string; items: MenuNode[]; role?: 'window' | 'help' };

export const OPEN_RECENT_ID = 'openRecent';
export const RECENT_FOLDER_PREFIX = 'recent-folder:';
export const RECENT_FILE_PREFIX = 'recent-file:';

const sep: MenuNode = { kind: 'separator' };
const pre = (role: PredefinedRole): MenuNode => ({ kind: 'predefined', role });

function item(command: CommandId, isMac: boolean): MenuNode {
  const row = rowFor(command, isMac);
  if (!row) {throw new Error(`menu: no ${isMac ? 'macOS' : 'Windows'} row for ${command}`);}
  const node: MenuNode = { kind: 'item', id: command, label: row.label };
  if (row.accelerator && !row.hideAccelerator) {node.accelerator = row.accelerator;}
  return node;
}

export function buildMenuSpec(isMac: boolean): MenuNode[] {
  const i = (c: CommandId) => item(c, isMac);
  const openRecent: MenuNode = { kind: 'submenu', id: OPEN_RECENT_ID, label: 'Open Recent', items: [i('clearRecents')] };

  const file: MenuNode = {
    kind: 'submenu',
    label: 'File',
    items: [
      i('newDocument'), i('newWindow'), sep,
      i('open'), i('openFolder'), openRecent, sep,
      i('save'), i('saveAs'), i('saveAll'), sep,
      i('openContainingFolder'), i('reveal'), sep,
      { kind: 'submenu', label: 'Export', items: [i('exportHtml'), i('exportPdf')] },
      i('print'), sep,
      ...(isMac ? [] : [i('openSettings'), sep]),
      i('closeTab'), i('closeWindow'),
      ...(isMac ? [] : [sep, i('quit')]),
    ],
  };

  const edit: MenuNode = {
    kind: 'submenu',
    label: 'Edit',
    items: [
      i('undo'), i('redo'), sep,
      pre('cut'), pre('copy'), pre('paste'), i('pasteWithoutFormatting'), pre('selectAll'), sep,
      i('openFind'), i('openFindReplace'), i('searchFolder'), sep,
      { kind: 'submenu', label: 'Spelling', items: [i('toggleSpellcheck'), i('spellingSettings')] },
    ],
  };

  const format: MenuNode = {
    kind: 'submenu',
    label: 'Format',
    items: [
      i('toggleBold'), i('toggleItalic'), i('toggleStrike'), i('toggleHighlight'), i('toggleCode'), sep,
      i('toggleBulletList'), i('toggleOrderedList'), i('toggleTaskList'), sep,
      {
        kind: 'submenu',
        label: 'Heading',
        items: [i('paragraph'), i('heading1'), i('heading2'), i('heading3'), i('heading4'), i('heading5'), i('heading6')],
      },
      { kind: 'submenu', label: 'Insert', items: [i('insertTable'), i('insertLink'), i('insertImage'), i('openEmojiPicker')] },
    ],
  };

  const view: MenuNode = {
    kind: 'submenu',
    label: 'View',
    items: [
      i('toggleSidebar'), i('focusSidebar'), i('toggleSource'), i('showVersions'), sep,
      i('splitRight'), i('splitDown'), sep,
      i('zoomIn'), i('zoomOut'), i('zoomReset'), sep,
      i('toggleHidden'),
      ...(isMac ? [sep, pre('fullscreen')] : []),
    ],
  };

  const windowMenu: MenuNode = {
    kind: 'submenu',
    label: 'Window',
    role: 'window',
    items: [
      pre('minimize'), pre('maximize'), sep,
      i('nextTab'), i('prevTab'),
      ...(isMac ? [sep, pre('bringAllToFront')] : []),
    ],
  };

  const help: MenuNode = {
    kind: 'submenu',
    label: 'Help',
    role: 'help',
    items: [
      i('welcome'), i('keyboardShortcuts'), sep,
      i('checkUpdates'), sep,
      i('website'), i('reportIssue'),
      ...(isMac ? [] : [sep, i('about')]),
    ],
  };

  const appMenu: MenuNode = {
    kind: 'submenu',
    label: 'MikeDown',
    items: [
      pre('about'), sep,
      i('openSettings'), sep,
      pre('services'), sep,
      pre('hide'), pre('hideOthers'), pre('showAll'), sep,
      i('quit'),
    ],
  };

  return isMac ? [appMenu, file, edit, format, view, windowMenu, help] : [file, edit, format, view, windowMenu, help];
}

/** Every item id in a spec (submenus with ids included), depth first. */
export function menuIds(nodes: MenuNode[]): string[] {
  const out: string[] = [];
  const walk = (list: MenuNode[]): void => {
    for (const n of list) {
      if (n.kind === 'item') {out.push(n.id);}
      if (n.kind === 'submenu') {
        if (n.id) {out.push(n.id);}
        walk(n.items);
      }
    }
  };
  walk(nodes);
  return out;
}

export interface RecentMenuEntry {
  path: string;
  label: string;
  missing: boolean;
}

/** The Open Recent submenu's items: folders, then files, then Clear. */
export function recentMenuItems(folders: RecentMenuEntry[], files: RecentMenuEntry[], isMac: boolean): MenuNode[] {
  const items: MenuNode[] = [];
  for (const f of folders) {items.push({ kind: 'item', id: RECENT_FOLDER_PREFIX + f.path, label: f.label, enabled: !f.missing });}
  if (folders.length && files.length) {items.push(sep);}
  for (const f of files) {items.push({ kind: 'item', id: RECENT_FILE_PREFIX + f.path, label: f.label, enabled: !f.missing });}
  if (items.length) {items.push(sep);}
  const clear = item('clearRecents', isMac);
  items.push({ ...clear, enabled: folders.length + files.length > 0 } as MenuNode);
  return items;
}
