# Ghost Text Plan

Inline AI suggestions in the WYSIWYG editor: pause while writing and a dim continuation appears after the caret. Tab accepts it, Escape dismisses it, typing dismisses or narrows it. Off by default as the existing `ghostText` feature (separate opt-in on top of the AI master switch). Built once in `@mikedown/core` so the VS Code extension and MikeDown Desktop get it with no host work beyond a JSON schema touch.

**Objectives**

- Render suggestions as a ProseMirror widget decoration, never a DOM write outside a transaction.
- One in-flight request per editor, cancelled on every keystroke, debounced on idle.
- Local engines by default; a cloud engine only after an explicit per-feature consent.
- Ship through the existing AI layer: `runAiCompletion`, the router, the feature toggle, the lazy AI chunk.

**Critical success factors**: first token under about 600 ms on Mike's local engines, zero selection clobbering, Tab still works in lists and tables, no request leaves the machine without consent.

Defaults applied: incremental testing, vitest unit tests, hands-on for interactive behavior, no Playwright, no screenshots. Not a LymeStack app.

## Milestone Progress Tracker

| Milestone | Model | Status | Duration (min) | Notes |
|---|---|---|---|---|
| M1 Core: prompt, trimming, settings | Sonnet | ✅ Done | 15 | f8daa9a |
| M2 Core: ghost controller | Sonnet | ✅ Done | 4 | 022937d |
| M3 Tests: core | Sonnet | ✅ Done | 7 | 2ae3bea; 121 tests |
| M4 UI: decoration plugin, keys, status | Opus | ✅ Done | 23 | 25a79dc, 20a557b |
| M5 UI: settings, consent, activity | Opus | ✅ Done | 10 | 0c5df42; gap fill for D3 and the local-only fence |
| M6 Tests: UI | Sonnet | ✅ Done | 13 | 2160d7c; 77 tests |
| M7 Hands-on walk (both hosts) | Opus | ⏸ Waiting for Mike | — | Mike signs off |

## Table of Contents

- [Design](#design)
- [M1 Core: prompt, trimming, settings](#m1-core-prompt-trimming-settings)
- [M2 Core: ghost controller](#m2-core-ghost-controller)
- [M3 Tests: core](#m3-tests-core)
- [M4 UI: decoration plugin, keys, status](#m4-ui-decoration-plugin-keys-status)
- [M5 UI: settings, consent, activity](#m5-ui-settings-consent-activity)
- [M6 Tests: UI](#m6-tests-ui)
- [M7 Hands-on walk](#m7-hands-on-walk)
- [Parallel Development Recommendations](#parallel-development-recommendations)
- [Gap-Filling Prompts](#gap-filling-prompts)
- [Progress Log / Notes](#progress-log--notes)

## Design

What exists already: the feature entry `ghostText` (`packages/core/src/ai/features.ts:37-46`, `defaultEnabled: false`, `status: 'planned'`, task `continue`) and the task (`packages/core/src/ai/tasks.ts:41-47`, `requires: { stream: true }`, `requiresAny: ['fim', 'chat']`). The router checks `requiresAny` through `missingCapabilities` (`tasks.ts:138`, `router.ts:249-251`); a model with neither flag is rejected with code `capability`, and `routing.fallback` (`router.ts:158-202`, default `anyLocal`) then scans local engines in registry order. Nothing today sends a FIM request: `buildCompletionBody` (`packages/core/src/ai/requests.ts:190`) only builds Chat Completions / Messages bodies and has no `suffix` or `stop` field, and the hosts' providers only call `/chat/completions`.

| Decision | Recommendation |
|---|---|
| D1 Trigger | Idle delay after a text-changing keystroke (`delayMs`, default 400). Fires anywhere inside a paragraph, heading, list item or blockquote, but only when the caret is at the end of its text block (or followed by whitespace only) and the selection is empty. Never inside code blocks, tables, frontmatter, or while the emoji, wikilink or link autocomplete popup is open. Manual trigger too: `Mod-Alt-Space` (unless `hostOwnsShortcuts`) and `trigger: 'manual'` turns the idle trigger off. |
| D2 Debounce and cancel | One `AbortController` per editor. Any document change or selection move aborts the in-flight request, clears the widget and restarts the idle timer. The same timer is reused; no queue. |
| D3 Context | Text before the caret from the top of the document, cut with `budgetDocument` (`packages/core/src/ai/documentBudget.ts:133`) to the route's `contextTokens`, then the last `GHOST_BEFORE_CHARS` (2400) kept verbatim and the earlier sections summarised by `headingsOutline` (`documentBudget.ts:90`). Text after the caret: the next 600 chars, sent as a suffix so the model stops where the existing text resumes. Markdown is taken from the editor's serializer, the same source `richDocumentTarget` uses (`ai-rewrite.ts:405`). |
| D4 FIM vs chat | v1 sends a chat "continue" prompt to every model: a system prompt, the prefix as the user turn (with the suffix in a `<after>` tag), and the instruction to output only the continuation. The `fim` flag stays a router preference only, because the wire has no FIM path (`requests.ts:190`, no `suffix`). A true `/completions` FIM request is deferred to a later plan since it needs provider work in `src/ai/providers/` and `packages/desktop/src-tauri/src/ai/`. |
| D5 Stopping | `maxTokens` 48 by default (`features.ghostText.maxTokens`). Client side, the controller truncates at the first blank line, and at the first newline when the caret is not at the end of a block. A suggestion is also cut at the end of the first sentence past 120 chars. Trailing whitespace is dropped; a suggestion that is empty or starts by repeating the last 20 chars before the caret is discarded. |
| D6 Accept | Tab inserts the whole suggestion as one `tr.insertText` with `closeHistory` before it, so one Undo removes exactly the accepted text (`editor.ts:15` already imports `closeHistory`). `Mod-ArrowRight` accepts one word (up to and including the next space). Typing a character that matches the suggestion's next character keeps the rest; any other character dismisses. |
| D7 Tab conflicts | The ghost plugin's `handleKeyDown` is registered ahead of the editor's own (`editor.ts:4171`) and only claims Tab when a suggestion is visible. Lists (`editor.ts:4259-4300`) and tables (`editor.ts:4215`) keep their Tab when no suggestion shows; a suggestion never shows inside a table. Emoji (`emojiautocomplete.ts:229`) and link autocompletes (`linkautocomplete.ts:131`) win because D1 suppresses ghost text while they are open. |
| D8 Source mode | Out of scope for v1. The controller is surface-agnostic (prefix, suffix, callbacks) so a CodeMirror 6 widget twin can follow later. |
| D9 Cloud consent | Ghost text routes through `runAiCompletion` (`ai-request.ts:245`), so a cloud route would hit `requestCloudConsent` on the first request and be remembered for the session like Rewrite. That is not enough for a feature that fires on every pause: the plan adds `localOnly` to the feature (default true), which the controller passes as `resolveRoute` option `localOnly` so cloud candidates are rejected with `cloudBlocked`. With `localOnly` off, the first ghost request still asks once (existing flow, `ai-request.ts:263-275`); the consent dialog's `whatIsSent` line uses `sends: 'selection'` ("the text around the cursor", `privacy.ts:53-67`). |
| D10 AI Activity | Record only accepted or errored suggestions. The recorder (`ai-activity.ts`, limit 50 at line 23) would otherwise be flooded by dismissed ghosts. The controller passes `activity: undefined` in its `AiRunContext` and records one entry itself on accept (prompt, response, route) and on error, through the editor's `aiActivityLog`. |
| D11 Status | The toolbar AI button's busy state (`syncAiToolbarBusy`, `editor.ts:2649`) pulses while a ghost request is streaming, and the footer chip (`renderAiIndicator`, `editor.ts:2603`) shows what served the last accepted suggestion via `onServed`. No new chip. |
| D12 Settings | Knobs live inside `mikedown.ai.features.ghostText`: `enabled`, `task`, `delayMs`, `maxTokens`, `trigger`, `localOnly`. `parseFeatures` keeps unknown keys (`schema.ts:289`), so the parser only needs typed accessors. Three places: `package.json` (extend the `additionalProperties.properties` at line 965), `src/settings.ts` (nothing new: `features` passes through at line 210), the Settings modal AI tab (`ai-settings.ts:294-330`). Desktop's `ai.features` is an open object (`packages/desktop/src/settings/schema.ts:36`), so no Desktop change. |
| D13 Lazy chunk | The controller, prompt and plugin live in a new `packages/core/src/ai-ghost.ts` exported from `ai-ui.ts`; `editor.ts` reaches it through `whenAiUi` (`editor.ts:2328`) and installs the plugin with `editor.registerPlugin` once the chunk is loaded. `packages/core/test/ai-lazy-load.test.ts` keeps guarding that nothing AI loads without `host.ai`. |

[Return to Top](#ghost-text-plan)

## M1 Core: prompt, trimming, settings

**Model: Sonnet.** Pure modules, no DOM. Workers must complete every item; note anything they think should be deferred in the summary instead of skipping it.

- [x] `packages/core/src/ai/prompts/continue.ts`: `CONTINUE_SYSTEM_PROMPT`, `buildContinueMessages({ before, after, blockKind })` returning `AiMessage[]`, `continueMaxTokens(setting)`. The prompt forbids preamble, quotes and markdown fences, and says to stop where `<after>` resumes.
- [x] `packages/core/src/ai/ghostContext.ts`: `ghostContext(markdown, caretOffset, contextTokens)` returning `{ before, after }` per D3, using `budgetDocument` and `headingsOutline`.
- [x] `packages/core/src/ai/ghostTrim.ts`: `trimGhostSuggestion(raw, { atBlockEnd, before })` per D5, plus `ghostAcceptWord(text)` and `ghostPrefixMatch(text, typed)` for D6.
- [x] `packages/core/src/ai/features.ts`: `ghostText` becomes `status: 'available'`, `sends: 'selection'`, keeps `defaultEnabled: false`.
- [x] `packages/core/src/ai/types.ts` and `schema.ts`: `AiGhostTextOptions` (`delayMs`, `maxTokens`, `trigger`, `localOnly`) with a `ghostTextOptions(features)` reader that applies defaults (400, 48, `'auto'`, true) and clamps ranges; `parseFeatures` validates those keys when present and warns on bad types.
- [x] `packages/core/src/ai/router.ts`: `ResolveRouteOptions.localOnly`; a cloud candidate is rejected with `cloudBlocked` and reason "Inline suggestions use local engines only." when set. `runAiCompletion` forwards `req.localOnly`.
- [x] Export the new modules from `packages/core/src/ai/index.ts`; keep the package shape test green (`npm run test:packages`).
- [x] Commit.

[Return to Top](#ghost-text-plan)

## M2 Core: ghost controller

**Model: Sonnet.** Surface-agnostic state machine in `packages/core/src/ai-ghost.ts` (lazy chunk, D13). Workers must complete every item.

- [x] `createGhostController(deps)` with deps: `run` (same shape as the rewrite popover's `run`, `editor.ts:4418`), `options()` returning `AiGhostTextOptions`, `contextTokens()`, `onSuggestion(text | null)`, `onBusy(bool)`, `onServed`, `onError`, `record(entry)` for D10.
- [x] Inputs: `noteChange({ markdown, caretOffset, atBlockEnd, eligible })`, `noteSelectionMove()`, `triggerNow()`, `accept()`, `acceptWord()`, `dismiss()`, `typed(char)`, `destroy()`.
- [x] Idle timer per D1 and D2; abort on every change; `trigger: 'manual'` disables the timer.
- [x] Streaming: tokens accumulate and `onSuggestion` is called with the trimmed text after each token; the request aborts itself once a stop rule fires (D5) so the model does not keep generating.
- [x] Request shape: `{ feature: 'ghostText', task: 'continue', sends: 'selection', messages, maxTokens, temperature: 0.3, thinking: 'off', job: 'ghostText', localOnly }`; `job: 'ghostText'` added to `AiThinkingJob` with default level off (`packages/core/src/ai/thinking.ts`).
- [x] Errors: `cloudBlocked`, `capability`, `featureDisabled` are silent (no toast, suggestion cleared) but surface once per session through `onError` so the toolbar menu can show a reason; network errors back off (double the delay up to 5 s, reset on success).
- [x] Commit.

[Return to Top](#ghost-text-plan)

## M3 Tests: core

**Model: Sonnet.** Mode: unit (vitest, `packages/core/test/`). Run with `npx vitest run packages/core/test/ai-ghost*.test.ts`.

- [x] `ai-ghost-prompt.test.ts`: messages carry before and after, no fence, max tokens from the setting.
- [x] `ai-ghost-context.test.ts`: long document is cut by budget, last 2400 chars kept verbatim, suffix capped, caret in frontmatter yields nothing.
- [x] `ai-ghost-trim.test.ts`: blank-line stop, newline stop mid-block, sentence cut past 120 chars, repeated-prefix discard, word accept, prefix match and mismatch.
- [x] `ai-ghost-settings.test.ts`: defaults, clamping, bad types warned and dropped, `serializeAiSettings` round-trips the knobs.
- [x] `ai-ghost-router.test.ts`: `localOnly` rejects a cloud route with `cloudBlocked`; a model with neither `fim` nor `chat` is rejected; `fim` preferred among local candidates.
- [x] `ai-ghost-controller.test.ts` with fake timers and a fake `run`: idle fires once after 400 ms, keystroke aborts and restarts, manual mode never auto-fires, stop rule aborts the stream, backoff on error, accept records one activity entry and dismiss records none.
- [x] All green, `npm run lint` clean, commit.

[Return to Top](#ghost-text-plan)

## M4 UI: decoration plugin, keys, status

**Model: Opus.** Interaction design in the live editor. Follow the ProseMirror rule: the widget is plugin state, never a DOM write (`spellcheck.ts:47-383` and `findreplace.ts:83-110` are the patterns). Workers must complete every item.

- [x] `packages/core/src/ai-ghost-plugin.ts`: a PM `Plugin` with `PluginKey('aiGhost')`, state `{ text, pos }`, `Decoration.widget(pos, span, { side: 1 })` rendering `<span class="mikedown-ghost">`; a `setMeta` transaction updates or clears it; any doc change that is not an accept clears it.
- [x] Eligibility probe in the plugin's `view.update`: caret at block end, block type allowed, no autocomplete open (check the emoji and wikilink plugin states), selection empty; feeds `controller.noteChange` with the serialized markdown and caret offset (map PM position to markdown offset the way `cursorInsertTarget` does, `ai-rewrite.ts:494`).
- [x] Keys in the plugin's `handleKeyDown`, only while a suggestion shows: Tab accept, `Mod-ArrowRight` accept word, Escape dismiss, printable character runs `typed(char)`. Return false otherwise so lists and tables keep Tab (D7).
- [x] Accept inserts with `closeHistory(tr)` first, then `insertText`, as one transaction (D6).
- [x] Manual trigger `Mod-Alt-Space` through a small TipTap `Extension` like `mikedownAiRewriteShortcut` (`editor.ts:4040`), skipped when `hostOwnsShortcuts`.
- [x] `editor.ts`: under `whenAiUi`, build the controller with `aiRunContext` (activity set to undefined per D10), register the plugin, wire `onBusy` to `syncAiToolbarBusy` and `onServed` to `aiServed` (D11); tear down in `disposers`; rebuild options on every settings broadcast; stop everything in source mode.
- [x] Styling in `packages/core/src/styles/editor.css`: ghost text in the editor font at 55 percent opacity, no layout shift, a 120 ms fade in, respects `prefers-reduced-motion`. It should read like Xcode or VS Code inline completions, quiet and clearly not part of the document.
- [x] AI toolbar menu entry "Suggest continuation" (`ai-toolbar.ts`) that calls `triggerNow`, hidden when the feature is off.
- [x] Commit.

[Return to Top](#ghost-text-plan)

## M5 UI: settings, consent, activity

**Model: Opus.** Settings modal rows and consent copy. Workers must complete every item.

- [x] `ai-settings.ts`: when `ghostText` is on, a disclosure under its row with Delay (ms), Max tokens, Trigger (Automatic / Manual shortcut), and "Local engines only" switch; saved into `features.ghostText` via the existing draft patch (`ai-settings.ts:322`).
- [x] The feature description reads "Dim continuation text while you write. Sends the text around the cursor as you pause." and the row shows a privacy line from `privacyLine` (`ai-settings-dom.ts`) when "Local engines only" is off.
- [x] `package.json#contributes.configuration` line 965: add `delayMs`, `maxTokens`, `trigger`, `localOnly` to the per-feature schema with descriptions. `src/settings.ts` needs no change (verify); Desktop `schema.ts` needs no change (verify).
- [x] Consent: with `localOnly` off, the first ghost request goes through `requestCloudConsent` as any feature does; confirm the dialog text names Inline suggestions and the cursor-window scope (`aiConsentText`, `privacy.ts:140`). A "Don't allow" answer silences ghost text for the session (D9).
- [x] AI Activity: accepted suggestions appear in the panel as feature "Inline suggestions" with the prompt and the accepted text; add the label to `ai-activity-panel.ts` where Explain and Translate are named (commit c974b24).
- [x] README (features list and the AI section), CHANGELOG under Unreleased, and the Desktop release notes file the AI Activity work used.
- [x] Commit.

[Return to Top](#ghost-text-plan)

## M6 Tests: UI

**Model: Sonnet.** Mode: unit (vitest jsdom, `packages/core/test/`), following `ai-activity-panel.test.ts` and `ai-lazy-load.test.ts` for editor setup.

- [x] `ai-ghost-plugin.test.ts`: widget appears after the caret from a `setMeta` transaction; a doc change clears it; Tab inserts the text and one undo removes exactly it; `Mod-ArrowRight` inserts one word; Escape clears; Tab inside a list with no suggestion still indents; no suggestion inside a table or code block.
- [x] `ai-ghost-editor.test.ts`: feature off means no plugin, no request; feature on with a fake `host.ai` fires one request after the idle delay and streams into the widget; a keystroke aborts (signal observed aborted); emoji autocomplete open suppresses the trigger; source mode toggle clears and stops.
- [x] `ai-lazy-load.test.ts`: add a case that `ai-ghost` is not in the main path (no ghost module loaded without `host.ai`).
- [x] `ai-ghost-settings-ui.test.ts`: disclosure renders with the saved values, edits land in the draft, saved settings echo back.
- [x] `npm run test:unit`, `npm run test:edge`, `npm run lint` green; commit.

[Return to Top](#ghost-text-plan)

## M7 Hands-on walk

**Model: Opus** (drives the setup, Mike signs off). Mode: hands-on in both hosts. The orchestrator pauses for Mike's sign-off.

VS Code: from the repo root on `develop` run `npm run dev`; it opens `test/workspace`. Desktop: quit the installed MikeDown Desktop, then `npm run dev` in `packages/desktop`. In each host open the Settings modal (toolbar gear, AI tab), turn on Inline suggestions, and route `continue` to oMLX at `http://127.0.0.1:8000/v1` (then repeat with LM Studio on port 1234). Never print keys.

- [ ] Type a sentence, pause: dim text appears within about a second; the toolbar AI button pulses while it streams.
- [ ] Tab accepts; Cmd+Z removes exactly the accepted text; the footer chip names the engine.
- [ ] Cmd+Right accepts one word at a time; Escape clears; typing the suggested next letter keeps the rest, a different letter clears.
- [ ] Tab in a list indents and Tab in a table moves cells when nothing is suggested; no ghost text appears inside a table or code block.
- [ ] Type `:smi` and confirm the emoji popup owns Tab; same with `[[`.
- [ ] Trigger set to Manual: nothing fires on idle; Cmd+Alt+Space fires once (macOS may keep this chord for Finder search; the AI menu's Suggest continuation is the fallback).
- [ ] Local engines only on, with a cloud engine enabled and routed to `continue`: no request leaves, the AI menu shows the reason. Switch it off: one consent dialog, then suggestions flow with "Allow"; "Allow once" gives one suggestion, then only the shortcut asks; "Don't allow" silences the feature for the session unless a local engine can serve as the fallback, in which case suggestions continue locally.
- [ ] AI Activity panel on: only accepted suggestions are listed.
- [ ] Toggle source mode (Cmd+/): no ghost text, no requests; back to rich mode resumes.
- [ ] Both engines tried in both hosts; Mike signs off, and the walk is logged in the Progress Log.

[Return to Top](#ghost-text-plan)

## Parallel Development Recommendations

- **Group A** (after M1): M2 and the plugin half of M4 can run in parallel; M4's `editor.ts` wiring waits for M2.
- **Group B** (after M3): M5 runs beside the rest of M4; both touch `editor.ts` only in separate regions, so coordinate commits.
- **Sequential blockers**: M1 before everything; M3 before M4 wiring; M6 before M7.
- If dispatching prompts fills the orchestrator context, run `/compact` while workers run and resume from `.orchestrator/state.json`.

[Return to Top](#ghost-text-plan)

## Gap-Filling Prompts

Gap-filling prompts follow the original milestone prompt structure (header, mission, planning doc reference), state what the first attempt already completed and which files it touched, list other active workers and their directories, and end with the standard completion steps: commit, write `.orchestrator/worker-summary-[milestone-slug]-gap.md`, prompt to clear the context. Label them "Worker Context: [Milestone] - Gap Fill".

[Return to Top](#ghost-text-plan)

## Progress Log / Notes

**2026-11-05 16:05** - Plan written after reading the feature and task registries, `runAiCompletion`, the router, the activity recorder, the rewrite flow, the settings parser and the decoration plugins. Key finding: no FIM wire path exists, so v1 is chat-continue for every model (D4).

**2026-11-05 18:36** - M1 done (f8daa9a). Continue prompt, caret context, trimming, ghostText settings, router localOnly. Beyond the listed files: `consent.rs` and the consent fixture gained ghostText, and the toggles test now filters on defaultEnabled. Unit tests unchanged at 4256 passed.

**2026-11-05 18:36** - Two orchestration refinements of the M2 inputs, neither changing D1 to D13: \`noteChange\` takes a lazy \`read()\` for the markdown and caret offset so the document is serialized when a request is about to fire, not on every keystroke; and a selection move aborts and clears without starting a timer, because D1 triggers only on text changes and a move has no fresh snapshot. M4 is split into a plugin half (M4a, beside M2) and a wiring half (M4b, after M3).

**2026-11-05 18:40** - M2 done (022937d). Controller in `ai-ghost.ts`, `ghostText` default-off in `thinking.ts`. `triggerNow` gained an optional fresh input. `classifyGhostError` reads router sentences because `routeUnusableError` keeps only some codes, so M3 pins it against the real router messages. M3 also corrects the activity entry to hold the shown suggestion rather than the raw stream.

**2026-11-05 18:45** - M3 done (2ae3bea), 121 tests. Discrepancy with D4: the `continue` task has no `prefers`, so `fim` is not a router preference; the chosen route wins, then registry order. Left as is and the test pins it, since with no FIM wire a preference could pick a fim-only model that cannot take the chat prompt. A fim-only model passes `requiresAny` today and would still get a chat request. To raise with Mike at M7.

**2026-11-05 18:47** - M4a done (25a79dc): the plugin half of M4. Refinements of D7 and D6: keys use \`handleDOMEvents.keydown\`, because \`editorProps.handleKeyDown\` always runs before any plugin's whatever the order; a suggestion stops at a single newline, since inserting it would break the paragraph. Also added: blur and IME composition dismiss, inline code and empty blocks are ineligible on idle, undo, paste and host updates never trigger. M4b does the wiring.

**2026-11-05 18:55** - M5 done (0c5df42). Settings fold, schema, Activity label, docs. Two consent fixes: a new `cursor` send scope replaces `selection` so the dialog describes ghost text, and "Allow once" now stops the idle trigger instead of asking at every pause. Don't allow only silences when no other engine can serve; a working local fallback keeps suggestions flowing. Follow-ups going to a gap fill: `ghostContext` sends everything up to the caret when it fits, which departs from D3 (outline plus the last 2400 chars) and hurts the first-token target; and a repo's settings can turn `localOnly` off, so it is fenced to user scope.

**2026-11-05 19:00** - M5 gap fill done (4367c87). \`ghostContext\` now sends the last 2400 chars plus a headings note whatever the window, with no \`budgetDocument\` and no frontmatter; consent copy updated in core, Rust and the fixture. \`ghostText.localOnly\` comes from user settings only in both hosts: Desktop had the same hole through a folder's \`.mikedown/settings.json\`, and saving from a workspace or folder routes the value to user scope. 4412 unit tests, \`cargo test --lib consent\` 24 passed.

**2026-11-05 19:02** - M4b done (20a557b). `ai-ghost-session.ts` holds the wiring, installed and removed live with the feature, so unrelated broadcasts keep the Don't allow latch. Both hosts set `hostOwnsShortcuts`, so the chord is a host command: `mikedown.ai.suggestContinuation` in VS Code, a page-handled menu row in Desktop, whose matcher learned Space. Errors never toast; the last reason shows on the Suggest continuation menu entry. Widget readers fixed: `getHtml`, copy as rich text, heading anchors. For M7: Cmd+Option+Space is macOS's default Finder search shortcut, so the chord may not reach either host; the menu entries work regardless.

**2026-11-05 19:16** - M6 done (2160d7c), no source changes and no bugs found. Orchestrator re-ran everything on the tip: test:unit 220 files, 4489 passed, 2 todo, the 3 pre-existing errors; test:edge 22; lint 0 errors; compile clean; test:packages 83; Desktop tsc clean and vitest 601; `cargo test --lib` 299 passed. Ghost code is in core's `ai-ui` chunk only. A trial merge against develop (2e084ed) conflicts in one file, `packages/core/src/ai-request.ts`. M7 waits for Mike.

[Return to Top](#ghost-text-plan)
