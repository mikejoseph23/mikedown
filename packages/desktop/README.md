# MikeDown Desktop

The standalone MikeDown app: a Tauri 2 shell around `@mikedown/core`, for
macOS and Windows. Plan: `desktop-app-plan.md` at the repo root. This package
is private and never published; releases are the signed, notarized `.dmg`
and the signed per-user NSIS `.exe`, built and staged by `deploy/` (see
`deploy/README.md`).

## Prerequisites

Everything below is checked by `npx tauri info` (run it from this folder).

### macOS (dev and release builds)

- Xcode or the Command Line Tools (`xcode-select -p` must print a path).
- Rust stable. Either `rustup` (recommended: `curl https://sh.rustup.rs -sSf | sh`)
  or Homebrew's `brew install rust`. The crate graph needs Rust ≥ 1.90.
- Node 22 (Volta pins it at the repo root).
- Recorded on the Mac Studio (2026-10-23): rustc 1.94.1 and cargo 1.94.1 from
  Homebrew (no rustup installed), Xcode 27.1, Node 22.20.0, npm 11.6.1,
  macOS 26.6.2. `npx tauri --version` → `tauri-cli 2.12.4`.
  **Caveat:** that Homebrew is the Intel one at `/usr/local`, so its `rustc`
  targets `x86_64-apple-darwin` and the `.app` runs under Rosetta. Fine for
  M0; before M10 install rustup (native `aarch64-apple-darwin`, and
  `rustup target add x86_64-apple-darwin` for a universal build).

### Windows (BEAST, 192.168.50.39)

Set up on 2026-10-23 for the M0 WebView2 smoke test. BEAST has Visual Studio
18 Community with the C++ build tools, Node 22.20.0, winget 1.29, the WebView2
runtime 155.0.4283.62 (evergreen, it ships with Windows 11) and now Rust
1.99.1 via rustup (user-scoped, `C:\Users\michaeljoseph\.cargo\bin`; an SSH
shell needs `$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"`). A copy of
this branch lives at `C:\git\mikedown` (extracted tarball, not a clone) with
`node_modules`, `packages\core\dist` and a release build in place. On a fresh
Windows box:

1. **Rust** via rustup: `winget install --id Rustlang.Rustup -e`, then open a
   new shell so `cargo` is on `PATH`. rustup picks the `x86_64-pc-windows-msvc`
   toolchain, which links with the Visual Studio C++ tools already present.
2. **Visual Studio Build Tools** with the "Desktop development with C++"
   workload and a Windows 10/11 SDK. BEAST's VS 18 Community already has
   `Microsoft.VisualStudio.Component.VC.Tools.x86.x64`; confirm an SDK with
   `vswhere -latest -requires Microsoft.VisualStudio.Component.Windows11SDK.26100`
   (any 10.0.19041+ SDK works).
3. **WebView2 runtime**, already present on Windows 11; for Windows 10 1809+
   targets the bundle's `webviewInstallMode: downloadBootstrapper` installs it
   on first run.
4. Clone the repo, `npm install`, then `npm run build:core` and
   `npm run build -w packages/desktop`. The `.msi`/`.exe` land under
   `packages/desktop/src-tauri/target/release/bundle/`.

Code signing (Azure Trusted Signing on BEAST, Developer ID on the Mac), the
updater and the release scripts: `deploy/README.md`.

## Dev loop

```bash
npm install                         # once, at the repo root (workspace)
npm run dev:desktop                 # = npm run dev -w packages/desktop = tauri dev
```

`tauri dev` starts Vite on http://localhost:1420 (`beforeDevCommand`), builds
the Rust shell (`src-tauri/`, ~1 min cold, seconds warm), opens the window, and
hot-reloads the webview on every edit under `src/` **and** `packages/core/src`.
Rust edits rebuild and relaunch the window.

- `npm run dev -w packages/desktop -- -- /abs/path/file.md` (or
  `npx tauri dev -- /abs/path/file.md` from this folder) opens the window on a
  file, the same path a double-click or `open -a MikeDown file.md` takes.
- App shortcuts live in one table, `src/menu/shortcuts.ts`
  (`hostOwnsShortcuts: true`): `Cmd+S` save, `Cmd+Shift+S` Save As, `Cmd+O`
  open, `Cmd+/` source mode, `Cmd+,` Settings (the item after it, AI Engines…, has no chord and opens the AI Engines page), `Cmd+Shift+O` Open Containing
  Folder, `Cmd+Alt+O` Open Folder, `Cmd+B` toggle the folder sidebar (only
  when focus is outside the editor, where `Cmd+B` stays Bold), `Cmd+Shift+E`
  show the sidebar and focus the tree, `Cmd+Shift+F` search the opened folder
  (M7: the sidebar swaps the tree for the search panel; Enter or a click opens
  the match, Esc returns to the tree). Ctrl on Windows.
- M8: the same table (`COMMANDS`) holds every menu command with its `when`
  clause and who handles the chord (`app` in the page, `core` in the editor's
  keymap, `os`). `src/menu/menuSpec.ts` arranges it into the menu bar per OS
  and sends it to `menu.rs` (`menu_set`); the focused window pushes enabled
  state (`menu_update`) and File > Open Recent (`menu_set_recents`). Strike
  moved to `Cmd+Shift+X` because `Cmd+Shift+S` is Save As. Help > Keyboard
  Shortcuts lists the table. `test/fixtures/menu/*.json` is the spec `cargo
  test` checks; regenerate with `UPDATE_MENU_FIXTURES=1 npm run test:unit -w
  packages/desktop` after changing the table.
- M8: a window with no folder and no open file shows the welcome screen
  (`src/ui/welcome.ts`) with recent folders and files from
  `<app-data>/recents.json` (`src/app/recents.ts`, `commands/recents.rs`).
  The first launch opens `src-tauri/resources/welcome.md` (compiled in and
  copied to `<app-data>/Welcome to MikeDown.md`) and offers the default-app
  setting once. Delete `recents.json` to see the first run again.
- `npm run dev -w packages/desktop -- -- /abs/path/folder` opens a folder
  (the sidebar's tree). `MIKEDOWN_WATCH_POLL=1` forces the watcher's 2 s
  polling fallback; `VITE_MIKEDOWN_TIMING=1` prints folder-open time and
  watcher latency (`[mikedown-smoke:timing-…]`) on the `tauri dev` console.
- `window.mikedownModel` (dev builds) is the document model: path, dirty,
  eol, bom, encoding, readOnly.
- Web Inspector: right-click → Inspect Element in a debug build (macOS needs
  `defaults write com.interappdev.mikedown WebKitDeveloperExtras -bool true`
  once if the item is missing). `window.mikedown` is the editor handle.
- `npm run typecheck -w packages/desktop` type-checks `src/` against core's
  built `dist/index.d.ts` (run `npm run build:core` once first).
- `npm run test:unit -w packages/desktop` runs the vitest suite in `test/unit/`;
  `npm run test:e2e -w packages/desktop` the Playwright spec in `test/e2e/`;
  `npm run test:desktop` at the root runs both. Rust: `cargo test` in `src-tauri/`.

Release build:

```bash
npm run build:desktop               # build:core, then tauri build (vite build + cargo --release + bundle)
```

Output: `src-tauri/target/release/bundle/macos/MikeDown.app` and
`dmg/MikeDown_<version>_aarch64.dmg` (Windows: `nsis/` only, per-user). This
build is unsigned and makes no updater artifacts. Shippable builds come from
`deploy/release.sh` (or `deploy/build-mac.sh` / `build-windows.ps1`), which
set `RELEASE=1`, sign, notarize and write the updater payloads.

Updater (M10): `tauri.conf.json` points at
`https://www.iadev.net/mikedown/latest.json` with the MikeDown public key.
Rust owns the check and install (`src-tauri/src/commands/updater.rs`), the
webview the schedule and the toast (`src/app/updater.ts`,
`src/ui/updateToast.ts`). `deploy/updater-staging-test.sh` tests N to N+1
against a local server.

## How the core alias works

`vite.config.ts` applies the same source-consumption rule as the VS Code
extension's `webpack.config.js`:

| Command | `@mikedown/core` | `@mikedown/core/styles.css` | `@mikedown/core/tokens.css` |
| --- | --- | --- | --- |
| `vite` (dev) | `../core/src/index.ts` | virtual stylesheet: KaTeX CSS + `tokens.css` + the component files in `scripts/build-css.mjs#ORDER` | `../core/src/styles/tokens.css` |
| `vite build` | package exports → `../core/dist/index.js` | `../core/dist/styles.css` | `../core/dist/tokens.css` |

`@mikedown/core/shared/*` follows the same rule. In dev, editing a core `.ts`
or `.css` file hot-reloads the window without a core build. A release build
refuses to run until `packages/core/dist` exists (`npm run build:core`).
`MIKEDOWN_CORE=source` or `=dist` overrides the choice for either command.

`resolve.mainFields` is `['module', 'browser', 'main']`, as in webpack, so
`tiptap-markdown` and friends resolve to their ES module builds.

Hunspell dictionaries for `spellcheckDictionaryUrl` are served at
`/dictionaries/<lang>/` in dev (from `packages/core/dist/dictionaries` when
built, else the repo-root `dictionaries/`) and copied next to `index.html` in
release builds. The desktop app turns spell check **on** by default (edge case
22) and sets `spellcheck="false"` on `<body>` so the OS webview's own checker
stays out of the way.

## The smoke fixture and harness

`src/smoke/fixture.ts` is one markdown document with frontmatter, callouts,
nested bullet/ordered/task lists, a table with alignment, `ts` and plain code
fences, inline and display math, a Mermaid graph, an image, a highlight, a
footnote, an emoji shortcode and a tag. M0 mounts it as `initialMarkdown`.

Two consumers compare the OS webview against the jsdom reference:

1. `test/unit/smoke-roundtrip.test.ts` round-trips the fixture through core
   under jsdom (the same code path as the VS Code bundle) and pins the output
   in `test/unit/smoke.expected.md`. Regenerate after an intentional
   serializer change with `UPDATE_SMOKE_EXPECTED=1 npm run test:unit -w packages/desktop`.
2. `src/smoke/harness.ts` runs inside the real webview when the bundle was
   built with `VITE_MIKEDOWN_SMOKE=1`. It round-trips the fixture, checks the
   rendered DOM (tables, task items, callouts, KaTeX, Mermaid SVG, footnotes,
   images), types, toggles bold, inserts a table, runs `/date`, opens and
   closes Settings, checks the AI group (`ai_list_engines`, a refused `ai_complete`, the Settings AI tab renders), toggles source mode, pastes plain text through a synthetic
   `ClipboardEvent`, fires Cmd/Ctrl+wheel zoom, swaps themes, then listens
   30 s for an OS appearance flip. The report goes to the Rust `smoke_report`
   command: stdout always, plus `<MIKEDOWN_SMOKE_DIR>/<name>.json` when set.

```bash
mkdir -p /tmp/mikedown-smoke
MIKEDOWN_SMOKE_DIR=/tmp/mikedown-smoke VITE_MIKEDOWN_SMOKE=1 npm run dev -w packages/desktop
# optional, while the window is open: flip the OS appearance
osascript -e 'tell app "System Events" to tell appearance preferences to set dark mode to not dark mode'
# then
npm run smoke:compare -w packages/desktop -- /tmp/mikedown-smoke/webkit-or-webview2.json
```

Results for both webviews live in `docs/webview-notes.md`.

## Layout

```
packages/desktop/
├── index.html, src/main.ts         boot: mount core with TauriHost, open the launch file, bind shortcuts
├── src/host/tauriHost.ts           class TauriHost implements MikeDownHost
├── src/host/imagePipeline.ts       uploadImage / pickImage / resizeImage over fs + core's shared helpers
├── src/host/pathOps.ts             synchronous posix/win32 path ops for the helpers
├── src/host/linkRouting.ts         external / anchor / local decision for openLink (edge 13)
├── src/documents/documentModel.ts  model: path, text, dirty, eol, bom, encoding, readOnly; title; open plan
├── src/documents/fsApi.ts          the only `invoke` wrapper (read/write/stat/bytes, window, launch queue)
├── src/app/documentController.ts   open / save / Save As / read-only / dirty guard / window title
├── src/menu/shortcuts.ts           the single command table: CmdOrCtrl accelerators, `when` clauses
├── src/menu/menuSpec.ts            the native menu bar built from that table (menuApi.ts sends it)
├── src/app/recents.ts              recent folders/files rules + store (<app-data>/recents.json)
├── src/app/windowTitle.ts          `file — folder` / `MikeDown` title rules
├── src/tree/                       folder tree (fileTree), workspace ops (folderWorkspace), folder .md index (mdIndex), pure rules (treeLogic, dropRouting)
├── src/search/                     folder search: controller + keyboard model (searchLogic), sidebar panel (searchPanel); results come from Rust
├── src/settings/desktopSettings.ts desktop-only settings (image paste policy, tree prefs), in memory until M5
├── src/ui/                         chrome (tab strip, status footer), sidebar frame, context menu, dialogs + toast, image viewer, welcome screen, shortcuts sheet
├── src/smoke/                      fixture + in-app harness
├── src/styles/app.css              app chrome only; editor styling stays in core
├── vite.config.ts                  core alias rule, dictionaries, Tauri port/targets
├── vitest.config.ts, test/unit/    jsdom unit tests (mocked Tauri IPC in test/unit/helpers/)
├── test/e2e/                       Playwright over `vite dev` + mocked Tauri internals (see its README)
├── test/fixtures/encoding/         byte fixtures shared by the TS and Rust encoding tests
├── scripts/                        smoke-compare.mjs
└── src-tauri/                      Cargo.toml, tauri.conf.json, capabilities/, icons/, src/lib.rs, src/commands/
```

Tauri plugins registered in `src-tauri/src/lib.rs`: single-instance (first),
window-state, fs, dialog, shell, process, updater. Window and menu APIs are
part of the Tauri 2 core crate. There is no `tauri-plugin-trash` on crates.io;
the `trash` crate backs the tree's delete command. `notify` backs the
watcher; `tauri.conf.json` sets the fs plugin's `requireLiteralLeadingDot:
false` so `$HOME/**` also covers dotfolders (`.mikedown/versions`, show
hidden).

### AI engines (`commands/ai.rs`)

The AI provider layer (see `ai-inference-engines-plan.md`) runs in Rust: the
webview never opens a socket to an engine and never sees an API key. The
commands are `ai_complete` (streams `ai-token:<id>`, then `ai-done:<id>` or
`ai-error:<id>` to the calling window; closing the window cancels its
requests), `ai_cancel`, `ai_list_engines`, `ai_test_engine`,
`ai_discover_models`, `ai_set_secret` and `ai_request_cloud_consent` (a native
dialog), called only from `src/host/aiApi.ts`; `src/host/aiHost.ts` turns them
into core's `host.ai` (tier 2). Adapters per engine kind are in
`commands/ai/providers/`; request building, SSE reading and discovery parsing
are ports of `packages/core/src/ai/` and run against the shared
`test/ai-fixtures/`.

- Engines come from the **global** `<app-data>/settings.json` (`ai.engines`,
  `ai.allowCloud`, `ai.localNetworks`). A folder's `.mikedown/settings.json`
  cannot add an endpoint or switch the cloud on; the app drops those keys with
  a banner message. Everything else under `ai.*` follows the folder-wins merge.
- Keys live in the OS keychain (service `net.iadev.mikedown`, account = engine
  id). With no stored key, the engine's `apiKeyEnv` variable is read from the
  app's environment; a Dock or Finder launch has no shell profile, so store the
  key in Settings instead, or rely on the engine's `apiKeyFile` (the oMLX preset
  sets `~/.omlx/settings.json`, `auth.api_key`): a JSON file read last, only if
  it is a regular file under your home folder (symlinks resolved), at most 64 KB.
- A cloud engine needs `ai.allowCloud` and the user's answer for the window's
  folder (`ai.consent.<engineId>` in that folder's settings file; a window
  with no folder remembers it for the session). The Rust side checks this
  itself, whatever the webview asks for.
  That consent lives in the folder's `.mikedown/settings.json`, which a repo
  can contain, so a cloned folder can arrive with consent for an engine id
  already recorded. It cannot send anything anywhere new (the engine, its URL
  and `ai.allowCloud` are global), but look at a folder's file before trusting
  it.

### Disk, scope and native window state

All disk I/O goes through the app's own commands in `src-tauri/src/commands/`
(`fs.rs`: `read_text`, `write_text`, `stat`, `exists`, `list_dir`, `mkdir`,
`read_bytes`, `write_bytes`, `open_in_default_app`, `allow_asset`, and for the
tree `allow_folder`, `rename` (two-step for case-only changes), `create_file`,
`create_dir`, `move_path`, `copy_path`, `trash`, `list_markdown`,
`reveal_path`, `modifier_state`; `search.rs`: `search_folder` (streams `search-batch` / `search-done` events, 2,000-match cap, files over 2 MB skipped), `search_cancel`; `watcher.rs`: `watch`, `unwatch`,
`unwatch_all`, emitting `fs-changed`), called only from
`src/documents/fsApi.ts`. On Windows, names are checked against reserved
device names and the 259-character limit before anything touches the disk.
Saves, copies and cross-volume moves keep extended attributes (Finder tags,
"Open With", quarantine). macOS deletes use `NSFileManager` (no "control
Finder" permission prompt). `read_text` detects a BOM, CRLF and
non-UTF-8 (lossy decode, opened read-only), returns `\n` text, and
`write_text` puts the same BOM and line ending back through a temp-file +
rename write that keeps the file mode. `cargo test` in `src-tauri/` covers it.

Every command checks the fs scope from `capabilities/default.json`
(`$HOME/**`, `$APPDATA/**`); dialog picks, double-clicked files and
command-line paths are added at runtime, and reading a document also allows
its folder so the images beside it render through the asset protocol
(`convertFileSrc`, `app.security.assetProtocol`).

`recents.rs` reads and writes `<app-data>/recents.json`, reports which listed
paths are missing, extends the scope only to listed entries
(`recents_allow`) and copies the bundled welcome guide (`welcome_file`).
`menu.rs` builds the menu bar from the page's spec (a bootstrap menu covers
the first frame).

`window.rs` adds what the JS window API lacks: `set_document_edited` (the
macOS close-button dot) and `set_represented_file` (the title-bar proxy icon)
through `objc2-app-kit`; both are no-ops elsewhere. `launch.rs` queues files
from argv, the single-instance callback and macOS `RunEvent::Opened` until the
page calls `frontend_ready`, then emits `mikedown:open-files`.

## Edge cases and accessibility (M11)

**Line endings and encoding (edge 11).** Files are read as UTF-8 text with `\n`
inside the editor. The BOM and the line-ending style are remembered per file
and written back on save, so an unedited round trip is byte-identical
(`saving_a_fixture_leaves_the_file_byte_identical` in `fs.rs`, fixtures in
`test/fixtures/encoding/`). A file with **mixed** endings is written back in
the **majority** style (CRLF when the counts tie), so one save normalises it;
that is the only case where a save changes bytes you did not edit. A file that
is not valid UTF-8 opens read-only in source mode with a notice and is never
rewritten in place; Save As writes a UTF-8 copy.

**Large files (edge 12).** Over 2 MB opens in source mode with an info bar and
"Open as rich text anyway"; a source-mode tab saves like any other (no version
snapshot above 2 MB). Over 20 MB is refused before a byte is read and offers
the OS default app.

**Names and paths (edge 25).** New, rename, move, copy, Save As and pasted
images check the name and, on Windows, the 259-character path limit in Rust
before any disk call: reserved device names (`CON`, `PRN`, `AUX`, `NUL`,
`COM1` to `COM9`, `LPT1` to `LPT9`, with or without an extension), trailing
dots and spaces, and `<>:"|?*`. The message is a plain sentence. A path that
already exists is never re-validated, so a legacy long path keeps saving.

**Read-only and permissions (edge 10).** A read-only file opens normally with a
lock badge; `CmdOrCtrl+S` offers Save As with the reason. OS failures come back
as sentences ("You do not have permission to change this file...") with the
system text in brackets. A folder you cannot write to (`access(2)` on macOS and
Linux; the read-only attribute on Windows, so an ACL-denied folder only fails
with the plain message when used) disables New File, New Folder, Rename and
Delete, with the reason as the tooltip.

**Network volumes and cloud placeholders (edge 10).** A folder on a network
volume (SMB, NFS, AFP, a Windows UNC path or mapped drive) is watched by
polling every 2 s from the start: on an SMB share FSEvents starts without error
and then never reports another machine's change. Cloud placeholders: macOS
downloads an evicted iCloud file on first read (about 1 s for a small file);
reads that take over about 10 s show "still downloading" with Retry in the
pane's info bar. On Windows a failed OneDrive download (`ERROR_CLOUD_FILE_*`)
gets the same state at once instead of an error dialog.

**Accessibility (edge 26).** `test/e2e/a11y.spec.ts` runs axe (WCAG 2 A and AA)
over the welcome screen, tree, tabs and split, search results, Settings, the
changed-on-disk dialog and the diff viewer; chrome violations fail the suite,
core violations are printed as notes. Tabs are not nested controls (close is a
mouse affordance; keyboards use `CmdOrCtrl+W`), the downloading Retry button
lives in the info bar, search rows get their names from their text. In `app.css`:
`prefers-reduced-motion` stops every transition and animation;
`prefers-contrast: more` overrides the `--mikedown-*` tokens (borders, text,
focus ring) for light and dark, which core and the chrome both read;
`forced-colors` keeps borders and focus outlines on system colors. Keyboard-only
use (tree, open, tabs, split, search, Settings) is exercised in
`test/e2e/polish.spec.ts`.
