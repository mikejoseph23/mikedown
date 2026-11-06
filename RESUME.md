# MikeDown — Resume Prompt

## Project Overview

MikeDown is a WYSIWYG markdown editor (TipTap/ProseMirror) in an npm workspace. One editor core, `packages/core` (`@mikedown/core`), ships through:

- the VS Code extension (`src/`, thin shell `src/webview/editor-main.ts`);
- **MikeDown Desktop**, Tauri 2 at `packages/desktop/`;
- the npm family `@mikedown/core`, `web-component`, `react`, `vue`, `angular` (lockstep versions, independent of the extension's 2.x);
- the website `website/` (https://www.iadev.net/mikedown/).

See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; the three-place Settings rule; the `tiptap-markdown` ES alias; the lazy AI chunk) and the release steps.

## Current Status

**Shipped 2026-11-06: Desktop 0.6.0 (published and verified), npm family 0.4.0 (live). Extension 2.18.0 is built but waits on Mike's Marketplace upload.**

- **Extension:** `mikedown-editor-2.18.0.vsix` at the repo root; commit `255735c` (`Release 2.18.0`). After the upload: `git tag v2.18.0 255735c && git push origin v2.18.0`.
- **Desktop:** tag `desktop-v0.6.0` is pushed. `verify-published.sh` passed on www, apex, edge and origin. The in-app update from 0.5.0 has not been tried on a Mac or Windows box.
- **Shipped under-walked, Mike's call:** chat and documentation bases had only checklist 1.1 walked (VS Code). Inline suggestions was accepted as a whole with only its first step reported. All of it is experimental and off by default.
- `develop` is pushed except for the wrap-up docs commit.

## What's Done

1. **2026-11-05, built:** AI Activity panel, per-feature AI toggles, documentation bases (chat, 9 security fixes), inline suggestions.
2. **2026-11-06, ghost text:** M7 accepted by Mike. Added an Inline suggestions on/off row to the AI menu, saved at once (`c5e24c8`).
3. **2026-11-06, released:** npm 0.4.0, Desktop 0.6.0, extension 2.18.0 built. Changelogs split core's 0.3.0 and 0.4.0 entries; Desktop notes gained Chat and the fixes.
4. **Backlog added:** spell check toolbar toggle and on by default for new users. Flipping the default also affects existing users who never set it; decide before building.

## What's Next

1. **Mike:** upload the 2.18.0 `.vsix` to the Marketplace, then tag it (see above).
2. **Try the in-app update** on a Mac and a Windows box running Desktop 0.5.0 (Help > Check for Updates).
3. **Site-only publish, if wanted:** the Desktop publish refreshed the download page only. Next site release is `0.6.0-site.1`.
4. **Bump the core pin downstream** (LymeStarter, Quantico Creek) to `@mikedown/core` 0.4.0 when convenient.
5. **Finish the RAG walk** from 1.2 in `workspace-rag-hands-on.md`, both hosts; bugs now reach users, so fix what it finds as patch releases. Then tick M11, log sign-off, move `workspace-rag-plan.md` to `docs/`, fix the link in `docs/ai-writing-features-plan.md`, and remove the RAG entry from `.orchestrator/active-sessions.json`.
6. **Decisions for Mike** (day-man recommendations in parentheses):
   - RAG: follow-ups see earlier turns? (yes, last few); re-ask consent when base pages first go to an allowed engine? (no); show health immediately on add? (yes); Insert keeps images whose URL is in a cited section? (yes, as built).
   - Ghost: rebind Cmd+Alt+Space if Finder eats it? (Mike has not reported either way); keep the strict choices, 2400-char context and user-only `localOnly`? (yes); reject fim-only models at routing in v1? (yes).
7. **Worktree cleanup:** `git worktree list` shows about 30 stale `agent-*` worktrees under `.claude/worktrees/` plus `linux-appimage`. Prune with `git worktree prune` after checking none has uncommitted work.
8. **Older items:** T4 Desktop half of `ai-setup-privacy-polish-plan.md`; Q8; npm 2FA "disallow tokens"; re-encrypt the updater key; frontmatter YAML undo gap; blog post review and footer link; "Why Markdown?" interview post; settings sync across machines (`BACKLOG.md`).

## Planning Docs

- `ai-activity-panel-plan.md`: complete. File into `docs/` with `/iadev:repo-markdown-cleanup`.
- `workspace-rag-plan.md`: M11 (hands-on) open, walked through 1.1 only; S1 to S13 security table. `workspace-rag-hands-on.md` is the checklist.
- `ghost-text-plan.md`: M7 accepted 2026-11-06; three decisions still open. File into `docs/` when those are settled.
- `table-editing-improvements-plan.md`, `desktop-site-redesign-plan.md`: done, hand checks only.
- `ai-setup-privacy-polish-plan.md`: T4 Desktop and Q8 open. `ai-inference-engines-plan.md`: done. `angular-core-extraction-plan.md`: M10 open.
- `docs/README.md`: index of finished plans.

## Servers

- **VS Code dev host:** `npm run dev` (opens `test/workspace`).
- **Desktop dev:** `npm run dev` in `packages/desktop`. Quit the installed MikeDown first (single instance).
- **Site:** `npm run dev:site` (port 5180, base `/mikedown/`).
- **AI engines:** oMLX `http://127.0.0.1:8000/v1` (never print the key); LM Studio on `:1234`.
- **Production:** LymeDeploy project `mikedown-downloads`; `packages/desktop/deploy/release.sh`, `pack-for-lymedeploy.sh` (site-only next: `0.6.0-site.1`).

## Key File Paths

- `packages/core/src/`
  - `ai-activity.ts`, `ai-activity-panel.ts`: the Activity recorder (hooked in `ai-request.ts#runAiCompletion`) and panel.
  - `ai/docs/`, `ai-docs-run.ts`, `ai-docs-page.ts`, `ai-chat-panel.ts`, `ai-insert-guard.ts`: documentation bases.
  - `ai-ghost.ts`, `ai-ghost-plugin.ts`, `ai-ghost-session.ts`, `ai/ghostContext.ts`, `ai/ghostTrim.ts`, `ai/prompts/continue.ts`: ghost text.
  - `ai/privacy.ts` + `test/ai-fixtures/consent/`: consent copy shared with Desktop's `consent.rs` (scopes now include `docsBase` and `cursor`).
  - `test/ai-fixtures/docs/`: cross-host contract for ids, slugs, ranking; TS and Rust must match byte for byte.
- `src/ai/docsHost.ts`, `docsVsCode.ts`, `webviewBridge.ts`; `src/settings.ts#fenceGhostLocalOnly`.
- `packages/desktop/src-tauri/src/commands/docs.rs`, `commands/docs/`; `packages/desktop/src/host/docsHost.ts`.
- `.orchestrator/<plan>/processed/`: worker summaries (gitignored); `.orchestrator/workspace-rag-plan/processed/worker-summary-security-audit.md` has F1 to F9.

## Recent Git Log (`develop`)

- `deef2b1` MikeDown Desktop 0.6.0
- `255735c` Release 2.18.0
- `feb3205` Pin Desktop to @mikedown/core 0.4.0
- `d32102b` npm packages 0.4.0
- `c5e24c8` Add an Inline suggestions switch to the AI menu

## Any Other Notes

- **Commits:** no AI attribution. A PreToolUse hook blocks commands containing the strings, even in a grep in the same command.
- **Workers:** Mike wants small fixes done by Sonnet subagents directly, no clipboard; orchestrators get a clipboard kickoff for a fresh Opus context. Tell subagents not to spawn agents. Stop idle subagents.
- **Tests:** `npm run test:unit` exits 1 from 3 pre-existing `elementFromPoint` errors in `packages/core/test/table-editing.test.ts`; judge by counts. Flaky: `ai-engineService.test.ts` "routes a request without a route through core" (log regex misses `~N tok/s`). Run vitest from the repo root, not `packages/core`. Run `npm run build:core` before Desktop `tsc`.
- **Chat is read-only:** Insert at cursor is the only write. "Proposed edits" is in the RAG plan's Later section.
- **Release gotchas:** `npm publish` waits at "Press ENTER to open in the browser" for each package, and the request expires in about 5 minutes with a 404; the registry shows a new version about 2 minutes after the `202`. Bumping the Desktop pin can leave a stale `packages/desktop/node_modules/@mikedown`, which fails `vsce package` with `ELSPROBLEMS`; delete that folder. `release.sh` and `vsix:minor` can't overlap, since the former refuses a dirty tree. A subagent waiting on a long background build can stall, so check the artifacts yourself.
- Never run machine-wide `pkill`; kill by PID. Mike's npm 2FA is a passkey (see memory).
