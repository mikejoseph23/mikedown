# MikeDown — Resume Prompt

## Project Overview

MikeDown is a VS Code custom editor extension: a WYSIWYG markdown editor built on TipTap/ProseMirror (webview bundle) with a Node extension host. Two webpack bundles — extension host (`src/`, node target, `dist/extension.js`) and webview (`src/webview/`, web target, `out/webview/editor-main.js`) — communicating only via `postMessage`. See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; three-place settings rule; tiptap-markdown webpack alias).

## Current Status

**2.10.1 hotfix is built, committed, pushed, and being uploaded to the marketplace by the user — it fixes a regression that made 2.10.0 completely unusable in WSL/Docker/Dev Container sessions.**

- Just finished: diagnosed and fixed Kevin's "No git history found for this file / editor won't load" report. Root cause: 2.10.0's remote print fix (`914320c`) added `extensionKind: ["ui","workspace"]`, which made VS Code run the extension on the local UI host in remote sessions; ordinary remote files then arrived as `vscode-remote://` URIs, which the diff-view detector treated as a git diff → failed `git show` → warning toast → panel disposed. Editor never loaded remotely at all.
- The fix (`90a1080`): `extensionKind` is now `["workspace","ui"]` (remote-side preferred — where the 2.10.0 loopback export server was designed to run anyway), and the diff detector uses an allowlist of diff schemes (`git`, `gitfs`, `pr`) instead of "anything non-`file://`" (`src/markdownEditorProvider.ts` ~line 169).
- `mikedown-editor-2.10.1.vsix` (3.73MB, 51 files, dictionaries verified inside) is at the repo root. Tests re-run green before packaging: unit 372/372, integration 20/20.
- `main` + tags `v2.10.0` and `v2.10.1` are pushed to GitHub. User is publishing 2.10.1 via the marketplace site right now.
- Correction to the previous resume: 2.10.0 WAS published to the marketplace on Aug 13 (317 installs on the extension) — that's how Kevin got the broken build.

## What's Done

- **2.10.1 remote-loading hotfix** (`90a1080`) — see Current Status.
- **Remote export/print/view-in-browser fix** (`914320c`/`35d28fb`): `src/exportServer.ts` — token-scoped loopback HTTP server + `vscode.env.asExternalUri()` when `vscode.env.remoteName` is set.
- **Spell checker** (2.10.0): `src/webview/spellcheck.ts` — nspell + bundled hunspell en/en-GB dictionaries, decoration squiggles, context-menu corrections, Spelling settings tab, `cSpell.words` honored read-only. Ships **off by default**.
- **Custom dictionary UI at scale** (`54dfb4b`, `dddbc4c`): sorted display, filter box past 8 words, columns past 25, remove-by-value bug fixed.
- **Default-editor discoverability** (`6591bea`): first-run prompt + command.

## What's Next

1. **Confirm 2.10.1 went live** on the marketplace, then **message Kevin** to update and retest: (a) editor loads against WSL and Docker repos, (b) print/export from a Docker-stored doc — the original bug, which has STILL never been human-verified across a remote boundary. Kevin is the de facto tester; he reported today (Aug 19) that MikeDown "won't load anything" remotely.
2. **Kevin follow-up email** may still be pending — draft was in Gmail (thread `19ffde1e6eeb746b`, kevin.phifer@theoreticallyimpossible.org) re: spell check off by default + his forgotten fourth item. Check whether it was ever sent; consider folding in the 2.10.1 news.
3. **Manual pass of `manual-test-script.md`** (the 2.10.0 features were shipped without it): dictionary UI at 4/26/100 words in both themes, filtered-removal correctness, right-click → Add to Dictionary, and ideally a real Dev Container print test.
4. **Mark M3/M9 complete** in `planning/kevin-feedback-aug-08.md` once verified, then archive it (`/iadev:archive-planning-document`).

## Planning Docs

- `planning/kevin-feedback-aug-08.md` — Aug 8 Kevin call plan. M1–M9 all ✅ except M3 (hands-on remote checks pending) and M9 (follow-up email).
- `manual-test-script.md` — the v2.10.0 manual pass, still not executed.
- `PLANNING.md` — pre-existing general planning doc (reserved root fixture).
- `wikilink-support-plan.md` — shipped in 2.9.0; candidate for archiving.
- `planning/HEADING-RENAME-LINKS.md`, `planning/IMAGE-PASTE.md` — done, historical.

## Key File Paths

- `src/markdownEditorProvider.ts` — diff-view detection allowlist (~line 169), postMessage routing, the central host file
- `src/extension.ts` — `mikedown.showDiff` / "No git history" warning (~line 206)
- `src/export.ts` / `src/exportServer.ts` — export + remote loopback server
- `package.json` — `extensionKind: ["workspace","ui"]` (~line 41); order is load-bearing, see 2.10.1
- `src/webview/spellcheck.ts` — checker + dictionary-view helpers
- `src/webview/editor-main.ts` — Settings modal; custom-dictionary block in `showSettingsModal` ~lines 1350–1500
- `dictionaries/en`, `dictionaries/en-GB` — bundled hunspell files (missing = silent runtime failure; re-verify in every .vsix)
- `test/unit/spellcheckSettings.test.ts` — dictionary regression coverage

## Recent Git Log

- `90a1080` Fix editor not loading in WSL/Docker remote sessions
- `6872b28` Update resume prompt for the 2.10.0 release state
- `dddbc4c` Switch the custom dictionary to a columned list past 25 words
- `54dfb4b` Make the custom dictionary UI scale; default spell check off
- `dc1ed3f` moved planning doc out of root.
- `b1f2ed9` Misc changes.
- `52bef90` Exclude highlighted text from spell check, fix dark settings-modal controls

## Any Other Notes

- **A stale Extension Development Host shows the old UI.** Cmd+R after every `npm run compile`.
- `grep` treats `dist/extension.js` as binary — use `grep -a` when probing the bundle.
- Spell check defaults **off** — enable it before testing or squiggles never appear.
- Bare `vitest run` picks up integration files and fails — use `npm run test:unit` / `test:edge` / `test:integration`.
- `npm run vsix` patch-bumps the version itself — don't bump manually first.
- Integration-test gotcha: tests using `vscode.openWith` persist `workbench.editorAssociations` at Workspace scope — save/restore BOTH scopes or it leaks into `defaultEditorCommand.test.ts`.
- `npm run lint` baseline: ~241 errors under `src/webview/` from tsconfig exclusion — pre-existing, not new debt.
- `addWordToList` returns the identical array reference on a no-op — intentional, don't "clean up".
- Check live marketplace state with `npx vsce show interapp.mikedown-editor` before assuming anything about what users have.
