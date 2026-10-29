# Worker summary: M6 Versioning, diff view, external changes

**Status:** Completed (real-window hands-on pending, see below)
**Worktree:** /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a502a62b667d3feff (branch worktree-agent-a502a62b667d3feff, based on 93e0d3d)
**Start / end:** 2026-10-23 20:07 / 20:33 EDT (two 529 interruptions in between)

## Commits

- 5c27a24 versions.rs: snapshot, list, prune, mirror-move commands + Rust tests
- b72c9c0 versioning policy (naming, identical skip, prune, size cap, lone-file skip), mirror moves through it
- 027f4c5 external changes: reload clean, flag dirty, save asks Compare / Revert / Overwrite
- 0f72cb6 version browser, diff viewer, Restore, Show Versions command, getDiffBaseline
- 98b15ed versions e2e spec + versions_* in the e2e fixture

## Work completed (per checkbox)

- **versioning.ts + versions.rs (edge 1):** TS owns policy (`skipReason`, `nextSnapshotName`, `pruneList`); Rust only does IO and refuses anything outside a `.mikedown/versions/` mirror or not named `YYYYMMDDTHHMMSSZ.md`. Snapshot = the saved file's bytes, byte-compared to the newest; `.mikedown/` created only on first write; prune to `versioning.keep`; same-second saves or a clock step back get newest+1s so names always sort chronologically; snapshots of one file are serialized. Lone-file windows, versioning off, outside-folder, and over-cap files skip with no disk call and no message. Hooked via `registry onSaved(doc, write)` (now passes the write result).
- **Version browser (`src/ui/versions.ts`):** third sidebar view (header history button, tab context menu "Show Versions", `CmdOrCtrl+Shift+H`). Newest first with relative time (local helper; core's `formatRelativeTime` is not exported), absolute time, size, "Latest" badge. Select one: Compare with Current / Restore; two: Compare Selected (older left). ARIA multi-select listbox, arrows/Space/Enter. Empty states explain lone-file, outside folder, disabled, no versions. **Restore** (`restoreIntoDocument`) replaces the buffer, dirties the tab, never writes; asks first only when unsaved edits would be replaced.
- **Diff viewer (`src/ui/diffView.ts`):** `diff@^8.0.4` (added to packages/desktop). Side-by-side and inline (remembered per viewer), word-level highlights in changed lines, unchanged runs folded with 3 lines of context (click to expand), +/− counts, F7 / Shift+F7 next/prev change, focus trap, Escape closes, read-only, core tokens plus forced-colors rules (`src/styles/versions.css`).
- **External changes (`src/documents/externalChanges.ts` + controller):** watcher `fs-changed` (debounced per doc), window focus, and every save run one check: mtime moved → read → clean: silent reload with cursor/scroll kept; dirty: edits kept, `externallyChanged`, info bar with Compare; disk equals buffer: adopt (clean, no write); disk equals saved: touch. Docs mid-save are skipped. Save of a flagged doc asks "“x.md” changed on disk." with Cancel / Compare… / Revert / Overwrite (in-page `dialogs.choose` from M4); Compare opens the diff viewer (On disk vs Your unsaved version) with Revert to Disk / Overwrite with Mine. Cross-window saves take the same path (fs-changed is broadcast to every window; focus check covers the rest). New model method `adoptDisk`.
- **getDiffBaseline:** TauriHost defines it when given `diffBaseline`; returns the newest snapshot as `headContent`. Editors get `setDiffAvailable(true)` after a snapshot.
- **Tree integration (edge 3):** M3 had already wired move/trash of the mirror; folderWorkspace now routes moves through `versioning.moved` → Rust `versions_move`, which merges into an existing mirror (identical files dropped, a differing same-name snapshot left behind, never overwritten) and is safe on case-only renames (APFS test). Delete still trashes the mirror (M3).

## Files

New: `src/documents/versioning.ts`, `src/documents/externalChanges.ts`, `src/ui/versions.ts`, `src/ui/diffView.ts`, `src/styles/versions.css`, `src-tauri/src/commands/versions.rs`, `test/unit/{versioning,externalChanges,versionsUi}.test.ts`, `test/e2e/versions.spec.ts`.
Modified: `src/app/documentController.ts`, `src/documents/documentModel.ts`, `src/tree/folderWorkspace.ts`, `src/ui/sidebar.ts`, `src-tauri/src/commands/fs.rs` (`same_entry` now `pub(crate)`), tests `folderWorkspace.test.ts`, `helpers/app.ts` (optional `controller` deps), tauriHost snapshot (save now does one `stat` first), e2e `README.md`.

**Hot-spot files touched (all additive):** `src/main.ts` (versions.css import, versioning/registry wiring, panel + compare/restore block, fs-changed hook, focus check now `controller.external.checkAll()`, `showVersions` action, tab menu entry), `src/host/tauriHost.ts`, `src/menu/shortcuts.ts` (one union member + one row), `src-tauri/src/menu.rs` (one line, View menu), `src-tauri/src/lib.rs` (4 handlers), `commands/mod.rs` (1 line), `src/documents/fsApi.ts` (versionsApi appended), `test/e2e/fixtures.ts` (versions_* cases), `packages/desktop/package.json` + `package-lock.json` (diff). Not touched: Cargo.toml, capabilities.

**For M8's menu table:** new menu id `showVersions`, "Show Versions", `CmdOrCtrl+Shift+H`, currently in View after Toggle Folder Sidebar.

## Tests / builds (in the worktree)

- `npx tsc --noEmit` (desktop): clean
- `npm run test:unit -w packages/desktop`: 29 files, 328 passed (was 279)
- `npm run test:e2e -w packages/desktop`: 22 passed (4 new in versions.spec.ts)
- `cargo test` in src-tauri: 77 passed, 1 ignored (9 new versions tests)
- `npm run build:core` then `npx vite build` (desktop): green
- No core changes, so root compile/test:unit/test:edge not rerun.

## Issues / notes for orchestrator

1. **Core quirk found (not fixed, core scope):** core reports `pristine` when ProseMirror's undo depth equals the depth at `markSaved`. Typing within PM's 500 ms grouping window right after a save joins the previous undo event, so core sends the *saved* text and the model stays clean until the next undo group starts. A second save in that window would write without those keystrokes. Repro: type, Cmd+S, type immediately, check `mikedownModel.dirty`. Likely fix: `closeHistory` in core's `markSaved`. Affects VS Code too. The e2e waits 600 ms before typing to avoid it.
2. Core's diff-highlight toggle (`toggleDiffHighlight`) is not wired to any command, and caches `headContent` once, so `getDiffBaseline` is implemented but has no visible effect yet.
3. No extra watchers for open files' folders (the Rust watcher map is global, keyed by dir, and the tree owns watch/unwatch). Changes in unexpanded folders are caught by the focus check and the save-time check.
4. A reload of a large file the user switched to rich text keeps rich text; otherwise `loadRead` re-applies the open plan.
5. Relative time is local because core does not export `formatRelativeTime`.

## Review Materials

Screenshots (Playwright, Chromium, light): `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a502a62b667d3feff/.orchestrator/desktop-app-plan/artifacts/m6/` (`m6-versions-panel.png`, `m6-diff-split.png`, `m6-diff-inline.png`, `m6-changed-on-disk.png`, `m6-compare-disk.png`).

Run the app (after merge) from `/Users/michaeljosephwork/git/mikedown/packages/desktop`: `npm run dev`. Fixture: any scratch folder, e.g. `mkdir -p ~/tmp-mikedown-m6 && printf '# Alpha\n\nFirst line.\n' > ~/tmp-mikedown-m6/a.md`; Open Folder… on it.

Real-window checks (pending, not driven by the worker):

1. **Three snapshots:** open a.md, edit+Cmd+S three times, Cmd+S once more with no change. `ls ~/tmp-mikedown-m6/.mikedown/versions/a.md/` shows exactly 3 names sorting chronologically. Cmd+Shift+H lists them.
2. **Compare / Restore:** select the oldest, Compare with Current: diff viewer side by side, toggle Inline, F7. Restore: tab dot appears, file on disk unchanged until Cmd+S.
3. **External edit while dirty:** type in MikeDown (don't save), then `printf '# Alpha\n\nTheirs.\n' > ~/tmp-mikedown-m6/a.md` in Terminal; switch back (info bar appears), Cmd+S: dialog with Compare… / Revert / Overwrite. Compare shows disk vs buffer; Revert reloads; repeat and Overwrite writes and adds a snapshot.
4. **Clean reload:** with a clean tab, edit the file in another editor; switching back reloads silently, cursor stays.
5. **3 MB:** `python3 -c "print('x'*80*40000)" > ~/tmp-mikedown-m6/big.md`, open, edit, save: no `.mikedown/versions/big.md`, no message.
6. **Tree:** rename a.md in the tree; `.mikedown/versions/<new name>/` carries the snapshots; delete trashes them.
7. Dark mode look of the panel and diff viewer (only light was captured).
