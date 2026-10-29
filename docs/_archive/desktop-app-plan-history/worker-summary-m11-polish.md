# M11 Polish: worker summary

**Status:** Complete in code and automated tests. Real-window checks (VoiceOver/Narrator, GUI keyboard session, OneDrive hydration in an interactive session) are pending for a human; exact steps below.
**Worktree:** `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-af0d8dac6331ec5ae`, branch `worktree-agent-af0d8dac6331ec5ae`, based on `4ad561b` (reset there per the prompt; the worktree had started on an older commit).
**Commits:** `483e9cc`, `53d318e`, `71cb541`, `94c288c`, `9fe7f25`, `789bef8`.
**Start / end:** 2026-10-23 20:57 to 21:23 EDT (about 26 min).

## Work completed, per checkbox

**Accessibility (edge 26)**
- Added `@axe-core/playwright` and `test/e2e/a11y.spec.ts`: axe (WCAG 2 A/AA) over welcome, folder + tree, tabs + split, search results, Settings (App tab), changed-on-disk dialog, diff viewer. Chrome violations fail; core violations are printed as `[a11y core note]`.
- Fixed chrome violations axe found: tabs contained a focusable close button (`nested-interactive`), now a non-button span (keyboard closes with Cmd/Ctrl+W); the "still downloading" Retry moved from inside the tab to the pane info bar; search rows had `aria-label`s that did not contain their visible text (names now come from content, with screen-reader-only "Line"/"match(es)" text); whole-word toggle label; search status contrast (removed `opacity`).
- Core: the editor `role=textbox` had no accessible name. Added `aria-label="Document text"` and `aria-multiline` via `editorProps.attributes` (`packages/core/src/editor.ts`) with `packages/core/test/editor-a11y.test.ts`. Root `build:core`, `compile`, `test:unit`, `test:edge` green.
- `prefers-reduced-motion`: a wildcard rule in `app.css` zeroes all chrome transitions/animations (previously only toast, tabs). `prefers-contrast: more`: token overrides for light, auto-dark and explicit dark on `:root`, `.mikedown-root`, `.mikedown-portal`. `forced-colors`: button borders, focus outlines. A spec test emulates all three and checks computed values on the page root and on core's `.mikedown-root` (core's tokens respond because they are zero-specificity `:where`).
- Keyboard-only: `polish.spec.ts` drives tree (Tab into it, Home, Space to open; Enter renames on macOS), Cmd/Ctrl+Shift+E back to the tree, Ctrl+Tab, split, search, Settings, Escape. Passes in Chromium. Quit is a native menu action, not covered.
- **Core violations left (not fixed, in the spec output as notes):** toolbar `Aa` label and `.toolbar-zoom-size` button colour contrast, and `.toolbar-zoom-size` / `textFormat` label-content-name-mismatch (visible "15" vs aria-label "Font size 15px..."). Worth a core backlog item; also affects VS Code.

**Encoding (edge 11): already done, verification added**
- Already done: detection, BOM and CRLF preservation, non-UTF-8 read-only source mode with notice (`fs.rs`, `test/fixtures/encoding/`, `encoding.test.ts`, `save-reload.spec.ts`, Rust fixture test).
- Added: Rust `saving_a_fixture_leaves_the_file_byte_identical` (reads each UTF-8 fixture from disk, decode, encode, `atomic_write`, compares bytes: the `cmp` check) and `mixed_line_endings_are_written_back_as_the_majority` (on-disk). Decision: **mixed endings are written back as the detected majority (tie keeps CRLF)**; implemented already, now documented in the README ("Edge cases and accessibility (M11)").

**Large files (edge 12): thresholds already unit-tested; end to end added**
- Added `polish.spec.ts`: a 2 MB+ file opens in source mode with the bar; typing in CodeMirror and Cmd/Ctrl+S writes the file, no version snapshot, no dialog; "Open as rich text anyway" switches a second file; a 21 MB file is refused without any `read_text` and the default-app offer is made.

**Filesystem (edge 25): mostly done; gaps closed**
- Already done: `validate_name`/`validate_target` in Rust and `treeLogic.ts` for create, rename, move, copy (reserved names, trailing dot/space, forbidden characters, 259 limit), case-only two-step rename (Rust test, run on macOS APFS and BEAST NTFS).
- Added: `check_new_target` so Save As and pasted images (`write_text`, `write_bytes`) are validated before anything is created (existing files are exempt); unit test. Added a unit test covering every reserved name (CON, PRN, AUX, NUL, COM1-9, LPT1-9, with extension, lowercase, trailing dot, space) plus the 260-character path refusing before any disk call (`folderWorkspace.test.ts`).

**Read-only and permissions (edge 10)**
- Already done: lock badge, Save As with reason (`panes.test.ts` new test, `encoding.test.ts`).
- Added: OS errors in plain words (`plain_reason`/`describe` in `fs.rs`: permission denied, read-only disk, gone, disk full, busy, Windows cloud errors). Folder write permission: `stat` now reports directories as read-only via `access(2)` on Unix (read-only attribute on Windows); the sidebar New buttons disable with a tooltip, the tree context menu disables New/Rename/Delete with the reason, and create/rename/delete are refused with a toast. Tests in `folderWorkspace.test.ts` and Rust. Windows ACL-denied folders are not pre-detected (documented).

**Network drives and cloud placeholders (edge 10)**
- SMB (measured, `/Volumes/Storage-1`, a file created on BEAST over SSH): the polling watcher saw it in 6.06 s; **the native FSEvents watcher started without error and never reported it (25 s)**. So "degrades to polling if native fails" did not hold on SMB. Added `is_network_path` (macOS `MNT_LOCAL`, Linux fs magic, Windows UNC and `GetDriveTypeW`); `watch` goes straight to polling on network volumes. Verified it classifies the share as network on the Mac and a UNC path on BEAST; local temp is not.
- iCloud (`brctl evict`, dataless): `stat` and the read-only probe do not hydrate the file; a read downloads it in about 1 s and returns the text. The slow-read "still downloading" state and Retry were already covered; Retry now lives in the pane info bar (axe fix).
- OneDrive Files On-Demand on BEAST (real placeholder, SSH session): reading fails with OS error 395 "Access to the cloud file is denied". Now worded "...has not finished downloading... check that OneDrive is running and online, then retry", and `documentController.load` turns that into the same downloading tab + Retry instead of an error dialog (unit test). Not verified: a successful hydration in an interactive session (see pending).
- Manual ignored cargo tests for repeating these: `network_share_reports_a_file_created_elsewhere`, `a_mounted_share_is_a_network_path`, `an_evicted_icloud_file_reads_after_the_os_downloads_it` (env vars in the doc comments).

**Drag-drop toasts (edge 20) and delete confirmation (edge 21): already done; e2e added**
- Already done: `dropOnEditor` toast, `folderWorkspace` confirm with checkbox, persisted via `store.onTreeChange` (unit + settings spec).
- Added e2e: a PDF dropped on the editor (`tauri://drag-drop` emit) toasts "cannot insert" and changes nothing; "Don't ask again" writes `tree.confirmDelete=false` to `settings.json`, the next delete and a delete after relaunch skip the prompt.

## Files modified

Core: `packages/core/src/editor.ts`, `packages/core/test/editor-a11y.test.ts`.
Desktop source: `src/app/documentController.ts`, `src/panes/paneManager.ts`, `src/search/searchPanel.ts`, `src/styles/app.css`, `src/styles/search.css`, `src/tree/folderWorkspace.ts`, `src/ui/contextMenu.ts`, `src/ui/sidebar.ts`, `src-tauri/src/commands/fs.rs`, `src-tauri/src/commands/watcher.rs`, `src-tauri/Cargo.toml` (+ `Cargo.lock`: `libc` on Unix), `package.json` (+ root `package-lock.json`: `@axe-core/playwright`), `README.md`.
Tests: `test/e2e/a11y.spec.ts`, `test/e2e/polish.spec.ts`, `test/unit/folderWorkspace.test.ts`, `test/unit/panes.test.ts`.

## Test and build status (all in this worktree)

- `npm run build:core`, `npm run compile`: green.
- `npm run test:unit`: 104 files, 1340 passed. `npm run test:edge`: 22 passed.
- `packages/desktop`: `npx tsc --noEmit` clean; `npx vitest run --config vitest.config.ts` 31 files, 364 passed; `npx playwright test --config test/e2e/playwright.config.ts` 36 passed (was 27).
- `cargo test` in `src-tauri` (macOS arm64): 94 passed, 4 ignored (manual). On BEAST (Windows, `cargo test --lib`): 37 passed, 4 ignored, including case-only rename on NTFS, the Windows validators and the new Windows `GetDriveTypeW` code compiled and run.
- Not run: root `lint`, VS Code integration tests (no extension code changed; the core change is one editor attribute).

## Issues and notes for the orchestrator

- I copied the changed `fs.rs`, `watcher.rs`, `Cargo.toml`, `Cargo.lock` into BEAST's `C:\git\mikedown` (a tarball snapshot, not a clone) to run the Windows tests; it now carries M11's Rust changes.
- Worktree started on an old commit; I reset it to `4ad561b` as the prompt says. `desktop-app-plan.md` is untouched.
- The prompt file lives in the main tree's untracked `.orchestrator/`; I read it from there.
- Axe was run in Chromium, not in WKWebView or WebView2.
- Windows: reserved names / long paths were validated by Rust unit tests running on Windows, not through the GUI.
- Core backlog candidate: toolbar contrast and zoom-button label mismatch (above).
- The new `libc` dependency is Unix-only and was already in the lockfile transitively.

## Review Materials

Run the app: `cd /Users/michaeljosephwork/git/mikedown/packages/desktop && npm run dev` (main tree does not contain M11; to try it, check out this branch or cherry-pick `483e9cc..789bef8`).
Fixtures: `packages/desktop/test/fixtures/encoding/` in the worktree. Specs: `packages/desktop/test/e2e/a11y.spec.ts`, `polish.spec.ts`.

**Pending real-window checks (not done: the Mac screen was assumed busy with Mike's walkthrough, no GUI driven)**

1. VoiceOver (macOS): `Cmd+F5`, open a folder. In the tree, VO+arrows should read "name, file/folder, expanded, level N". Tabs: "a.md, tab, 1 of 2, selected"; a dirty tab adds "unsaved changes", a locked one "read-only". Search results: file rows read "a.md notes 2 matches", match rows "Line 3 ...". Settings and the changed-on-disk dialog should announce as dialog / alert dialog.
2. Narrator (Windows, RDP to BEAST or DevBox1): same list, `Win+Ctrl+Enter`.
3. Keyboard-only session in the real window (no mouse): Open Folder (`Cmd/Ctrl+O` or menu via Alt), Tab into the tree, arrows, Space opens, `Cmd/Ctrl+\` split, `Cmd/Ctrl+Shift+F` search, Ctrl+Tab tabs, `Cmd/Ctrl+,` Settings, Esc, quit with `Cmd+Q` / Alt+F4.
4. Visible focus rings in real WKWebView/WebView2 in light, dark, and with System Settings > Accessibility > Display > Increase contrast (macOS) or Contrast themes (Windows): borders and text should get stronger; also Reduce motion on.
5. OneDrive on BEAST at the console or RDP: pick a cloud-only file in `C:\Users\michaeljoseph\OneDrive`, open it in MikeDown: it should download and open; with OneDrive paused or offline, it should show the downloading tab with Retry in the info bar.
6. Read-only folder on a Mac: `mkdir /tmp/ro && chmod 555 /tmp/ro`, open it as a folder: New File / New Folder buttons are disabled with a tooltip; right-click shows New/Rename/Delete greyed out with the reason.
7. Open a `.md` on the SMB share (`/Volumes/Storage-1/...`) and change a file from another machine: the tree should update within about 2 s.
