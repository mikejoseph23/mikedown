# Worker summary: T2 Workspace tests

**Status:** Completed for all automated checkboxes. Hands-on checkbox left for Mike (screen not driven).
**Worktree:** /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a93f2f4e2351cea10, branch `worktree-agent-a93f2f4e2351cea10`
**Commits:** 3be64f9, d07b544, 9b272f4 (on top of 1582e3d; worktree started at b18d23c, tree was clean, reset to 1582e3d per the trap rule)
**Time:** start 19:46, end about 19:55 (2026-10-23)
**Note:** the sandbox refused writes to the main repo path, so this file lives in the worktree at `.orchestrator/desktop-app-plan/worker-summary-t2-workspace-tests.md` (uncommitted). Copy it to the main repo.

## Work completed per checkbox

- **documentModel (two handles in sync without echo, dirty flips/clears on save, pristine undo clears dirty):** already covered by `test/unit/documentRegistry.test.ts` and `documentModel.test.ts`. Nothing added.
- **backups (debounce coalesces, save clears, index = dirty set, restore maps hashes to paths):** debounce, save/close clearing, `planRestore` already covered in `backups.test.ts`; hash to path mapping and index pruning covered by Rust tests in `appdata.rs`. Added "keeps exactly the dirty set" (three docs, bursts coalesce, save and revert-to-pristine remove theirs).
- **tree (natural sort, hidden, lazy expand, CON.md, 270-char path):** natural sort, hidden, Windows reserved names and 259 limit already covered in `treeLogic.test.ts`; lazy expand in `folderWorkspace.test.ts`. Added a flat 270-char case (`treeLogic.test.ts`), "one list_dir per expand" with exact call counts, and a Windows-mode inline rename test refusing CON.md and a 270-char name (`folderWorkspace.test.ts`; its `beforeEach` became `setup(windows)`).
- **Rust fs.rs / watcher.rs:** case-only rename (file and folder) and polling fallback latency tests already existed. Added `polling_fallback_reports_removal_and_a_case_only_rename` in `watcher.rs`.
- **E2E:** new `test/e2e/workspace.spec.ts`: open folder, New File, F2 rename, Delete with confirm (mocked Trash), split, close tab, relaunch, session restores (two panes, tabs, folder).
- **Hands-on:** not done by me; steps below.

## Files modified

`packages/desktop/test/unit/{backups,treeLogic,folderWorkspace}.test.ts`, `packages/desktop/test/e2e/workspace.spec.ts` (new), `packages/desktop/src-tauri/src/commands/watcher.rs` (test module only). No hot-spot files touched. No production code changed; no bugs found.

## Test/build status

- `cd packages/desktop && npx vitest run --config vitest.config.ts`: 20 files, 193 tests pass.
- `npx playwright test --config test/e2e/playwright.config.ts`: 9 passed (21 s).
- `cd src-tauri && cargo test`: 48 passed, 1 ignored (watcher: 4 pass).
- `npx tsc --noEmit -p packages/desktop`: clean.
- Not run: root `test:unit` / `test:edge` (no core changes).

## Notes for orchestrator

Path-length refusals on rename surface as a toast, name errors (CON.md) inline; tests assert both.

## Review Materials

Fixture folder: `~/tmp-mikedown-t2/notes` (welcome.md, Ideas.md, file2.md, file10.md, projects/plan.md, empty archive/).
Run: `cd /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a93f2f4e2351cea10/packages/desktop && npm run dev`, then open `~/tmp-mikedown-t2/notes`.

Hands-on pass (about 10 min per OS), Mike signs off:

1. Open the notes folder; order: archive, projects, Ideas.md, file2.md, file10.md, welcome.md.
2. New File: type "Scratch", Enter; Scratch.md appears and opens.
3. Rename it (F2, or Enter on macOS) to "Draft.md"; confirm on disk.
4. Drag Draft.md into `archive/`; it moves and the open tab follows.
5. Delete a file (Delete, or Cmd+Backspace on macOS), confirm; check the Trash / Recycle Bin.
6. Open welcome.md, Cmd/Ctrl+\ to split; both panes show it; type in one, the other follows.
7. Leave an unsaved edit, force-quit, relaunch: folder, panes and tabs return and the edit is dirty.
