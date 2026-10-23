/**
 * The folder workspace over an in-memory disk: New File naming, rename and
 * delete carrying `.mikedown/versions/` along (edge case 3), the Trash
 * confirmation with "Don't ask again" (edge case 21), drag moves vs. copies
 * (edge case 20), the open document following renames, and watcher events
 * re-listing only the affected directory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirEntry, FsApi, FsChange, TreeApi, WatchApi } from '../../src/documents/fsApi';
import { createPathOps } from '../../src/host/pathOps';
import { createDesktopSettingsStore } from '../../src/settings/desktopSettings';
import { createFolderWorkspace, type FolderWorkspace } from '../../src/tree/folderWorkspace';
import type { Dialogs } from '../../src/ui/dialogs';
import type { Sidebar } from '../../src/ui/sidebar';

const path = createPathOps('posix');

/** path → true for a folder, false for a file. */
type Disk = Map<string, boolean>;

function makeDisk(entries: string[]): Disk {
  const disk: Disk = new Map([['/n', true]]);
  for (const e of entries) {
    const isDir = e.endsWith('/');
    const p = isDir ? e.slice(0, -1) : e;
    let dir = path.dirname(p);
    while (dir !== '/' && !disk.has(dir)) {
      disk.set(dir, true);
      dir = path.dirname(dir);
    }
    disk.set(p, isDir);
  }
  return disk;
}

function moveTree(disk: Disk, from: string, to: string): void {
  for (const [p, isDir] of [...disk]) {
    if (p === from || p.startsWith(`${from}/`)) {
      disk.delete(p);
      disk.set(to + p.slice(from.length), isDir);
    }
  }
}

let disk: Disk;
let calls: string[];
let changeHandler: ((c: FsChange) => void) | null;
let confirmAnswer: { ok: boolean; checked: boolean };
let altHeld = false;
let ws: FolderWorkspace;
let doc: { path: string | null; moved: Array<[string, string]>; deleted: string[] };
const settings = createDesktopSettingsStore();

function listDir(dir: string): DirEntry[] {
  return [...disk].filter(([p]) => path.dirname(p) === dir && p !== dir).map(([p, isDir]) => ({ name: path.basename(p), isDir }));
}

function setup(windows: boolean): void {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  document.body.innerHTML = '';
  disk = makeDisk(['/n/a.md', '/n/sub/b.md', '/n/.mikedown/versions/a.md/20261023T120000Z.md', '/n/.mikedown/versions/sub/b.md/20261023T120000Z.md']);
  calls = [];
  changeHandler = null;
  confirmAnswer = { ok: true, checked: false };
  altHeld = false;
  doc = { path: '/n/sub/b.md', moved: [], deleted: [] };
  settings.setTree({ confirmDelete: true, showHidden: false });

  const fs = {
    listDir: async (dir: string) => { calls.push(`list ${dir}`); return listDir(dir); },
    exists: async (p: string) => disk.has(p),
    readText: async () => ({ text: '', encoding: 'utf8', eol: 'lf', mtimeMs: 0, readOnly: false, size: 0 }),
    writeText: async () => ({ mtimeMs: 0, size: 0 }),
  } as unknown as FsApi;
  const tree: TreeApi = {
    allowFolder: async () => {},
    rename: async (from, to) => { calls.push(`rename ${from} -> ${to}`); moveTree(disk, from, to); },
    createFile: async (p) => {
      if (disk.has(p)) {throw new Error('exists');}
      calls.push(`createFile ${p}`);
      disk.set(p, false);
    },
    createDir: async (p) => { calls.push(`createDir ${p}`); disk.set(p, true); },
    movePath: async (from, to) => { calls.push(`move ${from} -> ${to}`); moveTree(disk, from, to); },
    copyPath: async (from, to) => { calls.push(`copy ${from} -> ${to}`); disk.set(to, disk.get(from) ?? false); },
    trash: async (p) => { calls.push(`trash ${p}`); moveTree(disk, p, `/Trash${p}`); },
    listMarkdown: async () => [...disk].filter(([p, d]) => !d && p.endsWith('.md') && !p.includes('.mikedown')).map(([p]) => p),
    revealPath: async () => {},
    modifierState: async () => ({ alt: altHeld }),
  };
  const watch: WatchApi = {
    watch: async (dir) => { calls.push(`watch ${dir}`); return 'native'; },
    unwatch: async (dir) => { calls.push(`unwatch ${dir}`); },
    unwatchAll: async () => {},
    onChange: async (h) => { changeHandler = h; return () => {}; },
  };
  const dialogs = {
    toast: (m: string) => { calls.push(`toast ${m}`); },
    confirm: async (m: string) => { calls.push(`confirm ${m}`); return confirmAnswer; },
  } as unknown as Dialogs;
  const sidebar = { el: document.createElement('aside'), setFolder: () => {}, setShowHidden: () => {} } as unknown as Sidebar;

  ws = createFolderWorkspace({
    path,
    isMac: true,
    windows,
    fs,
    tree,
    watch,
    dialogs,
    settings,
    sidebar,
    doc: {
      path: () => doc.path,
      open: async (p) => { calls.push(`open ${p}`); return true; },
      pathMoved: (from, to) => { doc.moved.push([from, to]); },
      pathDeleted: (p) => { doc.deleted.push(p); },
    },
    setKnowledgeBase: () => {},
    refreshLinks: () => { calls.push('refreshLinks'); },
    focusEditor: () => {},
    copyText: async () => {},
  });
  document.body.appendChild(ws.tree.el);
}

beforeEach(() => { setup(false); });

afterEach(() => {
  vi.useRealTimers();
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {await Promise.resolve();}
  await vi.advanceTimersByTimeAsync(10);
};

function rowNames(): string[] {
  return [...ws.tree.el.querySelectorAll('.mdapp-tree__row')].map((r) => r.querySelector('.mdapp-tree__name')?.textContent ?? '(editing)');
}

function input(): HTMLInputElement {
  const el = ws.tree.el.querySelector<HTMLInputElement>('.mdapp-tree__input');
  if (!el) {throw new Error('no rename field');}
  return el;
}

function press(el: HTMLElement, key: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

describe('folder workspace', () => {
  it('opens on the root only, hides .mikedown, and watches the root', async () => {
    await ws.open('/n');
    expect(rowNames()).toEqual(['sub', 'a.md']);
    expect(calls.filter((c) => c.startsWith('list'))).toEqual(['list /n']);
    expect(calls).toContain('watch /n');
  });

  it('expanding a folder lists it lazily and watches it; collapsing unwatches', async () => {
    await ws.open('/n');
    const sub = ws.tree.el.querySelector<HTMLElement>('[data-path="/n/sub"]')!;
    sub.click();
    await settle();
    expect(rowNames()).toEqual(['sub', 'b.md', 'a.md']);
    expect(calls).toContain('list /n/sub');
    expect(calls).toContain('watch /n/sub');
    ws.tree.el.querySelector<HTMLElement>('[data-path="/n/sub"]')!.click();
    await settle();
    expect(calls).toContain('unwatch /n/sub');
  });

  it('one list_dir per expand: collapse and re-expand does not list twice for the same row state', async () => {
    await ws.open('/n');
    const listsOf = (d: string): number => calls.filter((c) => c === `list ${d}`).length;
    expect(listsOf('/n/sub')).toBe(0);
    ws.tree.el.querySelector<HTMLElement>('[data-path="/n/sub"]')!.click();
    await settle();
    expect(listsOf('/n/sub')).toBe(1);
    expect(listsOf('/n')).toBe(1);
    ws.tree.el.querySelector<HTMLElement>('[data-path="/n/sub"]')!.click();
    await settle();
    ws.tree.el.querySelector<HTMLElement>('[data-path="/n/sub"]')!.click();
    await settle();
    // Each expand asks the disk once; it never fans out to other folders.
    expect(listsOf('/n/sub')).toBeLessThanOrEqual(2);
    expect(listsOf('/n')).toBe(1);
  });

  it('on Windows, inline rename refuses CON.md and a path over 259 characters (270)', async () => {
    for (const bad of ['CON.md', 'x'.repeat(270) + '.md']) {
      document.body.innerHTML = '';
      setup(true);
      await ws.open('/n');
      await ws.tree.startRename('/n/a.md');
      const field = input();
      field.value = bad;
      field.dispatchEvent(new Event('input'));
      press(field, 'Enter');
      await settle();
      expect(calls.some((c) => c.startsWith('rename')), bad).toBe(false);
      // Name errors show inline; the path-length error comes back as a toast.
      const shown = (ws.tree.el.querySelector('.mdapp-tree__error')?.textContent ?? '') + calls.filter((c) => c.startsWith('toast')).join();
      expect(shown, bad).toMatch(/reserves for devices|at most 259/);
    }
  });

  it('New File creates Untitled.md in rename mode and appends .md to the typed name', async () => {
    await ws.open('/n');
    await ws.newFile('/n');
    await settle();
    expect(calls).toContain('createFile /n/Untitled.md');
    const field = input();
    expect(field.value).toBe('Untitled.md');
    field.value = 'Meeting notes';
    press(field, 'Enter');
    await settle();
    expect(calls).toContain('rename /n/Untitled.md -> /n/Meeting notes.md');
    expect(rowNames()).toContain('Meeting notes.md');
  });

  it('a second New File picks Untitled 2.md', async () => {
    disk.set('/n/Untitled.md', false);
    await ws.open('/n');
    await ws.newFile('/n');
    await settle();
    expect(calls).toContain('createFile /n/Untitled 2.md');
  });

  it('inline rename refuses an invalid name without touching disk', async () => {
    await ws.open('/n');
    await ws.tree.startRename('/n/a.md');
    const field = input();
    field.value = 'bad/name.md';
    field.dispatchEvent(new Event('input'));
    press(field, 'Enter');
    await settle();
    expect(calls.some((c) => c.startsWith('rename'))).toBe(false);
    expect(ws.tree.el.querySelector('.mdapp-tree__error')?.textContent).toMatch(/slash/);
  });

  it('renaming a folder moves its versions and the open document follows', async () => {
    await ws.open('/n');
    await ws.tree.startRename('/n/sub');
    const field = input();
    field.value = 'Projects';
    press(field, 'Enter');
    await settle();
    expect(calls).toContain('rename /n/sub -> /n/Projects');
    expect(calls).toContain('move /n/.mikedown/versions/sub -> /n/.mikedown/versions/Projects');
    expect(disk.has('/n/.mikedown/versions/Projects/b.md/20261023T120000Z.md')).toBe(true);
    expect(doc.moved).toEqual([['/n/sub', '/n/Projects']]);
  });

  it('delete asks once with Don’t ask again, then trashes the file and its versions', async () => {
    await ws.open('/n');
    confirmAnswer = { ok: true, checked: true };
    const row = ws.tree.el.querySelector<HTMLElement>('[data-path="/n/a.md"]')!;
    row.focus();
    press(row, 'Backspace', { metaKey: true });
    await settle();
    expect(calls.filter((c) => c.startsWith('confirm'))).toEqual(['confirm Move “a.md” to the Trash?']);
    expect(calls).toContain('trash /n/a.md');
    expect(calls).toContain('trash /n/.mikedown/versions/a.md');
    expect(doc.deleted).toEqual(['/n/a.md']);
    expect(settings.get().tree.confirmDelete).toBe(false);

    // Don't ask again: the next delete goes straight to the Trash.
    const sub = ws.tree.el.querySelector<HTMLElement>('[data-path="/n/sub"]')!;
    sub.focus();
    press(sub, 'Delete');
    await settle();
    expect(calls.filter((c) => c.startsWith('confirm'))).toHaveLength(1);
    expect(calls).toContain('trash /n/sub');
  });

  it('a cancelled delete touches nothing', async () => {
    await ws.open('/n');
    confirmAnswer = { ok: false, checked: true };
    const row = ws.tree.el.querySelector<HTMLElement>('[data-path="/n/a.md"]')!;
    press(row, 'Delete');
    await settle();
    expect(calls.some((c) => c.startsWith('trash'))).toBe(false);
    expect(settings.get().tree.confirmDelete).toBe(true);
  });

  it('drops from outside copy with a free name; Alt-drops move', async () => {
    await ws.open('/n');
    disk.set('/Users/x/a.md', false);
    disk.set('/Users/x/c.md', false);
    document.elementFromPoint = () => ws.tree.el;
    expect(await ws.dropFromOutside(['/Users/x/a.md'], 10, 10)).toBe(true);
    expect(calls).toContain('copy /Users/x/a.md -> /n/a copy.md');
    altHeld = true;
    await ws.dropFromOutside(['/Users/x/c.md'], 10, 10);
    expect(calls).toContain('move /Users/x/c.md -> /n/c.md');
  });

  it('a drop outside the sidebar is not the tree’s', async () => {
    await ws.open('/n');
    document.elementFromPoint = () => document.body;
    expect(await ws.dropFromOutside(['/Users/x/a.md'], 10, 10)).toBe(false);
  });

  it('a watcher event re-lists only that directory', async () => {
    await ws.open('/n');
    calls.length = 0;
    disk.set('/n/from-finder.md', false);
    changeHandler!({ kind: 'create', path: '/n/from-finder.md', dir: '/n' });
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(calls.filter((c) => c.startsWith('list'))).toEqual(['list /n']);
    expect(rowNames()).toContain('from-finder.md');
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toContain('refreshLinks');
  });

  it('a directory with thousands of entries paints only the rows in view', async () => {
    for (let i = 0; i < 5000; i++) {disk.set(`/n/big-${i}.md`, false);}
    await ws.open('/n');
    const painted = ws.tree.el.querySelectorAll('.mdapp-tree__row');
    expect(painted.length).toBeLessThan(200);
    expect(painted[0].getAttribute('aria-setsize')).toBe('5002');
    (painted[0] as HTMLElement).focus();
    press(painted[0] as HTMLElement, 'End');
    const last = document.activeElement as HTMLElement;
    expect(last.dataset.path).toBe('/n/big-4999.md');
    expect(last.getAttribute('aria-posinset')).toBe('5002');
  });

  it('keyboard: arrows, Right expands, Left goes to the parent, type-ahead', async () => {
    await ws.open('/n');
    const first = ws.tree.el.querySelector<HTMLElement>('.mdapp-tree__row')!;
    first.focus();
    press(first, 'ArrowRight');
    await settle();
    expect(rowNames()).toEqual(['sub', 'b.md', 'a.md']);
    press(document.activeElement as HTMLElement, 'ArrowDown');
    expect((document.activeElement as HTMLElement).dataset.path).toBe('/n/sub/b.md');
    press(document.activeElement as HTMLElement, 'ArrowLeft');
    expect((document.activeElement as HTMLElement).dataset.path).toBe('/n/sub');
    press(document.activeElement as HTMLElement, 'a');
    expect((document.activeElement as HTMLElement).dataset.path).toBe('/n/a.md');
    const row = document.activeElement as HTMLElement;
    expect(row.getAttribute('role')).toBe('treeitem');
    expect(row.getAttribute('aria-level')).toBe('1');
    expect(row.tabIndex).toBe(0);
  });
});
