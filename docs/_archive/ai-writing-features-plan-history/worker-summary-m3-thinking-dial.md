# Worker summary: M3 Thinking dial per request

**Status:** Completed (commit `da0789d`)

**Start:** 20:52 **End:** 21:02

## Work completed

- [x] Extra item: `simpler` moved from `length` to `tone` in `ai/prompts/rewrite.ts`. The `AI_REWRITE_VARIANTS` order already matched D1 (Shorter, Longer, Expand | Simpler, Fix flow, Formal, Casual). `ai-rewrite-ui.test.ts` now pins both groups, and the Length row count went from 4 to 3.
- [x] `ai/types.ts`: added `AiCompletionRequest.requestOverrides?: Record<string, unknown>`. It is documented in the protocol comment in `src/webview/editor-main.ts` (the `aiComplete` entry).
- [x] `ai-request.ts`: added `AiRunRequest.thinking?: AiThinkingLevel | null | ((kind) => AiThinkingLevel | null)`. A function is asked once the route's kind is known, so the session level per kind also follows a fallback. The overrides are sent only for a routed (tier-2) engine whose kind has choices. `onRoute(route, thinking)` and `AiRunOutcome.thinking` report `AiRunThinking { kind, configured, sent }`.
- [x] VS Code: the merge lives in core's shared `buildCompletionBody` (`ai/requests.ts`), which every adapter in `src/ai/providers/*` already calls. The order is the body, then the model's overrides, then the request's. A non-object value is ignored. `test/unit/ai-protocol.test.ts` runs end to end (VsCodeHost → bridge → real `AiEngineService` → real adapters → fake fetch) for every case in the shared fixture.
- [x] Desktop: `CompletionRequest.request_overrides: Option<Value>` (`commands/ai/model.rs`) is merged in `build_completion_body` (`requests.rs`). `ai.rs` documents it. `aiHost.ts` already passed it through via `toWireCompletionRequest`; it now has a doc line and a test. Cargo tests: a fixture test over all cases, a test that ignores non-object values, and a command-layer `ai_complete` test.
- [x] Website stub: `complete` ignores everything in the request. There is a doc comment and a test.
- [x] Popover: a `.ai-rw-think` segmented pill before the badge, 20px tall like the badge (badge line-height pinned to 16px). It shows when `thinkingChoices(kind)` is non-empty and a route is known. The pressed segment is `sent ?? configured` (`thinkingLevelFrom` of the model's overrides). A change re-runs like Retry and is stored with `rememberSessionThinking` in `ai-prefs.ts` (a memory `Map`, not `localStorage`). Once served, the badge title ends with "Thinking: low.".
- [x] lint (0 errors), test:unit, cargo test: all green.

## Files modified

`packages/core/src/{ai/types.ts, ai/requests.ts, ai/prompts/rewrite.ts, ai-request.ts, ai-rewrite.ts, ai-prefs.ts, styles/ai-rewrite.css}`, `packages/core/test/{ai-thinking-dial.test.ts (new), ai-rewrite.test.ts, ai-rewrite-ui.test.ts}`, `src/webview/editor-main.ts` (comment), `test/unit/ai-protocol.test.ts`, `test/ai-fixtures/requests/thinking-overrides.json` (new) + `README.md`, `packages/desktop/src-tauri/src/commands/{ai.rs, ai/model.rs, ai/requests.rs, ai/tests.rs, ai/tests/command_layer.rs}`, `packages/desktop/src/host/aiHost.ts`, `packages/desktop/test/unit/aiHost.test.ts`, `website/developers/common/stub-ai.ts`, `website/test/stub-ai.test.ts`. `editor.ts` is unchanged.

## Test status

- `npm run build:core`: ok
- `npm run lint`: 0 errors (1206 warnings, all from before this change)
- `npm run test:unit`: 150 files, 2549 passed, 2 todo
- `cargo test` (desktop): 188 + 26 + 7 passed, 0 failed
- `packages/desktop` `vitest run test/unit/aiHost.test.ts`: 16 passed
- `website` `vitest run test/stub-ai.test.ts`: 7 passed
- Both root tsconfigs `tsc --noEmit`: clean

## Issues / deviations

- **A merge cannot delete.** Example: the model is set to Off on a local engine (`chat_template_kwargs.enable_thinking: false`) and the request asks for Low. A plain deep merge would leave thinking off. `thinkingRequestOverrides` (exported from `ai-request.ts`) therefore sends the neutral value for any thinking field the model sets that the level leaves out: `enable_thinking: true` or `reasoning_effort: "none"`. The body still contains `thinkingOverrides(kind, level)` as a subset, and both hosts assert that. Anthropic `thinking.budget_tokens` set by hand in a model's overrides would survive the merge. The settings dial never writes that field, so it is left alone.
- The VS Code merge is in core's `buildCompletionBody`, not in `engineService.ts`. That function is the single body builder all adapters use, and it mirrors the Rust `build_completion_body`.
- The only kinds without a mapping are unknown ones, which are never routed. The "no mapping" popover test is therefore the unavailable path.
- The website demo stub is tier 2 with an `openai-compatible` engine, so **the dial does show on the demo pages**. Changing the level re-streams the same canned text.
- The dial has not been checked visually in a running editor (jsdom tests only).

## Notes for orchestrator

- New exports: `thinkingRequestOverrides` and `AiRunThinking` (`ai-request.ts`); `sessionThinkingLevel`, `rememberSessionThinking` and `clearSessionThinking` (`ai-prefs.ts`).
- `AiRunEvents.onRoute` now has a second argument, and `AiRunOutcome` has a `thinking` field. Later callers of `runAiCompletion` can pass `thinking` the same way (e.g. `thinking: sessionThinkingLevel`).
- New shared fixture: `test/ai-fixtures/requests/thinking-overrides.json`.

## Review Materials

Open the rewrite popover on a tier-2 host (VS Code or Desktop with oMLX, or `npm run dev:site` → developers demo) and pick a variant. The dial appears left of the engine badge. Tests: `/Users/michaeljosephwork/git/mikedown/packages/core/test/ai-thinking-dial.test.ts`, `/Users/michaeljosephwork/git/mikedown/test/unit/ai-protocol.test.ts` (last describe).
