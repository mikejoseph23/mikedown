# Worker summary: M7 Folder search

**Status:** Completed (code, unit, Rust and e2e tests green). GUI checks against the real Tauri window are pending (see Review Materials).

**Note on location:** the harness refused writes to the main repo path from this isolated worktree, so this file is at `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a3ebbd02d11f8a817/.orchestrator/desktop-app-plan/worker-summary-m7-search.md` (git-ignored). Copy it to the main repo's `.orchestrator/desktop-app-plan/`.

**Worktree:** `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a3ebbd02d11f8a817`, branch `worktree-agent-a3ebbd02d11f8a817`
**Commits (on top of `1582e3d`):**

- `8d58d65` Desktop: streaming folder search command with cancel, caps and exclusions
- `4a16df0` Core: revealText(line, column, length) shows a source match in rich text or source mode
- `0fd9125` Core: leave Cmd+Shift+F to hosts that own shortcuts in source mode
- `7ce4c67` Desktop: folder search panel in the sidebar, Cmd+Shift+F, click to open and reveal the match
- `656ab0e` Desktop: folder search e2e spec, command hook in the e2e fixture, README notes

Start 19:30, end 20:05 (2026-10-23). The worktree started on an unrelated HEAD (`b18d23c`); the tree was clean so I ran `git reset --hard 1582e3d` per the prompt.

## Work completed

- **Rust `commands/search.rs`**: `search_folder` (returns at once, runs on a thread, streams `search-batch {id, matches[]}` then `search-done {id, summary}` to the calling window via `emit_to`) and `search_cancel`. Matches are `{ path, line, column, snippet, matchStart, matchEnd }`. Extensions: markdown (`md markdown mdown mkd mkdn mdx rmd`), `txt`, and the TEXT_EXTS list from `documentModel.ts`. Exclusions reuse `fs::is_hidden_entry` (dotfolders, `node_modules`, clutter) unless `showHidden`; `.mikedown/` never searched; symlinked dirs not followed. Files over 2 MB, files with NUL in the first 8 KB, and non-UTF-8 files are skipped. Reads go through `fs::decode`, so BOM/CRLF handling and columns match what the editor shows. Options `caseSensitive`, `wholeWord`, `showHidden`, `limit` (clamped to 2,000). Hand-written substring matcher (ASCII-fold fast path, per-char simple lowercase for non-ASCII), no regex, no new crate. Offsets are UTF-16 units so the webview slices strings directly. Batching: first batch flushes at once, then every 50 matches or 40 ms. Cancel checked per file and every 2,048 lines.
- **`src/search/`**: `searchLogic.ts` (controller: 250 ms debounce, cancels the replaced run and ignores its late events, groups by file, 2,000 cap with `truncated`; plus the pure keyboard model, snippet split, relative dir) and `searchPanel.ts` (query box, Aa and whole-word toggles with `aria-pressed`, status line, collapsible file groups with counts, highlighted `<mark>` snippets). Results are an ARIA tree (`role=tree`, flat `treeitem` rows with `aria-level/posinset/setsize/expanded/selected`, `aria-activedescendant`). Keys: arrows, Home/End, Left/Right collapse/expand, Enter opens a match (toggles a file), Esc closes, ArrowDown from the box enters the list. "refine your search" note when capped. `styles/search.css` includes `forced-colors`.
- **Sidebar view switch**: search icon in the sidebar header plus `CmdOrCtrl+Shift+F` (new `searchFolder` row in `shortcuts.ts`; also an Edit menu item "Search in Folder…" in `menu.rs`). With no folder open it toasts "Open a folder to search it." Opening another folder resets results; toggling Show Hidden re-runs the query.
- **Core `revealText(line, column, length)`** (new `packages/core/src/revealText.ts`, handle method, `types.ts`): source mode selects the exact CodeMirror range and centers it; rich text re-finds the Nth occurrence of the matched string (N counted in the markdown source) in the rendered doc, selects and centers it; falls back to a proportional scroll when the text is not rendered (frontmatter, URLs). `documentController.openPath` got `OpenOptions.reveal` (reveals now and once more after a frame).
- **Core collision fix**: core's source-mode capture listener treated `Cmd+Shift+F` as Find (it accepts uppercase `F`) and would swallow the app chord. It now returns early when `hostOwnsShortcuts && shiftKey`. The VS Code extension does not set `hostOwnsShortcuts`, so its behavior is unchanged.

## Files modified

New: `packages/desktop/src-tauri/src/commands/search.rs`, `packages/desktop/src/search/{searchLogic,searchPanel}.ts`, `packages/desktop/src/styles/search.css`, `packages/desktop/test/unit/search.test.ts`, `packages/desktop/test/e2e/search.spec.ts`, `packages/core/src/revealText.ts`, `packages/core/test/reveal-text.test.ts`.

**Hot-spot files touched (all small and additive):**

- `packages/desktop/src/main.ts`: 3 imports, 2 late-bound `let`s, `showSearch` plus a changed `toggleHidden` line inside the `createSidebar` call, one search block after `sidebar.setTreeEl`, `searchFolder: showSearch` in `actions`, `searchPanel.reset()` after `workspace.open` in `openFolder`.
- `packages/desktop/src/menu/shortcuts.ts`: one `AppCommand` member, one row, a doc note.
- `packages/desktop/src/ui/sidebar.ts`: search button, search container, `setSearchEl/setView/view`, optional `showSearch` action, `searchLabel` option. (`chrome.ts` not touched.)
- `packages/desktop/src/documents/fsApi.ts`: appended `searchApi` block and one type import.
- `packages/desktop/src/app/documentController.ts`: `OpenOptions.reveal` and a `revealMatch` helper called in two places.
- `packages/desktop/src-tauri/src/lib.rs`: `.manage(Searches)`, two handler entries, header comment. `commands/mod.rs`: `pub mod search;`. `menu.rs`: one Edit item. No `Cargo.toml`, capabilities or `package.json` changes (app commands need no permission entries here).
- `packages/desktop/test/e2e/fixtures.ts`: added `ipc.custom` (per-spec command handlers checked before the built-ins), 3 lines. T2 may also touch this file.
- `packages/desktop/README.md`: shortcut, layout and command notes.
- `packages/core/src/editor.ts` and `types.ts`: `revealText` plus the `hostOwnsShortcuts` Shift guard.

## Test and build status

- `cargo test` in `src-tauri`: 61 passed, 1 ignored (14 new in `search.rs`: matcher case, whole word and non-ASCII fold; snippet offsets incl. multibyte and long lines; ordering and line/column; hidden and `node_modules` exclusions; whole word across files; 2 MB, binary and non-UTF-8 skips; CRLF+BOM columns; cap/truncation; cancellation; empty query; the 2,000-file budget).
- `npm run test:unit -w packages/desktop`: 213 passed (23 new in `search.test.ts`: debounce, cancel and stale events, grouping, cap, Rust truncated flag, empty query, option passthrough, error state, keyboard model, panel DOM and ARIA).
- Playwright `npx playwright test -c packages/desktop/test/e2e/playwright.config.ts`: 9 passed. New `search.spec.ts`: chord opens panel, typing, grouped results with hidden/node_modules excluded, whole word narrows 4 to 3 results, click opens `b.md` with the 2nd "needle" selected, keyboard Enter opens `a.md` with the match selected, Esc returns to the tree. The Rust walker is stood in by a small JS mock in the spec.
- Root: `npm run compile` OK, `npm run test:unit` 1181 passed, `npm run test:edge` 22 passed. `npm run typecheck -w packages/desktop` clean.
- Core: `reveal-text.test.ts` 6 passed (locate helper, rich-text selection of the right occurrence, exact source-mode range, no throw on unrendered text, Cmd+Shift+F gating).

## Measured results (Rust, 2,000 files of ~40 paragraphs in 40 folders, `search_2000_files_meets_the_budget`, Mac Studio)

| Query | Matches (files) | First batch | Complete (release) | Complete (debug) |
| --- | --- | --- | --- | --- |
| `zebrafish` | 803 (803) | 0.23 ms | 50 ms | 176 ms |
| `protocol` | 803 (803) | 0.10 ms | 50 ms | 184 ms |
| `lorem` (hits the cap) | 2,000 (50), truncated | 0.12 ms | 2.4 ms | 12 ms |
| `qqqzzz` (no match, full scan) | 0 | n/a | 50 ms | 170 ms |

Acceptance (first results under 300 ms, complete under 2 s) is met with a wide margin; the test asserts both bounds. The event hop and DOM render in the real window were not measured.

## Issues and notes for the orchestrator

- **Rich-text reveal is text-based, not source-mapped.** Core has no source map, so `revealText` finds the matched string again in the rendered text (Nth occurrence). Matches inside link URLs, frontmatter or markdown syntax fall back to a proportional scroll. Source mode (text files) is exact.
- Opening a result moves focus to the editor (same as opening from the tree). To keep stepping through results, press Cmd+Shift+F to return to the list; query and results are kept.
- Search is single-threaded; at 50 ms for 2,000 files nothing more is needed.
- `search-batch` / `search-done` use `emit_to(window label)`, so several windows searching at once do not cross.
- `menu.rs` is M8 territory; my edit is one separator and one item and should cherry-pick cleanly.
- The harness blocked writing this summary to the main repo path (see top).
- Plan doc not edited, per the rules.

## Review Materials

- Worktree: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a3ebbd02d11f8a817`
- Run the app: `cd <worktree> && npm run build:core && npm run dev:desktop -- -- /abs/path/to/a/folder`
- Rust numbers: `cd <worktree>/packages/desktop/src-tauri && cargo test --release search_2000 -- --nocapture` (see the `[search-perf]` lines).
- e2e: `cd <worktree> && npx playwright test -c packages/desktop/test/e2e/playwright.config.ts search`
- Hand fixture: a folder with `a.md`, `notes/b.md` (two lines containing "needle"), `notes/c.md` ("needles"), `.hidden/x.md`, `node_modules/y.md`. The 2,000-file fixture is built by the Rust test in a temp dir.
- **Pending GUI checks (not run: I did not drive the real window):**
  1. Open the folder, press Cmd+Shift+F (or click the magnifier in the sidebar header). The Search panel replaces the tree and the box is focused.
  2. Type `needle`; results appear after about 250 ms, grouped by file with counts and the word highlighted; `.hidden` and `node_modules` files are absent. Click the sidebar eye icon (Show Hidden): the query re-runs and they appear.
  3. Toggle `ab` (whole word): "needles" in `c.md` drops out. Toggle `Aa` with `Needle` to check case.
  4. Click the second match in `notes/b.md`: the file opens in the active pane with the match selected and centered. Repeat with a `.txt` file (source mode, exact line).
  5. Keyboard: ArrowDown from the box enters the list; arrows move; Left/Right collapse/expand a file; Enter opens; Esc returns to the tree. VoiceOver should read "file, N matches, expanded" and "Line N: snippet".
  6. In source mode (Cmd+/) press Cmd+Shift+F: the search panel opens, not core's find bar.
  7. Dark mode, the Windows (BEAST) look of the panel, and responsiveness on a large real folder.
