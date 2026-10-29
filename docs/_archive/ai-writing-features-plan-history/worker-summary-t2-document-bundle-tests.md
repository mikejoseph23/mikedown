# Worker summary: T2 Document bundle tests and live run

**Status:** Completed (one red test outside my scope, see Issues; one source bug recorded as `it.fails`).

**Commit:** `eb4494a` (test files only).

## Work completed (checkbox to test)

- [x] `ai-json.test.ts` (new, 25 tests): all nine fixtures in `test/ai-fixtures/outputs/` driven one by one (value or failure), the exact failure messages for `truncated.json` and `plain-text.json`, extra cases (array, fences, think-only JSON, slips, nested), `jsonRepairMessages` quotes the error, strips reasoning, caps at 4000 chars, `(empty reply)`, and `JSON_SHAPE_HINT`.
- [x] `ai-document-budget.test.ts` (new, 25 tests): fits, no-op, budget arithmetic, section boundaries, heading exactly on the budget, preamble as section one, heading-less documents, CRLF, fences (backtick, tilde, longer fence, nested fence line, heading inside a fence), over-budget first section kept by whole blocks, coverage maths and clamps, frontmatter always kept, `headingsOutline` shape and strictness.
- [x] `ai-summary-title-properties.test.ts` (new, 35 tests): title and properties prompt builders include the shape hint and the vocabulary (capped at 80, order kept), summary prompts and the coverage wording, `parseTitles` (fixtures, dedupe, case, existing title, cleaning, 120 cap, bare array, errors), `parsePropertySuggestions` (`#Tag`, spaces, `tag:` vs `tags:`, known/new, drops existing, cap 8, string tags, equal title/description dropped, empty vs "nothing new").
- [x] `ai-router.test.ts` (extended, +4): `structure` usable without `json` and `prefers` ordering were already covered (lines ~232 and ~485); `summarize` usable at 8k was covered (~221). Added: summary prefers a 32k model on fallback, still serves a small one, `frontmatter` follows the structure preference, a usable chosen route is kept.
- [x] `slashcommandsRegistry.test.ts` (extended, +5): ai group is last, present only when not in the hidden set, each feature hides its own commands, hidden commands are not found by alias, `/sum` `/summ` `/tl` `/tldr` `/summarize` rank Summary first, exact id above exact alias. Editor-level D15 in `ai-insert-modes.test.ts`: no `ai` host object, `summary` feature off (title stays), `title` feature off (summary and outline stay), both off so `/outline` means TOC again. "Hidden and disabled both hide" was already covered by M5's `ai-summary-title.test.ts` (AI off, and no route).
- [x] Insert and choose modes: `ai-insert-modes.test.ts` (new, 15 tests, 1 `it.fails`). Insert: one bullet list, one undo restores `/outline`, redo re-inserts, lead-in dropped, empty reply is `badOutput` with no Insert. Choose: quoted title (`"Plan: Phase 2"`), frontmatter without a title key replaces the H1 and leaves the YAML byte for byte, no title and no H1 inserts an H1 below the frontmatter, only the first H1 changes. M5's `ai-summary-title.test.ts` already covers the main insert/choose happy paths.
- [x] Outline sidebar (`outlineSidebar-suggest.test.ts`, extended, +6): sidebar in isolation with spies. Suggest hidden/disabled(reason)/enabled and click only when enabled; chips order and "new" mark; apply calls `onApplyPropertySuggestion(pick)` and the chip goes only when it returns true; dismiss one / Dismiss all / last chip closes; "no new suggestions", Cancel, Try again. **Deviation:** a chip does not call `onPropertiesChange` (that is the inline edit path). The apply path is `onApplyPropertySuggestion` then `mergePropertySuggestion` then `editFrontmatterUndoable`. The test asserts `onPropertiesChange` is not called and checks the merged entries through `mergePropertySuggestion`; M6's editor tests assert the resulting markdown.
- [x] `test/live/ai-live.test.ts`: two cases added per engine (`structure` titles via `buildTitleMessages` and `parseTitles`; `summarize` TL;DR via `buildSummaryMessages` and `finalizeSummary`), skipped unless live.
- [x] Gates, live run, commit (below).

## Extra checks

- [x] Frontmatter undo edges, `ai-frontmatter-undo.test.ts` (new, 11 tests): chip then undo then redo then undo; two chips two undos then two redos; typing between chips (undo takes the typing first); no frontmatter creates the block, undo removes it, redo recreates it; two chips from nothing; the host's `onChange` never contains `mikedownFrontmatter` or `seq` and the frontmatter appears exactly once across apply/undo/redo/typing, also for a picked title; `setMarkdown` leaves no undo step restoring the old YAML (undo and redo are no-ops), a new document without frontmatter does not inherit the block, and edits on the new document undo to its own YAML. No bug found.
- [x] Truncated whole-document translate (`ai-insert-modes.test.ts`): `budgetTranslation(...).text + rest === original`; Accept ("Replace document") keeps the untranslated rest byte for byte after the translated part (`## Parte 0 ...` then `## Part N ...` onward), the note reads "Translates the first N% of the document; the rest did not fit the model's context and stays as it is.", one undo restores the whole document; a body that fits shows no note.

## Files modified

New: `packages/core/test/ai-json.test.ts`, `ai-document-budget.test.ts`, `ai-summary-title-properties.test.ts`, `ai-frontmatter-undo.test.ts`, `ai-insert-modes.test.ts`.
Extended: `packages/core/test/ai-router.test.ts`, `slashcommandsRegistry.test.ts`, `outlineSidebar-suggest.test.ts`, `test/live/ai-live.test.ts`.
No source files touched. Planning document untouched.

## Test status

- `npm run test:unit`: 159 files, 2770 passed, 2 todo, 0 failed.
- `npm run test:edge`: 3 files, 22 passed.
- `npm run test:packages` (after the budget change below): 79 passed, 0 failed. Standalone bundle is 886568 B gzipped (865.8 kB) against the new 900 kB budget. Before the change: 78 passed, 1 failed (the known red test): `web-component-shape.test.ts` "stays under the 850 kB gzipped budget". Current standalone size is **886568 B** gzipped (limit 870400). It was 874099 B at `da0789d`, so it grew by about 12 kB since. Budget not changed.
- `MIKEDOWN_AI_LIVE=1 npm run test:ai-live`: 12 passed, 14 skipped, 0 failed. oMLX ran everything (model `Qwen3.8-Flash-Next-Uncensored-oQ4e-mtp`); LM Studio skipped (no chat model loaded); Ollama skipped (not reachable). New cases on oMLX:
  - titles: pass, 1109 ms. Titles: "Engineering Team Moves to Four-Day Week After Successful Pilot" / "How a Four-Day Week Cut Sick Days Without Slowing Output" / "Four-Day Week Pilot Results and Next Steps".
  - summary: pass, about 1.0 to 1.2 s (two runs). Block: `> [!NOTE]` / `> **Summary**` / paragraph: "The engineering team completed a six-week pilot of a four-day work week, maintaining consistent output in shipped features and bug fixes. Key changes included concentrating meetings on Tuesday and Wednesday, switching to asynchronous standups, and keeping Fridays free. The trial resulted in a one-third reduction in sick days and improved employee retention without impacting customer response times. The team will continue this schedule for another quarter before conducting a review in September."

## Issues or blockers

1. **Source bug (recorded, not fixed):** `packages/core/src/ai/prompts/summary.ts` `tidy()` (line ~95) strips a wrapping code fence before it strips a lead-in. A reply like `Here is the outline:\n\n```markdown\n- One\n- Two\n```` keeps the fence, so Insert puts a code block in the document instead of a list. Test: `ai-insert-modes.test.ts` "a reply with a lead-in and a wrapping code fence inserts only the list" is `it.fails`. Fix: strip the lead-in first, then the fence; then flip the test to `it`.
2. **Design limit (documented in a test, not a bug per spec):** `budgetDocument` cuts only on block boundaries, so one huge paragraph or one huge fence is sent whole and reported `truncated: false`, and the request can overflow the model's window. Test: `ai-document-budget.test.ts` "a single block". Also, an over-budget first section with a tiny budget keeps only its first block, which is often just the heading line.
3. Per the orchestrator's follow-up (Mike approved), `test/packages/web-component-shape.test.ts` budget raised from 850 to 900 kB (`BUDGET = 900 * 1024`, comment updated), committed separately. Headroom is about 34 kB.

## Notes for orchestrator

- No new exports or source changes. Sidebar chip apply contract is `onApplyPropertySuggestion(pick) => boolean`, not `onPropertiesChange`; the plan checkbox wording is stale on that point.
- The `ai-insert-modes.test.ts` name now also holds D15 editor-level slash visibility tests and the truncated-translate Accept test.
- Other checkbox coverage already existed from M4/M5/M6 (router `structure`/`prefers`/`summarize`, slash hidden-for-disabled, insert/choose happy paths, sidebar happy paths); I extended rather than duplicated.

Start time: 21:29
End time: 21:39

Review Materials: `git show eb4494a`; run `npx vitest run packages/core/test/ai-json.test.ts packages/core/test/ai-document-budget.test.ts packages/core/test/ai-summary-title-properties.test.ts packages/core/test/ai-frontmatter-undo.test.ts packages/core/test/ai-insert-modes.test.ts`.

## Gap fill

- Budget: `test/packages/web-component-shape.test.ts` raised to 900 kB in `ae1135c` (comment updated). `npm run test:packages`: 79 passed, 0 failed; standalone 886568 B gzipped (865.8 kB).
- `tidy()` in `packages/core/src/ai/prompts/summary.ts` now strips the lead-in before the wrapping fence (and again inside the fence), so "Here is the outline:" plus a fenced list inserts a list. The `it.fails` in `ai-insert-modes.test.ts` is now a plain `it`. Commit `5f344d7`. Issue 1 above is resolved.
- `npm run build:core` ok; `npm run test:unit`: 159 files, 2770 passed, 2 todo, 0 failed.
