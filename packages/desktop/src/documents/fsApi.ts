/**
 * Typed wrapper over the Rust commands in `src-tauri/src/commands/`. This is
 * the only module that imports `invoke`; everything that touches disk, the
 * launch queue or native window state goes through it (plan worker rule:
 * Tauri commands are the only path to disk).
 */
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Eol, ReadInfo } from './documentModel';

export interface StatInfo {
  exists: boolean;
  isFile: boolean;
  isDir: boolean;
  mtimeMs: number;
  size: number;
  readOnly: boolean;
}

export interface WriteResult {
  mtimeMs: number;
  size: number;
}

export interface DirEntry {
  name: string;
  isDir: boolean;
}

export interface ListOptions {
  /** Include dotfolders, `node_modules` and OS clutter files. */
  showHidden: boolean;
}

export interface FsApi {
  readText(path: string): Promise<ReadInfo>;
  writeText(path: string, text: string, options: { eol: Eol; bom: boolean }): Promise<WriteResult>;
  stat(path: string): Promise<StatInfo>;
  exists(path: string): Promise<boolean>;
  /**
   * Folders first, natural order. Without `options` every name comes back
   * (the image pipeline's collision check); with it hidden entries are
   * filtered unless `showHidden` (the tree).
   */
  listDir(path: string, options?: ListOptions): Promise<DirEntry[]>;
  mkdir(path: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<WriteResult>;
  openInDefaultApp(path: string): Promise<void>;
  /** Let `assetUrl` serve a file that was not read through `readText`. */
  allowAsset(path: string): Promise<void>;
  /** `asset://` URL for an absolute path (needs the asset-protocol scope). */
  assetUrl(path: string): string;
}

export const fsApi: FsApi = {
  readText: (path) => invoke<ReadInfo>('read_text', { path }),
  writeText: (path, text, options) => invoke<WriteResult>('write_text', { path, text, options }),
  stat: (path) => invoke<StatInfo>('stat', { path }),
  exists: (path) => invoke<boolean>('exists', { path }),
  listDir: (path, options) => invoke<DirEntry[]>('list_dir', options ? { path, options } : { path }),
  mkdir: (path) => invoke<void>('mkdir', { path }),
  readBytes: async (path) => new Uint8Array(await invoke<ArrayBuffer>('read_bytes', { path })),
  // Raw body: the bytes travel as the request payload, the path as a header,
  // so a 10 MB paste never becomes a 30 MB JSON array.
  writeBytes: (path, bytes) =>
    invoke<WriteResult>('write_bytes', bytes, { headers: { 'x-path': encodeURIComponent(path) } }),
  openInDefaultApp: (path) => invoke<void>('open_in_default_app', { path }),
  allowAsset: (path) => invoke<void>('allow_asset', { path }),
  assetUrl: (path) => convertFileSrc(path),
};

/** Folder-tree operations (M3). Every one validates names and refuses to overwrite. */
export interface TreeApi {
  /** Extend the fs + asset scopes to everything under an opened folder. */
  allowFolder(path: string): Promise<void>;
  /** Case-only renames go through a temp name (edge case 25). */
  rename(from: string, to: string): Promise<void>;
  createFile(path: string): Promise<void>;
  createDir(path: string): Promise<void>;
  /** Creates the destination's parent folders. */
  movePath(from: string, to: string): Promise<void>;
  copyPath(from: string, to: string): Promise<void>;
  /** OS Trash / Recycle Bin (edge case 21). */
  trash(path: string): Promise<void>;
  /** Absolute paths of the markdown files under `root` (skips `.mikedown/`). */
  listMarkdown(root: string, showHidden: boolean): Promise<string[]>;
  revealPath(path: string): Promise<void>;
  /** Modifier keys held right now (a drop from the OS carries none). */
  modifierState(): Promise<{ alt: boolean }>;
}

export const treeApi: TreeApi = {
  allowFolder: (path) => invoke<void>('allow_folder', { path }),
  rename: (from, to) => invoke<void>('rename', { from, to }),
  createFile: (path) => invoke<void>('create_file', { path }),
  createDir: (path) => invoke<void>('create_dir', { path }),
  movePath: (from, to) => invoke<void>('move_path', { from, to }),
  copyPath: (from, to) => invoke<void>('copy_path', { from, to }),
  trash: (path) => invoke<void>('trash', { path }),
  listMarkdown: (root, showHidden) => invoke<string[]>('list_markdown', { root, showHidden }),
  revealPath: (path) => invoke<void>('reveal_path', { path }),
  modifierState: () => invoke<{ alt: boolean }>('modifier_state'),
};

export interface FsChange {
  kind: 'create' | 'remove' | 'rename' | 'modify' | 'any';
  path: string;
  /** The watched directory the change belongs to. */
  dir: string;
}

/** Per-directory watcher (native, polling fallback every 2 s). */
export interface WatchApi {
  watch(dir: string): Promise<'native' | 'poll'>;
  unwatch(dir: string): Promise<void>;
  unwatchAll(): Promise<void>;
  onChange(handler: (change: FsChange) => void): Promise<UnlistenFn>;
}

export const watchApi: WatchApi = {
  watch: (dir) => invoke<'native' | 'poll'>('watch', { dir }),
  unwatch: (dir) => invoke<void>('unwatch', { dir }),
  unwatchAll: () => invoke<void>('unwatch_all'),
  onChange: (handler) => listen<FsChange>('fs-changed', (e) => handler(e.payload)),
};

export interface WindowApi {
  /** Dirty dot in the macOS close button; no-op elsewhere. */
  setDocumentEdited(edited: boolean): Promise<void>;
  /** macOS title-bar proxy icon; '' clears it; no-op elsewhere. */
  setRepresentedFile(path: string): Promise<void>;
}

export const windowApi: WindowApi = {
  setDocumentEdited: (edited) => invoke<void>('set_document_edited', { edited }),
  setRepresentedFile: (path) => invoke<void>('set_represented_file', { path }),
};

export interface LaunchApi {
  /** Tell Rust the page is up; returns files queued before that. */
  frontendReady(): Promise<string[]>;
  /** Files the OS asks the app to open after launch (macOS open-file, second launch). */
  onOpenFiles(handler: (paths: string[]) => void): Promise<UnlistenFn>;
}

export const launchApi: LaunchApi = {
  frontendReady: () => invoke<string[]>('frontend_ready'),
  onOpenFiles: (handler) => listen<string[]>('mikedown:open-files', (e) => handler(e.payload)),
};
