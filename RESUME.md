# MikeDown — Resume Prompt

## Project Overview

MikeDown is a VS Code custom editor extension: a WYSIWYG markdown editor built on TipTap/ProseMirror (webview bundle) with a Node extension host. Two webpack bundles — extension host (`src/`, node target, `dist/extension.js`) and webview (`src/webview/`, web target, `out/webview/editor-main.js`) — communicating only via `postMessage`. See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; three-place settings rule; tiptap-markdown webpack alias).

## Current Status

**2.14.2 is live on the Marketplace, but `main` (2 commits ahead) and tag `v2.14.2` are NOT pushed yet.** Issue #10 has a reply ("fixed in 2.14.2") and is closed.

- Tests: 859 unit pass, lint 0 errors.
- Push needs Mike's say-so: `git push origin main v2.14.2`.

## What's Done

- **2.14.2 — #10, math in exports:** exported HTML/PDF had KaTeX's rendered markup but no stylesheet, so formulas printed as overlapping HTML+MathML text. `buildFullHtml` (`src/export.ts`) now inlines `katex.min.css` with woff2 fonts as data URIs when the body contains `class="katex`. `setExportExtensionPath` is called from `activate()`. Verified visually via headless Chrome on the reporter's file.
- **#10 numbering ask, declined on principle:** Mike wants MikeDown to stay standards-only (output must render in any markdown viewer), so no auto-numbering or `\eqref`. Suggested workaround `<a id="eq-x"></a>` before the `$$` block + `[Eq. (1)](#eq-x)`; verified it round-trips in MikeDown, survives export, and GitHub's renderer keeps it (`user-content-` prefix).
- **2.14.1:** #9 line breaks in table cells. **2.14.0:** #7, #8, footnotes, source-mode hotkey fix.

## What's Next

1. **Push** `main` and `v2.14.2` once Mike approves.
2. **Hand-check #10 in the dev host:** Print / Export as PDF on a doc with `$$…\tag{1}$$` and inline math.
3. **Hand-check #9 in the dev host:** Enter and Shift+Enter in a table cell, save, reopen.
4. **Possible follow-up:** HTML-fallback tables (merged cells, lists in cells) still reload as literal text with `html: false`.
5. **Review re-checks:** 2026-10-26 and 2026-11-25 (record in `BACKLOG.md`).
6. **Carry-overs:** heading-numbering follow-ups; `renderMath = false` disabling math entirely; backlog candidates (definition lists, `[[toc]]`, image captions); Kevin's remote retest; `planning/kevin-feedback-aug-08.md` M3/M9.

## Planning Docs

- `slash-commands-planning.md` — complete (2.11.0); ready to archive into `docs/`.
- `planning/kevin-feedback-aug-08.md` — M3 and M9 still open.
- `planning/HEADING-RENAME-LINKS.md`, `planning/IMAGE-PASTE.md` — shipped features' plans.
- `manual-test-script.md` — v2.10.0 manual pass, not yet run.
- `PLANNING.md` — general planning doc (reserved root fixture).

## Key File Paths

- `src/export.ts` — export HTML builder (`buildFullHtml`, `katexStylesheet`), print/browser flows
- `src/webview/math.ts` / `mathSyntax.ts` — KaTeX math nodes and delimiter logic
- `src/webview/htmlanchor.ts` — `<a id>` anchor passthrough (the #10 linking workaround)
- `src/markdownEditorProvider.ts` — host side; `postMessage` routing, export message handlers
- `test/unit/export.test.ts` — includes the KaTeX inlining test

## Recent Git Log

- `4eb4bc4` Release 2.14.2
- `ee2a484` Render math in HTML and PDF exports
- `b985dfd` Update resume notes after the 2.14.1 release
- `c8fc8c9` Release 2.14.1
- `38ac3ad` Keep tables with line breaks in cells as markdown

## Any Other Notes

- **Launch the dev host with F5 or `npm run dev`** (no debugger). Cmd+R the dev window after every `npm run compile`.
- Patch release: `npm version patch --no-git-tag-version && npm run package && npx vsce package`, rename CHANGELOG `[Unreleased]`, commit `Release X.Y.Z`, lightweight tag `vX.Y.Z`. Minor: same with `minor`, plus README settings table. (`npm run vsix` always patch-bumps.)
- No Marketplace PAT is stored; Mike publishes by uploading the `.vsix` by hand.
- Review asks: mzenker-PSS was asked again on #10 at Mike's request; don't ask them a third time.
- Bare `vitest run` picks up integration files and fails — use `npm run test:unit` / `test:edge` / `test:integration`.
- Quick GFM render check without a browser: `gh api markdown -f mode=gfm -f text='…'`.
- The harness's `typeInWysiwyg` bypasses input rules; use a `handleTextInput`-driven helper (see `math.test.ts`) to test them.
- Mutating integration tests: use a private fixture with teardown, never `test/workspace/sample.md`.
- Spell check defaults **off** — enable it before testing squiggles.
