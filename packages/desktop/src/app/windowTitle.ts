/**
 * Window title (M8, edge case 29):
 *
 * - `filename — foldername` for a document in a window with an open folder;
 *   a lone file shows just its filename (never the app-data or parent folder);
 * - `Untitled — foldername` for an unsaved document in a folder window,
 *   plain `Untitled` without one;
 * - `foldername` for a folder window with no tab open;
 * - `MikeDown` for the welcome screen.
 *
 * macOS shows unsaved changes with the close-button dot
 * (`setDocumentEdited`) and the file with the proxy icon
 * (`setRepresentedFile`); other platforms get a leading bullet.
 */
import { fileName } from '../documents/documentModel';

export const APP_TITLE = 'MikeDown';

function lastSegment(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function formatWindowTitle(opts: {
  doc: { path: string | null; dirty: boolean } | null;
  /** The window's open folder, if any. */
  folder: string | null;
  platform: 'mac' | 'other';
}): string {
  const { doc, folder, platform } = opts;
  if (!doc) {return folder ? lastSegment(folder) : APP_TITLE;}
  const where = folder ? lastSegment(folder) : '';
  let title = where ? `${fileName(doc)} — ${where}` : fileName(doc);
  if (doc.dirty && platform !== 'mac') {title = `• ${title}`;}
  return title;
}
