# List Hotkeys Planning Document

## Summary

Address the feature half of [GitHub issue #3](https://github.com/mikejoseph23/mikedown/issues/3): add keyboard shortcuts for list actions (bullet, ordered, task list) and a sidebar toggle. Rather than building a custom hotkey-remapping preference area, expose each action as a `mikedown.*` command with a default keybinding in `package.json#contributes.keybindings` — VS Code's native Keyboard Shortcuts UI then gives users full remapping, conflict detection, and per-user overrides for free.

**Key objectives:**

- New commands: `mikedown.toggleBulletList`, `mikedown.toggleOrderedList`, `mikedown.toggleTaskList`, `mikedown.toggleSidebar`.
- Default bindings (all scoped `when: activeCustomEditorId == 'mikedown.editor'`), per the issue's request: `Ctrl+.` bullet, `Ctrl+3` ordered, `Ctrl+8` task, `Ctrl+\` sidebar (`Cmd` on mac).
- Follow the existing command pipeline: `contributes.commands` → `extension.ts` registration → forward `{ type: 'command', command }` to the webview → handle in `editor-main.ts`.
- Reply on issue #3 once shipped, pointing users at VS Code's Keyboard Shortcuts UI for remapping.

**Critical success factors:** bindings work in both WYSIWYG and are ignored (or sensibly no-op) in source mode; no conflicts with VS Code defaults inside the custom editor scope; commands appear in the Command Palette only when relevant.

**Defaults applied:** Incremental testing (integration + hands-on for key-press behavior), model recommendations per milestone (user may override), no schema milestone (no database).

### Milestone Progress Tracker

| Milestone | Model | Status | Duration (min) | Notes |
|---|---|---|---|---|
| M1: Commands & keybindings (host side) | Sonnet | ✅ Done | 8 | Commit 89b49e4 |
| M2: Webview command handlers | Sonnet | ✅ Done | 4 | Commit 9264690 |
| M3: Testing & verification | Sonnet | ✅ Automated done · ⏳ hands-on pending | 4 | Commit 8782c83 |
| M4: Docs & issue follow-up | Haiku | ✅ Done | 5 | Commit 8947309 (amended) |

## Table of Contents

- [Summary](#summary)
- [Milestone 1: Commands & Keybindings (Host Side)](#milestone-1-commands--keybindings-host-side)
- [Milestone 2: Webview Command Handlers](#milestone-2-webview-command-handlers)
- [Milestone 3: Testing & Verification](#milestone-3-testing--verification)
- [Milestone 4: Docs & Issue Follow-up](#milestone-4-docs--issue-follow-up)
- [Parallel Development Recommendations](#parallel-development-recommendations)
- [Progress Log / Notes](#progress-log--notes)

## Milestone 1: Commands & Keybindings (Host Side)

**Recommended model:** Sonnet (well-defined, follows an existing pattern)

Mirror the existing `mikedown.toggleBold` pipeline exactly.

- [x] Add the four commands to `package.json#contributes.commands` with titles ("MikeDown: Toggle Bullet List", etc.).
- [x] Add keybindings to `package.json#contributes.keybindings`, each with `key`, `mac`, and `when: activeCustomEditorId == 'mikedown.editor'`:
  - [x] `mikedown.toggleBulletList` — `ctrl+.` / `cmd+.`
  - [x] `mikedown.toggleOrderedList` — `ctrl+3` / `cmd+3`
  - [x] `mikedown.toggleTaskList` — `ctrl+8` / `cmd+8`
  - [x] `mikedown.toggleSidebar` — `ctrl+\` / `cmd+\`
- [x] Check each default against VS Code built-ins active inside a webview-focused custom editor (e.g. `ctrl+\` is split-editor; the `when` scope overrides it, but note the shadowing in the plan notes if kept — pick an alternative like `ctrl+alt+\` only if testing shows the override fails).
- [x] Register the commands in `src/extension.ts` alongside the existing forwarding commands (each posts `{ type: 'command', command: '<name>' }` to `MarkdownEditorProvider.activePanel`).
- [x] Add the commands to `contributes.menus.commandPalette` with a `when` clause matching how existing editor-scoped commands are gated (hide when no MikeDown editor is active).
- [x] `npm run lint` and `npm run compile` pass.
- [x] Commit.

**Note:** Workers must complete ALL items in this list. If an item seems removable, note it in the worker summary for the orchestrator to decide — but attempt it unless truly blocked.

[Return to Top](#list-hotkeys-planning-document)

## Milestone 2: Webview Command Handlers

**Recommended model:** Sonnet (well-defined; TipTap commands already exist)

- [x] In `src/webview/editor-main.ts`, handle the four new command names in the host→webview `command` message switch:
  - [x] `toggleBulletList` → `editor.chain().focus().toggleBulletList().run()`
  - [x] `toggleOrderedList` → `editor.chain().focus().toggleOrderedList().run()`
  - [x] `toggleTaskList` → `editor.chain().focus().toggleTaskList().run()`
  - [x] `toggleSidebar` → reuse the existing outline sidebar toggle path (`outlineSidebar.ts` / the header toggle button's handler) — do not duplicate its state logic.
- [x] Define behavior in source mode (CodeMirror): list toggles should no-op silently (or be skipped) rather than throw; sidebar toggle should still work if the sidebar is available there — match whatever the existing toolbar buttons do in source mode.
- [x] Respect the critical constraint: all document changes go through TipTap commands/PM transactions — never mutate `editor.view.dom` directly.
- [x] `npm run compile` and `npm run test:unit` pass.
- [x] Commit.

**Note:** Workers must complete ALL items in this list. If an item seems removable, note it in the worker summary for the orchestrator to decide — but attempt it unless truly blocked.

[Return to Top](#list-hotkeys-planning-document)

## Milestone 3: Testing & Verification

**Recommended model:** Sonnet

**Modes:** integration tests (automated) + hands-on manual (key-press behavior is interactive; screenshots can't convey it).

- [x] Integration (`test/integration/`): assert the four commands are registered (`vscode.commands.getCommands`) and that executing each against an open MikeDown editor round-trips without error.
- [x] Unit: if any pure logic was factored out (e.g. command-name → editor-action mapping), cover it in `test/unit/`.
- [x] Run `npm run test:unit` and `npm run test:integration` green.
- [ ] Hands-on checklist (user or orchestrator in the Extension Development Host):
  - [ ] `Ctrl+.` toggles a bullet list on/off at the cursor.
  - [ ] `Ctrl+3` toggles an ordered list; converting between list types works.
  - [ ] `Ctrl+8` toggles a task list.
  - [ ] `Ctrl+\` shows/hides the sidebar.
  - [ ] Shortcuts do nothing destructive in source mode.
  - [ ] Remapping one binding via VS Code's Keyboard Shortcuts UI works (proves the "native remapping" premise of issue #3).
- [x] Commit any test code.

**Note:** Workers must complete ALL items in this list. If an item seems removable, note it in the worker summary for the orchestrator to decide — but attempt it unless truly blocked.

[Return to Top](#list-hotkeys-planning-document)

## Milestone 4: Docs & Issue Follow-up

**Recommended model:** Haiku (mechanical)

- [x] Update `README.md` keyboard-shortcut docs (if a shortcut table exists) and `CHANGELOG.md`.
- [x] Draft a reply for issue #3 (feature half): new defaults + how to remap via VS Code Keyboard Shortcuts UI (`Cmd+K Cmd+S`, search "mikedown"). Note the Ctrl+Tab bug is fixed separately. **User posts/approves the reply.**
- [x] Commit.

**Note:** Workers must complete ALL items in this list. If an item seems removable, note it in the worker summary for the orchestrator to decide — but attempt it unless truly blocked.

[Return to Top](#list-hotkeys-planning-document)

## Parallel Development Recommendations

- **Group A (parallel-safe):** M1 and M2 touch different files (`package.json`/`extension.ts` vs `editor-main.ts`) and could run concurrently, though they're small enough that sequential is simpler.
- **Sequential blockers:** M3 requires M1 + M2 complete. M4 requires M3 green.
- If orchestrating with multiple workers and the orchestrator context fills, run `/compact` while workers execute and resume from `.orchestrator/state.json`.

**Gap-filling prompts** (if a milestone is left incomplete) must follow the original milestone prompt structure, state what was already done, reference modified files, list other active workers, and end with: commit changes → write summary to `.orchestrator/worker-summary-[milestone-slug]-gap.md` → prompt user to clear context. Label clearly as "Worker Context: [Milestone Name] - Gap Fill".

[Return to Top](#list-hotkeys-planning-document)

## Progress Log / Notes

**2026-08-24 17:40** - M4 complete (commit `8947309`): README shortcut table + CHANGELOG `[Unreleased]` entry; issue #3 reply drafted to `.orchestrator/list-hotkeys-planning/issue-3-reply-draft.md` (not posted — user reviews and posts).

Orchestrator corrections applied to M4's output: (a) its commit carried a `Co-Authored-By: Claude` trailer, violating repo convention — amended to `8947309`, all four commits re-scanned clean; (b) the reply draft claimed source mode offers a right-click Insert menu as a fallback for list actions, which was never verified in the code — removed rather than promised to a user; (c) em dashes stripped from the draft since the user posts it under his own name.

**All four milestones done. Remaining work is the user's hands-on keybinding check (see M3 summary), which gates posting the issue reply.**

**Open follow-ups (user decision, out of scope for this plan):**

1. `toggleBold`/`Italic`/`Strike`/`Highlight`/`Code` command cases lack the `sourceMode` guard that the toolbar and undo/redo have (found by M2).
2. Those same older commands have no `commandPalette` entries at all; the four new commands are the first with palette gating (found by M1).
3. Adopt the private-fixture convention for mutating integration tests as a written repo rule (found by M3).

**2026-08-24 17:32** - M3 automated testing complete (commit `8782c83`): 3 new test files + a private fixture. `test:unit` 383/383, `test:integration` 25/25. No bugs found in M1/M2. **Hands-on checklist still pending — user must run it** (reproduced in `.orchestrator/list-hotkeys-planning/processed/worker-summary-m3-testing.md`); the critical item is confirming `Cmd+\` reaches `toggleSidebar` rather than VS Code Split Editor, fallback `ctrl+alt+\`.

**Test-pollution hazard found (pre-existing, repo-wide):** executing a doc-mutating command against the shared `test/workspace/sample.md` fixture in an integration test auto-saves the edit to disk and breaks `fileHandling.test.ts`, which asserts its exact content. M3 hit this, restored `sample.md`, and routed its tests to a dedicated fixture with teardown. Convention to adopt: **any integration test that executes a document-editing command must use its own private fixture, never `sample.md`.** M4 dispatched.

**2026-08-24 17:26** - M2 complete (commit `9264690`): four `command` switch cases in `editor-main.ts`; list toggles guarded by `!sourceMode`, `toggleSidebar` calls a new `toggleSidebarVisible()` export in `outlineSidebar.ts` that reuses the existing private `setVisible` (no duplicated state). Compile clean, `test:unit` 372/372. No pure logic factored out, so M3 unit coverage needs a live TipTap instance (pattern: `test/unit/roundtrip.test.ts`). Follow-up noted: the pre-existing `toggleBold`/`Italic`/`Strike`/`Highlight`/`Code` command cases lack the `sourceMode` guard that the toolbar (`SOURCE_MODE_DISABLED_ACTIONS`) and `doUndo`/`doRedo` have — out of scope, awaiting user decision. M3 dispatched.

**2026-08-24 17:20** - M1 complete (commit `89b49e4`): 4 commands + keybindings + commandPalette entries in `package.json`, forwarding registered in `extension.ts`. Compile passes; lint baseline unchanged (pre-existing failures only). Two notes: (a) `ctrl+\`/`cmd+\` shadows VS Code split-editor — the `when` clause should win (precedent: existing `ctrl+/` source-mode toggle), needs the M3 hands-on smoke test to confirm; (b) these are the first editor-scoped commands with `commandPalette` gating — older commands (`toggleBold` etc.) have no palette entries at all; retrofitting them is out of scope here. M2 dispatched.

**2026-08-24 17:16** - Orchestrator session started (slug `list-hotkeys-planning`). Stale registry entry for `kevin-feedback-aug-08` removed. M1 dispatched to a Sonnet worker; M1/M2 run sequentially per the plan's own recommendation (too small to justify worktree merge overhead).

**2026-08-24 17:09** - Planning document created from GitHub issue #3 (feature half: list/sidebar shortcuts). Decision: no custom hotkey preference area — use VS Code native keybindings for remapping. The Ctrl+Tab indent bug from the same issue is being fixed separately outside this plan.

[Return to Top](#list-hotkeys-planning-document)
