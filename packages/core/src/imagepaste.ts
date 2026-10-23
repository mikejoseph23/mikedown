import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

import type { ImageInsertResult, ImageUploadRequest } from './host';

/** Stores image bytes and returns where the image now lives (`host.uploadImage`). */
export type ImageUploader = (file: ImageUploadRequest) => Promise<ImageInsertResult>;

export interface ImagePasteOptions {
  /** Absent turns image paste and drop off: the events fall through to other handlers. */
  upload: ImageUploader | null;
}

/**
 * Walk the FileList in a `DataTransfer` / `ClipboardData` and return only the
 * entries whose MIME type starts with `image/`.
 */
function extractImageFiles(transfer: DataTransfer | null): File[] {
  if (!transfer) {return [];}

  // `transfer.files` and `transfer.items` overlap in most environments —
  // walking both double-counts because DataTransferItem.getAsFile() returns a
  // fresh File reference each call (defeating reference-based dedupe).
  // Prefer `files` when present and only fall back to `items` if it's empty.
  const out: File[] = [];
  if (transfer.files && transfer.files.length > 0) {
    for (let i = 0; i < transfer.files.length; i++) {
      const f = transfer.files.item(i);
      if (f && f.type.startsWith('image/')) {out.push(f);}
    }
    return out;
  }
  if (transfer.items) {
    for (let i = 0; i < transfer.items.length; i++) {
      const item = transfer.items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) {out.push(f);}
      }
    }
  }
  return out;
}

async function uploadAndInsert(view: EditorView, pos: number, file: File, upload: ImageUploader): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let result: ImageInsertResult;
  try {
    result = await upload({ mime: file.type, bytes, name: file.name || undefined });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? '');
    if (message && !/document not saved|imagePaste\.enabled is false/.test(message)) {
      console.warn('MikeDown: image paste failed —', message);
    }
    return;
  }
  insertImageAt(view, pos, result);
}

/** Insert an uploaded image at `pos` (clamped to the document). */
export function insertImageAt(view: EditorView, pos: number, result: ImageInsertResult): void {
  const alt = result.alt ?? '';
  // Insert with the display src so the image renders inline. A host that
  // serves images from a different URL than it writes into the markdown
  // (VS Code webview URIs) maps it back when it receives the document.
  const displaySrc = result.src ?? '';

  const schema = view.state.schema;
  const imageType = schema.nodes.image;
  if (!imageType) {
    const text = `![${alt}](${displaySrc})`;
    const tr = view.state.tr.insertText(text, pos);
    view.dispatch(tr.scrollIntoView());
    return;
  }

  const safePos = Math.min(Math.max(pos, 0), view.state.doc.content.size);
  const node = imageType.create({ src: displaySrc, alt });
  const tr = view.state.tr.insert(safePos, node);
  view.dispatch(tr.scrollIntoView());
}

export const ImagePasteExtension = Extension.create<ImagePasteOptions>({
  name: 'imagePaste',
  // Higher priority so this runs before SmartPaste when the clipboard has both
  // image bytes and an HTML representation (some screenshot apps include both).
  priority: 200,

  addOptions() {
    return { upload: null };
  },

  addProseMirrorPlugins() {
    const upload = this.options.upload;
    if (!upload) {return [];}
    return [
      new Plugin({
        key: new PluginKey('imagePaste'),
        props: {
          handlePaste(view, event) {
            const files = extractImageFiles(event.clipboardData);
            if (files.length === 0) {return false;}
            event.preventDefault();
            const insertPos = view.state.selection.from;
            // Run uploads in parallel; each insert is a separate transaction.
            for (const file of files) {
              uploadAndInsert(view, insertPos, file, upload).catch((err) => {
                console.warn('MikeDown: image paste read failed —', err);
              });
            }
            return true;
          },
          handleDrop(view, event, _slice, moved) {
            if (moved) {return false;} // internal node drag — let PM handle it
            const dt = event.dataTransfer;
            const files = extractImageFiles(dt);
            if (files.length === 0) {return false;}
            event.preventDefault();
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
            const dropPos = coords?.pos ?? view.state.selection.from;
            for (const file of files) {
              uploadAndInsert(view, dropPos, file, upload).catch((err) => {
                console.warn('MikeDown: image drop read failed —', err);
              });
            }
            return true;
          },
        },
      }),
    ];
  },
});
