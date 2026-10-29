# M4 Document understanding core: worker summary

**Status:** Completed

- Worktree: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a49f74c44a6778e98`
- Branch: `worktree-agent-a49f74c44a6778e98`
- Commit: `eb1d4bc` (on top of `3bd5c77`)
- Start / end: 20:30 / 20:45 (approx.)

## Work completed (per checkbox)

1. `ai/json.ts`: `parseLenientJson<T = unknown>(raw)` (strips `<think>`, looks in fences, first balanced `{}`/`[]` that parses, one repair pass for single quotes, trailing commas, unquoted keys, raw newlines in strings; tries later bracket pairs if an earlier one is not JSON; truncated or no JSON gives `ok: false` with a message). `jsonRepairMessages(previousRaw, error)` returns the two messages to append (assistant echo of the failed reply, then the user line from the plan). `JSON_SHAPE_HINT(example)`.
2. `ai/documentBudget.ts`: `budgetDocument`, `headingsOutline`, `CHARS_PER_TOKEN` (3.5). Text is always a prefix of the document (frontmatter included), ending on a heading boundary; a first section over budget is cut on a blank-line block boundary (at least the first block); fences are never split (heading and block detection are fence aware). Coverage is cut offset over full length, clamped to 0.001..0.999 when truncated.
3. `ai/prompts/summary.ts`: `buildSummaryMessages`, `summaryMaxTokens`, `finalizeSummary(raw, kind, coverage = 1)`, plus `SUMMARY_SYSTEM_PROMPT`, `OUTLINE_SYSTEM_PROMPT`, `summaryVisibleText`, `coveragePercent`. TL;DR is `> [!NOTE]` / `> **Summary**` / blank / body; outline stays a list; both get "Covers the first N% of the document." when `coverage < 1`. Empty reply returns `''`. Short documents (< 1200 chars) ask for one paragraph.
4. `ai/prompts/title.ts`: `buildTitleMessages`, `parseTitles(raw, existingTitle?)` returns `{ ok: true, titles } | { ok: false, error }`, `titleMaxTokens`, `renderHeadingOutline` (shared with properties).
5. `ai/prompts/properties.ts`: `buildPropertiesMessages`, `parsePropertySuggestions(raw, existing, vocabulary)` returns `{ ok: true, suggestions: { title?, description?, tags: { tag, known }[] } } | { ok: false, error }`, `existingTagsOf`, `propertiesMaxTokens`. `AiFrontmatterEntry` is an alias of `ParsedEntry` from `shared/frontmatterYaml`. Tags go through `normalizeTag` (spaces become hyphens), capped at 8; description 200; title 120; title and description dropped when equal to the document's own.
6. Tasks and features: `AiTaskDefinition.prefers`; `summarize` requires `{ chat }` and prefers `contextTokens: SUMMARIZE_MIN_CONTEXT_TOKENS`; `structure` requires `{ chat }` and prefers `{ json }`. `summary` and `frontmatter` are `available`, `frontmatter.requires` is now `{ chat: true }` (the feature's `json` would otherwise still gate), new `title` feature (task `structure`, `requires: { chat }`). Router: preferred candidates first within the fallback tier; never rejects on `prefers`. The AI tab renders from `AI_FEATURES`, so no copy edit was needed.
7. `badOutput` added to `AiErrorCode` (`types.ts`), `AI_ERROR_CODES` and `AI_ERROR_COPY` (copy as specified, action `retry`).
8. Fixtures `test/ai-fixtures/outputs/` (9 files: the seven asked for plus `unquoted-keys` and `truncated`) and a README section.
9. `npm run lint` (0 errors), `npm run test:unit` green.

## Files modified

- Edited: `packages/core/src/ai/{errors,features,index,router,tasks,types}.ts`, `packages/core/test/ai-router.test.ts` (old gates for summarize and structure replaced; new "task preferences" describe), `test/ai-fixtures/README.md`.
- New: `packages/core/src/ai/{json,documentBudget}.ts`, `packages/core/src/ai/prompts/{summary,title,properties}.ts`, `packages/core/test/ai-document-understanding.test.ts`, `test/ai-fixtures/outputs/*.json`.

## Test status

- `npm run build:core`: ok.
- `npm run lint`: 0 errors (existing warnings only).
- `npm run test:unit`: 147 files, 2487 passed, 2 todo, 0 failed.

## Issues or blockers

None. The Rust routing-scenario tests share `scenarios.json`, which I did not change (no scenario depended on the old summarize or structure gates).

## Notes for orchestrator

- `ai/index.ts`: my exports are one contiguous block at the end under the comment "Document understanding (M4)". `prompts/rewrite.ts` is not exported from the index at this base; M1 adds its own block, so the merge should be a simple concatenation.
- Router semantics: the chosen route (task route, else default) is honoured if usable even when it lacks a preference. `prefers` only orders fallback candidates (default route plus local engines first, cloud engines after). If you want the default route replaced by a JSON model when no task route is set, that is a small change in `resolveRoute`.
- `finalizeSummary` takes a third optional `coverage` argument (the spec had two); callers pass `budget.coverage`.
- `parseLenientJson` accepts an optional type parameter only as the caller's claim; always validate with `parseTitles` / `parsePropertySuggestions`.
- Callers do the repair round trip: on `ok: false`, send `[...original, ...jsonRepairMessages(raw, error)]` once, then throw `makeAiError('badOutput')`.
- `badOutput` is produced in core only; the Rust `ErrorCode` enum was not extended (hosts never emit it).
- `budgetDocument` takes `reserveTokens` for system prompt and slack; callers should pass the routed model's `contextTokens` (unknown means `DEFAULT_CONTEXT_TOKENS`) and `summaryMaxTokens`/`titleMaxTokens`/`propertiesMaxTokens` as `outputTokens`.
- `renderHeadingOutline` lives in `prompts/title.ts` and is imported by `properties.ts`.

Review Materials: `git -C /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a49f74c44a6778e98 show eb1d4bc`
