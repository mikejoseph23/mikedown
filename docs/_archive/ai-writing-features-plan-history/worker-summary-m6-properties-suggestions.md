# Worker summary: M6 Properties suggestions

**Status:** Completed (commit `56dab62` on `develop`)

**Start:** 21:19 **End:** 21:29

## Work completed

- [x] **Shared undoable frontmatter edit (extra item).** New `packages/core/src/frontmatterHistory.ts`: a TipTap extension (`FrontmatterHistory`) adds a `mikedownFrontmatter` attribute to the `doc` node. Each tracked edit is a real PM transaction (`DocAttrStep` via `tr.setDocAttribute`, `closeHistory`'d) carrying `{ seq, prev, next }`; an `editor.on('transaction')` listener in `editor.ts` applies `frontmatterAfterTransition(before, after)` (forward/redo → `next`, undo → undone record's `prev`) before `onUpdate` serialises. **Mechanism: real PM transaction, not the undo-depth watcher.** `editFrontmatterUndoable(next, remove?)` in `editor.ts` is the one path; chips and M5's frontmatter title pick both use it (the `/query` deletion shares the same transaction). `setFrontmatterTitle` and the watcher in `applyAiTitle` are gone. Redo works too.
- [x] **Sidebar Suggest button**: sparkle, `aria-label="Suggest properties with AI"`, right of the Properties header; hidden when `frontmatter` availability is `hidden` (or the editor is read-only), `aria-disabled` with the router's reason as tooltip when `disabled`. Options gained `onSuggestProperties`, plus `onApplyPropertySuggestion(pick) => boolean` and `onCancelPropertySuggestions`. Handle gained `applyPropertySuggestions(s, state, message?)` and `applySuggestAvailability(a)`.
- [x] **Chips row**: running = thin indeterminate progress line + engine badge text (+ Cancel); result = title, description and tag chips, each with ×, plus "Dismiss all" ("No new suggestions." when everything was already present); error = `aiErrorCopy(code).message` + Try again / Dismiss. Running reveals the sidebar and expands Properties.
- [x] **editor.ts wiring** (`startAiPropertySuggestions`): `runAiCompletion` feature `frontmatter`, `buildPropertiesMessages` with the body through `budgetDocument` (route `contextTokens` via `aiRouteInfo`, reserve 768 + outline/vocabulary/YAML size), `headingsOutline`, vocabulary from the last `setTags` payload sorted by count, existing entries from `frontmatterContent`; `thinking: sessionThinkingLevel`; JSON format when the model has it. One repair retry, abortable, row reads "Fixing the answer format…" (D16). Aborts on a new run, on document switch (`setMarkdown` load), on switch to source mode, on read-only, and on dispose.
- [x] **Applying a chip**: `mergePropertySuggestion` (new pure `propertySuggestions.ts`) → `serializeFrontmatter` → `editFrontmatterUndoable`. Tags append to the `tags:`/`tag:` array (a scalar list becomes an array), title/description set or replaced. No frontmatter: the first chip creates the block in the same single step (null → YAML through the doc-attribute record, block shown expanded like `/properties`), so `insertEmptyFrontmatter` is not needed. Each click is one undo step; the chip disappears once applied; focus moves to the next chip, else the editor.
- [x] **Source mode**: Suggest disabled with "Switch to rich text to apply suggestions" (chosen over CM YAML editing; the existing code only supports CM edits of the `title:` line).
- [x] **Styles** in `styles/outline-sidebar.css`: dashed-outline suggested chips on the pill look, "new" mark, ellipsis for title/description, progress line (reduced-motion aware). Theme tokens only, so light and dark both follow.
- [x] `aiSuggestProperties` added to the `types.ts` command union and the `editor.ts` command switch (runs Suggest; shows the sidebar and expands Properties).
- [x] lint and test:unit green; committed.

## Files modified

- `packages/core/src/editor.ts`
- `packages/core/src/outlineSidebar.ts`
- `packages/core/src/styles/outline-sidebar.css`
- `packages/core/src/types.ts`
- `packages/core/src/frontmatterHistory.ts` (new)
- `packages/core/src/propertySuggestions.ts` (new)
- `packages/core/test/outlineSidebar-suggest.test.ts` (new, 14 tests)

`ai-rewrite.ts` was not changed (the title path lives in `editor.ts`).

## Test status

- `npm run build:core`: OK
- `npm run test:unit`: 154 files, 2644 passed, 2 todo, 0 failed
- `npm run lint`: 0 errors (warnings pre-existing; none in the new files)
- `npx tsc -p tsconfig.webview.json --noEmit`: clean

## Issues or blockers

None. Not checked against a live engine (tests use a stub host); no visual check in a browser.

## Notes for orchestrator

- Deviation: Suggest is also **disabled** (not hidden) when the frontmatter is not simple YAML (`isSimpleFrontmatter` false), reason "These properties use YAML the sidebar cannot edit. Edit them in the frontmatter block.", because `serializeFrontmatter` would drop nested content.
- `aiBadge(route, served, viaFallback)` is now a named function in `editor.ts` (the popover's `badge` dep uses it).
- Sidebar typing edits (`onPropertiesChange`) and `/properties` still bypass PM history, as before; only chips and the title pick are tracked. An undo of a tracked edit restores the YAML as it was right before that edit, so an untracked sidebar edit made after it is reverted too.
- New exports: `FrontmatterHistory`, `frontmatterEditTransaction`, `frontmatterAfterTransition`, `FRONTMATTER_DOC_ATTR` (frontmatterHistory.ts); `mergePropertySuggestion`, `PropertySuggestionPick` (propertySuggestions.ts); `SuggestPropertiesAvailability`, `PropertySuggestionsState` (outlineSidebar.ts). Not re-exported from the package index.
- For M7 docs: command name `aiSuggestProperties`; chips are title, description and tags; Cancel while running; each chip is one undo step.

## Review Materials

- Tests: `/Users/michaeljosephwork/git/mikedown/packages/core/test/outlineSidebar-suggest.test.ts`
- To see it: `npm run dev` (VS Code dev host) or `cd packages/core && npm run demo`, turn AI on with an engine that serves `structure`, open the sidebar, click the sparkle in the Properties header.
