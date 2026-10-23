/**
 * Drives the window's documents (M4): opening a path into a tab (markdown
 * or text into the editor, images into the viewer, anything else to the OS,
 * sizes per edge case 12, cloud placeholders per edge case 10), save and Save
 * As with the document's own line endings and BOM, read-only handling, the
 * window title and dirty state (edge case 29), closing tabs with the
 * Save / Don't Save / Cancel question, the one quit dialog for every dirty
 * document (edge case 7), following files through tree renames, moves and
 * deletes, offering to create a missing link target (edge case 13), and
 * Open Containing Folder (edge case 4).
 */
import type { MikeDownEditorHandle, MikeDownStats } from '@mikedown/core';
import type { PathOps } from '@mikedown/core/shared/imagePaste';
import {
  classifyPath,
  fileName,
  planOpen,
  sizeClass,
  formatSize,
  windowTitle,
  type DocumentModel,
  type DocumentRegistry,
  type ReadInfo,
} from '../documents/documentModel';
import type { BackupScheduler } from '../documents/backups';
import type { FsApi, WindowApi } from '../documents/fsApi';
import type { PaneManager } from '../panes/paneManager';
import { applyQuitChoice, closeTabDialogSpec, dirtyDocuments, quitDialogSpec, type QuitChoice } from './quitDecision';
import { MARKDOWN_FILTERS, type Dialogs } from '../ui/dialogs';

/** Edge case 10: a cloud placeholder's read that takes longer than this shows "still downloading". */
export const DOWNLOAD_NOTICE_MS = 10_000;

export interface DocumentControllerDeps {
  registry: DocumentRegistry;
  panes: PaneManager;
  fs: FsApi;
  win: WindowApi;
  backups: BackupScheduler;
  setTitle(title: string): Promise<void>;
  setStats(stats: MikeDownStats): void;
  dialogs: Dialogs;
  path: PathOps;
  isMac: boolean;
  /** Open Containing Folder: reopen the window on this folder, keeping the file (M3). */
  openFolder?(dir: string): void;
  /** The focused pane's document changed (opened, renamed, closed, focus moved). */
  onActiveDocument?(doc: DocumentModel | null): void;
  /** The set of open documents changed (window state for file routing). */
  onDocumentsChanged?(): void;
  /** A missing markdown link target: create it (with this content) so it can open. */
  createFile?(path: string, content: string): Promise<void>;
  downloadNoticeMs?: number;
}

export interface OpenOptions {
  anchor?: string | null;
  paneId?: string;
  /** Do not move keyboard focus into the editor (restores). */
  focus?: boolean;
}

export interface DocumentController {
  openPath(path: string, opts?: OpenOptions): Promise<boolean>;
  openViaDialog(): Promise<boolean>;
  newDocument(): DocumentModel;
  save(doc?: DocumentModel | null): Promise<boolean>;
  saveAs(doc?: DocumentModel | null): Promise<boolean>;
  saveAll(): Promise<boolean>;
  /** Edge case 14: Save As prompt for an unsaved document; the new path or null. */
  ensureSaved(): Promise<string | null>;
  /** Refresh title, dirty dot and proxy icon from the focused pane's document. */
  refresh(): void;
  /** Close one tab, asking about unsaved changes when no other tab shows the document. */
  closeTab(paneId: string, index: number): Promise<boolean>;
  closeOthers(paneId: string, index: number): Promise<void>;
  closeSaved(paneId: string): void;
  closeAll(paneId?: string): Promise<boolean>;
  /**
   * Edge case 7: one dialog for every dirty document (Save All / Don't Save /
   * Cancel). Resolves true when the window may close or the app may quit.
   */
  confirmCloseAll(what: 'quit' | 'close', docs?: DocumentModel[]): Promise<boolean>;
  activeDoc(): DocumentModel | null;
  activeHandle(): MikeDownEditorHandle | null;
  isSourceMode(): boolean;
  toggleSource(): void;
  onStats(paneId: string, stats: MikeDownStats): void;
  openContainingFolder(): void;
  /** A tree rename or move: `from` (the file or a folder above it) is now `to`. */
  pathMoved(from: string, to: string): void;
  /** A tree delete took an open file (or a folder above it) to the Trash. */
  pathDeleted(path: string): void;
  /** Cloud placeholder: read the file again. */
  retry(doc: DocumentModel): void;
}

export function createDocumentController(deps: DocumentControllerDeps): DocumentController {
  const { registry, panes, fs, win, dialogs, path, backups } = deps;
  let lastTitle = '';
  let lastEdited: boolean | null = null;
  let lastRepresented: string | null = null;
  let lastActiveDoc: DocumentModel | null | undefined;
  const downloadMs = deps.downloadNoticeMs ?? DOWNLOAD_NOTICE_MS;

  function activeDoc(): DocumentModel | null {
    return panes.activeDoc();
  }

  function refresh(): void {
    const doc = activeDoc();
    const title = doc ? windowTitle(doc, deps.isMac ? 'mac' : 'other') : 'MikeDown';
    if (title !== lastTitle) {
      lastTitle = title;
      void deps.setTitle(title).catch(() => { /* window gone */ });
    }
    const edited = !!doc?.dirty;
    if (edited !== lastEdited) {
      lastEdited = edited;
      void win.setDocumentEdited(edited).catch(() => { /* non-mac */ });
    }
    const represented = doc?.path ?? '';
    if (represented !== lastRepresented) {
      lastRepresented = represented;
      void win.setRepresentedFile(represented).catch(() => { /* non-mac */ });
    }
    if (doc !== lastActiveDoc) {
      lastActiveDoc = doc;
      deps.onActiveDocument?.(doc);
    }
  }

  // ── Saving ────────────────────────────────────────────────────────────

  async function writeTo(doc: DocumentModel, target: string): Promise<boolean> {
    try {
      const wasPath = doc.path;
      await doc.save(target);
      if (wasPath !== target) {deps.onDocumentsChanged?.();}
      void backups.clear(doc);
      panes.refreshDoc(doc);
      refresh();
      return true;
    } catch (err) {
      await dialogs.error(`Could not save ${fileName({ path: target })}.\n\n${String(err)}`);
      return false;
    }
  }

  async function saveAs(doc = activeDoc()): Promise<boolean> {
    if (!doc || doc.kind === 'image') {return false;}
    let target = await dialogs.saveFile({
      defaultPath: doc.path ?? 'Untitled.md',
      filters: MARKDOWN_FILTERS,
      title: 'Save As',
    });
    if (!target) {return false;}
    // Edge case 29: a name without an extension gets `.md`.
    if (!path.extname(target)) {target = `${target}.md`;}
    const other = registry.get(target);
    if (other && other !== doc) {
      // The target is open in another tab: it becomes this document.
      panes.renameDoc(other.id, doc.id);
      registry.close(other);
    }
    return writeTo(doc, target);
  }

  async function save(doc = activeDoc()): Promise<boolean> {
    if (!doc || doc.kind === 'image') {return false;}
    if (!doc.path) {return saveAs(doc);}
    if (doc.readOnly) {
      const reason = doc.readOnlyReason ?? 'The file is read-only.';
      const ok = await dialogs.ask(`${fileName(doc)} cannot be saved in place.\n\n${reason}\n\nSave a copy instead?`, {
        okLabel: 'Save As…',
        cancelLabel: 'Cancel',
        kind: 'info',
      });
      return ok ? saveAs(doc) : false;
    }
    return writeTo(doc, doc.path);
  }

  async function saveAll(): Promise<boolean> {
    for (const doc of dirtyDocuments(registry.all())) {
      if (doc.kind === 'image') {continue;}
      if (!doc.path) {panes.open(doc, { focus: false });}
      if (!(await save(doc))) {return false;}
    }
    return true;
  }

  async function ensureSaved(): Promise<string | null> {
    const doc = activeDoc();
    if (!doc) {return null;}
    if (doc.path) {return doc.path;}
    const ok = await dialogs.ask('Save the document first so the image has a home.', {
      okLabel: 'Save As…',
      cancelLabel: 'Cancel',
      kind: 'info',
    });
    if (!ok) {return null;}
    return (await saveAs(doc)) ? doc.path : null;
  }

  // ── Opening ───────────────────────────────────────────────────────────

  function applyLargeFileNotice(doc: DocumentModel, plan: ReturnType<typeof planOpen>): void {
    if (!plan.offerRichText || !plan.notice) {return;}
    doc.notice = {
      text: plan.notice,
      action: {
        label: 'Open as rich text anyway',
        run: () => {
          doc.sourceMode = false;
          doc.notice = null;
          doc.applyMode();
          panes.applyMode(doc);
          panes.refreshDoc(doc);
        },
      },
    };
  }

  function readWithTimeout(target: string, onSlow: () => void): Promise<ReadInfo> {
    const read = fs.readText(target);
    const timer = setTimeout(onSlow, downloadMs);
    return read.finally(() => clearTimeout(timer));
  }

  /** Read `target` into a document (new or existing), marking the slow cloud case on the way. */
  async function load(target: string, opts: OpenOptions, existing?: DocumentModel): Promise<DocumentModel | null> {
    let doc = existing ?? null;
    let info: ReadInfo;
    try {
      info = await readWithTimeout(target, () => {
        if (!doc) {
          doc = registry.pending(target);
          panes.open(doc, { paneId: opts.paneId, focus: false });
        }
        doc.state = 'downloading';
        doc.applyMode();
        panes.refreshDoc(doc);
      });
    } catch (err) {
      if (doc) {
        doc.state = 'downloading';
        doc.applyMode();
        panes.refreshDoc(doc);
        dialogs.toast(`Could not read ${fileName({ path: target })}: ${String(err)}`, { error: true, ms: 6000 });
        return doc;
      }
      await dialogs.error(`Could not open ${target}.\n\n${String(err)}`);
      return null;
    }
    const plan = planOpen(target, info);
    doc = registry.open(target, info, plan);
    applyLargeFileNotice(doc, plan);
    doc.applyMode();
    panes.applyMode(doc);
    return doc;
  }

  async function openPath(target: string, opts: OpenOptions = {}): Promise<boolean> {
    const kind = classifyPath(target);
    if (kind === 'other') {
      try {
        await fs.openInDefaultApp(target);
      } catch (err) {
        await dialogs.error(`Could not open ${target}.\n\n${String(err)}`);
      }
      return false;
    }
    const known = registry.get(target);
    if (known && known.state === 'ready') {
      panes.open(known, { paneId: opts.paneId, focus: opts.focus });
      if (opts.anchor) {panes.activeHandle()?.scrollToAnchor(opts.anchor);}
      refresh();
      return true;
    }
    if (kind === 'image') {
      try {
        await fs.allowAsset(target);
      } catch (err) {
        await dialogs.error(String(err));
        return false;
      }
      const doc = registry.image(target);
      panes.open(doc, { paneId: opts.paneId, focus: opts.focus });
      deps.onDocumentsChanged?.();
      refresh();
      return true;
    }

    if (kind === 'markdown' && deps.createFile && !(await offerCreate(target))) {return false;}
    // Edge case 12: over 20 MB is refused before a byte is read.
    try {
      const st = await fs.stat(target);
      if (st.exists && sizeClass(st.size) === 'huge') {
        const ok = await dialogs.ask(`${fileName({ path: target })} is ${formatSize(st.size)}. MikeDown opens files up to ${formatSize(20 * 1024 * 1024)}.\n\nOpen it in the default app instead?`, {
          okLabel: 'Open in Default App',
          cancelLabel: 'Cancel',
          kind: 'info',
        });
        if (ok) {await fs.openInDefaultApp(target).catch((err: unknown) => dialogs.error(String(err)));}
        return false;
      }
    } catch { /* the read reports the problem */ }

    const doc = await load(target, opts, known ?? undefined);
    if (!doc) {return false;}
    panes.open(doc, { paneId: opts.paneId, focus: opts.focus });
    deps.onDocumentsChanged?.();
    refresh();
    if (opts.anchor && doc.state === 'ready') {panes.activeHandle()?.scrollToAnchor(opts.anchor);}
    return doc.state === 'ready';
  }

  function retry(doc: DocumentModel): void {
    if (!doc.path) {return;}
    doc.state = 'loading';
    panes.refreshDoc(doc);
    void load(doc.path, {}, doc).then((loaded) => {
      if (loaded) {panes.refreshDoc(loaded); refresh();}
    });
  }

  /**
   * Edge case 13: a link to a markdown file that does not exist offers to
   * create it. Resolves true when the file exists (now), false to stop.
   */
  async function offerCreate(target: string): Promise<boolean> {
    let present = true;
    try {
      present = (await fs.stat(target)).exists;
    } catch {
      return true; // Let the read report the problem.
    }
    if (present) {return true;}
    const name = target.split(/[\\/]/).pop() ?? target;
    const ok = await dialogs.ask(`“${name}” does not exist yet. Create it?`, {
      okLabel: 'Create File',
      cancelLabel: 'Cancel',
      kind: 'info',
    });
    if (!ok) {return false;}
    try {
      await deps.createFile!(target, `# ${name.replace(/\.[^.]+$/, '')}\n`);
      return true;
    } catch (err) {
      await dialogs.error(`Could not create ${name}.\n\n${String(err)}`);
      return false;
    }
  }

  function rebase(p: string, from: string, to: string): string | null {
    const rel = path.relative(from, p);
    if (rel === '') {return to;}
    if (rel.split(/[\\/]/)[0] === '..' || path.isAbsolute(rel)) {return null;}
    return path.join(to, rel);
  }

  async function openViaDialog(): Promise<boolean> {
    const current = activeDoc();
    const picked = await dialogs.openFile({
      defaultPath: current?.path ? path.dirname(current.path) : undefined,
      filters: MARKDOWN_FILTERS,
      title: 'Open',
    });
    if (!picked) {return false;}
    return openPath(picked);
  }

  function newDocument(): DocumentModel {
    const doc = registry.untitled();
    panes.open(doc);
    refresh();
    return doc;
  }

  // ── Closing ───────────────────────────────────────────────────────────

  async function askClose(spec: { message: string; detail: string; buttons: { saveAll: string; dontSave: string; cancel: string } }): Promise<QuitChoice> {
    const i = await dialogs.choose(spec.message, {
      detail: spec.detail,
      buttons: [spec.buttons.cancel, spec.buttons.dontSave, spec.buttons.saveAll],
      defaultIndex: 2,
      cancelIndex: 0,
    });
    return i === 2 ? 'saveAll' : i === 1 ? 'dontSave' : 'cancel';
  }

  /** True when the document may go away: clean, shown elsewhere, or the user chose. */
  async function releaseDoc(doc: DocumentModel, stillShownElsewhere: boolean): Promise<boolean> {
    if (stillShownElsewhere || !doc.dirty || doc.kind === 'image') {return true;}
    panes.open(doc, { focus: false });
    const choice = await askClose(closeTabDialogSpec(doc));
    const { save: toSave, discard, proceed } = applyQuitChoice(choice, [doc]);
    if (!proceed) {return false;}
    for (const d of toSave) {if (!(await save(d))) {return false;}}
    for (const d of discard) {void backups.clear(d);}
    return true;
  }

  function showingElsewhere(doc: DocumentModel, paneId: string): boolean {
    for (const p of panesOf()) {
      if (p.id !== paneId && p.tabs.some((t) => t.docId === doc.id)) {return true;}
    }
    return false;
  }

  function panesOf(): Array<{ id: string; tabs: Array<{ docId: string }> }> {
    const out: Array<{ id: string; tabs: Array<{ docId: string }> }> = [];
    const walk = (n: ReturnType<PaneManager['layout']>): void => {
      if (n.kind === 'pane') {out.push(n);}
      else {n.children.forEach(walk);}
    };
    walk(panes.layout());
    return out;
  }

  async function closeTab(paneId: string, index: number): Promise<boolean> {
    const pane = panesOf().find((p) => p.id === paneId);
    const tab = pane?.tabs[index];
    const doc = tab ? registry.byId(tab.docId) : undefined;
    if (!pane || !doc) {return false;}
    if (!(await releaseDoc(doc, showingElsewhere(doc, paneId)))) {return false;}
    // The index may have shifted while the dialog was up.
    const now = panes.tabIndex(paneId, doc);
    if (now < 0) {return true;}
    panes.closeTab(paneId, now);
    if (!showingElsewhere(doc, '')) {void backups.clear(doc);}
    deps.onDocumentsChanged?.();
    refresh();
    return true;
  }

  async function closeOthers(paneId: string, index: number): Promise<void> {
    const pane = panesOf().find((p) => p.id === paneId);
    if (!pane) {return;}
    const keep = pane.tabs[index]?.docId;
    const docs = pane.tabs.filter((t) => t.docId !== keep).map((t) => registry.byId(t.docId)).filter((d): d is DocumentModel => !!d);
    const dirty = docs.filter((d) => d.dirty && !showingElsewhere(d, paneId));
    if (!(await confirmCloseAll('close', dirty))) {return;}
    const ids = new Set(docs.map((d) => d.id));
    panes.closeTabs(paneId, (d) => ids.has(d.id));
    deps.onDocumentsChanged?.();
    refresh();
  }

  function closeSaved(paneId: string): void {
    panes.closeTabs(paneId, (d) => !d.dirty);
    deps.onDocumentsChanged?.();
    refresh();
  }

  async function closeAll(paneId?: string): Promise<boolean> {
    const targets = paneId ? panesOf().filter((p) => p.id === paneId) : panesOf();
    const docs = new Map<string, DocumentModel>();
    for (const p of targets) {for (const t of p.tabs) {const d = registry.byId(t.docId); if (d) {docs.set(d.id, d);}}}
    const dirty = [...docs.values()].filter((d) => d.dirty && (!paneId || !showingElsewhere(d, paneId)));
    if (!(await confirmCloseAll('close', dirty))) {return false;}
    for (const p of targets) {panes.closeTabs(p.id, () => true);}
    deps.onDocumentsChanged?.();
    refresh();
    return true;
  }

  async function confirmCloseAll(what: 'quit' | 'close', docs?: DocumentModel[]): Promise<boolean> {
    const dirty = dirtyDocuments(docs ?? registry.all()).filter((d) => d.kind !== 'image');
    const spec = quitDialogSpec(dirty, what);
    if (!spec) {return true;}
    const choice = await askClose(spec);
    const { save: toSave, discard, proceed } = applyQuitChoice(choice, dirty);
    if (!proceed) {return false;}
    for (const d of toSave) {
      if (!d.path) {panes.open(d, { focus: false });}
      if (!(await save(d))) {return false;}
    }
    for (const d of discard) {await backups.clear(d);}
    return true;
  }

  // ── Misc ──────────────────────────────────────────────────────────────

  function isSourceMode(): boolean {
    return panes.activeHandle()?.getViewState().sourceMode ?? false;
  }

  function toggleSource(): void {
    const doc = activeDoc();
    const handle = panes.activeHandle();
    if (!doc || !handle || doc.kind === 'image') {return;}
    if (doc.kind === 'text' || doc.encoding === 'unknown') {
      dialogs.toast('Plain text files stay in source mode.');
      return;
    }
    handle.command('toggleSource');
  }

  return {
    openPath,
    openViaDialog,
    newDocument,
    save,
    saveAs,
    saveAll,
    ensureSaved,
    refresh,
    closeTab,
    closeOthers,
    closeSaved,
    closeAll,
    confirmCloseAll,
    activeDoc,
    activeHandle: () => panes.activeHandle(),
    isSourceMode,
    toggleSource,
    onStats(paneId, stats) {
      if (paneId === panes.focusedPaneId()) {deps.setStats(stats);}
    },
    openContainingFolder() {
      // Edge case 4: reopen the window on the parent folder with this file
      // still active.
      const doc = activeDoc();
      if (!doc?.path) {
        dialogs.toast('Save the document first.');
        return;
      }
      if (!deps.openFolder) {return;}
      deps.openFolder(path.dirname(doc.path));
    },
    pathMoved(from, to) {
      for (const doc of registry.all()) {
        if (!doc.path) {continue;}
        const next = rebase(doc.path, from, to);
        if (!next || next === doc.path) {continue;}
        registry.rename(doc, next);
      }
      deps.onDocumentsChanged?.();
      lastTitle = '';
      refresh();
    },
    pathDeleted(p) {
      for (const doc of registry.all()) {
        if (!doc.path || rebase(doc.path, p, p) === null) {continue;}
        const name = fileName(doc);
        if (doc.kind === 'image') {
          panes.closeTabs(panes.focusedPaneId(), (d) => d === doc);
          for (const pane of panesOf()) {panes.closeTabs(pane.id, (d) => d === doc);}
          continue;
        }
        // Keep the text: it becomes an unsaved document the user can Save As.
        registry.rename(doc, null);
        doc.savedText = '';
        doc.replaceText(doc.text);
        if (!doc.dirty) {
          doc.dirty = true;
          backups.touch(doc);
        }
        panes.refreshDoc(doc);
        dialogs.toast(`${name} was moved to the Trash. Its text stays open as an unsaved document.`, { ms: 6000 });
      }
      deps.onDocumentsChanged?.();
      lastTitle = '';
      refresh();
    },
    retry,
  };
}
