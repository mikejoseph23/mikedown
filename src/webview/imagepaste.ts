import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

// VS Code only allows ONE call to acquireVsCodeApi() per webview, and
// editor-main.ts already owns it. The host module sets the postMessage
// reference at startup; we never call acquireVsCodeApi() ourselves.
let postMessageImpl: ((msg: unknown) => void) | null = null;
export function setPostMessage(fn: (msg: unknown) => void): void {
  postMessageImpl = fn;
}
function postMessage(msg: unknown): void {
  if (!postMessageImpl) {
    throw new Error('imagepaste: setPostMessage was never called');
  }
  postMessageImpl(msg);
}

interface PendingRequest {
  view: EditorView;
  /** Position in the document where the image should be inserted. */
  pos: number;
}

const pending = new Map<string, PendingRequest>();

function nextRequestId(): string {
  return `imgpaste-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Walk the FileList in a `DataTransfer` / `ClipboardData` and return only the
 * entries whose MIME type starts with `image/`.
 */
function extractImageFiles(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];

  // `transfer.files` and `transfer.items` overlap in most environments —
  // walking both double-counts because DataTransferItem.getAsFile() returns a
  // fresh File reference each call (defeating reference-based dedupe).
  // Prefer `files` when present and only fall back to `items` if it's empty.
  const out: File[] = [];
  if (transfer.files && transfer.files.length > 0) {
    for (let i = 0; i < transfer.files.length; i++) {
      const f = transfer.files.item(i);
      if (f && f.type.startsWith('image/')) out.push(f);
    }
    return out;
  }
  if (transfer.items) {
    for (let i = 0; i < transfer.items.length; i++) {
      const item = transfer.items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  return out;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  // chunked to avoid blowing the call stack on large images via apply()
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize) as unknown as number[];
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

async function uploadAndInsert(view: EditorView, pos: number, file: File): Promise<void> {
  const buf = await file.arrayBuffer();
  const dataBase64 = arrayBufferToBase64(buf);
  const requestId = nextRequestId();
  pending.set(requestId, { view, pos });
  postMessage({
    type: 'savePastedImage',
    requestId,
    mime: file.type,
    dataBase64,
  });
}

interface PastedImageResult {
  requestId: string;
  success?: boolean;
  insertPath?: string;
  webviewUri?: string;
  alt?: string;
  reused?: boolean;
  error?: string;
}

/**
 * Called by the global webview message dispatcher in editor-main.ts when the
 * extension host replies with the resolved insert path.
 */
export function handlePastedImageResult(message: PastedImageResult): void {
  const req = pending.get(message.requestId);
  if (!req) return;
  pending.delete(message.requestId);

  if (!message.success) {
    if (message.error && !/document not saved|imagePaste\.enabled is false/.test(message.error)) {
      console.warn('MikeDown: image paste failed —', message.error);
    }
    return;
  }

  const { view, pos } = req;
  const alt = message.alt ?? '';
  // Insert with the webview-display URI so the image renders inline. The host
  // converts these URIs back to the relative `insertPath` form before writing
  // to disk (see `unresolveImageUris` in markdownEditorProvider.ts), so the
  // markdown source stays clean on round-trip.
  const displaySrc = message.webviewUri ?? message.insertPath ?? '';

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

export const ImagePasteExtension = Extension.create({
  name: 'imagePaste',
  // Higher priority so this runs before SmartPaste when the clipboard has both
  // image bytes and an HTML representation (some screenshot apps include both).
  priority: 200,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('imagePaste'),
        props: {
          handlePaste(view, event) {
            const files = extractImageFiles(event.clipboardData);
            if (files.length === 0) return false;
            event.preventDefault();
            const insertPos = view.state.selection.from;
            // Run uploads in parallel; each insert is a separate transaction.
            for (const file of files) {
              uploadAndInsert(view, insertPos, file).catch((err) => {
                console.warn('MikeDown: image paste read failed —', err);
              });
            }
            return true;
          },
          handleDrop(view, event, _slice, moved) {
            if (moved) return false; // internal node drag — let PM handle it
            const dt = event.dataTransfer;
            const files = extractImageFiles(dt);
            if (files.length === 0) return false;
            event.preventDefault();
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
            const dropPos = coords?.pos ?? view.state.selection.from;
            for (const file of files) {
              uploadAndInsert(view, dropPos, file).catch((err) => {
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
