# Worker summary: M2 — Tauri host adapter and lone-file window

**Status:** Completed (two GUI checks pending a human; everything else observed or unit-tested).

**Worktree:** `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a1af1a6181ae2393b`, branch `worktree-agent-a1af1a6181ae2393b`, reset to `db8018a` before starting.

**Commits (on top of db8018a):**

- `67ffeb0` Add desktop file, window and launch commands
- `eb3b8d8` Add TauriHost and the lone-file window
- `5191076` Test the desktop host logic and document the M2 layout

Start 2026-10-23 14:48, end 2026-10-23 15:22.

## Work completed (per checkbox)

- [x] **`src-tauri/src/commands/fs.rs`**: `read_text` → `{ text, encoding: 'utf8'|'utf8-bom'|'unknown', eol: 'lf'|'crlf', mtimeMs, readOnly, size }` (text normalised to `\n`, BOM stripped, non-UTF-8 decoded lossily → `unknown`, edge 11); `write_text(path, text, { eol, bom })` re-applies CRLF/BOM through a temp-file-and-rename write that fsyncs and copies the original mode; `stat`, `exists`; plus `list_dir`, `mkdir`, `read_bytes`, `write_bytes` (raw IPC body, path in an `x-path` header, so a 10 MB paste never goes through JSON), `open_in_default_app`, `allow_asset`. Every command checks the fs scope (`ensure_allowed`), and `read_text`/`write_text` allow the document's folder for the asset protocol. 15 Rust unit tests (encoding/eol detection, byte-identical round trip, stray CR, atomic write incl. mode preservation, read-only probe, percent decode).
- [x] **`src/host/tauriHost.ts`**: `class TauriHost implements MikeDownHost` over the minimal `DocumentModel` (`path, text, dirty, eol, bom, encoding, readOnly, readOnlyReason, mtimeMs, kind`). `onChange` (text + dirty from `pristine`), `onStats` (status footer: words, reading time, selection), `openLink` via pure `linkRouting.ts` (http(s)/mailto/tel → `shell.open`; `#anchor` → `handle.scrollToAnchor`; relative/absolute/file: → `controller.openPath` which picks rich text / source / viewer / OS app), `saveSettings` (in-memory `desktopSettings.ts`, toast says persistence comes later), `uploadImage`/`pickImage`/`resizeImage` through `imagePipeline.ts` (core's `createImagePasteHelpers` with the synchronous `pathOps.ts`; mirrored `imagePaste.*` + `imageResize.overwrite` defaults), `resolveImageSrc` (relative → `convertFileSrc`, keeps the `?v=` cache-bust). `exportHtml`, `printDocument`, `getTags`, `getLinkSuggestions`, `resolveWikilinks`, `getDiffBaseline` are absent.
- [x] **Edge 14**: `uploadImage`/`pickImage` on Untitled call `controller.ensureSaved()` → native ask "Save the document first so the image has a home." with Save As…; cancel rejects `document not saved` (core drops the paste silently). Unit-tested both branches.
- [x] **Save**: `CmdOrCtrl+S` → `write_text` with the model's eol/bom → `handle.markSaved(text)`, dirty cleared. Save As via `dialog.save` (`.md` appended when no extension, edge 29). Edge 10: read-only files show a lock badge on the tab (italic name, tooltip = reason) and `CmdOrCtrl+S` asks "cannot be saved in place. <reason> Save a copy instead?" → Save As. Non-UTF-8 files use the same path with a UTF-8-copy reason.
- [x] **Window title** `filename — foldername` (Untitled → `Untitled`; `• ` prefix on non-mac when dirty); `getCurrentWindow().setTitle`, Rust `set_document_edited` / `set_represented_file` (NSWindow via `objc2-app-kit`; no-op elsewhere). Tauri 2.12 has no `Window::set_document_edited`, so these are app commands.
- [x] **Lone-file layout** (edge 4): full window, no sidebar (`features.sidebar: false`), one-tab strip with dirty dot and lock badge, **Open Containing Folder** button + `CmdOrCtrl+Shift+O` stub (toast naming the folder; M3 implements).
- [x] **File associations** (edge 29): `bundle.fileAssociations` for `md`/`markdown` (Default rank) and `txt` (Alternate rank; easy to drop). Launch args (`paths_from_args`, flags skipped, relative resolved against cwd), single-instance callback and macOS `RunEvent::Opened` all feed `launch.rs`'s queue; `frontend_ready` drains it, later files arrive as `mikedown:open-files`. Verified with the release bundle: `open -a MikeDown.app sample.md` opened the file at launch, `open -a … other.md` while running switched the same window (one process).
- [x] **Non-markdown handling**: `classifyPath` → text (`.txt/.json/.yaml/…`, no extension) opens with `features.sourceMode: true` and `toggleSource` forced (Cmd+/ refuses with a toast so a .txt never goes through the rich-text serializer), images open in `ui/imageViewer.ts` (Back button returns to the document), other extensions → `open_in_default_app`.
- [x] **Spell check ON** (edge 22): `settings.spellCheckEnabled: true`, `spellcheckDictionaryUrl` = bundled dictionaries, `spellcheck="false"` on `<body>` (unchanged from M0).
- [x] **Capabilities**: `fs:default` + `fs:scope` `$HOME/**`, `$APPDATA/**` (dialog picks and launch files added at runtime), `dialog:allow-open/save/message/ask/confirm`, `shell:allow-open`, `core:window:allow-set-title/set-focus/unminimize/close/destroy`, `core:event:allow-listen`. `app.security.assetProtocol` enabled with the same scope; `tauri` crate gains the `protocol-asset` feature.
- [x] Committed (three commits, no attribution).

Extras that fell out of the acceptance criteria: `CmdOrCtrl+O` open dialog (needed to reach the flows without the M8 welcome screen), a dirty-close guard on the window close button (two-button "Discard Changes / Cancel"; the Save All dialog and hot exit are M4), and `src/menu/shortcuts.ts` as the single accelerator table (README's M0 note said M2 moves Cmd+/ and Cmd+, there).

## Files modified

Rust: `packages/desktop/src-tauri/src/commands/{mod,fs,window,launch}.rs`, `src-tauri/src/lib.rs`, `Cargo.toml` (+`protocol-asset`, objc2 crates on macOS), `Cargo.lock`, `tauri.conf.json`, `capabilities/default.json`.

TypeScript: `packages/desktop/src/main.ts`, `src/app/documentController.ts`, `src/documents/{documentModel,fsApi}.ts`, `src/host/{tauriHost,imagePipeline,pathOps,linkRouting}.ts`, `src/menu/shortcuts.ts`, `src/settings/desktopSettings.ts`, `src/ui/{chrome,dialogs,imageViewer}.ts`, `src/styles/app.css`, `vite.config.ts` (dev alias resolves extensionless `@mikedown/core/shared/*` imports; M0's alias never hit this path).

Tests: `packages/desktop/test/unit/{pathOps,documentModel,linkRouting,shortcuts,imagePipeline,desktopSettings}.test.ts` (51 new tests).

Docs: `packages/desktop/README.md` (dev loop, layout, "Disk, scope and native window state").

Core (packaging only): `packages/core/tsup.config.ts` adds `shared/sha1` and `shared/wordCount` dist entries so the desktop release bundle (which resolves core through its exports map) can import them. No core behavior changed.

## Test / build status

- `npm run test:unit -w packages/desktop` → 7 files, 54 tests pass.
- `cd packages/desktop/src-tauri && cargo test` → 15 pass (0 warnings after `#[allow(deprecated)]` on `shell().open`).
- `npm run typecheck -w packages/desktop` → clean.
- `npm run build:core && npm run test:core-package` → 9 pass.
- Root `npm run compile`, `npm run test:unit` (1000 pass), `npm run test:edge` (22 pass) → green.
- `npx tauri build` → `MikeDown.app` 9.71 MiB, `MikeDown_0.1.0_x64.dmg` 6.42 MiB (x86_64, Intel Homebrew Rust, as in M0).
- `grep -rn "@tiptap\|prosemirror\|@codemirror" packages/desktop/src` → nothing.

### Observed in the running app (dev build via `npx tauri dev -- ~/tmp-mikedown-m2/crlf-bom.md`, screenshots in `/Users/michaeljosephwork/tmp-mikedown-m2/shots/`)

- `01-opened.png`: file opened from the launch argument; title `crlf-bom.md — tmp-mikedown-m2` with the proxy icon; tab + status footer.
- `02-dirty.png`: after typing, dot in the tab and in the macOS close button.
- `03-saved.png` + `xxd`: after Cmd+S both dots cleared; bytes keep the BOM (`EF BB BF`) and every CRLF, with the new paragraph appended. No trailing newline (core's serializer, same as VS Code).
- `04-image-pasted.png`: a PNG pasted from the clipboard was written to `images/crlf-bom-20261023-151502.png`, inserted as `![](images/crlf-bom-20261023-151502.png)`, rendered through the asset protocol, and saved.
- `05-open-dialog.png`: Cmd+O opened `sample.md`.
- `06-txt-link.png`: Cmd+click on the `notes.txt` link opened it in source mode (CodeMirror) with the text proxy icon.
- `07-readonly.png`, `08-readonly-save.png`: a `chmod 444` file shows the lock badge; Cmd+S shows the Save As prompt with the reason.
- `10-release-open-a.png`: release bundle, `open -a MikeDown.app other.md` while `sample.md` was open switched the window.

Acceptance "bytes identical to the VS Code extension's output": both hosts run the same core serializer (M0's harness showed WKWebView, jsdom and the VS Code bundle byte-identical); the Rust test `read_write_is_byte_identical_for_an_unchanged_file` and the GUI save above cover the CRLF/BOM part.

### Pending (needs a human at the GUI)

1. **Non-UTF-8 file** (edge 11): `~/tmp-mikedown-m2/latin1.md` exists. Open it (Cmd+O, or `open -a MikeDown.app ~/tmp-mikedown-m2/latin1.md`): expect source mode, lock badge, the notice bar "This file is not UTF-8…", `é` shown as U+FFFD, and Cmd+S offering Save As. My scripted attempt stalled on the macOS "Go to folder" sheet, not on the app (`planOpen` is unit-tested for this case).
2. **Edge 14 in the GUI**: launch the app with no file (`open -a MikeDown.app`), paste an image: expect the "Save the document first…" dialog; Cancel drops the paste, Save As… then writes the image next to the new file. Unit-tested in `imagePipeline.test.ts`; not observed in the GUI because M2 has no New Document action to reach Untitled after a file is open.
3. Finder double-click on a `.md` with MikeDown chosen as the handler (same `RunEvent::Opened` path as `open -a`, which passed). Windows (`argv` path, `set_document_edited` no-op) untested; nothing platform-specific beyond what M0 proved.

## Issues / blockers

- None blocking. Cosmetic: after Cmd+clicking a link, core's "Cmd+Click to open" tooltip can linger over the newly opened document until the mouse moves (core behaviour, not desktop).
- `tauri-plugin-shell`'s `open` is deprecated in favour of `tauri-plugin-opener`; M0 registered `shell`, so M2 uses it with `#[allow(deprecated)]`. Worth switching in M8/M11 when menus land.
- The sandbox refused writes to the main-repo `.orchestrator/` path, so this summary lives in the scratchpad (path in the final message).

## Notes for the orchestrator

- The plan names `Window::set_document_edited` / `set_represented_file`; Tauri 2.12 does not have them, so they are app commands in `commands/window.rs` using `objc2-app-kit` (already in the dependency graph). The macOS dot and proxy icon work (screenshots).
- Scope model: the Rust commands enforce the capability's fs scope themselves (the fs plugin's own commands are unused). Opening a document also allows its folder recursively (images beside it, the `images/` paste folder). Relative links to files outside `$HOME` and outside any picked/opened folder are refused with a clear error; M3's "opened folder" scope slots in the same way.
- Core packaging change (tsup entries for `shared/sha1`, `shared/wordCount`): needed for the release bundle; root compile/tests green. If core is published before M3, these ship as new subpath exports (the `./shared/*` export map already covers them).
- `imagePaste.cleanupUnreferenced` defaults to `false` on desktop (edge 15: no orphan cleanup in v1); the other image defaults match the extension.
- Open question kept at the plan default: `.txt` is in the associations (Alternate rank, so MikeDown does not grab `.txt` from TextEdit by default).
- M4 should replace `controller.openPath`'s "replace the single document (ask if dirty)" with tabs, and `main.ts`'s "first launch path wins" with per-path routing (edge 6).
- One caution for future GUI automation: `osascript keystroke` with the dev app can lose focus to the terminal; the guarded `~/tmp-mikedown-m2/open.sh` aborts instead of typing elsewhere. Fixture folder `~/tmp-mikedown-m2/` can be deleted after review.

## Review Materials

- Screenshots: `/Users/michaeljosephwork/tmp-mikedown-m2/shots/01-opened.png` … `10-release-open-a.png` (see list above).
- Fixtures: `/Users/michaeljosephwork/tmp-mikedown-m2/` (`crlf-bom.md` with its `images/`, `sample.md`, `other.md`, `notes.txt`, `locked.md` (0444), `latin1.md`, `pic.png`).
- Run (dev, hot reload): `cd /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a1af1a6181ae2393b/packages/desktop && npx tauri dev -- /Users/michaeljosephwork/tmp-mikedown-m2/sample.md`
- Run (release bundle, built this session): `open -a /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a1af1a6181ae2393b/packages/desktop/src-tauri/target/release/bundle/macos/MikeDown.app /Users/michaeljosephwork/tmp-mikedown-m2/sample.md`
- Click paths: type → dot in tab/close button → Cmd+S → dot clears, file keeps CRLF/BOM; Cmd+V an image → `images/` next to the document; Cmd+click `notes` → source mode; Cmd+O `locked.md` → lock badge, Cmd+S → Save As prompt; `Open Containing Folder` → stub toast.
- Tests: `npm run test:unit -w packages/desktop`; `cd packages/desktop/src-tauri && cargo test`.
