/**
 * The document model (edge case 9): one in-memory record per file path per
 * window. M2 ships the minimum a lone-file window needs; M4 adds the
 * per-path registry, pane binding, backups and hot exit.
 *
 * Pure: this module never touches disk or the editor. `fsApi.ts` fills it,
 * `app/documentController.ts` drives it.
 */

export type Encoding = 'utf8' | 'utf8-bom' | 'unknown';
export type Eol = 'lf' | 'crlf';

/** How a path opens: rich text, source-only text, the image viewer, or the OS. */
export type DocKind = 'markdown' | 'text' | 'image' | 'other';

export interface DocumentModel {
  /** Absolute path, or null for an unsaved `Untitled` document. */
  path: string | null;
  /** Current text, `\n` line endings. */
  text: string;
  dirty: boolean;
  eol: Eol;
  bom: boolean;
  encoding: Encoding;
  readOnly: boolean;
  /** Why the document is read-only, for the Save As prompt (edge case 10). */
  readOnlyReason: string | null;
  mtimeMs: number | null;
  kind: DocKind;
}

export function createUntitled(): DocumentModel {
  return {
    path: null,
    text: '',
    dirty: false,
    eol: 'lf',
    bom: false,
    encoding: 'utf8',
    readOnly: false,
    readOnlyReason: null,
    mtimeMs: null,
    kind: 'markdown',
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
}

/** 2 MB: above it the document opens in source mode (edge case 12). */
export const LARGE_FILE_BYTES = 2 * 1024 * 1024;

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
  if (info.encoding === 'unknown') {
    sourceMode = true;
    readOnly = true;
    readOnlyReason = 'The file is not UTF-8; MikeDown shows it read-only so the bytes are never rewritten. Use Save As to write a UTF-8 copy.';
    notice = 'This file is not UTF-8. It is shown read-only; Save As writes a UTF-8 copy.';
  } else if (info.size > LARGE_FILE_BYTES && kind === 'markdown') {
    sourceMode = true;
    notice = 'Large file: opened in source mode.';
  }
  return { kind, sourceMode, readOnly, readOnlyReason, notice };
}

/** Apply a successful read to a model (new path or reload). */
export function applyRead(model: DocumentModel, path: string, info: ReadInfo, plan: OpenPlan): DocumentModel {
  model.path = path;
  model.text = info.text;
  model.dirty = false;
  model.eol = info.eol;
  model.bom = info.encoding === 'utf8-bom';
  model.encoding = info.encoding;
  model.readOnly = plan.readOnly;
  model.readOnlyReason = plan.readOnlyReason;
  model.mtimeMs = info.mtimeMs;
  model.kind = plan.kind;
  return model;
}

/** Options `write_text` needs so the bytes match what was read (edge case 11). */
export function writeOptionsFor(model: Pick<DocumentModel, 'eol' | 'bom'>): { eol: Eol; bom: boolean } {
  return { eol: model.eol, bom: model.bom };
}

export function fileName(model: Pick<DocumentModel, 'path'>): string {
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
export function windowTitle(model: Pick<DocumentModel, 'path' | 'dirty'>, platform: 'mac' | 'other'): string {
  let title = fileName(model);
  if (model.path) {
    const folder = folderName(model.path);
    if (folder) {title = `${title} — ${folder}`;}
  }
  if (model.dirty && platform !== 'mac') {title = `• ${title}`;}
  return title;
}
