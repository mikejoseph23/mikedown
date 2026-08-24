# MikeDown — Resume Prompt

## Project Overview

MikeDown is a VS Code custom editor extension: a WYSIWYG markdown editor built on TipTap/ProseMirror (webview bundle) with a Node extension host. Two webpack bundles — extension host (`src/`, node target, `dist/extension.js`) and webview (`src/webview/`, web target, `out/webview/editor-main.js`) — communicating only via `postMessage`. See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; three-place settings rule; tiptap-markdown webpack alias).

## Current Status

**2.10.2 is released: GitHub issue #3 fully shipped (list/sidebar hotkeys + Hotkeys settings tab + Ctrl+Tab indent fix), published to the marketplace, issue closed, everything pushed.**

- Just finished: all 5 milestones of `list-hotkeys-planning.md` plus the separate Ctrl+Tab bug fix, orchestrated across subagent workers. All hands-on verification passed. Reply posted to issue #3 and the issue closed as completed.
- Working tree clean, `main` pushed through `ff3cb15`.
- No release tag was created for 2.10.2 (2.10.0/2.10.1 got `v*` tags) — consider `git tag v2.10.2 ff3cb15 && git push --tags`.

## What's Done

- **2.10.2 — issue #3** (`89b49e4`…`ff3cb15`): four new commands (`toggleBulletList` `Ctrl+.`, `toggleOrderedList` `Ctrl+3`, `toggleTaskList` `Ctrl+8`, `toggleSidebar` `Ctrl+\`), scoped `when: activeCustomEditorId == 'mikedown.editor'`, remappable via VS Code's native Keyboard Shortcuts UI (deliberate decision: no custom remapping preference area). Read-only **Hotkeys tab** in the Settings modal with a "Customize in VS Code…" deep link. **Ctrl+Tab fix** (`1ca9836`): Tab handlers in `editor-main.ts` now ignore modified Tab presses.
- Tests: unit 386/386, integration 25/25, all green post-release.
- **2.10.1 remote-loading hotfix** (`90a1080`): `extensionKind` order + diff-scheme allowlist — editor loads in WSL/Docker again.
- **2.10.0**: spell checker (off by default), custom dictionary UI at scale, default-editor first-run prompt.

## What's Next

1. **Tag the release** if desired (see Current Status).
2. **Archive `list-hotkeys-planning.md`** (`/iadev:archive-planning-document`) — all milestones ✅ and shipped.
3. **Three logged follow-ups from the hotkeys work** (in the planning doc's progress log, awaiting a decision):
   - Older command cases (`toggleBold`/`Italic`/`Strike`/`Highlight`/`Code`) in `editor-main.ts` lack the `sourceMode` guard the new list commands have — latent bug.
   - Those same older commands have no `commandPalette` gating entries — inconsistency worth retrofitting.
   - Adopt repo rule: mutating integration tests must use a private fixture, never shared `test/workspace/sample.md` (M3 corrupted it once; restored).
4. **Carry-overs from 2.10.x**: Kevin remote retest (WSL/Docker load + Docker print — still never human-verified), possible pending Kevin email (Gmail thread `19ffde1e6eeb746b`), `manual-test-script.md` pass, mark M3/M9 in `planning/kevin-feedback-aug-08.md` then archive it.

## Planning Docs

- `list-hotkeys-planning.md` — issue #3 hotkeys work, all 5 milestones ✅, shipped in 2.10.2; ready to archive.
- `planning/kevin-feedback-aug-08.md` — M1–M9 ✅ except M3 (hands-on remote checks) and M9 (follow-up email).
- `manual-test-script.md` — the v2.10.0 manual pass, still not executed.
- `PLANNING.md` — pre-existing general planning doc (reserved root fixture).
- `wikilink-support-plan.md` — shipped in 2.9.0; candidate for archiving.
- `planning/HEADING-RENAME-LINKS.md`, `planning/IMAGE-PASTE.md` — done, historical.

## Key File Paths

- `src/webview/editor-main.ts` — command switch (~line 4681), Hotkeys tab `buildHotkeysPanel` (~line 600), settings-panel mount (~line 1840), Tab `handleKeyDown` modifier guards (~line 2885)
- `src/webview/hotkeys.ts` — `MIKEDOWN_HOTKEYS` data array; must mirror `package.json#contributes.keybindings` (`test/unit/hotkeys.test.ts` enforces sync)
- `src/webview/outlineSidebar.ts` — `toggleSidebarVisible()` export (~line 454)
- `src/extension.ts` — `formattingCommands` forwarding array (~line 96)
- `src/markdownEditorProvider.ts` — `openKeybindings` message case; diff-view allowlist (~line 169)
- `package.json` — commands/keybindings/commandPalette contributions; `extensionKind` order is load-bearing
- `.orchestrator/list-hotkeys-planning/` — worker prompts/summaries from the orchestration (gitignored)

## Recent Git Log

- `ff3cb15` Bump version to 2.10.2
- `c54029a` Date the 2.10.2 changelog entry and add the Hotkeys tab and Ctrl+Tab fix notes
- `139bfec` Record hands-on results and the Hotkeys tab fix
- `dc3fad6` Fix Hotkeys settings tab rendering an empty pane
- `ba3289d` Add read-only Hotkeys tab to the Settings modal
- `8947309` Add keyboard shortcuts for list toggles and sidebar
- `8782c83` Add tests for list-toggle and sidebar commands
- `9264690` Wire list-toggle and sidebar keybindings into the webview

## Any Other Notes

- **A stale Extension Development Host shows the old UI.** Cmd+R after every `npm run compile`.
- `npm run vsix` patch-bumps the version itself — don't bump manually first.
- `npm run lint` baseline: ~241 errors under `src/webview/` from tsconfig exclusion — pre-existing, not new debt.
- Bare `vitest run` picks up integration files and fails — use `npm run test:unit` / `test:edge` / `test:integration`.
- Mutating integration tests: use a private fixture with teardown, never `test/workspace/sample.md` (two other tests assert its exact content).
- `showSettingsModal` isn't exported and has no DOM coverage — Settings-modal regressions (like the empty Hotkeys pane, `dc3fad6`) are invisible to the suite.
- Spell check defaults **off** — enable it before testing squiggles.
- Check live marketplace state with `npx vsce show interapp.mikedown-editor` before assuming anything about what users have.
