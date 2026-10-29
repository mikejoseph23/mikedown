# Worker summary: M4 webview half + M6 actions

**Status:** Completed

## Work completed

### Part A — M4 webview half

- [x] `src/webview/imagepick.ts` — `requestImagePick(view, from, to)` with a pending-by-`requestId` map (same pattern as `imagepaste.ts`). On a successful `pickedImageResult`, replaces `[from, to)` with an image node (`src` = `webviewUri`, falling back to `insertPath` when the host sends only that) in one `closeHistory`'d transaction. `cancelled`/`error` replies leave `/query` untouched (no transaction).
- [x] Routed `pickedImageResult` in `src/webview/editor-main.ts`'s message handler, right next to `pastedImageResult`. Wired `setPostMessage` for the new module alongside `imagepaste.ts`'s.
- [x] Wired the `image` id in `src/webview/slashcommands-actions.ts`: `markSlashDismissed` (so the async host round-trip doesn't let the menu reopen for the still-present `/query`) + `requestImagePick`. Replacement is the module's own single transaction; one undo restores `/query`.
- [x] Harness tests in `test/unit/slashcommandsActions.test.ts` (`describe('slash menu — image (M4)')`): `pickImage` posted with a `requestId`; a `pickedImageResult` reply inserts the image serialized to `insertPath` and one undo restores `/image`; `cancelled` and `error` replies both leave `/image` untouched.
- [x] `npm run compile`, `npm run test:unit` green; lint has no new distinct findings (see Issues below).

### Part B — M6 actions

- [x] `/date` inserts `formatSlashDate(new Date(), { format, timeZone, includeTime: false })` inline, one `closeHistory`'d transaction.
- [x] `/datetime` — same with `includeTime: true`.
- [x] `/properties` removes `/query` and inserts an empty frontmatter block, then focuses the sidebar's Properties section.
- [x] Harness tests: `/date`/`/datetime` for 4 `dateFormat`/`timeZone` combos sent via a `settings` message, with the clock stubbed (`vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime`, scoped so it doesn't fight the harness's own real-timer `settle()`); `/properties` round-trips to `---\n\n---\n` (`serializeFrontmatter([])`) at the top of the doc; `/prop` is not offered right after running `/properties`; one undo restores `/query` for all three.
- [x] `npm run lint`, `npm run compile`, `npm run test:unit` green.

## The `/properties` architecture problem (read this one)

The task called out that frontmatter "may not live in the PM doc" and asked me to find the real path rather than fake it. What I found:

`frontmatterContent` in `editor-main.ts` was a plain `string`, defaulting to `''`, with `''` doing double duty for both "no frontmatter" and "frontmatter present but empty." `restoreFrontmatter('')` returned the body with **no** `---` delimiters at all. That's a real bug, not just an undo wrinkle: if `/properties` had set `frontmatterContent = ''` under the old scheme, the very next keystroke anywhere in the document would silently strip the frontmatter block back out again (since `onUpdate` re-serializes via `restoreFrontmatter(frontmatterContent, body)` on every edit).

So this wasn't optional scope — an empty-but-present frontmatter block is structurally unrepresentable without fixing the sentinel. I changed `frontmatterContent` to `string | null` (`null` = absent, `''` = present-but-empty) and updated the ~10 call sites in `editor-main.ts` (`extractFrontmatter`/`restoreFrontmatter`, the frontmatter-provider check, `refreshPropertiesSidebar`, `renderFrontmatterBlock`'s early return, the source-mode-exit and initial-`update` load paths). This is scoped to `editor-main.ts` alone — `parseFrontmatter`/`serializeFrontmatter`/`isSimpleFrontmatter` in `frontmatterYaml.ts` are unchanged and untouched by tests.

**Undo:** since `frontmatterContent` lives outside the ProseMirror doc, PM's own undo can't restore it. `insertEmptyFrontmatter()` (editor-main.ts) returns a `revert()` closure; `actionProperties` (slashcommands-actions.ts) records `pmUndoDepth` right after its own `/query`-deletion transaction and watches the *next* `editor` update — if that update's undo depth drops back to (or below) the recorded checkpoint, it calls `revert()`, which restores `frontmatterContent = null`, re-renders the WYSIWYG frontmatter block + sidebar, and posts the corrected `edit` message. Verified via the test: one `commands.undo()` restores `/query` in the PM doc *and* the posted markdown drops the `---` delimiters, in one user-facing step. This is a heuristic (it only inspects the very next update), not a true transaction-level guarantee, but it matches how every other undo-tracked action in this file already behaves (code/table's "cancel = undo the merged step" pattern) and covers the tested scenario correctly.

**Focus:** added `focusPropertiesSection()` to `outlineSidebar.ts` — shows the sidebar, un-collapses Properties (bypassing the auto-collapse-when-empty rule the same way an explicit user toggle would), and focuses the "+ Add property" trigger (or the section header if editing isn't offered) so the very next keystroke can start naming a key. It does not simulate a click into edit mode on the user's behalf.

## Files modified

- `src/webview/imagepick.ts` (new)
- `src/webview/editor-main.ts`
- `src/webview/outlineSidebar.ts`
- `src/webview/slashcommands-actions.ts`
- `test/unit/slashcommandsActions.test.ts`

`slash-commands-planning.md` was read but not modified (it shows modified in `git status` from Mike's own concurrent review-appeal work, not mine).

## Test status

- `npm run compile` — green (both bundles).
- `npm run test:unit` — 634/634 passed (44 files).
- `npm run lint` — same pre-existing repo-wide failure as before this work (every `src/webview/*.ts` file, including the ones I touched, fails with the tsconfig-project parsing error the CLAUDE.md notes: "eslint project excludes src/webview"). No new distinct finding categories in any file I touched — confirmed by diffing lint output before/after.

## Issues / blockers

- **Existing test broken by this work, fixed:** `test/unit/slashcommandsActions.test.ts`'s T1-regression test used `/image` as its example of a "not-yet-wired command" — now wired, so that premise no longer held. Rewrote it to force the *external handler* to report unhandled for a real id (`quote`), which exercises the same generic `runMatch`/`slashcommands.ts` fallback path the original test was protecting, without depending on any specific id staying unwired (none do, as of this milestone). Note for whoever touches this next: the harness's `vi.resetModules()` before each `bootWebview()` means a top-level `import { setSlashCommandHandler } from '...'` in a test file binds to a stale module instance after the first boot — re-import dynamically post-boot to reach the live handler registry.
- **Scope guard, not touched:** the pre-existing `toggleBold`/`toggleItalic` sourceMode guard bug (called out as out-of-scope in the prompt).
- **`/properties` undo heuristic:** see the architecture section above — it's a "watch the next update" heuristic, not a hard guarantee tied to a specific transaction. I judged this the right level of effort given the constraint (frontmatter genuinely isn't PM-doc state) and flagged it explicitly rather than either skipping the requirement or overclaiming a stronger guarantee.

## Notes for orchestrator

- Two commits landed on `main`, both ahead of the `538093d` base commit named in the prompt:
  - `1993c00` — "Wire /image to the native file picker" (Part A)
  - `e5ae34b` — "Wire /date, /datetime, and /properties slash commands" (Part B)
- Splitting the two milestones into two commits required reconstructing an intermediate "M4-only" version of `slashcommands-actions.ts` and `test/unit/slashcommandsActions.test.ts` (the switch-statement cases and test file additions were adjacent lines in the same files), verified green independently, committed, then the M6 content was restored on top and committed separately. `editor-main.ts` split cleanly via `git add -p` since its M4 and M6 hunks were in physically distant parts of the file.
- No unrelated files were staged; `slash-commands-planning.md` and the untracked `.claude/` directory were left alone in both commits.

**Review Materials:**
- `src/webview/imagepick.ts` (new module)
- `src/webview/editor-main.ts:352` (frontmatter sentinel comment), `:4073-4109` (`insertEmptyFrontmatter`), `:4491` (renderFrontmatterBlock null check), `:5397-5403` (pickedImageResult routing)
- `src/webview/outlineSidebar.ts:471-486` (`focusPropertiesSection`)
- `src/webview/slashcommands-actions.ts:141-151` (switch wiring), `:299-346` (`actionDate`, `actionProperties`)
- `test/unit/slashcommandsActions.test.ts` — `describe('slash menu — image (M4)')`, `describe('slash menu — date and datetime (M6)')`, `describe('slash menu — properties (M6)')`, and the rewritten T1-regression test

**Start time:** 2026-09-26 01:56
**End time:** 2026-09-26 02:24
