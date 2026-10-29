# Worker summary: M8 (welcome, recents, menus, window title)

**Status:** Completed in code. Real-window GUI checks are still pending because Mike was using the Mac (screen unlocked, VS Code in front), so I did not drive the GUI.

Worktree: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a7eef5ab8c813b605`, branch `worktree-agent-a7eef5ab8c813b605`, rebased onto `main` `4669970` (M6 included).

Commits (after the rebase):

- `c563d38` Core: menu-bar commands (heading1..6, paragraph, openFind, openFindReplace, insertTable/Link/Image, zoomIn/Out/Reset)
- `868a80f` Desktop: command table with `when` clauses drives the native menu; `menu.rs` builds it from the page's spec
- `0abd82f` Desktop: recents.json with missing-launch pruning, welcome screen, bundled welcome guide, window title rules
- `48020eb` Desktop: wiring in `main.ts`, e2e for welcome and menus, README notes
- `4ca1fd2` Desktop: M6 Show Versions in the command table (`CmdOrCtrl+Alt+V`), Save stays enabled on a clean document

The pre-rebase SHAs were `cf55918`, `0c2055c`, `18d9964`, `0d3c439`.

Start 20:07, end 20:33 (2026-10-23); the merge integration finished at 20:38.

## Work completed (per checkbox)

- **Welcome screen** (`src/ui/welcome.ts`, `src/styles/welcome.css`): it shows whenever a window has no folder and no open document (at boot, after the last tab closes, and in New Window). It offers Open Folder, Open File and New File (each with its chord), then recent folders and recent files. A missing entry is greyed and struck through, its open button is disabled, and a "×" removes it. There is also a one-paragraph hint. Recents live in `<app-data>/recents.json` (`src/app/recents.ts` + `commands/recents.rs`): newest first, deduped (case-insensitive on mac/Windows), capped at 10. The main window runs a launch check once per launch, and an entry missing on 3 launches is pruned. Removals persist. Rust reports which listed paths are missing, and `recents_allow` extends the fs scope only for paths the file actually lists.
- **First run** (edge 29): this is the first launch with no `recents.json`, in the main window, with nothing else open. `welcome_file` copies the `include_str!`-bundled `src-tauri/resources/welcome.md` to `<app-data>/Welcome to MikeDown.md` so edits never touch the signed bundle. An unmodified older copy gets refreshed, and an edited copy is kept (a sha marker tracks this). The copy opens as a lone file. A one-time "Open .md files with MikeDown?" dialog follows: Set as Default reuses `appActions.setDefaultApp` (Finder steps on macOS, `ms-settings:defaultapps` on Windows), and both answers set `fileAssociationsOffered`.
- **Native menus** (edge 23): `src/menu/shortcuts.ts` `COMMANDS` is the single table: `{ command, label, accelerator, when, keys: app|core|os, platform, core }`. `src/menu/menuSpec.ts` arranges it per OS, and `menu_set` makes Rust build the bar (a bootstrap menu covers the first frame). The menus are:
  - App (macOS): About, Settings… `Cmd+,`, Services, Hide, Quit `Cmd+Q`.
  - File: New File, New Window, Open File…, Open Folder…, Open Recent ▸ (filled by `menu_set_recents`), Save, Save As…, Save All, Open Containing Folder, Reveal in Finder / Show in Explorer, Export ▸ HTML/PDF, Print…, Close Tab, Close Window. On Windows it also has Settings… and Exit `Alt+F4`.
  - Edit: Undo, Redo, native Cut/Copy/Paste, Paste Without Formatting, Select All, Find…, Find and Replace… (Replace… on Windows), Find in Folder…, Spelling ▸ (toggle, Spelling Settings…).
  - Format: Bold, Italic, Strikethrough, Highlight, Code, the three lists, Heading ▸ (Paragraph, H1–H6), Insert ▸ (Table, Link…, Image…, Emoji…).
  - View: Toggle Sidebar, Show Sidebar, Toggle Source Mode `Cmd+/`, Split Right/Down, Zoom In/Out/Actual Size, Show Hidden Files, Full Screen (macOS).
  - Window: Minimize, Zoom, Next/Previous Tab, Bring All to Front; it is set as the NSApp windows menu.
  - Help: Welcome Guide, Keyboard Shortcuts (an in-app sheet generated from the table), Check for Updates…, MikeDown Website (`https://iadev.net/mikedown/`), Report an Issue (GitHub issues). About is here on Windows.
  - Every existing id is kept: quit, newWindow, closeTab, closeWindow, searchFolder, exportHtml, exportPdf, print, split, tabs, and the rest.
- **Routing and enablement:** editor rows call `handle.command(<MikeDownCommand>)`. The page's key handler now runs in the capture phase on the same table, gated by the same `when` clauses, so a greyed item is inert from the keyboard too. The focused window pushes enablement with `menu_update`; it re-syncs on focus, focusin, registry changes and after every command. A menu event that repeats a chord the page already handled within 400 ms is dropped, which stops WebView2 from firing a command twice. Undo/Redo from the menu while typing in an input outside the editor go to that input.
- **Window title:** `src/app/windowTitle.ts` produces `file — folder` (the window's folder, or the file's own folder for a lone file), `Untitled — folder`, plain `Untitled` with no folder, `folder` for a folder window with no tab, and `MikeDown` for the welcome screen. Non-mac platforms get a dirty bullet. It reuses M2's `set_document_edited` / `set_represented_file`.

## Decisions worth knowing

- **Strikethrough moved to `CmdOrCtrl+Shift+X`** (the Google Docs chord). `Cmd+Shift+S` is Save As, and the app chord now wins over TipTap's Strike binding. Before this change both fired, so it was a pre-existing bug.
- Mac "Find and Replace" is `Cmd+Option+F` (Apple's chord), because `Cmd+H` hides the app. Windows keeps core's `Ctrl+H`.
- The App-menu item is labelled "Settings…" rather than "Preferences…", matching modern macOS and M5. Its accelerator is `CmdOrCtrl+,` as the plan says.
- macOS About is the native panel. Windows About is an info dialog showing the version.
- Formatting labels in the macOS tooltips now follow Apple's modifier order (`⇧⌘S`). I updated the one existing assertion for this.
- A core change was needed because the host API had no heading, find, insert or zoom commands. I added 15 `MikeDownCommand` names to the union and to `runCommand`, each mirroring an existing toolbar action, with a jsdom test in `packages/core/test/menu-commands.test.ts`. VS Code is unaffected.

## Merge with M6 (done in this worktree)

- **Conflicts:**
  - `shortcuts.ts` and `menu.rs`: kept my table. M6's hand-written `menu.rs` line is dropped.
  - `lib.rs`, `commands/mod.rs`, `documentController.ts` (M6's `compareWithDisk` dep plus my `folder` dep; M6's `DocNotice` import kept, the now-unused `windowTitle` import dropped), `main.ts` (versions.css + welcome.css, the versions refs + welcome refs, `compareWithDisk` + `folder`), `e2e/fixtures.ts` (the versions_* and recents_* handlers) and `e2e/README.md`: union of both sides.
- **showVersions:** row `{ command: 'showVersions', label: 'Show Versions…', accelerator: 'CmdOrCtrl+Alt+V', when: 'path' }`, in the View menu after Toggle Source Mode, added to `APP_COMMANDS`, and handled by M6's existing `actions.showVersions` (`toggleVersionsRef`). It moved off `CmdOrCtrl+Shift+H` because that chord is core's Highlight. Fixtures were regenerated, and `showVersions` was added to the kept-id lists in the TS and Rust tests. `versions.spec.ts` now presses `ControlOrMeta+Alt+V`. M6's sidebar tooltip reads the chord from the table, so it updated by itself.
- **Behaviour change found by M6's e2e:** my Save row had `when: 'saveable'`, which greyed Save on a clean document. M6's spec saves a clean document to prove versioning skips identical snapshots. Save is now `when: 'editor'` (always on for editor tabs), and only Save All follows dirty state. The `saveable` clause stays defined and tested.

## Files

New:

- `src/menu/menuSpec.ts`, `src/menu/menuApi.ts`
- `src/app/recents.ts`, `src/app/windowTitle.ts`
- `src/ui/welcome.ts`, `src/ui/shortcutsSheet.ts`, `src/styles/welcome.css`
- `src-tauri/src/commands/recents.rs`, `src-tauri/resources/welcome.md`
- `test/unit/menu.test.ts`, `test/unit/recents.test.ts`, `test/e2e/welcome.spec.ts`, `test/fixtures/menu/menu-{mac,windows}.json`
- `packages/core/test/menu-commands.test.ts`

Modified:

- **Hot spots:**
  - `src/menu/shortcuts.ts` (rewritten; old exports kept)
  - `src-tauri/src/menu.rs` (rewritten)
  - `src/main.ts`: the shortcuts/menu section replaced, the boot fallback (Untitled → welcome/first run), the openFolder and controller hooks
  - `src-tauri/src/lib.rs`: +1 manage, +7 commands, appended
  - `src-tauri/src/commands/mod.rs`: +1 line
- **Other:**
  - `src/app/documentController.ts`: a `folder()` dep and the title call, 4 lines (M6 area, small)
  - `test/e2e/fixtures.ts`: recents handlers
  - `test/unit/shortcuts.test.ts`
  - `README.md`, `test/e2e/README.md`
  - Core `packages/core/src/types.ts`, `packages/core/src/editor.ts`

Not touched: `Cargo.toml`, `capabilities/*.json`, `package.json`, `tauri.conf.json`, `fsApi.ts`, `tauriHost.ts`.

## Test and build status (all in the worktree, after the rebase onto `4669970`)

| Check | Command | Result |
| --- | --- | --- |
| Core build | `npm run build:core` | green |
| Extension build | `npm run compile` | green |
| Root unit | `npm run test:unit` | 1331 passed (102 files) |
| Edge | `npm run test:edge` | 22 passed |
| Desktop types | `npm run typecheck -w packages/desktop` | clean |
| Desktop unit | `npx vitest run --config vitest.config.ts` (in packages/desktop) | 357 passed (31 files) |
| e2e | `npx playwright test --config test/e2e/playwright.config.ts` | 26 passed (4 new for M8) |
| Rust | `cargo test` in `src-tauri` | 88 passed, 1 ignored (11 new for M8) |
| Vite build | `npm run build:vite` | green |

## Issues and notes for the orchestrator

- `shell.open` is still used for Website / Report an Issue, the same as `TauriHost.openLink`. Switching to `tauri-plugin-opener` would mean new Cargo, npm and capability entries, so I left it as a follow-up for both call sites.
- Not verified in a real window:
  - whether WKWebView gives the page first crack at menu key equivalents (the design assumes it does, so the page's `preventDefault` suppresses the menu);
  - WebView2 double-fire (the dedupe covers it);
  - whether WebView2 browser zoom on `Ctrl+=` is suppressed by `preventDefault`.
- Updating the cheat sheet: a user who edited their welcome copy keeps theirs and will not get later versions of the guide.
- After the rebase, run `npm install` (M6 added `diff`).
- Session restore wins over the welcome screen. If the user quits with the guide still open, it comes back. The acceptance path therefore closes the tab first (see below).

## Review Materials

Run from the main repo after merge: `cd /Users/michaeljosephwork/git/mikedown/packages/desktop && npm run dev`.

To see a fresh install again: quit, then `rm "$HOME/Library/Application Support/com.interappdev.mikedown/recents.json" "$HOME/Library/Application Support/com.interappdev.mikedown/sessions/"*`. Also set `fileAssociationsOffered` to false in `settings.json` there, or delete that key.

Acceptance checks (pending, real window):

1. **Fresh install.** Launch. "Welcome to MikeDown.md" opens with the title `Welcome to MikeDown.md — com.interappdev.mikedown`, and the "Open .md files with MikeDown?" dialog appears once. Choose Not Now, close the tab with Cmd+W (the welcome screen shows, titled `MikeDown`), then quit with Cmd+Q and relaunch. The welcome screen shows one recent file and no dialog.
2. **Keyboard chords.** On macOS and Windows, try every menu item with a chord. Watch for double-firing on Windows, especially Bold, Undo and Cmd+Shift+V. Cmd+, opens Settings from the welcome screen and from a document. Check Format items grey out in source mode (Cmd+/) and Save greys out when the document is clean. Check File > Open Recent lists entries and opens them.
3. **Versions chord.** Show Versions is `Cmd/Ctrl+Alt+V` from the keyboard and View > Show Versions… from the menu.
4. **Recent removal.** Hover a recent entry, click ×, then quit and relaunch: it stays removed. For pruning, rename a recent file's folder and launch three times: it shows greyed, then disappears.
5. **macOS title bar.** Check the proxy icon and the dirty dot. The Window menu should list open windows. Help > Keyboard Shortcuts should show the sheet.
