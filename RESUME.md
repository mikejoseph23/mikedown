# MikeDown — Resume Prompt

## Project Overview

MikeDown is a VS Code custom editor extension: a WYSIWYG markdown editor built on TipTap/ProseMirror (webview bundle) with a Node extension host. Two webpack bundles — extension host (`src/`, node target, `dist/extension.js`) and webview (`src/webview/`, web target, `out/webview/editor-main.js`) — communicating only via `postMessage`. See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; three-place settings rule; tiptap-markdown webpack alias).

## Current Status

**2.11.0 is built and waiting on hands-on sign-off: slash commands and the review appeal card. Nothing is pushed (40+ local commits plus tags v2.10.2 through v2.10.4).**

- **Slash commands** (`slash-commands-planning.md`): M1 through M6, T1 and T2 automated are ✅; T2 hands-on (steps 0 to 28) is pending, then M7 docs (Haiku). Checklist: `.orchestrator/slash-commands-planning/hands-on-checklist.md`. Last verified: 704 unit, 22 edge, 38 integration passing.
- **Review appeal** (`review-appeal-planning.md`): M1 through M8 ✅ (copy approved in `review-appeal-copy.md`); M9 hands-on (15 steps) pending. Checklist: "Review Materials" in `.orchestrator/review-appeal-planning/processed/worker-summary-m9-hands-on.md`. Marketplace baseline 2026-09-26: 391 installs, 5 reviews, 5.00 rating.
- Both orchestrator sessions are still registered in `.orchestrator/active-sessions.json`; remove each on its sign-off. Agent worktrees were pruned and `.claude/worktrees/` is now ignored.
- Earlier: 2.10.3 (Paste Without Formatting), 2.10.4 (issue #5 escaping and source-sync fix plus the jsdom webview harness).

## What's Next

1. **Reminder: update the review plea message.** Review and refresh the appeal copy (`review-appeal-copy.md`) before 2.11.0 ships, and keep the card, README section and share text in sync.
2. **Hands-on passes** for both features (one F5 session). Failures get gap-fill prompts per each plan's guidance.
3. **Open decisions:** About tab says "a word to a friend" while the card says "colleague" (recommend "colleague"); opening the card manually also pushes back the next auto show (recommend accept); `/properties` undo only works as the very next action (accept or fix).
4. **After sign-off:** slash commands M7 docs, close both sessions, release 2.11.0 (`npm run vsix` bumps the version), push, tag `v2.11.0`. Re-check marketplace reviews at 30 and 60 days (checklist in BACKLOG.md).
5. **Lint config fix:** `npm run lint` fails repo-wide because ESLint's `parserOptions.project` only lists `tsconfig.json`, which excludes `src/webview` and `test`.
6. **Hotkeys follow-ups:** older `toggleBold`/`Italic`/`Strike`/`Highlight`/`Code` cases lack the `sourceMode` guard (latent bug) and `commandPalette` gating; adopt the private-fixture rule for mutating integration tests.
7. **Carry-overs from 2.10.x:** Kevin's remote retest (WSL/Docker), a possibly pending email to Kevin (Gmail thread `19ffde1e6eeb746b`), the `manual-test-script.md` pass, and marking M3/M9 in `planning/kevin-feedback-aug-08.md` before archiving it.

## Planning Docs

- `slash-commands-planning.md` and `review-appeal-planning.md`: active, paused for hands-on sign-off.
- `review-appeal-copy.md`: approved appeal copy (working file).
- `docs/` holds archived plans (`list-hotkeys.md`, `wikilink-support.md`), indexed in `docs/README.md`.
- `planning/kevin-feedback-aug-08.md`: M3 and M9 still open.
- `manual-test-script.md`: v2.10.0 manual pass, not yet run.
- `PLANNING.md`: general planning doc (reserved root fixture).

## Key File Paths

- `src/webview/editor-main.ts` — command switch (~line 4681), Hotkeys tab `buildHotkeysPanel` (~line 600), settings-panel mount (~line 1840), Tab `handleKeyDown` modifier guards (~line 2885)
- `src/webview/hotkeys.ts` — `MIKEDOWN_HOTKEYS` data array; must mirror `package.json#contributes.keybindings` (`test/unit/hotkeys.test.ts` enforces sync)
- `src/webview/outlineSidebar.ts` — `toggleSidebarVisible()` export (~line 454)
- `src/extension.ts` — `formattingCommands` forwarding array (~line 96)
- `src/markdownEditorProvider.ts` — `openKeybindings` message case; diff-view allowlist (~line 169)
- `package.json` — commands/keybindings/commandPalette contributions; `extensionKind` order is load-bearing

## Recent Git Log

- `e4d26d0` Release 2.10.4
- `f308a6d` Add a jsdom harness that boots the real webview, and cover issue #5 end to end
- `dc8061a` Extract source-mode divergence tracking and cover it with tests
- `c1148cf` Fix markdown escaping and source-mode sync (#5)
- `f54b709` Release 2.10.3
- `efe276b` Add Paste Without Formatting and stop autolinking bare filenames

## Any Other Notes

- **A stale Extension Development Host shows the old UI.** Cmd+R after every `npm run compile`.
- `npm run vsix` patch-bumps the version itself — don't bump manually first.
- `npm run lint` baseline: ~241 errors under `src/webview/` from tsconfig exclusion — pre-existing, not new debt.
- Bare `vitest run` picks up integration files and fails — use `npm run test:unit` / `test:edge` / `test:integration`.
- Mutating integration tests: use a private fixture with teardown, never `test/workspace/sample.md` (two other tests assert its exact content).
- `showSettingsModal` isn't exported and has no DOM coverage — Settings-modal regressions (like the empty Hotkeys pane, `dc3fad6`) are invisible to the suite.
- Spell check defaults **off** — enable it before testing squiggles.
- Check live marketplace state with `npx vsce show interapp.mikedown-editor` before assuming anything about what users have.
