import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { MIKEDOWN_HOTKEYS } from '../../src/webview/hotkeys';

// Guards against the Hotkeys settings table silently drifting from the real
// keybindings declared in package.json#contributes.keybindings.
describe('MIKEDOWN_HOTKEYS stays in sync with package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
  const declared: Array<{ command: string; key: string; mac: string }> = pkg.contributes.keybindings;

  it('has exactly one entry per declared mikedown.* keybinding', () => {
    expect(MIKEDOWN_HOTKEYS.length).toBe(declared.length);
  });

  it('matches command, win key, and mac key for every declared keybinding', () => {
    for (const kb of declared) {
      const entry = MIKEDOWN_HOTKEYS.find(h => h.command === kb.command);
      expect(entry, `missing hotkeys entry for ${kb.command}`).toBeDefined();
      expect(entry!.win).toBe(kb.key);
      expect(entry!.mac).toBe(kb.mac);
    }
  });

  it('has no stale entries for commands no longer bound', () => {
    for (const entry of MIKEDOWN_HOTKEYS) {
      expect(declared.some(kb => kb.command === entry.command), `stale hotkeys entry for ${entry.command}`).toBe(true);
    }
  });
});
