# MikeDown — Resume Prompt

## Project Overview

MikeDown is a VS Code custom editor extension: a WYSIWYG markdown editor built on TipTap/ProseMirror (webview bundle) with a Node extension host. Two webpack bundles — extension host (`src/`, node target, `dist/extension.js`) and webview (`src/webview/`, web target, `out/webview/editor-main.js`) — communicating only via `postMessage`. See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; three-place settings rule; tiptap-markdown webpack alias).

## Current Status

**2.14.1 is tagged and pushed (`v2.14.1`); Mike still has to upload `mikedown-editor-2.14.1.vsix` to the Marketplace.** Issue #9 has a reply (already says "fixed in 2.14.1") and is closed.

- Tests: 858 unit, lint 0 errors. Fix verified by unit tests only, not by hand in the dev host.
- Nothing unreleased on `main`.

## What's Done

- **2.14.1 — #9, line breaks in table cells:** Enter in a cell made two paragraphs, so the whole table fell back to raw HTML on save, which reloads as literal text because `html: false`. Now `TableAligned` (`src/webview/table-align.ts`) joins paragraph-only cells with `<br>`, and a markdown-it core rule (`tableBreaksToHardBreaks`) turns `<br>` in cells into hard breaks. Files already converted to HTML are not repaired.
- **2.14.0:** #7 `${docName}` image folders, #8 Ctrl/Cmd + wheel font size, footnotes, source-mode hotkey fix.

## What's Next

1. **Confirm 2.14.1 is live** after Mike's upload: `npx vsce show interapp.mikedown-editor`.
2. **Hand-check #9 in the dev host:** Enter and Shift+Enter in a table cell, save, reopen.
3. **Possible follow-up:** HTML-fallback tables (merged cells, lists in cells) still reload as literal text with `html: false`. Decide whether to parse `<table>` blocks or keep tables pipe-only.
4. **Footnotes styling** never got a deliberate visual pass in the dev host.
5. **Review re-checks:** 2026-10-26 and 2026-11-25 (record in `BACKLOG.md`).
6. **Carry-overs:** heading-numbering follow-ups (cross-file links on renumber); `renderMath = false` disabling math entirely; backlog candidates (definition lists, `[[toc]]`, image captions); Kevin's remote retest; `planning/kevin-feedback-aug-08.md` M3/M9.

## Planning Docs

- `slash-commands-planning.md` — complete (2.11.0); ready to archive into `docs/`.
- `planning/kevin-feedback-aug-08.md` — M3 and M9 still open.
- `manual-test-script.md` — v2.10.0 manual pass, not yet run.
- `PLANNING.md` — general planning doc (reserved root fixture).

## Key File Paths

- `src/webview/table-align.ts` — table serializer (alignment, `<br>` joins, HTML fallback) and `<br>` parse rule
- `src/webview/markdownText.ts` — text/hardBreak serializers (hard break in a table writes `<br>`)
- `src/markdownEditorProvider.ts` — host side; settings persistence, `postMessage` routing
- `src/webview/editor-main.ts` — editor setup (`Markdown.configure`, `html: false`, `breaks: true`), Settings modal
- `test/unit/table-align.test.ts` — includes the #9 regression tests

## Recent Git Log

- `c8fc8c9` Release 2.14.1
- `38ac3ad` Keep tables with line breaks in cells as markdown
- `f260cc9` Update resume notes after the 2.14.0 release
- `9cd2d76` Ask for a review only once per reporter
- `9a8336e` Issue replies are written in first person
- `c86fc3f` Release 2.14.0

## Any Other Notes

- **Launch the dev host with F5 or `npm run dev`** (no debugger). Cmd+R the dev window after every `npm run compile`.
- Patch release: same recipe with `npm version patch` (no README change unless settings changed).
- Review asks: check the memory note on reporters already asked (mzenker-PSS has been) before adding the Marketplace ask.
- Minor release recipe: `npm version minor --no-git-tag-version && npm run package && npx vsce package`, rename CHANGELOG `[Unreleased]`, update README settings table, commit `Release X.Y.Z`, tag `vX.Y.Z`. (`npm run vsix` always patch-bumps.)
- No Marketplace PAT is stored; Mike publishes by uploading the `.vsix` by hand.
- Bare `vitest run` picks up integration files and fails — use `npm run test:unit` / `test:edge` / `test:integration`.
- The harness's `typeInWysiwyg` bypasses input rules; use a `handleTextInput`-driven helper (see `math.test.ts`) to test them.
- Mutating integration tests: use a private fixture with teardown, never `test/workspace/sample.md`.
- Spell check defaults **off** — enable it before testing squiggles.
