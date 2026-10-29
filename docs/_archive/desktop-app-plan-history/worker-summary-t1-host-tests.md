# Worker summary: T1 (host and single-file tests)

**Status:** Completed (automated + Mac pass). The Windows GUI pass is staged on DevBox1 for the user. The final hands-on checkbox is the user's to sign off.

- Worktree: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-aaaac1549273ae0f0`, branch `worktree-agent-aaaac1549273ae0f0`, based on `f01113f`.
- Commits: `f8669ba`, `8bfd0e3`, `76cd76a`, `bf63ccc`, `95739e1` (HEAD).
- Start 17:15, end 17:42 (2026-10-23).

## Work completed (per checkbox)

- [x] **tauriHost.test.ts**: `packages/desktop/test/unit/tauriHost.test.ts` (under `test/unit/`, not `test/`, so the existing vitest include picks it up). Every host method runs through the real `fsApi` / `windowApi` / dialog plugin wiring (`test/unit/helpers/app.ts` mirrors `main.ts`). It runs over a recording IPC mock built on `@tauri-apps/api/mocks` (`test/unit/helpers/ipc.ts`, which also captures `write_bytes` headers). The invoke traffic is pinned in `__snapshots__/tauriHost.test.ts.snap`. It covers: open, `onChange` dirty then `pristine: true` clean, openLink (shell / local / anchor), saveSettings (no IPC), save, uploadImage (saved; unsaved with the dialog cancelled; unsaved with Save As cancelled; unsaved then saved), pickImage (inside, outside, cancelled), resizeImage (overwrite and sibling), and resolveImageSrc (relative, absolute, query kept, http(s)/data:/blob: passthrough, Windows asset host). 19 tests.
- [x] **encoding.test.ts**: `packages/desktop/test/unit/encoding.test.ts` plus shared byte fixtures in `packages/desktop/test/fixtures/encoding/` (lf, crlf, bom-lf, bom-crlf, latin1-crlf, `expected.json`, `.gitattributes` `-text`). Each fixture opens into a **real core editor** in jsdom through the document controller. An unchanged save hands `write_text` exactly the original bytes (all four UTF-8 fixtures). An edit keeps the EOL and BOM and never sends `\r`. Latin-1 opens read-only in source mode with the notice, Cancel writes nothing, and Save As writes a UTF-8 copy and never the original. Rust: 6 new tests in `fs.rs` (lone CR, BOM-only and empty, BOM + invalid UTF-8, UTF-16 BOMs, CRLF in code, plus a test that the shared fixtures decode to `expected.json` and round-trip). `cargo test`: 19 pass.
- [x] **E2E harness**: Playwright against `vite dev` with a mocked `window.__TAURI_INTERNALS__`. `tauri-driver` was ruled out because the latest crate (3.0.0-alpha.1) only builds the server for Linux and Windows, and its README lists macOS as "Todo". The reasoning is in `packages/desktop/test/e2e/README.md`. The page's `invoke` goes through a Playwright binding to a real temp folder. Specs: `save-reload.spec.ts` (launch on a CRLF+BOM file, type, Cmd/Ctrl+S, check the bytes on disk, reload, content back and clean) and `appearance.spec.ts` (see bug 2). `npm run test:e2e -w packages/desktop` runs them. `scripts/e2e.mjs` placeholder removed. Chromium only (already cached here; `npx playwright install chromium` elsewhere).
- [x] **Root scripts**: `test:desktop` = desktop unit + e2e. Root `npm run test:unit` is green (76 files, 1028 tests) after `build:core`.
- [ ] **Hands-on**: Mac done with evidence below. Windows staged. User sign-off pending.

## Bugs found and fixed (M2 code)

1. **`resolveImageSrc` resolved `https://…` / `data:` as paths beside the document.** Core's `imageSrcPolicy` already filters these, so it was not visible in the app, but the host contract and the plan required passthrough. Fixed in `src/host/tauriHost.ts` with tests.
2. **Dark mode left the app chrome light** (tab strip, page background behind the transparent status footer, and with it the window title area). Cause: core's tokens apply only under `[data-mikedown-theme]`, and the chrome sat outside the editor root. Fix: `data-mikedown-theme="auto"` on `<html>` in `index.html`. Covered by `appearance.spec.ts`, which fails without the fix. Before the fix: `10-dark-mode.png`. After: `18-dark-mode-after-fix.png`.

## Findings not fixed (out of T1 scope; orchestrator to route)

1. **Save drops extended attributes on macOS.** `atomic_write` (temp file + rename) keeps the mode but not xattrs, so Finder tags, the per-file "Open With" choice and similar are lost on every save. Seen live: after saving `t1.md`, `open t1.md` went to VS Code because the OpenWith xattr was gone. Suggest copying xattrs in `atomic_write` (M3/M4 or an M2 follow-up).
2. **Cmd+Q quits with an unsaved Untitled document and no prompt** (data loss). The guard only covers the window close button (`onCloseRequested`), and the default app-quit path bypasses it. Belongs with M4 (hot exit / Save All) or M8 (native menu).
3. **A saved document loses its trailing newline.** `t1.md` was written ending in `…png)` with no final `\n`, though the original had one. An unchanged save is byte-identical (encoding tests); this appears after edits. It is core serializer behavior, probably the same in VS Code. Worth a look in core.
4. Minor: after a Cmd+/ round-trip the caret came back in table row 2 instead of the A1 cell where it was in source mode.
5. Harness note: AppleScript `tell Finder to open …` (with or without `using`) silently did nothing from this shell. The double-click path was exercised with LaunchServices `open <file>`, with MikeDown set as the per-file handler through Finder's Get Info "Open With" xattr (`com.apple.LaunchServices.OpenWith`, on the fixture files only; the user's global `.md` default was not touched).

## Files modified

- `packages/desktop/src/host/tauriHost.ts`, `packages/desktop/index.html`
- `packages/desktop/test/unit/{tauriHost,encoding}.test.ts`, `test/unit/helpers/{ipc,app}.ts`, `test/unit/__snapshots__/tauriHost.test.ts.snap`
- `packages/desktop/test/fixtures/encoding/*`
- `packages/desktop/test/e2e/{README.md,playwright.config.ts,fixtures.ts,tauri-mock.js,save-reload.spec.ts,appearance.spec.ts}`
- `packages/desktop/src-tauri/src/commands/fs.rs` (tests only)
- `packages/desktop/package.json` (`test:e2e`, `@playwright/test@^1.64.0` dev dep), root `package.json` (`test:desktop`), `package-lock.json`, `.gitignore` (`test-results/`, `playwright-report/`), `packages/desktop/README.md` (test commands, layout)
- Deleted `packages/desktop/scripts/e2e.mjs`

## Test / build status

- `npm run test:unit -w packages/desktop`: 9 files, 82 tests pass.
- `npm run test:e2e -w packages/desktop`: 2 pass (Chromium).
- `cargo test --lib` in `src-tauri/`: 19 fs tests pass.
- Root `npm run build:core && npm run test:unit`: 76 files / 1028 tests pass.
- `npm run typecheck -w packages/desktop`: clean.
- Mac release `.app`: `npx tauri build --bundles app` (native arm64) OK. Windows MSI + NSIS built on BEAST from HEAD `95739e1`.

## Review Materials

### Mac screenshots

All in `/Users/michaeljosephwork/git/mikedown/.orchestrator/desktop-app-plan/artifacts/t1-mac/`. Release `.app` copied to `~/tmp-mikedown-t1/MikeDown.app`, fixtures in `~/tmp-mikedown-t1/`. Every keystroke batch went through a frontmost-process guard (it aborted once when iTerm took focus, and the batch was retried after re-activating MikeDown).

| File | How the state was reached |
| --- | --- |
| `01-opened-via-launchservices.png` | `open ~/tmp-mikedown-t1/t1.md` with per-file Open With = MikeDown. Cold launch on the file, clean |
| `02-typed-bold-table-menu.png` | Cmd+Down, Return, typed text, Cmd+B "bold words" Cmd+B, Return, `/table`. Dirty dot in tab and close button |
| `03-table-picker.png` | Return on the Table item: size picker |
| `04a-picker-3x3.png` | Arrow keys do not move the picker grid (needed a click) |
| `04-table-inserted.png` | Window moved to the main display, clicked OK (3×3): table inserted |
| `05-cells-and-image-paste.png` | Typed A1, Tab, B1, Cmd+Down, Cmd+V with a PNG on the clipboard: `images/t1-20261023-172754.png` written and rendered |
| `06-source-mode.png` | Cmd+/: CodeMirror shows the markdown (bold, table, image link) |
| `07-back-to-rich.png` | Cmd+/ again: rich text, content unchanged |
| `08-saved-clean.png` | Cmd+S: dot cleared. Bytes on disk checked (`cat`, sha1 `57b07a03…`) |
| `09-reopened-not-dirty.png` | Cmd+Q, then `open t1.md` again: content intact, not dirty, sha1 unchanged |
| `10-dark-mode.png` | OS dark mode before the fix: editor dark, chrome light (bug 2) |
| `11-light-again.png` | OS appearance flipped back |
| `12-latin1-readonly-source.png` | `open latin1.md`: source mode, lock badge, notice bar |
| `13-latin1-save-in-place-sheet.png` | Cmd+S: "cannot be saved in place… Save a copy instead?" sheet |
| `14-latin1-save-panel.png` | Save As… clicked: native save panel |
| `15-latin1-copy-saved.png` | Saved as `latin1-utf8-copy.md` (UTF-8, CRLF kept, U+FFFD for é). Original sha1 `47fa7744…` unchanged. Lock and notice gone |
| `16-untitled-paste-save-first.png` | Launched with no file (Untitled), typed, Cmd+V an image: "Save the document first" sheet |
| `17-untitled-paste-cancelled.png` | Cancel: paste dropped, no new file in `images/` |
| `18-dark-mode-after-fix.png` | Rebuilt with the fix, OS dark: whole window dark |

The OS appearance was light at the start and was restored to light. The clipboard text was restored. Side effect: one `open t1.md` (after the save had stripped the xattr) opened `t1.md` in the user's VS Code. It is a harmless tab in `~/tmp-mikedown-t1/`.

### Run the Mac app

```bash
open ~/tmp-mikedown-t1/MikeDown.app            # release build of 95739e1
# or the dev loop: npm run dev:desktop  (from the worktree)
```

### Windows: staged on DevBox1 (user logged in via RDP, session Active; app not installed, so no launch attempted)

Files on DevBox1:

- `C:\temp\MikeDown_0.1.0_x64_en-US.msi` (6,094,848 bytes)
- `C:\temp\MikeDown_0.1.0_x64-setup.exe` (NSIS, 5,212,991 bytes)
- `C:\temp\mikedown-t1\table.md` (CRLF, with a table), `C:\temp\mikedown-t1\crlf-bom.md` (CRLF + BOM, SHA1 `C3682FA534150CE856A1305EF5289177BB3EBC81`), `C:\temp\mikedown-t1\pic.png`

Built on BEAST from a `git archive` of `95739e1` extracted over `C:\git\mikedown`. Unsigned (signing is M10). Expect a SmartScreen "More info → Run anyway".

Checklist (about 15 minutes):

1. Install the MSI (double-click it in `C:\temp`). Optionally try the NSIS exe afterwards, or on a later pass.
2. In Explorer, right-click `C:\temp\mikedown-t1\table.md` → Open with → MikeDown (pick "Always" if you want the double-click test), then double-click it: the app opens on the file.
3. Type a sentence, Ctrl+B a word, `/table` → Enter → OK for a 3×3 table, type in a cell.
4. Copy `pic.png` (open it in Paint, Ctrl+A, Ctrl+C), then Ctrl+V in MikeDown: `C:\temp\mikedown-t1\images\table-<timestamp>.png` appears and renders.
5. Ctrl+/ to source mode and back: content unchanged.
6. Ctrl+S, close the window, reopen `table.md`: content intact, no dirty bullet in the title.
7. Open `crlf-bom.md`, Ctrl+S without editing. In PowerShell, `Get-FileHash C:\temp\mikedown-t1\crlf-bom.md -Algorithm SHA1` must still be `C3682FA5…81`. Then edit, save, and confirm it still opens in Notepad with CRLF + BOM ("UTF-8 with BOM", "Windows (CRLF)" in the status bar).
8. Dark mode: Settings > Personalization > Colors > Choose your mode → Dark. The whole window (tab strip, footer, editor) recolors without a reload. Flip back.
9. Pending M0 WebView2 GUI items from `packages/desktop/docs/webview-notes.md`:
   - IME: Microsoft Pinyin or Japanese IME, compose and commit. Text lands once, with no duplicate or dropped characters.
   - Real paste from other apps: plain text, rich text from Edge, an image.
   - Ctrl+C in MikeDown, then paste into Word or WordPad.
   - Ctrl+wheel and touchpad pinch zoom.
   - Classic scrollbar look, Alt+F4, right-click shows core's context menu.
10. Also try Ctrl+Q / Alt+F4 with unsaved changes (finding 2 on the Mac).

Screenshots, if you take them, can go to `.orchestrator/desktop-app-plan/artifacts/t1-win/`.
