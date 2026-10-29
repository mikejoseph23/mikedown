# MikeDown — Resume Prompt

## Project Overview

MikeDown is a WYSIWYG markdown editor (TipTap/ProseMirror) in an npm workspace. One editor core, `packages/core` (`@mikedown/core`), ships through:

- the VS Code extension (`src/`, thin shell `src/webview/editor-main.ts`);
- **MikeDown Desktop**, Tauri 2 at `packages/desktop/` (macOS, Windows, Linux preview);
- the npm family `@mikedown/core`, `web-component`, `react`, `vue`, `angular` (public, lockstep versions, independent of the extension's 2.x);
- downstream apps LymeStarter and Quantico Creek.

See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; the three-place Settings rule; the `tiptap-markdown` ES alias) and the release steps.

## Current Status

**Work happens on `develop` (`origin/develop` = `42a8983`; 4 newer local commits, planning docs and backlog only). It carries the experimental AI features (engines, rewrite family, /summary, /title, Properties Suggest), the customizable toolbar and the AI bundle split. All plans are signed off. Nothing from `develop` is released or merged to `main`.**

- **Released:** VS Code 2.16.0 (tag `v2.16.0`, TOC features; confirm the Marketplace upload), npm family 0.2.0, Desktop 0.3.0, site `0.3.0-site.3`.
- **`main`:** 1 unpushed commit (`f09fdb2`, backlog cleanup), already merged into `develop`.
- **`develop` unpushed:** `b15233f`, `e1fa98e` (backlog), `542624d`, `2f2323a` (new AI setup plan). Push with Mike's OK.
- **Junk in pushed `42a8983` ("Loose updates"):** about 100k lines of dictionaries under `packages/desktop/private/tmp/claude-503/.../scratchpad/desktop-dist/`, a stray scratchpad copy. Remove it in a follow-up commit and gitignore the path (check with the session that owns `packages/desktop/private/`).
- **The main folder is checked out on `develop`.** No orchestrator sessions are registered (`.orchestrator/active-sessions.json` is `[]`).
- Off by default: everything AI sits behind `mikedown.ai.enabled`, labelled Experimental with one shared disclaimer (`AI_EXPERIMENTAL_DISCLAIMER`).

## What's Done (2026-10-28/29)

1. AI marked Experimental (badge, disclaimer). There's an AI toolbar button with a first-run "Turn on and set up" panel and the setting `mikedown.ai.showToolbarButton`. AI is the last Settings nav item (`fdbde35`).
2. `docs/customizable-toolbar-plan.md` complete: registry, layout model `mikedown.toolbarLayout`, in-place edit mode (drag + keyboard), Toolbar settings tab. OQ3 to OQ5 closed. Font Theme (`fontPicker`) is the first optional palette item (`40bd796`).
3. `docs/ai-writing-features-plan.md` complete (T3 signed off): rewrite variants, Explain, Translate (incl. whole doc), reading level, thinking dial, `/summary`, `/outline`, `/title`, Properties Suggest chips. Later fixes:
   - context submenu renamed **AI**, Expand renamed **Add detail** (`fa10690`);
   - engine badge moved to the popover footer, plus a Thinking row in the AI menu, persisted in localStorage (`5b16f39`);
   - both hosts log `· thinking <level> · max_tokens N` per request (`6424f97`);
   - selection bubble removed (`056626f`);
   - Properties chip padding, frontmatter block overlap and empty `tags: []` fixed (`27272ed`).
4. AI bundle split (`e1032e9`): `editor.ts` lazy-loads `ai-ui.ts` when `host.ai` exists.
   - The standalone web component is 863 → 814 kB, plus a 56 kB AI chunk; its budget is back to 850 kB.
   - Core main is 223 → 154 kB.
   - VS Code and vitest import `ai-ui-eager.ts`, so AI stays synchronous there.

## What's Done (2026-10-29, day session)

1. A Fable review pass over the AI features produced **`ai-setup-privacy-polish-plan.md`** (`542624d`, `2f2323a`). Milestones: M1 detect running local servers and one-click local setup; M1b setup wizard (path recommendation: running local engine, then Copilot via `vscode-lm`, then a hardware threshold, otherwise cloud; local under Advanced; the "subscription is not API access" note; Copilot as a new `vscode-lm` engine kind); M2 cloud setup in one place; M3 privacy copy and provider policy links; M4 consent hardening; M5 UI polish; M6 docs; T1 to T3 tests and hands-on. It lists 7 bugs (B1 to B7) and **13 open questions for Mike**, each with a recommendation.
2. Corrections the review found: there is **no `vscode.lm` integration today** (`src/ai/vscodeAi.ts` is wiring plus the consent modal), and neither host has hardware detection.
3. `BACKLOG.md`: added **AI Recipes** (user-defined prompt templates with a structured output and a follow-up action; a separate effort); dropped the shipped customizable toolbar entry.

## What's Next

1. **Orchestrator on `ai-setup-privacy-polish-plan.md`** (launched 2026-10-29). Mike answers OQ1 to OQ13 first, or accepts the recommendations.
1. **Push** `develop` if it's ahead of origin (with Mike's OK).
2. **Hand-check the website demos' AI** with the lazy chunk (`npm run build:site && npm run preview -w website`, `/mikedown/developers/`).
3. **AI release (M7 box 4, Mike):** docs and loose ends are done (2026-10-29, `1ad8388`..`a5c54e5`; new subpath `@mikedown/core/ai/engines-page`). Release order: `npm run version:npm -- 0.3.0`, `test:packages`, `release:npm` dry run, Mike publishes, bump the Desktop core pin off `0.1.0` (unblocks the Desktop dist build), `npm run vsix:minor`. Lint warnings are 1213 (TOC code from main, e.g. `toc-node.ts` 93), none in AI/toolbar files.
4. **Decide when `develop` merges to `main`.** Probably right after the AI release prep.
5. **Next AI features**, from the AI engines plan's "Follow-up plans" and `ai-copilot-brainstorm.md`: ghost text, chat with this document, alt text for images. The writing plan's follow-ups include a per-model benchmark on the AI Engines page.
6. **Mike's older items:**
   - npm 2FA "disallow tokens" setting on each `@mikedown/*` package;
   - Desktop T4 checklist (`packages/desktop/docs/manual-test-checklist.md`);
   - re-encrypt the updater key (password was shown in chat 2026-10-24);
   - Bitbucket cap: move `~/git/rando` to GitHub;
   - T1 hands-on in `docs/wrappers-npm-plan.md`.
7. **Follow-ups:**
   - typing directly into the frontmatter YAML block isn't undoable, so a later undo can overwrite it;
   - `--mikedown-toolbar-edit-focus` is documented in `tokens.md` but missing from `tokens.css`;
   - dead `buildToolbar` in `editor.ts`;
   - the Angular wrapper's Reset stores `toolbarLayout: null`, which overrides the app's preset;
   - Desktop: the release notes link opens two tabs, the "is available" notice persists, and the last outline heading isn't highlighted;
   - prune `.claude/worktrees/`.

## Planning Docs

- `ai-setup-privacy-polish-plan.md`: **new, active** (orchestrator). 13 open questions.
- `ai-inference-engines-plan.md`: engines layer done through T4; **M7 release prep open**; "Follow-up plans" list.
- `docs/ai-writing-features-plan.md`: **complete** (D1 to D18; follow-up #9 bundle split done). Archive when ready.
- `docs/customizable-toolbar-plan.md`: **complete**, OQs closed. Archive when ready (`/iadev:repo-markdown-cleanup`).
- `ai-copilot-brainstorm.md`: 20 AI ideas and the top 5.
- `docs/wrappers-npm-plan.md`: only Mike's T1 left. `docs/desktop-app-plan.md`: only Mike's T4. `angular-core-extraction-plan.md`: M10 open.
- `desktop-auto-update-handson.md`: untracked and owned by another session. Leave it alone. The same goes for untracked `packages/desktop/private/`.

## Servers

- **VS Code dev host:** `npm run dev` (after code changes: `npm run compile`, then Cmd+R in the dev host). The AI output channel is **MikeDown AI**.
- **Desktop dev:** `npm run dev` in `packages/desktop` (needs `export PATH="$HOME/.cargo/bin:$PATH"`). AI log lines start with `[mikedown ai]` on stderr.
- **Site:** `npm run dev:site` (port 5180, base `/mikedown/`).
- **AI browser harness** (untracked, keep it): `packages/core/demo/ai-handson/`. Run `npm run build -w packages/core`, then from `packages/core` run `npx vite . --port 5198 --strictPort --config demo/ai-handson/vite.config.mjs` (needs `OMLX_API_KEY`).
- **AI engines:**
  - oMLX at `http://127.0.0.1:8000/v1` (key in `OMLX_API_KEY` and `~/.omlx/settings.json`; never print it);
  - LM Studio on `:1234` (no chat model loaded);
  - Ollama is not running.
- **Production:** IIS on iadev-prod via LymeDeploy project `mikedown-downloads` (`packages/desktop/deploy/pack-for-lymedeploy.sh`, `--site` for site-only releases; next is `--site-n 4`).

## Key File Paths

- `packages/core/src/`:
  - `editor.ts`: main editor; toolbar in `buildCondensedToolbar`; lazy AI import.
  - `ai/`: contracts, router, presets, `thinking.ts`, prompts, `documentBudget.ts`.
  - `ai-lite.ts` (loader, kept in the main chunk), `ai-ui.ts` (the lazy AI chunk), `ai-ui-eager.ts` (eager entry for VS Code and vitest). Self-hosting the standalone web component needs every `dist/mikedown-editor.*.js` file.
  - `ai-rewrite.ts` (popover), `ai-toolbar.ts`, `ai-prefs.ts`, `ai-settings*.ts`, `ai-engines-page.ts`.
  - `toolbar-ids.ts`, `toolbar-layout.ts`, `toolbar-registry.ts`, `toolbar-customize.ts`.
  - `outlineSidebar.ts` (Properties + Suggest), `frontmatterHistory.ts`.
- `src/ai/engineService.ts`: VS Code host (logging in `logRequest`).
- `packages/desktop/src-tauri/src/commands/ai.rs` + `commands/ai/` (`request_log.rs`); `packages/desktop/src/host/aiHost.ts`.
- `test/packages/web-component-shape.test.ts`: bundle budget (850 kB).
- `.orchestrator/<plan>/`: orchestrator state and processed worker summaries (gitignored).

## Recent Git Log (`develop`)

- `2f2323a` Add the setup wizard milestone to the AI setup plan
- `542624d` Add the AI setup, privacy and polish plan from the review pass
- `e1fa98e` Drop the shipped customizable toolbar from the backlog
- `b15233f` Add AI Recipes to the backlog
- `42a8983` Loose updates (contains the junk scratchpad dictionaries)
- `b27cf29` Log the AI bundle split in the AI writing features plan
- `e1032e9` Load the AI UI on demand so editors without host.ai never ship it
- `764eaf9` Log the Properties sidebar fixes in the AI writing features plan
- `27272ed` Fix Properties chip layout, frontmatter block overlap and empty tags after removal
- `0ca8c21` Record the T3 sign-off in the AI writing features plan
- `5b16f39` Move the AI engine badge to the popover footer and set the thinking level from the AI menu
- `fa10690` Rename the context menu Rewrite submenu to AI and the Expand variant to Add detail

## Any Other Notes

- **Commits:** no AI attribution of any kind. A PreToolUse hook blocks any Bash command whose text contains the attribution strings, even a grep, so search with patterns like `cl[a]ude`.
- **Workers:** use Agent-tool subagents (Mike prefers them over clipboard prompts). With several working in one tree, have each commit only its own paths (`git commit -- <paths>`). Never run two workers that edit `editor.ts` at once.
- **Worktrees:** they start from a stale commit (`git reset --hard <develop sha>`), need `npm run build:core` before `test:unit`, and can't run `test:integration`.
- **Tests:** use `npm run test:unit`, `test:edge` and `test:integration`; bare `vitest run` picks up the integration files. `supportCard` failed once in a full run but passes alone (possibly the known flaky test).
- **Thinking level:** "Model default" sends no thinking fields and is budgeted as Medium (2048 headroom). Off becomes Low on Anthropic; LM Studio is on/off only.
- **Teammate idle notifications** often repeat a finished worker's report, so check before reprocessing.
- Never run machine-wide `pkill`; kill by PID. Mac updates prompt for `macadmin`.
