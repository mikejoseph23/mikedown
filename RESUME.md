# MikeDown — Resume Prompt

## Project Overview

MikeDown is a VS Code custom editor extension: a WYSIWYG markdown editor built on TipTap/ProseMirror (webview bundle) with a Node extension host. Two webpack bundles — extension host (`src/`, node target, `dist/extension.js`) and webview (`src/webview/`, web target, `out/webview/editor-main.js`) — communicating only via `postMessage`. See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; three-place settings rule; tiptap-markdown webpack alias).

## Current Status

**2.13.0 is released**: committed, tagged (`v2.13.0`), pushed, and live on the Marketplace (confirmed with `npx vsce show`). Issue #6 has a reply describing the feature; waiting to see if the requester follows up.

- Tests: 831 unit, 38 integration, lint 0 errors.

## What's Done (this session)

- **Heading numbering (#6), written into the markdown.** First built as display-only CSS counters, then reworked so numbers are real heading text (`## 1.2 Setup`) and portable to any renderer.
  - `mikedown.headingNumbering` (`off` / `fromH1` / `fromH2`, default `off`) only reveals a **1.2** toolbar toggle that numbers or un-numbers the current document.
  - Whether a doc is numbered is detected from its headings (`isNumbered`: at least half carry a plausible prefix of the right depth, no part larger than the heading count), so there's no per-file state. `## 2024 Review` doesn't count as a number.
  - Numbered docs renumber live (400ms debounce, out of undo history). The heading under the cursor is skipped until the cursor leaves. Files are never renumbered on open (`numbersStale` is only set by user edits).
  - In-doc `#slug` links are repointed; the rename detector's baseline is kept in step. Numbering starts at the shallowest level used (no `0.1`).
  - CSS-counter plumbing removed from export (numbers are just text now).
- **Settings modal redesign** (done in another context with Fable): row layout with dividers, selects sized to content, styling moved to `src/webview/settings-modal.css`.
- 2.12.1 (H4 to H6 in the format menus) and 2.12.0 (KaTeX math, tags) were already on the Marketplace.

## What's Next

1. **Watch issue #6** for pushback on the numbering design.
2. **Possible numbering follow-ups (not decided):** update cross-file links when headings renumber (left out to avoid a prompt on every renumber); headings that start with an emoji/image or have a mark boundary inside the number are skipped.
3. **Optional follow-up offered earlier, not decided:** make `mikedown.renderMath = false` disable math entirely.
4. **Review re-checks:** 2026-10-26 and 2026-11-25 (`npx vsce show interapp.mikedown-editor`, record in BACKLOG.md).
5. **Backlog candidates:** footnotes, definition lists, `[[toc]]`, image captions (see `BACKLOG.md`).
6. **Older carry-overs:** hotkeys `sourceMode` guard on `toggleBold`/`Italic`/`Strike`/`Highlight`/`Code`; Kevin's remote retest (WSL/Docker); `planning/kevin-feedback-aug-08.md` M3/M9.

## Planning Docs

- `slash-commands-planning.md` — complete (2.11.0); ready to archive into `docs/`.
- `planning/kevin-feedback-aug-08.md` — M3 and M9 still open.
- `manual-test-script.md` — v2.10.0 manual pass, not yet run.
- `PLANNING.md` — general planning doc (reserved root fixture).

## Key File Paths

- `src/headingNumbering.ts` — pure numbering logic (`sectionNumbers`, `isNumbered`, `renumberEdits`, `stripEdits`)
- `src/webview/editor-main.ts` — numbering wiring sits right after the Heading Rename block (`applyNumberingEdits`, `renumberLive`, `toggleHeadingNumbers`); toolbar button in `buildCondensedToolbar`; Settings modal (`showSettingsModal`)
- `src/webview/settings-modal.css` — Settings modal styling
- `test/unit/headingNumbering.test.ts`, `headingNumberingEditor.test.ts` — logic + harness tests
- `test/harness/webviewHarness.ts` — jsdom harness that boots the real webview

## Recent Git Log

- `Release 2.13.0`
- `216209c` Write heading numbers into the markdown (#6)
- `1c93b55` Redesign Settings modal layout and move its styling to CSS
- `061042c` Enable heading numbering (#6)
- `193d94c` Release 2.12.1

## Any Other Notes

- **Launch the dev host with F5 or `npm run dev`** (no debugger). Cmd+R the dev window after every `npm run compile`.
- Minor release recipe: `npm version minor --no-git-tag-version && npm run package && npx vsce package`, rename CHANGELOG `[Unreleased]`. (`npm run vsix` always patch-bumps.)
- No Marketplace PAT is stored; Mike publishes by uploading the `.vsix` by hand.
- Bare `vitest run` picks up integration files and fails — use `npm run test:unit` / `test:edge` / `test:integration`.
- The harness's `typeInWysiwyg` bypasses input rules; use a `handleTextInput`-driven helper (see `math.test.ts`) to test them.
- Mutating integration tests: use a private fixture with teardown, never `test/workspace/sample.md`.
- Spell check defaults **off** — enable it before testing squiggles.
- Check live marketplace state with `npx vsce show interapp.mikedown-editor` before assuming anything about what users have.
