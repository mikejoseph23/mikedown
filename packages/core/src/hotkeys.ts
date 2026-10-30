/**
 * MikeDown Hotkeys — read-only reference data for the Settings modal's
 * Hotkeys tab.
 *
 * This is the display-side mirror of `package.json#contributes.keybindings`.
 * It is intentionally NOT the source of truth — VS Code's `contributes.keybindings`
 * is static and can only be changed by editing package.json (there is no API
 * for an extension to rewrite the user's keybindings.json). Keep this list in
 * sync by hand; `test/unit/hotkeys.test.ts` asserts the two stay aligned.
 */
export interface MikedownHotkey {
  /** Command id, e.g. 'mikedown.toggleBold'. Must match package.json exactly. */
  command: string;
  /** Human label shown in the Hotkeys table. */
  label: string;
  /** Key chord as written in package.json's `key` field (Windows/Linux). */
  win: string;
  /** Key chord as written in package.json's `mac` field. */
  mac: string;
}

export const MIKEDOWN_HOTKEYS: MikedownHotkey[] = [
  { command: 'mikedown.toggleBold', label: 'Toggle Bold', win: 'ctrl+b', mac: 'cmd+b' },
  { command: 'mikedown.toggleItalic', label: 'Toggle Italic', win: 'ctrl+i', mac: 'cmd+i' },
  { command: 'mikedown.toggleStrike', label: 'Toggle Strikethrough', win: 'ctrl+shift+s', mac: 'cmd+shift+s' },
  { command: 'mikedown.toggleHighlight', label: 'Toggle Highlight', win: 'ctrl+shift+h', mac: 'cmd+shift+h' },
  { command: 'mikedown.toggleCode', label: 'Toggle Inline Code', win: 'ctrl+shift+k', mac: 'cmd+shift+k' },
  { command: 'mikedown.pasteWithoutFormatting', label: 'Paste Without Formatting', win: 'ctrl+shift+v', mac: 'cmd+shift+v' },
  { command: 'mikedown.openEmojiPicker', label: 'Open Emoji Picker', win: 'ctrl+;', mac: 'cmd+;' },
  { command: 'mikedown.toggleBulletList', label: 'Toggle Bullet List', win: 'ctrl+.', mac: 'cmd+.' },
  { command: 'mikedown.toggleOrderedList', label: 'Toggle Ordered List', win: 'ctrl+3', mac: 'cmd+3' },
  { command: 'mikedown.toggleTaskList', label: 'Toggle Task List', win: 'ctrl+8', mac: 'cmd+8' },
  { command: 'mikedown.toggleSidebar', label: 'Toggle Sidebar', win: 'ctrl+\\', mac: 'cmd+\\' },
  { command: 'mikedown.toggleSourceMode', label: 'Toggle Source Mode', win: 'ctrl+/', mac: 'cmd+/' },
  { command: 'mikedown.undo', label: 'Undo', win: 'ctrl+z', mac: 'cmd+z' },
  { command: 'mikedown.redo', label: 'Redo', win: 'ctrl+shift+z', mac: 'cmd+shift+z' },
  // Not Cmd+Shift+K (the plan's pick): that is Toggle Inline Code.
  { command: 'mikedown.ai.rewrite', label: 'Rewrite Selection with AI', win: 'ctrl+alt+k', mac: 'cmd+alt+k' },
];

/**
 * Keys the editor handles itself, inside a table. Not VS Code keybindings, so
 * they are not in package.json and cannot be remapped; the Hotkeys tab lists
 * them under their own heading.
 */
export interface EditorHotkey {
  label: string;
  win: string;
  mac: string;
}

export const MIKEDOWN_TABLE_HOTKEYS: EditorHotkey[] = [
  { label: 'Insert Row Below', win: 'ctrl+enter', mac: 'cmd+enter' },
  { label: 'Insert Row Above', win: 'ctrl+shift+enter', mac: 'cmd+shift+enter' },
  { label: 'Delete Row', win: 'ctrl+alt+backspace', mac: 'cmd+alt+backspace' },
  { label: 'Next / Previous Cell', win: 'tab', mac: 'tab' },
  { label: 'Leave Table', win: 'escape', mac: 'escape' },
];
