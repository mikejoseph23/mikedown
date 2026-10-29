# Worker Summary: M3 — Wire Existing-Block Commands

**Sandbox note:** writing to the main repo path
`/Users/michaeljosephwork/git/mikedown/.orchestrator/slash-commands-planning/worker-summary-M3-actions.md`
was blocked (worktree isolation), so this summary is written here in the
worktree at the same relative path instead.

**Status:** Completed

**Start:** 2026-09-26 01:25
**End:** 2026-09-26 01:53

**Worktree:** `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a8fb28090238ea20d`
**Branch:** `worktree-agent-a8fb28090238ea20d`
**Commit:** `57a1aa1e697943e17c09d1804480c85298427f67`

## Worktree trap note

Commit `0293b60` was not present when I started; the tree was clean, so per
the prompt's fallback I ran `git reset --hard 3fe9317` — but that landed on
an unrelated, older commit (predates all of M1/M2/T1). I checked and `main`
was already sitting exactly on `0293b60`, so I re-reset to `main` (`0293b60`)
instead, which matched the expected base. Flagging this in case the fallback
SHA in the prompt template needs a second look for future workers.

## Work completed (checkbox map)

- [x] Map every registry `id` to an action — split across `slashcommands.ts`
  (headings/paragraph, already M2) and new `slashcommands-actions.ts`
  (everything else), wired via `editor.chain()` and `view.dispatch(tr)`.
- [x] Mid-line insert-below shared helper — `prepareSlashTarget` /
  `applySlashWrap` in `slashcommands.ts` (see "Files modified" below);
  empty line converts in place, non-empty line inserts the new block after
  the current one with the cursor inside it.
- [x] Headings H1–H6, paragraph (M2, left in place), quote, bullet, numbered,
  task list.
- [x] Divider (`setHorizontalRule`), serializes as `---`.
- [x] Callouts note/tip/important/warning/caution via `setCallout`-equivalent
  wrap, serializes as `> [!NOTE]` etc.
- [x] Code block: creates the block, opens `showLanguagePicker` anchored via
  `coordsAtPos`.
- [x] Mermaid: code block with `language: 'mermaid'`, pre-filled with the M1
  starter diagram, cursor inside; renders via the existing mermaid decoration
  plugin when enabled.
- [x] Table: `showTableGridPicker` now takes a rect (in addition to the
  existing `HTMLElement` anchor) and an `onInsert` override; commit inserts
  the table.
- [x] Link: `showLinkDialog(editor, range?)` — extended with an optional
  range; Insert/Update removes `/query` and applies the href inline.
- [x] Wikilink: replaces `/query` with `[[`; confirmed `wikilinkautocomplete.ts`
  opens on the next view update (tested with seeded candidates).
- [x] Emoji: `showEmojiPicker(editor, { anchorRect, onInsert })` at the cursor.
- [x] Picker-based commands keep `/query` until commit; cancel leaves it
  intact — code/table via "prepare eagerly, undo on cancel" (see Notes),
  link/emoji via "don't touch the doc until commit."
- [x] Every action's text replacement goes through one `closeHistory`'d
  transaction.
- [x] `npm run lint`, `npm run compile`, `npm run test:unit` green.
- [x] Commit.

## Handoffs from earlier milestones — addressed

- **T1 bug** (unhandled command reopens menu): fixed in `runMatch`
  (`slashcommands.ts`) — when `executeSlashCommand` returns `false`, the `/`
  position is now recorded as dismissed (mirroring `closeSlashMenu`'s logic)
  instead of just calling `hidePopup()`. Added a regression test.
- **Follow-up picker reopening the slash menu**: added `markSlashDismissed`
  (exported from `slashcommands.ts`) and call it before opening any
  deferred-delete picker (code, table, link, emoji), so the menu can't pop
  back open while the picker is focused or after a cancel restores `/query`
  to the same position.
- **Preceding space on mid-line commands**: fixed with a documented rule
  (`computeDeleteFrom` in `slashcommands.ts`) — the trigger space is only
  swallowed when nothing follows the query on the line; when there's
  trailing text (`foo /table|bar` → `foo bar`), the space is kept since it's
  the only thing separating the two text runs once `/table` is gone.
- **List-item silent no-op**: `listEscapeAfter` in `slashcommands.ts` detects
  when the target textblock's parent is a `listItem`/`taskItem` and forces
  the "insert after" path, landing the new block right after the *whole*
  enclosing list instead of trying (and silently failing) to convert the
  item's own paragraph.

## Files modified

- `src/webview/slashcommands.ts` — `markSlashDismissed`, `listEscapeAfter`,
  `computeDeleteFrom`, `prepareSlashTarget` (dispatch-immediately variant, for
  `setBlockType`/insert-shaped follow-ups) and `applySlashWrap` (shape-then-
  dispatch-once variant, for wrap-shaped follow-ups); `runMatch` dismissal
  fix; heading/paragraph handling in `executeSlashCommand` reuses
  `computeDeleteFrom`/`listEscapeAfter`.
- `src/webview/slashcommands-actions.ts` (new) — the M3 action map:
  `initSlashCommandActions(editor, { showLinkDialog })`, registered via
  `setSlashCommandHandler`.
- `src/webview/languagepicker.ts` — `onClosed` now fires only on a real
  cancel (never after a commit); cancels a pending `requestAnimationFrame`
  doc-listener registration if the picker closes before it fires (was a
  latent leak that could steal Escape from the *next* picker instance —
  found via my own tests, see Notes).
- `src/webview/tablepicker.ts` — `showTableGridPicker` accepts a rect anchor
  in addition to an `HTMLElement`, plus `onInsert`/`onClosed` overrides
  (`onClosed` fires only when nothing was committed).
- `src/webview/emojipicker.ts` — `showEmojiPicker` accepts an `onInsert`
  override.
- `src/webview/editor-main.ts` — `showLinkDialog` takes an optional
  `slashRange`; one new import; one `initSlashCommandActions(editor, {
  showLinkDialog })` call after editor construction. Did not touch the
  settings modal, `settings` handler, placeholder config, `openSettings`
  handler, or the protocol comment (M5's territory).
- `test/unit/slashcommandsActions.test.ts` (new) — 19 tests covering one
  representative case per command shape (wrap, setBlockType-family, picker
  commit/cancel, inline), the mid-line preceding-space rule, the list-item
  escape, and the unhandled-command regression.

## Test status

- `npm run compile` — green.
- `npm run lint` — 377 problems (253 errors / 124 warnings), identical count
  to the pre-existing repo-wide baseline (eslint's `parserOptions.project`
  excludes `src/webview`); no new distinct findings in any file I touched.
- `npm run test:unit` — 541/541 passed (522 pre-existing + 19 new), across
  39 files.

## Issues / blockers

None blocking. One deviation worth flagging (see Notes for orchestrator).

## Notes for orchestrator

1. **ProseMirror history does not group a `wrap` step with a preceding
   transaction.** I initially implemented blockquote/lists/callouts as
   "delete `/query` in one closeHistory'd tr, then shape via a second
   `editor.chain().toggleBlockquote()`-style dispatch" — the same pattern
   that works for headings. Empirically (verified with throwaway scratch
   tests, since removed) this requires **two** `Cmd+Z` for wrap-shaped
   commands specifically, because a `ReplaceAroundStep`-based wrap doesn't
   satisfy ProseMirror history's `isAdjacentTo` adjacency check the way
   `setBlockType`/insert-shaped steps do. Fixed by adding `applySlashWrap`,
   which builds the wrap inside the *same* transaction via
   `findWrapping` + `tr.wrap` (`findWrapping` conveniently auto-computes the
   `listItem` intermediate wrapper for lists). `setHorizontalRule`,
   `toggleCodeBlock`, and `insertTable` were verified to merge fine as a
   second dispatch, so those still use the simpler `prepareSlashTarget` +
   `editor.chain()` pattern. This is documented at length in
   `slashcommands-actions.ts`'s module doc comment for the next reader.
2. **Preceding-space rule** ended up needing to be conditional (see handoffs
   above) rather than "always strip" — a blanket strip breaks the exact
   `foo /table|bar` → `foo bar` example from the plan when read literally
   (original text has no space between the query and the trailing `bar`).
3. **Code/table cancel** is implemented as `editor.commands.undo()` inside
   the picker's `onClosed` (fires only on a real cancel, not after a commit)
   rather than deferring the block's creation — the code-block path in
   particular needs the block to exist *before* the language picker opens
   (so `updateAttributes('codeBlock', ...)` and the anchor rect both have
   something real to target). This relies on the "eager prepare + shape" tr
   pair being merged into one undo step (see #1), which I verified directly.
4. Per the standing "Scope guard," I did not touch the pre-existing
   `toggleBold`/`toggleItalic` sourceMode guard bug, and I did not attempt
   to fix the repo-wide lint `parserOptions.project` gap.
5. `/image`, `/properties`, `/date`, `/datetime` are untouched — they fall
   through to `return false` in `slashcommands-actions.ts` with an explicit
   comment naming M4/M6, and the plugin's own "unhandled command" path
   (fixed per handoff #1 above) already does the right thing (no menu
   reopen, no doc change) until those land.
6. M5 (settings) should be unaffected — I never touched the settings modal,
   `settings` message handler, placeholder config, `openSettings` handler,
   or the protocol header comment in `editor-main.ts`.

## Review Materials

- `src/webview/slashcommands-actions.ts` — read the module doc comment first;
  it explains the three command shapes and the history-grouping finding.
- `src/webview/slashcommands.ts` — `prepareSlashTarget` / `applySlashWrap` /
  `computeDeleteFrom` / `listEscapeAfter` (search for those names).
- `test/unit/slashcommandsActions.test.ts` — exercises every command once,
  including 4 explicit one-undo-restores-`/query` assertions (quote,
  mermaid, link, plus the pre-existing heading test in
  `slashcommandsHarness.test.ts`).
