/**
 * The single command table (edge case 23): every menu command with its
 * `CmdOrCtrl` accelerator, its `when` clause and who handles the keystroke.
 * The native menu bar (`menuSpec.ts` → `src-tauri/src/menu.rs`) and the
 * in-page key handler (`main.ts`) both read it; nothing else defines a chord.
 *
 * Who handles a keystroke (`keys`):
 *
 * - `app` (default): the page's capture-phase handler runs the row and stops
 *   the event, so an app chord wins over core's keymap (`CmdOrCtrl+Shift+S`
 *   is Save As here, not TipTap's Strikethrough, which moves to
 *   `CmdOrCtrl+Shift+X`, the Google Docs chord).
 * - `core`: the editor's own keymap already binds the chord (Bold, Undo,
 *   headings, Find, Link). The menu shows the accelerator and a click routes
 *   to `handle.command`; the page handler leaves the key to core.
 * - `os`: the native menu or the OS owns it (Quit, Exit).
 *
 * A menu click and the keystroke can both arrive for one press (WebView2
 * does not always swallow menu accelerators); `main.ts` drops a menu event
 * that repeats a chord the page already handled.
 *
 * `CmdOrCtrl+B` is both core's Bold and the sidebar toggle (VS Code's
 * convention). The sidebar row is `outsideEditor`, so Bold wins while typing
 * and the sidebar toggles from the tree or the chrome; the native menu shows
 * the chord on Bold only. `CmdOrCtrl+Shift+E` shows the sidebar from
 * anywhere. `CmdOrCtrl+Alt+B` toggles core's document sidebar (Outline,
 * Backlinks, Properties) on the right of the focused pane.
 *
 * Tabs (M4): `Ctrl+Tab` / `Ctrl+Shift+Tab` and `Ctrl+PageDown` /
 * `Ctrl+PageUp` cycle tabs on both platforms (`Cmd+Tab` is the macOS app
 * switcher). `CmdOrCtrl+Shift+F` (M7, folder search) sits next to core's
 * find bar on `CmdOrCtrl+F`; core's source-mode listener skips Shift when the
 * host owns shortcuts. `Ctrl` (literal, not `CmdOrCtrl`) means the Control
 * key on every platform.
 */
import type { MikeDownCommand } from '@mikedown/core';

/** Commands `main.ts` runs itself (everything that is not an editor command). */
export const APP_COMMANDS = [
  'save', 'saveAs', 'saveAll', 'open', 'toggleSource', 'openSettings', 'openContainingFolder', 'openFolder',
  'toggleSidebar', 'focusSidebar', 'toggleOutline', 'newDocument', 'closeTab', 'nextTab', 'prevTab', 'splitRight', 'splitDown',
  'newWindow', 'print', 'searchFolder',
  // M8
  'closeWindow', 'exportHtml', 'exportPdf', 'reveal', 'toggleHidden', 'clearRecents', 'toggleSpellcheck',
  'spellingSettings', 'welcome', 'keyboardShortcuts', 'checkUpdates', 'website', 'reportIssue', 'about', 'quit',
  // M6
  'showVersions',
] as const;

export type AppCommand = typeof APP_COMMANDS[number];

/** Editor commands from core's `MikeDownCommand` union that the menus route to `handle.command`. */
export const EDITOR_COMMANDS = [
  'toggleBold', 'toggleItalic', 'toggleStrike', 'toggleHighlight', 'toggleCode',
  'toggleBulletList', 'toggleOrderedList', 'toggleTaskList',
  'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6', 'paragraph',
  'insertTable', 'insertLink', 'insertImage', 'openEmojiPicker',
  'undo', 'redo', 'pasteWithoutFormatting', 'openFind', 'openFindReplace',
  'zoomIn', 'zoomOut', 'zoomReset',
  'aiRewrite',
] as const satisfies readonly MikeDownCommand[];

export type EditorCommand = typeof EDITOR_COMMANDS[number];

export type CommandId = AppCommand | EditorCommand;

/**
 * When a command is enabled (menu item greyed otherwise, keystroke ignored):
 *
 * - `always`
 * - `document`: the focused pane shows a tab (any kind)
 * - `editor`: that tab is in the editor (markdown or text, not an image)
 * - `richText`: editor and not in source mode (formatting)
 * - `saveable`: editor, and dirty or never saved
 * - `anyDirty`: some document in the window has unsaved changes
 * - `path`: the active document is saved somewhere
 * - `outsideFolder`: saved, and not inside the window's folder (Open Containing Folder, edge case 4)
 * - `folder`: the window has a folder open
 * - `editorFocus`: keyboard focus is inside the editor
 */
export type When = 'always' | 'document' | 'editor' | 'richText' | 'saveable' | 'anyDirty' | 'path' | 'outsideFolder' | 'folder' | 'editorFocus';

export interface ShortcutRow {
  command: CommandId;
  label: string;
  /** Tauri/Electron style accelerator: `CmdOrCtrl+Shift+S`, `Ctrl+Tab`. */
  accelerator?: string;
  when?: When;
  /** Who handles the keystroke in the page; see the file comment. Default `app`. */
  keys?: 'app' | 'core' | 'os';
  /** Only when focus is outside the editor (the chord means something else inside it). */
  outsideEditor?: boolean;
  /** Run the command but leave the event alone (Paste Without Formatting needs the native paste). */
  passThrough?: boolean;
  /** Platform-only row. */
  platform?: 'mac' | 'other';
  /** Keystroke only: no menu item of its own (a second chord for a command that has one). */
  keyOnly?: boolean;
  /** The menu item does not show this row's accelerator (it belongs to another item there). */
  hideAccelerator?: boolean;
  /** Editor command: route to `handle.command(core)`. */
  core?: EditorCommand;
}

const editor = (command: EditorCommand, label: string, accelerator: string | undefined, when: When, keys: 'app' | 'core' = 'core', extra: Partial<ShortcutRow> = {}): ShortcutRow =>
  ({ command, label, accelerator, when, keys, core: command, ...extra });

export const COMMANDS: readonly ShortcutRow[] = [
  // ── App menu / File ─────────────────────────────────────────────────────
  // macOS uses the native About panel (a predefined item); Windows lists About under Help.
  { command: 'about', label: 'About MikeDown', platform: 'other' },
  { command: 'openSettings', accelerator: 'CmdOrCtrl+,', label: 'Settings…', when: 'always' },
  { command: 'quit', accelerator: 'CmdOrCtrl+Q', label: 'Quit MikeDown', keys: 'os', platform: 'mac' },
  { command: 'quit', accelerator: 'Alt+F4', label: 'Exit', keys: 'os', platform: 'other' },
  { command: 'newDocument', accelerator: 'CmdOrCtrl+N', label: 'New File' },
  { command: 'newWindow', accelerator: 'CmdOrCtrl+Shift+N', label: 'New Window' },
  { command: 'open', accelerator: 'CmdOrCtrl+O', label: 'Open File…' },
  { command: 'openFolder', accelerator: 'CmdOrCtrl+Alt+O', label: 'Open Folder…' },
  { command: 'clearRecents', label: 'Clear Recently Opened' },
  // Save stays on for a clean document: Cmd+S out of habit still writes, and
  // M6 relies on it (an unchanged save is skipped by versioning, not by the menu).
  { command: 'save', accelerator: 'CmdOrCtrl+S', label: 'Save', when: 'editor' },
  { command: 'saveAs', accelerator: 'CmdOrCtrl+Shift+S', label: 'Save As…', when: 'editor' },
  { command: 'saveAll', accelerator: 'CmdOrCtrl+Alt+S', label: 'Save All', when: 'anyDirty' },
  { command: 'openContainingFolder', accelerator: 'CmdOrCtrl+Shift+O', label: 'Open Containing Folder', when: 'outsideFolder' },
  { command: 'reveal', accelerator: 'CmdOrCtrl+Alt+R', label: 'Reveal in Finder', when: 'path', platform: 'mac' },
  { command: 'reveal', accelerator: 'CmdOrCtrl+Alt+R', label: 'Show in Explorer', when: 'path', platform: 'other' },
  { command: 'exportHtml', label: 'HTML…', when: 'editor' },
  { command: 'exportPdf', label: 'PDF…', when: 'editor' },
  { command: 'print', accelerator: 'CmdOrCtrl+P', label: 'Print…', when: 'editor' },
  { command: 'closeTab', accelerator: 'CmdOrCtrl+W', label: 'Close Tab', when: 'document' },
  { command: 'closeWindow', accelerator: 'CmdOrCtrl+Shift+W', label: 'Close Window' },

  // ── Edit ────────────────────────────────────────────────────────────────
  editor('undo', 'Undo', 'CmdOrCtrl+Z', 'always'),
  editor('redo', 'Redo', 'CmdOrCtrl+Shift+Z', 'always'),
  editor('pasteWithoutFormatting', 'Paste Without Formatting', 'CmdOrCtrl+Shift+V', 'editor', 'app', { passThrough: true }),
  editor('openFind', 'Find…', 'CmdOrCtrl+F', 'editor'),
  // Cmd+H hides the app on macOS; Apple's Find and Replace chord is Cmd+Option+F.
  editor('openFindReplace', 'Find and Replace…', 'CmdOrCtrl+Alt+F', 'editor', 'app', { platform: 'mac' }),
  editor('openFindReplace', 'Replace…', 'CmdOrCtrl+H', 'editor', 'core', { platform: 'other' }),
  { command: 'searchFolder', accelerator: 'CmdOrCtrl+Shift+F', label: 'Find in Folder…', when: 'folder' },
  { command: 'toggleSpellcheck', label: 'Check Spelling While Typing', when: 'always' },
  { command: 'spellingSettings', label: 'Spelling Settings…', when: 'always' },

  // ── Format ──────────────────────────────────────────────────────────────
  editor('toggleBold', 'Bold', 'CmdOrCtrl+B', 'richText'),
  editor('toggleItalic', 'Italic', 'CmdOrCtrl+I', 'richText'),
  editor('toggleStrike', 'Strikethrough', 'CmdOrCtrl+Shift+X', 'richText', 'app'),
  editor('toggleHighlight', 'Highlight', 'CmdOrCtrl+Shift+H', 'richText'),
  editor('toggleCode', 'Inline Code', 'CmdOrCtrl+E', 'richText'),
  editor('toggleBulletList', 'Bulleted List', 'CmdOrCtrl+Shift+8', 'richText'),
  editor('toggleOrderedList', 'Numbered List', 'CmdOrCtrl+Shift+7', 'richText'),
  editor('toggleTaskList', 'Task List', 'CmdOrCtrl+Shift+9', 'richText'),
  editor('paragraph', 'Paragraph', 'CmdOrCtrl+Alt+0', 'richText'),
  editor('heading1', 'Heading 1', 'CmdOrCtrl+Alt+1', 'richText'),
  editor('heading2', 'Heading 2', 'CmdOrCtrl+Alt+2', 'richText'),
  editor('heading3', 'Heading 3', 'CmdOrCtrl+Alt+3', 'richText'),
  editor('heading4', 'Heading 4', 'CmdOrCtrl+Alt+4', 'richText'),
  editor('heading5', 'Heading 5', 'CmdOrCtrl+Alt+5', 'richText'),
  editor('heading6', 'Heading 6', 'CmdOrCtrl+Alt+6', 'richText'),
  editor('insertTable', 'Table', undefined, 'richText'),
  editor('insertLink', 'Link…', 'CmdOrCtrl+K', 'richText'),
  editor('insertImage', 'Image…', undefined, 'richText'),
  editor('openEmojiPicker', 'Emoji…', 'CmdOrCtrl+;', 'richText', 'app'),
  // Core binds the chord only when the host does not own shortcuts; no menu
  // item (AI is off by default), and a no-op without AI.
  editor('aiRewrite', 'Rewrite with AI', 'CmdOrCtrl+Alt+K', 'editor', 'app', { keyOnly: true }),

  // ── View ────────────────────────────────────────────────────────────────
  { command: 'toggleSidebar', accelerator: 'CmdOrCtrl+B', label: 'Toggle Sidebar', outsideEditor: true, hideAccelerator: true },
  { command: 'focusSidebar', accelerator: 'CmdOrCtrl+Shift+E', label: 'Show Sidebar' },
  // Core's document sidebar (Outline / Backlinks / Properties) in the focused
  // pane. VS Code's Cmd+\ is Split Right here; Cmd+Alt+B is VS Code's
  // secondary (right-hand) side bar.
  { command: 'toggleOutline', accelerator: 'CmdOrCtrl+Alt+B', label: 'Toggle Outline', when: 'editor' },
  { command: 'toggleSource', accelerator: 'CmdOrCtrl+/', label: 'Toggle Source Mode', when: 'editor' },
  { command: 'splitRight', accelerator: 'CmdOrCtrl+\\', label: 'Split Right', when: 'document' },
  { command: 'splitDown', accelerator: 'CmdOrCtrl+Shift+\\', label: 'Split Down', when: 'document' },
  editor('zoomIn', 'Zoom In', 'CmdOrCtrl+=', 'editor', 'app'),
  editor('zoomOut', 'Zoom Out', 'CmdOrCtrl+-', 'editor', 'app'),
  editor('zoomReset', 'Actual Size', 'CmdOrCtrl+0', 'editor', 'app'),
  { command: 'toggleHidden', accelerator: 'CmdOrCtrl+Shift+.', label: 'Show Hidden Files', when: 'folder' },
  // M6. Not Cmd+Shift+H: that is core's Highlight (TipTap `Mod-Shift-h`).
  { command: 'showVersions', accelerator: 'CmdOrCtrl+Alt+V', label: 'Show Versions…', when: 'path' },

  // ── Window ──────────────────────────────────────────────────────────────
  { command: 'nextTab', accelerator: 'Ctrl+Tab', label: 'Next Tab', when: 'document' },
  { command: 'prevTab', accelerator: 'Ctrl+Shift+Tab', label: 'Previous Tab', when: 'document' },
  { command: 'nextTab', accelerator: 'Ctrl+PageDown', label: 'Next Tab', when: 'document', keyOnly: true },
  { command: 'prevTab', accelerator: 'Ctrl+PageUp', label: 'Previous Tab', when: 'document', keyOnly: true },

  // ── Help ────────────────────────────────────────────────────────────────
  { command: 'welcome', label: 'Welcome Guide' },
  { command: 'keyboardShortcuts', label: 'Keyboard Shortcuts' },
  { command: 'checkUpdates', label: 'Check for Updates…' },
  { command: 'website', label: 'MikeDown Website' },
  { command: 'reportIssue', label: 'Report an Issue' },
];

/** Plan default (open question 3) and root `package.json#bugs`. */
export const WEBSITE_URL = 'https://iadev.net/mikedown/';
export const ISSUES_URL = 'https://github.com/mikejoseph23/mikedown/issues';

export function rowsFor(isMac: boolean, table: readonly ShortcutRow[] = COMMANDS): ShortcutRow[] {
  const platform = isMac ? 'mac' : 'other';
  return table.filter((r) => !r.platform || r.platform === platform);
}

/** The row a menu item shows for a command on this platform. */
export function rowFor(command: CommandId, isMac: boolean): ShortcutRow | undefined {
  return rowsFor(isMac).find((r) => r.command === command && !r.keyOnly);
}

/**
 * Rows the page's key handler runs (back-compat name: the M2–M7 table).
 * Both platforms' rows are listed; `commandForKey` skips the other one.
 */
export type KeyRow = ShortcutRow & { accelerator: string };
export const SHORTCUTS: readonly KeyRow[] = COMMANDS.filter((r): r is KeyRow => !!r.accelerator && (r.keys ?? 'app') === 'app');

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

/** The same chord on a platform, as a comparable string (`meta+shift+s`). */
export function chordKey(accelerator: string, isMac: boolean): string {
  const acc = parseAccelerator(accelerator);
  const need = requiredModifiers(acc, isMac);
  return [need.meta && 'meta', need.ctrl && 'ctrl', acc.alt && 'alt', acc.shift && 'shift', acc.key].filter(Boolean).join('+');
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

/** True when the key press is this accelerator on this platform. */
export function matchesAccelerator(e: KeyLike, accelerator: string, isMac: boolean): boolean {
  const acc = parseAccelerator(accelerator);
  const need = requiredModifiers(acc, isMac);
  if (need.meta !== e.metaKey || need.ctrl !== e.ctrlKey) {return false;}
  if (acc.shift !== e.shiftKey || acc.alt !== e.altKey) {return false;}
  const key = e.key.toLowerCase();
  return acc.key === key || acc.key === codeKey(e) || ((acc.alt || acc.shift) && acc.key === physicalKey(e));
}

/**
 * The row a key press runs, or null. `isMac` decides what CmdOrCtrl means;
 * `inEditor` (focus inside the editor) skips `outsideEditor` rows; `enabled`
 * (the `when` clause) skips disabled rows so a greyed menu item stays inert
 * from the keyboard too.
 */
export function rowForKey(
  e: KeyLike,
  isMac: boolean,
  table: readonly ShortcutRow[] = SHORTCUTS,
  ctx: { inEditor: boolean; enabled?: (row: ShortcutRow) => boolean } = { inEditor: false },
): ShortcutRow | null {
  const platform = isMac ? 'mac' : 'other';
  for (const row of table) {
    if (!row.accelerator) {continue;}
    if (row.platform && row.platform !== platform) {continue;}
    if (row.outsideEditor && ctx.inEditor) {continue;}
    if (!matchesAccelerator(e, row.accelerator, isMac)) {continue;}
    if (ctx.enabled && !ctx.enabled(row)) {continue;}
    return row;
  }
  return null;
}

/** `rowForKey` returning the command name (the M2–M7 API). */
export function commandForKey(
  e: KeyLike,
  isMac: boolean,
  table: readonly ShortcutRow[] = SHORTCUTS,
  ctx: { inEditor: boolean; enabled?: (row: ShortcutRow) => boolean } = { inEditor: false },
): CommandId | null {
  return rowForKey(e, isMac, table, ctx)?.command ?? null;
}

/**
 * Option on macOS turns letters and digits into symbols (`Option+O` types
 * `ø`) and Shift turns digits and punctuation into others (`Shift+.` is
 * `>`), so those chords also match on the physical key.
 */
function physicalKey(e: KeyLike): string {
  const code = e.code ?? '';
  if (/^Key[A-Z]$/.test(code)) {return code.slice(3).toLowerCase();}
  if (/^Digit[0-9]$/.test(code)) {return code.slice(5);}
  return codeKey(e);
}

/** Symbol keys by physical position (`Shift+\` is `|`, `Shift+/` is `?`). */
function codeKey(e: KeyLike): string {
  switch (e.code) {
    case 'Backslash': return '\\';
    case 'Slash': return '/';
    case 'Comma': return ',';
    case 'Period': return '.';
    case 'Semicolon': return ';';
    case 'Equal': return '=';
    case 'Minus': return '-';
    default: return '';
  }
}

/** Human label for the platform: `⌘S` on macOS, `Ctrl+S` elsewhere. */
export function formatAccelerator(accelerator: string, isMac: boolean): string {
  const acc = parseAccelerator(accelerator);
  const names: Record<string, string> = { pageup: 'PageUp', pagedown: 'PageDown', tab: 'Tab' };
  const key = acc.key.length === 1 ? acc.key.toUpperCase() : (names[acc.key] ?? (acc.key.charAt(0).toUpperCase() + acc.key.slice(1)));
  if (isMac) {
    return `${acc.ctrl ? '⌃' : ''}${acc.alt ? '⌥' : ''}${acc.shift ? '⇧' : ''}${acc.cmdOrCtrl ? '⌘' : ''}${key}`;
  }
  const parts = [];
  if (acc.cmdOrCtrl || acc.ctrl) {parts.push('Ctrl');}
  if (acc.alt) {parts.push('Alt');}
  if (acc.shift) {parts.push('Shift');}
  parts.push(key);
  return parts.join('+');
}

// ── `when` clauses ───────────────────────────────────────────────────────────

export interface MenuContext {
  /** The focused pane shows a tab. */
  hasDocument: boolean;
  /** That tab is in the editor (not an image). */
  editor: boolean;
  sourceMode: boolean;
  dirty: boolean;
  /** The active document is saved somewhere. */
  hasPath: boolean;
  /** The active document lies inside the window's folder. */
  insideFolder: boolean;
  anyDirty: boolean;
  folder: boolean;
  editorFocus: boolean;
}

export function isEnabled(when: When | undefined, ctx: MenuContext): boolean {
  switch (when ?? 'always') {
    case 'always': return true;
    case 'document': return ctx.hasDocument;
    case 'editor': return ctx.editor;
    case 'richText': return ctx.editor && !ctx.sourceMode;
    case 'saveable': return ctx.editor && (ctx.dirty || !ctx.hasPath);
    case 'anyDirty': return ctx.anyDirty;
    case 'path': return ctx.hasPath;
    case 'outsideFolder': return ctx.hasPath && !ctx.insideFolder;
    case 'folder': return ctx.folder;
    case 'editorFocus': return ctx.editor && ctx.editorFocus;
  }
}

/** Enabled state per menu id for this platform (only rows that are menu items). */
export function enablement(ctx: MenuContext, isMac: boolean): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const row of rowsFor(isMac)) {
    if (row.keyOnly) {continue;}
    out[row.command] = isEnabled(row.when, ctx);
  }
  return out;
}
