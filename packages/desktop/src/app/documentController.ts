/**
 * Drives the lone-file window: open a path (markdown or text into the editor,
 * images into the viewer, anything else to the OS), save and Save As with the
 * document's own line endings and BOM, read-only handling (edge case 10), the
 * window title and dirty state (edge case 29), and the discard guard.
 * M3 adds: following the open file through tree renames, moves and deletes,
 * offering to create a missing link target (edge case 13), and Open
 * Containing Folder (edge case 4). M4 generalises this to many documents and
 * tabs.
 */
import type { MikeDownEditorHandle, MikeDownStats } from '@mikedown/core';
import type { PathOps } from '@mikedown/core/shared/imagePaste';
import {
  applyRead,
  classifyPath,
  createUntitled,
  fileName,
  planOpen,
  windowTitle,
  writeOptionsFor,
  type DocumentModel,
} from '../documents/documentModel';
import type { FsApi, WindowApi } from '../documents/fsApi';
import type { Chrome } from '../ui/chrome';
import { MARKDOWN_FILTERS, type Dialogs } from '../ui/dialogs';
import type { ImageViewer } from '../ui/imageViewer';

export interface DocumentControllerDeps {
  handle: MikeDownEditorHandle;
  model: DocumentModel;
  fs: FsApi;
  win: WindowApi;
  setTitle(title: string): Promise<void>;
  chrome: Chrome;
  dialogs: Dialogs;
  imageViewer: ImageViewer;
  path: PathOps;
  isMac: boolean;
  /** The element core mounted into; used to read (never write) the source-mode state. */
  editorRoot: HTMLElement;
  /** Open Containing Folder: reopen the window on this folder, keeping the file (M3). */
  openFolder?(dir: string): void;
  /** The open document's path changed (opened, renamed, closed). */
  onDocumentPath?(path: string | null): void;
  /** A missing markdown link target: create it (with this content) so it can open. */
  createFile?(path: string, content: string): Promise<void>;
}

export interface DocumentController {
  openPath(path: string, opts?: { anchor?: string | null }): Promise<boolean>;
  openViaDialog(): Promise<boolean>;
  save(): Promise<boolean>;
  saveAs(): Promise<boolean>;
  /** Edge case 14: Save As prompt for an unsaved document; the new path or null. */
  ensureSaved(): Promise<string | null>;
  /** Refresh title, dirty dot, tab and proxy icon from the model. */
  refresh(): void;
  isSourceMode(): boolean;
  toggleSource(): void;
  /** True when it is fine to drop the current buffer (clean, or the user agreed). */
  confirmDiscard(): Promise<boolean>;
  onStats(stats: MikeDownStats): void;
  openContainingFolder(): void;
  /** A tree rename or move: `from` (the file or a folder above it) is now `to`. */
  pathMoved(from: string, to: string): void;
  /** A tree delete took the open file (or a folder above it) to the Trash. */
  pathDeleted(path: string): void;
  /** Replace the document with an empty Untitled one (the caller already asked about unsaved changes). */
  closeDocument(): void;
}

export function createDocumentController(deps: DocumentControllerDeps): DocumentController {
  const { handle, model, fs, win, chrome, dialogs, imageViewer, path } = deps;
  let lastTitle = '';
  let lastEdited: boolean | null = null;
  let lastRepresented: string | null = null;
  let lastDocPath: string | null | undefined;

  function isSourceMode(): boolean {
    const el = deps.editorRoot.querySelector<HTMLElement>('.mikedown-source-container');
    return !!el && el.style.display !== 'none' && el.style.display !== '';
  }

  function setSourceMode(on: boolean): void {
    if (isSourceMode() !== on) {handle.command('toggleSource');}
  }

  function refresh(): void {
    const title = windowTitle(model, deps.isMac ? 'mac' : 'other');
    if (title !== lastTitle) {
      lastTitle = title;
      void deps.setTitle(title).catch(() => { /* window gone */ });
    }
    if (model.dirty !== lastEdited) {
      lastEdited = model.dirty;
      void win.setDocumentEdited(model.dirty).catch(() => { /* non-mac */ });
    }
    const represented = model.path ?? '';
    if (represented !== lastRepresented) {
      lastRepresented = represented;
      void win.setRepresentedFile(represented).catch(() => { /* non-mac */ });
    }
    if (model.path !== lastDocPath) {
      lastDocPath = model.path;
      deps.onDocumentPath?.(model.path);
    }
    chrome.setTab({
      name: fileName(model),
      dirty: model.dirty,
      readOnly: model.readOnly,
      readOnlyReason: model.readOnlyReason,
      path: model.path,
    });
  }

  async function confirmDiscard(): Promise<boolean> {
    if (!model.dirty) {return true;}
    return dialogs.ask(`${fileName(model)} has unsaved changes. Discard them?`, {
      okLabel: 'Discard Changes',
      cancelLabel: 'Cancel',
      kind: 'warning',
    });
  }

  async function writeTo(target: string): Promise<boolean> {
    const text = handle.getMarkdown();
    try {
      const res = await fs.writeText(target, text, writeOptionsFor(model));
      model.path = target;
      model.text = text;
      model.dirty = false;
      model.mtimeMs = res.mtimeMs;
      model.kind = classifyPath(target);
      if (model.encoding === 'unknown') {model.encoding = model.bom ? 'utf8-bom' : 'utf8';}
      if (model.readOnly) {
        model.readOnly = false;
        model.readOnlyReason = null;
        handle.setReadOnly(false);
        chrome.setNotice(null);
      }
      handle.markSaved(text);
      refresh();
      return true;
    } catch (err) {
      await dialogs.error(`Could not save ${fileName({ path: target })}.\n\n${String(err)}`);
      return false;
    }
  }

  async function saveAs(): Promise<boolean> {
    let target = await dialogs.saveFile({
      defaultPath: model.path ?? 'Untitled.md',
      filters: MARKDOWN_FILTERS,
      title: 'Save As',
    });
    if (!target) {return false;}
    // Edge case 29: a name without an extension gets `.md`.
    if (!path.extname(target)) {target = `${target}.md`;}
    return writeTo(target);
  }

  async function save(): Promise<boolean> {
    if (!model.path) {return saveAs();}
    if (model.readOnly) {
      const reason = model.readOnlyReason ?? 'The file is read-only.';
      const ok = await dialogs.ask(`${fileName(model)} cannot be saved in place.\n\n${reason}\n\nSave a copy instead?`, {
        okLabel: 'Save As…',
        cancelLabel: 'Cancel',
        kind: 'info',
      });
      return ok ? saveAs() : false;
    }
    return writeTo(model.path);
  }

  async function ensureSaved(): Promise<string | null> {
    if (model.path) {return model.path;}
    const ok = await dialogs.ask('Save the document first so the image has a home.', {
      okLabel: 'Save As…',
      cancelLabel: 'Cancel',
      kind: 'info',
    });
    if (!ok) {return null;}
    return (await saveAs()) ? model.path : null;
  }

  async function openPath(target: string, opts?: { anchor?: string | null }): Promise<boolean> {
    const kind = classifyPath(target);
    if (kind === 'other') {
      try {
        await fs.openInDefaultApp(target);
      } catch (err) {
        await dialogs.error(`Could not open ${target}.\n\n${String(err)}`);
      }
      return false;
    }
    if (kind === 'image') {
      try {
        await fs.allowAsset(target);
      } catch (err) {
        await dialogs.error(String(err));
        return false;
      }
      const name = target.split(/[\\/]/).pop() ?? target;
      imageViewer.show(target, fs.assetUrl(target), () => {
        imageViewer.hide();
        lastTitle = '';
        refresh();
        handle.focus();
      });
      const title = windowTitle({ path: target, dirty: false }, 'mac');
      lastTitle = title;
      void deps.setTitle(title).catch(() => { /* window gone */ });
      chrome.setTab({ name, dirty: false, readOnly: true, readOnlyReason: 'Image', path: target });
      return true;
    }

    if (kind === 'markdown' && deps.createFile && !(await offerCreate(target))) {return false;}
    if (!(await confirmDiscard())) {return false;}
    let info;
    try {
      info = await fs.readText(target);
    } catch (err) {
      await dialogs.error(`Could not open ${target}.\n\n${String(err)}`);
      return false;
    }
    const plan = planOpen(target, info);
    imageViewer.hide();
    applyRead(model, target, info, plan);
    handle.setMarkdown(info.text, { pristine: true });
    setSourceMode(plan.sourceMode);
    handle.setReadOnly(plan.readOnly);
    chrome.setNotice(plan.notice);
    lastTitle = '';
    refresh();
    if (opts?.anchor) {handle.scrollToAnchor(opts.anchor);}
    handle.focus();
    return true;
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
    const picked = await dialogs.openFile({
      defaultPath: model.path ? path.dirname(model.path) : undefined,
      filters: MARKDOWN_FILTERS,
      title: 'Open',
    });
    if (!picked) {return false;}
    return openPath(picked);
  }

  function toggleSource(): void {
    if (model.kind === 'text' || model.encoding === 'unknown') {
      dialogs.toast('Plain text files stay in source mode.');
      return;
    }
    handle.command('toggleSource');
  }

  return {
    openPath,
    openViaDialog,
    save,
    saveAs,
    ensureSaved,
    refresh,
    isSourceMode,
    toggleSource,
    confirmDiscard,
    onStats: (stats) => chrome.setStats(stats),
    openContainingFolder() {
      // Edge case 4: reopen the window on the parent folder with this file
      // still active.
      if (!model.path) {
        dialogs.toast('Save the document first.');
        return;
      }
      if (!deps.openFolder) {return;}
      deps.openFolder(path.dirname(model.path));
    },
    pathMoved(from, to) {
      if (!model.path) {return;}
      const next = rebase(model.path, from, to);
      if (!next || next === model.path) {return;}
      model.path = next;
      model.kind = classifyPath(next);
      lastTitle = '';
      refresh();
    },
    pathDeleted(p) {
      if (!model.path || rebase(model.path, p, p) === null) {return;}
      const name = fileName(model);
      // Keep the text: it becomes an unsaved document the user can Save As.
      model.path = null;
      model.dirty = true;
      lastTitle = '';
      refresh();
      dialogs.toast(`${name} was moved to the Trash. Its text stays open as an unsaved document.`, { ms: 6000 });
    },
    closeDocument() {
      Object.assign(model, createUntitled());
      imageViewer.hide();
      handle.setMarkdown('', { pristine: true });
      setSourceMode(false);
      handle.setReadOnly(false);
      chrome.setNotice(null);
      lastTitle = '';
      refresh();
    },
  };
}
