# MikeDown Desktop: release-candidate hands-on checklist

Build under test: **0.2.0** from https://www.iadev.net/mikedown/ (signed). Auto-update is already signed off and is not covered here.

- **macOS:** your day account is non-admin, so installing into `/Applications` needs `macadmin` (or drag the app to `~/Applications`).
- **Windows:** DEVBOX1 over RDP, per-user install (NSIS), no UAC prompt expected. Disconnect RDP afterwards, do not sign out.
- Unmarked checks apply to both OSes. Shortcuts are written with `Mod` (Cmd on macOS, Ctrl on Windows).
- Use a clean account or profile for sections 1 and 2. Every failure becomes a gap-fill; note it in Results.

## Fixtures (make once per OS)

Existing encoding fixtures: `packages/desktop/test/fixtures/encoding/` (`lf.md`, `crlf.md`, `bom-lf.md`, `bom-crlf.md`, `latin1-crlf.md`). Copy them to a scratch folder first, since saves overwrite.

Large files and a notes folder:

```bash
# macOS
mkdir -p ~/mdtest/notes/sub && cd ~/mdtest
yes 'Line of filler text for a large markdown file, with some words in it.' | head -c 3145728 > big-3mb.md
yes 'Line of filler text for a large markdown file, with some words in it.' | head -c 26214400 > big-25mb.md
printf '# One\n\nhello\n' > notes/one.md; printf '# Two\n\nsee [one](one.md)\n' > notes/two.md
```

```powershell
# Windows
mkdir ~\mdtest\notes\sub | Out-Null; cd ~\mdtest
$l = "Line of filler text for a large markdown file, with some words in it.`n"
$s = [IO.File]::CreateText("$PWD\big-3mb.md"); 1..43700 | % { $s.Write($l) }; $s.Close()
$s = [IO.File]::CreateText("$PWD\big-25mb.md"); 1..364000 | % { $s.Write($l) }; $s.Close()
"# One`n`nhello" | Set-Content notes\one.md; "# Two`n`nsee [one](one.md)" | Set-Content notes\two.md
```

Also have handy: a markdown file with a task list, an image file (PNG), a read-only file, and a second `.md` in another folder.

## 1. Install and first run

- [ ] (macOS) Mount the DMG, drag MikeDown to Applications (as `macadmin`). Launch from Finder: no Gatekeeper warning beyond the standard "downloaded from the internet" prompt; app opens.
- [ ] (Windows) Run the installer on a clean profile: installs per user, no UAC, Start menu entry and uninstaller present. Launch it: no SmartScreen "unknown publisher" block (Signed publisher shown).
- [ ] First launch shows the welcome screen (Open Folder, Open File, New File, hint paragraph); recents list is empty.
- [ ] Window title on first run is a clean filename (no `com.interappdev.mikedown` in it) when `welcome.md` is open. Help > Welcome opens the guide.
- [ ] Default-app offer: Settings > App tab. (Windows) button opens Default apps; set `.md` and confirm. (macOS) button shows Finder "Get Info > Open with > Change All" steps; follow them.
- [ ] About shows 0.2.0 and the correct app icon in the Dock/taskbar and window.
- [ ] Quit and relaunch: window size and position restored.

## 2. Open files and lone-file window

- [ ] Double-click a `.md` in Finder/Explorer while the app is closed: opens in a lone-file window, sidebar collapsed, title is the filename.
- [ ] With the app running, double-click a second `.md` from another folder: new lone-file window (or focus if already open). Double-click a file inside an open window's folder: that window focuses and opens a tab.
- [ ] Type, bold, add a table, paste an image (screenshot), toggle source (`Mod+/`), save, close, reopen: content intact, not dirty. Pasting an image into Untitled prompts "Save the document first"; Cancel drops the paste.
- [ ] Lone file > File > Open Containing Folder: window reopens on the parent folder with the file still active and the tree visible.
- [ ] (macOS) Edited dot in the close button when dirty; title-bar proxy icon draggable.
- [ ] Open `latin1-crlf.md`: opens read-only in source mode with a plain-language notice; no transcoding, file untouched on disk.
- [ ] Open a read-only file: lock badge on the tab; `Mod+S` offers Save As with the OS reason in plain words.

## 3. File tree, CRUD, Trash

Open `~/mdtest/notes` via File > Open Folder.

- [ ] Tree lists files and folders; expanding a folder lists it lazily; hidden files toggle (View) works.
- [ ] New file and New folder (toolbar and right-click): appear immediately, inline rename works, Enter commits, Esc cancels.
- [ ] Rename a file: open tab follows the new name. Case-only rename (`one.md` to `One.md`) works.
- [ ] Reserved-name rename: (Windows) rename to `CON.md`, `aux.md`, or a 270-character name: plain-language error, disk untouched. (macOS) rename to a name containing `/` or `:`: refused or handled with a clear message, disk untouched.
- [ ] Drag a file into a subfolder: it moves. Drag from the OS file manager into the tree: it copies. Hold Option/Alt while dragging: behavior inverts.
- [ ] Delete a file: confirmation with "Don't ask again"; file lands in Trash/Recycle Bin (check there). Tick "Don't ask again", delete another: no prompt.
- [ ] Create, rename or delete a file in Finder/Explorer while the app is open: tree updates within a couple of seconds.
- [ ] Read-only folder: New/Rename/Delete disabled with a tooltip.
- [ ] Link in `two.md` to `one.md`: link autocomplete lists folder files; clicking the link opens it in a tab; a broken link offers "Create file".
- [ ] (macOS) Finder tags set on a file survive a save from the app.

## 4. Drag and drop into the window (open Windows question)

Tauri `dragDropEnabled: true` may disable in-page HTML5 drag on WebView2. Test both halves on each OS.

- [ ] Drop a `.png` from the file manager onto the editor: image inserts via the image pipeline (copied next to the doc, relative link).
- [ ] Drop a `.md` from the file manager onto the editor: relative link inserted at the cursor. Drop a `.txt`: opens in a new tab. Drop an unsupported file: ignored with a toast.
- [ ] Drag a task-list item (grab handle) to reorder it: item moves. **Record Windows result explicitly.**
- [ ] Select a paragraph of text and drag it to a new position in the editor: text moves. **Record Windows result explicitly.**
- [ ] Table row/column drag (mouse-based): still works.
- [ ] If Windows in-page drag fails while file drops work, decide: keep `dragDropEnabled`, or disable it and drop file drops. Note the decision in Results.

## 5. Tabs, panes, hot exit

- [ ] Open three files: tabs show, middle-click or close button closes, drag a tab to reorder, `Ctrl+Tab` / `Ctrl+Shift+Tab` cycle.
- [ ] Split right and split down: two panes on the same file; typing in one updates the other with no cursor jump; dirty dot is on the one tab.
- [ ] Tab strip looks right in light and dark mode (spacing, dirty dot, lock badge).
- [ ] Quit with two dirty files: one dialog listing both with Save All / Don't Save / Cancel. Cancel keeps the app open and files dirty.
- [ ] Hot exit: type in two files without saving, then force quit (macOS Force Quit or `kill -9`; Windows Task Manager End task). Relaunch: both files restored with unsaved text and dirty indicators, no dialog; disk files unchanged until you save.
- [ ] Session restore: relaunch after a clean quit: folder, open tabs and active tab come back.
- [ ] Open a second folder in the same window with a dirty tab: prompts about the dirty tab, then replaces. New Window opens an empty window.
- [ ] (macOS) Right-click the Dock icon: **New Window** is listed and opens an empty window, also when no window is focused.
- [ ] (Windows) Right-click the taskbar icon (running and pinned): **New Window** task is listed and opens an empty window in the running app, not a second process. With the app closed it launches normally.

## 6. Settings (global vs. folder)

- [ ] Open Settings from the toolbar gear and from the menu (macOS: app menu Settings, Windows: File/Edit menu location): modal opens, App tab present.
- [ ] Change body font size, Save globally: applies now, persists after relaunch and in a second window.
- [ ] With a folder open, "Save for this folder": `<folder>/.mikedown/settings.json` is created; the folder value wins; opening a different folder shows the global value.
- [ ] Hand-corrupt `settings.json` (global and folder): banner with Open file and Reset to defaults; file is not overwritten automatically; Reset works.
- [ ] Image paste folder override: an invalid value (absolute path or `..`) is rejected with a message.
- [ ] Spell check is on by default: one red squiggle (not two); toggle from the Edit/Help menu works.

## 7. Versioning, restore, diff

- [ ] Edit and save a file in a folder three times: `.mikedown/versions/<path>/` gains one snapshot per distinct save; saving unchanged text adds none.
- [ ] `Mod+Shift+H` opens the version browser listing snapshots newest first.
- [ ] Compare a snapshot: diff view shows added and removed text clearly in light and dark.
- [ ] Restore a snapshot: editor buffer changes and the tab is dirty; nothing on disk until you save.
- [ ] Rename the file in the tree: versions follow. Delete it: versions are removed.
- [ ] Lone file (not in a folder): no versioning, no `.mikedown/` created beside it. A file over 2 MB is skipped silently.

## 8. External change conflict

- [ ] Edit a clean (not dirty) open file in another editor and save: tab refreshes silently.
- [ ] Make the open file dirty in MikeDown, then change it externally: conflict prompt with Compare / Overwrite / Revert. Test each: Compare shows a diff, Overwrite keeps yours, Revert takes disk.
- [ ] Delete the open file externally: tab marks it missing and does not lose your text; Save As recreates it.

## 9. Folder search

- [ ] `Mod+Shift+F`: search panel opens, focus in the box; results appear after a short debounce, grouped by file with highlighted snippets.
- [ ] Case and whole-word toggles change results; no regex. Click a result: file opens and scrolls to the match.
- [ ] Cancel a long search by typing a new query: no stale results. Files over 2 MB, binary and hidden folders (`node_modules`, `.mikedown`) are skipped.
- [ ] Search result row labels are readable in dark mode.

## 10. Menus, shortcuts, welcome, recents

- [ ] Native menu bar has App/File/Edit/Format/View/Window/Help (Windows: no App menu, Settings and Exit in File). Items enable and disable with context (for example Save greyed when clean).
- [ ] Spot-check shortcuts: `Mod+S`, `Mod+Shift+S`, `Mod+O`, `Mod+W`, `Mod+B`, `Mod+/`, `Mod+Shift+F`, `Mod+Shift+H`, `Mod+P`, `Mod+B` sidebar toggle behavior as documented in Keyboard Shortcuts (Help).
- [ ] Recents: open a few items, File > Open Recent lists them; delete one on disk, relaunch: greyed with a remove affordance; Clear Recents works.
- [ ] (Windows) Alt+F4 with a dirty file triggers the quit dialog. (macOS) Cmd+Q does the same; closing the last window leaves the app running per macOS convention.
- [ ] Right-click in the editor shows core's context menu, not the WebKit/WebView2 default.

## 11. Export and print

- [ ] File > Export > HTML: saves a standalone file; open it in a browser with Wi-Fi off: styling, KaTeX math, images and a mermaid diagram render; links and heading anchors work; no stray `--vscode-` styling.
- [ ] File > Export > PDF and File > Print (`Mod+P`): the real print dialog appears (macOS sheet may not show from the hidden window; the 8 s fallback preview is acceptable but note it). Save as PDF: code blocks wrap, tables, callouts and images do not split badly, no app chrome.
- [ ] Print dialog cancelled: no leftover hidden window; app still quits cleanly.

## 12. Appearance, accessibility, keyboard-only

- [ ] Flip OS dark/light mode while open (macOS System Settings > Appearance; Windows Settings > Personalization > Colors): window and chrome recolor without reload, both editor and sidebar.
- [ ] Reduced motion (macOS Accessibility > Display; Windows Settings > Accessibility > Visual effects, Animation effects off): transitions are off or minimal.
- [ ] Increase Contrast (macOS) or Contrast themes (Windows): chrome stays legible, focus rings visible.
- [ ] Keyboard-only session, no mouse: open a folder, move through the tree with arrows, open a file, split, search, switch tabs, open Settings, quit.
- [ ] Focus rings are visible on tree, tabs, toolbar and modal controls in light and dark.
- [ ] (macOS) VoiceOver announces tree items, tabs and the editor textbox. (Windows) Narrator does the same.

## 13. Editor in the real webview (from the WebKit/WebView2 notes)

- [ ] Type `/date` then Enter: today's date inserted.
- [ ] Misspelled word: single red squiggle only.
- [ ] IME: Japanese or Chinese input (`nihongo`, pick a candidate): text lands once, no jumps. (macOS) dead key Option+e then e. (Windows) Microsoft Pinyin or Japanese IME.
- [ ] Paste from another app: plain text pastes as paragraphs, browser rich text converts to markdown, an image saves to the image folder and inserts a relative link.
- [ ] `Mod+C` in the editor, paste into another app: rich text arrives.
- [ ] `Mod+wheel` and trackpad pinch (macOS) or touchpad pinch (Windows) zoom in steps; `Mod+0` resets.

## 14. Encoding and large files

- [ ] Open `crlf.md`, type a character, save: line endings stay CRLF (check with `xxd`/`file` or an editor's status bar).
- [ ] Open `bom-lf.md` and `bom-crlf.md`, edit, save: BOM and line endings preserved byte for byte apart from your edit.
- [ ] `lf.md` stays LF after save. Non-ASCII text (`café`, `日本語`) intact in all fixtures.
- [ ] Open `big-3mb.md`: opens in source mode with the "Open as rich text anyway" info bar; typing is responsive; the button switches to rich text (note any lag).
- [ ] Open `big-25mb.md`: refused with a message and an open-in-default-app option; app stays responsive.
- [ ] Network share or cloud folder: (macOS) an evicted iCloud Drive file shows downloading with Retry; (Windows) a OneDrive Files On-Demand placeholder hydrates on open. Skip if unavailable and note it.

## Results

Record pass/fail per section, then list gap-fills.

### macOS

| Section | Pass/fail | Notes |
| --- | --- | --- |
| 1 Install and first run | | |
| 2 Open files and lone-file window | | |
| 3 File tree, CRUD, Trash | | |
| 4 Drag and drop | | |
| 5 Tabs, panes, hot exit | | |
| 6 Settings | | |
| 7 Versioning, restore, diff | | |
| 8 External change conflict | | |
| 9 Folder search | | |
| 10 Menus, shortcuts, welcome, recents | | |
| 11 Export and print | | |
| 12 Appearance, accessibility, keyboard | | |
| 13 Editor in the real webview | | |
| 14 Encoding and large files | | |

### Windows

| Section | Pass/fail | Notes |
| --- | --- | --- |
| 1 Install and first run | | |
| 2 Open files and lone-file window | | |
| 3 File tree, CRUD, Trash | | |
| 4 Drag and drop | | |
| 5 Tabs, panes, hot exit | | |
| 6 Settings | | |
| 7 Versioning, restore, diff | | |
| 8 External change conflict | | |
| 9 Folder search | | |
| 10 Menus, shortcuts, welcome, recents | | |
| 11 Export and print | | |
| 12 Appearance, accessibility, keyboard | | |
| 13 Editor in the real webview | | |
| 14 Encoding and large files | | |
