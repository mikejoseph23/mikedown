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
- `appearance.spec.ts`: with a dark OS appearance the chrome (tab strip,
  status footer) recolors along with the editor.

Browsers: Playwright's Chromium (`npx playwright install chromium` once per
machine if it is missing).
