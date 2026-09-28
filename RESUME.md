# MikeDown — Resume Prompt

## Project Overview

MikeDown is a VS Code custom editor extension: a WYSIWYG markdown editor built on TipTap/ProseMirror (webview bundle) with a Node extension host. Two webpack bundles — extension host (`src/`, node target, `dist/extension.js`) and webview (`src/webview/`, web target, `out/webview/editor-main.js`) — communicating only via `postMessage`. See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; three-place settings rule; tiptap-markdown webpack alias).

## Current Status

**2.12.0 is committed, tagged, and pushed (`main` + `v2.12.0` on GitHub), but NOT yet on the Marketplace.** The `.vsix` is built at the repo root (`mikedown-editor-2.12.0.vsix`).

- Blocked on publishing: no Marketplace PAT is stored (`vsce verify-pat interapp` → "Personal Access Token is mandatory"). Either run `npx vsce login interapp` with a new token (Azure DevOps, All accessible organizations, Marketplace → Manage) and then `npx vsce publish --packagePath mikedown-editor-2.12.0.vsix`, or upload the `.vsix` by hand on the publisher page.
- 2.12.0 shipped **KaTeX math** and **tags**; hands-on tested by Mike in the dev host.
- Tests: 808 unit, 38 integration, lint 0 errors.

## What's Done (this session)

- **Math** (`src/webview/math.ts`, `mathSyntax.ts`, `math.css`): `$inline$` / `$$display$$` atom nodes with NodeView click-to-edit, input rules (`$x$ ` and `$$ `), `/math` + `/inline-math`, `mikedown.renderMath` setting (off = raw source, still parsed). `markdownEscape.ts` escapes `$` only where it would open math, so prices round-trip unchanged. KaTeX CSS + woff2 fonts ship from `node_modules/katex/dist` (whitelisted in `.vscodeignore`; CSP has `font-src`).
- **Tags** (`src/tagSyntax.ts`, `tagExtract.ts`, `tagProvider.ts`, `src/webview/tag.ts`, `tagautocomplete.ts`, sidebar Tags section): workspace index + live merge of the current doc's unsaved tags; hex-color tokens (any all-hex run with a digit, or 6/8 hex letters) are skipped; `mikedown.tags.enabled` setting.
- Removed all leftover `console.log` debug output.
- **F5 now runs `npm run dev`** (no debugger). The `extensionHost` debugger attach hangs on this machine ("did not start in 10 seconds", "Could not find any debuggable target") even after updating VS Code to 1.139.1; earlier exthost aborts at startup were the same fault, not MikeDown code. "Run Extension (debugger)" is still in `launch.json` if breakpoints are needed.
- BACKLOG: backlink jump-to-line was already shipped in 2.6.2 (moved to Recently shipped).

## What's Next

1. **Publish 2.12.0 to the Marketplace** (see Current Status), then confirm with `npx vsce show interapp.mikedown-editor`.
2. **Optional follow-up offered, not decided:** make `mikedown.renderMath = false` disable math entirely (no parsing, no input rules, no `$` escaping) instead of just showing raw source.
3. **Review re-checks:** 2026-10-26 and 2026-11-25 (`npx vsce show interapp.mikedown-editor`, record in BACKLOG.md).
4. **Backlog candidates:** footnotes, definition lists, `[[toc]]`, image captions (see `BACKLOG.md`).
5. **Older carry-overs:** hotkeys `sourceMode` guard on `toggleBold`/`Italic`/`Strike`/`Highlight`/`Code`; Kevin's remote retest (WSL/Docker); `planning/kevin-feedback-aug-08.md` M3/M9.

## Planning Docs

- `slash-commands-planning.md` — complete (2.11.0); ready to archive into `docs/`.
- `planning/kevin-feedback-aug-08.md` — M3 and M9 still open.
- `manual-test-script.md` — v2.10.0 manual pass, not yet run.
- `PLANNING.md` — general planning doc (reserved root fixture).

## Key File Paths

- `src/webview/math.ts` / `mathSyntax.ts` — math nodes, markdown-it rules, NodeView; pure delimiter matcher
- `src/webview/markdownEscape.ts` — text escaping (incl. conditional `$`)
- `src/tagSyntax.ts`, `src/tagExtract.ts`, `src/tagProvider.ts` — tag regex/hex filter, extraction, workspace index (`getAllTags(excludeFsPath)`)
- `src/webview/tag.ts`, `tagautocomplete.ts`, `outlineSidebar.ts` — tag decorations, `#` autocomplete, sidebar sections
- `src/webview/editor-main.ts` — editor setup, Settings modal (`showSettingsModal`), live-tags merge (`refreshLiveTags`)
- `src/markdownEditorProvider.ts` — message routing, CSP/CSS list, `sendTagsToWebview`
- `test/unit/math.test.ts`, `tags.test.ts`, `sidebarTags.test.ts` — incl. `typeWithRules` helper for input-rule typing
- `test/harness/webviewHarness.ts` — jsdom harness that boots the real webview
- `test/workspace/math.md` — manual math sample

## Recent Git Log

- `7abc989` Release 2.12.0
- `0c19e54` Skip any all-hex tag token containing a digit (#0a, #a1b2c)
- `a522b89` Make F5 launch the dev host via npm run dev (no debugger)
- `a972299` Show unsaved tags in the sidebar and # autocomplete
- `71c1ec0` Don't treat hex colors like #2563eb as inline tags
- `a741933` Finish tags: # autocomplete, sidebar Tags section, setting
- `1619b25` Add tag support (frontmatter + inline #tags)
- `c7679fc` Add KaTeX math rendering for inline and display LaTeX

## Any Other Notes

- **Launch the dev host with F5 or `npm run dev`** (no debugger). Cmd+R the dev window after every `npm run compile`.
- Minor release recipe: `npm version minor --no-git-tag-version && npm run package && npx vsce package`, rename CHANGELOG `[Unreleased]`. (`npm run vsix` always patch-bumps.)
- Bare `vitest run` picks up integration files and fails — use `npm run test:unit` / `test:edge` / `test:integration`.
- The harness's `typeInWysiwyg` bypasses input rules; use a `handleTextInput`-driven helper (see `math.test.ts`) to test them.
- Mutating integration tests: use a private fixture with teardown, never `test/workspace/sample.md`.
- Spell check defaults **off** — enable it before testing squiggles.
- Check live marketplace state with `npx vsce show interapp.mikedown-editor` before assuming anything about what users have.
