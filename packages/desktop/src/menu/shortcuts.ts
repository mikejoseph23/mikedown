/**
 * The single shortcut table (edge case 23): every app-level command with its
 * `CmdOrCtrl` accelerator. The in-page key handler reads it now; M8's native
 * menu reads the same rows for its accelerator labels.
 *
 * Editor-internal chords (bold, find, undo) stay in core. The app owns the
 * ones that reach outside the editor: save, open, source toggle, settings,
 * the folder sidebar, tabs, panes and windows.
 *
 * `CmdOrCtrl+B` is both core's Bold and the sidebar toggle (VS Code's
 * convention). Rows marked `outsideEditor` only fire when focus is not in the
 * editor, so Bold wins while typing and the sidebar toggles from the tree or
 * the chrome. `CmdOrCtrl+Shift+E` (VS Code's Explorer chord, unused by core)
 * shows the sidebar and focuses the tree from anywhere, and the sidebar
 * header has a collapse button.
 *
 * Tabs (M4): `CmdOrCtrl+W` closes the tab, `Ctrl+Tab` / `Ctrl+Shift+Tab` and
 * `Ctrl+PageDown` / `Ctrl+PageUp` cycle tabs on both platforms (`Cmd+Tab` is
 * the macOS app switcher and never reaches the page), `CmdOrCtrl+\` splits
 * the pane to the right and `CmdOrCtrl+Shift+\` below it, `CmdOrCtrl+Shift+N`
 * opens a new window. Core binds none of these, so there is no collision;
 * `Ctrl` (literal, not `CmdOrCtrl`) means the Control key on every platform.
 */

export type AppCommand =
  | 'save'
  | 'saveAs'
  | 'saveAll'
  | 'open'
  | 'toggleSource'
  | 'openSettings'
  | 'openContainingFolder'
  | 'openFolder'
  | 'toggleSidebar'
  | 'focusSidebar'
  | 'newDocument'
  | 'closeTab'
  | 'nextTab'
  | 'prevTab'
  | 'splitRight'
  | 'splitDown'
  | 'newWindow';

export interface ShortcutRow {
  command: AppCommand;
  /** Tauri/Electron style accelerator: `CmdOrCtrl+Shift+S`, `Ctrl+Tab`. */
  accelerator: string;
  label: string;
  /** Only when focus is outside the editor (the chord means something else inside it). */
  outsideEditor?: boolean;
}

export const SHORTCUTS: readonly ShortcutRow[] = [
  { command: 'newDocument', accelerator: 'CmdOrCtrl+N', label: 'New Document' },
  { command: 'save', accelerator: 'CmdOrCtrl+S', label: 'Save' },
  { command: 'saveAs', accelerator: 'CmdOrCtrl+Shift+S', label: 'Save As…' },
  { command: 'saveAll', accelerator: 'CmdOrCtrl+Alt+S', label: 'Save All' },
  { command: 'open', accelerator: 'CmdOrCtrl+O', label: 'Open…' },
  { command: 'toggleSource', accelerator: 'CmdOrCtrl+/', label: 'Toggle Source Mode' },
  { command: 'openSettings', accelerator: 'CmdOrCtrl+,', label: 'Settings…' },
  { command: 'openContainingFolder', accelerator: 'CmdOrCtrl+Shift+O', label: 'Open Containing Folder' },
  { command: 'openFolder', accelerator: 'CmdOrCtrl+Alt+O', label: 'Open Folder…' },
  { command: 'toggleSidebar', accelerator: 'CmdOrCtrl+B', label: 'Toggle Folder Sidebar', outsideEditor: true },
  { command: 'focusSidebar', accelerator: 'CmdOrCtrl+Shift+E', label: 'Show Folder Sidebar' },
  { command: 'closeTab', accelerator: 'CmdOrCtrl+W', label: 'Close Tab' },
  { command: 'nextTab', accelerator: 'Ctrl+Tab', label: 'Next Tab' },
  { command: 'prevTab', accelerator: 'Ctrl+Shift+Tab', label: 'Previous Tab' },
  { command: 'nextTab', accelerator: 'Ctrl+PageDown', label: 'Next Tab' },
  { command: 'prevTab', accelerator: 'Ctrl+PageUp', label: 'Previous Tab' },
  { command: 'splitRight', accelerator: 'CmdOrCtrl+\\', label: 'Split Right' },
  { command: 'splitDown', accelerator: 'CmdOrCtrl+Shift+\\', label: 'Split Down' },
  { command: 'newWindow', accelerator: 'CmdOrCtrl+Shift+N', label: 'New Window' },
];

export interface ParsedAccelerator {
  cmdOrCtrl: boolean;
  /** The Control key itself, on every platform. */
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** Lower-case `KeyboardEvent.key` value. */
  key: string;
}

export function parseAccelerator(accelerator: string): ParsedAccelerator {
  const parts = accelerator.split('+');
  // `CmdOrCtrl+\` splits into ['CmdOrCtrl', '\\']; `CmdOrCtrl++` would not,
  // but no row uses a bare plus.
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return {
    cmdOrCtrl: mods.has('cmdorctrl') || mods.has('commandorcontrol'),
    ctrl: mods.has('ctrl') || mods.has('control'),
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
  /** Physical key (`KeyO`, `Backslash`), for Option chords on macOS and symbol keys. */
  code?: string;
}

/** The modifier keys an accelerator needs on a platform. */
export function requiredModifiers(acc: ParsedAccelerator, isMac: boolean): { meta: boolean; ctrl: boolean } {
  return {
    meta: isMac && acc.cmdOrCtrl,
    ctrl: acc.ctrl || (!isMac && acc.cmdOrCtrl),
  };
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
  const key = e.key.toLowerCase();
  for (const row of table) {
    const acc = parseAccelerator(row.accelerator);
    const need = requiredModifiers(acc, isMac);
    if (need.meta !== e.metaKey || need.ctrl !== e.ctrlKey) {continue;}
    if (acc.shift !== e.shiftKey || acc.alt !== e.altKey) {continue;}
    if (row.outsideEditor && ctx.inEditor) {continue;}
    if (acc.key === key || acc.key === codeKey(e) || (acc.alt && isMac && acc.key === letterKey(e))) {return row.command;}
  }
  return null;
}

/**
 * Option on macOS turns letters into symbols (`Option+O` types `ø`), so an
 * Alt chord also matches on the physical key.
 */
function letterKey(e: KeyLike): string {
  const code = e.code ?? '';
  return /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : '';
}

/** Shift changes `e.key` for symbols (`Shift+\` is `|`), so match those on the physical key too. */
function codeKey(e: KeyLike): string {
  switch (e.code) {
    case 'Backslash': return '\\';
    case 'Slash': return '/';
    case 'Comma': return ',';
    default: return '';
  }
}

/** Human label for the platform: `⌘S` on macOS, `Ctrl+S` elsewhere. */
export function formatAccelerator(accelerator: string, isMac: boolean): string {
  const acc = parseAccelerator(accelerator);
  const names: Record<string, string> = { pageup: 'PageUp', pagedown: 'PageDown', tab: 'Tab' };
  const key = acc.key.length === 1 ? acc.key.toUpperCase() : (names[acc.key] ?? acc.key);
  if (isMac) {
    return `${acc.ctrl ? '⌃' : ''}${acc.cmdOrCtrl ? '⌘' : ''}${acc.alt ? '⌥' : ''}${acc.shift ? '⇧' : ''}${key}`;
  }
  const parts = [];
  if (acc.cmdOrCtrl || acc.ctrl) {parts.push('Ctrl');}
  if (acc.alt) {parts.push('Alt');}
  if (acc.shift) {parts.push('Shift');}
  parts.push(key);
  return parts.join('+');
}
