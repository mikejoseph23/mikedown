import type { EditorView } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';

import type { ImageInsertResult } from './host';

/** Opens a file picker; resolves null when cancelled (`host.pickImage`). */
export type ImagePicker = () => Promise<ImageInsertResult | null>;

/**
 * `/image` slash command: ask the host to show its file picker. `/query` (at
 * `[from, to)`) stays in the doc until the pick resolves — cancelling or
 * erroring leaves it exactly as typed.
 */
export function requestImagePick(view: EditorView, from: number, to: number, pick: ImagePicker): void {
  pick().then(
    (result) => {
      if (result) {insertPickedImage(view, from, to, result);}
    },
    (err: unknown) => {
      console.warn('MikeDown: image pick failed —', err instanceof Error ? err.message : err);
    },
  );
}

/** Replace `/query` at `[from, to)` with the picked image, as one undo step. */
function insertPickedImage(view: EditorView, from: number, to: number, result: ImageInsertResult): void {
  const alt = result.alt ?? '';
  const displaySrc = result.src ?? '';

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
