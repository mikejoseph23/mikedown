import { describe, expect, it } from 'vitest';
import { commandForKey, formatAccelerator, parseAccelerator, SHORTCUTS } from '../../src/menu/shortcuts';

const key = (k: string, mods: Partial<{ meta: boolean; ctrl: boolean; shift: boolean; alt: boolean }> = {}) => ({
  key: k, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt,
});

describe('shortcut table', () => {
  it('has unique accelerators', () => {
    const accs = SHORTCUTS.map((s) => s.accelerator.toLowerCase());
    expect(new Set(accs).size).toBe(accs.length);
  });

  it('parses CmdOrCtrl chords', () => {
    expect(parseAccelerator('CmdOrCtrl+Shift+S')).toEqual({ cmdOrCtrl: true, shift: true, alt: false, key: 's' });
    expect(parseAccelerator('CmdOrCtrl+/')).toEqual({ cmdOrCtrl: true, shift: false, alt: false, key: '/' });
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
    expect(commandForKey(key('s', { meta: true, alt: true }), true)).toBeNull();
  });

  it('formats labels per platform', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+S', true)).toBe('⌘⇧S');
    expect(formatAccelerator('CmdOrCtrl+Shift+S', false)).toBe('Ctrl+Shift+S');
  });
});
