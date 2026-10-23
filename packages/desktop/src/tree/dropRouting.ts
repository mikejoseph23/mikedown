/**
 * Drag-and-drop decisions (edge case 20), pure so the table is unit-tested.
 *
 * Onto the tree: a drag that started in the tree moves, a drop from outside
 * the app (Finder, Explorer) copies; Option/Alt inverts either. Onto the
 * editor: an image goes through the image pipeline, a markdown file becomes a
 * relative link at the cursor, any other text file opens, anything else gets
 * a toast.
 */
import type { PathOps } from '@mikedown/core/shared/imagePaste';
import { classifyPath } from '../documents/documentModel';
import { isInside } from './treeLogic';

export type TreeDropOperation = 'move' | 'copy';

export function treeDropOperation(source: 'tree' | 'external', alt: boolean): TreeDropOperation {
  const base: TreeDropOperation = source === 'tree' ? 'move' : 'copy';
  if (!alt) {return base;}
  return base === 'move' ? 'copy' : 'move';
}

export interface DropRow {
  path: string;
  isDir: boolean;
}

/** The folder a tree drop lands in: the folder row itself, a file row's folder, or the root. */
export function dropTargetDir(row: DropRow | null, root: string, path: PathOps): string {
  if (!row) {return root;}
  return row.isDir ? row.path : path.dirname(row.path);
}

/**
 * Why `source` cannot be moved or copied into `targetDir`, or null when it
 * can. Moving into the folder it is already in is a no-op ('same').
 */
export function dropRefusal(source: string, targetDir: string, op: TreeDropOperation, path: PathOps): 'self' | 'same' | null {
  if (isInside(source, targetDir, path)) {return 'self';}
  if (op === 'move' && path.relative(path.dirname(source), targetDir) === '') {return 'same';}
  return null;
}

export type EditorDropAction =
  | { kind: 'image'; path: string }
  | { kind: 'link'; path: string }
  | { kind: 'open'; path: string }
  | { kind: 'unsupported'; path: string };

/** What a file dropped onto the editor does. Folders are unsupported. */
export function routeEditorDrop(entry: DropRow): EditorDropAction {
  if (entry.isDir) {return { kind: 'unsupported', path: entry.path };}
  switch (classifyPath(entry.path)) {
    case 'image':
      return { kind: 'image', path: entry.path };
    case 'markdown':
      return { kind: 'link', path: entry.path };
    case 'text':
      return { kind: 'open', path: entry.path };
    default:
      return { kind: 'unsupported', path: entry.path };
  }
}

/**
 * A link from the document at `fromDoc` to `target`: forward slashes, each
 * segment percent-encoded, `./` in front of a same-folder or deeper path (as
 * the VS Code extension writes them).
 */
export function relativeLinkHref(fromDoc: string, target: string, path: PathOps): string {
  const rel = path.relative(path.dirname(fromDoc), target).replace(/\\/g, '/');
  const encoded = rel.split('/').map((seg) => (seg === '..' || seg === '.' ? seg : encodeURIComponent(seg))).join('/');
  return encoded.startsWith('.') ? encoded : `./${encoded}`;
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  ico: 'image/x-icon',
};

/** MIME type for a dropped image file, from its extension ('' when unknown). */
export function imageMimeFor(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? IMAGE_MIME[base.slice(dot + 1).toLowerCase()] ?? '' : '';
}

/** Link text for a dropped markdown file: its name without the extension. */
export function linkLabel(target: string, path: PathOps): string {
  return path.basename(target).replace(/\.(md|markdown|mdown|mkd|mkdn|mdx|rmd)$/i, '');
}
