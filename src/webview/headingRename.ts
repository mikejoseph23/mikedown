// Heading Rename → Fix Links — pure detection logic (webview side).
//
// Kept free of DOM / ProseMirror so it can be unit-tested in isolation. The
// editor wiring in editor-main.ts feeds it heading text and decides what to do
// with the result. See planning/HEADING-RENAME-LINKS.md.

import { githubAnchorId } from '../anchoring';

export interface RenameEvent {
  oldSlug: string;
  newSlug: string;
}

/**
 * Decide whether a heading's text edit constitutes a *rename* (the anchor slug
 * changed) versus noise. Returns the rename event, or null if nothing to do.
 *
 * Returns null when:
 *  - the baseline had no slug (brand-new heading being typed for the first time);
 *  - the current text is empty/whitespace (heading deleted or cleared — not a
 *    rename, and there is no live target to point links at);
 *  - the slug is unchanged (formatting-only or punctuation-only edits that
 *    collapse to the same slug).
 */
export function detectHeadingRename(
  baselineText: string,
  currentText: string,
): RenameEvent | null {
  const oldSlug = githubAnchorId(baselineText);
  if (!oldSlug) return null; // no baseline anchor → brand-new heading
  if (!currentText.trim()) return null; // emptied → deletion, not a rename
  const newSlug = githubAnchorId(currentText);
  if (!newSlug || newSlug === oldSlug) return null; // no slug change
  return { oldSlug, newSlug };
}

/**
 * Duplicate-slug guard. Given the texts of every heading currently in the
 * document (in order, reflecting the *post-rename* state), decide whether the
 * rename touches ambiguous anchors and must be skipped.
 *
 * Ambiguous when EITHER:
 *  - some other heading still produces `oldSlug` as its base slug — meaning the
 *    old name was duplicated, so `#oldSlug` / `#oldSlug-1` map to different
 *    headings and we can't know which a given link meant; OR
 *  - more than one heading produces `newSlug` as its base — the new name
 *    collides, so `#newSlug` is itself ambiguous as a rewrite target.
 *
 * v1 deliberately refuses to guess in these cases (planning doc, Edge cases).
 */
export function isRenameAmbiguous(
  headingTexts: string[],
  oldSlug: string,
  newSlug: string,
): boolean {
  let oldBaseCount = 0;
  let newBaseCount = 0;
  for (const text of headingTexts) {
    const base = githubAnchorId(text);
    if (base === oldSlug) oldBaseCount++;
    if (base === newSlug) newBaseCount++;
  }
  // After the rename the renamed heading no longer carries oldSlug, so any
  // remaining oldSlug means a *different* heading shares that base name.
  const oldDuplicated = oldBaseCount >= 1;
  // newBaseCount includes the renamed heading itself; >1 means a collision.
  const newCollides = newBaseCount > 1;
  return oldDuplicated || newCollides;
}
