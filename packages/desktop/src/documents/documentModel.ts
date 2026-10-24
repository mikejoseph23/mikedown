/**
 * The document model (edge case 9): one in-memory record per file path per
 * window, shared by every pane that shows it. M2 shipped the data record for
 * a lone-file window; M4 adds the registry, pane binding and the save/reload
 * methods.
 *
 * - `attach(handle)` binds a pane's core editor to the document: the editor
 *   is loaded with the text, and from then on an edit in that editor becomes
 *   the document's text and is pushed to every other attached editor with
 *   `setMarkdown(text, { pristine: false })`. The push itself fires those
 *   editors' `change` events, which the model ignores while it is applying
 *   (no echo, no loop).
 * - `dirty` is `text !== savedText`, not the editor's own pristine flag: a
 *   dirty document loaded into a second pane must stay dirty even though
 *   that editor started from it as a clean baseline.
 * - `save`, `reload` and `markExternalChange` are the only methods that know
 *   about disk; they go through the `FsApi` the registry was created with.
 *
 * The pure helpers below (`classifyPath`, `planOpen`, `windowTitle`, …) take
 * plain records so they stay unit-testable without a registry.
 */
import type { MikeDownEditorHandle } from '@mikedown/core';
import type { FsApi } from './fsApi';

export type Encoding = 'utf8' | 'utf8-bom' | 'unknown';
export type Eol = 'lf' | 'crlf';

/** How a path opens: rich text, source-only text, the image viewer, or the OS. */
export type DocKind = 'markdown' | 'text' | 'image' | 'other';

/** Cloud placeholders (edge case 10): the read is still waiting on the download. */
export type DocState = 'ready' | 'loading' | 'downloading';

/** An info bar above the editor, optionally with one action (edge case 12). */
export interface DocNotice {
  text: string;
  action?: { label: string; run(): void };
}

export interface DocumentRecord {
  /** Absolute path, or null for an unsaved `Untitled` document. */
  path: string | null;
  /** Current text, `\n` line endings. */
  text: string;
  /** The text as last read from or written to disk; `dirty` compares against it. */
  savedText: string;
  dirty: boolean;
  eol: Eol;
  bom: boolean;
  encoding: Encoding;
  readOnly: boolean;
  /** Why the document is read-only, for the Save As prompt (edge case 10). */
  readOnlyReason: string | null;
  mtimeMs: number | null;
  kind: DocKind;
  state: DocState;
  notice: DocNotice | null;
  /** Set by `markExternalChange`: the file changed on disk under unsaved edits; saving asks Compare / Overwrite / Revert (M6). */
  externallyChanged: boolean;
  /** Rich text by default; text files and large files open in source mode. */
  sourceMode: boolean;
}

export type DocumentEvent = 'text' | 'dirty' | 'path' | 'state' | 'saved' | 'closed';

export interface DocumentModel extends DocumentRecord {
  /** Stable for the document's life; the backup and session key for Untitled documents. */
  readonly id: string;
  /** Bind a pane's editor; returns the detach function. */
  attach(handle: MikeDownEditorHandle): () => void;
  /** Editors currently showing this document. */
  attachedCount(): number;
  /** Replace the text from outside an editor (backup restore, restore of a version). Dirty follows from `savedText`. */
  replaceText(text: string): void;
  /** Write the text to `target` (default: the path). Resolves false when the write failed. */
  save(target?: string): Promise<boolean>;
  /** Re-read from disk; the text becomes the clean baseline in every pane. */
  reload(): Promise<void>;
  /** The file changed on disk behind the editor; records the new mtime for M6. */
  markExternalChange(mtimeMs?: number | null): void;
  /**
   * M6: the disk now holds exactly this buffer (another writer saved the same
   * text): it becomes the saved baseline, the tab turns clean, no write.
   */
  adoptDisk(mtimeMs: number): void;
  /** Ask the panes to re-apply `readOnly` and `sourceMode`. */
  applyMode(): void;
  /** A fresh read of the file (open over a pending document, reload): the text becomes the clean baseline in every pane. */
  loadRead(info: ReadInfo, plan: OpenPlan): void;
  on(event: DocumentEvent, fn: () => void): () => void;
}

export function createUntitled(): DocumentRecord {
  return {
    path: null,
    text: '',
    savedText: '',
    dirty: false,
    eol: 'lf',
    bom: false,
    encoding: 'utf8',
    readOnly: false,
    readOnlyReason: null,
    mtimeMs: null,
    kind: 'markdown',
    state: 'ready',
    notice: null,
    externallyChanged: false,
    sourceMode: false,
  };
}

const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdx', 'rmd']);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico', 'tif', 'tiff']);
const TEXT_EXTS = new Set([
  'txt', 'text', 'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
  'csv', 'tsv', 'log', 'xml', 'html', 'htm', 'css', 'scss', 'less', 'js', 'mjs', 'cjs', 'ts',
  'tsx', 'jsx', 'py', 'rb', 'rs', 'go', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs',
  'sh', 'zsh', 'bash', 'fish', 'ps1', 'bat', 'cmd', 'sql', 'graphql', 'gql', 'diff', 'patch',
  'gitignore', 'editorconfig', 'lock', 'properties', 'tex', 'bib', 'rst', 'adoc', 'org', 'nfo',
]);

/** Lower-case extension without the dot, '' when there is none. */
export function extensionOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) {return '';}
  return base.slice(dot + 1).toLowerCase();
}

/** Decision for "non-markdown files": text in source mode, images in a viewer, else OS default. */
export function classifyPath(path: string): DocKind {
  const ext = extensionOf(path);
  if (MARKDOWN_EXTS.has(ext)) {return 'markdown';}
  if (IMAGE_EXTS.has(ext)) {return 'image';}
  if (TEXT_EXTS.has(ext)) {return 'text';}
  // No extension (README, LICENSE, Makefile) is usually text.
  if (ext === '') {return 'text';}
  return 'other';
}

/** What `read_text` reports, shaped by `fsApi.ts`. */
export interface ReadInfo {
  text: string;
  encoding: Encoding;
  eol: Eol;
  mtimeMs: number;
  readOnly: boolean;
  size: number;
}

export interface OpenPlan {
  kind: DocKind;
  /** Show CodeMirror instead of rich text. Forced for text files and non-UTF-8 (edge case 11). */
  sourceMode: boolean;
  readOnly: boolean;
  readOnlyReason: string | null;
  /** An info-bar notice to show once the document is up. */
  notice: string | null;
  /** Edge case 12: the notice offers "Open as rich text anyway". */
  offerRichText: boolean;
}

/** 2 MB: above it the document opens in source mode (edge case 12). */
export const LARGE_FILE_BYTES = 2 * 1024 * 1024;
/** 20 MB: above it MikeDown refuses and offers the OS default app (edge case 12). */
export const HUGE_FILE_BYTES = 20 * 1024 * 1024;

/** How a file's size affects opening it (edge case 12). */
export function sizeClass(size: number): 'normal' | 'large' | 'huge' {
  if (size > HUGE_FILE_BYTES) {return 'huge';}
  if (size > LARGE_FILE_BYTES) {return 'large';}
  return 'normal';
}

/**
 * Decide how a text file opens. Pure so the matrix (markdown/text × utf8/unknown
 * × writable/read-only × size) is unit-testable.
 */
export function planOpen(path: string, info: Pick<ReadInfo, 'encoding' | 'readOnly' | 'size'>): OpenPlan {
  const kind = classifyPath(path);
  let sourceMode = kind === 'text';
  let readOnly = info.readOnly;
  let readOnlyReason: string | null = info.readOnly ? 'The file is read-only on disk.' : null;
  let notice: string | null = null;
  let offerRichText = false;
  if (info.encoding === 'unknown') {
    sourceMode = true;
    readOnly = true;
    readOnlyReason = 'The file is not UTF-8; MikeDown shows it read-only so the bytes are never rewritten. Use Save As to write a UTF-8 copy.';
    notice = 'This file is not UTF-8. It is shown read-only; Save As writes a UTF-8 copy.';
  } else if (sizeClass(info.size) === 'large' && kind === 'markdown') {
    sourceMode = true;
    notice = `Large file (${formatSize(info.size)}): opened in source mode.`;
    offerRichText = true;
  }
  return { kind, sourceMode, readOnly, readOnlyReason, notice, offerRichText };
}

/**
 * Cross-window edits (edge case 6): on window focus, any open file whose
 * mtime moved since this window last read or wrote it is marked as changed
 * externally (M6 builds the UI). Files already marked, or gone, are skipped.
 */
export async function checkExternalChanges(
  docs: DocumentModel[],
  stat: (path: string) => Promise<{ exists: boolean; mtimeMs: number }>,
): Promise<DocumentModel[]> {
  const changed: DocumentModel[] = [];
  for (const doc of docs) {
    if (!doc.path || doc.kind === 'image' || doc.state !== 'ready' || doc.externallyChanged || doc.mtimeMs === null) {continue;}
    let st;
    try { st = await stat(doc.path); } catch { continue; }
    if (!st.exists || st.mtimeMs === doc.mtimeMs) {continue;}
    doc.markExternalChange(st.mtimeMs);
    changed.push(doc);
  }
  return changed;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;}
  if (bytes >= 1024) {return `${Math.round(bytes / 1024)} KB`;}
  return `${bytes} B`;
}

/** Apply a successful read to a record (new path or reload). */
export function applyRead(model: DocumentRecord, path: string, info: ReadInfo, plan: OpenPlan): DocumentRecord {
  model.path = path;
  model.text = info.text;
  model.savedText = info.text;
  model.dirty = false;
  model.eol = info.eol;
  model.bom = info.encoding === 'utf8-bom';
  model.encoding = info.encoding;
  model.readOnly = plan.readOnly;
  model.readOnlyReason = plan.readOnlyReason;
  model.mtimeMs = info.mtimeMs;
  model.kind = plan.kind;
  model.state = 'ready';
  model.sourceMode = plan.sourceMode;
  model.externallyChanged = false;
  return model;
}

/** Options `write_text` needs so the bytes match what was read (edge case 11). */
export function writeOptionsFor(model: Pick<DocumentRecord, 'eol' | 'bom'>): { eol: Eol; bom: boolean } {
  return { eol: model.eol, bom: model.bom };
}

export function fileName(model: Pick<DocumentRecord, 'path'>): string {
  if (!model.path) {return 'Untitled';}
  return model.path.split(/[\\/]/).pop() || model.path;
}

export function dirName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (cut <= 0) {return cut === 0 ? '/' : '';}
  return path.slice(0, cut);
}

/** Last path segment of the containing folder; '' when the file sits at a root. */
export function folderName(path: string): string {
  const dir = dirName(path);
  return dir.split(/[\\/]/).filter(Boolean).pop() ?? '';
}

/**
 * Window title (edge case 29): `filename — foldername`, `Untitled` for a new
 * document. macOS shows dirty state with the close-button dot
 * (`setDocumentEdited`), other platforms get a leading bullet.
 */
export function windowTitle(model: Pick<DocumentRecord, 'path' | 'dirty'>, platform: 'mac' | 'other'): string {
  let title = fileName(model);
  if (model.path) {
    const folder = folderName(model.path);
    if (folder) {title = `${title} — ${folder}`;}
  }
  if (model.dirty && platform !== 'mac') {title = `• ${title}`;}
  return title;
}

// ── Registry ────────────────────────────────────────────────────────────────

export interface DocumentRegistry {
  /** Every open document, in creation order. */
  all(): DocumentModel[];
  get(path: string): DocumentModel | undefined;
  byId(id: string): DocumentModel | undefined;
  /** Create (or reuse) the document for a path from a successful read. */
  open(path: string, info: ReadInfo, plan: OpenPlan): DocumentModel;
  /** A document for a path whose read is still pending (cloud placeholder). */
  pending(path: string): DocumentModel;
  /** An image: no text, shown in the viewer. */
  image(path: string): DocumentModel;
  /** A new unsaved document. `id` restores a known identity (backups). */
  untitled(opts?: { id?: string; text?: string }): DocumentModel;
  /** The document moved on disk (tree rename or Save As): re-key it. */
  rename(doc: DocumentModel, path: string | null): void;
  /** Forget a document no pane shows any more. */
  close(doc: DocumentModel): void;
  /** Any document changed (text, dirty, path, state). */
  onChange(fn: (doc: DocumentModel, event: DocumentEvent) => void): () => void;
}

export interface RegistryDeps {
  fs: Pick<FsApi, 'readText' | 'writeText'>;
  /** Called when a save succeeded, with the new path (backups, versioning) and what the write reported. */
  onSaved?(doc: DocumentModel, write: { mtimeMs: number; size: number }): void;
}

let nextUntitled = 1;

/** Keys for the registry map: paths are compared as given (the host normalises them). */
function keyFor(path: string): string {
  return path;
}

export function createDocumentRegistry(deps: RegistryDeps): DocumentRegistry {
  const byPath = new Map<string, DocumentModel>();
  const docs: DocumentModel[] = [];
  const listeners = new Set<(doc: DocumentModel, event: DocumentEvent) => void>();

  function broadcast(doc: DocumentModel, event: DocumentEvent): void {
    for (const fn of listeners) {
      try { fn(doc, event); } catch (err) { console.error('MikeDown: document listener failed', err); }
    }
  }

  function create(id: string, record: DocumentRecord): DocumentModel {
    const handles = new Set<MikeDownEditorHandle>();
    const own = new Map<DocumentEvent, Set<() => void>>();
    let applying = false;

    const doc = record as DocumentModel;

    function emit(event: DocumentEvent): void {
      own.get(event)?.forEach((fn) => { try { fn(); } catch (err) { console.error('MikeDown: document listener failed', err); } });
      broadcast(doc, event);
    }

    function setDirty(): void {
      const dirty = doc.text !== doc.savedText;
      if (dirty !== doc.dirty) {
        doc.dirty = dirty;
        emit('dirty');
      }
    }

    /** Push `text` into every attached editor except `from`, without echo. */
    function push(from: MikeDownEditorHandle | null, pristine: boolean): void {
      applying = true;
      try {
        for (const h of handles) {
          if (h === from) {continue;}
          h.setMarkdown(doc.text, { pristine });
        }
      } finally {
        applying = false;
      }
    }

    function edited(markdown: string, from: MikeDownEditorHandle): void {
      if (applying) {return;}
      if (markdown === doc.text) {return;}
      doc.text = markdown;
      push(from, false);
      setDirty();
      emit('text');
    }

    Object.defineProperty(doc, 'id', { value: id, enumerable: true });
    doc.attach = (handle) => {
      handles.add(handle);
      applying = true;
      try {
        handle.setMarkdown(doc.text, { pristine: true });
        if (doc.dirty) {
          // Keep the editor's own baseline at the saved text so an undo back
          // to it reports pristine with the right content.
          handle.markSaved(doc.savedText);
        }
        handle.setReadOnly(doc.readOnly);
      } finally {
        applying = false;
      }
      const off = handle.on('change', (markdown: string) => edited(markdown, handle));
      return () => {
        off();
        handles.delete(handle);
      };
    };
    doc.attachedCount = () => handles.size;
    doc.replaceText = (text) => {
      if (text === doc.text) {return;}
      doc.text = text;
      push(null, false);
      setDirty();
      emit('text');
    };
    doc.save = async (target) => {
      const dest = target ?? doc.path;
      if (!dest) {return false;}
      const text = doc.text;
      const res = await deps.fs.writeText(dest, text, writeOptionsFor(doc));
      if (dest !== doc.path) {registry.rename(doc, dest);}
      doc.savedText = text;
      doc.mtimeMs = res.mtimeMs;
      doc.externallyChanged = false;
      if (doc.encoding === 'unknown') {doc.encoding = doc.bom ? 'utf8-bom' : 'utf8';}
      let modeChanged = false;
      if (doc.readOnly) {
        doc.readOnly = false;
        doc.readOnlyReason = null;
        doc.notice = null;
        modeChanged = true;
        for (const h of handles) {h.setReadOnly(false);}
      }
      for (const h of handles) {h.markSaved(text);}
      setDirty();
      if (modeChanged) {emit('state');}
      emit('saved');
      deps.onSaved?.(doc, res);
      return true;
    };
    doc.loadRead = (info, plan) => {
      if (!doc.path) {return;}
      applyRead(doc, doc.path, info, plan);
      doc.notice = plan.notice ? { text: plan.notice } : null;
      push(null, true);
      for (const h of handles) {h.setReadOnly(doc.readOnly);}
      emit('text');
      emit('dirty');
      emit('state');
    };
    doc.reload = async () => {
      if (!doc.path) {return;}
      const info = await deps.fs.readText(doc.path);
      doc.loadRead(info, planOpen(doc.path, info));
    };
    doc.markExternalChange = (mtimeMs) => {
      doc.externallyChanged = true;
      if (mtimeMs !== undefined) {doc.mtimeMs = mtimeMs;}
      emit('state');
    };
    doc.adoptDisk = (mtimeMs) => {
      doc.savedText = doc.text;
      doc.mtimeMs = mtimeMs;
      doc.externallyChanged = false;
      for (const h of handles) {h.markSaved(doc.text);}
      setDirty();
      emit('state');
    };
    doc.applyMode = () => {
      for (const h of handles) {h.setReadOnly(doc.readOnly);}
      emit('state');
    };
    doc.on = (event, fn) => {
      let set = own.get(event);
      if (!set) {
        set = new Set();
        own.set(event, set);
      }
      set.add(fn);
      return () => { set?.delete(fn); };
    };
    docs.push(doc);
    return doc;
  }

  const registry: DocumentRegistry = {
    all: () => [...docs],
    get: (path) => byPath.get(keyFor(path)),
    byId: (id) => docs.find((d) => d.id === id),
    open(path, info, plan) {
      let doc = byPath.get(keyFor(path));
      if (!doc) {
        doc = create(`file:${path}`, { ...createUntitled(), path });
        byPath.set(keyFor(path), doc);
      }
      doc.loadRead(info, plan);
      return doc;
    },
    pending(path) {
      let doc = byPath.get(keyFor(path));
      if (doc) {return doc;}
      doc = create(`file:${path}`, { ...createUntitled(), path, kind: classifyPath(path), state: 'loading', readOnly: true });
      byPath.set(keyFor(path), doc);
      return doc;
    },
    image(path) {
      let doc = byPath.get(keyFor(path));
      if (doc) {return doc;}
      doc = create(`file:${path}`, { ...createUntitled(), path, kind: 'image', readOnly: true, readOnlyReason: 'Image' });
      byPath.set(keyFor(path), doc);
      return doc;
    },
    untitled(opts) {
      const id = opts?.id ?? `untitled:${Date.now().toString(36)}-${nextUntitled++}`;
      const doc = create(id, createUntitled());
      if (opts?.text) {
        doc.text = opts.text;
        doc.dirty = true;
      }
      return doc;
    },
    rename(doc, path) {
      if (doc.path) {byPath.delete(keyFor(doc.path));}
      if (path) {
        const other = byPath.get(keyFor(path));
        if (other && other !== doc) {byPath.delete(keyFor(path));}
        byPath.set(keyFor(path), doc);
      }
      doc.path = path;
      if (path) {doc.kind = classifyPath(path);}
      broadcast(doc, 'path');
    },
    close(doc) {
      const i = docs.indexOf(doc);
      if (i >= 0) {docs.splice(i, 1);}
      if (doc.path && byPath.get(keyFor(doc.path)) === doc) {byPath.delete(keyFor(doc.path));}
      broadcast(doc, 'closed');
    },
    onChange(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
  return registry;
}
