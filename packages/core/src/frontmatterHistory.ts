/**
 * Undoable frontmatter edits. The frontmatter YAML lives outside the
 * ProseMirror document (`frontmatterContent` in editor.ts), so PM's history
 * cannot reach it on its own. This extension gives the `doc` node one
 * attribute that records each tracked edit as `{ seq, prev, next }`; setting
 * it is a real step (`DocAttrStep`), so the edit is one undo step, redo
 * works, and a `/query` removal can share the same transaction.
 *
 * The attribute is a log entry, not the source of truth: edits made outside
 * this path (loads, typing in the YAML block) do not touch it. After any
 * transaction that moves the record, `frontmatterAfterTransition` says what
 * the YAML must become: forward (a new edit, or redo) is the record's
 * `next`; backward (undo) is the undone record's `prev`.
 */

import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';

export const FRONTMATTER_DOC_ATTR = 'mikedownFrontmatter';

export interface FrontmatterEditRecord {
  /** Increases with every edit, so undo and redo can be told apart. */
  seq: number;
  /** The YAML before the edit (null: no frontmatter block). */
  prev: string | null;
  /** The YAML after it. */
  next: string | null;
}

export const FrontmatterHistory = Extension.create({
  name: 'frontmatterHistory',
  addGlobalAttributes() {
    return [{
      types: ['doc'],
      attributes: { [FRONTMATTER_DOC_ATTR]: { default: null, rendered: false } },
    }];
  },
});

let lastSeq = 0;

/**
 * A transaction that records a frontmatter change from `prev` to `next` as
 * its own undo step, deleting `remove` (a `/query`) in the same step.
 */
export function frontmatterEditTransaction(
  state: EditorState,
  prev: string | null,
  next: string | null,
  remove?: { from: number; to: number } | null,
): Transaction {
  const tr = closeHistory(state.tr);
  if (remove && remove.to > remove.from) {tr.delete(remove.from, remove.to);}
  const record: FrontmatterEditRecord = { seq: ++lastSeq, prev, next };
  tr.setDocAttribute(FRONTMATTER_DOC_ATTR, record);
  return tr;
}

function recordOf(doc: PmNode): FrontmatterEditRecord | null {
  const r = doc.attrs[FRONTMATTER_DOC_ATTR] as FrontmatterEditRecord | null | undefined;
  return r && typeof r.seq === 'number' ? r : null;
}

/**
 * The YAML a transaction from `before` to `after` leaves, or undefined when
 * it did not move the frontmatter record.
 */
export function frontmatterAfterTransition(before: PmNode, after: PmNode): string | null | undefined {
  const a = recordOf(before);
  const b = recordOf(after);
  if (a === b || (a && b && a.seq === b.seq)) {return undefined;}
  if (b && (!a || b.seq > a.seq)) {return b.next;}
  return a ? a.prev : undefined;
}
