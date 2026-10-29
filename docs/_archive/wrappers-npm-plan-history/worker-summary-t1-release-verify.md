# Worker summary: T1 Release verification

**Status:** Completed (automated items); hands-on item left for Mike.
**Worktree:** /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a2269eab1eb5c54f6
**Branch:** worktree-agent-a2269eab1eb5c54f6 (reset to 01b38bc first; the worktree started on stale 4172f62 with a clean tree)
**Start/end:** 17:15 / 17:35 (2026-10-24)

## Work completed

- MikeDown suites: all green (see Test status).
- Registry smoke: green. `npm create vite@latest smoke -- --template vanilla-ts`, `npm install @mikedown/core` (0.1.0) pulled the peers (tiptap, codemirror, katex, lowlight; mermaid is optional and not installed), README minimal example mounted with `import '@mikedown/core/styles.css'`, `npm run build` passed (bundle 2.3 MB, chunk-size warning only). `node -e "import('@mikedown/core')"` succeeds (SSR-safe). Smoke dir: scratchpad `t1/smoke`.
- LymeStarter ng-app (`^0.1.0`), quantico-creek-angular-app (`^0.1.0`), quantico-creek-assistant-app (`^0.1.0`): `npm ci` + `ng build` all succeed (budget warnings only). No tracked files changed (LymeStarter has two untracked `package-lock.json` files in `docs/` and `e2e/` that predate this run).
- M0: the T1 line in `wrappers-decisions.md` (styles.css imported with only `npm install @mikedown/core`) is covered by the smoke above. Nothing else to apply.

## Test status

- `test:unit`: first run 1 failed / 1564 passed (failing test not identified; output was only tailed). Three reruns, including after `npm run compile`: 118 files, 1565 passed, 2 todo. Treat as a flake; owner if it recurs: unknown, rerun with full output.
- `test:edge`: 22 passed.
- `test:packages`: 72 passed (5 files).
- `test:integration`: needed two workarounds. `--user-data-dir` on the CLI is ignored by `.vscode-test.mjs`, so I used an uncommitted temp config (`launchArgs: ['--user-data-dir=/tmp/md-it']`, deleted after). The first run had 21 failures because `dist/` was not built in the fresh worktree (`pretest` is skipped when running `vscode-test` directly); after `npm run compile`: 47 passing.
- `test:desktop`: unit part passed; e2e 50 passed. Axe "core note" logs (label-content-name-mismatch on the zoom button, unlabeled settings inputs) are informational, not failures. Possible polish for desktop/core owners.

## Files modified

Only this summary. No code changes.

## Issues

None blocking. Note for orchestrator: the worktree base can be stale; `npm run test:integration` in a worktree also needs a prior `npm run compile` and a short user-data-dir.

## Review Materials (Mike's hands-on, 3 minutes, after the .vsix is uploaded)

1. VS Code, Extensions panel: MikeDown Editor shows 2.15.0 after the Marketplace update (reload window if it still shows older).
2. Open `/Users/michaeljosephwork/git/mikedown/test/workspace/` and any `.md` file: opens in the MikeDown editor.
3. Type text, save with Cmd+S: no dirty dot, file on disk has the text.
4. Toolbar zoom `[−] 15 [+]`: click + (size 16), click − twice (14); label updates and text resizes. Clicking the number resets to 15.
5. Open a callout document (a file with `> [!NOTE]` blocks): body text appears once per callout, not duplicated; toggle source mode (Cmd+/) and back to confirm.

Marketplace upload (Mike only): `npx vsce publish` is not scripted; upload the built `.vsix` by hand per CLAUDE.md.
