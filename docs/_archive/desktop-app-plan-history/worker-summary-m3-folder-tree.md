# Worker summary: M3 Folder sidebar and file tree

(Written to the scratchpad because the worktree sandbox refused the shared-checkout path `.orchestrator/desktop-app-plan/worker-summary-m3-folder-tree.md`.)

**Status:** Completed (code, tests, measurements). The hands-on GUI pass in the real WKWebView window is **pending**: the Mac's screen was locked for the whole session (`CGSSessionScreenIsLocked = true`, `screencapture` returns black), so no osascript keystrokes were sent and no real-window screenshots exist. Only results marked as observed below were observed.

- Worktree: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-ab69f0bc6715d0cf0`, branch `worktree-agent-ab69f0bc6715d0cf0`, based on `1924c40`.
- Start 2026-10-23 17:57 EDT, end about 18:45 EDT.

## Commits

| SHA | What |
| --- | --- |
| `b01e317` | Core: `handle.insertLink` / `insertImage` / `refreshLinks`; wikilink cache cleared on load; `[[` autocomplete looks up `host.getLinkSuggestions` at use time |
| `0210582` | Rust: tree commands, Trash, watcher, xattr-preserving saves (+ tests) |
| `d204381` | Desktop TS: sidebar, tree, workspace ops, `.md` index, drops, Open Folder (+ unit tests, e2e spec) |
| `72069cd` | Virtualised tree rows, NSFileManager Trash, timing probes |
| `b1a7eee` | README / e2e README / capability description |

## Work completed (per checkbox)

- [x] **fs.rs**: `list_dir(path, options?)` sorts folders first, natural order; with `options` hides dotfolders, `node_modules` and OS clutter (`.DS_Store`, `Thumbs.db`, `desktop.ini`) unless `showHidden`; without options (image pipeline) returns every name. MikeDown temp files are never listed. `rename` (two-step temp rename for case-only changes, refuses to overwrite), `create_file`, `create_dir`, `move_path` (cross-volume falls back to copy + delete, creates parent dirs), `copy_path`, `trash` (the `trash` crate; on macOS via `NSFileManager`, so no "control Finder" permission prompt), Windows reserved-name / forbidden-character / trailing dot-space and >259-char validation with plain-language errors before touching disk. Also `allow_folder`, `list_markdown`, `reveal_path`, `modifier_state`.
- [x] **xattr task**: `atomic_write` copies all xattrs to the temp file before the rename; `copy_path` and the cross-volume move copy them; a plain rename/move keeps them (same inode). Rust tests cover save, rename, move, file copy and folder copy. Windows: read-only bit via the mode; no ADS (as allowed).
- [x] **watcher.rs**: `watch` / `unwatch` / `unwatch_all` per directory (notify 8, non-recursive), emits `fs-changed {kind, path, dir}`; falls back to `PollWatcher` (2 s) when the native watcher cannot start or reports an error later. `MIKEDOWN_WATCH_POLL=1` forces polling.
- [x] **src/tree/**: lazy per-directory load on expand; only visible expanded dirs are watched. ARIA `tree`/`treeitem` with `aria-level/setsize/posinset/expanded/selected`, roving tabindex. Keys: arrows, Home/End, PageUp/Down, Right/Left expand/collapse/parent, Space opens, Enter opens on Windows and renames on macOS (VS Code convention), F2 renames, Cmd+Down opens (mac), Delete / Cmd+Backspace trash, Shift+F10 / ContextMenu key, type-ahead, Escape back to the editor. Context menu: Open, New File, New Folder, Rename, Move to Trash, Reveal in Finder / Show in Explorer, Copy Path, Copy Relative Path, Show/Hide Hidden Files. Tab context menu (covers lone files): Reveal, Copy Path, Open Containing Folder, Open Folder. Inline rename with live validation. New File creates `Untitled.md` (or `Untitled N.md`) on disk, enters rename with the stem selected, appends `.md` to a typed name without an extension. Show-hidden toggle in the header. Rows are virtualised (a flat 10,000-file directory took 3 s before, 268 ms after).
- [x] **Drag-drop**: in-tree pointer drags move, Alt copies; OS drops (Tauri `onDragDropEvent`) onto the tree copy with Finder-style free names, Option/Alt (read from the OS at drop time) moves. Onto the editor: image → `imagePipeline.uploadImage` from the file bytes, then `handle.insertImage`; `.md` → relative link at the cursor (`handle.insertLink`); other text → opens (replaces the one document; M4 makes it a tab); anything else → toast.
- [x] **Delete confirmation** with "Don't ask again" (in-page dialog; stored in `desktopSettings.tree.confirmDelete`, in memory until M5). Rename/move/delete carry `.mikedown/versions/<rel path>/` along (move or trash) when it exists.
- [x] **Open Containing Folder / Open Folder** (`CmdOrCtrl+Alt+O`, sidebar empty state, tab menu): replaces the window's folder, asks about unsaved changes only when the active file is outside the new folder, keeps it open when inside. A folder passed on argv / the launch queue opens as the window's folder. The Open Containing Folder button hides while the file sits inside the open folder.
- [x] **Folder `.md` index** (`src/tree/mdIndex.ts`): lazy (first question, not at open), invalidated by watcher events and tree ops, 15 s TTL for unwatched folders. `getLinkSuggestions`, `getFileHeadings`, `resolveWikilinks` (basename or path-suffix match, nearest by same folder → hops → shorter path, `count` for ambiguity), `createWikilink` (next to the current document, refuses `..`/absolute, then opens it), `checkLinks` (anchors, missing files, missing anchors in other files). TauriHost adds these methods only while a folder is open (`setKnowledgeBase`); lone-file windows have none. "Create file" for broken links: following a link to a missing `.md` asks to create it. Desktop default `wikilinkCreateOnClick: true`.
- [x] **Sidebar layout**: resizable (mouse, or arrow keys on the separator; double-click resets), collapsible, width remembered in localStorage (try/catch; M5 can move it), `--mikedown-*` tokens, forced-colors rules. Starts collapsed in lone-file windows with an Open Folder empty state.
- [x] Commit.

### Core change (the host API genuinely lacked it)

`handle.insertLink(href, text?)`, `handle.insertImage({src, alt})` (rich text via a PM transaction, source mode via CodeMirror), `handle.refreshLinks()`. The wikilink resolution cache is now cleared on every load (its hrefs are relative to the previous document, which is wrong once one editor shows many files). The `[[` autocomplete extension is always registered and asks `host.getLinkSuggestions` when it opens, so a host can gain the method after construction. jsdom tests: `packages/core/test/host-insert-refresh.test.ts`. VS Code behaviour unchanged.

### Shortcut collision (CmdOrCtrl+B vs Bold)

`toggleSidebar` is marked `outsideEditor`: inside the editor Cmd/Ctrl+B stays Bold; from the tree or chrome it toggles the sidebar. `CmdOrCtrl+Shift+E` (VS Code's Explorer chord, unused by core) shows the sidebar and focuses the tree from anywhere; the tab strip and sidebar header also have toggle buttons. Alt chords match the physical key on macOS (Option+O types ø).

## Measured numbers (Mac Studio, debug build, `VITE_MIKEDOWN_TIMING=1`)

Fixture `~/tmp-mikedown-m3/` (generator: `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/89bd0ac2-9494-456f-abcb-114e9fd2e731/scratchpad/make_fixture.py`): `big/` = 10,000 notes in 10×10 folders plus root files, `.git`, `node_modules`; `flat/` = 10,000 notes in the root; `demo/` = small knowledge base.

| Measurement | Result |
| --- | --- |
| Open `big/` (10,000 files), launch → rows in DOM | **5 ms** (root only; 13 rows) |
| Open `flat/` (10,000 files in one directory) | 3,047 ms before virtualisation, **268 ms** after |
| Native watcher (FSEvents): file created in shell → `fs-changed` in the page | 13 / 15 / 40 ms |
| Same → row visible in the tree (includes the 120 ms refresh debounce) | 139 / 144 / 173 ms |
| Polling fallback (`MIKEDOWN_WATCH_POLL=1`) → row visible | 1,074 / 1,592 / 2,103 ms |
| Rust watcher tests, macOS | native 10.9 ms, poll 1.71 s |
| Rust watcher tests, Windows (BEAST) | native 0.35 ms, poll 1.72 s |

## Platform checks

- **Case-only rename**: macOS APFS (case-insensitive) via `case_only_rename_changes_the_name_on_disk` (file and folder): passes. **Windows NTFS on BEAST**: same test passes.
- **Trash**: macOS: `cargo test trash_moves -- --ignored` trashed a real file and Finder's `items of trash` lists it. Windows: the same test; the Recycle Bin (Shell namespace 10) lists it.
- **BEAST**: refreshed `C:\git\mikedown` with `git archive HEAD packages/desktop/src-tauri packages/desktop/test/fixtures | ssh … "tar -xf - -C C:/git/mikedown"`; `cargo test`: 31 passed, 1 ignored (the 4 unix-only xattr/mode tests are cfg'd out). Windows-only code (`GetAsyncKeyState`, `explorer /select`) compiles there; not exercised in a GUI.

## Test / build status

- Root `npm run compile`, `npm run test:unit` (77 files), `npm run test:edge`: green after the core change.
- `npm run build:core`; `npx tsc --noEmit` in `packages/desktop`: clean.
- Desktop vitest: 15 files, 135 tests. New: `treeLogic`, `dropRouting`, `mdIndex`, `folderWorkspace`, `knowledgeBase` (real core in jsdom: `[[Note Name]]` resolves to the nearest file, Cmd+click opens it, Cmd+click on an unresolved one creates it), shortcut additions.
- Playwright e2e: 5 passed, incl. the new `tree.spec.ts`.
- `cargo test` in `src-tauri/`: 35 passed, 1 ignored (Trash; on request).

## Issues / blockers

1. **GUI pass not done** (screen locked). Pending hands-on, macOS and Windows: tree clicks and keys in the real window; inline rename and delete through the UI; context menu; Reveal in Finder; drag from Finder onto the tree and onto the editor (check the drop position maps correctly at Retina scale, and that an image dropped on the editor is inserted **once**: if WKWebView also hands the DOM drop to core's image paste, there would be two); Option-drag; resize handle; real light/dark screenshots.
2. **Windows + `dragDropEnabled: true`**: Tauri documents that HTML5 drag-and-drop inside the page does not work on Windows while it is on. The tree uses pointer events (unaffected), but core's HTML5 drags (task items, tables) may have been broken on Windows since M0. Needs a Windows GUI check; a fix is a trade-off (OS file drops vs in-page HTML5 DnD), so it is your call.
3. The polling fallback's worst case measured 2.1 s, just over the 2 s target, which the native path meets easily. A shorter refresh debounce or poll interval would close it.

## Notes for orchestrator

- `tauri.conf.json` now sets `plugins.fs.requireLiteralLeadingDot: false`; without it `$HOME/**` does not match dot paths, so `.mikedown/versions` moves and show-hidden listings would fail `ensure_allowed`.
- Tree prefs (`showHidden`, `confirmDelete`) and the sidebar width are in memory / localStorage; M5 should persist them (`desktopSettings.pendingPatch()` records `tree.*`).
- M4 hooks: `fileTree.expandedDirs()` for session restore; `controller.pathMoved/pathDeleted` become per document model; tree clicks and "open" drops currently replace the single document.
- New stylesheet `src/styles/sidebar.css` beside `app.css` (chrome only).
- The planning document was not edited.

## Review Materials

- Screenshots (Playwright Chromium over `vite dev` with the mocked Tauri layer, **not** WKWebView): `/Users/michaeljosephwork/git/mikedown/.orchestrator/desktop-app-plan/artifacts/m3-tree/m3-e2e-light.png`, `/Users/michaeljosephwork/git/mikedown/.orchestrator/desktop-app-plan/artifacts/m3-tree/m3-e2e-dark.png`. Regenerate with `M3_SHOTS=<dir> npm run test:e2e -w packages/desktop`.
- Run the app on a folder (from the worktree): `export PATH="$HOME/.cargo/bin:$PATH"; npm run dev -w packages/desktop -- -- ~/tmp-mikedown-m3/demo`. Add `VITE_MIKEDOWN_TIMING=1` for timings, `MIKEDOWN_WATCH_POLL=1` to force polling.
- Fixture folders: `~/tmp-mikedown-m3/demo` (wikilinks incl. an unresolved one, a broken relative link, `case-test.md`, `trash-me.md`, a hidden `.obsidian`), `~/tmp-mikedown-m3/big`, `~/tmp-mikedown-m3/flat`.
- Click paths: open `Welcome.md` → Cmd+click `[[Roadmap]]` opens it; Cmd+click `[[Someday Maybe]]` creates it next to Welcome; click the "Gone" link → "Create File" prompt. Select `case-test.md` → Enter (mac) / F2 → type `Case-Test.md` → Enter → Finder shows the new case. Select `trash-me.md` → Cmd+Backspace → confirm (tick Don't ask again) → file in the Trash. The eye button toggles `.obsidian`. Cmd+B with the tree focused collapses the sidebar; Cmd+Shift+E brings it back. Drag a file from Finder onto `ideas/` (copy) and with Option (move); drag an image onto the editor.
