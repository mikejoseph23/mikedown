import type { EditorView } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';

// VS Code only allows ONE call to acquireVsCodeApi() per webview, and
// editor-main.ts already owns it. Same pattern as imagepaste.ts: the host
// module sets the postMessage reference at startup.
let postMessageImpl: ((msg: unknown) => void) | null = null;
export function setPostMessage(fn: (msg: unknown) => void): void {
  postMessageImpl = fn;
}
function postMessage(msg: unknown): void {
  if (!postMessageImpl) {
    throw new Error('imagepick: setPostMessage was never called');
  }
  postMessageImpl(msg);
}

interface PendingPick {
  view: EditorView;
  /** The `/query` range to replace on success, or leave untouched on cancel/error. */
  from: number;
  to: number;
}

const pending = new Map<string, PendingPick>();

function nextRequestId(): string {
  return `imgpick-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * `/image` slash command: ask the host to show its native file picker for
 * the current document, keyed by `requestId`. `/query` (at `[from, to)`)
 * stays in the doc until `handlePickedImageResult` replaces it — cancelling
 * or erroring leaves it exactly as typed.
 */
export function requestImagePick(view: EditorView, from: number, to: number): void {
  const requestId = nextRequestId();
  pending.set(requestId, { view, from, to });
  postMessage({ type: 'pickImage', requestId });
}

interface PickedImageResult {
  requestId: string;
  insertPath?: string;
  webviewUri?: string;
  alt?: string;
  cancelled?: boolean;
  error?: string;
}

/**
 * Called by the global webview message dispatcher in editor-main.ts when the
 * extension host replies to a `pickImage` request.
 */
export function handlePickedImageResult(message: PickedImageResult): void {
  const req = pending.get(message.requestId);
  if (!req) {return;}
  pending.delete(message.requestId);

  if (message.cancelled || message.error) {
    if (message.error) {
      console.warn('MikeDown: image pick failed —', message.error);
    }
    return; // /query left intact
  }

  const { view, from, to } = req;
  const alt = message.alt ?? '';
  // Same webviewUri-first preference as pasted images (see imagepaste.ts):
  // the host resolves it back to insertPath on serialize.
  const displaySrc = message.webviewUri ?? message.insertPath ?? '';

  const schema = view.state.schema;
  const imageType = schema.nodes.image;
  const tr = closeHistory(view.state.tr).delete(from, to);
  if (!imageType) {
    tr.insertText(`![${alt}](${displaySrc})`, from);
  } else {
    const node = imageType.create({ src: displaySrc, alt });
    tr.insert(from, node);
  }
  view.dispatch(tr.scrollIntoView());
}
