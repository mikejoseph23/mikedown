# MikeDown — Resume Prompt

## Project Overview

MikeDown is a WYSIWYG markdown editor (TipTap/ProseMirror) in an npm workspace with three thin consumers of one editor core. The core is `packages/core` (`@mikedown/core`, framework-agnostic: `createMikeDownEditor(container, { host })` plus the `MikeDownHost` adapter). The consumers are:

- the VS Code extension (`src/`, thin shell `src/webview/editor-main.ts`);
- the Angular wrapper `<lyme-markdown-editor>` (LymeStarter opt-in folder, copied by hand into Quantico Creek);
- **MikeDown Desktop**, a Tauri 2 app at `packages/desktop/` (macOS and Windows) for non-developers.

Desktop contains no editor logic. Document versioning lives only in desktop, never in core or the extension. See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; the three-place settings rule; the `tiptap-markdown` ES alias).

## Current Status

**MikeDown Desktop 0.2.0 is live at `https://www.iadev.net/mikedown/`, and a Mac 0.1.0 install updated itself to 0.2.0 from production. Most of what's left is Mike's hands-on work and the key backup.**

- All desktop milestones M0–M11 and T1–T3 are complete in code. Real-window GUI checks are still pending across most of them.
- T4 (release candidate hands-on) is open. It runs together with the auto-update plan's T2 via `desktop-auto-update-handson.md`, which is uncommitted at the root and owned by the paused auto-update orchestrator session. Leave it alone.
- **Updater key backup is NOT confirmed** (auto-update plan U5). Losing `~/.tauri/mikedown.key` (password in Keychain `mikedown-updater-key`, key id `C5386105C2C03AF7`) strands every install.
- Windows 0.1.0 → 0.2.0 self-update is untested (DevBox1 has 0.1.0).
- Two plan-log commits are unpushed: `d24b4d5` and `6bdf006`. Push only on Mike's say-so.
- The VS Code extension is still at 2.14.2. `## [Unreleased]` in `CHANGELOG.md` holds the toolbar zoom control (feature), the condensed-toolbar tooltip clipping fix (`838d1cc`), the callout duplication fix (`f1befc5`), plus the core save-race fix (`96e93cd`, typing within 500 ms of a save was lost), which is **not yet in the changelog**; add it before release. Recommended: release **2.15.0 from `main`**.
- `@mikedown/core` `0.1.0-rc.1` is still unpublished. It needs Mike's `npm login` and the `mikedown` org. Desktop releases use `--allow-unpublished-core` until then.

## What's Done

- **2026-10-23/24 Desktop:** M0 scaffold and WebKit/WebView2 smoke, M1 imagePaste into core shared, M2 TauriHost and lone-file window, M3 tree/watcher/Trash, M4 tabs/panes/hot exit/session restore, M5 settings, M6 versioning and diff, M7 folder search, M8 welcome/recents/menus, M9 HTML/PDF export, M10 updater/signing/pipeline/download page, and M11 a11y/encoding polish.
- Auto-update plan U1–U4 and T1: Sparkle-style update window, 4 h checks, per-platform manifests, staging harness green on both OSes.
- Released 0.1.0 (pre-auto-update UX) and 0.2.0 (tag `desktop-v0.2.0`). Mac self-update was proven in production.
- **2026-10-23 core/extension:** toolbar zoom control `[−] 15 [+]` (`53f442e`, `00f5910`), condensed toolbar `overflow: visible` tooltip fix (`838d1cc`), core save-race fix.
- **2026-10-22:** core extraction and Angular wrapper (M0–M9, M11, T1–T4 of `angular-core-extraction-plan.md`).

## What's Next

1. **Mike:** back up the updater key and its password. Then fill in the placeholders in `packages/desktop/deploy/key-runbook.md` and tick U5 in `desktop-auto-update-plan.md`.
2. **Mike, on DevBox1 over RDP:** in 0.1.0, run Help > Check for Updates. Expect a quiet NSIS install with no UAC prompt that reopens on 0.2.0. Log the result in `desktop-app-plan.md`.
3. **Mike:** run `desktop-auto-update-handson.md`, which covers desktop T4 and the pending GUI checks. Then resume that session with `/iadev:orchestrator desktop-auto-update-plan.md`.
4. **Pending decisions from Mike:**
   - Windows-only disable of Tauri OS file drops, because `dragDropEnabled` breaks in-page HTML5 drag on WebView2.
   - Add the core serializer quirks to `BACKLOG.md`: trailing newline dropped after edits, hard-break/task-list/bare-fence quirks, caret position after Cmd+/.
5. **Core publish, then extension 2.15.0:** `npm publish -w packages/core --tag rc --access public`, then `npm run vsix`, `npm run release:core`, upload the `.vsix`, commit `Release X.Y.Z` and tag. After that, bump LymeStarter and Quantico Creek off the vendored tarball, and drop `--allow-unpublished-core` from desktop releases.
6. **Optional:** set up LymeDeploy and a Cloudflare purge token so desktop releases skip RDP (steps in the header of `packages/desktop/deploy/lymedeploy/deploy.yaml`).
7. **Older open items:**
   - M8 hands-on (Quantico KB image paste).
   - M10 scope call (bot protection).
   - Merge LymeStarter `develop` into `main`.
   - Follow-ups:
     - source mode ignores the zoom font size, and the zoom buttons stay enabled there;
     - trailing-button tooltips truncate in narrow panes;
     - Tab-focusing an off-screen toolbar button scrolls the root sideways;
     - the follow-up list in `angular-core-extraction-plan.md`.

## Planning Docs

- `desktop-app-plan.md`: **active.** Desktop tracker M0–M11 and T1–T4, Decisions, and 6 open questions still on plan defaults. Progress Log is newest first.
- `desktop-auto-update-plan.md`: **active.** U1–U4 and T1 done; T2 and U5 await Mike.
- `desktop-auto-update-handson.md`: Mike's hands-on checklist. Uncommitted and owned by the other session.
- `angular-core-extraction-plan.md`: only M10 is open; M7 and M8 have pending items.
- `core-extraction-decisions.md`: approved M0 decisions for the extraction.
- `slash-commands-planning.md`: complete (2.11.0), ready to archive into `docs/`.
- `manual-test-script.md`, `hands-on-remaining.md`: older extension hands-on checklists.
- `PLANNING.md`: original build plan (reserved).

## Servers

- **Desktop dev:** `npm run dev:desktop` (`tauri dev`). Cargo must be on the PATH: `export PATH="$HOME/.cargo/bin:$PATH"`.
- **Core demo:** `npm run demo:core`, then open `/demo/` (the root path 404s; Vite moves to the next free port above 5199).
- **Production downloads:**
  - Public URLs: `https://www.iadev.net/mikedown/` and the manifest `latest.json`.
  - Server: IIS site `Interapp`, virtual directory `/mikedown` → `C:\WebApps\Downloads\mikedown` on iadev-prod. RDP is Mike-only, and the site is behind Cloudflare.
- **Windows build:** BEAST (`192.168.50.39`), Scheduled Task `MikeDownRemoteBuild`, Trusted Signing. It clones from GitHub, so the build commit must be pushed first. Test box: DevBox1 (`192.168.50.42`).
- **Quantico Creek and LymeStarter:** see `angular-core-extraction-plan.md`. Quantico API runs on :5117 and the SPA on :4200. LymeStarter runs on :4200 and :5218.

## Key File Paths

- `packages/core/src/` holds the editor (`editor.ts`, `host.ts`, `wheelZoom.ts`, `styles/theme.css`); core tests are in `packages/core/test/`.
- `packages/desktop/`:
  - `src/`: app chrome (tree, tabs, menu, settings, versions, search, updater UI).
  - `src-tauri/`: Rust (`versions.rs`, `menu.rs`, search, updater, backups/sessions).
  - `docs/webview-notes.md`
  - `deploy/`:
    - `release.sh`, `verify-published.sh`, `build-mac.sh`, `make-dmg.sh`, `remote-build-windows.sh`
    - `release-notes/`, `key-runbook.md`, `lymedeploy/deploy.yaml`
    - `dist/<v>/upload/` holds the files to copy to the server (gitignored).
- `src/` and `src/webview/` are the VS Code host and its thin shell.
- `.orchestrator/desktop-app-plan/` holds orchestrator state, processed worker summaries and artifacts.
- `~/git/lymescribe/deploy/` and `docs/` are the reference signing and updater pipeline.

## Recent Git Log

- `6bdf006` Record the first production self-update (macOS) in the desktop plan
- `d24b4d5` Record the 0.2.0 release in the desktop plan
- `1c9ade2` MikeDown Desktop 0.2.0
- `ccedc63` Release notes for MikeDown Desktop 0.2.0
- `6b12f2b` Record the manual 0.1.0 publish in the desktop plan
- `554a89d` Note auto-update merge and combined hands-on pass in the desktop plan
- `37d04ae` Desktop auto-update plan: T2 staged for Mike's hands-on pass

## Any Other Notes

- **Desktop release flow:**
  1. `release.sh <x.y.z> --notes-file release-notes/<v>.md --yes --allow-unpublished-core`. It stops with exit 10 until the bump commit is on origin; push with Mike's OK, then re-run with `--no-bump`.
  2. Mike copies `dist/<v>/upload/` over RDP and purges Cloudflare (the manifests get overwritten).
  3. Run `verify-published.sh <v>`, then tag `desktop-v<v>`.
- Mac release builds are slow on purpose: a universal build compiles twice, with LTO and `codegen-units = 1`, and then waits on notarization. Keep those settings.
- 1.0 criteria:
  - both hands-on passes signed off;
  - a real update in the wild;
  - a few weeks of daily use with no data loss;
  - the key backed up;
  - recommendable without caveats.
- `/Applications` isn't writable by Mike's day account, so Mac updates prompt for `macadmin`. Windows is a per-user NSIS install with no admin prompt.
- `.claude/worktrees/` holds about 10 finished agent worktrees and branches from the desktop orchestrator. They're safe to prune once their work is confirmed on `main`; check with the orchestrator first.
- Orchestrator workers run as Agent-tool subagents (Mike prefers them over clipboard prompts). Only the orchestrator ticks plan checkboxes.
- After `npm run compile`, Cmd+R the dev host. Bare `vitest run` picks up the integration files, so use `npm run test:unit`, `test:edge` or `test:integration`.
- Spell check defaults **off**. Don't ask mzenker-PSS for a review a third time.
