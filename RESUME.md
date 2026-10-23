# MikeDown — Resume Prompt

## Project Overview

MikeDown is a VS Code custom editor extension: a WYSIWYG markdown editor built on TipTap/ProseMirror with a Node extension host. Since 2026-10-22 it is an npm workspace: the editor lives in `packages/core` (`@mikedown/core`, framework-agnostic, `createMikeDownEditor(container, { host, features })` + `MikeDownHost` adapter) and `src/webview/editor-main.ts` is a thin VS Code shell (`VsCodeHost`, one `postMessage` per host method). An Angular `ControlValueAccessor` wrapper `<lyme-markdown-editor>` lives in LymeStarter as an **opt-in** folder and is copied by hand into the Quantico Creek apps. See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; three-place settings rule; `tiptap-markdown` ES alias).

## Current Status

**Core extraction and Angular wrapper are done (M0–M9, M11, T1–T4 signed off). Everything is pushed in all repos. Remaining: Mike's publish, M8 hands-on, M10, a 2.14.3 patch.**

- `@mikedown/core` `0.1.0-rc.1` is **not published**: needs `npm login` + the `mikedown` npm org, then `npm publish -w packages/core --tag rc --access public`. Downstream apps use a vendored `file:` tarball until then. Mike still has to confirm versioning (core tied to the extension version vs. its own rc line).
- M7 version bumps in LymeStarter and Quantico Creek wait on the publish (drop the tarball, pin the registry version).
- M8 (image upload, Quantico KB editor) code is done; the paste → save → reload hands-on in Chrome is pending, plus Mike's OK on the anonymous image GET policy.
- M10 (bot protection for Quantico Creek AI endpoints) not started; needs Mike's scope call (captcha, rate limiting, or both; assistant API only vs. all AI endpoints).
- Callout duplication fix (`f1befc5`) is unreleased and the bug is in shipped 2.14.2: a 2.14.3 patch is needed. `main` now contains the whole extraction, so decide between releasing from `main` or cherry-picking onto `v2.14.2`.
- Merge LymeStarter `develop` → `main` so the `setup-project-lymestarter` skill (pins `main`) sees `optionalFolders`.

## What's Done

- **2026-10-22, one day:** M0 decisions (`core-extraction-decisions.md`), M1 workspace, M2 host adapter (~50 `postMessage` sites → `MikeDownHost`), T1 parity (906 unit / 22 edge / 47 integration), M3 theme tokens (81 `--vscode-*` → 54 `--mikedown-*`), M4 tsup build + demo, T2, M5 Angular wrapper, T3, M6 Quantico KB article editor (AI prompt form too), T4, M7 release wiring + docs, M8 upload endpoint, M9 assistant-app lead notes editor (behind `leadNotesEditor` flag), M11 opt-in wrapper: lymetools `optionalFolders` class + `lymetools adopt <path>`, wrapper moved to `lymestack-optional/mikedown/`, `scaffold app` strips it and was repaired end to end (lymetools 938 tests).
- **2.14.2:** #10 math in HTML/PDF exports. **2.14.1:** #9 line breaks in table cells. **2.14.0:** #7, #8, footnotes, source-mode hotkey fix.

## What's Next

1. Mike: `npm login`, create the `mikedown` org, publish rc.1 (command above). Then dispatch the M7 version-bump leftovers in LymeStarter and Quantico Creek.
2. M8 hands-on: `http://localhost:4200/admin/knowledge-base` → edit → paste a screenshot → save → reload; image renders in editor and public view. Tick the M8 box in the plan.
3. Decide 2.14.3 route and release it (callout fix).
4. M10 after Mike's scope call (Opus, Quantico Creek API; not in the same wave as M8 work).
5. Follow-ups queued in `.orchestrator/angular-core-extraction-plan/state.json#followUps` and the plan's Progress Log: contentWidth not persisted by VS Code, module singletons shared by two editors on one page, fixed-position overlays under a transformed ancestor, lowlight loads all grammars (1 MB), toolbar not inert when readOnly, Mermaid theme fixed after init, HTML comments literal in WYSIWYG, bracket escaping (`preserveBrackets` is Quantico-only; make it a core option), LymeStarter `e2e/tests/tenancy.spec.ts` untagged sample call, scaffolded `CLAUDE.md` copies template-only sections, `_api` CRLF rewrite on first build.

## Planning Docs

- `angular-core-extraction-plan.md` — **active.** Tracker, 15 milestones, Progress Log (newest first). Only M10 open; M7/M8 have pending items.
- `core-extraction-decisions.md` — approved M0 decisions (message table §5, settings split §6, Quantico target screen).
- `slash-commands-planning.md` — complete (2.11.0); ready to archive into `docs/`.
- `planning/kevin-feedback-aug-08.md` — M3 and M9 still open.
- `planning/HEADING-RENAME-LINKS.md`, `planning/IMAGE-PASTE.md` — shipped features' plans.
- `manual-test-script.md` — v2.10.0 manual pass, not yet run.
- `PLANNING.md` — original build plan (reserved root fixture).

## Servers

- Quantico Creek: SQL container `quanticocreek-sql` (127.0.0.1:14340); API `cd ~/git/quanticocreek/QuanticoCreekApi/QuanticoCreekApi && /usr/local/share/dotnet/dotnet run` (:5117); SPA `cd ~/git/quanticocreek/quantico-creek-angular-app && volta run --node 18 npx ng serve --port 4200`. Login is Google SSO only. `src/main.ts` has an uncommitted local edit pointing at :5117; leave it.
- LymeStarter: `ng serve` (:4200, conflicts with Quantico) + API `dotnet run -p:SkipTypeGen=true` (:5218). Wrapper demo at `/dev/markdown-editor`.
- Core demo: `npm run demo:core` (http://localhost:5173).

## Key File Paths

- `packages/core/src/{index,host,types,editor}.ts` — public API; `packages/core/src/styles/` (tokens.css, tokens.md); `packages/core/test/` — core-only vitest; `packages/core/demo/`
- `src/webview/{editor-main,vsCodeHost,vsCodeSettingsSections,supportCard}.ts` — VS Code shell; message protocol documented in `editor-main.ts` header
- `src/markdownEditorProvider.ts` — host side; `getWebviewContent` renders `#editor-root`
- `webpack.config.js` — `@mikedown/core` → `packages/core/src` alias, `tiptap-markdown` ES alias, `mainFields` ordering
- `.orchestrator/angular-core-extraction-plan/` — `state.json`, `prompts/`, `processed/worker-summary-*.md`, `artifacts/mikedown-core-0.1.0-rc.1.tgz` (gitignored)
- `~/git/lymestarter/ng-app/src/app/lymestack-optional/mikedown/` — Angular wrapper + demo; `~/git/lymestarter/lymestack-ownership.json#optionalFolders`
- `~/git/lymetools/src/LymeTools.Core/Sync/{OwnershipManifest,SyncEngine,SyncLedger}.cs`, `Scaffolding/AppScaffolder.cs`
- `~/git/quanticocreek/quantico-creek-angular-app/src/app/shared/mikedown/` — hand-copied wrapper (`preserveBrackets` input); KB editor `admin/knowledge-base/kb-article-editor/`

## Recent Git Log

- `48b5b94` Record M11 opt-in wrapper milestone in the extraction plan
- `448c441` Record M8 code completion
- `507507b` Record M7 part 2 in the extraction plan
- `1860157` Mark M8 and M7 part 2 in progress
- `7d89494` Log the AI prompt editor gap-fill
- `14e7782` Log the KB editor preview removal
- `8639bc4` Record T4 hands-on sign-off

## Any Other Notes

- Orchestrating: `/iadev:orchestrator angular-core-extraction-plan.md` resumes from `state.json`; workers run as Agent-tool subagents (Mike prefers subagents over clipboard prompts for scoped work). Only the orchestrator ticks plan checkboxes.
- lymetools tests need arm64 `/usr/local/share/dotnet/dotnet`; the Homebrew x64 dotnet fails 17 SyncTests under Rosetta.
- `npm run vsix` now also bumps `packages/core` to the root version and runs `build:core`; `npm run release:core` publishes. Order: core publish first, then vsix. No Marketplace PAT stored; Mike uploads the `.vsix` by hand.
- Launch the dev host with `npm run dev` (no debugger); Cmd+R the dev window after every `npm run compile`.
- Bare `vitest run` picks up integration files and fails — use `npm run test:unit` / `test:edge` / `test:integration`.
- Core serializer escapes literal `[ ]`; the Angular 14 Quantico app needs `skipLibCheck`; core paste is enabled iff `host.uploadImage` exists; `/date` only triggers at the start of an empty block.
- Review asks: mzenker-PSS was asked again on #10; don't ask them a third time. Spell check defaults **off**.
