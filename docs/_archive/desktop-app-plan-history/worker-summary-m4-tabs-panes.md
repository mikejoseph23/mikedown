# Worker summary: M4 Tabs, panes, document model, hot exit

**Status:** Completed (GUI-only checks pending, see below). **Resumed run** of a worker cut off by API errors.

- Worktree: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a448c95b831377e09`
- Branch: `worktree-agent-a448c95b831377e09` (not pushed)
- Start 19:34, end 19:42 (2026-10-23, this resume)

## Commits

From the earlier run (kept): `aa019de` core getViewState/setViewState; `9a733b3` Rust backups/sessions/routing/quit handshake/menu.
Mine (this run):

- `dc89d98` the earlier WIP `a7bd1ed`, reviewed and verified, recommitted with a proper message (same tree).
- `2f9cf0d` mtime compare on window focus marks cross-window edits as external changes (the one missing M4 piece). Unit test added.
- `ecf218e` core `tsup.config.ts`: build `shared/anchoring`. Pre-existing M3 break: `tauri build` failed resolving `@mikedown/core/shared/anchoring`.
- `11c8687` `tauri-plugin-persisted-scope`: found in the real-app kill -9 run that files outside `$HOME` (picked or launched) restored as Untitled after relaunch, because runtime scope grants were lost. Now persisted.

## Work completed (per checkbox)

- documentModel registry + attach propagation without echo, save/reload/markExternalChange: done (WIP verified by tests).
- panes/tab strip (close, others, saved, drag reorder, middle-click, Cmd+W, Ctrl+Tab / Ctrl+PageUp/Down, split right/down, focus follows click, pane closes with last tab, ARIA, dirty dot, lock badge, downloading + Retry 10 s): done. Note: next/prev tab is `Ctrl+Tab`, not `CmdOrCtrl+Tab`, since Cmd+Tab is the macOS app switcher.
- Large files 2 MB / 20 MB: done.
- Hot-exit backups + one quit dialog (close, Cmd+Q / menu Quit via handshake, ExitRequested): done.
- Multi-window routing, New Window, mtime-on-focus: done.
- Session restore incl. per-tab view state: done.
- Commit: done.

## Tests (all green)

- `npm run compile`, `npm run test:unit` (1152 passed), `npm run test:edge` (22), `npm run test:core-package`
- `packages/desktop`: `npx tsc --noEmit`, `npm run test:unit` (190), `npm run test:e2e` (8), `cargo test` (47)

## Measured: kill -9 with three dirty files, real app (debug bundle)

Launched in background (`open -g`, no keystrokes; Mike was using the screen) with three files; edits were applied programmatically through `doc.replaceText` by a temporary, uncommitted probe build, not typed. Backups written (3 + index). `kill -9`, files on disk unchanged, relaunch with no args: all three tabs restored as their files, dirty, text identical to pre-kill. Test app-data removed afterwards.

## Pending GUI checks (not observed)

1. Quit with dirty files shows exactly one dialog; Cancel keeps the app open: run the app, open 2 files, type in both, Cmd+Q. Expect one Save All / Don't Save / Cancel dialog; Cancel leaves the window. Repeat with the red close button.
2. Same file in two panes: open a file, Cmd+\, type in one pane. Expect text in both, dirty dot on both tabs and in the window title (covered by unit + e2e, not eyeballed).
3. Look of the tab strip in light and dark.

## Review materials

- Run: `cd packages/desktop && npm run dev -- -- /abs/file.md` (release: `npm run build:core` at root first, then `npx tauri build --debug --bundles app`).
- Key files: `packages/desktop/src/main.ts`, `src/panes/paneManager.ts`, `src/documents/{documentModel,backups,session}.ts`, `src/app/{documentController,quitDecision}.ts`, `src-tauri/src/commands/{appdata,multiwindow}.rs`, `src-tauri/src/menu.rs`.

## Notes for orchestrator

- `persisted-scope` keeps every runtime grant forever (grows over time); fine for now, M5/M10 may want pruning.
- The previous TDZ on `booted` was not reproducible: `booted` is declared before any use in the WIP, and the app booted cleanly in the real webview.
