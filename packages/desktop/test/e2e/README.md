# Desktop end-to-end tests

```bash
npm run test:e2e -w packages/desktop     # or: npm run test:desktop at the repo root (unit + e2e)
```

## Harness choice: Playwright + mocked Tauri internals, not tauri-driver

`tauri-driver` (the WebDriver bridge for real Tauri windows) does not run on
macOS. Checked 2026-10-23 against the latest crate, `tauri-driver
3.0.0-alpha.1`: `main.rs` only builds the server for
`cfg(any(target_os = "linux", windows))`, and its README lists macOS as
"[Todo] via Appium Mac2 Driver". WKWebView has no WebDriver of its own, so
there is nothing for it to drive on the Mac.

So the suite runs Playwright (Chromium) against `vite dev` on port 1430, with
`tauri-mock.js` injected before the app boots. It stands in for
`window.__TAURI_INTERNALS__` (`invoke`, `transformCallback`,
`convertFileSrc`, window metadata, event-plugin listen/emit). Every `invoke`
goes to a Playwright binding (`fixtures.ts`) that answers the app's fs
commands against a real temp folder, mirroring `src-tauri/src/commands/fs.rs`
(BOM and CRLF detection, `\n` text, EOL and BOM re-applied on write), and
records the call. `frontend_ready` returns `ipc.launchFiles`, the same path a
double-click or command-line file takes.

What this covers: the whole TypeScript app (boot, launch queue, document
controller, TauriHost, core editor, shortcuts) in a real browser with real
keystrokes. What it does not: the Rust commands themselves (`cargo test` in
`src-tauri/` covers `fs.rs`), WKWebView/WebView2 quirks, native dialogs and
menus. Those are the hands-on passes in the plan (T1, T4).

If `tauri-driver` gains macOS support, or for a Windows-only lane on BEAST,
a WebDriver spec can sit next to this one; the spec itself only needs
`page`-level actions.

## Specs

- `save-reload.spec.ts`: launch on a CRLF + BOM fixture, type, Cmd/Ctrl+S,
  check the bytes on disk (BOM kept, every line CRLF), reload, the edit is
  back and the document is clean.
- `tree.spec.ts` (M3): a folder arrives through the launch queue, the tree
  lists only the root (hidden `.git` filtered), expanding loads a folder
  (folders first, natural order), clicking opens a file, a `[[wikilink]]`
  resolves through the folder index, New File creates `Untitled.md` in
  rename mode and appends `.md`, `Cmd/Ctrl+B` outside the editor collapses
  the sidebar. `M3_SHOTS=<dir>` saves light/dark screenshots.
- `appearance.spec.ts`: with a dark OS appearance the chrome (tab strip,
  status footer) recolors along with the editor.

- `settings.spec.ts` (M5): the App tab in core's modal, "Save for this folder"
  (only the changed key lands in `.mikedown/settings.json`, disabled in a
  lone-file window), global persistence across a reload (font, versions to
  keep), the corrupt-file banner (file untouched until Reset), no theme
  toggle. `fixtures.ts` mirrors `settings_read` / `settings_write` against
  `ipc.appData` and the folder's `.mikedown/`.

- `versions.spec.ts` (M6): three saves with changes and one without leave
  exactly three snapshots in chronological order; the version browser lists
  them, Compare opens the diff viewer, Restore dirties the buffer without a
  write; an external edit while dirty makes the save ask (Compare shows disk
  vs buffer, Revert reloads, Overwrite writes and snapshots); a clean tab
  reloads silently; a 3 MB file saves with no snapshot and no message.
  `fixtures.ts` mirrors the `versions_*` commands. `M6_SHOTS=<dir>` saves
  screenshots.
- `welcome.spec.ts` (M8): first run opens the welcome guide and offers the
  default app once (the spec answers `welcome_file`), the next launch shows
  the welcome screen with one recent file; a missing recent is greyed and
  pruned on the third launch; a removed entry stays removed; `Cmd/Ctrl+,`
  opens Settings from the welcome screen and a document; the menu spec,
  recents and enablement reach `menu_*`, and `mikedown:menu` events run
  commands. `fixtures.ts` mirrors `recents_read` / `recents_write` against
  `ipc.appData`.

Browsers: Playwright's Chromium (`npx playwright install chromium` once per
machine if it is missing).
