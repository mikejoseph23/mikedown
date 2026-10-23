# MikeDown Desktop

The standalone MikeDown app: a Tauri 2 shell around `@mikedown/core`, for
macOS and Windows. Plan: `desktop-app-plan.md` at the repo root. This package
is private and never published; releases are the signed `.app`/`.dmg` and
`.msi`/`.exe` bundles.

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

Code signing (Azure Trusted Signing on BEAST, Developer ID on the Mac) is M10.

## Dev loop

```bash
npm install                         # once, at the repo root (workspace)
npm run dev:desktop                 # = npm run dev -w packages/desktop = tauri dev
```

`tauri dev` starts Vite on http://localhost:1420 (`beforeDevCommand`), builds
the Rust shell (`src-tauri/`, ~1 min cold, seconds warm), opens the window, and
hot-reloads the webview on every edit under `src/` **and** `packages/core/src`.
Rust edits rebuild and relaunch the window.

- `Cmd+/` (Ctrl on Windows) toggles source mode, `Cmd+,` opens Settings. The
  app owns these (`hostOwnsShortcuts: true`); M2 moves them to the shortcut table.
- Web Inspector: right-click → Inspect Element in a debug build (macOS needs
  `defaults write com.interappdev.mikedown WebKitDeveloperExtras -bool true`
  once if the item is missing). `window.mikedown` is the editor handle.
- `npm run typecheck -w packages/desktop` type-checks `src/` against core's
  built `dist/index.d.ts` (run `npm run build:core` once first).
- `npm run test:unit -w packages/desktop` runs the vitest suite in `test/unit/`.

Release build:

```bash
npm run build:desktop               # build:core, then tauri build (vite build + cargo --release + bundle)
```

Output: `src-tauri/target/release/bundle/macos/MikeDown.app` and
`dmg/MikeDown_<version>_aarch64.dmg` (Windows: `msi/`, `nsis/`).

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
   closes Settings, toggles source mode, pastes plain text through a synthetic
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
├── index.html, src/main.ts         boot: mount one core editor (M0: the fixture)
├── src/smoke/                      fixture + in-app harness
├── src/styles/app.css              app chrome only; editor styling stays in core
├── vite.config.ts                  core alias rule, dictionaries, Tauri port/targets
├── vitest.config.ts, test/unit/    jsdom unit tests
├── scripts/                        smoke-compare.mjs, e2e.mjs (placeholder until T1)
└── src-tauri/                      Cargo.toml, tauri.conf.json, capabilities/, icons/, src/lib.rs
```

Tauri plugins registered in `src-tauri/src/lib.rs`: single-instance (first),
window-state, fs, dialog, shell, process, updater. Window and menu APIs are
part of the Tauri 2 core crate. There is no `tauri-plugin-trash` on crates.io;
the `trash` crate is in `Cargo.toml` for the M3 delete command. The only
capability (`capabilities/default.json`) is `core:default`, which lets the
main window read its own state; every later feature adds the minimum it needs.
