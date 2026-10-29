# T3 findings gap fill: worker summary

## Status

Completed. All seven findings fixed (F1, F2, F2b, F3, F4, F6, F7), each with tests except the pure CSS layout parts of F4 and F7, which were checked in Chrome through the harness.

## Work completed

- [x] **F1. Rich selection loses inline marks.** New `serializeRange(editor, doc, from, to)` in `ai-rewrite.ts` wraps a range inside one text block in a plain paragraph before serializing. Marks survive and no block syntax is added (a heading's `#` is not). Code blocks keep their text as before. Used for the passage and for the before/after context. The accept path already parsed inline markdown into the same paragraph, so it was left unchanged. Tests cover a link (the passage contains `[pilot notes](https://example.com/pilot-notes)`, and accepting it unchanged leaves the document byte-identical), bold/italic/inline code, a partial word (`**ol**`), two paragraphs, and Explain's passage. Four of the five failed before the fix. Commit `bf497e4`.
- [x] **F2. Reasoning headroom.** New pure helper `thinkingMaxTokens(answerTokens, level, { contextTokens, promptTokens })` in `ai/thinking.ts`, with `THINKING_HEADROOM_TOKENS` (off 0, low 1024, medium 2048, high 4096), `THINKING_DEFAULT_HEADROOM_TOKENS` (2048, used for model default) and `THINKING_MAX_TOKENS_CAP` (8192). The headroom is also capped at what is left of the context window (contextTokens − prompt estimate − 256), and the result is never below the answer budget. `runAiCompletion` applies it once for every feature, using the effective level `sent ?? configured`. It only applies to a routed kind with `thinkingChoices`. Tier-1 hosts and requests without `maxTokens` are unchanged. The `*MaxTokens` functions remain the answer budgets. Commit `3a08750`.
- [x] **F2b. Cut-off answers are never silent.** On `finishReason: 'length'`, the popover note (rewrite, explain, summary, titles) now reads "The answer was cut off at the length limit." It adds "Lower Thinking, or Retry, for a full answer." when the model was thinking. `/summary` keeps Insert. `finalizeSummary(raw, kind, coverage, cutOff)` drops a trailing fragment unless the text ends on punctuation, removes a list or quote marker left bare, and ends with `…`. So `#pl` is never inserted. In the Properties row, chips that parsed despite the cut show a `.properties-suggest-note` line. Commit `589ccd8`.
- [x] **F3. Misleading empty-answer error.** Empty text at the length limit now shows "No room left to answer". With thinking on it says "The model used its whole length budget thinking and sent no answer. Lower Thinking, or Retry."; otherwise it gives the copy without Thinking. This applies to rewrite, summary, titles and the Properties chips row. Titles and Properties skip the JSON repair round trip in that case. The copy lives in `aiLengthLimitCopy({ thinking, empty })` in `ai/errors.ts`. Commit `589ccd8`.
- [x] **F4. Truncated disabled menu labels.** In `styles/toolbar-dropdown.css`, an item with a hint now wraps, and the hint takes its own line under the label (`.tdd-item:has(> .tdd-item-hint)`). `toolbar-dropdown.ts` and the registry files are untouched. Rewrite selection now uses the router's reason (`availability.reason`), the same as Summarize and Suggest titles. Test: all three hints are identical. In Chrome all labels were whole and the hints showed in full (items 44px tall). Commit `0939c13`.
- [x] **F6. Stale chips after AI off.** `syncAiPropertiesAvailability` in `editor.ts` aborts the run and clears the chips row when availability leaves `enabled` (to `hidden` or `disabled`). Test covers shown chips and a run in flight. It failed before the fix. Commit `998d581`.
- [x] **F7. Popover header overflow.** `.ai-rw-title` now uses `flex: 0 1000 auto; min-width: 6em`, so it shrinks first and ellipsizes, with the full text as its tooltip. `.ai-rw-badge` uses `flex: 0 1 auto; max-width: 45%` and ellipsizes its text. Spark, dial and Close do not shrink. In Chrome, "Translate · Spanish · Whole document" with High thinking now fits inside the head (title 83–161, dial 169–366, badge 374–449, Close 457–481, head ends at 487). Commit `37430d0`.

## Files modified

- `packages/core/src/ai-rewrite.ts`
- `packages/core/src/ai-request.ts` (new export `aiRunThinkingOn`)
- `packages/core/src/ai/thinking.ts`
- `packages/core/src/ai/errors.ts`
- `packages/core/src/ai/prompts/summary.ts`
- `packages/core/src/editor.ts`
- `packages/core/src/outlineSidebar.ts`
- `packages/core/src/styles/ai-rewrite.css`, `outline-sidebar.css`, `toolbar-dropdown.css`
- Tests: `packages/core/test/ai-rewrite.test.ts`, `ai-thinking-dial.test.ts`, `ai-summary-title.test.ts`, `outlineSidebar-suggest.test.ts`, new `ai-length-limit.test.ts`

## Test status

- `npm run lint`: 0 errors (1213 warnings, unchanged in the files touched).
- `npx tsc --noEmit -p tsconfig.json` and `-p tsconfig.webview.json`: both clean.
- `npm run build:core`: OK.
- `npm run test:unit`: 160 files, 2793 passed, 2 todo.
- `npm run test:edge`: 3 files, 22 passed.
- `npm run test:packages`: 5 files, 79 passed. Web-component standalone is 866.7 kB gzipped (887,545 bytes), under the 900 kB budget.

## Issues or blockers

None. Notes:

- F4 uses CSS `:has()`, which all target webviews support (Chromium, WebKit 15.4+).
- In F2b the summary fragment drop is a heuristic. If the cut lands exactly after a whole word without punctuation, that word is dropped too.

## Notes for orchestrator

- New exports from `@mikedown/core/ai`:
  - `thinkingMaxTokens`, `THINKING_HEADROOM_TOKENS`, `THINKING_DEFAULT_HEADROOM_TOKENS`, `THINKING_MAX_TOKENS_CAP`, `ThinkingBudgetOptions`
  - `aiLengthLimitCopy`
  - `finalizeSummary` gains a 4th parameter `cutOff`
- New export from `ai-request.ts`: `aiRunThinkingOn(thinking)`.
- Requests now carry larger `maxTokens` when a routed model can think. Host logs will show for example 256 + 2048 for a rewrite at model default.
- No host, protocol, settings or `types.ts` changes.
- The harness `packages/core/demo/ai-handson/` was used for the F4/F7 checks and left untracked and unedited. Its Vite server (PID 32410) was killed by PID and the Chrome tab closed.

## Commits

`bf497e4` (F1), `3a08750` (F2), `589ccd8` (F2b, F3), `0939c13` (F4), `998d581` (F6), `37430d0` (F7).

## Start / End

Start 21:56, End 22:10 (2026-10-28, local).

## Review Materials

- Tests: `/Users/michaeljosephwork/git/mikedown/packages/core/test/ai-length-limit.test.ts`. Also the "rich selection keeps inline marks (T3 F1)" block in `/Users/michaeljosephwork/git/mikedown/packages/core/test/ai-rewrite.test.ts` and "reasoning headroom (T3 F2)" in `/Users/michaeljosephwork/git/mikedown/packages/core/test/ai-thinking-dial.test.ts`.
- By hand: the harness rerun steps in `processed/worker-summary-t3-automated.md`. Run `npm run build -w packages/core` first.
