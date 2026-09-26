/**
 * M3/M4/M6: wires every registry `id` (quote/lists/callouts/divider,
 * code/mermaid, table, link/wikilink/emoji/image/properties/date/datetime)
 * to a real action. Headings and Paragraph are handled directly in
 * `slashcommands.ts` (M2).
 *
 * Three shapes of command, all deleting `/query` (and, mid-line, the
 * triggering space) via `slashcommands.ts`'s shared target-preparation logic:
 *
 *  - Wrap-shaped (quote, bullet/numbered/todo, callouts): `applySlashWrap`
 *    builds the wrap (`findWrapping` + `tr.wrap`) inside the SAME
 *    transaction as the deletion. This is required, not just tidy —
 *    empirically, a `ReplaceAroundStep`-based wrap dispatched as a second,
 *    separate transaction does NOT group with the preceding one under
 *    ProseMirror's history heuristic (`isAdjacentTo`), so a lone `Cmd+Z`
 *    would only undo the wrap and leave the deletion in place. `setBlockType`
 *    and insert-shaped changes (headings, `toggleCodeBlock`,
 *    `setHorizontalRule`, `insertTable`) do NOT have this problem — verified
 *    empirically — so those safely use `prepareSlashTarget` (one dispatch)
 *    followed by a normal `editor.chain()` call (a second dispatch that
 *    still ends up in the same undo event).
 *  - Inline (wikilink, date, datetime here; link/emoji/image below, since
 *    those hand off to a picker): replace `/query` directly at its own
 *    position — no block splitting, no preceding-space stripping (Trigger
 *    rules: "Inline commands ... insert inline at the cursor instead").
 *
 * Picker-based commands (code language, table, link, emoji, image) keep
 * `/query` in the doc until the picker/host round-trip actually commits;
 * cancelling or erroring leaves it intact. For code and table, the target is
 * prepared eagerly (needed to anchor the picker and, for code, to give the
 * language picker's `updateAttributes` something to target), so "cancel" is
 * implemented as one `editor.commands.undo()` of that single merged undo
 * event. Link, emoji, and image don't need eager preparation (they insert
 * inline at a fixed position once the picker/host resolves), so cancelling
 * them is simply "never touched the document."
 *
 * `/properties` is the odd one out: the frontmatter it inserts doesn't live
 * in the ProseMirror doc at all (see `insertEmptyFrontmatter` in
 * editor-main.ts), so ProseMirror's own undo can't restore it — `actionProperties`
 * below watches the editor's undo depth itself to detect a one-step undo and
 * revert the frontmatter side effect to match.
 */

import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';
import { closeHistory, undoDepth as pmUndoDepth } from '@tiptap/pm/history';
import { findWrapping } from '@tiptap/pm/transform';
import type { NodeType } from '@tiptap/pm/model';
import { createLowlight, all } from 'lowlight';
import {
  setSlashCommandHandler,
  markSlashDismissed,
  prepareSlashTarget,
  applySlashWrap,
  getSlashCommandsConfig,
} from './slashcommands';
import { MERMAID_STARTER_DIAGRAM } from './slashcommands-registry';
import { showLanguagePicker } from './languagepicker';
import { showTableGridPicker } from './tablepicker';
import { showEmojiPicker } from './emojipicker';
import { requestImagePick } from './imagepick';
import { formatSlashDate } from './slashcommands-date';

type Range = { from: number; to: number };

// Only used to list known highlight.js language names for the code-block
// language picker; a separate instance from editor-main.ts's (same
// registration set, so the same names) to avoid reaching into that module.
const codeLowlight = createLowlight(all);

/** Dependencies M3/M4/M6 need from `editor-main.ts` without importing it
 *  back (that module imports this one to call `initSlashCommandActions`). */
export interface SlashActionDeps {
  /** `showLinkDialog(editor)` from editor-main.ts, extended with an optional
   *  range: when given, the dialog removes `/query` only on Save/Update
   *  (never on Cancel/Escape/click-away), inline at that position. */
  showLinkDialog: (editor: Editor, range?: Range) => void;
  /** M6 `/properties`: inserts an empty frontmatter block (persisted + the
   *  WYSIWYG frontmatter block + sidebar re-rendered) and returns a
   *  `revert()` that undoes exactly that side effect. See the module doc
   *  comment and `actionProperties` for why this can't be plain PM undo. */
  insertEmptyFrontmatter: () => { revert: () => void };
  /** M6 `/properties`: shows the sidebar, un-collapses Properties, and
   *  focuses its "+ Add property" control. */
  focusPropertiesSection: () => void;
}

const CALLOUT_IDS = new Set(['note', 'tip', 'important', 'warning', 'caution']);

/** Registers the M3 action map as the slash-command external handler.
 *  Called once, right after the TipTap editor is constructed. */
export function initSlashCommandActions(editor: Editor, deps: SlashActionDeps): void {
  setSlashCommandHandler((id, range, view) => handleSlashAction(editor, deps, id, range, view));
}

function handleSlashAction(
  editor: Editor,
  deps: SlashActionDeps,
  id: string,
  range: Range,
  view: EditorView
): boolean {
  switch (id) {
    case 'quote':
      return wrapBlock(view, range, view.state.schema.nodes.blockquote);
    case 'bullet':
      return wrapBlock(view, range, view.state.schema.nodes.bulletList);
    case 'numbered':
      return wrapBlock(view, range, view.state.schema.nodes.orderedList);
    case 'todo':
      return wrapBlock(view, range, view.state.schema.nodes.taskList);
    case 'divider':
      return applyBlock(view, range, () => editor.chain().focus().setHorizontalRule().run());

    case 'note':
    case 'tip':
    case 'important':
    case 'warning':
    case 'caution':
      if (!CALLOUT_IDS.has(id)) {
        return false;
      }
      return wrapBlock(view, range, view.state.schema.nodes.callout, { kind: id });

    case 'code':
      return actionCode(editor, view, range);
    case 'mermaid':
      return actionMermaid(editor, view, range);
    case 'table':
      return actionTable(editor, view, range);

    case 'link':
      markSlashDismissed(range.from);
      deps.showLinkDialog(editor, range);
      return true;
    case 'wikilink':
      return actionWikilink(view, range);
    case 'emoji':
      return actionEmoji(editor, view, range);
    case 'image':
      markSlashDismissed(range.from);
      requestImagePick(view, range.from, range.to);
      return true;

    case 'properties':
      return actionProperties(editor, view, range, deps);
    case 'date':
      return actionDate(view, range, false);
    case 'datetime':
      return actionDate(view, range, true);

    default:
      return false;
  }
}

/** Runs `prepareSlashTarget` then a shaping `editor.chain()` command. Returns
 *  true once the target was prepared (the doc was mutated), regardless of
 *  the shaping command's own success — these built-in schema node types are
 *  always valid for a fresh empty paragraph, so failure here isn't expected. */
function applyBlock(view: EditorView, range: Range, shape: () => void): boolean {
  if (!prepareSlashTarget(view, range)) {
    return false;
  }
  shape();
  return true;
}

/** Wraps the (empty) target paragraph in `wrapperType` — blockquote, a
 *  bullet/numbered/task list, or a callout — inside the SAME transaction as
 *  the `/query` deletion (see the module doc comment for why this can't be a
 *  second `editor.chain()` dispatch). `findWrapping` computes any needed
 *  intermediate node (e.g. `listItem` for a list) automatically. */
function wrapBlock(
  view: EditorView,
  range: Range,
  wrapperType: NodeType | undefined,
  attrs?: Record<string, unknown>
): boolean {
  if (!wrapperType) {
    return false;
  }
  return applySlashWrap(view, range, (tr, pos) => {
    const $pos = tr.doc.resolve(pos);
    const blockRange = $pos.blockRange();
    if (!blockRange) {
      return false;
    }
    const wrapping = findWrapping(blockRange, wrapperType, attrs ?? null);
    if (!wrapping) {
      return false;
    }
    tr.wrap(blockRange, wrapping);
    return true;
  });
}

function coordsToRect(view: EditorView, pos: number): DOMRect {
  const c = view.coordsAtPos(pos);
  return {
    left: c.left,
    right: c.right,
    top: c.top,
    bottom: c.bottom,
    width: c.right - c.left,
    height: c.bottom - c.top,
    x: c.left,
    y: c.top,
    toJSON() {
      return this;
    }
  } as DOMRect;
}

function actionCode(editor: Editor, view: EditorView, range: Range): boolean {
  // Marked before any transaction so the mapping (and its inverse, if the
  // picker is cancelled and we undo) tracks this exact `/` position.
  markSlashDismissed(range.from);
  if (!prepareSlashTarget(view, range)) {
    return false;
  }
  editor.chain().focus().toggleCodeBlock().run();
  const rect = coordsToRect(view, editor.state.selection.from);
  showLanguagePicker(editor, {
    anchorRect: rect,
    currentLanguage: '',
    allLanguages: codeLowlight.listLanguages(),
    onClosed: () => {
      // Cancelled without picking a language: undo the block insertion (one
      // step, since it merged with the deletion above) to restore `/query`.
      editor.commands.undo();
    }
  });
  return true;
}

function actionMermaid(editor: Editor, view: EditorView, range: Range): boolean {
  if (!prepareSlashTarget(view, range)) {
    return false;
  }
  editor.chain().focus().toggleCodeBlock({ language: 'mermaid' }).run();
  const pos = editor.state.selection.from;
  view.dispatch(view.state.tr.insertText(MERMAID_STARTER_DIAGRAM, pos));
  return true;
}

function actionTable(editor: Editor, view: EditorView, range: Range): boolean {
  markSlashDismissed(range.from);
  if (!prepareSlashTarget(view, range)) {
    return false;
  }
  const rect = coordsToRect(view, editor.state.selection.from);
  showTableGridPicker(editor, rect, {
    onInsert: (rows, cols) => {
      editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    },
    onClosed: () => {
      editor.commands.undo();
    }
  });
  return true;
}

function actionWikilink(view: EditorView, range: Range): boolean {
  const { from, to } = range;
  const tr = closeHistory(view.state.tr);
  tr.delete(from, to);
  tr.insertText('[[', from);
  tr.setSelection(TextSelection.create(tr.doc, from + 2));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

function actionEmoji(editor: Editor, view: EditorView, range: Range): boolean {
  markSlashDismissed(range.from);
  const rect = coordsToRect(view, range.to);
  showEmojiPicker(editor, {
    anchorRect: rect,
    onInsert: (shortcode) => {
      const { from, to } = range;
      const emojiType = view.state.schema.nodes.emoji;
      const tr = closeHistory(view.state.tr);
      tr.delete(from, to);
      if (emojiType) {
        tr.insert(from, emojiType.create({ shortcode }));
        tr.setSelection(TextSelection.create(tr.doc, from + 1));
      } else {
        tr.insertText(`:${shortcode}:`, from);
      }
      view.dispatch(tr.scrollIntoView());
      view.focus();
    }
  });
  return true;
}

/** `/date` and `/datetime`: insert the formatted timestamp inline as plain
 *  text, replacing `/query` in one `closeHistory`'d transaction — same
 *  inline shape as `actionWikilink`, so one undo restores `/query` exactly. */
function actionDate(view: EditorView, range: Range, includeTime: boolean): boolean {
  const { dateFormat, timeZone } = getSlashCommandsConfig();
  const text = formatSlashDate(new Date(), { format: dateFormat, timeZone, includeTime });
  const { from, to } = range;
  const tr = closeHistory(view.state.tr);
  tr.delete(from, to);
  tr.insertText(text, from);
  tr.setSelection(TextSelection.create(tr.doc, from + text.length));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

/**
 * `/properties`: deletes `/query` (one `closeHistory`'d PM transaction, same
 * as the inline commands above) and, alongside it, asks `editor-main.ts` to
 * insert an empty frontmatter block — a side effect that lives outside the
 * ProseMirror doc, so a lone Cmd+Z on the PM transaction above wouldn't
 * touch it on its own. To still get a genuine one-undo round trip, this
 * records the undo depth right after its own deletion and watches the very
 * next `editor` update: if that update is the deletion being undone (depth
 * drops back to where it was before), it calls `revert()` to remove the
 * frontmatter and re-render in lockstep. Any other next update (the user
 * typing something else, e.g.) leaves the frontmatter as inserted — matches
 * how every other undo-tracked action here behaves.
 */
function actionProperties(editor: Editor, view: EditorView, range: Range, deps: SlashActionDeps): boolean {
  const depthBeforeDeletion = pmUndoDepth(view.state);
  const { from, to } = range;
  const tr = closeHistory(view.state.tr);
  tr.delete(from, to);
  view.dispatch(tr.scrollIntoView());

  const { revert } = deps.insertEmptyFrontmatter();
  deps.focusPropertiesSection();

  const onUpdate = (): void => {
    editor.off('update', onUpdate);
    if (pmUndoDepth(editor.state) <= depthBeforeDeletion) {
      revert();
    }
  };
  editor.on('update', onUpdate);
  return true;
}
