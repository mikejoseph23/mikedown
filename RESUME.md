# MikeDown — Resume Prompt

## Project Overview

MikeDown is a VS Code custom editor extension: a WYSIWYG markdown editor built on TipTap/ProseMirror (webview bundle) with a Node extension host. Two webpack bundles — extension host (`src/`, node target, `dist/extension.js`) and webview (`src/webview/`, web target, `out/webview/editor-main.js`) — communicating only via `postMessage`. See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; three-place settings rule; tiptap-markdown webpack alias).

## Current Status

**All Kevin-feedback work (v2.10.0) is implemented, tested, and merged on `main` — waiting only on Mike's two manual actions before shipping.**

- Just finished: full orchestrated run of `kevin-feedback-aug-08.md` — remote export fix, spell checker, default-editor discoverability, all with test coverage. Version bumped to 2.10.0, CHANGELOG written.
- In flight (user-only): hands-on Dev Container verification of the remote export fix; sending the drafted follow-up message to Kevin.
- Nothing blocked. `kevin-feedback-aug-08.md` is untracked — commit or archive it when the plan closes.

## What's Done

- **Remote export/print/view-in-browser fix** (`914320c`/`35d28fb`): `src/exportServer.ts` — token-scoped loopback HTTP server + `vscode.env.asExternalUri()` when `vscode.env.remoteName` is set; local behavior unchanged; save-then-instruct fallback; `extensionKind: ["ui","workspace"]` added.
- **Spell checker** (`2f3e740`/`9b1f0c9` + gap `52bef90`): `src/webview/spellcheck.ts` — nspell + bundled hunspell en/en-GB dictionaries (`dictionaries/`), ProseMirror decoration squiggles (info-blue), context-menu corrections, Spelling settings tab, `mikedown.spellCheck.*` settings, `cSpell.words` honored read-only, `==highlights==` excluded. User visually signed off from screenshots.
- **Default-editor discoverability** (`6591bea`): first-run prompt (`src/defaultEditorPrompt.ts`), `mikedown.setAsDefaultEditor` command, above-the-fold README section.
- **Tests** (`afd5417`, `392158c`, `dee0958`, `6a2ccf4`): unit 362/362, edge 22/22, integration 20/20. Integration harness itself was repaired — `@vscode/test-electron` upgraded to 3.x (`ca3ab25`) because VS Code 1.133 renamed its binary `Electron` → `Code`.
- **Follow-up draft for Kevin** written (in `.orchestrator/kevin-feedback-aug-08/processed/worker-summary-m9-kevin-followup.md`).

## What's Next

1. **Mike's hands-on checks** (M3 in `kevin-feedback-aug-08.md`): in a real Dev Container — Export PDF, View in Browser, Export HTML; repeat locally for regression; spot-check image paste + backlinks sidebar (the `extensionKind` change means the extension may now run UI-side against remote files — riskiest area). Then mark M3's hands-on checkboxes and the milestone ✅.
2. **Mike sends the Kevin follow-up** (draft in the M9 summary; asks about his forgotten item and spell-check default preference — his answer may flip `spellCheck.enabled`'s default).
3. After both: consider `npm run vsix` to package/ship 2.10.0, archive the planning doc (`/iadev:archive-planning-document`), and commit `kevin-feedback-aug-08.md`'s final state. Candidate follow-ups logged in the plan: vestigial `mikedown.defaultEditor` setting (wire up or remove), repo-wide lint debt (~326 problems), Playwright-harness `--vscode-input-*` token fidelity.

## Planning Docs

- `kevin-feedback-aug-08.md` — the Aug 8 Kevin call plan; all milestones complete except M3's user hands-on portion and M9's send. Full progress log + embedded spell-check screenshots inside.
- `PLANNING.md` — pre-existing general planning doc (reserved root fixture).

## Key File Paths

- `src/export.ts` / `src/exportServer.ts` — export + remote loopback server
- `src/webview/spellcheck.ts` (+ `spellcheck.css`, `nspell.d.ts`), `dictionaries/` — spell checker
- `src/defaultEditorPrompt.ts` — first-run default-editor prompt
- `src/markdownEditorProvider.ts` — CSP (`connect-src`), `localResourceRoots`, message routing
- `test/playwright-harness/spellcheck.html` — standalone harness booting the real webview bundle
- `.orchestrator/kevin-feedback-aug-08/` — orchestrator session state, worker summaries (`processed/`), screenshots

## Recent Git Log

- `52bef90` Exclude highlighted text from spell check, fix dark settings-modal controls
- `6a2ccf4` Add spell checker test coverage: unit tests, settings, Playwright harness
- `9b1f0c9` Merge spell checker (nspell + bundled hunspell dictionaries, decoration squiggles)
- `dee0958` Fix export integration test to drive real commands instead of a raw src import
- `2f3e740` Add spell checking to the WYSIWYG editor
- `ca3ab25` Update @vscode/test-electron to 3.x so integration tests launch on current VS Code
- `392158c` Add tests for remote export path selection and the loopback export server
- `35d28fb` Merge remote export fix (asExternalUri loopback server, extensionKind)

## Any Other Notes

- Integration-test gotcha: any test that opens the custom editor via `vscode.openWith` persists `workbench.editorAssociations` at Workspace scope — save/restore BOTH scopes in suiteSetup/suiteTeardown or it leaks into `defaultEditorCommand.test.ts`. (`test/workspace/.vscode/` is untracked fallout from this — safe to delete or gitignore.)
- Worktree workers get no `node_modules` — symlink from the main repo to build.
- Do NOT trust the M1 worker note about `Call with Kevin.m4a`/`.txt` on the Desktop — those files don't exist (verified); only the error screenshot is real.
- Bare `vitest run` picks up integration files and fails — use `npm run test:unit` / `test:edge` / `test:integration`.
