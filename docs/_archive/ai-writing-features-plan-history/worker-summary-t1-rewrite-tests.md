# Worker summary: T1 Rewrite family and thinking dial tests

**Status:** Completed (one unrelated red test in `test:packages`, see Issues)

- Worktree: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-ab61f5f8b88388be8`
- Branch: `worktree-agent-ab61f5f8b88388be8`
- Commit: `cc6ce3e4fa5c61eb7e85b458b03dd2e111fb486b` (on top of develop `da0789d`)
- Start 21:01, end 21:07

## Work completed (per checkbox)

- **ai-rewrite-variants.test.ts** (new, 22 tests): every variant builds a system/user pair (`it.each` over all 11); distinct instructions; custom quoted and capped; `translate` and `readingLevel` render the parameter (all five audiences, trimmed/flattened/capped language, `$&` literal); missing, blank or unknown parameter falls back to fix flow; `rewriteMaxTokens` stays within 256..4096 for every variant and length, grows with length, expanding variants get more room, explain fixed at 600; explain messages carry no "rewrite" ask (only the prohibition).
- **ai-structure-check.test.ts** (new, 18 tests): identical pair (also CRLF and prose-only change), dropped link (names URL), dropped fence (and unclosed fence counts as one), table row lost, heading level change (both sides reported), heading to bold, list markers, wikilinks and footnotes counted and flagged, autolinks/reference definitions/images, URL list capped at three, inline code and fenced content hidden from other counters.
- **ai-rewrite.test.ts** (extended, +6 tests in "rewrite family flows"): choose phase renders all groups and every variant label with the custom input last; language picker remembers in a mocked `localStorage` (key `mikedown.ai.recentLanguages`) and preselects in the next popover; Explain footer has Insert below and no Accept, Insert below adds exactly one blockquote and one undo removes it; whole-document translate keeps frontmatter and one undo restores; structure warning appears for a dropped link (text and `title`, Accept stays enabled); no warning when links survive. M2's `ai-rewrite-ui.test.ts` already covered the same ground in more depth (source mode, pickers, Other...), left untouched.
- **test/unit/ai-protocol.test.ts**: request-over-model merge order was already covered by the fixture `it.each` (M3). Added, per fixture case, "thinking absent leaves the body unchanged": body with no `requestOverrides` equals the one with `{}`, and none of the request's thinking keys appear unless the model set them.
- **Desktop** (`packages/desktop/src-tauri/src/commands/ai/tests.rs`): added `a_request_without_overrides_leaves_the_body_as_the_model_made_it` (absent and empty overrides equal the model-only body for openai-compatible and anthropic; bare model has no thinking fields). The fixture-driven merge test already existed.
- **test/live/ai-live.test.ts**: added `translate (to Spanish)` (40 tokens, thinking off through `thinkingOverrides`, asserts `(https://example.com/setup)` survives) and `explain` (40 tokens, non-empty prose) per target. Opt-in via `MIKEDOWN_AI_LIVE=1` as before.

## Live run (`MIKEDOWN_AI_LIVE=1 npm run test:ai-live`)

oMLX, model `Qwen3.8-Flash-Next-Uncensored-oQ4e-mtp`: **pass** (10 passed, 10 skipped: LM Studio has no chat model loaded, Ollama unreachable).
- translate: 777 ms, `"Lee la [guía de configuración](https://example.com/setup) primero.\nLuego ejecuta el instalador."` (good translation, link kept)
- explain: 822 ms, sensible prose explanation.

## Files modified

- `packages/core/test/ai-rewrite-variants.test.ts` (new)
- `packages/core/test/ai-structure-check.test.ts` (new)
- `packages/core/test/ai-rewrite.test.ts`
- `test/unit/ai-protocol.test.ts`
- `test/live/ai-live.test.ts`
- `packages/desktop/src-tauri/src/commands/ai/tests.rs`

## Test status

- `npm run test:unit`: 152 files, 2605 passed, 2 todo, 0 failed.
- `npm run test:edge`: 22 passed.
- `cargo test --lib commands::ai`: 69 passed.
- `npm run test:packages`: 78 passed, **1 failed** (`test/packages/web-component-shape.test.ts`, "stays under the 850 kB gzipped budget": 874099 B vs 870400 B budget). Not caused by this milestone (test-only changes); the standalone web component bundle grew past the budget with the M1 to M3 source work.

## Issues / notes for orchestrator

- **Budget failure:** the web-component standalone bundle is 3.7 KB gzipped over its 850 kB budget at `da0789d`. Needs either a trimmed bundle or a raised budget in `test/packages/web-component-shape.test.ts` (not in my ownership, left alone). Re-check after M4/M5 merge, it will only grow.
- **Design limit, not a bug:** `checkMarkdownStructure` compares list item counts only, not markers; `- a` to `* a` or to `1. a` is not flagged although the rewrite prompt asks to keep markers. Pinned in `ai-structure-check.test.ts` ("list markers") so a future change is deliberate. Heading level changes and table row loss are flagged.
- No source bugs found; no `it.todo`/`it.fails` added.
- No new exports. Merge note: M5 edits `ai-rewrite.ts`; my `ai-rewrite.test.ts` additions are appended at the end of the file and use only `mountWithAi`, `popover`, `clickButton`, `settle` already in that file.

Review Materials: `git -C /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-ab61f5f8b88388be8 show cc6ce3e`
