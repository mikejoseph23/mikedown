# Worker summary: FIX1 save race + window title

Status: complete, except `npm run test:integration` could not run (see Issues).

## Work completed
- Save race (root cause): `markSaved` captured the undo depth but left the History group open. Typing within newGroupDelay (500 ms) joined the saved group, depth still equalled the baseline, so core reported pristine with the old content. Fix in `packages/core/src/editor.ts` `markSaved`: dispatch `closeHistory(view.state.tr)` (a PM transaction, no DOM mutation) before capturing depth. No delay. Desktop `documentModel` did not contribute.
- Regression test `packages/core/test/save-race.test.ts` (fails without the fix, verified; passes with it).
- Removed the 600 ms wait and its comment in `packages/desktop/test/e2e/versions.spec.ts`; no other waits cite the bug. e2e passes.
- Window title: `formatWindowTitle` no longer derives a folder from the file path; folder suffix only when a folder is open. Welcome guide now `Welcome to MikeDown.md`. Updated recents.test (added welcome-guide and dirty lone-file cases), panes.test, tauriHost snapshots (3), e2e welcome.spec.

## Files modified
packages/core/src/editor.ts; packages/core/test/save-race.test.ts (new); packages/desktop/src/app/windowTitle.ts; packages/desktop/test/e2e/{versions,welcome}.spec.ts; packages/desktop/test/unit/{recents,panes}.test.ts; packages/desktop/test/unit/__snapshots__/tauriHost.test.ts.snap

## Test/build status
- root `npm run compile`: ok. `npm run test:unit`: 103 files / 1332 passed. `npm run test:edge`: 22 passed.
- `packages/desktop`: `npm run test:unit` 357 passed; `npm run test:e2e` 26 passed.
- `npm run test:integration`: NOT RUN successfully.

## Issues
- Integration: VS Code failed `listen EINVAL .../.vscode-test/user-data/1.14-main.sock` (socket path too long in the nested worktree path). Environmental; run it from the main checkout.
- Worktree started at b18d23c with no packages/desktop; reset --hard to 62c8167 per the prompt (tree was clean).

## Notes for orchestrator
- `documentModel.ts` still exports an older `windowTitle()` (path-derived folder, tested in documentModel.test.ts) that the app no longer uses; it contradicts edge 29 and could be deleted.
- Commits: 7ff6d82 (core), fb3c74d (title), 394aca7 (e2e wait).

Review Materials: none
