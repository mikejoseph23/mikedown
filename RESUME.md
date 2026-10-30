# MikeDown — Resume Prompt

## Project Overview

MikeDown is a WYSIWYG markdown editor (TipTap/ProseMirror) in an npm workspace. One editor core, `packages/core` (`@mikedown/core`), ships through:

- the VS Code extension (`src/`, thin shell `src/webview/editor-main.ts`);
- **MikeDown Desktop**, Tauri 2 at `packages/desktop/`;
- the npm family `@mikedown/core`, `web-component`, `react`, `vue`, `angular` (lockstep versions, independent of the extension's 2.x);
- downstream apps LymeStarter and Quantico Creek.

See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; the three-place Settings rule; the `tiptap-markdown` ES alias) and the release steps.

## Current Status

**Revisit soon: `desktop-site-redesign-plan.md`.** The Desktop download page gets an AI section, a fuller feature tour, and a comparison chart across Desktop, VS Code, the web component and the wrappers. It ships as a site-only release after Desktop 0.4.0.

**`develop` is 51 commits ahead of `origin/develop`, so push with Mike's OK. Working tree clean. The AI setup, privacy and polish plan is implemented, and the VS Code half of the fresh-user walk (T4) has passed. Nothing from `develop` is released or merged to `main`.**

- **Released:** VS Code 2.16.0, npm family 0.2.0, Desktop 0.3.0, site `0.3.0-site.3`.
- **AI** stays off by default behind `mikedown.ai.enabled` and is labelled Experimental.
- **No orchestrator sessions** are registered.

## What's Done (2026-10-29)

1. **`ai-setup-privacy-polish-plan.md` M1 to M6** (orchestrator), including:
   - a cloud-first setup wizard, with local setup under Advanced, hardware detection, and Copilot as the `vscode-lm` engine kind;
   - consent keyed by engine fingerprint (Allow / Allow once / Deny / Never), with a list of cloud consents;
   - privacy copy and provider policy links;
   - model-aware OpenAI parameters (no temperature on reasoning models, `reasoning_effort` mapping, one retry on parameter-shaped 400s).
2. **The T4 fresh-user walk on VS Code** found W1 to W26, R1 to R7, E1 to E5, L1 to L8 and F1, all fixed or closed. The plan's Progress Log has the shas. Highlights:
   - a timing footer ("5.2 s · 96 tok/s");
   - plain-language load errors (`modelLoadFailed`);
   - a new local engine defaults only to its loaded chat model; otherwise it shows "Pick a model to start with", with sizes and a "MoE · fast" hint that only appears when the model fits.
3. **Two Fable QA walks** found Q1 to Q10. Everything except Q8 (probably an automation timing miss) is fixed and passed live:
   - on Default, short edits (rewrite, translate, title, properties) run with thinking Off, and thinking requests get more room (`61e6d13`);
   - MTP draft heads on LM Studio and oMLX are no longer chat models (`c46abed`, `c5dd0db`);
   - Done is blocked when an engine has no model picked;
   - the default engine is a label, not a toggle;
   - Enable AI persists when you go to the Engines page;
   - the status bar and sidebar AI chip refresh when the default changes (`4a9293c`, `c5dd0db`).
4. **Non-AI fixes:** `==highlight==` is readable in dark VS Code themes on Auto (`3557c46`), and the sidebar Outline opens at the top (`763e41b`).
5. **Repo skill `.claude/skills/listing-screenshots/`** (`f01a118`, `0724e44`):
   - `capture.sh` plus a stager extension, taking fresh-profile captures into `assets/screenshots/_new/`, then `--promote`;
   - 9 listing shots refreshed and promoted (`d03987b`): README plus `website/vscode/`, with a new `outline.jpg` in the README.
6. **Docs sweep (`20223ba`):** finished plans moved to `docs/` and `docs/_archive/` (with `-history/` folders), and the `docs/README.md` index rewritten.
7. **`BACKLOG.md`:** AI Recipes (user prompt templates) added.

## What's Next

1. **Push `develop`** (Mike's OK).
2. **CHANGELOG catch-up:** `[Unreleased]` has lines for the late fixes, but the earlier ones are missing:
   - the consent rework (Allow once, Deny, Never, the list of cloud consents);
   - the setup wizard and Copilot `vscode-lm`;
   - the OpenAI parameter mapping (`6f3038e`);
   - the timing footer and load errors (`b1dee8f`);
   - the local default model picks (`85d2c9f`).
   Check `git log` against the CHANGELOG.
3. **Six interactive screenshots (Mike):** toolbar-dropdown, slash-commands, toolbar-edit-mode, ai-rewrite (timing footer), ai-setup-wizard, ai-local-setup-dark.
   - Run `.claude/skills/listing-screenshots/capture.sh --interactive` (or `--only <name>`). `ai-local-setup-dark` needs LM Studio running and AI **off**.
   - Optionally retake `sidebar-dark,sidebar-light` now that the Outline fix is in.
   - Review, then `--promote`, as described in `SKILL.md`.
4. **T4 Desktop half** of `ai-setup-privacy-polish-plan.md`: the same fresh-user walk in MikeDown Desktop (`npm run dev` in `packages/desktop`).
5. **AI release prep** (`ai-inference-engines-plan.md` M7):
   1. `npm run version:npm -- 0.3.0`;
   2. `test:packages`;
   3. `release:npm` dry run;
   4. Mike publishes;
   5. bump the Desktop core pin off `0.1.0`;
   6. `npm run vsix:minor` (it ships the new README screenshots).
6. **Untested cloud engines:** DeepSeek, Gemini, Groq, Mistral and OpenRouter rely on fixtures. Mike chose not to open accounts, so they'll be fixed on user reports.
7. **Older items:**
   - npm 2FA "disallow tokens" on each `@mikedown/*` package;
   - Desktop T4 checklist;
   - re-encrypt the updater key;
   - move `~/git/rando` to GitHub;
   - T1 hands-on in `docs/wrappers-npm-plan.md`;
   - the frontmatter YAML undo gap;
   - prune `.claude/worktrees/`;
   - optionally clear `.orchestrator/` for the archived plans.

## Planning Docs

- `ai-setup-privacy-polish-plan.md`: **active**. M1 to M6 are done, and the T4 VS Code walk is done (findings with shas in the Progress Log). Still open: the T4 Desktop half, Q8 (watch for it) and R7 (note only).
- `ai-inference-engines-plan.md`: the engines layer is done; **M7 release prep is open**.
- `ai-copilot-brainstorm.md`: AI feature ideas (ghost text, chat with the doc, image alt text).
- `angular-core-extraction-plan.md`: M10 open; the M8 Quantico Creek hands-on is pending.
- `desktop-auto-update-handson.md` and `packages/desktop/private/`: owned by another session. Leave them alone.
- `docs/README.md`: an index of the finished plans and decisions.

## Servers

- **VS Code dev host:** `npm run dev`. After code changes run `npm run compile`, then Developer: Reload Window. The output channel is **MikeDown AI**.
- **Fresh-profile testing:** `code --new-window --user-data-dir /tmp/mdfresh --extensions-dir /tmp/mdfresh-ext --extensionDevelopmentPath="$PWD" test/workspace`.
  - Keep the paths short; long ones exit silently because of the socket path limit.
  - Quit that instance (Cmd+Q in it) before `rm -rf /tmp/mdfresh*`.
  - QA workers use `/tmp/mdqa`, and the screenshot skill uses `/tmp/mdshots`.
- **Desktop dev:** `npm run dev` in `packages/desktop` (needs `export PATH="$HOME/.cargo/bin:$PATH"`).
- **Site:** `npm run dev:site` (port 5180, base `/mikedown/`).
- **AI engines:**
  - oMLX `http://127.0.0.1:8000/v1`: the key is in `OMLX_API_KEY` and `~/.omlx/settings.json`, never print it. Mike's daily driver is Qwen3.8-Flash-Next (MoE plus MTP, about 96 tok/s).
  - LM Studio `:1234`: it can't load oMLX `oq5e` quants (`Missing FP8 PLE shards`), and that's not a MikeDown bug.
  - Mac Resource Monitor polls LM Studio `/api/v0/models` every 1 to 2 s; that's not MikeDown.
- **Production:** LymeDeploy project `mikedown-downloads` (`packages/desktop/deploy/pack-for-lymedeploy.sh`; the next site release is `--site-n 4`).

## Key File Paths

- `packages/core/src/ai/`: the pure AI layer.
  - `thinking.ts`: `taskThinkingDefault`, `resolveThinkingLevel`.
  - `setup.ts`: `localDefaultModel`, size and MoE hints.
  - `discovery.ts`: LM Studio and oMLX parsing, `drafterArch`.
  - `privacy.ts`.
- `packages/core/src/ai-engines-page.ts`, `ai-setup-wizard.ts`, `ai-local-setup.ts`, `ai-ui.ts` (the lazy chunk), `ai-settings-model.ts` (`aiNextRouteChanged`).
- `src/ai/`: VS Code host (`engineService.ts`, `statusBar.ts`, `hardware.ts`, `providers/vscodeLm.ts`, `vscodeAi.ts`).
- `packages/desktop/src-tauri/src/commands/ai.rs` plus `commands/ai/`: the Rust twin. `test/ai-fixtures/` holds the fixtures both sides share.
- `.claude/skills/listing-screenshots/`: `SKILL.md`, `capture.sh`, `shots.json`, `stager/`.
- `assets/sample-docs/`: demo documents for the screenshots (all invented content).

## Recent Git Log (`develop`)

- `7b96008` Record the QA retest results in the AI setup plan
- `c5dd0db` Grey out oMLX MTP drafters and keep the sidebar AI chip on the current route
- `4a9293c` Block Done on an engine with nothing picked, and make the default engine a label
- `61e6d13` Pick thinking per task on Default and refresh the AI status bar on settings changes
- `c46abed` Do not offer LM Studio MTP drafters as chat models
- `577ff7f` Default a new local engine to its loaded model only, and hint MoE speed
- `763e41b` Open the sidebar outline at the top instead of the last heading
- `3557c46` Make ==highlight== readable in dark VS Code themes when the editor theme is auto

## Any Other Notes

- **Commits:** no AI attribution. A PreToolUse hook blocks commands containing the attribution strings, even in a grep, so search with patterns like `cl[a]ude`.
- **Workers:** Mike prefers Agent-tool subagents over clipboard prompts, except for hands-on QA, which goes to a clipboard Fable worker in a fresh context. Each worker commits only its own paths. Never run two workers that edit `editor.ts` at once.
- **Type checks:** the webview build is transpile-only, so check with `npx tsc -p tsconfig.webview.json --noEmit`. Desktop's tsc reads core's `dist`, so run `npm run build:core` first.
- **Thinking dial:** a choice carries across tasks for the session (intended); Default resets it. The popover dial offers Default, Off and On; Low, Med and High are only in the per-engine select.
- **The Engines page stages a default change until Done**; the status bar and sidebar chip update on Done.
- Never run machine-wide `pkill`; kill by PID.
