# T4 final verification: worker summary

## Status

Done. All automated checks green except `test:integration` (worktree IPC path length; rerun in the main tree). Production check: one item differs (npmjs.com page returns 403 to curl, see Issues).

## Work completed

1. **Registry consumer smoke.** Added `--from-registry` to `scripts/consumer-smoke.mjs` (installs `@mikedown/<pkg>@<core version>` instead of tarballs; default mode unchanged; CLAUDE.md commands line updated). `npm run test:consumers -- --from-registry`: wc-vite, wc-cdn, react-vite, react-next, vue-vite, angular-17, angular-19, angular-19-no-mermaid all ok (installed 0.2.0 confirmed); angular-latest skipped (needs Node 22.22.3+, running 22.20.0).
2. **Downstream.** LymeStarter ng-app: `ng build` ok, `ng test --watch=false` 549/549. Quantico Creek assistant app: `ng build` ok, `ng test` 36/36. Legacy app: `ng build` ok on the vendored copy (budget warnings only). Browser look at `/dev/markdown-editor` at 1280 px, light and dark (`html[data-mode=dark]`): editor renders and themes correctly, typing "Hello T4 check" updated `form.value.notes` (Dirty true), no console errors. Server stopped.
3. **Full run.** See Test status.
4. **Production.** Site pages all 200; `latest.json` is 0.3.0; `npm view` is 0.2.0 for core, web-component, react, vue, angular; jsDelivr standalone bundle for web-component@0.2.0 is 200.

## Files modified

- `scripts/consumer-smoke.mjs`
- `CLAUDE.md`

## Test status

- `test:unit`: 120 files, 1577 passed, 2 todo.
- `test:edge`: 3 files, 22 passed.
- `test:integration`: FAILED to start, `listen EINVAL` on the VS Code IPC socket (path longer than 103 chars; worktree path). Rerun in the main tree.
- `test:packages`: 5 files, 72 passed.
- `test:wrappers`: 25 passed (Karma shown; all wrappers exit 0).
- `test:desktop`: 50 Playwright tests passed.

## Issues

- `https://www.npmjs.com/package/@mikedown/react` returns 403 to curl, with or without a browser User-Agent (bot protection). The registry (`registry.npmjs.org/@mikedown/react`) returns 200 and `npm view` works, so the package is live; verify the web page in a browser.
- The LymeStarter demo route needs the backend (:5218, `AppConfig`, login). For the screenshots I stubbed API calls with Playwright `page.route` (AppConfig plus `{}` for the rest). No repo files were changed there.
- `ng build` in the downstream repos wrote their ignored `dist/` folders.

## Notes for orchestrator

- Rerun `npm run test:integration` in the main tree after merging.

## Times

Start 20:21, end 20:28 (2026-10-24).

- Worktree: /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a63f74055eb643d04
- Branch: worktree-agent-a63f74055eb643d04
- Commit: a0669cc (plus a follow-up commit for this summary, see report line)

## Review Materials

- /private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/bcdeef5a-0084-4a26-a5d3-4847724c0e44/scratchpad/screenshots-t4/lymestarter-light.png
- /private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/bcdeef5a-0084-4a26-a5d3-4847724c0e44/scratchpad/screenshots-t4/lymestarter-dark.png
