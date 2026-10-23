import { describe, expect, it } from 'vitest';
import { commandForKey, formatAccelerator, parseAccelerator, SHORTCUTS } from '../../src/menu/shortcuts';

const key = (k: string, mods: Partial<{ meta: boolean; ctrl: boolean; shift: boolean; alt: boolean }> = {}, code?: string) => ({
  key: k, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt, code,
});

describe('shortcut table', () => {
  it('has unique accelerators', () => {
    const accs = SHORTCUTS.map((s) => s.accelerator.toLowerCase());
    expect(new Set(accs).size).toBe(accs.length);
  });

  it('parses CmdOrCtrl chords', () => {
    expect(parseAccelerator('CmdOrCtrl+Shift+S')).toEqual({ cmdOrCtrl: true, ctrl: false, shift: true, alt: false, key: 's' });
    expect(parseAccelerator('CmdOrCtrl+/')).toEqual({ cmdOrCtrl: true, ctrl: false, shift: false, alt: false, key: '/' });
    expect(parseAccelerator('Ctrl+Tab')).toEqual({ cmdOrCtrl: false, ctrl: true, shift: false, alt: false, key: 'tab' });
    expect(parseAccelerator('CmdOrCtrl+\\').key).toBe('\\');
  });

  it('maps Cmd on mac and Ctrl elsewhere', () => {
    expect(commandForKey(key('s', { meta: true }), true)).toBe('save');
    expect(commandForKey(key('s', { ctrl: true }), false)).toBe('save');
    expect(commandForKey(key('s', { ctrl: true }), true)).toBeNull();
    expect(commandForKey(key('s', { meta: true }), false)).toBeNull();
    expect(commandForKey(key('S', { meta: true, shift: true }), true)).toBe('saveAs');
    expect(commandForKey(key('/', { meta: true }), true)).toBe('toggleSource');
    expect(commandForKey(key(',', { ctrl: true }), false)).toBe('openSettings');
    expect(commandForKey(key('o', { ctrl: true }), false)).toBe('open');
    expect(commandForKey(key('O', { ctrl: true, shift: true }), false)).toBe('openContainingFolder');
  });

  it('ignores plain keys and extra modifiers', () => {
    expect(commandForKey(key('s'), true)).toBeNull();
    expect(commandForKey(key('o', { meta: true, alt: true, shift: true }), true)).toBeNull();
    expect(commandForKey(key('s', { meta: true, ctrl: true }), true)).toBeNull();
  });

  it('CmdOrCtrl+B toggles the sidebar only outside the editor (Bold wins inside)', () => {
    expect(commandForKey(key('b', { meta: true }), true)).toBe('toggleSidebar');
    expect(commandForKey(key('b', { meta: true }), true, SHORTCUTS, { inEditor: true })).toBeNull();
    expect(commandForKey(key('b', { ctrl: true }), false, SHORTCUTS, { inEditor: false })).toBe('toggleSidebar');
    expect(commandForKey(key('E', { meta: true, shift: true }), true, SHORTCUTS, { inEditor: true })).toBe('focusSidebar');
  });

  it('matches Option chords on macOS by physical key (Option+O types ø)', () => {
    expect(commandForKey({ ...key('ø', { meta: true, alt: true }), code: 'KeyO' }, true)).toBe('openFolder');
    expect(commandForKey(key('o', { ctrl: true, alt: true }), false)).toBe('openFolder');
  });

  it('tab chords use the Control key itself on both platforms (M4)', () => {
    expect(commandForKey(key('Tab', { ctrl: true }), true)).toBe('nextTab');
    expect(commandForKey(key('Tab', { ctrl: true, shift: true }), true)).toBe('prevTab');
    expect(commandForKey(key('Tab', { ctrl: true }), false)).toBe('nextTab');
    expect(commandForKey(key('PageDown', { ctrl: true }), false)).toBe('nextTab');
    expect(commandForKey(key('PageUp', { ctrl: true }), true)).toBe('prevTab');
    // Cmd+Tab on macOS is the app switcher, never ours; Ctrl+Tab stays Ctrl.
    expect(commandForKey(key('Tab', { meta: true }), true)).toBeNull();
  });

  it('close tab, split and new window (M4)', () => {
    expect(commandForKey(key('w', { meta: true }), true)).toBe('closeTab');
    expect(commandForKey(key('w', { ctrl: true }), false)).toBe('closeTab');
    expect(commandForKey(key('\\', { meta: true }), true)).toBe('splitRight');
    // Shift+\ types `|`; the physical key still matches.
    expect(commandForKey(key('|', { meta: true, shift: true }, 'Backslash'), true)).toBe('splitDown');
    expect(commandForKey(key('|', { ctrl: true, shift: true }, 'Backslash'), false)).toBe('splitDown');
    expect(commandForKey(key('N', { meta: true, shift: true }), true)).toBe('newWindow');
    expect(commandForKey(key('n', { meta: true }), true)).toBe('newDocument');
    expect(commandForKey(key('s', { meta: true, alt: true }, 'KeyS'), true)).toBe('saveAll');
  });

  it('formats labels per platform', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+S', true)).toBe('⌘⇧S');
    expect(formatAccelerator('CmdOrCtrl+Shift+S', false)).toBe('Ctrl+Shift+S');
    expect(formatAccelerator('Ctrl+Tab', true)).toBe('⌃Tab');
    expect(formatAccelerator('Ctrl+PageDown', false)).toBe('Ctrl+PageDown');
    expect(formatAccelerator('CmdOrCtrl+\\', true)).toBe('⌘\\');
  });
});
