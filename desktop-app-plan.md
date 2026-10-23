# MikeDown Desktop — Planning Document

## Summary

MikeDown Desktop is a lightweight standalone WYSIWYG markdown editor for non-developers: the person who gets handed a `.md` file and double-clicks it, and the person who keeps a folder of notes. It is a **Tauri 2** app living at `packages/desktop` in this npm workspace and is a **thin consumer of `@mikedown/core`**, exactly like the VS Code extension (`src/`) and the Angular wrapper (LymeStarter). All editor behavior stays in core. The desktop app contributes one `MikeDownHost` implementation over Tauri plugins (fs, dialog, shell, trash, updater, window, menu) plus the app chrome: file tree, tabs, split panes, folder search, versioning, settings, welcome screen, export, updater.

**Objectives**

1. One core, thin consumers. Every editor feature (callouts, math, mermaid, slash commands, spellcheck) lands in VS Code, Angular and Desktop from a single codebase. The desktop app never forks editor behavior.
2. A ~10 MB signed, notarized, auto-updating download for macOS and Windows, free from Mike's website. No app stores.
3. Safe for non-developers: explicit save with hot exit, per-save file versioning with a diff viewer, Trash instead of delete, no telemetry.

**Critical success factors**

- Core runs identically in WebKit (macOS WKWebView) and WebView2 (Windows). Proven in M0 before any chrome is built.
- The VS Code extension keeps passing every suite at every commit, including after the `imagePaste` helpers move into core (M1).
- Signing and updater pipeline mirrors the proven LymeScribe flow (Developer ID + notarization on Mac, Azure Trusted Signing on BEAST for Windows).
- The desktop app contains no editor logic: a reviewer can grep `packages/desktop/src` for `@tiptap`, `prosemirror`, `@codemirror` and find nothing.

**Defaults applied (override any of these):** incremental testing after each wave; unit tests with vitest for pure logic, Tauri e2e with WebDriver (`tauri-driver`) or Playwright against the Vite dev server for webview UI, a manual checklist per OS; `@mikedown/core` consumed **from source** during development through a Vite alias and **pinned to the published version** at release; app name "MikeDown", bundle id `com.interappdev.mikedown` (open question).

### Milestone Progress Tracker

| Milestone | Model | Status | Duration (min) | Notes |
|---|---|---|---|---|
| [M0 — Tauri scaffold and WebKit smoke test](#m0--tauri-scaffold-and-webkit-smoke-test) | Opus | ✅ Complete (Windows GUI checklist pending) | 24 | Gate: core renders and round-trips in WKWebView and WebView2 |
| [M1 — imagePaste helpers into core shared](#m1--imagepaste-helpers-into-core-shared) | Sonnet | ✅ Complete | 4 | `test/unit/imagePaste.test.ts` must keep passing |
| [M2 — Tauri host adapter and lone-file window](#m2--tauri-host-adapter-and-lone-file-window) | Opus | ✅ Complete (2 GUI checks pending) | 34 | `TauriHost implements MikeDownHost`; file associations |
| [T1 — Host and single-file tests](#t1--host-and-single-file-tests) | Sonnet | 🔄 In Progress | — | unit + e2e + hands-on both OSes |
| [M3 — Folder sidebar and file tree](#m3--folder-sidebar-and-file-tree) | Opus | ⬜ Not Started | — | lazy tree, CRUD, watcher, drag-drop, Trash |
| [M4 — Tabs, panes, document model, hot exit](#m4--tabs-panes-document-model-hot-exit) | Opus | ⬜ Not Started | — | one model per path per window; backups; session restore |
| [T2 — Workspace tests](#t2--workspace-tests) | Sonnet | ⬜ Not Started | — | tree + tabs + hot exit |
| [M5 — Settings: global, folder override, App tab](#m5--settings-global-folder-override-app-tab) | Sonnet | ⬜ Not Started | — | reuses core settings modal via `extraSettingsSections` |
| [M6 — Versioning, diff view, external changes](#m6--versioning-diff-view-external-changes) | Opus | ⬜ Not Started | — | `.mikedown/versions/`; Compare / Overwrite / Revert |
| [M7 — Folder search](#m7--folder-search) | Sonnet | ⬜ Not Started | — | Rust-side search, grouped results |
| [M8 — Welcome, recents, menus, window title](#m8--welcome-recents-menus-window-title) | Opus | ⬜ Not Started | — | native menus, `CmdOrCtrl` shortcuts, `welcome.md` |
| [M9 — Export HTML and PDF/print](#m9--export-html-and-pdfprint) | Sonnet | ⬜ Not Started | — | reuses `handle.getHtml()` |
| [T3 — Feature tests](#t3--feature-tests) | Sonnet | ⬜ Not Started | — | settings, versioning, search, export |
| [M10 — Updater, signing, build pipeline, download page](#m10--updater-signing-build-pipeline-download-page) | Opus | ⬜ Not Started | — | follows the LymeScribe deploy scripts |
| [M11 — Polish: a11y, encoding, filesystem oddities](#m11--polish-a11y-encoding-filesystem-oddities) | Sonnet | ⬜ Not Started | — | edge cases 10, 11, 12, 25, 26 |
| [T4 — Release candidate hands-on](#t4--release-candidate-hands-on) | Sonnet | ⬜ Not Started | — | full checklist per OS on signed builds |

**Model Assignment Guidelines:** Haiku for mechanical/boilerplate; Sonnet for well-defined feature work; Opus for architecture, ambiguous decisions, and all front-end UI design work.

[Return to Top](#mikedown-desktop--planning-document)

---

## Table of Contents

- [Summary](#summary)
- [Current state (verified 2026-10-23)](#current-state-verified-2026-10-23)
- [Decisions](#decisions)
- [Architecture](#architecture)
- [Edge cases and behaviors](#edge-cases-and-behaviors)
- [Worker rules](#worker-rules)
- [M0 — Tauri scaffold and WebKit smoke test](#m0--tauri-scaffold-and-webkit-smoke-test)
- [M1 — imagePaste helpers into core shared](#m1--imagepaste-helpers-into-core-shared)
- [M2 — Tauri host adapter and lone-file window](#m2--tauri-host-adapter-and-lone-file-window)
- [T1 — Host and single-file tests](#t1--host-and-single-file-tests)
- [M3 — Folder sidebar and file tree](#m3--folder-sidebar-and-file-tree)
- [M4 — Tabs, panes, document model, hot exit](#m4--tabs-panes-document-model-hot-exit)
- [T2 — Workspace tests](#t2--workspace-tests)
- [M5 — Settings: global, folder override, App tab](#m5--settings-global-folder-override-app-tab)
- [M6 — Versioning, diff view, external changes](#m6--versioning-diff-view-external-changes)
- [M7 — Folder search](#m7--folder-search)
- [M8 — Welcome, recents, menus, window title](#m8--welcome-recents-menus-window-title)
- [M9 — Export HTML and PDF/print](#m9--export-html-and-pdfprint)
- [T3 — Feature tests](#t3--feature-tests)
- [M10 — Updater, signing, build pipeline, download page](#m10--updater-signing-build-pipeline-download-page)
- [M11 — Polish: a11y, encoding, filesystem oddities](#m11--polish-a11y-encoding-filesystem-oddities)
- [T4 — Release candidate hands-on](#t4--release-candidate-hands-on)
- [Open questions](#open-questions)
- [Parallel Development Recommendations](#parallel-development-recommendations)
- [References](#references)
- [Gap-Filling Prompts](#gap-filling-prompts)
- [Progress Log / Notes](#progress-log--notes)

---

## Current state (verified 2026-10-23)

- **Workspace.** Root `package.json` is `mikedown-editor` 2.14.2 with `"workspaces": ["packages/*"]`. `packages/core` is `@mikedown/core` `0.1.0-rc.1` (tsup ESM build, `dist/index.js` + `index.d.ts` + `styles.css` + `tokens.css` + `dictionaries/`; publish pending `npm login`). The VS Code extension builds core **from source** through `webpack.config.js` aliases (`@mikedown/core` → `packages/core/src`, `@mikedown/core/shared` → `packages/core/src/shared`); `vitest.config.ts` has the same aliases.
- **Core public API** (`packages/core/src/index.ts`): `createMikeDownEditor(container, options)`, `NoopHost`, `DEFAULT_FEATURES`; types `MikeDownHost`, `MikeDownOptions`, `MikeDownEditorHandle`, `MikeDownSettings`, `MikeDownSettingsPatch`, `MikeDownFeatures`, `MikeDownCommand`, `MikeDownSettingsSection` (and `…SectionBuild`, `…SectionContext`), `LinkSuggestion`, `WikilinkResolution`, `ImageUploadRequest`, `ImageInsertResult`, `ImageResizeRequest`, `DiffBaseline`, `MikeDownStats`, `BacklinkItem`, `TagCount`.
- **`MikeDownHost`** (`packages/core/src/host.ts`): only `onChange(markdown, { pristine })` is required. Optional: `onStats`, `openLink(href, behavior, reveal)`, `saveSettings(patch, { source, silent })`, `toggleTheme`, `openKeybindings`, `uploadImage`, `pickImage`, `resizeImage`, `resolveImageSrc(src)`, `getLinkSuggestions`, `getFileHeadings`, `resolveWikilinks`, `createWikilink`, `checkLinks`, `getTags`, `openTag`, `getDiffBaseline`, `onHeadingRenamed`, `onHeadingRenameAmbiguous`, `exportHtml(html)`, `printDocument(html)`, `viewInBrowser(html)`, `sidebarPrefs`. An absent method hides its UI.
- **`MikeDownEditorHandle`** (`packages/core/src/types.ts`): `setMarkdown(md, { pristine })`, `getMarkdown`, `focus`, `setReadOnly`, `setTheme('light'|'dark'|'auto')`, `command(name, args)`, `updateSettings(patch)`, `markSaved(content?)`, `getHtml()`, `scrollToAnchor`, `revealLink`, `setImageStatus`, `setTags`, `setLinkSuggestions`, `setBacklinks`, `setDocMeta`, `setSidebarState`, `setSidebarFooterLink`, `setDiffAvailable`, `isModalOpen`, `on(event, fn)`, `destroy`.
- **`MikeDownOptions`**: `host`, `initialMarkdown`, `settings`, `features`, `theme`, `readOnly`, `spellcheckDictionaryUrl`, `extraSettingsSections`, `settingsFooterNote`, `hostOwnsShortcuts`. `DEFAULT_FEATURES` has `sidebar: false`, `supportCard: false`, everything else on. `MikeDownCommand` is the 16-name union (`toggleBold` … `openSettings`, `copyAsRichText`).
- **Theme.** `packages/core/src/styles/tokens.css` defines 54 `--mikedown-*` tokens; the root carries `data-mikedown-theme="light"|"dark"|"auto"`, and `auto` follows `prefers-color-scheme`.
- **Settings split** (`core-extraction-decisions.md` section 6): core owns fonts, width, theme, slash commands, spellcheck, math, mermaid, normalization, heading numbering, `linkClickBehavior`, `imagePaste.enabled`. VS Code only: `imagePaste.folder/.folderRelativeTo/.filenamePattern/.pathStyle/.altText/.maxSizeMB/.cleanupUnreferenced`, `imageResize.overwrite`, sidebar prefs, support card. The desktop app re-homes the image-paste policy keys as **desktop** settings implemented in its `uploadImage`.
- **Image helpers.** `src/imagePaste.ts` (pure functions: `expandFilenamePattern`, `resolveTargetFolder`, `resolveFilename`, `formatInsertPath`, `resizeSiblingPath`, `resolveAltText`, `extractLocalImageRefs`, `isPathInside`, …) imports Node `crypto` and `path` and `ImagePasteSettings` from `src/settings.ts`. Covered by `test/unit/imagePaste.test.ts`. Not yet in core.
- **Spell check.** Core bundles Hunspell dictionaries (`nspell`, `dist/dictionaries/`); the VS Code extension defaults `mikedown.spellCheck.enabled` to **false**.
- **Previous attempt.** Electron + React at `github.com/mikejoseph23/mikedown-apps` (local clone deleted). Reference only; see [References](#references).
- **Signing assets Mike already holds:** Apple Developer ID (team `UU626VCLYW`, notarytool keychain profile pattern) and an Azure Trusted Signing account used on BEAST (192.168.50.39). See `~/git/lymescribe/deploy/`.

[Return to Top](#mikedown-desktop--planning-document)

---

## Decisions

Settled in the planning interview (2026-10-23). Do not re-litigate inside a milestone; raise a note in the summary instead.

- **Users:** both "handed a .md file and double-clicks it" and "folder of notes" people.
- **Shell: Tauri 2**, chosen over Electron for a ~10 MB download. Recorded risks: Rust toolchain required on both build machines (Mac and BEAST); OS webview differences (WebKit on macOS, WebView2 on Windows), so a WebKit smoke test of core is part of M0; Linux deferred because of WebKitGTK.
- **Platforms v1:** macOS + Windows. Linux later.
- **Distribution:** free download from Mike's website; no app stores; Tauri updater plugin; Paddle reserved for later paid features. Developer ID + notarization on Mac, Azure Trusted Signing on Windows, following the LymeScribe pipeline.
- **Features v1:** file tree (create/rename/delete/move), tabs, split panes, folder-wide search, welcome screen with recent folders/files, file versioning, settings, export.
- **Save model:** explicit save (`CmdOrCtrl+S`) with a dirty indicator; **no autosave**. Hot exit (edge case 7–8) makes this safe.
- **Versioning:** on each explicit save, snapshot into `.mikedown/versions/` at the opened folder's root; skip if identical to the last snapshot; keep a configurable last N; diff viewer between versions. No versioning for a lone file opened without a folder.
- **Settings:** global file in the OS app-data dir (`~/Library/Application Support/MikeDown/settings.json`, `%APPDATA%\MikeDown\settings.json`) plus optional `.mikedown/settings.json` in the opened folder overriding matching keys (Claude-style global vs. project). `.mikedown/` is created only when the user opts in (versioning or a folder override), never by merely opening a folder or file. Settings UI reuses core's settings modal with an added **App** tab and a **"Save for this folder"** toggle.
- **Theme:** follows the OS via `prefers-color-scheme` on core's `--mikedown-*` tokens (`theme: 'auto'`); no manual override in v1.
- **Images:** mirror the VS Code extension's image-paste settings (folder, filename pattern, alt text, hash dedupe). The pure helpers in `src/imagePaste.ts` move to `packages/core/src/shared/` so both hosts share them (M1).
- **Versioning stays in the desktop app.** Snapshots, pruning, the version browser and the diff viewer all live in `packages/desktop`; nothing versioning-related goes into `@mikedown/core` or the VS Code extension (VS Code already has Timeline and Git). The only core touchpoint is the existing optional `host.getDiffBaseline`.
- **External file changes:** as VS Code. Clean tab reloads silently; dirty tab keeps edits and on save warns "changed on disk" with Compare / Overwrite / Revert; the versioning diff view doubles as Compare.
- **Non-markdown files:** text files open in source mode (CodeMirror), images in a viewer, everything else in the OS default app.
- **Large folders:** lazy-load the tree per directory; hide dotfolders and `node_modules` by default with a "show hidden" toggle; same exclusions for search; search limited to markdown/text files; watch only expanded directories.

[Return to Top](#mikedown-desktop--planning-document)

---

## Architecture

```
mikedown/                                  npm workspace root
├── packages/
│   ├── core/                              @mikedown/core (unchanged except M1 shared helpers)
│   └── desktop/                           MikeDown Desktop (Tauri 2)
│       ├── package.json                   private; deps: @mikedown/core, @tauri-apps/api, plugin JS bindings, vite
│       ├── vite.config.ts                 alias @mikedown/core → ../core/src in dev; none in release (pinned version)
│       ├── index.html                     single page, one window = one instance of this page
│       ├── src/
│       │   ├── main.ts                    boot: read window args (folder/file), restore session, mount app shell
│       │   ├── host/tauriHost.ts          class TauriHost implements MikeDownHost (one per editor instance)
│       │   ├── host/imagePipeline.ts      uploadImage/pickImage/resizeImage over fs + core shared imagePaste helpers
│       │   ├── documents/documentModel.ts one model per file path per window: text, dirty, encoding, mtime, backups
│       │   ├── documents/backups.ts       debounced hot-exit backups (<app-data>/backups/)
│       │   ├── documents/versioning.ts    .mikedown/versions snapshots, listing, pruning
│       │   ├── tree/                      lazy file tree, CRUD, drag-drop, watcher glue
│       │   ├── panes/                     tab strip, split panes, pane ↔ document binding
│       │   ├── search/                    folder search UI (results come from Rust)
│       │   ├── settings/                  global + folder settings merge, App tab section, corrupt-file banner
│       │   ├── ui/                        welcome screen, diff viewer, info bars, toasts, dialogs
│       │   ├── menu/shortcuts.ts          single table of commands → CmdOrCtrl accelerators (native menu + in-page)
│       │   └── styles/app.css             app chrome only; editor styling stays in core's styles.css/tokens.css
│       ├── src-tauri/
│       │   ├── Cargo.toml, tauri.conf.json, capabilities/*.json (per-plugin permissions)
│       │   ├── src/main.rs, lib.rs        plugin registration, window creation, single-instance + file-open events
│       │   ├── src/commands/fs.rs         read/write with encoding + BOM + CRLF detection, atomic write, stat
│       │   ├── src/commands/search.rs     folder search (walker + matcher, exclusions)
│       │   ├── src/commands/watcher.rs    per-directory watcher with polling fallback
│       │   └── icons/, resources/welcome.md
│       └── test/                          vitest unit tests (pure logic) + e2e/ (tauri-driver or Playwright)
└── src/                                   VS Code extension (unchanged)
```

**Module boundaries**

| Module | Owns | Never does |
|---|---|---|
| `host/` | The `MikeDownHost` implementation and image pipeline | Editor behavior, DOM inside `.mikedown-root` |
| `documents/` | Text buffers, dirty state, backups, versioning, encoding metadata | UI |
| `tree/`, `panes/`, `search/`, `ui/` | App chrome | File I/O directly (goes through `documents/` and Tauri commands) |
| `settings/` | Merge of global + folder settings, App tab | Core-owned setting semantics (core renders and validates its own) |
| `src-tauri/` | Everything that touches disk, OS dialogs, menus, updater, windows | Markdown parsing or rendering |

**Rules**

- The desktop app **never forks editor behavior from core**. If something is missing in the editor, add it to `packages/core` behind a feature flag or host method and consume it; never patch around it in `packages/desktop`.
- One `createMikeDownEditor` instance **per pane**, bound to one shared `DocumentModel` per path per window. `handle.setMarkdown(text, { pristine: true })` on load; `handle.markSaved()` after a successful write; the model's `dirty` flag drives tab dots, window `documentEdited`, quit dialogs and backups.
- Core settings go through `handle.updateSettings(patch)` and `host.saveSettings(patch)`. Desktop-only settings (versioning N, update check, image folder policy, show hidden, folder-override toggle) live in the desktop settings module and appear in the App tab via `extraSettingsSections`.
- Theme: `theme: 'auto'`; the app chrome uses `--mikedown-*` tokens too, so one `prefers-color-scheme` swap recolors everything.
- Keyboard: `hostOwnsShortcuts: true`; the desktop app owns `CmdOrCtrl+S`, `CmdOrCtrl+/`, tab and pane shortcuts, and forwards editor commands with `handle.command(name)`.

[Return to Top](#mikedown-desktop--planning-document)

---

## Edge cases and behaviors

Decided in the second planning pass (2026-10-23). Each is referenced by number from the milestones.

1. **Versioning storage:** full snapshots; default N = 25 per file; files over 2 MB silently skip versioning; path `.mikedown/versions/<relative/path/to/file.md>/<compact ISO timestamp>.md` so name order is chronological.
2. **Restore** replaces the editor buffer and marks the tab dirty; the user saves to commit, which snapshots as usual. Restore never writes to disk by itself.
3. **Rename/move** moves the versions folder alongside; delete deletes the versions too.
4. **Lone file:** full window with the sidebar collapsed; toolbar/menu item **Open Containing Folder** reopens the window on the parent folder with the file still active.
5. **Second folder** replaces the current one in the same window (prompting for dirty tabs), as VS Code; **New Window** opens an empty window. Multi-window supported, never created implicitly.
6. **Double-click a .md:** if an open window's folder contains it, focus that window and open a tab; else a new lone-file window.
7. **Quit with dirty files:** one dialog listing all of them with Save All / Don't Save / Cancel. Hot exit: dirty buffers restored on relaunch with the dirty indicator.
8. **Backups:** debounced ~1 s write of each dirty buffer to `<app-data>/backups/<hash-of-path>.md` plus a small index; cleared on save/close; leftovers restored into dirty tabs on launch without a dialog.
9. **Document model:** one in-memory model per file path per window, shared by all panes showing it (one core editor instance per pane bound to the same model); dirty state lives on the model. Across windows, treat it as an external file change.
10. **Read-only / permission denied:** open normally, lock badge on the tab, `CmdOrCtrl+S` offers Save As with the reason. Network drives: watcher degrades to polling if native events fail. Cloud placeholders (iCloud/OneDrive): read triggers the download; after ~10 s show a "still downloading" tab state with Retry.
11. **Encoding:** detect CRLF on load and write it back on save; preserve a BOM; non-UTF-8 files open read-only in source mode with a notice, no transcoding in v1.
12. **Large files:** over 2 MB opens in source mode with an info bar "Open as rich text anyway"; over 20 MB refuses with the OS-default-app option.
13. **Links:** relative links to .md open in a new tab; http(s) opens the system browser; anchors scroll; broken relative links offer "Create file". Wikilinks in v1 (core already has `resolveWikilinks` / `createWikilink`), resolved against the folder's .md index.
14. **Image into unsaved document:** prompt "Save the document first so the image has a home" with Save As; cancel drops the paste. No base64 inline images.
15. **Orphaned-image cleanup:** not in v1; later as an opt-in "Find unused images" command.
16. **Corrupt settings JSON:** fall back to defaults for that file, non-modal banner with "Open file" and "Reset to defaults"; never overwrite the broken file automatically.
17. **Updater:** silent check on launch and every 24 h; offline or any error (including signature failure) silently ignored and logged; "Update available" toast with Restart Now / Later; Help menu "Check for Updates…" gives explicit feedback. Stable channel only in v1.
18. **Stale recents** stay listed greyed with a remove affordance, pruned after missing on three launches. Empty state: Open Folder, Open File, New File, plus a one-paragraph hint.
19. **Search:** plain text with case and whole-word toggles; no regex; no cross-file replace in v1 (in-document find/replace is already in core). Results grouped by file with highlighted snippets; click opens and scrolls.
20. **Drag-drop onto the tree:** move within the folder, copy from outside, Option/Alt inverts. Onto the editor: image file inserts via the image pipeline, .md inserts a relative link, other text opens in a tab, anything else is ignored with a toast.
21. **Delete** always goes to the OS Trash/Recycle Bin via `tauri-plugin-trash`, with a confirmation that has "Don't ask again".
22. **Spell check:** core's bundled Hunspell, default **ON** for the desktop app (the VS Code extension defaults off because VS Code disables the webview's native checker and the feature was still settling); disable the webview's native spell check (`spellcheck="false"` on the root) to avoid double underlines.
23. **Menus:** native menu bar on both OSes; shortcuts defined once with `CmdOrCtrl`; OS conventions (Quit, Preferences location, Alt+F4) follow the platform. Customizable keymap: not in v1 (open question, default no).
24. **Export** to HTML and PDF/print in v1, reusing `handle.getHtml()` and the webview's native print-to-PDF.
25. **Filesystem oddities:** case-only rename via a two-step temp rename. Windows reserved names and >260-char paths validated with a plain-language error before touching disk; no long-path support in v1.
26. **Accessibility:** keyboard-reachable tree, tabs, menus with ARIA roles; respect `prefers-reduced-motion`; high contrast via `forced-colors` / `prefers-contrast: more` on core tokens; no separate high-contrast theme.
27. **Telemetry:** none in v1. The updater check is the only network call; say so on the website's privacy section.
28. **Session restore per window:** last folder, tabs, active tab, pane layout, expanded directories, per-tab cursor/scroll; lone-file windows restore only if the file still exists.
29. **Also:** register `.md`/`.markdown`/`.txt` file associations with an optional "Set as default app" offer on first run; "New File" creates `Untitled.md` in inline-rename mode and auto-appends `.md`; window title `filename — foldername` with the macOS proxy icon / dirty dot via Tauri's `set_document_edited` / `set_represented_file`; validate that folder-level settings never set the image folder to an absolute path outside the folder; bundle a sample `welcome.md` opened on first run as a cheat sheet.

[Return to Top](#mikedown-desktop--planning-document)

---

## Worker rules

Apply to every milestone below.

- Read `~/git/mikedown/CLAUDE.md` before starting. Read `core-extraction-decisions.md` sections 5 and 6 before touching anything host- or settings-related.
- Complete **every** checkbox in your milestone. If an item should be dropped or deferred, say so in your summary for the orchestrator to decide, but attempt it unless truly blocked.
- **Never mutate `editor.view.dom` outside a ProseMirror transaction** (commit `f5415e0`). The desktop app should never need to touch anything inside `.mikedown-root`.
- **Never fork editor behavior.** Missing editor capability goes into `packages/core` as a feature flag or host method, with a test in `packages/core/test/`, and the VS Code extension must keep passing (`npm run compile`, `npm run test:unit`, `npm run test:edge`).
- Tauri commands are the only path to disk. No `fs` plugin calls scattered through UI modules; route through `documents/` and a small typed `invoke` wrapper.
- Every Tauri capability (`src-tauri/capabilities/*.json`) is the minimum the feature needs; scope `fs` to the opened folder, app-data and user-picked paths.
- Commits: no feature branches (work on `main`), no AI attribution, one commit per logical step. Do not push.
- When done: commit, write `.orchestrator/desktop-app-plan/worker-summary-<milestone-slug>.md` (what changed, what was skipped and why, files touched, follow-ups), update the tracker row and Progress Log in this document, then prompt the user to clear the context.

[Return to Top](#mikedown-desktop--planning-document)

---

## M0 — Tauri scaffold and WebKit smoke test

**Recommended model:** Opus. Toolchain setup plus the one experiment that decides whether Tauri is viable.

**Goal:** `packages/desktop` exists, `npm run dev -w packages/desktop` opens a Tauri window with a core editor mounted from source, and core's behavior is verified in WKWebView (macOS) and WebView2 (Windows, on BEAST or DevBox1).

**Tasks**

- [x] Verify or install the Rust toolchain (`rustup`, stable) on the Mac; record versions. Confirm `cargo tauri --version` works via `@tauri-apps/cli` 2.x. Note the Windows prerequisites (Rust, WebView2 runtime, Visual Studio Build Tools) in `packages/desktop/README.md` for BEAST.
- [x] `npm create tauri-app` equivalent by hand inside `packages/desktop` (vanilla TypeScript + Vite template, no framework). `package.json` name `@mikedown/desktop`, `"private": true`, scripts `dev`, `build`, `tauri`, `test:unit`, `test:e2e`. Add it to the root workspace (already globbed by `packages/*`); add root scripts `dev:desktop`, `build:desktop`.
- [x] `vite.config.ts`: in dev, alias `@mikedown/core` → `../core/src` (the same source-consumption rule as `webpack.config.js`) and `@mikedown/core/shared` → `../core/src/shared`; in release builds resolve the pinned dependency. Keep `mainFields: ['module', 'browser', 'main']`. Serve `dictionaries/` from core's `dist/dictionaries` (or `src` equivalent) for `spellcheckDictionaryUrl`.
- [x] `index.html` + `src/main.ts`: load `@mikedown/core/styles.css` and `tokens.css`, mount `createMikeDownEditor` with `NoopHost`, `theme: 'auto'`, `features: { sidebar: false, supportCard: false }`, `hostOwnsShortcuts: true`, `initialMarkdown` from a fixture that exercises tables, task lists, callouts, math, mermaid, code blocks, footnotes, highlight, images.
- [x] `tauri.conf.json`: product name "MikeDown", identifier `com.interappdev.mikedown` (open question; easy to change), window 1200×800 min 640×480, `title` "MikeDown". Register plugins `fs`, `dialog`, `shell`, `window`, `menu` (core), `trash`, `updater`, `single-instance`, `window-state` in `Cargo.toml` and `lib.rs`; capabilities file granting only what M0 needs (window read).
- [x] **WebKit smoke test (macOS):** round-trip the fixture through `setMarkdown`/`getMarkdown` and compare to the VS Code bundle's output (`npx vitest run test/unit/roundtrip.test.ts` is the reference); type, bold, insert a table, `/date`, open Settings, toggle source mode via `handle.command('toggleSource')`, paste plain text, Cmd+wheel zoom, dark mode by flipping the OS appearance. Record every WebKit-specific difference (focus/selection, `contenteditable` quirks, scrollbars, IME, clipboard API) in `packages/desktop/docs/webview-notes.md`.
- [ ] **WebView2 smoke test (Windows):** *(automated harness passed on BEAST, byte-identical round-trip; RDP GUI checklist in `webview-notes.md` still pending)* same pass on BEAST or DevBox1 (see `~/git/claude-shared-settings/estate-facts.yaml` for SSH; the GUI pass needs a console/RDP session). Record differences.
- [x] Measure the release bundle: `npm run tauri build` on the Mac, record `.app`/`.dmg` size (target ≤ 15 MB before resources) and cold-start time.
- [x] Decision gate: if any WebKit/WebView2 difference breaks core (not cosmetic), write the fix in `packages/core` with a jsdom test and re-run the VS Code suites; if a blocker cannot be fixed in core, stop and report before M2.
- [x] `packages/desktop/README.md`: prerequisites, dev loop, how the alias works, how the smoke fixture is used. Commit.

**Acceptance criteria**

- `npm run dev -w packages/desktop` opens a window with the editor; `npm run tauri build` produces a signed-later-able `.app` on macOS.
- `webview-notes.md` lists results for both webviews with zero unresolved functional breaks.
- VS Code suites unchanged (`test:unit`, `test:edge`, `compile`).

[Return to Top](#mikedown-desktop--planning-document)

---

## M1 — imagePaste helpers into core shared

**Recommended model:** Sonnet. Mechanical move with a platform-neutrality twist.

**Goal:** the pure image-paste helpers live in `packages/core/src/shared/imagePaste.ts`, the VS Code extension imports them from `@mikedown/core/shared/imagePaste`, and `test/unit/imagePaste.test.ts` passes unchanged in behavior.

**Tasks**

- [x] `git mv src/imagePaste.ts packages/core/src/shared/imagePaste.ts`. Remove the Node `crypto` and `path` imports: accept a small `PathOps` parameter (`join`, `dirname`, `basename`, `relative`, `isAbsolute`, `sep`, `normalize`) and a `hash(bytes) => string` function where needed, or add `packages/core/src/shared/pathPosix.ts` with a pure POSIX/Windows-aware implementation. The extension passes Node `path` and `crypto`; the desktop app passes a Tauri-side or `@tauri-apps/api/path` equivalent plus `crypto.subtle` SHA-256.
- [x] Move the `ImagePasteSettings` type out of `src/settings.ts` into the shared module (or a `shared/imagePasteSettings.ts`), keep `src/settings.ts` re-exporting it so no other extension file changes.
- [x] Update imports in `src/markdownEditorProvider.ts` and anything else that imported `./imagePaste` (grep `from './imagePaste'`); use `@mikedown/core/shared/imagePaste` (alias already exists in `tsconfig.json`, `webpack.config.js`, `vitest.config.ts`).
- [x] Keep `test/unit/imagePaste.test.ts` at its path (host-side test) with only the import path and the injected `path`/hash arguments changed; add `packages/core/test/imagePasteShared.test.ts` covering the pure helpers with a POSIX and a Windows `PathOps` fixture.
- [x] Ensure `packages/core/src/index.ts` does **not** export the helpers from the main entry (keep them under `shared/`); add the `./shared/*` subpath to `packages/core/package.json` `exports` if a published consumer should reach them (the desktop app does at release time), building them with tsup as additional entries.
- [x] `npm run compile`, `npm run lint`, `npm run test:unit`, `npm run test:edge`, `npm run test:core-package` green. Commit.

**Acceptance criteria**

- `grep -rn "from './imagePaste'" src/` returns nothing; `src/imagePaste.ts` no longer exists.
- `test/unit/imagePaste.test.ts` passes with the same assertions.
- `packages/core/src/shared/imagePaste.ts` has no `import * as path`/`crypto` Node imports.

[Return to Top](#mikedown-desktop--planning-document)

---

## M2 — Tauri host adapter and lone-file window

**Recommended model:** Opus. The architectural center of the desktop app.

**Goal:** `TauriHost implements MikeDownHost` exists; one window can open, edit and save a single markdown file with a dirty indicator; double-clicking a `.md` opens the app on that file.

**Tasks**

- [x] `src-tauri/src/commands/fs.rs`: `read_text(path) → { text, encoding: 'utf8'|'utf8-bom'|'unknown', eol: 'lf'|'crlf', mtimeMs, readOnly }`, `write_text(path, text, { eol, bom })` as an atomic temp-file-and-rename write that preserves the original mode, `stat(path)`, `exists(path)`. Non-UTF-8 → `encoding: 'unknown'` with the raw bytes decoded lossily for display (edge 11).
- [x] `src/host/tauriHost.ts`: `class TauriHost implements MikeDownHost` taking a `DocumentModel` (M4 fleshes it out; M2 ships a minimal one with `path`, `text`, `dirty`, `eol`, `bom`, `encoding`). Implement `onChange` (update model text and dirty from `pristine`), `onStats` (status footer), `openLink` (edge 13: http(s) → `shell.open`; relative `.md` → open in the window; anchors → `handle.scrollToAnchor`), `saveSettings` (M5 wires persistence; M2 keeps in memory), `uploadImage`/`pickImage`/`resizeImage` through `src/host/imagePipeline.ts` using the M1 shared helpers and the mirrored image-paste settings (folder, `folderRelativeTo`, `filenamePattern`, `pathStyle`, `altText`, `maxSizeMB`), `resolveImageSrc` (relative path → `convertFileSrc` asset URL), `exportHtml`/`printDocument` placeholders that M9 fills (leave absent until then so the buttons stay hidden). Leave `getTags`, `getLinkSuggestions`, `resolveWikilinks`, `getDiffBaseline` absent until M3/M6.
- [x] Edge 14: `uploadImage` on an unsaved (`Untitled`) document shows the "Save the document first so the image has a home" dialog with Save As; cancel rejects so the paste is dropped.
- [x] Save: `CmdOrCtrl+S` → `write_text` with the model's `eol`/`bom`, then `handle.markSaved()` and clear dirty. Save As via `dialog.save` with `.md` default. Edge 10: `readOnly` files show a lock badge and `CmdOrCtrl+S` offers Save As with the reason.
- [x] Window title `filename — foldername` (edge 29; lone file: `filename — parent folder name`); `getCurrentWindow().setTitle`, `setDocumentEdited(dirty)` and `setRepresentedFile` on macOS (Tauri `Window::set_document_edited`, `set_represented_file`; no-op elsewhere).
- [x] Lone-file layout (edge 4): full window, sidebar collapsed, toolbar/menu item **Open Containing Folder** stub (M3 implements the folder reopen).
- [x] File associations (edge 29): `tauri.conf.json` `bundle.fileAssociations` for `md`, `markdown`, `txt` (`.txt` is an open question; include it, easy to drop). Handle launch args and the macOS `open-file` event (`tauri-plugin-single-instance` + `RunEvent::Opened`) so a double-clicked file opens a lone-file window; edge 6 window-routing lands in M4 with multi-window.
- [x] Non-markdown handling (edge: text in source mode, images in viewer, else OS default): `.txt`/`.json`/`.yaml`/… open with `features.sourceMode` forced on and `handle.command('toggleSource')`; images open in a minimal `ui/imageViewer.ts`; other extensions call `shell.open`.
- [x] Spell check default ON (edge 22): `settings.spellCheckEnabled: true`, `spellcheckDictionaryUrl` pointing at the bundled dictionaries, `spellcheck="false"` on the app root element.
- [x] Capabilities: `fs` scoped to `$HOME/**`, `$APPDATA/**` and dialog-picked paths; `dialog`, `shell:allow-open`, `window` title/edited permissions.
- [x] Commit.

**Acceptance criteria**

- `open -a MikeDown test/workspace/some.md` (or `tauri dev -- path`) opens the file; editing shows a dirty dot in the tab and title; `CmdOrCtrl+S` writes bytes identical to the VS Code extension's output for the same edit, preserving CRLF/BOM when present.
- Pasting an image into a saved file writes it next to the document per the default pattern and inserts a relative link; into `Untitled` prompts for Save As.
- `grep -rn "@tiptap\|prosemirror\|@codemirror" packages/desktop/src` returns nothing.

[Return to Top](#mikedown-desktop--planning-document)

---

## T1 — Host and single-file tests

**Recommended model:** Sonnet.

**Modes:** vitest unit (jsdom) for `tauriHost.ts`, `imagePipeline.ts`, `documentModel.ts` with a mocked `invoke`; one e2e run; hands-on on both OSes.

**Automated**

- [ ] `packages/desktop/test/tauriHost.test.ts`: each host method issues the expected `invoke` call and arguments (snapshot); `onChange` with `pristine: true` clears dirty; `uploadImage` on an unsaved model rejects after the dialog mock returns cancel; `resolveImageSrc` maps relative paths to asset URLs and passes `http(s)`/`data:` through untouched.
- [ ] `packages/desktop/test/encoding.test.ts`: CRLF, BOM and non-UTF-8 fixtures round-trip through the model to the exact bytes `write_text` would receive (test the TS side; add Rust unit tests in `fs.rs` for the detection functions).
- [ ] E2E harness: pick `tauri-driver` (WebDriver) if it runs on the Mac in CI-less mode, otherwise Playwright against `vite dev` with a mocked `window.__TAURI_INTERNALS__`; document the choice in `packages/desktop/test/e2e/README.md`. One spec: launch, open fixture, type, save, reload, content persisted.
- [ ] Root `npm run test:unit` still green; add `test:desktop` to the root scripts.

**Hands-on (user, about 10 minutes per OS)**

Start: `npm run dev:desktop` on the Mac; the Windows build from BEAST per `packages/desktop/README.md`.

- [ ] Double-click a `.md` in Finder/Explorer: the app opens on it. Type, bold, table, image paste, Cmd+/ source toggle, save, close, reopen: content intact, not dirty. Check dark mode by flipping the OS appearance. Orchestrator pauses for sign-off.

[Return to Top](#mikedown-desktop--planning-document)

---

## M3 — Folder sidebar and file tree

**Recommended model:** Opus. UI design plus watcher and drag-drop semantics.

**Goal:** opening a folder shows a lazy-loading tree with create/rename/delete/move, a watcher, drag-drop, Trash deletion, and the knowledge-base host methods (link suggestions, wikilinks) backed by a folder `.md` index.

**Tasks**

- [ ] `src-tauri/src/commands/fs.rs`: `list_dir(path, { showHidden })` returning sorted entries (folders first, natural sort) with dotfolders and `node_modules` excluded unless `showHidden`; `rename(from, to)` with the two-step temp rename for case-only changes (edge 25); `create_file`, `create_dir`, `move_path`, `copy_path`; `trash(path)` via `tauri-plugin-trash` (edge 21); Windows reserved-name and >260-char validation returning a plain-language error before touching disk (edge 25).
- [ ] `src-tauri/src/commands/watcher.rs`: `watch(dir)`/`unwatch(dir)` per expanded directory using `notify`; emit `fs-changed` events `{ kind, path }`; fall back to polling every 2 s when native events error (network drives, edge 10).
- [ ] `src/tree/`: lazy per-directory loading on expand, keyboard navigation (arrows, Enter, F2/Enter-to-rename, Delete, type-ahead), ARIA `tree`/`treeitem` roles (edge 26), context menu (New File, New Folder, Rename, Delete, Reveal in Finder/Explorer, Copy Path, Open Containing Folder for lone files), inline rename, "New File" creates `Untitled.md` in inline-rename mode and auto-appends `.md` (edge 29), "show hidden" toggle in the sidebar header.
- [ ] Drag-drop (edge 20): within the tree moves; from outside the app copies; Option/Alt inverts. Drops onto the editor: image → `imagePipeline.uploadImage` from file bytes; `.md` → relative link at the cursor; other text → new tab; anything else → toast.
- [ ] Delete confirmation with "Don't ask again" (persisted as a desktop setting, M5 wires the storage; use in-memory until then). Rename/move/delete also move or delete `.mikedown/versions/<rel path>/` when it exists (edge 3; M6 creates it).
- [ ] Open Containing Folder (edge 4) and Open Folder (edge 5): replace the window's folder, prompting for dirty tabs, keeping the active file open when it lives inside the new folder.
- [ ] Folder `.md` index (`src/tree/mdIndex.ts`): list of markdown files with headings, refreshed by the watcher. Implement `host.getLinkSuggestions`, `getFileHeadings`, `resolveWikilinks` (name-based, nearest match, `count` for ambiguity), `createWikilink` (creates the file next to the current one), `checkLinks` (edge 13 broken-link detection; "Create file" offer in the UI). Lone-file windows leave these absent.
- [ ] Sidebar layout: resizable, collapsible (`CmdOrCtrl+B`), remembers width; styled with `--mikedown-*` tokens so it follows light/dark.
- [ ] Commit.

**Acceptance criteria**

- A 10,000-file folder opens in under a second (only the root directory is read); expanding a directory loads its children; a file created in Finder/Explorer appears within 2 s.
- Case-only rename works on macOS APFS and Windows NTFS; deleting a file lands in the Trash/Recycle Bin.
- `[[Note Name]]` resolves to the matching file and Cmd/Ctrl+click opens it.

[Return to Top](#mikedown-desktop--planning-document)

---

## M4 — Tabs, panes, document model, hot exit

**Recommended model:** Opus. Core state architecture for the whole app.

**Goal:** tabs and split panes over a shared document model; dirty state, quit handling, hot-exit backups, multi-window routing and session restore.

**Tasks**

- [ ] `src/documents/documentModel.ts` (edge 9): `DocumentModel { path, text, dirty, eol, bom, encoding, mtimeMs, readOnly, savedText }` with a registry keyed by path per window; `attach(handle)` for each pane's editor so edits in one pane propagate via `setMarkdown` to the others without an `onChange` echo; `save()`, `reload()`, `markExternalChange()`.
- [ ] `src/panes/`: tab strip per pane (open, close, close others, close saved, reorder by drag, middle-click close, `CmdOrCtrl+W`, `CmdOrCtrl+Tab`/`Ctrl+PageUp/Down`), split right / split down (`CmdOrCtrl+\`), focus follows click, pane close when its last tab closes; ARIA `tablist`/`tab` (edge 26). Tabs show a dirty dot, lock badge (edge 10) and "still downloading" state with Retry (edge 10 cloud placeholders: 10 s timeout on `read_text`).
- [ ] Large files (edge 12): >2 MB opens in source mode with an info bar "Open as rich text anyway"; >20 MB refuses with "Open in default app".
- [ ] Hot-exit backups (edge 7–8): `src/documents/backups.ts` writes each dirty buffer ~1 s debounced to `<app-data>/backups/<sha256-of-path>.md` plus `index.json` (`{ path, folder, savedAt }`); cleared on save and on tab close; on launch, leftovers restore into dirty tabs silently. Quit with dirty files shows one dialog listing them: Save All / Don't Save / Cancel (`window.onCloseRequested` and the app `ExitRequested` event).
- [ ] Multi-window (edge 5–6): `tauri-plugin-single-instance` forwards second-launch args to the running app; a double-clicked file inside an open window's folder focuses that window and opens a tab, otherwise opens a lone-file window. **New Window** (`CmdOrCtrl+Shift+N`) opens an empty window. Cross-window edits of the same file are treated as external changes (M6 handles the UI; M4 marks `mtimeMs` on save and compares on focus).
- [ ] Session restore (edge 28): `<app-data>/sessions/<window-id>.json` with folder, tabs, active tab, pane layout, expanded directories, per-tab cursor/scroll (via `handle` events and CodeMirror state for source mode). Restored on launch; lone-file windows only if the file still exists.
- [ ] Commit.

**Acceptance criteria**

- The same file open in two panes shows edits in both; the dirty dot appears on both tabs and in the window title.
- Kill the app (`kill -9`) with three dirty files; relaunch restores all three dirty with their edits.
- Quit with dirty files shows exactly one dialog; Cancel keeps the app open.

[Return to Top](#mikedown-desktop--planning-document)

---

## T2 — Workspace tests

**Recommended model:** Sonnet.

**Automated**

- [ ] `packages/desktop/test/documentModel.test.ts`: two attached handles stay in sync without echo loops; dirty flips on edit and clears on save; `pristine: true` after undo clears dirty.
- [ ] `packages/desktop/test/backups.test.ts`: debounce coalesces writes; save clears the backup; `index.json` lists exactly the dirty set; restore maps hashes back to paths.
- [ ] `packages/desktop/test/tree.test.ts`: natural sort, hidden exclusions, lazy expansion requests one `list_dir` per expand, rename validation errors for `CON.md` and a 270-char path.
- [ ] Rust tests in `fs.rs` / `watcher.rs`: case-only rename on a temp dir, polling fallback path.
- [ ] E2E: open folder fixture, create file, rename, delete (Trash mocked), split pane, close, session restores.

**Hands-on (user, about 10 minutes per OS)**

- [ ] Open a notes folder, create a file, rename it, drag it into a subfolder, delete it (check the Trash), open two panes on the same file, force-quit, relaunch. Orchestrator pauses for sign-off.

[Return to Top](#mikedown-desktop--planning-document)

---

## M5 — Settings: global, folder override, App tab

**Recommended model:** Sonnet. Clear spec; reuses core's modal.

**Goal:** settings persist globally with an optional per-folder override, the core modal gains an App tab, and the theme follows the OS.

**Tasks**

- [ ] `src/settings/store.ts`: read global `<app-data>/settings.json` (macOS `~/Library/Application Support/MikeDown/settings.json`, Windows `%APPDATA%\MikeDown\settings.json`, via `@tauri-apps/api/path.appDataDir`) and optional `<folder>/.mikedown/settings.json`; merge is shallow per top-level key, folder wins. Schema: core keys (`MikeDownSettings`) plus desktop keys `versioning.enabled`, `versioning.keep` (25), `versioning.maxSizeMB` (2), `updates.checkOnLaunch` (true), `imagePaste.folder/.folderRelativeTo/.filenamePattern/.pathStyle/.altText/.maxSizeMB`, `tree.showHidden`, `confirmDelete`, `fileAssociationsOffered`.
- [ ] Corrupt JSON (edge 16): fall back to defaults for that file; show a non-modal banner with "Open file" (`shell.open`) and "Reset to defaults" (writes a fresh file only on click); never overwrite automatically.
- [ ] Folder override validation (edge 29): reject `imagePaste.folder` values that resolve to an absolute path outside the folder; show the reason in the banner.
- [ ] `host.saveSettings(patch, { silent })`: write to the global file, or to `.mikedown/settings.json` when the modal's **"Save for this folder"** toggle is on (creating `.mikedown/` only then); push the merged result to every editor via `handle.updateSettings` and to the app chrome.
- [ ] App tab via `extraSettingsSections` (`MikeDownSettingsSection` with `tab: 'app'`, `tabLabel: 'App'`): versions to keep, versioning max size, check for updates on launch, image paste folder/pattern/alt text/path style (reusing the VS Code wording), show hidden files, confirm before delete, "Set MikeDown as default for .md" button, the "Save for this folder" toggle (disabled in lone-file windows), About (version, "Check for Updates…"). Use `ctx.makeRow`/`makeCheckboxRow` so it matches core's styling.
- [ ] Theme (decision): `theme: 'auto'`; remove any manual theme toggle from the toolbar by leaving `host.toggleTheme` absent; verify the app chrome recolors with `prefers-color-scheme`.
- [ ] Settings changes in one window apply to all windows (emit a Tauri event; each window re-reads and calls `updateSettings`).
- [ ] Commit.

**Acceptance criteria**

- Change the body font in the modal: persisted in the global file, visible after relaunch, applied in every open window.
- Toggle "Save for this folder" and set `versioning.keep` to 10: `.mikedown/settings.json` is created with only that key; opening another folder shows 25 again.
- Hand-corrupt `settings.json`: the app launches with defaults and the banner; the file is untouched.

[Return to Top](#mikedown-desktop--planning-document)

---

## M6 — Versioning, diff view, external changes

**Recommended model:** Opus. Diff UI design plus conflict semantics.

**Goal:** every explicit save snapshots into `.mikedown/versions/`; a version browser with a diff viewer; external-change handling with Compare / Overwrite / Revert.

**Tasks**

- [ ] `src/documents/versioning.ts` + Rust `commands/versions.rs` (edge 1): on save, when `versioning.enabled` and the file is inside an opened folder and ≤ `versioning.maxSizeMB`, write `.mikedown/versions/<relative/path/to/file.md>/<YYYYMMDDTHHMMSSZ>.md` unless byte-identical to the newest snapshot; prune to `versioning.keep`. `.mikedown/` is created on the first snapshot only (decision). Lone-file windows never snapshot.
- [ ] Version browser (`src/ui/versions.ts`): sidebar section or panel listing snapshots for the active file (relative time via core's `relativeTime` helper if exported, else local), select two to diff or one against the current buffer; **Restore** replaces the buffer and marks the tab dirty, never writing to disk (edge 2).
- [ ] Diff viewer (`src/ui/diffView.ts`): side-by-side and inline modes over plain markdown text (use `diff` or `diff-match-patch` from npm; no editor instance); word-level highlights; read-only; styled with core tokens.
- [ ] External changes (decision + edge 9): the watcher's `fs-changed` for an open path compares `mtimeMs`; clean model → silent reload (`setMarkdown` with `pristine: true`, preserving cursor where possible); dirty model → keep edits, mark `externallyChanged`, and on save show "changed on disk" with Compare (the diff viewer: disk vs. buffer) / Overwrite / Revert. Same path handles cross-window saves.
- [ ] `host.getDiffBaseline` (optional): return the newest snapshot as `headContent` so core's change highlighting works when versioning is on.
- [ ] Tree integration (edge 3): rename/move/delete of a file applies to its versions folder (M3 wired the hook; implement it here).
- [ ] Commit.

**Acceptance criteria**

- Save three times with changes, once without: exactly three snapshots exist; the folder names sort chronologically.
- Edit the file in another editor while dirty: saving shows the dialog; Compare shows the disk version against the buffer; Revert reloads; Overwrite writes and snapshots.
- A 3 MB file saves without creating a snapshot and without any message.

[Return to Top](#mikedown-desktop--planning-document)

---

## M7 — Folder search

**Recommended model:** Sonnet. Rust walker plus a results panel.

**Goal:** `CmdOrCtrl+Shift+F` searches markdown and text files in the opened folder with results grouped by file.

**Tasks**

- [ ] Rust `commands/search.rs` (edge 19): streaming search over `*.md`, `*.markdown`, `*.txt` (plus the text extensions M2 opens in source mode), honoring the tree's hidden/`node_modules` exclusions and `tree.showHidden`; options `caseSensitive`, `wholeWord`; emits batches of `{ path, line, column, snippet, matchStart, matchEnd }`; cancellable; skips files >2 MB; uses `ignore` or `walkdir` + a plain substring/`memchr` matcher (no regex exposed).
- [ ] `src/search/`: panel in the sidebar with query input, case/whole-word toggles, result groups per file (collapsible, counts), highlighted snippets; click opens the file in the active pane and scrolls to the match (`handle.scrollToAnchor` is for headings; add a core `revealText(line, column)` or use `revealLink` if sufficient; if a core addition is needed, add it to `packages/core` with a test). Keyboard: Enter opens, arrows move, Esc closes; ARIA list roles (edge 26).
- [ ] Debounce typing 250 ms, cancel in-flight searches, cap at 2,000 results with a "refine your search" note.
- [ ] Commit.

**Acceptance criteria**

- Searching a 2,000-file folder returns first results under 300 ms and completes under 2 s on the Mac.
- Hidden folders and `node_modules` are excluded unless "show hidden" is on; whole-word excludes partial matches.
- Clicking a result opens the file and places the match in view.

[Return to Top](#mikedown-desktop--planning-document)

---

## M8 — Welcome, recents, menus, window title

**Recommended model:** Opus. First-run UX and native menu design.

**Goal:** a welcome screen with recents and `welcome.md`, a complete native menu bar with `CmdOrCtrl` shortcuts, and finished window-title behavior.

**Tasks**

- [ ] Welcome screen (`src/ui/welcome.ts`, edge 18): shown in a window with no folder and no file; Open Folder, Open File, New File, recent folders and recent files (two lists, greyed when missing with a remove "×", pruned after missing on three launches), a one-paragraph hint. Recents stored at `<app-data>/recents.json`.
- [ ] First run (edge 29): open bundled `src-tauri/resources/welcome.md` (cheat sheet: formatting, slash commands, tables, callouts, images, wikilinks, shortcuts) as a lone file; offer "Set MikeDown as default app for .md" once (`fileAssociationsOffered` setting). On macOS this opens the Finder "Open With → Change All…" instructions; on Windows it opens Settings → Default apps via `ms-settings:defaultapps`.
- [ ] Native menus (edge 23): `src/menu/shortcuts.ts` is the single table of `{ id, label, accelerator: 'CmdOrCtrl+…', when }`; build the Tauri `Menu` from it and bind the same table for in-page handling. Menus: App (macOS: About, Preferences `CmdOrCtrl+,`, Quit) / File (New File, New Window, Open File…, Open Folder…, Open Recent ▸, Save, Save As…, Open Containing Folder, Reveal in Finder/Explorer, Export ▸ (M9), Close Tab, Close Window) / Edit (Undo, Redo, Cut, Copy, Paste, Paste Without Formatting, Find, Find in Folder, Select All, Spelling ▸) / Format (Bold, Italic, Strikethrough, Highlight, Code, lists, task list, headings, Insert ▸ table/link/image/emoji) / View (Toggle Sidebar, Toggle Source Mode `CmdOrCtrl+/`, Split Right, Split Down, Zoom In/Out/Reset, Show Hidden Files) / Window (standard) / Help (welcome.md, Keyboard Shortcuts, Check for Updates…, Website, Report an Issue). Windows: Preferences under File, Exit `Alt+F4`, Help menu holds About.
- [ ] Editor commands route via `handle.command(name)` using the `MikeDownCommand` names; menu items are enabled/disabled by focus and dirty state (`when` clauses).
- [ ] Window title (edge 29): `filename — foldername`, `Untitled — foldername`, `MikeDown` for the welcome window; dirty via `setDocumentEdited`; macOS proxy icon via `setRepresentedFile`.
- [ ] Commit.

**Acceptance criteria**

- Fresh install: first launch shows `welcome.md` and the default-app offer once; second launch shows the welcome screen with one recent file.
- Every menu item with an accelerator works from the keyboard on both OSes; `CmdOrCtrl+,` opens Settings.
- Removing a recent entry and relaunching keeps it removed.

[Return to Top](#mikedown-desktop--planning-document)

---

## M9 — Export HTML and PDF/print

**Recommended model:** Sonnet.

**Goal:** File → Export → HTML… and PDF… plus Print, reusing core's rendered HTML.

**Tasks**

- [ ] Implement `host.exportHtml(html)` and `host.printDocument(html)` on `TauriHost` (adding them makes core show its toolbar entries; verify this is wanted or hide via the toolbar config if core offers it).
- [ ] HTML export (edge 24): wrap `handle.getHtml()` in a standalone document with core's `styles.css`/`tokens.css` inlined (reuse the approach in `src/export.ts` of the VS Code extension where it is pure; copy, do not import Node code), images inlined as `data:` URIs **only for export** or copied alongside (user choice in the save dialog's sidecar option; default inline), title from the first H1 or filename; `dialog.save` with `.html`.
- [ ] PDF / Print: open the HTML in a hidden `WebviewWindow`, call `window.print()` (WKWebView and WebView2 both show the OS print dialog with Save as PDF); fall back to a visible print preview window if hidden printing is blocked. Document the per-webview behavior in `webview-notes.md`.
- [ ] Menu entries (M8 table) and `CmdOrCtrl+P` for Print.
- [ ] Commit.

**Acceptance criteria**

- Exported HTML opens in a browser offline with images, math, mermaid (pre-rendered SVG), callouts and code highlighting intact.
- Print produces a PDF via the OS dialog on both OSes; page breaks do not split code blocks mid-line unreasonably (basic `break-inside: avoid`).

[Return to Top](#mikedown-desktop--planning-document)

---

## T3 — Feature tests

**Recommended model:** Sonnet.

**Automated**

- [ ] `settings.test.ts`: merge precedence, corrupt-file fallback without writes, folder-override image-folder validation, "Save for this folder" routing.
- [ ] `versioning.test.ts`: timestamp naming sorts chronologically, identical-content skip, pruning to N, >2 MB skip, rename moves the versions folder.
- [ ] `search.test.ts` (Rust + TS): exclusions, case/whole-word, cancellation, result cap.
- [ ] `export.test.ts`: standalone HTML contains inlined CSS and no `--vscode-` strings; title derivation.
- [ ] E2E: settings change persists across relaunch; save twice and open the diff; search and click a result; export HTML to a temp dir.

**Hands-on (user, about 15 minutes per OS)**

- [ ] Walk the welcome screen, menus and shortcuts, settings App tab, versioning restore, external edit conflict, folder search, HTML export and print-to-PDF. Orchestrator pauses for sign-off.

[Return to Top](#mikedown-desktop--planning-document)

---

## M10 — Updater, signing, build pipeline, download page

**Recommended model:** Opus. Release engineering across two machines; mistakes here reach customers.

**Goal:** signed, notarized macOS `.dmg` and signed Windows `.msi` (or NSIS `.exe`), both self-updating from a manifest on Mike's website, built by scripts modeled on `~/git/lymescribe/deploy/`.

**Reference pipeline (LymeScribe, verified 2026-10-23):** `deploy/build-mac-dmg.sh` runs a universal Release build, signs helpers then the app with a **Developer ID Application** identity and hardened runtime, `xcrun notarytool submit --wait` + `stapler staple` on the app, builds the DMG, signs it, notarizes and staples it again; credentials come from a notarytool keychain profile (`xcrun notarytool store-credentials <profile> --apple-id … --team-id UU626VCLYW --password <app-specific>`). Windows MSIs are signed by `deploy/sign-artifact.ps1` through **Azure Trusted Signing** (`Azure.CodeSigning.Dlib.dll` + `sign-metadata.json` with `Endpoint`, `CodeSigningAccountName`, `CertificateProfileName`; env vars `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `*_SIGN_DLIB`, `*_SIGN_METADATA`). The Windows build runs **remotely on BEAST** via `deploy/remote-build-msi.sh`: it checks out an exact commit, triggers a pre-registered Windows Scheduled Task (signing needs a real password logon for DPAPI; SSH key sessions fail with `NTE_PERM`, see estate-facts `beast-signing-ssh-token-blocks-cng`), polls for a sentinel, verifies the artifact is signed, and copies it back. Manifests (`latest.json`, `appcast.xml`) and artifacts are uploaded to `iadev.net/<product>/` (IIS on `iadev-prod`, Cloudflare-fronted with a ~4 h edge cache that must be purged for manifest URLs). See `~/git/lymescribe/docs/deployment.md` and `ci-cd.md`.

**Tasks**

- [ ] Updater (edge 17): `tauri-plugin-updater` with a generated minisign keypair (`tauri signer generate`; private key in the Mac Keychain or a password-protected file, never in git); `tauri.conf.json` `plugins.updater.endpoints` → `https://<host>/mikedown/latest.json` (host is an open question; default `iadev.net/mikedown/`), `pubkey`, `windows.installMode: "passive"`. Silent check on launch (if `updates.checkOnLaunch`) and every 24 h; all errors logged to `<app-data>/logs/updater.log` and swallowed; "Update available" toast with Restart Now / Later; Help → "Check for Updates…" shows explicit "up to date" / "update available" / "could not check" feedback. Stable channel only.
- [ ] macOS build: `packages/desktop/deploy/build-mac.sh` modeled on `build-mac-dmg.sh`: `npm run tauri build --target universal-apple-darwin` (or arm64 + x86_64 separately), Tauri's `bundle.macOS.signingIdentity` set to the Developer ID Application identity, `hardenedRuntime: true`, entitlements file, notarization via `APPLE_API_KEY`/`APPLE_ID` env or a keychain profile (Tauri CLI notarizes when the env vars are present; verify and staple), DMG output, `--skip-notarize` flag for local dry runs. Record the identity lookup and the one-time `store-credentials` step in `packages/desktop/deploy/README.md`.
- [ ] Windows build: `packages/desktop/deploy/build-windows.ps1` (runs on BEAST): Rust + WebView2 bootstrapper (`webviewInstallMode: downloadBootstrapper`), `npm run tauri build` producing the MSI (WiX) and/or NSIS installer; sign via a copied `sign-artifact.ps1` (generalized env var names `MIKEDOWN_SIGN_DLIB`, `MIKEDOWN_SIGN_METADATA`, reusing the same Azure account/profile); Tauri's updater `.sig` generated for the signed artifact. `packages/desktop/deploy/remote-build-windows.sh` modeled on `remote-build-msi.sh`: exact commit, Scheduled Task trigger, sentinel poll, signature verification (`signtool verify /pa`), copy back. Register the `MikeDownRemoteBuild` task once by hand at BEAST's console (document the `schtasks` line).
- [ ] Release script `packages/desktop/deploy/release.sh`: version bump (`packages/desktop/package.json`, `tauri.conf.json`, `Cargo.toml` in sync via a `sync-version.js`), build Mac, trigger Windows, generate `latest.json` in Tauri's updater format (`version`, `notes`, `pub_date`, `platforms.{darwin-aarch64,darwin-x86_64,windows-x86_64}.{signature,url}`), stage everything into `packages/desktop/deploy/dist/`, print the upload checklist (upload via RDP to `iadev-prod` as LymeScribe does; purge Cloudflare for `latest.json`). Versioned artifact filenames only.
- [ ] Core pinning: at release the desktop `package.json` depends on the published `@mikedown/core` version (drop the Vite alias when `RELEASE=1`); fail the build if `packages/core/package.json` version and the pinned version differ.
- [ ] Download page: `website/mikedown-desktop/index.html` (or wherever `website/index.html` lives on the site) with Mac and Windows buttons that rewrite from `latest.json` at load (LymeScribe `site/index.html` pattern), minimum OS versions, release notes, and a privacy paragraph stating the updater check is the only network call (edge 27).
- [ ] Minimum OS versions (open question; default macOS 12+, Windows 10 1809+): set `bundle.macOS.minimumSystemVersion` and the NSIS/MSI launch conditions accordingly.
- [ ] Commit.

**Acceptance criteria**

- `spctl -a -vv MikeDown.app` passes and `stapler validate` succeeds; the DMG opens without Gatekeeper warnings on a clean Mac.
- The Windows installer shows the publisher name in UAC and SmartScreen does not block (signed via Trusted Signing).
- Install version N, publish N+1 to a staging URL, launch: toast appears, Restart Now installs and relaunches N+1 on both OSes.

[Return to Top](#mikedown-desktop--planning-document)

---

## M11 — Polish: a11y, encoding, filesystem oddities

**Recommended model:** Sonnet. Enumerated edge cases with clear acceptance.

**Goal:** the remaining edge-case behaviors are implemented and verified.

**Tasks**

- [ ] Accessibility (edge 26): audit tree, tabs, search results, welcome screen, dialogs and the diff viewer for ARIA roles, labels, focus order and visible focus rings; `prefers-reduced-motion` disables pane/tab animations; `forced-colors` and `prefers-contrast: more` media queries adjust the chrome's token overrides (and verify core's tokens respond). Run an axe pass through the e2e harness.
- [ ] Encoding (edge 11): non-UTF-8 files open read-only in source mode with a notice; BOM and CRLF preserved byte-for-byte (verify with `cmp` on fixtures); mixed line endings are written back as detected majority (document it).
- [ ] Large files (edge 12): verify the 2 MB / 20 MB thresholds end to end, including the "Open as rich text anyway" path and a source-mode-only tab's save.
- [ ] Filesystem (edge 25): Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`), trailing dots/spaces, >260-char total paths, invalid characters per OS: plain-language errors before any disk call; case-only rename verified on both OSes.
- [ ] Read-only and permissions (edge 10): lock badge, Save As flow with the OS error message in plain words; a folder without write permission disables New/Rename/Delete with a tooltip.
- [ ] Network drives and cloud placeholders (edge 10): polling fallback verified on an SMB share (the Storage share from `estate-facts.yaml`); iCloud Drive evicted file shows the downloading state and Retry; OneDrive Files On-Demand on Windows likewise.
- [ ] Drag-drop toasts (edge 20) and delete confirmation "Don't ask again" (edge 21) wired to persisted settings.
- [ ] Commit.

**Acceptance criteria**

- Keyboard-only session: open a folder, navigate the tree, open a file, split, search, switch tabs, open Settings, quit, all without a mouse; VoiceOver/Narrator announce tree items and tabs.
- Fixture set in `packages/desktop/test/fixtures/encoding/` round-trips byte-identical.
- Each reserved-name and long-path case shows the expected message and leaves disk untouched.

[Return to Top](#mikedown-desktop--planning-document)

---

## T4 — Release candidate hands-on

**Recommended model:** Sonnet (writes the checklist; the user runs it on signed builds).

**Modes:** hands-on on the signed RC artifacts from M10, one pass per OS, plus a fresh-machine install on each.

- [ ] Write `packages/desktop/docs/manual-test-checklist.md` covering: install from the DMG/installer on a clean account, first run (`welcome.md`, default-app offer), double-click open, lone file → Open Containing Folder, tree CRUD + Trash, tabs/panes, hot exit after force quit, settings global vs. folder, versioning + restore + diff, external change conflict, search, export HTML + print PDF, updater toast from a staging manifest, dark mode flip, reduced motion, keyboard-only pass, CRLF/BOM fixture, 3 MB and 25 MB files, reserved-name rename.
- [ ] Record results per OS in the Progress Log; every failure becomes a gap-fill. Orchestrator pauses for sign-off; release follows sign-off.

[Return to Top](#mikedown-desktop--planning-document)

---

## Open questions

For Mike to answer; defaults in parentheses apply until then.

1. Customizable keymap in v1? (default **no**; shortcuts fixed in `src/menu/shortcuts.ts`)
2. Versioning defaults: keep **25** per file, skip files over **2 MB**? (defaults as stated)
3. Website hosting location for the download page and the updater `latest.json` (default `iadev.net/mikedown/` on `iadev-prod`, Cloudflare-fronted, same as LymeScribe; alternative: the MikeDown `website/` host).
4. App name and bundle id: "MikeDown" and `com.interappdev.mikedown`? (default yes)
5. Should `.txt` be in the default file associations? (default yes, with `.md`/`.markdown`; easy to drop in `tauri.conf.json`)
6. Minimum OS versions: macOS 12+ and Windows 10 1809+ (WebView2 baseline)? (defaults as stated)

[Return to Top](#mikedown-desktop--planning-document)

---

## Parallel Development Recommendations

**Sequential blockers**

- **M0 → everything.** The WebKit/WebView2 smoke test decides whether Tauri is viable.
- **M1 → M2.** The host's image pipeline needs the shared helpers.
- **M2 → M3 → M4** is a strict chain (host, then tree, then the document model the tree opens into). One worker at a time in `packages/desktop/src` during this chain.
- **M4 → M5, M6, M7, M8, M9.** All need the document model and panes.
- **M10 → T4.** Release testing needs signed builds.

**Parallel groups**

| Group | Milestones | Condition |
|---|---|---|
| A | M0 and M1 | Different directories (`packages/desktop` vs. `packages/core/src/shared` + `src/`); M1 must keep the extension green |
| B | M5 (settings), M7 (search), M9 (export) | After M4; M5 owns `src/settings/`, M7 owns `src/search/` + `search.rs`, M9 owns `src/ui/export*` + host export methods |
| C | M6 (versioning) and M8 (welcome/menus) | After M5 (M6 reads versioning settings; M8 reads recents and the App tab's About); M6 owns `documents/versioning.ts` + `ui/diffView.ts`, M8 owns `ui/welcome.ts` + `menu/` |
| D | M10 (pipeline) and M11 (polish) | After T3; M10 owns `deploy/`, `src-tauri/tauri.conf.json`, `website/`; M11 owns UI modules and `fs.rs` validation |

**Orchestrator context management.** Dispatching several worker prompts fills the orchestrator context. When waiting on workers, prompt the user to run `/compact`; after compacting, resume from `.orchestrator/state.json`.

[Return to Top](#mikedown-desktop--planning-document)

---

## References

- **Core API and decisions:** `packages/core/src/{index,host,types,editor}.ts`; `core-extraction-decisions.md` (sections 5 and 6 for host methods and settings ownership); `angular-core-extraction-plan.md` (the extraction that made this app possible).
- **VS Code host as the model consumer:** `src/webview/editor-main.ts` (`VsCodeHost`), `src/markdownEditorProvider.ts` (image paste write path, external-change handling, export), `src/imagePaste.ts` (moves in M1), `src/export.ts`.
- **Signing and distribution (LymeScribe):** `~/git/lymescribe/deploy/{build-mac-dmg.sh,sign-artifact.ps1,sign-metadata.template.json,build-msi.ps1,remote-build-msi.sh,CHANNELS.md}` and `~/git/lymescribe/docs/{deployment,ci-cd,auto-updater,shipping,paddle-setup-runbook}.md`. BEAST signing constraint: `~/git/claude-shared-settings/estate-facts.yaml` id `beast-signing-ssh-token-blocks-cng`.
- **Previous attempt (ideas only, no code reuse):** `github.com/mikejoseph23/mikedown-apps` (Electron + React; local clone deleted). Its `docs/mikedown-desktop-planning.md`, `docs/signing.md` and `marketing/` may be mined later for feature ideas, signing notes and website copy.
- **Tauri 2:** `tauri.app/v2` docs for `plugin-fs`, `plugin-dialog`, `plugin-shell`, `plugin-trash`, `plugin-updater`, `plugin-single-instance`, `plugin-window-state`, menus, `fileAssociations`, code signing (macOS notarization, Windows), `tauri-driver`.

[Return to Top](#mikedown-desktop--planning-document)

---

## Gap-Filling Prompts

When a milestone finishes with items skipped or partially done, the orchestrator issues a gap-filling prompt that:

- Uses the same structure as the original milestone prompt (header, mission, reference to this document, worker rules).
- Is labeled **"Worker Context: [Milestone Name] - Gap Fill"**.
- States what the original attempt completed, which files it modified, and the exact unchecked items remaining.
- Lists other active workers and their directories to avoid conflicts.
- Ends with the standard completion steps: commit, write `.orchestrator/desktop-app-plan/worker-summary-[milestone-slug]-gap.md`, update this document's tracker and Progress Log, prompt the user to clear the context.

[Return to Top](#mikedown-desktop--planning-document)

---

## Progress Log / Notes

Newest first. Format: `**YYYY-MM-DD HH:MM** - entry`.

**2026-10-23 16:51** - rustup installed on the Mac (Rust 1.99.1, host `aarch64-apple-darwin`, targets arm64 + x86_64 for universal builds); `~/.cargo/bin` prepended in `~/.zshrc` ahead of the Intel Homebrew `rust` (left installed, nothing depends on it). Release `.app` now native arm64, 8.9 MiB. Intel-app warning resolved.

**2026-10-23 15:26** - M2 complete (cherry-picked onto `af9b03c`). `TauriHost`, Rust `fs`/`window`/`launch` commands with CRLF/BOM-preserving atomic writes, lone-file window, file associations, image paste through the M1 helpers with a sync `pathOps.ts`. Verified in the main tree: compile, unit (74 files), edge, core-package, desktop unit (54), desktop typecheck, cargo test (15) green; no editor imports in `packages/desktop/src`. Observed in the GUI by the worker (screenshots in `~/tmp-mikedown-m2/shots/`). Pending for a human: non-UTF-8 open (`~/tmp-mikedown-m2/latin1.md`), edge 14 paste on Untitled, Finder double-click. Deviations: `set_document_edited`/`set_represented_file` are app commands via `objc2-app-kit` (Tauri 2.12 lacks them); extras `CmdOrCtrl+O` and a two-button dirty-close guard; core tsup gains `shared/sha1` and `shared/wordCount` entries. Concerns: `shell.open` is deprecated in favour of `tauri-plugin-opener` (candidate for M8/M11); builds are still x86_64 (Intel Homebrew Rust), and macOS now warns that Intel apps will stop opening; rustup install proposed before T1, awaiting Mike.

**2026-10-23 14:47** - M0 complete (`ff581d5`, `274c5fa`, `b22e23e`). Gate passed: round-trip byte-identical in WKWebView and WebView2, no core change needed. `.app` 9.6 MiB, `.dmg` 6.4 MiB, `.msi` 5.8 MiB; warm start ~0.5 s. Verified in the main tree: compile, unit (68 files), edge, core-package, desktop unit, desktop typecheck, desktop vite build green. Pending: Windows RDP GUI checklist (IME, real paste, pinch; steps in `packages/desktop/docs/webview-notes.md`). Concerns: (1) no `tauri-plugin-trash` exists; M3 should use the `trash` crate in a Tauri command; (2) Mac Rust is Intel Homebrew, so builds are x86_64; install rustup (arm64) before M10; (3) updater plugin needs a `plugins.updater` block at init, placeholder pubkey until M10; (4) `csp: null` for now; (5) core serializer quirks (hard-break `\` dropped, task lists go loose, bare fence becomes `plaintext`) are core-wide, candidate backlog item; (6) BEAST has rustup and a tarball snapshot at `C:\git\mikedown`, replace with a clone.

**2026-10-23 14:27** - M1 complete (`7e87d45`). Helpers now come from `createImagePasteHelpers({ path, sha1Hex? })` in `packages/core/src/shared/imagePaste.ts`, with a pure synchronous SHA-1 default (`shared/sha1.ts`); injection chosen over `pathPosix.ts`. `./shared/*` subpath exported and built by tsup. Verified in the main tree: compile, lint (0 errors), test:unit 67 files, test:edge, test:core-package green. Concerns for M2: helpers are synchronous, so the desktop needs a synchronous `PathOps` (`@tauri-apps/api/path` is async). `test:unit` includes `package-shape.test.ts`, which fails on a stale `packages/core/dist`; run `build:core` first.

**2026-10-23 14:21** - Orchestrator session started. M0 (Fable, high effort) and M1 (default model) dispatched in parallel worktrees. Open questions 1 to 6 proceed on the plan's stated defaults (keymap fixed, 25 versions / 2 MB, updater host `iadev.net/mikedown/`, `com.interappdev.mikedown`, `.txt` associated, macOS 12+ / Windows 10 1809+); these are defaults, not rulings.

**2026-10-23** - Planning document created from the planning interview and the edge-case pass. Verified against the repo: core public API names in `packages/core/src/{index,host,types}.ts`, the `@mikedown/core` source alias in `webpack.config.js` and `vitest.config.ts`, `src/imagePaste.ts` still Node-bound (`crypto`, `path`) and tested by `test/unit/imagePaste.test.ts`, VS Code spellcheck default `false`. Signing pipeline described from `~/git/lymescribe/deploy/` and `docs/{deployment,ci-cd}.md`. Open gate: M0 WebKit/WebView2 smoke test.

[Return to Top](#mikedown-desktop--planning-document)
