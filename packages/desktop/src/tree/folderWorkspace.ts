/**
 * The folder a window has open (M3): owns the tree, the watcher
 * subscriptions, the folder `.md` index lent to TauriHost, and every file
 * operation the tree asks for. Everything that touches disk goes through the
 * typed wrappers in `documents/fsApi.ts`.
 *
 * - New File creates `Untitled.md` (or the next free `Untitled N.md`) and
 *   drops into inline rename; a name typed without an extension gets `.md`
 *   (edge case 29). New Folder works the same way with `New Folder`.
 * - Rename, move and delete carry `.mikedown/versions/<rel path>/` along when
 *   it exists (edge case 3; M6 creates it). Delete goes to the OS Trash with
 *   a confirmation that offers "Don't ask again" (edge case 21; in memory
 *   until M5 persists desktop settings).
 * - Drags inside the tree move, drops from outside copy, Option/Alt inverts
 *   (edge case 20).
 */
import type { PathOps } from '@mikedown/core/shared/imagePaste';
import type { FsApi, FsChange, TreeApi, WatchApi } from '../documents/fsApi';
import type { KnowledgeBase } from '../host/tauriHost';
import type { DesktopSettingsStore } from '../settings/desktopSettings';
import type { Dialogs } from '../ui/dialogs';
import { showContextMenu, type MenuEntry } from '../ui/contextMenu';
import type { Sidebar } from '../ui/sidebar';
import { dropRefusal, treeDropOperation, type TreeDropOperation } from './dropRouting';
import { createFileTree, type FileTree, type TreeNode } from './fileTree';
import { createBacklinkIndex, type BacklinkIndex } from './backlinks';
import { createMdIndex, type MdIndex } from './mdIndex';
import { isInside, uniqueName, validateTarget, versionsPathFor, withMarkdownExtension } from './treeLogic';

export interface WorkspaceDeps {
  path: PathOps;
  isMac: boolean;
  windows: boolean;
  fs: FsApi;
  tree: TreeApi;
  watch: WatchApi;
  dialogs: Dialogs;
  settings: DesktopSettingsStore;
  sidebar: Sidebar;
  /** The open document, as far as the tree needs it. */
  doc: {
    path(): string | null;
    open(path: string): Promise<boolean>;
    pathMoved(from: string, to: string): void;
    pathDeleted(path: string): void;
  };
  /** Lend (or withdraw) the index to TauriHost. */
  setKnowledgeBase(kb: KnowledgeBase | null): void;
  /** Files around the document changed: core re-resolves wikilinks and re-checks links. */
  refreshLinks(): void;
  /** A file in the folder was edited (its links may have changed): refresh the sidebar backlinks. */
  contentChanged?(): void;
  /** Escape from the tree. */
  focusEditor(): void;
  copyText(text: string): Promise<void>;
  /** M6: carry a versions mirror along (merging into an existing one). Default: move it when it exists. */
  moveVersions?(from: string, to: string): Promise<void>;
}

export interface FolderWorkspace {
  readonly tree: FileTree;
  root(): string | null;
  /** Open `root` in this window (the caller handled dirty documents). */
  open(root: string): Promise<void>;
  close(): Promise<void>;
  index(): MdIndex | null;
  /** What `setKnowledgeBase` was last given, for editors created after the folder opened (M4 panes). */
  knowledgeBase(): KnowledgeBase | null;
  newFile(dir?: string): Promise<void>;
  newFolder(dir?: string): Promise<void>;
  toggleHidden(): Promise<void>;
  /** Highlight and reveal the open document. */
  syncActive(path: string | null): void;
  /** Paths dropped from outside the app at a viewport point; true when the tree took them. */
  dropFromOutside(paths: string[], x: number, y: number): Promise<boolean>;
  /** Highlight the drop target under a viewport point while an outside drag hovers. */
  hoverFromOutside(x: number, y: number | null): void;
  /** Watcher events (for tests: the real ones arrive through `watch.onChange`). */
  handleChange(change: FsChange): void;
}

const REFRESH_DEBOUNCE_MS = 120;
const LINKS_DEBOUNCE_MS = 400;

export function createFolderWorkspace(deps: WorkspaceDeps): FolderWorkspace {
  const { path, dialogs, settings } = deps;
  let rootPath: string | null = null;
  let index: MdIndex | null = null;
  let backlinks: BacklinkIndex | null = null;
  let knowledgeBase: KnowledgeBase | null = null;
  const lendKnowledgeBase = (kb: KnowledgeBase | null): void => {
    knowledgeBase = kb;
    deps.setKnowledgeBase(kb);
  };
  /** Created by New File / New Folder and still in their first rename. */
  const fresh = new Set<string>();
  const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let linksTimer: ReturnType<typeof setTimeout> | undefined;
  let contentTimer: ReturnType<typeof setTimeout> | undefined;

  const trashName = deps.isMac ? 'Trash' : 'Recycle Bin';
  const revealLabel = deps.isMac ? 'Reveal in Finder' : 'Show in Explorer';

  const tree = createFileTree({
    path,
    isMac: deps.isMac,
    windows: deps.windows,
    listDir: (dir) => deps.fs.listDir(dir, { showHidden: settings.get().tree.showHidden }),
    showHidden: () => settings.get().tree.showHidden,
    watch: (dir) => {
      void deps.watch.watch(dir).catch((err: unknown) => console.warn('MikeDown: cannot watch', dir, err));
    },
    unwatch: (dir) => { void deps.watch.unwatch(dir).catch(() => { /* already gone */ }); },
    open: (node) => { void deps.doc.open(node.path); },
    contextMenu: (node, x, y) => { void contextMenu(node, x, y); },
    rename: (node, name) => renameNode(node, name),
    remove: (nodes) => { void removePaths(nodes.map((n) => n.path)); },
    drop: (sources, dir, alt) => { void transfer(sources.map((s) => s.path), dir, treeDropOperation('tree', alt)); },
    leave: () => deps.focusEditor(),
  });

  void deps.watch.onChange((change) => handleChange(change));

  const READ_ONLY_FOLDER = 'This folder is read-only. You do not have permission to add, rename or delete items in it.';

  /** Edge 10: why `dir` cannot be changed, or null when it can (or cannot be checked). */
  async function lockReason(dir: string): Promise<string | null> {
    try {
      const st = await deps.fs.stat(dir);
      return st.exists && st.isDir && st.readOnly ? READ_ONLY_FOLDER : null;
    } catch {
      return null;
    }
  }

  function fail(err: unknown): void {
    dialogs.toast(err instanceof Error ? err.message : String(err), { error: true, ms: 6000 });
  }

  function scheduleRefresh(dir: string): void {
    clearTimeout(refreshTimers.get(dir));
    refreshTimers.set(dir, setTimeout(() => {
      refreshTimers.delete(dir);
      void tree.refreshDir(dir);
    }, REFRESH_DEBOUNCE_MS));
  }

  function scheduleLinks(): void {
    index?.invalidate();
    clearTimeout(linksTimer);
    linksTimer = setTimeout(() => deps.refreshLinks(), LINKS_DEBOUNCE_MS);
  }

  function handleChange(change: FsChange): void {
    if (!rootPath || !isInside(rootPath, change.dir, path)) {return;}
    // Whatever changed, the backlinks read the file again.
    backlinks?.invalidate(change.path);
    // A content edit of a known file changes neither the tree nor the index's file list.
    const known = tree.findNode(change.path);
    if (change.kind === 'modify' && known && !known.isDir) {
      clearTimeout(contentTimer);
      contentTimer = setTimeout(() => deps.contentChanged?.(), LINKS_DEBOUNCE_MS);
      return;
    }
    scheduleRefresh(change.dir);
    // The watched folder itself went away or was renamed: its parent changed too.
    if (path.relative(change.path, change.dir) === '' && change.kind !== 'modify') {
      scheduleRefresh(path.dirname(change.dir));
    }
    if (!/(^|[\\/])\.mikedown([\\/]|$)/.test(path.relative(rootPath, change.path))) {scheduleLinks();}
  }

  async function namesIn(dir: string): Promise<string[]> {
    return (await deps.fs.listDir(dir)).map((e) => e.name);
  }

  function targetDirFor(dir?: string): string | null {
    if (dir) {return dir;}
    const sel = tree.selectedNode();
    if (sel) {return sel.isDir ? sel.path : path.dirname(sel.path);}
    return rootPath;
  }

  async function create(kind: 'file' | 'folder', dir?: string): Promise<void> {
    const parent = targetDirFor(dir);
    if (!parent) {return;}
    const locked = await lockReason(parent);
    if (locked) {
      fail(locked);
      return;
    }
    try {
      const name = uniqueName(kind === 'file' ? 'Untitled.md' : 'New Folder', await namesIn(parent));
      const p = path.join(parent, name);
      if (kind === 'file') {await deps.tree.createFile(p);}
      else {await deps.tree.createDir(p);}
      fresh.add(p);
      await tree.refreshDir(parent);
      await tree.startRename(p, { selectStem: true });
      index?.invalidate();
    } catch (err) {
      fail(err);
    }
  }

  /** Move or delete the versions mirror alongside (edge case 3). */
  async function moveVersions(from: string, to: string): Promise<void> {
    if (!rootPath) {return;}
    if (deps.moveVersions) {
      try {
        await deps.moveVersions(from, to);
      } catch (err) {
        console.warn('MikeDown: could not move versions', from, err);
      }
      return;
    }
    const a = versionsPathFor(rootPath, from, path);
    const b = versionsPathFor(rootPath, to, path);
    if (!a || !b) {return;}
    try {
      if (await deps.fs.exists(a)) {await deps.tree.movePath(a, b);}
    } catch (err) {
      console.warn('MikeDown: could not move versions', a, err);
    }
  }

  async function renameNode(node: TreeNode, typed: string): Promise<string | false> {
    const isFresh = fresh.has(node.path);
    const name = isFresh && !node.isDir ? withMarkdownExtension(typed) : typed.trim();
    const to = path.join(path.dirname(node.path), name);
    fresh.delete(node.path);
    if (name === node.name) {return node.path;}
    const problem = validateTarget(to, name, deps.windows) ?? (await lockReason(path.dirname(node.path)));
    if (problem) {
      fail(problem);
      if (isFresh) {fresh.add(node.path);}
      return false;
    }
    try {
      await deps.tree.rename(node.path, to);
    } catch (err) {
      fail(err);
      if (isFresh) {fresh.add(node.path);}
      return false;
    }
    await moveVersions(node.path, to);
    deps.doc.pathMoved(node.path, to);
    scheduleLinks();
    return to;
  }

  async function removePaths(paths: string[]): Promise<void> {
    if (!rootPath || paths.length === 0) {return;}
    const targets = paths.filter((p) => path.relative(rootPath!, p) !== '');
    if (targets.length === 0) {return;}
    for (const dir of new Set(targets.map((t) => path.dirname(t)))) {
      const locked = await lockReason(dir);
      if (locked) {
        fail(locked);
        return;
      }
    }
    if (settings.get().tree.confirmDelete) {
      const what = targets.length === 1 ? `“${path.basename(targets[0])}”` : `${targets.length} items`;
      const answer = await dialogs.confirm(`Move ${what} to the ${trashName}?`, {
        okLabel: deps.isMac ? 'Move to Trash' : 'Delete',
        cancelLabel: 'Cancel',
        checkboxLabel: 'Don’t ask again',
        danger: true,
        detail: `You can restore it from the ${trashName}.`,
      });
      if (!answer.ok) {
        tree.focus();
        return;
      }
      if (answer.checked) {settings.setTree({ confirmDelete: false });}
    }
    for (const p of targets) {
      try {
        await deps.tree.trash(p);
      } catch (err) {
        fail(err);
        continue;
      }
      const versions = versionsPathFor(rootPath, p, path);
      if (versions) {
        try {
          if (await deps.fs.exists(versions)) {await deps.tree.trash(versions);}
        } catch (err) {
          console.warn('MikeDown: could not trash versions', versions, err);
        }
      }
      deps.doc.pathDeleted(p);
      await tree.refreshDir(path.dirname(p));
    }
    scheduleLinks();
    tree.focus();
  }

  /** Move or copy `sources` into `dir`. Copies pick a free name; moves refuse to overwrite. */
  async function transfer(sources: string[], dir: string, op: TreeDropOperation): Promise<void> {
    let lastTarget: string | null = null;
    for (const src of sources) {
      const refusal = dropRefusal(src, dir, op, path);
      if (refusal === 'same') {continue;}
      if (refusal === 'self') {
        fail(`“${path.basename(src)}” cannot go inside itself.`);
        continue;
      }
      try {
        if (op === 'copy') {
          const name = uniqueName(path.basename(src), await namesIn(dir), 'copy');
          const to = path.join(dir, name);
          const problem = validateTarget(to, name, deps.windows);
          if (problem) { fail(problem); continue; }
          await deps.tree.copyPath(src, to);
          lastTarget = to;
        } else {
          const to = path.join(dir, path.basename(src));
          const problem = validateTarget(to, path.basename(src), deps.windows);
          if (problem) { fail(problem); continue; }
          await deps.tree.movePath(src, to);
          await moveVersions(src, to);
          deps.doc.pathMoved(src, to);
          lastTarget = to;
          await tree.refreshDir(path.dirname(src));
        }
      } catch (err) {
        fail(err);
      }
    }
    await tree.refreshDir(dir);
    if (lastTarget) {await tree.reveal(lastTarget, { focus: true });}
    scheduleLinks();
  }

  function relativeToRoot(p: string): string {
    return rootPath ? path.relative(rootPath, p).replace(/\\/g, '/') : p;
  }

  async function contextMenu(node: TreeNode | null, x: number, y: number): Promise<void> {
    if (!rootPath) {return;}
    const target = node?.path ?? rootPath;
    const dir = node ? (node.isDir ? node.path : path.dirname(node.path)) : rootPath;
    const renameHint = deps.isMac ? '↩' : 'F2';
    const deleteHint = deps.isMac ? '⌘⌫' : 'Del';
    // Edge 10: New needs the folder to be writable; Rename and Delete need its parent to be.
    const newLock = await lockReason(dir);
    const parentLock = node ? await lockReason(path.dirname(node.path)) : null;
    const entries: MenuEntry[] = [];
    if (node && !node.isDir) {
      entries.push({ label: 'Open', run: () => { void deps.doc.open(node.path); } }, null);
    }
    entries.push(
      { label: 'New File', disabled: !!newLock, title: newLock ?? undefined, run: () => { void create('file', dir); } },
      { label: 'New Folder', disabled: !!newLock, title: newLock ?? undefined, run: () => { void create('folder', dir); } },
    );
    if (node) {
      entries.push(
        null,
        { label: 'Rename…', hint: renameHint, disabled: !!parentLock, title: parentLock ?? undefined, run: () => { void tree.startRename(node.path, { selectStem: !node.isDir }); } },
        { label: `Move to ${trashName}`, hint: deleteHint, disabled: !!parentLock, title: parentLock ?? undefined, run: () => { void removePaths([node.path]); } },
      );
    }
    entries.push(
      null,
      { label: revealLabel, run: () => { void deps.tree.revealPath(target).catch(fail); } },
      { label: 'Copy Path', run: () => { void deps.copyText(target).then(() => dialogs.toast('Path copied.'), fail); } },
    );
    if (node) {
      entries.push({ label: 'Copy Relative Path', run: () => { void deps.copyText(relativeToRoot(target)).then(() => dialogs.toast('Relative path copied.'), fail); } });
    }
    entries.push(null, {
      label: settings.get().tree.showHidden ? 'Hide Hidden Files' : 'Show Hidden Files',
      run: () => { void toggleHidden(); },
    });
    showContextMenu(x, y, entries, { label: node ? node.name : 'Folder' });
  }

  async function toggleHidden(): Promise<void> {
    settings.setTree({ showHidden: !settings.get().tree.showHidden });
    deps.sidebar.setShowHidden(settings.get().tree.showHidden);
    await tree.refreshAll();
    scheduleLinks();
  }

  return {
    tree,
    root: () => rootPath,
    async open(root) {
      await deps.tree.allowFolder(root);
      if (rootPath) {await deps.watch.unwatchAll().catch(() => { /* none */ });}
      rootPath = root;
      fresh.clear();
      index = createMdIndex(root, {
        path,
        listMarkdown: (r) => deps.tree.listMarkdown(r, settings.get().tree.showHidden),
        readText: (p) => deps.fs.readText(p),
        exists: (p) => deps.fs.exists(p),
        createFile: async (p, content) => {
          await deps.tree.createFile(p);
          await deps.fs.writeText(p, content, { eol: 'lf', bom: false });
        },
      });
      backlinks = createBacklinkIndex({ path, index, readText: (p) => deps.fs.readText(p) });
      deps.sidebar.setFolder({ name: path.basename(root) || root, path: root });
      const rootLock = await lockReason(root);
      deps.sidebar.setWritable(!rootLock, rootLock ?? undefined);
      deps.sidebar.setShowHidden(settings.get().tree.showHidden);
      await tree.setRoot(root);
      lendKnowledgeBase({
        index,
        backlinks,
        openCreated: (p) => {
          void tree.refreshDir(path.dirname(p));
          void deps.doc.open(p);
        },
      });
      deps.refreshLinks();
    },
    async close() {
      rootPath = null;
      index = null;
      backlinks = null;
      await deps.watch.unwatchAll().catch(() => { /* none */ });
      await tree.setRoot(null);
      deps.sidebar.setFolder(null);
      lendKnowledgeBase(null);
      deps.refreshLinks();
    },
    index: () => index,
    knowledgeBase: () => knowledgeBase,
    newFile: (dir) => create('file', dir),
    newFolder: (dir) => create('folder', dir),
    toggleHidden,
    syncActive(p) {
      tree.setActive(p);
      if (p && rootPath && isInside(rootPath, p, path)) {void tree.reveal(p);}
    },
    async dropFromOutside(paths, x, y) {
      tree.setDropTarget(null);
      if (!rootPath) {return false;}
      const over = document.elementFromPoint(x, y);
      if (!over || !tree.el.contains(over)) {
        // The empty part of the sidebar below the rows counts as the root.
        if (!over || !deps.sidebar.el.contains(over)) {return false;}
      }
      const row = tree.rowAt(x, y);
      const dir = row ? (row.isDir ? row.path : path.dirname(row.path)) : rootPath;
      let alt = false;
      try { alt = (await deps.tree.modifierState()).alt; } catch { /* no modifier info */ }
      // A drag of files that already live in this folder (e.g. from Finder
      // showing the same folder) still counts as "from outside": copy.
      await transfer(paths, dir, treeDropOperation('external', alt));
      return true;
    },
    hoverFromOutside(x, y) {
      if (y === null || !rootPath) {
        tree.setDropTarget(null);
        return;
      }
      const over = document.elementFromPoint(x, y);
      if (!over || !deps.sidebar.el.contains(over)) {
        tree.setDropTarget(null);
        return;
      }
      const row = tree.rowAt(x, y);
      tree.setDropTarget(row ? (row.isDir ? row.path : path.dirname(row.path)) : rootPath);
    },
    handleChange,
  };
}
