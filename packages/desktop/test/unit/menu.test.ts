/**
 * M8: the command table drives both the native menu and the page's keys.
 * No chord is defined twice, app chords do not silently collide with core's
 * keymap, every row is handled, `when` clauses gate rows, and the menu spec
 * Rust builds from (`test/fixtures/menu/*.json`, read by `cargo test`) stays
 * in step with the table.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  APP_COMMANDS, COMMANDS, EDITOR_COMMANDS, SHORTCUTS, chordKey, enablement, isEnabled, rowFor, rowForKey, rowsFor,
  type MenuContext,
} from '../../src/menu/shortcuts';
import { buildMenuSpec, menuIds, recentMenuItems, OPEN_RECENT_ID, RECENT_FILE_PREFIX, RECENT_FOLDER_PREFIX, type MenuNode } from '../../src/menu/menuSpec';
import { shortcutGroups } from '../../src/ui/shortcutsSheet';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, '..', 'fixtures', 'menu');

/**
 * Chords core binds itself with `hostOwnsShortcuts: true` (TipTap StarterKit
 * defaults plus core's own handlers in `packages/core/src/editor.ts`).
 * `Mod` is Cmd on macOS and Ctrl elsewhere.
 */
const CORE_KEYMAP = [
  'Mod-b', 'Mod-i', 'Mod-u', 'Mod-Shift-s', 'Mod-e', 'Mod-Shift-h', 'Mod-Shift-7', 'Mod-Shift-8', 'Mod-Shift-9',
  'Mod-Alt-0', 'Mod-Alt-1', 'Mod-Alt-2', 'Mod-Alt-3', 'Mod-Alt-4', 'Mod-Alt-5', 'Mod-Alt-6', 'Mod-Shift-b', 'Mod-Alt-c',
  'Mod-z', 'Mod-Shift-z', 'Mod-y', 'Mod-f', 'Mod-h', 'Mod-k', 'Mod-a', 'Mod-Enter', 'Mod-Backspace', 'Mod-Delete',
];
const coreChord = (k: string, isMac: boolean): string =>
  chordKey(k.replace(/^Mod-/, 'CmdOrCtrl+').replace(/-/g, '+').replace(/\+([A-Za-z0-9]+)$/, (_, key: string) => `+${key}`), isMac);

/** App chords that deliberately shadow a core binding, with the reason. */
const INTENTIONAL_OVERRIDES: Record<string, string> = {
  // Save As is CmdOrCtrl+Shift+S on every desktop app; Strikethrough moves to CmdOrCtrl+Shift+X.
  saveAs: 'Mod-Shift-s',
  // Outside the editor only (`outsideEditor`); Bold keeps it while typing.
  toggleSidebar: 'Mod-b',
};

const ctx = (over: Partial<MenuContext> = {}): MenuContext => ({
  hasDocument: true, editor: true, sourceMode: false, dirty: false, hasPath: true, insideFolder: false, anyDirty: false, folder: false, editorFocus: false, ...over,
});

describe('command table', () => {
  it('no accelerator is defined twice on a platform, apart from the documented Cmd+B pair', () => {
    for (const isMac of [true, false]) {
      const seen = new Map<string, string>();
      for (const row of rowsFor(isMac)) {
        if (!row.accelerator) {continue;}
        const chord = chordKey(row.accelerator, isMac);
        const other = seen.get(chord);
        if (other) {
          expect([other, row.command].sort()).toEqual(['toggleBold', 'toggleSidebar']);
        }
        seen.set(chord, row.command);
      }
    }
  });

  it('app chords do not collide with core keymap except the intentional overrides', () => {
    for (const isMac of [true, false]) {
      const core = new Set(CORE_KEYMAP.map((k) => coreChord(k, isMac)));
      const collisions = SHORTCUTS
        .filter((r) => !r.platform || r.platform === (isMac ? 'mac' : 'other'))
        .filter((r) => core.has(chordKey(r.accelerator, isMac)))
        .map((r) => r.command)
        .sort();
      expect(collisions).toEqual(Object.keys(INTENTIONAL_OVERRIDES).sort());
    }
  });

  it('rows left to core are really bound by core', () => {
    for (const isMac of [true, false]) {
      const core = new Set(CORE_KEYMAP.map((k) => coreChord(k, isMac)));
      for (const row of rowsFor(isMac).filter((r) => r.keys === 'core' && r.accelerator)) {
        expect(core.has(chordKey(row.accelerator!, isMac)), `${row.command} ${row.accelerator}`).toBe(true);
      }
    }
  });

  it('every row is handled: editor rows route to a core command, the rest are app commands', () => {
    for (const row of COMMANDS) {
      if (row.core) {
        expect(EDITOR_COMMANDS).toContain(row.core);
        expect(row.core).toBe(row.command);
      } else {
        expect(APP_COMMANDS as readonly string[]).toContain(row.command);
      }
    }
  });

  it('every command has a menu item on each platform, and every menu item is a command', () => {
    for (const isMac of [true, false]) {
      const ids = new Set(menuIds(buildMenuSpec(isMac)));
      for (const row of rowsFor(isMac).filter((r) => !r.keyOnly)) {
        expect(ids.has(row.command), `${isMac ? 'mac' : 'win'} menu lacks ${row.command}`).toBe(true);
      }
      for (const id of ids) {
        if (id === OPEN_RECENT_ID) {continue;}
        expect(rowFor(id as never, isMac), id).toBeDefined();
      }
    }
  });

  it('platform conventions: Settings in the app menu on macOS and under File on Windows; Exit Alt+F4; About under Help on Windows', () => {
    const mac = buildMenuSpec(true);
    const win = buildMenuSpec(false);
    const sub = (spec: MenuNode[], label: string) => spec.find((n) => n.kind === 'submenu' && n.label === label) as Extract<MenuNode, { kind: 'submenu' }>;
    expect(mac.map((n) => (n.kind === 'submenu' ? n.label : ''))).toEqual(['MikeDown', 'File', 'Edit', 'Format', 'View', 'Window', 'Help']);
    expect(win.map((n) => (n.kind === 'submenu' ? n.label : ''))).toEqual(['File', 'Edit', 'Format', 'View', 'Window', 'Help']);
    expect(menuIds(sub(mac, 'MikeDown').items)).toEqual(['openSettings', 'openAiSettings', 'quit']);
    expect(menuIds(sub(mac, 'File').items)).not.toContain('openSettings');
    expect(menuIds(sub(win, 'File').items)).toContain('openSettings');
    const winFile = menuIds(sub(win, 'File').items);
    expect(winFile.indexOf('openAiSettings')).toBe(winFile.indexOf('openSettings') + 1);
    expect(menuIds(sub(mac, 'MikeDown').items).indexOf('openAiSettings')).toBe(1);
    expect(rowFor('openAiSettings', true)).toMatchObject({ label: 'AI Engines…', when: 'always' });
    expect(rowFor('openAiSettings', true)?.accelerator).toBeUndefined();
    expect(menuIds(sub(win, 'File').items).at(-1)).toBe('quit');
    expect(menuIds(sub(win, 'Help').items)).toContain('about');
    const quit = (spec: MenuNode[]) => JSON.stringify(spec).match(/"id":"quit","label":"([^"]+)","accelerator":"([^"]+)"/)?.slice(1);
    expect(quit(mac)).toEqual(['Quit MikeDown', 'CmdOrCtrl+Q']);
    expect(quit(win)).toEqual(['Exit', 'Alt+F4']);
    expect(rowFor('reveal', true)?.label).toBe('Reveal in Finder');
    expect(rowFor('reveal', false)?.label).toBe('Show in Explorer');
  });

  it('Format > AI lists the toolbar menu\'s six actions in its words and order, with access keys on Windows (U1, U2)', () => {
    const ai = (isMac: boolean) => {
      const format = buildMenuSpec(isMac).find((n) => n.kind === 'submenu' && n.label === 'Format') as Extract<MenuNode, { kind: 'submenu' }>;
      return format.items.find((n) => n.kind === 'submenu' && n.label.replace('&', '') === 'AI') as Extract<MenuNode, { kind: 'submenu' }>;
    };
    const labels = (sub: Extract<MenuNode, { kind: 'submenu' }>) => sub.items.map((n) => (n.kind === 'item' ? n.label : '—'));
    expect(menuIds(ai(true).items)).toEqual(['aiRewrite', 'aiExplain', 'aiTranslate', 'aiSummarize', 'aiSuggestTitle', 'aiSuggestProperties']);
    expect(labels(ai(true))).toEqual(['Rewrite Selection', 'Explain Selection', 'Translate…', '—', 'Summarize Document…', 'Suggest Titles…', 'Suggest Properties']);
    // Only Rewrite has a chord (no new default keys, OQ8).
    expect(ai(true).items.filter((n) => n.kind === 'item' && n.accelerator).map((n) => (n.kind === 'item' ? n.id : ''))).toEqual(['aiRewrite']);
    // macOS has no mnemonics; Windows gets one distinct access key per item.
    expect(ai(true).label).toBe('AI');
    expect(ai(false).label).toBe('&AI');
    const keys = labels(ai(false)).filter((l) => l !== '—').map((l) => l.match(/&(.)/)?.[1]?.toLowerCase());
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    // The shortcuts sheet shows the plain words.
    expect(shortcutGroups(false).flatMap((g) => g.rows)).toContainEqual({ label: 'Rewrite Selection', keys: 'Ctrl+Alt+K' });
  });

  it('keeps the menu ids M4, M7 and M9 use', () => {
    for (const isMac of [true, false]) {
      const ids = menuIds(buildMenuSpec(isMac));
      for (const id of ['quit', 'newWindow', 'closeTab', 'closeWindow', 'searchFolder', 'exportHtml', 'exportPdf', 'print', 'openSettings', 'splitRight', 'splitDown', 'nextTab', 'prevTab', 'saveAll', 'showVersions']) {
        expect(ids).toContain(id);
      }
    }
  });

  it('the menu shows Cmd+B on Bold, not on Toggle Sidebar', () => {
    const json = JSON.stringify(buildMenuSpec(true));
    expect(json).toContain('"id":"toggleBold","label":"Bold","accelerator":"CmdOrCtrl+B"');
    expect(json).toMatch(/"id":"toggleSidebar","label":"Toggle Sidebar"}/);
  });

  it('the Rust fixtures match the table (UPDATE_MENU_FIXTURES=1 regenerates them)', () => {
    for (const [name, isMac] of [['menu-mac.json', true], ['menu-windows.json', false]] as const) {
      const text = `${JSON.stringify(buildMenuSpec(isMac), null, 2)}\n`;
      const file = path.join(fixtureDir, name);
      if (process.env.UPDATE_MENU_FIXTURES === '1' || !fs.existsSync(file)) {
        fs.mkdirSync(fixtureDir, { recursive: true });
        fs.writeFileSync(file, text);
      }
      expect(fs.readFileSync(file, 'utf8')).toBe(text);
    }
  });
});

describe('when clauses', () => {
  it('gate by document, editor, source mode, dirty, path and folder', () => {
    expect(isEnabled(undefined, ctx({ hasDocument: false }))).toBe(true);
    expect(isEnabled('document', ctx({ hasDocument: false }))).toBe(false);
    expect(isEnabled('editor', ctx({ editor: false }))).toBe(false);
    expect(isEnabled('richText', ctx({ sourceMode: true }))).toBe(false);
    expect(isEnabled('richText', ctx())).toBe(true);
    expect(isEnabled('saveable', ctx({ dirty: false, hasPath: true }))).toBe(false);
    expect(isEnabled('saveable', ctx({ dirty: true }))).toBe(true);
    expect(isEnabled('saveable', ctx({ dirty: false, hasPath: false }))).toBe(true);
    expect(isEnabled('anyDirty', ctx({ anyDirty: true }))).toBe(true);
    expect(isEnabled('path', ctx({ hasPath: false }))).toBe(false);
    expect(isEnabled('outsideFolder', ctx({ insideFolder: true }))).toBe(false);
    expect(isEnabled('outsideFolder', ctx({ insideFolder: false }))).toBe(true);
    expect(isEnabled('folder', ctx({ folder: true }))).toBe(true);
    expect(isEnabled('editorFocus', ctx({ editorFocus: false }))).toBe(false);
  });

  it('the welcome window (no document, no folder) greys document items but keeps Settings and Open', () => {
    const state = enablement(ctx({ hasDocument: false, editor: false, hasPath: false }), true);
    for (const id of ['save', 'saveAs', 'closeTab', 'toggleBold', 'heading1', 'print', 'exportHtml', 'reveal', 'searchFolder', 'splitRight']) {
      expect(state[id], id).toBe(false);
    }
    for (const id of ['openSettings', 'openAiSettings', 'open', 'openFolder', 'newDocument', 'newWindow', 'welcome', 'quit']) {
      expect(state[id], id).toBe(true);
    }
  });

  it('formatting is off in source mode, Save All follows dirty state, Save stays on', () => {
    const src = enablement(ctx({ sourceMode: true }), false);
    expect(src.toggleBold).toBe(false);
    expect(src.toggleSource).toBe(true);
    expect(enablement(ctx({ dirty: false }), true).save).toBe(true);
    expect(enablement(ctx({ anyDirty: false }), true).saveAll).toBe(false);
    expect(enablement(ctx({ anyDirty: true }), true).saveAll).toBe(true);
  });

  it('a disabled row is inert from the keyboard too', () => {
    const saveAll = { key: 'ß', code: 'KeyS', metaKey: true, ctrlKey: false, shiftKey: false, altKey: true };
    expect(rowForKey(saveAll, true, SHORTCUTS, { inEditor: true, enabled: (r) => isEnabled(r.when, ctx({ anyDirty: true })) })?.command).toBe('saveAll');
    expect(rowForKey(saveAll, true, SHORTCUTS, { inEditor: true, enabled: (r) => isEnabled(r.when, ctx({ anyDirty: false })) })).toBeNull();
  });

  it('new M8 chords reach their commands', () => {
    const k = (key: string, mods: Partial<{ meta: boolean; ctrl: boolean; shift: boolean; alt: boolean }>, code?: string) =>
      ({ key, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt, code });
    expect(rowForKey(k('X', { meta: true, shift: true }), true)?.command).toBe('toggleStrike');
    expect(rowForKey(k('=', { ctrl: true }), false)?.command).toBe('zoomIn');
    expect(rowForKey(k('-', { meta: true }), true)?.command).toBe('zoomOut');
    expect(rowForKey(k('0', { meta: true }), true)?.command).toBe('zoomReset');
    expect(rowForKey(k(';', { ctrl: true }), false)?.command).toBe('openEmojiPicker');
    expect(rowForKey(k('>', { meta: true, shift: true }, 'Period'), true)?.command).toBe('toggleHidden');
    expect(rowForKey(k('ƒ', { meta: true, alt: true }, 'KeyF'), true)?.command).toBe('openFindReplace');
    expect(rowForKey(k('h', { ctrl: true }), false)).toBeNull(); // Replace on Windows is core's Ctrl+H
    expect(rowForKey(k('®', { meta: true, alt: true }, 'KeyR'), true)?.command).toBe('reveal');
    expect(rowForKey(k('W', { meta: true, shift: true }), true)?.command).toBe('closeWindow');
    const paste = rowForKey(k('V', { meta: true, shift: true }), true);
    expect(paste?.command).toBe('pasteWithoutFormatting');
    expect(paste?.passThrough).toBe(true);
  });
});

describe('Open Recent', () => {
  it('lists folders, then files, greys missing ones, and ends with Clear', () => {
    const items = recentMenuItems(
      [{ path: '/n', label: 'n', missing: false }],
      [{ path: '/n/a.md', label: 'a.md', missing: true }],
      true,
    );
    expect(items.map((i) => (i.kind === 'item' ? i.id : i.kind))).toEqual([
      `${RECENT_FOLDER_PREFIX}/n`, 'separator', `${RECENT_FILE_PREFIX}/n/a.md`, 'separator', 'clearRecents',
    ]);
    expect((items[2] as { enabled?: boolean }).enabled).toBe(false);
    expect((items[4] as { enabled?: boolean }).enabled).toBe(true);
    const empty = recentMenuItems([], [], false);
    expect(empty).toHaveLength(1);
    expect((empty[0] as { enabled?: boolean }).enabled).toBe(false);
  });
});

describe('keyboard shortcuts sheet', () => {
  it('groups chords by menu with platform labels', () => {
    const mac = shortcutGroups(true);
    const file = mac.find((g) => g.title === 'File');
    expect(file?.rows).toContainEqual({ label: 'Save As', keys: '⇧⌘S' });
    const win = shortcutGroups(false);
    expect(win.find((g) => g.title === 'Window')?.rows).toContainEqual({ label: 'Next Tab', keys: 'Ctrl+Tab  or  Ctrl+PageDown' });
    expect(win.flatMap((g) => g.rows)).toContainEqual({ label: 'Settings', keys: 'Ctrl+,' });
  });
});
