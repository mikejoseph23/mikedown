# Worker summary: M10 (updater, signing, build pipeline, download page)

## Status

Complete in code, on branch `worktree-agent-a686f01279e7de322` (worktree `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a686f01279e7de322`), on top of `03e6f8e`. Commits: `11d107e`, `54ba84c`, `7c95069`, `ef27273`, `3fa7325`. Not pushed.

Verified: a signed, notarized and stapled universal macOS build, an unsigned NSIS build on BEAST over SSH, and a headless N to N+1 update through the real updater plugin.

Still pending (needs Mike): Windows Trusted Signing through the Scheduled Task (the task isn't registered and BEAST has no clone), the GUI Restart Now click, and Windows update end to end.

## Work completed (per checkbox)

- **Updater (edge 17).**
  - Key:
    - `tauri signer generate` produced the keypair.
    - Private key: `~/.tauri/mikedown.key` (mode 600).
    - Password: login Keychain generic password `mikedown-updater-key`.
    - Public key (key id `C5386105C2C03AF7`) is in `tauri.conf.json`.
  - Config: endpoint `https://www.iadev.net/mikedown/latest.json` (www, to skip the apex 301), `requireSignedVersion: true`, `windows.installMode: "passive"`.
  - Rust `commands/updater.rs`:
    - `updater_claim`: an app-wide 24 h claim, so one check per day however many windows are open.
    - `updater_check`: logs every outcome to `<app-data>/logs/updater.log`, which rolls over at 256 KB. A found update is emitted to every window.
    - `updater_install`: downloads and verifies, then runs the existing quit handshake (dirty-file dialog, sessions), then installs and calls `request_restart`. Cancel keeps the app running.
  - Webview:
    - `src/app/updater.ts`: silent check at launch if `updates.checkOnLaunch`, an hourly tick, and errors logged and swallowed.
    - Help > Check for Updates… and the App tab both use `manualCheck`, which reports "up to date (version X)", update available, or "could not check".
    - `src/ui/updateToast.ts`: the Restart Now / Later toast. Escape means Later.
  - Stable channel only. The JS `updater:allow-check` capability was removed, since Rust does the work.
- **macOS build.** `deploy/build-mac.sh`:
  - Builds the universal target. The signing identity, hardened runtime and updater artifacts come from a generated config overlay, plus `src-tauri/Entitlements.plist` (empty on purpose, reason in the file).
  - Notarizes and staples the app (keychain profile `mikedown-notary` if stored, else `lymescribe-notary`).
  - Rebuilds `.app.tar.gz` from the stapled app and signs it with `tauri signer sign --app-version`.
  - Builds the DMG, signs it, notarizes and staples it.
  - Checks `lipo`, `codesign`, `spctl` and `stapler`. `--skip-notarize` is available.
  - Identity lookup and `store-credentials` are documented in `deploy/README.md`.
- **Windows build.**
  - NSIS only, `installMode: currentUser` (`tauri.windows.conf.json`), WebView2 `downloadBootstrapper`.
  - `deploy/build-windows.ps1` sets Tauri's `signCommand` to `deploy/sign-artifact.ps1`, a copy that uses `MIKEDOWN_SIGN_DLIB` / `MIKEDOWN_SIGN_METADATA`, same account and profile, ASCII. Every binary gets signed and the script refuses a non-Valid installer.
  - `deploy/beast/run-mikedown-build.ps1` is the Scheduled Task wrapper: exact commit, `npm ci`, guarded restore, `done.json` sentinel.
  - `deploy/remote-build-windows.sh`: preconditions, trigger, poll, Authenticode check, `signtool verify /pa` record, scp, hash compare.
  - The updater `.sig` is made on the Mac, so the private key never leaves it.
  - The `schtasks` line is in all three places.
- **Release script.**
  - `deploy/release.sh`:
    - Bumps the version and commits "MikeDown Desktop x.y.z".
    - Builds Mac, then Windows. It stops with instructions if the commit isn't on origin.
    - Writes `latest.json`, stages `dist/<v>/upload/` with versioned names, `index.html`, `web.config` and `SHA256SUMS.txt`.
    - Prints the upload checklist: RDP to iadev-prod with artifacts first and `latest.json` last, then the Cloudflare purge and HTTPS checks.
  - `deploy/sync-version.js` keeps `package.json`, `tauri.conf.json`, `Cargo.toml` and `Cargo.lock` in sync.
  - `deploy/make-latest-json.js` writes the manifest in Tauri static format. Both darwin keys point at the universal tarball, plus a `downloads` block for the website.
- **Core pinning.**
  - `RELEASE=1` (set by both build scripts) forbids the source alias, and `vite.config.ts` fails if the `@mikedown/core` pin is not equal to `packages/core`'s version.
  - `deploy/check-core-pin.js` also requires the version on npm unless `--allow-unpublished-core` is given. That flag builds against `packages/core/dist`, which is what the workspace symlink resolves to.
  - Core `0.1.0-rc.1` is unpublished, so the flag was used. Nothing was published.
- **Download page.** `website/mikedown-desktop/index.html`:
  - Mac and Windows buttons rewritten from `latest.json` at load.
  - Minimum OS versions, install steps and release notes.
  - Privacy section: the update check is the only network call the app makes on its own; no telemetry; the page sets no cookies.
  - `deploy/site/web.config` adds CORS, a `.sig` MIME type, `latest.json` no-cache, and `index.html` as the default document.
- **Minimum OS.** macOS: `minimumSystemVersion` 12.0, confirmed `LSMinimumSystemVersion` 12.0 in the built `Info.plist`. Windows: the NSIS `NSIS_HOOK_PREINSTALL` in `src-tauri/windows/installer-hooks.nsh` aborts below build 17763 (1809). It compiled on BEAST, but I didn't run it on an old OS.
- **Commit.** Done, 5 commits.

## Files

New:
- `packages/desktop/deploy/{README.md, build-mac.sh, build-windows.ps1, remote-build-windows.sh, release.sh, updater-staging-test.sh, sign-artifact.ps1, sign-metadata.json, sync-version.js, make-latest-json.js, check-core-pin.js, lib/release-lib.js, beast/run-mikedown-build.ps1, site/web.config}`
- `packages/desktop/src-tauri/{Entitlements.plist, tauri.windows.conf.json, windows/installer-hooks.nsh, src/commands/updater.rs, tests/updater_staging.rs}`
- `packages/desktop/src/{app/updater.ts, app/updaterApi.ts, ui/updateToast.ts}`
- `packages/desktop/test/unit/{updater.test.ts, deploy.test.ts}`
- `website/mikedown-desktop/index.html`

Modified:
- `tauri.conf.json`, `Cargo.toml` (dev-dependency `tauri` with `test`), `lib.rs`, `commands/mod.rs`, `commands/multiwindow.rs` (`request_quit_then`)
- `capabilities/default.json`
- `src/main.ts`, `src/settings/appActions.ts`, `src/styles/app.css`
- `test/unit/appTab.test.ts`
- `vite.config.ts`, `packages/desktop/.gitignore` (`deploy/dist/`, `*.key`, `.env*`), `packages/desktop/README.md`

## Test and build status (in the worktree)

- `npm run typecheck -w packages/desktop`: green.
- `npm run test:unit -w packages/desktop`: 33 files, 392 tests green (updater 15, deploy 13 new).
- `npm run test:e2e -w packages/desktop`: 36 passed.
- `cargo test` in `src-tauri`: 98 passed, plus 4 and 2 ignored (the staging tests).
- Root `npm run compile`: green. Root `npm run test:unit`: 106 files, 1368 passed.
- Not run: root `lint`, `test:edge` and VS Code integration (no root-side changes).
- **Not run:** `release.sh`, `remote-build-windows.sh` and `bash -n` on them. The worktree sandbox hook refuses any shell script that calls `git -C "$REPO_ROOT"`. Their pieces were run individually (build-mac, make-latest-json, sync-version through the test, build-windows on BEAST).

## Verification output (final run, `build-mac-2.log`, from HEAD scripts)

```
codesign --verify --deep --strict: MikeDown.app: valid on disk / satisfies its Designated Requirement
flags=0x10000(runtime)  Authority=Developer ID Application: INTERAPP DEVELOPMENT, INC. (UU626VCLYW)  Timestamp=Oct 23, 2026 9:52:06 PM
spctl -a -vv MikeDown.app: accepted  source=Notarized Developer ID
stapler validate MikeDown.app: The validate action worked!
spctl -a -t open --context context:primary-signature -vv DMG: accepted  source=Notarized Developer ID
stapler validate DMG: The validate action worked!
lipo: x86_64 arm64
```

Notarization: app and DMG both `status: Accepted` (profile `lymescribe-notary`).

Windows (BEAST over SSH, `-SkipSign`):
- `makensis` produced `MikeDown_0.1.0_x64-setup.exe`, 5.19 MiB.
- Authenticode `NotSigned` (expected).
- ProductVersion 0.1.0, sha256 `44418d16…2015`.
- No `signtool` output yet, because signing needs the Scheduled Task.

Headless updater (`updater-staging-test.sh --headless`):
```
[e2e] check: 0.1.0 -> 0.1.1 at http://127.0.0.1:18765/MikeDown-0.1.1-staging.app.tar.gz
[e2e] downloaded 6473270 bytes, signature and signed version verified
[e2e] installed 0.1.1 over 0.1.0 ...; codesign --verify --deep --strict OK
[e2e] tampered payload rejected: The signature verification failed
```

## Artifacts

All under `packages/desktop/deploy/dist/` (gitignored):

| Artifact | Size |
| --- | --- |
| `0.1.0/MikeDown-0.1.0-macos-universal.dmg` | 14,245,813 B |
| `0.1.0/MikeDown-0.1.0-macos-universal.app.tar.gz` | 12,682,253 B |
| `0.1.0/MikeDown-0.1.0-macos-universal.app.tar.gz.sig` | 456 B |
| `0.1.0/MikeDown.app` (stapled) | n/a |
| `0.1.0/latest.json` (Mac only, sample) | n/a |
| `0.1.0/verify-macos.txt` | n/a |
| `win-unsigned/MikeDown-0.1.0-windows-x64-setup.exe` | 5,445,185 B, unsigned, test only |
| `staging/` (N/N+1 test, `headless.log`) | n/a |

## Actions for Mike

1. **Back up the updater key now** (Mac Studio, `michaeljosephwork`):
   - the file `~/.tauri/mikedown.key`
   - the password: `security find-generic-password -s mikedown-updater-key -w`

   Put both in the password manager. If either is lost, installed copies can never update.
2. **BEAST, RDP console as `michaeljoseph`:** replace the tarball snapshot with a clone, then register the task. The rename and clone are one line:
   ```powershell
   Rename-Item C:\git\mikedown mikedown-snapshot; git clone https://github.com/mikejoseph23/mikedown C:\git\mikedown
   ```
   Register the task (one line; it prompts for the password):
   ```powershell
   schtasks /create /tn "MikeDownRemoteBuild" /ru michaeljoseph /rp * /rl HIGHEST /f /sc ONCE /st 00:00 /sd 01/01/2020 /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\tools\remote-build\run-mikedown-build.ps1"
   ```
   Delete `C:\temp\mikedown-m10` (my unsigned test build) when convenient.
3. **Signed Windows build** (Mac, after pushing the commits): `packages/desktop/deploy/remote-build-windows.sh --version 0.1.0 --allow-unpublished-core`. Check `dist/0.1.0/verify-windows.txt` (`signtool verify /pa`). Install on DevBox1 to confirm the UAC/SmartScreen publisher name. The installer is per-user, so there should be no UAC prompt at all.
4. **GUI updater check on the Mac** (about 5 min, uses the screen): `packages/desktop/deploy/updater-staging-test.sh`. The toast appears; click Restart Now. The script confirms the copy reports 0.1.1 and relaunched.
5. **First real release:**
   ```bash
   packages/desktop/deploy/release.sh --no-bump --allow-unpublished-core --notes-file <notes.md>
   ```
   Use `release.sh patch …` for later releases. Then follow the printed checklist:
   - create the `/mikedown` vdir on iadev-prod (pattern `C:\WebApps\Downloads\mikedown`)
   - upload artifacts first, `latest.json` last
   - purge Cloudflare for both forms of `latest.json`
   - check with `curl` using a cache buster

   If `.app.tar.gz` answers 404, uncomment the `.gz` MIME line in `web.config`.
6. Optional: `xcrun notarytool store-credentials mikedown-notary --apple-id <email> --team-id UU626VCLYW --password <app-specific>`. `lymescribe-notary` already works.

## Keys and secrets

- Updater private key: `~/.tauri/mikedown.key`. Password: Keychain item `mikedown-updater-key` (account `michaeljosephwork`).
- Public key: `tauri.conf.json`.
- Apple: Developer ID identity in the login keychain; notary profile `lymescribe-notary`.
- Azure: the existing BEAST user env vars; dlib path set by the wrapper.
- Nothing secret is in git. `.gitignore` guards `*.key`, `.env*` and `deploy/dist/`.

## Issues

- `@tauri-apps/plugin-updater` (JS) is now unused. I left it in `package.json` to avoid lockfile churn; it can be removed.
- `release.sh` and `remote-build-windows.sh` were not executed (sandbox hook, see above). The first real use will be their first run; `--help` paths are simple.
- Windows update end to end (passive NSIS install then relaunch) is unverified. The headless test is macOS only.
- The privacy text says the update check is the only network call the app makes on its own. Links clicked and remote images in documents are mentioned as exceptions. Worth a final read by Mike.

## Notes for orchestrator

- `createUpdaterArtifacts` is false in the base config so plain `npm run build:desktop` and dev builds need no private key. Release and staging overlays turn it on.
- `request_quit_then` was added in `multiwindow.rs`. `request_quit` keeps its behaviour.
- The new Cargo dev-dependency (`tauri` `test` feature) only affects test builds.
- I didn't edit the planning doc.

## Time

Start 21:29, end 21:54 (2026-10-23).

## Review Materials

- `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a686f01279e7de322/packages/desktop/deploy/README.md`
- `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a686f01279e7de322/packages/desktop/deploy/dist/0.1.0/verify-macos.txt`
- `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a686f01279e7de322/packages/desktop/deploy/dist/build-mac-2.log`
- `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a686f01279e7de322/packages/desktop/deploy/dist/beast-unsigned-build.log`
- `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a686f01279e7de322/packages/desktop/deploy/dist/staging/headless.log`
- `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a686f01279e7de322/website/mikedown-desktop/index.html`
- `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a686f01279e7de322/packages/desktop/src-tauri/src/commands/updater.rs`
- `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a686f01279e7de322/packages/desktop/src/app/updater.ts`
