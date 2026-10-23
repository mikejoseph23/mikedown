/**
 * The single shortcut table (edge case 23): every app-level command with its
 * `CmdOrCtrl` accelerator. The in-page key handler reads it now; M8's native
 * menu reads the same rows for its accelerator labels.
 *
 * Editor-internal chords (bold, find, undo) stay in core. The app owns the
 * ones that reach outside the editor: save, open, source toggle, settings,
 * the folder sidebar.
 *
 * `CmdOrCtrl+B` is both core's Bold and the sidebar toggle (VS Code's
 * convention). Rows marked `outsideEditor` only fire when focus is not in the
 * editor, so Bold wins while typing and the sidebar toggles from the tree or
 * the chrome. `CmdOrCtrl+Shift+E` (VS Code's Explorer chord, unused by core)
 * shows the sidebar and focuses the tree from anywhere, and the sidebar
 * header has a collapse button.
 */

export type AppCommand =
  | 'save'
  | 'saveAs'
  | 'open'
  | 'toggleSource'
  | 'openSettings'
  | 'openContainingFolder'
  | 'openFolder'
  | 'toggleSidebar'
  | 'focusSidebar';

export interface ShortcutRow {
  command: AppCommand;
  /** Tauri/Electron style accelerator: `CmdOrCtrl+Shift+S`. */
  accelerator: string;
  label: string;
  /** Only when focus is outside the editor (the chord means something else inside it). */
  outsideEditor?: boolean;
}

export const SHORTCUTS: readonly ShortcutRow[] = [
  { command: 'save', accelerator: 'CmdOrCtrl+S', label: 'Save' },
  { command: 'saveAs', accelerator: 'CmdOrCtrl+Shift+S', label: 'Save As…' },
  { command: 'open', accelerator: 'CmdOrCtrl+O', label: 'Open…' },
  { command: 'toggleSource', accelerator: 'CmdOrCtrl+/', label: 'Toggle Source Mode' },
  { command: 'openSettings', accelerator: 'CmdOrCtrl+,', label: 'Settings…' },
  { command: 'openContainingFolder', accelerator: 'CmdOrCtrl+Shift+O', label: 'Open Containing Folder' },
  { command: 'openFolder', accelerator: 'CmdOrCtrl+Alt+O', label: 'Open Folder…' },
  { command: 'toggleSidebar', accelerator: 'CmdOrCtrl+B', label: 'Toggle Folder Sidebar', outsideEditor: true },
  { command: 'focusSidebar', accelerator: 'CmdOrCtrl+Shift+E', label: 'Show Folder Sidebar' },
];

export interface ParsedAccelerator {
  cmdOrCtrl: boolean;
  shift: boolean;
  alt: boolean;
  /** Lower-case `KeyboardEvent.key` value. */
  key: string;
}

export function parseAccelerator(accelerator: string): ParsedAccelerator {
  const parts = accelerator.split('+');
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return {
    cmdOrCtrl: mods.has('cmdorctrl') || mods.has('commandorcontrol'),
    shift: mods.has('shift'),
    alt: mods.has('alt') || mods.has('option'),
    key: key.toLowerCase(),
  };
}

/** The subset of `KeyboardEvent` the matcher reads, so tests can pass plain objects. */
export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** Physical key (`KeyO`), for Option chords on macOS. */
  code?: string;
}

/**
 * Which app command a key press runs, or null. `isMac` decides what CmdOrCtrl
 * means; `inEditor` (focus inside the editor) skips `outsideEditor` rows.
 */
export function commandForKey(
  e: KeyLike,
  isMac: boolean,
  table: readonly ShortcutRow[] = SHORTCUTS,
  ctx: { inEditor: boolean } = { inEditor: false },
): AppCommand | null {
  const primary = isMac ? e.metaKey : e.ctrlKey;
  const other = isMac ? e.ctrlKey : e.metaKey;
  if (other) {return null;}
  const key = e.key.toLowerCase();
  for (const row of table) {
    const acc = parseAccelerator(row.accelerator);
    if (acc.cmdOrCtrl !== primary) {continue;}
    if (acc.shift !== e.shiftKey || acc.alt !== e.altKey) {continue;}
    if (row.outsideEditor && ctx.inEditor) {continue;}
    if (acc.key === key || (acc.alt && isMac && acc.key === codeKey(e))) {return row.command;}
  }
  return null;
}

/**
 * Option on macOS turns letters into symbols (`Option+O` types `ø`), so an
 * Alt chord also matches on the physical key.
 */
function codeKey(e: KeyLike): string {
  const code = e.code ?? '';
  return /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : '';
}

/** Human label for the platform: `⌘S` on macOS, `Ctrl+S` elsewhere. */
export function formatAccelerator(accelerator: string, isMac: boolean): string {
  const acc = parseAccelerator(accelerator);
  const key = acc.key.length === 1 ? acc.key.toUpperCase() : acc.key;
  if (isMac) {
    return `${acc.cmdOrCtrl ? '⌘' : ''}${acc.alt ? '⌥' : ''}${acc.shift ? '⇧' : ''}${key}`;
  }
  const parts = [];
  if (acc.cmdOrCtrl) {parts.push('Ctrl');}
  if (acc.alt) {parts.push('Alt');}
  if (acc.shift) {parts.push('Shift');}
  parts.push(key);
  return parts.join('+');
}
