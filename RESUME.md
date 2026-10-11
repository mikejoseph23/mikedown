# MikeDown — Resume Prompt

## Project Overview

MikeDown is a VS Code custom editor extension: a WYSIWYG markdown editor built on TipTap/ProseMirror (webview bundle) with a Node extension host. Two webpack bundles — extension host (`src/`, node target, `dist/extension.js`) and webview (`src/webview/`, web target, `out/webview/editor-main.js`) — communicating only via `postMessage`. See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; three-place settings rule; tiptap-markdown webpack alias).

## Current Status

**2.14.0 is released**: committed, tagged (`v2.14.0`), pushed, `.vsix` uploaded to the Marketplace by Mike (verification was pending at session end). Issues #7 and #8 have replies and are closed.

- Tests: 856 unit, lint 0 errors. Both features checked by hand in the dev host.
- Nothing unreleased on `main`.

## What's Done (2.14.0)

- **#7 — per-document image folders:** `mikedown.imagePaste.folder` expands `${docName}` (only that token; time tokens would split one doc's images across folders and break orphan-cleanup scoping). `expandFolderPattern` in `src/imagePaste.ts`, used by `resolveTargetFolder` so writes and cleanup both follow it. No new setting.
- **#8 — Ctrl/Cmd + wheel font size:** `src/webview/wheelZoom.ts` (trackpad pinch works too; deltas accumulate at 50 per 1px step; clamped 10–36; persisted silently 400ms after the gesture). New setting `mikedown.ctrlWheelZoom` (default `true`) wired in all three places; checkbox on the Appearance tab. Font-size slider widened from 12–28 to 10–36. Font size is global, so the zoom carries to other open tabs.
- **Also shipped in 2.14.0** (previously unreleased): footnotes (`[^n]`), format hotkeys no-op in source mode, floating-promise cleanup.
- **CLAUDE.md:** issue-reply convention: first person as Mike, name the release, one no-pressure Marketplace review ask per reporter.

## What's Next

1. **Confirm 2.14.0 is live:** `npx vsce show interapp.mikedown-editor`.
2. **Footnotes styling** never got a deliberate visual pass in the dev host; give it a look.
3. **Watch issues #7/#8** for follow-ups (reporter may want `${date}` in folders; it was deliberately left out).
4. **Review re-checks:** 2026-10-26 and 2026-11-25 (record in `BACKLOG.md`).
5. **Carry-overs:** heading-numbering follow-ups (cross-file links on renumber); `renderMath = false` disabling math entirely; backlog candidates (definition lists, `[[toc]]`, image captions); Kevin's remote retest; `planning/kevin-feedback-aug-08.md` M3/M9.

## Planning Docs

- `slash-commands-planning.md` — complete (2.11.0); ready to archive into `docs/`.
- `planning/kevin-feedback-aug-08.md` — M3 and M9 still open.
- `manual-test-script.md` — v2.10.0 manual pass, not yet run.
- `PLANNING.md` — general planning doc (reserved root fixture).

## Key File Paths

- `src/imagePaste.ts` — paste helpers; `expandFolderPattern`, `resolveTargetFolder`, `isInsideManagedFolder`
- `src/webview/wheelZoom.ts` — Ctrl/Cmd + wheel zoom; installed in `editor-main.ts` just before the `message` listener
- `src/markdownEditorProvider.ts` — `handleSaveSettings` (settings persistence; `silent: true` suppresses the toast), `sendSettingsToWebview`
- `src/webview/editor-main.ts` — Settings modal (`showSettingsModal`), settings broadcast handler
- `test/unit/imagePaste.test.ts`, `test/unit/wheelZoom.test.ts`

## Recent Git Log

- `9cd2d76` Ask for a review only once per reporter
- `9a8336e` Issue replies are written in first person
- `c86fc3f` Release 2.14.0
- `31fdda6` Note issue-reply convention: ask for a Marketplace review once shipped
- `c7d71f4` Ctrl/Cmd + mouse wheel adjusts editor font size, with toggle setting (#8)
- `f0dd1ee` Support ${docName} in image paste folder for per-document image folders (#7)

## Any Other Notes

- **Launch the dev host with F5 or `npm run dev`** (no debugger). Cmd+R the dev window after every `npm run compile`.
- Minor release recipe: `npm version minor --no-git-tag-version && npm run package && npx vsce package`, rename CHANGELOG `[Unreleased]`, update README settings table, commit `Release X.Y.Z`, tag `vX.Y.Z`. (`npm run vsix` always patch-bumps.)
- No Marketplace PAT is stored; Mike publishes by uploading the `.vsix` by hand.
- Bare `vitest run` picks up integration files and fails — use `npm run test:unit` / `test:edge` / `test:integration`.
- The harness's `typeInWysiwyg` bypasses input rules; use a `handleTextInput`-driven helper (see `math.test.ts`) to test them.
- Mutating integration tests: use a private fixture with teardown, never `test/workspace/sample.md`.
- Spell check defaults **off** — enable it before testing squiggles.
