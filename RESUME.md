# MikeDown — Resume Prompt

## Project Overview

MikeDown is a VS Code custom editor extension: a WYSIWYG markdown editor built on TipTap/ProseMirror (webview bundle) with a Node extension host. Two webpack bundles — extension host (`src/`, node target, `dist/extension.js`) and webview (`src/webview/`, web target, `out/webview/editor-main.js`) — communicating only via `postMessage`. See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; three-place settings rule; tiptap-markdown webpack alias).

## Current Status

**2.11.0 is released and live on the Marketplace (2026-09-26). `main` and all tags through `v2.11.0` are pushed. No work in flight.**

- 2.11.0 shipped slash commands (menu, `/image` picker, `/properties`, `/date`, `/datetime`, `/h4`–`/h6`, in-menu disable, three `mikedown.slashCommands.*` settings) and the review appeal card ("A note from Mike", sidebar Support link, About tab section, `MikeDown: Support MikeDown` command), with the appeal copy rewritten in Mike's voice.
- Hands-on sign-off for both features passed with no defects; the scriptable steps are now automated (`7d64519`). Tests: 730 unit, 38 integration; lint is green repo-wide (the ESLint tsconfig fix landed).
- Both orchestrator sessions are closed. `review-appeal-planning.md` and `review-appeal-copy.md` were deleted in "Cleanup" (`edcad00`); the final copy lives in `src/supportCopy.ts` and the README.
- Marketplace baseline at release: 392 installs, 5 reviews, 5.00 rating.

## What's Next

1. **Review re-checks:** 2026-10-26 and 2026-11-25 (`npx vsce show interapp.mikedown-editor`, record in BACKLOG.md).
2. **Refresh the Marketplace PAT.** `vsce publish` failed with TF400813 (token expired); 2.11.0 was uploaded by hand. Run `npx vsce login interapp` with a new token (Marketplace → Manage scope) before the next release.
3. **Release script:** `npm run vsix` always patch-bumps. For a minor release use `npm version minor --no-git-tag-version && npm run package && npx vsce package`, and rename the CHANGELOG `[Unreleased]` heading.
4. **Archive** `slash-commands-planning.md` and `hands-on-remaining.md` into `docs/` (both done).
5. **Hotkeys follow-ups:** older `toggleBold`/`Italic`/`Strike`/`Highlight`/`Code` cases lack the `sourceMode` guard (latent bug) and `commandPalette` gating.
6. **Known limitation:** `/properties` undo only works as the very next action (accepted). An empty `/todo` item gains a cosmetic backslash on first reload.
7. **Carry-overs from 2.10.x:** Kevin's remote retest (WSL/Docker), a possibly pending email to Kevin (Gmail thread `19ffde1e6eeb746b`), the `manual-test-script.md` pass, and marking M3/M9 in `planning/kevin-feedback-aug-08.md` before archiving it.

## Planning Docs

- `slash-commands-planning.md`: complete, ready to archive.
- `hands-on-remaining.md`: manual-only remainder of the 2.11.0 checklists (done).
- `docs/` holds archived plans, indexed in `docs/README.md`.
- `planning/kevin-feedback-aug-08.md`: M3 and M9 still open.
- `manual-test-script.md`: v2.10.0 manual pass, not yet run.
- `PLANNING.md`: general planning doc (reserved root fixture).

## Key File Paths

- `src/webview/slashcommands.ts`, `slashcommands-actions.ts`, `slashcommands-date.ts`, `imagepick.ts` — slash command menu, actions, date helper, image picker
- `src/supportCopy.ts`, `src/supportPrompt.ts`, `src/webview/supportCard.ts` — review appeal copy, eligibility/state, card UI
- `src/webview/editor-main.ts` — command switch, Settings modal (`showSettingsModal`), Hotkeys tab
- `src/markdownEditorProvider.ts` — message routing, `dispatchTestMessage` test seam, diff-view allowlist
- `test/harness/webviewHarness.ts` — jsdom harness that boots the real webview

## Recent Git Log

- `aef9ac5` Drop the review plea reminder now that the copy is final
- `5619174` Release 2.11.0
- `c045141` Apply approved review appeal copy from review-appeal-copy.md
- `73ffc3e` Document slash commands in changelog and README, finish M7
- `7d64519` Add hands-on-checklist automation tests for slash commands and review appeal
- `ab1bd96` Scope webview type-safety lint rules to warnings and fix remaining lint errors

## Any Other Notes

- **A stale Extension Development Host shows the old UI.** Cmd+R after every `npm run compile`.
- Bare `vitest run` picks up integration files and fails — use `npm run test:unit` / `test:edge` / `test:integration`.
- Mutating integration tests: use a private fixture with teardown, never `test/workspace/sample.md`.
- Spell check defaults **off** — enable it before testing squiggles.
- Check live marketplace state with `npx vsce show interapp.mikedown-editor` before assuming anything about what users have.
