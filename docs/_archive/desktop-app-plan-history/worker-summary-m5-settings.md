# Worker summary: M5 Settings (global, folder override, App tab)

**Status:** Completed (GUI checks against the real app are pending, see Review Materials).
**Worktree:** /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-af95fcdfaab2c0cc2, branch worktree-agent-af95fcdfaab2c0cc2
**Commits:** a700052 (code, unit, Rust tests), 61ef68c (e2e)
**Start / end:** 2026-10-23 19:46 / 19:58 EDT

Worktree started at b18d23c (not 1582e3d, tree clean), so I ran `git reset --hard 1582e3d` per the trap.
Summary location: the tool sandbox refused writes to the main repo path, so this file lives at `<worktree>/.orchestrator/desktop-app-plan/worker-summary-m5-settings.md` (gitignored). Copy it to the main repo path.

## Work completed (per checkbox)

- **store.ts / schema.ts**: global `<app-data>/settings.json` and `<folder>/.mikedown/settings.json`, one flat JSON object (core keys by name, desktop keys dotted: `versioning.enabled/keep/maxSizeMB`, `updates.checkOnLaunch`, `imagePaste.*`, `imageResize.overwrite`, `tree.showHidden`, `tree.confirmDelete`, `fileAssociationsOffered`). Shallow merge per key, folder wins. Nested shapes (`imagePaste: {...}`) and bare `confirmDelete`/`showHidden` are flattened on read. The app-data path is resolved in Rust (`app.path().app_data_dir()`), not via `appDataDir()` in JS, matching M4's app-data commands.
- **Corrupt JSON (edge 16)**: defaults for that file, non-modal banner (`src/settings/banner.ts`) with "Open file" (`open_in_default_app`) and "Reset to defaults" (writes `{}` only on click). Saves into a corrupt file are refused with a toast; the session still takes the value. Unknown keys in a valid file are preserved on rewrite.
- **Folder override validation (edge 29)**: `imagePaste.folder` that is absolute outside the folder, or `~`-prefixed, is dropped with the reason in the banner (also on a folder save, as a toast).
- **`host.saveSettings`**: `TauriHost` hands the patch to `settingsMgr.save` (new optional dep `persistSettings`). Routing: global file, or folder file when the modal's "Save for this folder" is on and a folder is open. `.mikedown/` is created only by the Rust write for a folder save. After the write the manager reloads, updates the store and calls `updateSettings` on every editor. Only changed keys are written (diff vs. what the window had), so the folder file holds only the changed key.
- **App tab** (`appTab.ts`, `tab: 'app'`, `tabLabel: 'App'`): Save for this folder (disabled without a folder), versions on/keep/max size, check for updates on launch, image folder / relative-to / file name / alt text / link style / max size (VS Code wording), show hidden, confirm before delete, "Set MikeDown as default for .md", About (version, Check for Updates...). Built with `ctx.makeRow/makeCheckboxRow/makeSelectRow/makeGroup`.
- **Theme**: `theme: 'auto'` already set; `host.toggleTheme` left absent, but core then flips the theme locally, so the toolbar button is hidden by CSS (`.mikedown-root [data-action='themeToggle']` in `styles/settings.css`). A stored `editorTheme` is ignored. Chrome recolor is covered by the existing appearance spec plus a new check.
- **Cross-window**: manager emits `mikedown:settings-changed` after each write; other windows re-read and re-apply (skips own echo, and another folder's override). Tree toggles (Show Hidden, "Don't ask again") now persist via `store.onTreeChange`.
- Folder open reloads settings (`openFolder` calls `settingsMgr.load()` after `workspace.open`), so a different folder shows 25 again.
- Rust: `commands/settings.rs` (`settings_read`, `settings_write`, `open_default_apps_settings`); write validates JSON object, atomic, creates parent dir.

## Files modified

New: `src/settings/{schema,store,settingsApi,appTab,appActions,banner}.ts`, `src/styles/settings.css`, `src-tauri/src/commands/settings.rs`, tests `test/unit/{settings,appTab,settingsHost}.test.ts`, `test/e2e/settings.spec.ts`.
Changed: `src/settings/desktopSettings.ts` (store gains versioning/updates/fileAssociationsOffered, `load`, `flat`, `onTreeChange`).
**Hot spots touched (all small, additive):** `src/main.ts` (imports, manager + actions block before `const hosts`, `persistSettings` dep, `extraSettingsSections` + `settings:` seed in `createEditor`, `settingsMgr.load()` in `openFolder` and at start of `boot`), `src/host/tauriHost.ts` (`persistSettings` dep + branch in `saveSettings`), `src-tauri/src/lib.rs` (3 handlers appended), `src-tauri/src/commands/mod.rs` (1 line), `src-tauri/capabilities/default.json` (`updater:allow-check`). Test hot spots: `test/e2e/fixtures.ts` (two cases + `settingsPath` helper), `test/e2e/README.md` (one bullet). No `package.json`, `Cargo.toml`, `shortcuts.ts`, `chrome.ts` or core changes.

## Test / build status

- `npx vitest run --config vitest.config.ts` (packages/desktop): 23 files, 229 tests pass (new: 26 + 8 + 5 covering merge order, corrupt fallback with file untouched, override validation, save routing global vs folder with `.mikedown/` only on folder save, cross-window re-read, App tab in the real core modal, host persist path).
- `npx playwright test --config test/e2e/playwright.config.ts`: 14 pass (6 new in `settings.spec.ts`: App tab rows, folder toggle disabled in a lone-file window, Save for this folder writes exactly `{"versioning.keep":10}` and reopens at 10, global persistence across reload, body font persisted and re-applied after reload, corrupt banner leaves file untouched until Reset, no theme toggle / dark-light recolor).
- `cargo test` in `src-tauri`: 52 pass (5 new in `settings.rs`: scope paths, missing file creates nothing, `.mikedown/` created on folder write, invalid JSON rejected and file untouched, BOM stripped). `cargo check`, `npx tsc --noEmit`, `npx vite build` clean.

## Issues / limitations

- Not run against the real Tauri app (no GUI driving). Pending checks below.
- Core keys removed by switching folders only revert if the global file has them (core exports no defaults). Desktop keys (`versioning.*`, `imagePaste.*`, `tree.*`) revert fully.
- First-ever folder-scoped override of the font families, when the editor still shows core's fallback font theme and nothing has been saved: skipped (no baseline to diff against). Works once the key exists in a file or after one save. Global saves are unaffected.
- "Set MikeDown as default for .md": Windows opens `ms-settings:defaultapps`; macOS shows the Finder "Get Info > Change All" steps (no programmatic LaunchServices call). Marks `fileAssociationsOffered`. M8's first-run offer can reuse `createAppActions`.
- "Check for Updates...": calls the updater plugin; the build has a placeholder pubkey and no endpoints, so it reports "not set up in this build yet" until M10. `updates.checkOnLaunch` is stored but nothing reads it yet (M10).
- `versioning.*` values are stored and editable; M6 consumes them (`settings.get().versioning`).
- `tauri-plugin-persisted-scope` keeps runtime fs grants forever (M4 note): not touched.

## Notes for orchestrator

- Likely cherry-pick touch points with other branches: `main.ts`, `lib.rs`, `mod.rs`, `fixtures.ts` (all additive blocks).
- M6 reads `settings.get().versioning.{enabled,keep,maxSizeMB}`; M8 can use `createAppActions` and `settingsMgr.save({ fileAssociationsOffered: true }, { force: true })`; M10 wires update-on-launch.
- Banner element is prepended to `#app` (`.mdapp-banner`).

## Review Materials

- Run: `cd /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-af95fcdfaab2c0cc2/packages/desktop && npm run dev` (Tauri). Global settings file: `~/Library/Application Support/<app identifier>/settings.json` (find it with `ls ~/Library/Application\ Support | grep -i mike`).
- Pending GUI checks (not run):
  1. Cmd+, > Appearance > pick another Font Theme > Save. `settings.json` has `fontFamily`; open a second window (Cmd+N), it uses the same font; quit and relaunch, font persists.
  2. File > Open Folder. Cmd+, > App > tick "Save for this folder", set Versions to keep to 10, Save. `<folder>/.mikedown/settings.json` contains only `{"versioning.keep": 10}`. Open a different folder: the App tab shows 25.
  3. Quit. Corrupt `settings.json` by hand (`echo '{ bad' > <file>`). Relaunch: banner "could not be read", defaults in use, file still `{ bad`. Click Reset to defaults: file becomes `{}`.
  4. Toggle macOS dark/light appearance: chrome and editor recolor; no sun/moon button in the toolbar.
- Automated: `npx playwright test --config test/e2e/playwright.config.ts test/e2e/settings.spec.ts` (fixtures: temp dir plus `ipc.appData` from `test/e2e/fixtures.ts`).
