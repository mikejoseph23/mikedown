# MikeDown — Resume Prompt

## Project Overview

MikeDown is a WYSIWYG markdown editor (TipTap/ProseMirror) in an npm workspace. One editor core, `packages/core` (`@mikedown/core`), ships through:

- the VS Code extension (`src/`, thin shell `src/webview/editor-main.ts`);
- **MikeDown Desktop**, Tauri 2 at `packages/desktop/`;
- the npm family `@mikedown/core`, `web-component`, `react`, `vue`, `angular` (lockstep versions, independent of the extension's 2.x);
- the website `website/` (https://www.iadev.net/mikedown/).

See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; the three-place Settings rule; the `tiptap-markdown` ES alias; the lazy AI chunk) and the release steps.

## Current Status

**Three AI features were built on 2026-11-05 and sit on local `develop`, unpushed and unreleased. Two hands-on walks and seven decisions are waiting on Mike.**

- **Ghost text is merged** into `develop` as `68cf7b1` (one conflict in `ai-request.ts`, both features kept), CLAUDE.md note `5fa444f`. All suites green after the merge. The `ghost-text` worktree and branch are gone.
- **Live:** VS Code 2.17.1, Desktop 0.5.0, npm 0.3.0, site `0.5.0-site.1`. Nothing of today's work is released.
- `develop` was 58 commits ahead of origin before the merge. Mike decides when to push.

## What's Done (2026-11-05)

1. **AI Activity panel** (`ai-activity-panel-plan.md`, complete): opt-in, in-memory view of every AI request's exact messages and raw response, Copy and Save, both hosts. Explain and Translate named in the panel (`c974b24`). Walked by Mike in both hosts.
2. **Per-feature AI toggles** verified; a palette command or hotkey for a disabled feature now shows a toast (`c705291`). Explain and Translate stay under the Rewrite toggle.
3. **Workspace RAG, "Documentation bases"** (`workspace-rag-plan.md`, 11 of 12 milestones): user-level folders of markdown, a manager page, a docked chat panel with scope picker (This document / Active bases) and Insert at cursor, prompted navigation loop with hard containment, citations, per-base cloud switch, secrets scan. A security audit found 9 issues, all fixed (insert guard `ai-insert-guard.ts`, linear scanners, Allow-once per turn, Desktop trusted roots). Tip `2e084ed`.
4. **Ghost text** (`ghost-text-plan.md`, M1 to M6 done, 198 tests): inline continuation after the caret, Tab accepts, Escape dismisses, Mod-ArrowRight accepts a word, `localOnly` default on, Cmd+Alt+Space manual trigger via host command `aiSuggestContinuation`. New consent scope `cursor`.
5. Side effect of the RAG insert guard: `setWholeDocument` sets `preventAutolink`, so a bare URL ending a file's first block is no longer silently autolinked on load.

## What's Next

1. **Full suite is green post-merge.** To re-run from the repo root: `npm run build:core`, `npm run lint`, `npm run compile`, `npx vitest run test/unit packages/core/test`, `npx vitest run test/edge-cases test/performance`, `npm run test:packages`; `packages/desktop`: `npx tsc --noEmit`, `npx vitest run --config vitest.config.ts`; `packages/desktop/src-tauri`: `cargo test --lib`.
2. **Mike's hands-on walks**, both hosts (VS Code: `npm run dev` from the root opens `test/workspace`; Desktop: quit the installed app, `npm run dev` in `packages/desktop`):
   - RAG: `workspace-rag-hands-on.md`. Entry: toolbar gear > AI tab > Documentation bases > "Manage bases…". Fixture `test/workspace/docs-base/`; the phrase `PURPLE-HERON-4471` in `test/workspace/outside-docs-base/` must never reach a model.
   - Ghost text: `ghost-text-plan.md` M7 checklist. Turn on Inline suggestions, route `continue` to oMLX, then LM Studio.
3. **Decisions for Mike** (day-man recommendations in parentheses):
   - RAG: follow-ups see earlier turns? (yes, last few); re-ask consent when base pages first go to an allowed engine? (no); show health immediately on add? (yes); Insert keeps images whose URL is in a cited section? (yes, as built).
   - Ghost: rebind Cmd+Alt+Space if Finder eats it? (decide after the walk); keep the strict choices, 2400-char context and user-only `localOnly`? (yes); reject fim-only models at routing in v1? (yes).
4. **Dispatch fix workers** for what the walks find (Sonnet subagents for small fixes, Opus for interaction). Then tick M11 (RAG) and M7 (ghost), log sign-off in each plan, move `workspace-rag-plan.md` to `docs/` and fix the link in `docs/ai-writing-features-plan.md`, remove the RAG entry from `.orchestrator/active-sessions.json`.
5. **Release bundle, when Mike says:** npm 0.4.0 (new public `ai/docs` surface), Desktop 0.6.0 (notes drafted at `packages/desktop/deploy/release-notes/0.6.0.md`), extension 2.18.0, then the site-only publish (`--site-n 2`). Carries the #12 fixes and the hover fix too. Steps in `CLAUDE.md`.
6. **Worktree cleanup:** `git worktree list` shows about 30 stale `agent-*` worktrees under `.claude/worktrees/` plus `linux-appimage`. Prune with `git worktree prune` after checking none has uncommitted work.
7. **Older items:** T4 Desktop half of `ai-setup-privacy-polish-plan.md`; Q8; npm 2FA "disallow tokens"; re-encrypt the updater key; frontmatter YAML undo gap; blog post review and footer link; "Why Markdown?" interview post; settings sync across machines (`BACKLOG.md`).

## Planning Docs

- `ai-activity-panel-plan.md`: complete. File into `docs/` with `/iadev:repo-markdown-cleanup`.
- `workspace-rag-plan.md`: M11 (hands-on) open; S1 to S13 security table. `workspace-rag-hands-on.md` is the checklist.
- `ghost-text-plan.md`: M7 (hands-on) open; Design table D1 to D13 and a Progress Log of every departure.
- `table-editing-improvements-plan.md`, `desktop-site-redesign-plan.md`: done, hand checks only.
- `ai-setup-privacy-polish-plan.md`: T4 Desktop and Q8 open. `ai-inference-engines-plan.md`: done. `angular-core-extraction-plan.md`: M10 open.
- `docs/README.md`: index of finished plans.

## Servers

- **VS Code dev host:** `npm run dev` (opens `test/workspace`).
- **Desktop dev:** `npm run dev` in `packages/desktop`. Quit the installed MikeDown first (single instance).
- **Site:** `npm run dev:site` (port 5180, base `/mikedown/`).
- **AI engines:** oMLX `http://127.0.0.1:8000/v1` (never print the key); LM Studio on `:1234`.
- **Production:** LymeDeploy project `mikedown-downloads`; `packages/desktop/deploy/release.sh`, `pack-for-lymedeploy.sh` (site-only next: `0.5.0-site.2`).

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

- `5fa444f` Note the ghost text modules in the project notes
- `68cf7b1` Merge ghost-text: inline AI suggestions
- `2e084ed` Log the consent fix and the full verification run
- `a0be3cb` Make Allow once cover one whole chat turn on both hosts
- `df7ab29` Desktop starts the documentation watcher itself, counts broken links without freezing the UI, and picks folders in Rust
- `9c0d5ab` Harden the Desktop documentation host
- `f2862d4` Harden the VS Code documentation host
- `a3c9f95` Add the workspace RAG planning document
- `492a0e7` Add the ghost text planning document
- `c974b24` Name Explain and Translate in the AI Activity panel

## Any Other Notes

- **Commits:** no AI attribution. A PreToolUse hook blocks commands containing the strings, even in a grep in the same command.
- **Workers:** Mike wants small fixes done by Sonnet subagents directly, no clipboard; orchestrators get a clipboard kickoff for a fresh Opus context. Tell subagents not to spawn agents. Stop idle subagents.
- **Tests:** `npm run test:unit` exits 1 from 3 pre-existing `elementFromPoint` errors in `packages/core/test/table-editing.test.ts`; judge by counts. Flaky: `ai-engineService.test.ts` "routes a request without a route through core" (log regex misses `~N tok/s`). Run vitest from the repo root, not `packages/core`. Run `npm run build:core` before Desktop `tsc`.
- **Chat is read-only:** Insert at cursor is the only write. "Proposed edits" is in the RAG plan's Later section.
- Never run machine-wide `pkill`; kill by PID. Mike's npm 2FA is a passkey (see memory).
