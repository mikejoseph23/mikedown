# Worker summary: T3 Feature tests

Start 2026-10-23 20:44, end 2026-10-23 20:56 (approx).

## Status

Automated part complete. Hands-on checkbox left for Mike.

## Work completed (audit per checkbox)

- `settings.test.ts`: already covered by `test/unit/settings.test.ts` (merge precedence, corrupt-file fallback with the file untouched, folder-override image-folder validation, Save for this folder routing, lone-file fallback), `settingsHost.test.ts`, Rust `commands/settings.rs`. Nothing added.
- `versioning.test.ts`: already covered by `test/unit/versioning.test.ts` (timestamp names sort, identical skip, prune to keep, size cap, rename/move maps the mirror folder) and Rust `versions.rs` (identical skip, too large, prune, move/merge, case-only rename). Added e2e for rename (below).
- `search.test.ts` (Rust + TS): already covered by `test/unit/search.test.ts` (debounce, cancel on query change and on a new search, late events ignored, cap/truncated, toggles) and Rust `commands/search.rs` (exclusions, case, whole word, 2 MB/binary skip, cap, cancellation, budget). Nothing added.
- `export.test.ts`: title derivation, inlined CSS and offline checks already in `standaloneHtml.test.ts` / `exporter.test.ts`. Added: unit test that the real `core/dist/styles.css` run through `buildStandaloneHtml` has no `--vscode-` and keeps `--mikedown-`; the e2e export spec now asserts the exported file has no `--vscode-`.
- E2E: settings persist across relaunch, save twice and diff, search and click, export HTML to a temp dir are all covered by `settings.spec.ts`, `versions.spec.ts`, `search.spec.ts`, `export.spec.ts`. Added `versions-rename.spec.ts`: renaming a file and a folder in the tree moves the `.mikedown/versions` mirrors (snapshots seeded on disk, no save waits).
- Hands-on: walkthrough below; checkbox left for Mike.

## Files modified

- `packages/desktop/test/unit/standaloneHtml.test.ts`
- `packages/desktop/test/e2e/export.spec.ts`
- `packages/desktop/test/e2e/versions-rename.spec.ts` (new)

## Test/build status

- `cd packages/desktop && npx vitest run`: 31 files, 358 passed.
- `cd packages/desktop/src-tauri && cargo test`: 88 passed, 1 ignored.
- `npx playwright test --config test/e2e/playwright.config.ts versions-rename export settings search`: 10 passed.
- Full e2e suite not run (port 1430 was shared with FIX1; ran only the relevant specs).

## Issues

No production bugs found. Worktree HEAD was `b18d23c` (not `62c8167`); tree was clean, so reset to `62c8167` as instructed.

## Notes for orchestrator

- Cancellation from the TS side, 600 ms save waits untouched (FIX1 owns `versions.spec.ts`).
- Real-window steps below combine M4, T2, M5 to M9 pending checks. Known risk to watch: the first-run title may read `Welcome to MikeDown.md — com.interappdev.mikedown` (M8 note).

## Review Materials

Run: `cd /Users/michaeljosephwork/git/mikedown/packages/desktop && npm run dev`
Fixture (created, outside the repo): `~/tmp-mikedown-t3/notes/` with `alpha.md` (heading, math, code, callout, image `pic.png`), `beta.md` (wikilink to alpha), `sub/gamma.md`, `conflict.md`, `drag-me.md`, `to-delete.md`, `zeta.md`, `large.md` (2.6 MB, over the 2 MB caps), `.hidden/secret.md` and `node_modules/skip.md` (both contain "needle"). "needle" is the search term.
Re-create by hand if you want a clean slate: `rm -rf ~/tmp-mikedown-t3/notes/.mikedown`.

### Walkthrough: one session per OS, about 15 minutes

Tick off as you go. Windows: same steps, Ctrl instead of Cmd, Alt+F4 for quit, and note the OS in your result.

1. **Welcome and menus (M8).** Launch with no folder. Welcome screen shows recent folders/files. Open `~/tmp-mikedown-t3/notes` as a folder. Check the title bar (folder name and file), the menu bar (File/Edit/Format/View/Window/Help), Help > Keyboard Shortcuts sheet. Quit and relaunch: the folder is in Recents; a deleted recent shows greyed.
2. **Tree (T2).** New File (name `idea`, gets `.md`); F2 rename to `plan.md`; drag `drag-me.md` into `sub/`; delete `to-delete.md` and check it landed in the Trash (Mac: Finder Trash). Collapse/expand `sub`.
3. **Tabs and panes (M4).** Open `alpha.md` and `beta.md`. Ctrl+Tab switches. Split with Cmd+\, put `alpha.md` in both panes, type in one: the other follows with no jump. Look at the tab strip in light and dark (flip the OS appearance). Drag a tab to reorder.
4. **Quit with dirty files (M4).** Type in two tabs without saving. Cmd+Q: exactly one dialog; Cancel keeps the app open; then Quit and relaunch: both tabs come back dirty with your text. Also force-quit once (Activity Monitor / Task Manager) with a dirty tab and relaunch: text restored.
5. **Settings (M5).** Gear > App tab present. Change body font, Save: reopen the app, still applied. Change one setting with "Save for this folder": `~/tmp-mikedown-t3/notes/.mikedown/settings.json` holds only that key; opening another folder does not show it. Hand-corrupt the global settings file (add a stray `{`): banner with Open file / Reset, file untouched until you click Reset. No manual theme toggle; chrome follows the OS.
6. **Versioning (M6).** In `alpha.md`: type, Cmd+S, type, Cmd+S, type, Cmd+S, then Cmd+S again with no change. Cmd+Alt+V opens the browser: 3 snapshots, newest first. Compare with Current (side by side, Inline), Restore: buffer changes and turns dirty, nothing written until you save. Rename `alpha.md` in the tree: Versions still lists the snapshots. Open `large.md`, edit, save: saves with no snapshot, no message.
7. **External edit conflict (M6).** Open `conflict.md`, leave it clean, run `echo "changed outside" >> ~/tmp-mikedown-t3/notes/conflict.md`: tab reloads silently. Type in it (dirty), edit it outside again, press Cmd+S: choices Cancel / Compare / Revert / Overwrite; try Compare, then Overwrite.
8. **Folder search (M7).** Cmd+Shift+F, type `needle`: results grouped per file, none from `.hidden` or `node_modules`, `large.md` skipped. Toggle Match Case and Whole Word (`NEEDLES` and `needle-less` change). Arrow keys and Enter open a match at the right line; click a match too. Esc closes.
9. **Image paste and upload (M8 image work).** Paste an image from the clipboard into `beta.md`: file lands in the configured image folder, link inserted. Drop an image file onto the editor.
10. **HTML export and print (M9).** File > Export > HTML on `alpha.md`; choose embed, save to the Desktop, open it in a browser with Wi-Fi off: heading, math, code colors, image, callout all render. Repeat with "copy images" and check the `_files` folder. File > Export > PDF and Print (Cmd+P): the print dialog opens with a sensible page; save as PDF and check page breaks and that a hidden window did not linger.
11. **Default-app prompt (M8).** First run only: prompt to make MikeDown the default for `.md` is offered once and not again.

Record results per OS in the Progress Log; every failure becomes a gap-fill. Leave the T3 hands-on checkbox for Mike.
