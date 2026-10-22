# MikeDown — Resume Prompt

## Project Overview

MikeDown is a VS Code custom editor extension: a WYSIWYG markdown editor built on TipTap/ProseMirror (webview bundle) with a Node extension host. Two webpack bundles — extension host (`src/`, node target, `dist/extension.js`) and webview (`src/webview/`, web target, `out/webview/editor-main.js`) — communicating only via `postMessage`. See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; three-place settings rule; tiptap-markdown webpack alias).

## Current Status

**New initiative planned, not started: extract the webview editor into `@mikedown/core` and wrap it for Angular.** Plan is in `angular-core-extraction-plan.md` (uncommitted, repo root). 2.14.2 is live on the Marketplace; `main` is 3 commits ahead of `origin/main` and tag `v2.14.2` is not pushed.

- The plan's first milestone (M0) is a decisions file + Angular 14 / TS 4.7 compatibility spike that Mike approves before any code moves.
- `npm whoami` is not logged in; needed before M4 (publish).
- Push still needs Mike's say-so: `git push origin main v2.14.2`.

## What's Done

- **Planning (2026-10-22):** `angular-core-extraction-plan.md` — 14 milestones (M0–M9, T1–T4). Key findings baked in: webview has ~50 `postMessage` sites and one `acquireVsCodeApi`; 81 `--vscode-*` CSS vars to tokenize; LymeStarter's Angular side is vendored via `lymetools sync` (no npm feed), so the wrapper lives in `~/git/lymestarter/ng-app/src/app/lymestack-shared/mikedown/`; Quantico Creek legacy app (`~/git/quanticocreek/quantico-creek-angular-app`) is Angular 14 / TS 4.7 and not a scaffold, so it copies the wrapper by hand.
- **2.14.2:** #10 math in HTML/PDF exports (KaTeX CSS + fonts inlined in `src/export.ts`). **2.14.1:** #9 line breaks in table cells. **2.14.0:** #7, #8, footnotes, source-mode hotkey fix.

## What's Next

1. **Commit the plan** (`angular-core-extraction-plan.md`) if Mike hasn't.
2. **Run M0** from the plan (Opus): check the `@mikedown` npm scope, spike TipTap 3 under Angular 14 / TS 4.7 in the scratchpad, pick the core build tool (default tsup), produce the message-disposition table, find the Quantico Creek target screen, write `core-extraction-decisions.md`. **Stop for Mike's approval** before M1.
3. Then M1 (workspace restructure) → M2 (host adapter + `createMikeDownEditor`) → T1, strictly sequential in this repo. See the plan's Parallel Development section.
4. Carry-overs: push `main` + `v2.14.2`; hand-check #9/#10 in the dev host; review re-checks 2026-10-26 and 2026-11-25 (`BACKLOG.md`); `planning/kevin-feedback-aug-08.md` M3/M9.

## Planning Docs

- `angular-core-extraction-plan.md` — **active.** Core package extraction + Angular wrapper + Quantico Creek integration. M0 not started.
- `slash-commands-planning.md` — complete (2.11.0); ready to archive into `docs/`.
- `planning/kevin-feedback-aug-08.md` — M3 and M9 still open.
- `planning/HEADING-RENAME-LINKS.md`, `planning/IMAGE-PASTE.md` — shipped features' plans.
- `manual-test-script.md` — v2.10.0 manual pass, not yet run.
- `PLANNING.md` — original build plan (reserved root fixture).

## Key File Paths

- `angular-core-extraction-plan.md` — the plan; "Target architecture" has the intended `MikeDownHost` / `createMikeDownEditor` API
- `src/webview/editor-main.ts` — 5,712 lines; `acquireVsCodeApi` at ~216, `postMessage` sites throughout, inbound message switch near the end; header documents every message shape
- `src/markdownEditorProvider.ts` — host side; `getHtmlForWebview` (~2160) is the DOM/CSS shell the core will own
- `src/webview/*.css` — 20 stylesheets using `--vscode-*` vars (M3 tokenizes)
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
- Patch release: `npm version patch --no-git-tag-version && npm run package && npx vsce package`, rename CHANGELOG `[Unreleased]`, commit `Release X.Y.Z`, lightweight tag `vX.Y.Z`. (`npm run vsix` always patch-bumps.) M7 of the plan adds a core publish step to this.
- No Marketplace PAT is stored; Mike publishes by uploading the `.vsix` by hand.
- Bare `vitest run` picks up integration files and fails — use `npm run test:unit` / `test:edge` / `test:integration`.
- Quick GFM render check without a browser: `gh api markdown -f mode=gfm -f text='…'`.
- The harness's `typeInWysiwyg` bypasses input rules; use a `handleTextInput`-driven helper (see `math.test.ts`) to test them.
- Mutating integration tests: use a private fixture with teardown, never `test/workspace/sample.md`.
- Review asks: mzenker-PSS was asked again on #10; don't ask them a third time.
- Spell check defaults **off** — enable it before testing squiggles.
