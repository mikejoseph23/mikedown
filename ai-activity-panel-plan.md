# AI Activity Panel — Planning Document

## Summary

MikeDown's AI features (Experimental, off by default) send parts of a document to an engine, local or cloud, and the user cannot see what left the machine or what came back. The request log is metadata only, by design, and it lives in the VS Code `MikeDown AI` output channel or Desktop's stderr, which a Dock launch never shows.

This plan adds an **AI Activity panel**: an opt-in, off-by-default view of every AI request made in the current session, with the exact messages sent and the raw response, held in memory only, with Copy and a manual Save to file. One recorder hook in `runAiCompletion` (core) covers both hosts; the hosts only add the setting and a save-file method.

**Key objectives**

- Transparency: a user can audit exactly what was sent and received, per request, including fallbacks and errors.
- Privacy posture unchanged: the request logs stay metadata only. Content is shown only in this panel, only when the user turns it on, and never leaves memory unless the user saves it.
- One implementation in `@mikedown/core` that both the VS Code extension and Desktop get for free.

**Critical success factors**

- The recorder adds no behavior when the setting is off (no retained content, no cost).
- The panel feels native to the existing AI UI (the Engines page, the AI settings tab), not bolted on.
- The three-place Settings rule is followed, plus Desktop's settings schema.

**Defaults applied:** incremental testing (a test milestone after core and after UI), unit tests in vitest for the recorder and the panel's DOM, hands-on for the end-to-end flow in both hosts, no Playwright, no screenshots. Not a LymeStack app.

### Milestone Progress Tracker

| Milestone | Model | Status | Duration (min) | Notes |
|---|---|---|---|---|
| [M1: Core recorder and setting](#m1-core-recorder-and-setting) | Sonnet | ✅ Done | 5 | `53c5cd8` |
| [M2: Core tests](#m2-core-tests) | Sonnet | ✅ Done | 4 | `5530629`, 18 tests |
| [M3: Activity panel UI](#m3-activity-panel-ui) | Opus | ✅ Done | 18 | `5214b53`; theme check in real hosts pending hands-on |
| [M4: Host wiring (VS Code and Desktop)](#m4-host-wiring-vs-code-and-desktop) | Sonnet | ✅ Done | 12 | `a72280b` |
| [M5: UI tests and hands-on](#m5-ui-tests-and-hands-on) | Sonnet | 🧪 Tests done, hands-on pending | 5 | `85582ff`; Mike walks both hosts at the end |
| [M6: Docs and release notes](#m6-docs-and-release-notes) | Haiku | ✅ Done | 2 | `20f1dbc`; `privacy.ts` needed no change |

## Table of Contents

- [Summary](#summary)
- [Design](#design)
- [M1: Core recorder and setting](#m1-core-recorder-and-setting)
- [M2: Core tests](#m2-core-tests)
- [M3: Activity panel UI](#m3-activity-panel-ui)
- [M4: Host wiring (VS Code and Desktop)](#m4-host-wiring-vs-code-and-desktop)
- [M5: UI tests and hands-on](#m5-ui-tests-and-hands-on)
- [M6: Docs and release notes](#m6-docs-and-release-notes)
- [Parallel Development Recommendations](#parallel-development-recommendations)
- [Gap-Filling Prompts](#gap-filling-prompts)
- [Progress Log / Notes](#progress-log--notes)

## Design

**Setting.** `mikedown.ai.activityPanel` (boolean, default `false`, user scope; it is not a security boundary, so workspace scope is not a concern, but keep it out of `engines`/`allowCloud` machine-scope handling). Added to `AI_SETTINGS_KEYS` in `packages/core/src/ai/schema.ts`, `package.json#contributes.configuration`, `src/settings.ts`, the Settings modal's AI tab, and Desktop's `packages/desktop/src/settings/schema.ts` and `desktopSettings.ts` (follow `showToolbarButton`, which is the same shape).

**Recorder (core).** New `packages/core/src/ai-activity.ts`, exported from `ai-ui.ts` (lazy chunk) and re-exported through `ai-lite.ts` only as the small types the editor needs. One `AiActivityLog` per editor instance (a split pane has its own, matching `createOutlineSidebar`):

- `record(entry)` appends; a ring of the last 50 entries; `clear()`; `subscribe(listener)`; `enabled` flag mirrored from settings. When `enabled` is false, `record` is a no-op and `clear()` runs on the transition to off, so turning the panel off drops everything.
- Entry shape: `id`, `startedAt`, `endedAt`, `feature`, `task`, `route` (`engineId`, `modelId`, label, local or cloud, `viaFallback`), `thinking` (the `AiRunThinking` info), `request` (the full `AiCompletionRequest` as built: `messages`, `format`, `maxTokens`, `temperature`, `requestOverrides`), `response` (`text` as streamed, then the final `AiCompletionResult`: `usage`, `finishReason`, `timing`, `served`), `error` (`AiError` code and message, when thrown), `attempt` (1 or 2, since a fallback retry is a second attempt under the same entry list). A consent refusal records nothing because nothing was sent.
- Hook: `AiRunContext` gains an optional `activity?: AiActivityLog`. In `runAiCompletion`, right before `ctx.ai.complete`, open an entry with the built request; append `delta` text in the token callback; close the entry with the result or the error. The engines plan's logging rule ("never the prompt text") stays true for the hosts' logs. Only this in-memory recorder sees content.
- The editor passes the log in the two `ui.runAiCompletion` call sites in `editor.ts` through one shared `AiRunContext` builder, so no feature can bypass it.

**Panel (core UI, Opus).** `packages/core/src/ai-activity-panel.ts`, mounted the way `mountAiEnginesPage` is (a frame inside the settings modal shell, `MikeDownSettingsSectionContext` for close and links). Entry points:

- The AI toolbar menu gets "AI Activity…" (visible only when the setting is on).
- The Settings modal's AI tab gets the toggle, and next to it an "Open" link when on.
- Both open the same panel.

Layout: a two-pane master and detail. Left, a list of requests newest first: time, feature, engine and model, a local or cloud marker, duration, token counts, and a status dot (ok, error, cancelled, fallback). Right, the selected request: a header line with the route and thinking level, then collapsible "Sent" (each message as a labeled block, role as a small caption, monospace, wrapped) and "Received" (raw text, then a metadata footer with usage, finish reason, timing). Buttons: Copy (both halves as one text block), Save to file (the same text, via the host), Clear all. An empty state explains what the panel does and that nothing is stored. A one-line banner at the top says content is kept in memory for this session only.

Save format: plain text, `mikedown-ai-activity-<yyyymmdd-hhmm>.txt`, headers per request, the raw messages and response verbatim. One request or the whole log (two buttons: "Save this request", "Save all").

**Host method.** `MikeDownHost.saveTextFile?(name: string, text: string): Promise<void>`. VS Code: `showSaveDialog` with the suggested name, then `workspace.fs.writeFile`. Desktop: `tauri_plugin_dialog` save dialog, then the existing `write_text` in `commands/fs.rs`. No host method means the Save buttons are hidden and Copy remains.

**Not in scope:** persisting across sessions, redaction rules, exporting to the logs, Desktop stderr changes, a Rust side (the recorder is above `host.ai.complete`, so Desktop's Rust twin needs nothing).

[Return to Top](#ai-activity-panel--planning-document)

## M1: Core recorder and setting

**Model:** Sonnet. Pure logic in `packages/core`, well-defined shapes.

Workers must complete every item in this list. If an item looks wrong or out of scope, do it anyway unless truly blocked, and note the concern in the summary for the orchestrator.

- [x] Add `activityPanel` to `AI_SETTINGS_KEYS`, the `AiSettings` type, defaults (`false`) and the parser in `packages/core/src/ai/schema.ts`, following `showToolbarButton`.
- [x] Create `packages/core/src/ai-activity.ts` with `AiActivityEntry`, `AiActivityLog` (`createAiActivityLog()`), a 50-entry ring, `record` / `update` / `clear` / `subscribe`, and `setEnabled(on)` that clears on the transition to off.
- [x] Add `activity?: AiActivityLog` to `AiRunContext` in `packages/core/src/ai-request.ts`. In `runAiCompletion`, open an entry with the exact `AiCompletionRequest` object passed to `ctx.ai.complete` (same object, not a rebuilt copy), append streamed deltas, close with the result or the normalized `AiError`. A fallback retry closes the first entry as an error with `viaFallback` context and opens a second entry.
- [x] In `packages/core/src/editor.ts`, create one `AiActivityLog` per editor instance, mirror `settings.ai.activityPanel` into it on every settings broadcast, and pass it in the `AiRunContext` of both `ui.runAiCompletion` call sites (around lines 4328 and 4595). Factor the context into one helper so a future feature cannot miss it.
- [x] Export the new module from `packages/core/src/ai-ui.ts` and the types from `ai-lite.ts`; confirm `npm run test:packages` still passes the shape test (no DOM, no network in `packages/core/src/ai/`; the recorder lives outside that folder, next to `ai-request.ts`).
- [x] `npx tsc -p tsconfig.webview.json --noEmit` and `npm run lint` clean.
- [x] Commit.

[Return to Top](#ai-activity-panel--planning-document)

## M2: Core tests

**Model:** Sonnet. **Mode:** unit (vitest, `packages/core/test/`).

Workers must complete every item in this list.

- [x] Write `packages/core/test/ai-activity.test.ts`:
  - [x] `record` is a no-op while disabled; enabling then disabling clears entries; subscribers fire on each change.
  - [x] Ring holds the newest 50; the 51st drops the oldest.
  - [x] `runAiCompletion` with a fake tier-1 host records one entry whose `request.messages` is the same array passed to `complete`, whose `response.text` equals the concatenated deltas, and whose `response.result` is the host's return value.
  - [x] A thrown `unreachable` before any token, with a tier-2 fake host and a fallback route, records two entries: the first with the error, the second successful with `viaFallback: true`.
  - [x] A cancelled signal records the entry with `error.code === 'cancelled'`.
  - [x] A consent refusal records nothing.
  - [x] Settings parsing: `activityPanel` defaults to `false`, accepts `true`, ignores non-booleans.
- [x] Run `npx vitest run packages/core/test/ai-activity.test.ts` and `npm run test:unit` green.
- [x] Commit.

[Return to Top](#ai-activity-panel--planning-document)

## M3: Activity panel UI

**Model:** Opus. Front-end design work.

Apply genuine design craft: this sits beside the Engines page and the AI tab, so match their spacing, type scale and tokens (`--mikedown-*` custom properties, `packages/core/src/styles/`). Think VS Code's native Output panel crossed with a network inspector's request list: calm, monospace where the content is raw, proportional where it is labels, subtle row hover, a clear selected state, and no decorative chrome. Dark and light themes both.

Workers must complete every item in this list.

- [x] Create `packages/core/src/ai-activity-panel.ts` with `mountAiActivityPanel(container, ctx, { log, saveTextFile? })` returning a handle with `destroy()`. Subscribe to the log; re-render the list incrementally (do not rebuild the detail pane while the selected entry streams, only append text).
- [x] Master list: newest first; each row shows time, feature, engine and model label, local or cloud marker, duration, prompt and completion token counts when known, a status indicator for ok, streaming, error, cancelled and fallback. Keyboard: arrow keys move selection, Enter opens, Escape closes the panel.
- [x] Detail pane: route and thinking header; "Sent" with one block per message (role caption, verbatim content, preserved whitespace); "Received" with the raw text and a metadata footer (usage, finish reason, timing, served by). Collapsible sections remember their state for the panel's lifetime.
- [x] Buttons: Copy (this request), Save this request, Save all, Clear all. Save buttons hidden when no `saveTextFile`. Copy uses the clipboard API with a brief "Copied" confirmation inline, no alert.
- [x] Empty state and the one-line in-memory banner, written plainly: what the panel shows, that nothing is stored or sent anywhere, and that turning the setting off clears it.
- [x] A pure `formatActivityExport(entries)` function in the same module, producing the plain-text export (headers per request, messages and response verbatim), used by Copy and Save.
- [x] Entry points in `packages/core/src/editor.ts`: "AI Activity…" in the AI toolbar menu (only when `settings.ai.activityPanel`); the toggle in the Settings modal's AI tab with an "Open" link beside it when on. Opening uses the same modal shell as `mountAiEnginesPage` (see the call near `editor.ts:2449`).
- [ ] Styles in `packages/core/src/styles/` beside the Engines page CSS; both themes checked in the dev host. (Styles done in `ai.css`, themes checked only on a standalone page with `tokens.css`; the dev host check moves to Mike's hands-on.)
- [x] Lazy-chunk rule: the panel is imported from `ai-ui.ts`, never statically from the editor's main path. Confirm with `packages/core/test/ai-lazy-load.test.ts` still green.
- [x] `npx tsc -p tsconfig.webview.json --noEmit`, `npm run lint`, `npm run test:unit` green. Commit.

[Return to Top](#ai-activity-panel--planning-document)

## M4: Host wiring (VS Code and Desktop)

**Model:** Sonnet. Mechanical, two hosts, well-defined.

Workers must complete every item in this list.

- [x] VS Code: register `mikedown.ai.activityPanel` in `package.json#contributes.configuration` (boolean, default `false`, description mentions Experimental and in-memory only); read it in `src/settings.ts` next to `showToolbarButton`; confirm the Settings modal save path persists it (the `saveSettings` message).
- [x] VS Code: add `saveTextFile` to `MikeDownHost` in `packages/core/src/host.ts` (optional), a `saveTextFile { name, text }` webview message in `src/webview/editor-main.ts` (document it in the protocol comment at the top), and the handler in `src/markdownEditorProvider.ts` using `window.showSaveDialog` and `workspace.fs.writeFile`. Default folder: the document's folder.
- [x] Desktop: add `activityPanel` to `packages/desktop/src/settings/schema.ts` and `desktopSettings.ts` following `showToolbarButton`; wire `saveTextFile` in `packages/desktop/src/host/tauriHost.ts` through a save dialog (`tauri_plugin_dialog`) and the existing `write_text` command in `src-tauri/src/commands/fs.rs`. If the dialog plugin's save API needs a new Tauri capability permission, add it in `src-tauri/capabilities/`.
- [x] Confirm the hosts' request logs (`src/ai/engineService.ts#logRequest`, `commands/ai/request_log.rs`) are untouched: still metadata only.
- [x] `npm run compile`, `npm run lint`, `npm run test:unit` green; `cargo check` in `packages/desktop/src-tauri` green. Commit.

[Return to Top](#ai-activity-panel--planning-document)

## M5: UI tests and hands-on

**Model:** Sonnet for the tests. **Modes:** unit (vitest, jsdom) for the panel; hands-on by Mike for the end-to-end flow in both hosts. No screenshots: the look is judged during the hands-on pass.

Workers must complete every item in this list.

- [x] Write `packages/core/test/ai-activity-panel.test.ts`:
  - [x] Mounts with an empty log and shows the empty state and the banner.
  - [x] A recorded entry renders a row with feature, engine label and status; selecting it renders every message and the response text verbatim (including a message containing `<script>` as text, not markup).
  - [x] Streaming updates append to the detail text without resetting the scroll position or selection.
  - [x] Save buttons absent without `saveTextFile`, present with it, and `saveTextFile` receives the `formatActivityExport` output and a name matching `mikedown-ai-activity-*.txt`.
  - [x] `formatActivityExport` round-trips a two-entry log into the expected plain text (snapshot).
  - [x] Clear all empties the list; disabling the setting clears it and the panel shows the empty state.
- [x] Run `npm run test:unit` and `npm run test:edge` green. Commit.
- [ ] **Hands-on (Mike), VS Code.** Start: `npm run dev` in the repo root (opens `test/workspace`). Open `sample.md`. Toolbar gear > AI tab: the "AI Activity" toggle is off by default; turn it on, an "Open" link appears. Run Rewrite on a paragraph with oMLX or LM Studio. Open AI Activity from the AI toolbar menu: one row; its detail shows the system and user messages and the streamed response; token counts and timing in the footer. Copy, then paste into a text file: matches. Save this request: the save dialog opens in the document's folder with the suggested name; the file content matches. Turn the setting off: the panel clears and the menu entry disappears. Check the `MikeDown AI` output channel still shows one metadata line per request and no prompt text.
- [ ] **Hands-on (Mike), Desktop.** Quit the installed MikeDown, then `npm run dev` in `packages/desktop`. Same walk as above through the Desktop settings; Save uses the native save dialog. Check both themes.
- [ ] Orchestrator pauses here for Mike's sign-off before M6. (Mike waived this for this run: M6 goes first, the hands-on pass comes at the end.)

[Return to Top](#ai-activity-panel--planning-document)

## M6: Docs and release notes

**Model:** Haiku. Mechanical doc edits; the orchestrator may do these directly.

Workers must complete every item in this list.

- [x] README (root) and `website/vscode/`: one line under the AI section about the AI Activity panel (opt-in, in-memory, shows exactly what was sent and received). Mark Experimental like the other AI lines.
- [x] `packages/core/src/ai/privacy.ts`: if the privacy lines list where to look, add a sentence pointing at the panel. Do not touch the consent text shared with `consent.rs` through `test/ai-fixtures/consent/` (the fixture test would fail).
- [x] `docs/ai-writing-features-plan.md` Follow-ups and `BACKLOG.md`: remove the transparency item if listed; add a follow-up for redaction (API keys never appear in messages today, but note it) and for a per-request "Report a problem" export.
- [x] `CHANGELOG.md` (extension, unreleased) and `packages/desktop/deploy/release-notes/` draft for the next Desktop version: one entry each.
- [x] Update this plan's tracker and progress log. Commit.

[Return to Top](#ai-activity-panel--planning-document)

## Parallel Development Recommendations

- **Sequential blockers:** M1 blocks everything (the recorder and the setting key are the contract). M3 blocks M5's panel tests.
- **Group A (after M1):** M2 (core tests) and M3 (panel UI) and M4 (host wiring) can run in parallel. M4 touches `src/`, `packages/desktop/`, `host.ts` and `editor-main.ts`; M3 touches `packages/core/src/ai-activity-panel.ts`, styles and `editor.ts` entry points. The only shared file is `editor.ts`: M3 owns it in this wave, M4 must not edit it. Tell each worker the other's directories.
- **Group B (after A):** M5 tests, then Mike's hands-on, then M6.

If dispatching Group A fills the orchestrator context, run `/compact` while the workers run; resume from `.orchestrator/state.json`.

[Return to Top](#ai-activity-panel--planning-document)

## Gap-Filling Prompts

When a milestone comes back with skipped or partial items, the orchestrator writes a gap-fill prompt that:

- Follows the same structure as the original milestone prompt (header, mission, reference to this plan, scope guard).
- States what the first attempt already completed and which files it changed.
- Lists other active workers and their directories to avoid conflicts.
- Is labeled "Worker Context: [Milestone Name] - Gap Fill".
- Ends with the standard completion instructions: commit, write the summary to `.orchestrator/worker-summary-[milestone-slug]-gap.md`, then prompt the user to close the context.

Workers never spawn agents of their own, and commits carry no AI attribution.

[Return to Top](#ai-activity-panel--planning-document)

## Progress Log / Notes

**2026-11-05 12:33** - Plan written. Decision from the day-man session: build the panel rather than backlog it; the hosts' request logs stay metadata only, and only this opt-in in-memory panel shows content. Recorder hook goes above `host.ai.complete` in `runAiCompletion`, so Desktop's Rust side needs nothing.

**2026-11-05 12:46** - M1 done (`53c5cd8`): recorder, setting key, shared `aiRunContext`. Reviewed the diff; typecheck, lint, unit and shape tests green per the worker. Run on its own branch `ai-activity-panel`; Mike waived gates until the end, so his hands-on sign-off moves after M6. Added the `saveTextFile` host contract (`b321fbe`) so M3 and M4 can run in parallel without sharing `host.ts`. M2 dispatched in the main tree, M3 and M4 in worktrees.

**2026-11-05 12:49** - M2 done (`5530629`): 18 recorder tests green, no recorder bugs found. `test:unit` showed one intermittent jsdom failure in `table-editing.test.ts` that passed on rerun, in a file this work does not touch; note for the final test pass.

**2026-11-05 12:55** - M4 done (`a72280b`, cherry-picked from its worktree): setting in both hosts, `saveTextFile` in VS Code (message and reply) and Desktop (dialog plus `write_text`; `dialog:allow-save` already present, no Rust change). Request logs untouched. The setting has no `scope` in `package.json`, like `showToolbarButton`; the plan calls it user scope but says workspace scope is not a concern, so left as is.

**2026-11-05 13:06** - M3 done (`5214b53`, cherry-picked): panel, toolbar entry, AI tab toggle and Open link; one accessor for the log; `ai-toolbar.ts` and `ai-settings.ts` also changed since the entry points are built there. Noted: Explain and Translate show as "Rewrite selection" because they record `feature: 'rewrite'`. M5 dispatched in the main tree.

**2026-11-05 13:10** - M5 tests done (`85582ff`): 12 panel tests. `test:unit` 3516 pass, `test:edge` 22 pass; `test:unit` exits 1 on the 3 `elementFromPoint` errors from `table-editing.test.ts`, which predate this work and this branch does not touch. No panel bugs found. Hands-on deferred to the end per Mike. M6 dispatched.

**2026-11-05 13:14** - M6 done (`20f1dbc`): README, listing, CHANGELOG, follow-ups, Desktop `0.6.0.md` draft. No privacy line says where to look, so `privacy.ts` is unchanged. Final pass on the branch: lint 0 errors, compile green, `test:unit` 3516 pass (exits 1 on the 3 existing `table-editing` errors), `test:edge` 22, `test:packages` 83, Desktop `tsc` and `cargo check` green. Waiting on Mike's hands-on in both hosts; not pushed, not merged to `develop`.

[Return to Top](#ai-activity-panel--planning-document)
