# MikeDown — Resume Prompt

## Project Overview

MikeDown is a WYSIWYG markdown editor (TipTap/ProseMirror) in an npm workspace. One editor core, `packages/core` (`@mikedown/core`), is shipped through several consumers:

- the VS Code extension (`src/`, thin shell `src/webview/editor-main.ts`);
- **MikeDown Desktop**, a Tauri 2 app at `packages/desktop/` (macOS, Windows, Linux preview);
- the npm family `@mikedown/core`, `web-component`, `react`, `vue`, `angular` (all public on npm, lockstep versions, independent of the extension's 2.x);
- downstream apps LymeStarter (`develop`) and Quantico Creek (`master`), now on the published packages.

Desktop contains no editor logic. See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; the three-place settings rule; the `tiptap-markdown` ES alias) and the release steps.

## Current Status

**Everything is published and deployed. What's left is Mike's hands-on work and one Marketplace upload.**

- **npm:** all five `@mikedown/*` packages are at 0.2.0 on `latest` (tag `npm-v0.2.0`; core 0.1.0 is tagged `core-v0.1.0`).
- **Website** `https://www.iadev.net/mikedown/`: Desktop download page, `/vscode/`, and `/developers/` with a live demo per wrapper. It's deployed as site release `0.3.0-site.2` through LymeDeploy; the next site release is `--site-n 3`.
- **Desktop 0.3.0** is live (document sidebar, serializer fixes, Linux AppImage preview). Self-update is proven on macOS and Windows, and the updater key is backed up. Desktop still pins core `0.1.0` exactly.
- **VS Code 2.15.0** is built (`mikedown-editor-2.15.0.vsix` in the repo root, untracked; tag `v2.15.0`) but **not uploaded to the Marketplace yet**.
- **Core accessibility fixes** (contrast, checkbox names, toolbar names, More ⋯ overflow menu, table toolbar on focus) are under `CHANGELOG.md` `[Unreleased]`. They're in npm 0.2.0 but not in the 2.15.0 vsix.
- CI (`.github/workflows/ci.yml`) is green, and everything is pushed.

## What's Next

1. **Mike:** upload the 2.15.0 vsix to the Marketplace, then do the T1 hands-on in `wrappers-npm-plan.md`:
   - the Extensions panel shows 2.15.0;
   - edit and save a `.md` file in `test/workspace/`;
   - the zoom `[−] 15 [+]` control works;
   - a `> [!NOTE]` callout isn't duplicated after Cmd+/.

   Then close the plan: archive `.orchestrator/wrappers-npm-plan/processed/` into `docs/_archive/`, and remove the plan's entry from `.orchestrator/active-sessions.json`.
2. **Mike:** on npmjs.com, set each `@mikedown/*` package to "Require two-factor authentication and disallow tokens". The settings page needs his security key.
3. **Favicon:** a favicon for the website was dispatched at the end of 2026-10-24. If it landed, deploy it as site release 3 (`packages/desktop/deploy/pack-for-lymedeploy.sh --site --site-n 3`, with Mike's OK).
4. **Mike:** run the Desktop T4 checklist (`packages/desktop/docs/manual-test-checklist.md`, 82 checks) on both OSes, then log it in `desktop-app-plan.md`.
5. **Re-encrypt the updater key** with a new password (same key, so installs keep working). The current password was shown in chat on 2026-10-24. Then update the Keychain item `mikedown-updater-key` and the LastPass "MikeDown Note".
6. **Bitbucket is near its 1 GB workspace cap.** The plan is to move `~/git/rando` to private GitHub; it's queued in `~/Desktop/RESUME.md`.
7. **Follow-ups:**
   - **Extension:** the next release ships the `[Unreleased]` accessibility fixes.
   - **Desktop:**
     - the desktop-app session moves the core pin off `0.1.0`;
     - the release notes link may open two tabs;
     - the corner "is available" notice persists while the window is open;
     - the last heading isn't highlighted on outline click;
     - dead `#editor` CSS rules;
     - check whether core settings leak between panes.
   - **LymeStarter:** `lymetools scaffold app` reports a missing `about` route (this predates the wrappers work).
   - **LymeDeploy:** the PMO-PROD-VM agent has been offline for about 40 h.
   - **Repo cleanup:** prune `.claude/worktrees/` (old desktop and linux-appimage agent worktrees).
   - **Tests:** a flaky unit test failed once during T1 and was never identified.

## Planning Docs

- `wrappers-npm-plan.md`: **active.** Everything is complete except T1 (Mike); M10 Svelte is deferred.
- `wrappers-decisions.md`: approved M0 decisions (versioning, peers, Angular floor 17, ARIA).
- `desktop-app-plan.md`: only Mike's T4 hands-on is left.
- `desktop-auto-update-plan.md`: complete (U5 key backup and T2 signed off 2026-10-24).
- `desktop-auto-update-handson.md`: uncommitted and owned by another session. Leave it alone.
- `angular-core-extraction-plan.md`: only M10 (Quantico Creek API) is open.
- Others:
  - `core-extraction-decisions.md`;
  - `slash-commands-planning.md` (complete);
  - `manual-test-script.md`;
  - `hands-on-remaining.md`;
  - `PLANNING.md` (reserved).

## Servers

- **Desktop dev:** `npm run dev:desktop`. Needs `export PATH="$HOME/.cargo/bin:$PATH"`.
- **Site:** `npm run dev:site` (port 5180), or `npm run build:site && npm run preview -w website` (`http://localhost:5180/mikedown/`).
- **Core demo:** `npm run demo:core`, then open `/demo/`.
- **Production:**
  - IIS on iadev-prod, folder `C:\WebApps\Downloads\mikedown`.
  - Published by LymeDeploy project `mikedown-downloads` through `packages/desktop/deploy/pack-for-lymedeploy.sh` (`--site` for site-only releases).
  - Cloudflare doesn't cache `/mikedown/`, so no purge is needed.
- **Windows build:** BEAST (`192.168.50.39`), Scheduled Task `MikeDownRemoteBuild`. It clones from GitHub, so push first. Test box: DevBox1 (`192.168.50.42`).
- **Linux build:** Docker linux/amd64 (`packages/desktop/deploy/linux/`). `release.sh` builds it by default; `--no-linux` skips it.

## Key File Paths

- `packages/core/`: the editor. Tests are in `packages/core/test/`; `src/binding.ts` holds `bindMikeDownValue`, which every wrapper uses.
- `packages/web-component`, `react`, `vue`: the wrappers, in the root workspace. `packages/angular` is outside the root workspace, has its own lockfile, and publishes from `dist/`.
- `website/`: the site (`shared/` shell, `mikedown-desktop/`, `vscode/`, `developers/`, `developers-angular/`). After editing `shared/`, run `npm run sync:shell -w website`.
- `scripts/version-npm.mjs`, `scripts/release-npm.mjs`: npm family versioning and publishing (see `CLAUDE.md`, Releasing).
- `packages/desktop/deploy/`:
  - `release.sh`, `pack-for-lymedeploy.sh`, `key-runbook.md`, `release-notes/`;
  - `lib/release-lib.js` (core pin gates), `stage-site.js`, `verify-site.js`.
- `.orchestrator/wrappers-npm-plan/`: orchestrator state, prompts and processed summaries.

## Recent Git Log

- `9cd086d` Record T4 hands-on completion in the wrappers plan
- `8a1dd77` Record T4 automated verification in the wrappers plan
- `a4e883f` Add a --from-registry mode to the consumer smoke test
- `be3e303` Keep Cloudflare from rewriting pinned package URLs in code samples as emails
- `7fd982f` npm packages 0.2.0
- `8bbafc7` Move toolbar buttons that don't fit into a More menu

## Any Other Notes

- **Desktop release flow:**
  1. `release.sh <v> --notes-file release-notes/<v>.md --yes`. It exits 10 until the bump commit is pushed; push with Mike's OK, then re-run with `--no-bump`.
  2. `pack-for-lymedeploy.sh --version <v>`.
  3. Tag `desktop-v<v>`.
- **Mac release builds are slow on purpose.** A universal build compiles twice with LTO and `codegen-units = 1`, then waits on notarization. Keep those settings.
- **1.0 criteria:**
  - both hands-on passes signed off;
  - a real update in the wild (done);
  - a few weeks of daily use with no data loss;
  - the key backed up (done);
  - recommendable without caveats.
- **npm publishes are Mike's** (user `interapp`, 2FA through a security key). Brand-new package names can take 20+ minutes to appear on the registry.
- **Cloudflare Email Obfuscation** rewrites `name@1.2.3` text in served HTML. Code samples are protected by `website/developers/common/samples.js`; hand-written HTML is not.
- **IIS MIME types:** `.woff2`, `.svg`, `.mjs` and `.webmanifest` are unconfirmed on iadev-prod. Never add a `mimeMap` for a type that's already mapped machine-wide, because that returns 500 for the whole folder.
- **Running tests:**
  - `test:integration` fails in worktrees (the IPC socket path is too long), so run it in the main tree.
  - A fresh tree needs `npm run build:core` before `test:unit`.
  - Bare `vitest run` picks up the integration files. Use `npm run test:unit`, `test:edge` or `test:integration`.
  - Local Node 22.20 is too old for Angular CLI 22, so the `angular-latest` consumer target is skipped.
- **Dev host:** after `npm run compile`, press Cmd+R in the dev host.
- **Mac updates:** `/Applications` isn't writable by Mike's day account, so they prompt for `macadmin`. Windows is a per-user NSIS install with no admin prompt.
- **Orchestrator:** workers are Agent-tool subagents, and only the orchestrator ticks plan checkboxes.
- **Spell check** defaults **off**. Don't ask mzenker-PSS for a review a third time.
