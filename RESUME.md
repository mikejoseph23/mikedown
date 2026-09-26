# MikeDown — Resume Prompt

## Project Overview

MikeDown is a VS Code custom editor extension: a WYSIWYG markdown editor built on TipTap/ProseMirror (webview bundle) with a Node extension host. Two webpack bundles — extension host (`src/`, node target, `dist/extension.js`) and webview (`src/webview/`, web target, `out/webview/editor-main.js`) — communicating only via `postMessage`. See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; three-place settings rule; tiptap-markdown webpack alias).

## Current Status

**2.10.4 is released (issue #5 fix). `main` is clean, and 2.10.2 through 2.10.4 are tagged locally.**

- 2.10.3: Paste Without Formatting, and bare filenames no longer autolink (`efe276b`).
- 2.10.4: markdown escaping and source-mode sync fix (#5, `c1148cf`), source-mode divergence tracking extracted and tested (`dc8061a`), and a jsdom harness that boots the real webview (`f308a6d`).
- Housekeeping (2026-09-25): added tags v2.10.2 through v2.10.4, and archived the hotkeys and wikilink plans to `docs/` with a new `docs/README.md` index.

## What's Next

1. **Hotkeys follow-ups:**
   - The older command cases (`toggleBold`/`Italic`/`Strike`/`Highlight`/`Code`) in `editor-main.ts` have no `sourceMode` guard. This is a latent bug.
   - Those same commands have no `commandPalette` gating entries.
   - Adopt a repo rule that integration tests which change a file must use a private fixture.
2. **Carry-overs from 2.10.x:** Kevin's remote retest (WSL/Docker load and Docker print have never been checked by a human), a possibly pending email to Kevin (Gmail thread `19ffde1e6eeb746b`), the `manual-test-script.md` pass, and marking M3/M9 in `planning/kevin-feedback-aug-08.md` before archiving it.

## Planning Docs

- `docs/` holds archived plans: `list-hotkeys.md` and `wikilink-support.md`, indexed in `docs/README.md`.
- `planning/kevin-feedback-aug-08.md` has M1 through M9 done except M3 (hands-on remote checks) and M9 (follow-up email).
- `manual-test-script.md` is the v2.10.0 manual pass and still hasn't been run.
- `PLANNING.md` is the general planning doc (reserved root fixture).
- `planning/HEADING-RENAME-LINKS.md` and `planning/IMAGE-PASTE.md` are finished and kept for history.

## Key File Paths

- `src/webview/editor-main.ts` — command switch (~line 4681), Hotkeys tab `buildHotkeysPanel` (~line 600), settings-panel mount (~line 1840), Tab `handleKeyDown` modifier guards (~line 2885)
- `src/webview/hotkeys.ts` — `MIKEDOWN_HOTKEYS` data array; must mirror `package.json#contributes.keybindings` (`test/unit/hotkeys.test.ts` enforces sync)
- `src/webview/outlineSidebar.ts` — `toggleSidebarVisible()` export (~line 454)
- `src/extension.ts` — `formattingCommands` forwarding array (~line 96)
- `src/markdownEditorProvider.ts` — `openKeybindings` message case; diff-view allowlist (~line 169)
- `package.json` — commands/keybindings/commandPalette contributions; `extensionKind` order is load-bearing

## Recent Git Log

- `e4d26d0` Release 2.10.4
- `f308a6d` Add a jsdom harness that boots the real webview, and cover issue #5 end to end
- `dc8061a` Extract source-mode divergence tracking and cover it with tests
- `c1148cf` Fix markdown escaping and source-mode sync (#5)
- `f54b709` Release 2.10.3
- `efe276b` Add Paste Without Formatting and stop autolinking bare filenames

## Any Other Notes

- **A stale Extension Development Host shows the old UI.** Cmd+R after every `npm run compile`.
- `npm run vsix` patch-bumps the version itself — don't bump manually first.
- `npm run lint` baseline: ~241 errors under `src/webview/` from tsconfig exclusion — pre-existing, not new debt.
- Bare `vitest run` picks up integration files and fails — use `npm run test:unit` / `test:edge` / `test:integration`.
- Mutating integration tests: use a private fixture with teardown, never `test/workspace/sample.md` (two other tests assert its exact content).
- `showSettingsModal` isn't exported and has no DOM coverage — Settings-modal regressions (like the empty Hotkeys pane, `dc3fad6`) are invisible to the suite.
- Spell check defaults **off** — enable it before testing squiggles.
- Check live marketplace state with `npx vsce show interapp.mikedown-editor` before assuming anything about what users have.
