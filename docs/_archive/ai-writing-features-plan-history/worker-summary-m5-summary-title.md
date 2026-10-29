# Worker summary: M5 `/summary` and `/title`

**Status:** Completed. Commit `865c124` on `develop` (not pushed).

**Start:** 21:02. **End:** 21:18.

## Work completed

- [x] **Extra item (whole-document translate budget):** I replaced the `TODO(M4)` in `ai-rewrite.ts#start` with `budgetTranslation(body, contextTokens)`. It uses the routed model's `contextTokens` from the new `routeInfo` dep, and an unknown window counts as `DEFAULT_CONTEXT_TOKENS`.
  - The coverage note uses the same `.ai-rw-coverage` element as `/summary`.
  - When the body is cut, Accept replaces the body with the translation followed by the untranslated rest, unchanged. Without this the rest of the document would be lost.
  - **Decision on the output budget:** `documentMaxTokens` stays as the output budget. When the body does not fit beside it, the context is split about 1 part input to 1.6 parts output, capped at `documentMaxTokens` of the part that is sent.
  - The structure check compares the result against the part that was sent.
- [x] **Registry:** new group `'ai'` with `summary` (aliases `tldr`, `summarize`), `outline` and `title` (alias `titles`), icon key `ai`. `AI_SLASH_COMMANDS` maps each feature to its ids.
  - `slashcommands.ts` renders the group last, labelled "AI", with a spark icon.
  - `editor.ts#syncAiSlashCommands` hides the group through `setSlashHiddenCommands` whenever availability is not `enabled`. It runs on every `renderAiIndicator` (settings, statuses, save) and on editor focus, because the hidden set is module-global.
  - No disabled-entry rendering was added.
- [x] **Slash actions:** `summary` and `outline` call `deps.aiSummarize(kind, range)`; `title` calls `deps.aiSuggestTitle(range)`. Both use `markSlashDismissed` (picker pattern).
  - `cursorInsertTarget(editor, slash?)` is in `ai-rewrite.ts`. It decorates `/query`, and Accept parses the markdown and deletes `/query` (plus the space before a mid-line trigger) in one transaction.
  - The block replaces the caret's top-level block when that block is left an empty paragraph; otherwise it goes after it.
  - Cancel leaves the document untouched.
- [x] **Popover `insert` mode:** the title reads "Summary" or "Outline", the footer has Insert (Enter), Retry and Copy, and a TL;DR ⇄ Outline pill in the header runs again. A coverage note shows when the document was cut.
- [x] **Popover `choose` mode:** three candidates in a keyboard-navigable list, Retry regenerates, and a hint names the effect ("Sets title: in Properties", "Replaces the H1", "Inserts an H1").
  - In rich text, the H1 cases use `applyRichTitle`: one transaction that also deletes `/query`.
  - The frontmatter case deletes `/query` in a PM transaction, then sets the title through the Properties path. An undo-depth watcher puts the old YAML back on undo (the `/properties` pattern).
- [x] **AI toolbar menu:** flat entries "Summarize document…" and "Suggest titles…" after Rewrite selection and before the separator, each `{ enabled } | { enabled: false; hint }`. The hint is the router's reason, and an entry is left out when its feature is off.
  - `editor.ts#openAiToolbar` passes the availabilities and callbacks.
- [x] **Budget, tasks, JSON:** both commands use `budgetDocument` with the routed model's `contextTokens`. For titles, the reserve also covers the heading outline. Features are `summary` and `title`, and the router picks the tasks.
  - `/title` gets one abortable repair round trip, and the footer reads "Fixing the answer format…" while it runs. `/summary` never retries.
  - `badOutput` shows "Try again" (the label used for `badOutput`) and "Open AI settings".
  - `format: 'json'` is sent only when the routed model has `capabilities.json`.
- [x] **Source mode (AI menu or command only):** the summary goes in at the CM caret line in one CM transaction, either in place of a blank line or after the line. `applySourceTitle` sets the `title:` line, the first H1 (outside code fences) or a new H1, also in one CM transaction.
- [x] **Commands:** `aiSummarize` and `aiSuggestTitle` are in the `types.ts` union and the `editor.ts` switch.
- [x] **Checks:** lint has 0 errors. test:unit passes. Committed.

## Files modified

- `packages/core/src/ai-rewrite.ts`, `ai-toolbar.ts`, `editor.ts`, `slashcommands-registry.ts`, `slashcommands.ts`, `slashcommands-actions.ts`, `types.ts`, `styles/ai-rewrite.css`
- New tests: `packages/core/test/ai-summary-title.test.ts` (25 tests)
- Existing tests updated (neither is one of T1's files):
  - `packages/core/test/ai-toolbar.test.ts`: the menu now has two more entries.
  - `test/unit/slashcommandsHarness.test.ts`: the full menu count leaves out the hidden AI group.

## Test status

- `npm run lint`: 0 errors (1207 warnings, all from before this change)
- `npm run build:core` then `npm run test:unit`: 153 files, 2630 passed, 2 todo, 0 failed
- `tsc --noEmit` for `tsconfig.json` and `tsconfig.webview.json`: clean
- None of T1's test files were edited, and none broke.

## Issues and deviations

- **No `heading` alias on `title`.** An exact alias would have outranked Heading 1, so `/heading` + Enter would have opened AI titles. It is a `keyword` instead, which ranking does not use.
- **Ranking change in `matchCommands`.** It now ranks an exact id above an exact alias. Without that, `/title` would pick Heading 1 (alias `title`) and `/outline` would pick TOC (alias `outline`). The existing ranking tests pass.
- **Frontmatter title writes only the title line.** `setFrontmatterTitle` changes just the `title:` line (`setYamlTitle`, which keeps every other byte) through `applyFrontmatterYaml`, the shared persist and re-render half of `applyFrontmatterEdit`. A parse and re-serialize would drop comments and requote other keys. The Properties sidebar updates (tested).
- **Menu path with frontmatter is not undoable.** "Suggest titles…" from the AI menu, on a document with `title:` in rich text, involves no ProseMirror transaction, so Cmd+Z does not revert it. That is the same as a sidebar edit. The `/title` path and every H1 or source-mode path are one undo step.
- **Budget uses the route at open.** The budget is computed from the route resolved when the popover opens (`routeInfo`). If the run falls back to another model, the budget is not recomputed.
- **TrailingNode adds a paragraph.** StarterKit's TrailingNode appends an empty paragraph when the inserted callout ends the document. That is expected.

## Notes for orchestrator

New exports from `ai-rewrite.ts`:

- `cursorInsertTarget`, `sourceCursorTarget`, `AiCursorTarget`
- `applyRichTitle`, `applySourceTitle`, `setYamlTitle`, `yamlHasTitle`
- `AI_TITLE_EFFECT_HINTS`, `AiTitleEffect`
- `budgetTranslation`, `coverageNoteText`
- `AiSummaryJob`, `AiTitleJob`

Other new API:

- Popover methods `openSummary(target, job)` and `openTitles(target, job)`; new dep `routeInfo?(feature)`.
- From `slashcommands-registry.ts`: `AI_SLASH_COMMANDS`.
- `SlashActionDeps.aiSummarize` and `SlashActionDeps.aiSuggestTitle`.
- `AiToolbarMenuInput` fields `summarize`, `titles`, `onSummarize`, `onSuggestTitles` and `icons.summarize` / `icons.titles` (all optional).

For later milestones:

- M6 Properties suggestions can reuse `aiRouteInfo` from `editor.ts` for `contextTokens` and JSON, the `DOCUMENT_RESERVE_TOKENS` idea, and the repair flow pattern in `startTitles`.
- `aiConsent` moved up next to `aiServed` in `editor.ts`, so `renderAiIndicator` can call `syncAiSlashCommands` safely.

## Review Materials

- Tests: `/Users/michaeljosephwork/git/mikedown/packages/core/test/ai-summary-title.test.ts` (`npx vitest run packages/core/test/ai-summary-title.test.ts`)
- To try it by hand: `npm run dev`, turn AI on with an engine, then type `/sum` + Enter or `/title` + Enter in a document, or use the AI toolbar menu.
