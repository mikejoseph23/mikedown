# MikeDown — Resume Prompt

## Project Overview

MikeDown is a VS Code custom editor extension: a WYSIWYG markdown editor built on TipTap/ProseMirror (webview bundle) with a Node extension host. Two webpack bundles — extension host (`src/`, node target, `dist/extension.js`) and webview (`src/webview/`, web target, `out/webview/editor-main.js`) — communicating only via `postMessage`. See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; three-place settings rule; tiptap-markdown webpack alias).

## Current Status

**Core extraction mostly built (2026-10-22).** The editor now lives in `packages/core` (`@mikedown/core`, version `0.1.0-rc.1`, built with tsup). The VS Code extension consumes it through a webpack alias. The Angular wrapper (M5) is in progress in `~/git/lymestarter`. M7 part 1 (release scripts, CHANGELOG, these docs) is done. Plan: `angular-core-extraction-plan.md`.

- The callout body duplication fix (f1befc5) is in `[Unreleased]`. It affects 2.14.2, so cut **2.14.3** soon.
- `npm whoami` is not logged in, so `@mikedown/core` is not published. Run `npm login`, then `npm run release:core` (core first, then `npm run vsix`; see CLAUDE.md Releasing).
- `/Volumes/Storage/LymeStack/packages/npm/` was not writable from agent sessions; tarballs fall back to `.orchestrator/.../artifacts/`.
- Push still needs Mike's say-so (`main` and tag `v2.14.2` are unpushed).

## What's Done

- **Planning (2026-10-22):** `angular-core-extraction-plan.md` — 14 milestones (M0–M9, T1–T4). Key findings baked in: webview has ~50 `postMessage` sites and one `acquireVsCodeApi`; 81 `--vscode-*` CSS vars to tokenize; LymeStarter's Angular side is vendored via `lymetools sync` (no npm feed), so the wrapper lives in `~/git/lymestarter/ng-app/src/app/lymestack-shared/mikedown/`; Quantico Creek legacy app (`~/git/quanticocreek/quantico-creek-angular-app`) is Angular 14 / TS 4.7 and not a scaffold, so it copies the wrapper by hand.
- **2.14.2:** #10 math in HTML/PDF exports (KaTeX CSS + fonts inlined in `src/export.ts`). **2.14.1:** #9 line breaks in table cells. **2.14.0:** #7, #8, footnotes, source-mode hotkey fix.

## What's Next

1. `npm login`, then `npm run release:core` to publish the rc (or the stable version after vsix sync).
2. Finish M5 (LymeStarter wrapper), M6 (Quantico Creek), then the version bumps of the pinned `@mikedown/core` in both apps (M7 part 2).
3. Release 2.14.3 (callout fix). Note `npm run vsix` now also sets `packages/core` to the same version.
4. Optional: M8 (image upload API for Quantico Creek), M9.
5. Carry-overs: hand-check #9/#10 in the dev host; review re-checks 2026-10-26 and 2026-11-25 (`BACKLOG.md`); `planning/kevin-feedback-aug-08.md` M3/M9.

## Planning Docs

- `angular-core-extraction-plan.md` — **active.** Core package extraction + Angular wrapper + Quantico Creek integration. M0 to M4, T1, T2, M7 part 1 done; M5/M6 pending.
- `slash-commands-planning.md` — complete (2.11.0); ready to archive into `docs/`.
- `planning/kevin-feedback-aug-08.md` — M3 and M9 still open.
- `planning/HEADING-RENAME-LINKS.md`, `planning/IMAGE-PASTE.md` — shipped features' plans.
- `manual-test-script.md` — v2.10.0 manual pass, not yet run.
- `PLANNING.md` — original build plan (reserved root fixture).

## Key File Paths

- `angular-core-extraction-plan.md` — the plan; "Target architecture" has the intended `MikeDownHost` / `createMikeDownEditor` API
- `packages/core/src/editor-main.ts` — editor entry; header documents every message shape. `src/webview/editor-main.ts` is a thin import.
- `scripts/release-core.sh`, `scripts/sync-core-version.js` — core publish/pack and version sync
- `src/markdownEditorProvider.ts` — VS Code host side
- `packages/core/src/styles/` — stylesheets (tokenized in M3)
- `webpack.config.js` — the `tiptap-markdown` ES alias and `mainFields` ordering to preserve
- `~/git/lymestarter/lymestack-ownership.json`, `framework-package-design.md` — how LymeStack core folders/packages are owned and fed
- `~/git/quanticocreek/CLAUDE.md`, `agents.md` — target app conventions

## Recent Git Log

- `05738a2` Update resume notes after the 2.14.2 release
- `4eb4bc4` Release 2.14.2
- `ee2a484` Render math in HTML and PDF exports
- `b985dfd` Update resume notes after the 2.14.1 release
- `c8fc8c9` Release 2.14.1

## Any Other Notes

- **Launch the dev host with F5 or `npm run dev`** (no debugger). Cmd+R the dev window after every `npm run compile`.
- Patch release: `npm version patch --no-git-tag-version && npm run package && npx vsce package`, rename CHANGELOG `[Unreleased]`, commit `Release X.Y.Z`, lightweight tag `vX.Y.Z`. (`npm run vsix` always patch-bumps.) Core publish goes first; see CLAUDE.md Releasing.
- No Marketplace PAT is stored; Mike publishes by uploading the `.vsix` by hand.
- Bare `vitest run` picks up integration files and fails — use `npm run test:unit` / `test:edge` / `test:integration`.
- Quick GFM render check without a browser: `gh api markdown -f mode=gfm -f text='…'`.
- The harness's `typeInWysiwyg` bypasses input rules; use a `handleTextInput`-driven helper (see `math.test.ts`) to test them.
- Mutating integration tests: use a private fixture with teardown, never `test/workspace/sample.md`.
- Review asks: mzenker-PSS was asked again on #10; don't ask them a third time.
- Spell check defaults **off** — enable it before testing squiggles.
