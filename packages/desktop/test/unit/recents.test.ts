/**
 * M8 recents (edge case 18): add / dedupe / cap, missing-count pruning after
 * three launches, removal that persists, the first-run flag, and the welcome
 * screen that renders them. Also the window title rules (edge case 29).
 */
import { describe, expect, it } from 'vitest';
import {
  MISSING_LAUNCH_LIMIT, RECENTS_CAP, addRecent, applyLaunchCheck, clearRecents, createRecentsStore, emptyRecents, parseRecents,
  parentOf, recentsView, removeRecent, samePath, serializeRecents, tildify, type RecentsApi,
} from '../../src/app/recents';
import { formatWindowTitle } from '../../src/app/windowTitle';
import { createWelcome } from '../../src/ui/welcome';

/** An in-memory recents.json plus the set of paths that "do not exist". */
function fakeApi(initial: string | null = null) {
  const state = { text: initial, gone: new Set<string>(), writes: 0 };
  const api: RecentsApi = {
    read: async () => {
      const listed = state.text ? (JSON.parse(state.text).folders ?? []).concat(JSON.parse(state.text).files ?? []).map((e: { path: string }) => e.path) : [];
      return { text: state.text, missing: listed.filter((p: string) => state.gone.has(p)) };
    },
    write: async (text) => { state.text = text; state.writes++; },
    allow: async () => true,
    welcomeFile: async () => null,
  };
  return { api, state };
}

describe('recents rules', () => {
  it('adds newest first, dedupes, caps', () => {
    let d = emptyRecents();
    d = addRecent(d, 'file', '/a.md', 1);
    d = addRecent(d, 'file', '/b.md', 2);
    d = addRecent(d, 'file', '/a.md', 3);
    expect(d.files.map((e) => e.path)).toEqual(['/a.md', '/b.md']);
    expect(d.files[0].lastOpened).toBe(3);
    for (let i = 0; i < RECENTS_CAP + 5; i++) {d = addRecent(d, 'folder', `/f${i}`, i);}
    expect(d.folders).toHaveLength(RECENTS_CAP);
    expect(d.folders[0].path).toBe(`/f${RECENTS_CAP + 4}`);
  });

  it('dedupes case-insensitively when asked, and ignores a trailing separator', () => {
    let d = addRecent(emptyRecents(), 'folder', 'C:\\Notes', 1, true);
    d = addRecent(d, 'folder', 'c:\\notes\\', 2, true);
    expect(d.folders).toHaveLength(1);
    expect(samePath('/a/', '/a', false)).toBe(true);
    expect(samePath('/A', '/a', false)).toBe(false);
  });

  it('counts missing launches, resets when found, prunes on the third', () => {
    let d = addRecent(emptyRecents(), 'file', '/gone.md', 1);
    d = addRecent(d, 'file', '/here.md', 2);
    const gone = new Set(['/gone.md']);
    d = applyLaunchCheck(d, gone);
    d = applyLaunchCheck(d, gone);
    expect(d.files.find((e) => e.path === '/gone.md')?.missingCount).toBe(2);
    // Found again (a remounted drive): back to zero.
    d = applyLaunchCheck(d, new Set());
    expect(d.files.find((e) => e.path === '/gone.md')?.missingCount).toBe(0);
    for (let i = 0; i < MISSING_LAUNCH_LIMIT; i++) {d = applyLaunchCheck(d, gone);}
    expect(d.files.map((e) => e.path)).toEqual(['/here.md']);
  });

  it('removes and clears', () => {
    let d = addRecent(addRecent(emptyRecents(), 'file', '/a.md', 1), 'folder', '/n', 2);
    d = removeRecent(d, 'file', '/a.md');
    expect(d.files).toEqual([]);
    expect(clearRecents(d).folders).toEqual([]);
  });

  it('parses defensively: missing file is a first run, junk is not', () => {
    expect(parseRecents(null).firstRunDone).toBe(false);
    expect(parseRecents('{oops').firstRunDone).toBe(true);
    expect(parseRecents('[]').folders).toEqual([]);
    const d = parseRecents(JSON.stringify({ firstRunDone: true, files: [{ path: '/a.md', missingCount: 1 }, { nope: 1 }, { path: '' }] }));
    expect(d.files).toEqual([{ path: '/a.md', missingCount: 1, lastOpened: 0 }]);
    expect(parseRecents(serializeRecents(d))).toEqual(d);
  });

  it('views and display helpers', () => {
    const d = addRecent(emptyRecents(), 'file', '/Users/me/notes/a.md', 1);
    expect(recentsView(d, new Set(['/Users/me/notes/a.md'])).files[0]).toMatchObject({ name: 'a.md', parent: '/Users/me/notes', missing: true });
    expect(parentOf('/a.md')).toBe('/');
    expect(parentOf('C:\\n\\a.md')).toBe('C:\\n');
    expect(tildify('/Users/me/notes', '/Users/me')).toBe('~/notes');
    expect(tildify('/Users/meg/notes', '/Users/me')).toBe('/Users/meg/notes');
  });
});

describe('recents store', () => {
  it('first run until the flag is written; removal persists across a reload', async () => {
    const { api, state } = fakeApi();
    const store = createRecentsStore({ api, caseInsensitive: false, now: () => 5 });
    await store.load();
    expect(store.firstRunDone()).toBe(false);
    await store.markFirstRunDone();
    await store.add('file', '/w.md');
    await store.add('folder', '/n');
    await store.remove('folder', '/n');

    const again = createRecentsStore({ api, caseInsensitive: false });
    await again.load();
    expect(again.firstRunDone()).toBe(true);
    expect(again.data().files.map((e) => e.path)).toEqual(['/w.md']);
    expect(again.data().folders).toEqual([]);
    expect(state.writes).toBe(4);
  });

  it('launch check prunes after three launches and a missing entry is flagged for the welcome screen', async () => {
    const { api, state } = fakeApi(serializeRecents(addRecent(addRecent(emptyRecents(), 'file', '/gone.md', 1), 'file', '/ok.md', 2)));
    state.gone.add('/gone.md');
    for (let launch = 1; launch <= 3; launch++) {
      const store = createRecentsStore({ api, caseInsensitive: false });
      await store.load();
      if (launch < 3) {
        expect(store.view().files.find((f) => f.path === '/gone.md')?.missing).toBe(true);
      }
      await store.launchCheck();
    }
    const last = createRecentsStore({ api, caseInsensitive: false });
    await last.load();
    expect(last.data().files.map((e) => e.path)).toEqual(['/ok.md']);
  });

  it('a write re-reads first, so another window\'s entry survives', async () => {
    const { api, state } = fakeApi(serializeRecents(emptyRecents()));
    const a = createRecentsStore({ api, caseInsensitive: false });
    const b = createRecentsStore({ api, caseInsensitive: false });
    await a.load();
    await b.load();
    await a.add('file', '/from-a.md');
    await b.add('file', '/from-b.md');
    expect(JSON.parse(state.text!).files.map((e: { path: string }) => e.path)).toEqual(['/from-b.md', '/from-a.md']);
  });

  it('notifies listeners on change', async () => {
    const { api } = fakeApi();
    const store = createRecentsStore({ api, caseInsensitive: false });
    let calls = 0;
    store.onChange(() => calls++);
    await store.load();
    await store.add('file', '/x.md');
    expect(calls).toBe(2);
  });
});

describe('window title (edge case 29)', () => {
  it('file — folder, Untitled — folder, MikeDown for the welcome screen', () => {
    expect(formatWindowTitle({ doc: { path: '/n/sub/a.md', dirty: false }, folder: '/n', platform: 'mac' })).toBe('a.md — n');
    expect(formatWindowTitle({ doc: { path: '/x/lone.md', dirty: false }, folder: null, platform: 'mac' })).toBe('lone.md');
    expect(formatWindowTitle({ doc: { path: null, dirty: false }, folder: '/n', platform: 'mac' })).toBe('Untitled — n');
    expect(formatWindowTitle({ doc: { path: null, dirty: false }, folder: null, platform: 'mac' })).toBe('Untitled');
    expect(formatWindowTitle({ doc: null, folder: null, platform: 'other' })).toBe('MikeDown');
    expect(formatWindowTitle({ doc: null, folder: 'C:\\Notes\\', platform: 'other' })).toBe('Notes');
  });

  it('dirty: the macOS dot comes from setDocumentEdited, elsewhere a bullet', () => {
    expect(formatWindowTitle({ doc: { path: '/n/a.md', dirty: true }, folder: '/n', platform: 'mac' })).toBe('a.md — n');
    expect(formatWindowTitle({ doc: { path: '/n/a.md', dirty: true }, folder: '/n', platform: 'other' })).toBe('• a.md — n');
    expect(formatWindowTitle({ doc: { path: '/x/com.interappdev.mikedown/Welcome to MikeDown.md', dirty: false }, folder: null, platform: 'other' })).toBe('Welcome to MikeDown.md');
    expect(formatWindowTitle({ doc: { path: '/x/lone.md', dirty: true }, folder: null, platform: 'other' })).toBe('• lone.md');
  });
});

describe('welcome screen', () => {
  it('renders actions, two lists, greys missing entries and wires remove', () => {
    const calls: string[] = [];
    const w = createWelcome({
      isMac: true,
      openFolder: () => calls.push('folder'),
      openFile: () => calls.push('file'),
      newFile: () => calls.push('new'),
      openRecent: (kind, p) => calls.push(`open ${kind} ${p}`),
      removeRecent: (kind, p) => calls.push(`remove ${kind} ${p}`),
    });
    document.body.appendChild(w.el);
    w.render({
      folders: [{ kind: 'folder', path: '/n', name: 'n', parent: '/', missing: false }],
      files: [{ kind: 'file', path: '/gone.md', name: 'gone.md', parent: '/', missing: true }],
    });
    w.setVisible(true);
    expect(w.isVisible()).toBe(true);
    const buttons = [...w.el.querySelectorAll<HTMLButtonElement>('.mdapp-welcome__action')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Open Folder…⌥⌘O', 'Open File…⌘O', 'New File⌘N']);
    buttons.forEach((b) => b.click());
    const folderOpen = w.el.querySelector<HTMLButtonElement>('[data-kind="folder"] .mdapp-welcome__open')!;
    folderOpen.click();
    const missing = w.el.querySelector<HTMLElement>('[data-kind="file"] .mdapp-welcome__item')!;
    expect(missing.classList.contains('is-missing')).toBe(true);
    expect(missing.querySelector<HTMLButtonElement>('.mdapp-welcome__open')!.disabled).toBe(true);
    missing.querySelector<HTMLButtonElement>('.mdapp-welcome__remove')!.click();
    expect(calls).toEqual(['folder', 'file', 'new', 'open folder /n', 'remove file /gone.md']);
    expect(w.el.querySelector('.mdapp-welcome__hint')?.textContent).toMatch(/Open a folder/);
    w.render({ folders: [], files: [] });
    expect([...w.el.querySelectorAll<HTMLElement>('.mdapp-welcome__empty')].every((e) => !e.hidden)).toBe(true);
    w.el.remove();
  });
});
