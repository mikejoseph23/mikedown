# MikeDown Desktop release pipeline

Signed, notarized macOS `.dmg` and a signed Windows NSIS installer, both
self-updating from `https://www.iadev.net/mikedown/` (per-target
`latest-<target>-<arch>.json`, plus the legacy combined `latest.json` that
0.1.x reads). Modeled on `~/git/lymescribe/deploy/`. `release.sh` stages
everything in `deploy/dist/<version>/upload/`; publishing is the separate
`pack-for-lymedeploy.sh` (LymeDeploy project `mikedown-downloads`, defined in
`lymedeploy/deploy.yaml`), and `verify-published.sh` checks the result.

| Script | Runs on | Does |
| --- | --- | --- |
| `release.sh <patch\|minor\|major\|x.y.z>` | Mac | notes confirm, key check, bump + commit, Mac build, Windows build, manifests, stage + gate (`--mac-only`, `--windows-only`, `--dry-run`, `--publish`) |
| `build-mac.sh` | Mac | universal build, Developer ID, notarize + staple app and DMG, updater `.app.tar.gz` + `.sig` |
| `make-dmg.sh` | Mac (GUI session) | styled drag-to-install DMG from a signed app (called by `build-mac.sh`) |
| `remote-build-windows.sh` | Mac | drives the BEAST Scheduled Task, verifies, copies back, makes the updater `.sig` |
| `build-windows.ps1` | BEAST | NSIS build, Trusted Signing via `sign-artifact.ps1` |
| `beast/run-mikedown-build.ps1` | BEAST task | exact-commit checkout, `npm ci`, `build-windows.ps1`, restore, sentinel |
| `sync-version.js` | either | keeps `package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock` in sync (`--check`) |
| `check-core-pin.js` | either | `@mikedown/core` release gate (below) |
| `make-latest-json.js` | Mac | per-target manifests + `latest.json` (full releases only), signatures verified first |
| `check-upload.js` | Mac | gate on the staged folder: every manifest URL present, size, sha256, signature |
| `pack-for-lymedeploy.sh` | Mac | nupkg, push, create-release, deploy to Production, wait, verify (`--dry-run`, `--from-<stage>`) |
| `verify-published.sh <v>` | Mac | post-publish check of www and apex, edge and origin, every artifact and signature |
| `lymedeploy/deploy.yaml` | n/a | the `mikedown-downloads` LymeDeploy project (`lymedeploy apply -f`) |
| `updater-staging-test.sh` | Mac | local end-to-end updater test (N to N+1 from `127.0.0.1`; `--headless` for the CI-style run) |
| `updater-staging-test-windows.sh` | Mac | builds the staging installers on BEAST and runs `updater-staging-test.ps1` on DEVBOX1 |
| `verify-published.js` | Mac | the checks behind `verify-published.sh` (also used with `--base-url` for staging) |
| `key-runbook.md` | n/a | updater signing key: backups (to be confirmed), rotation |

## Styled DMG

`make-dmg.sh` (adapted from LymeScribe's) lays out the install window: 600x400
pt of art below the title bar (the script adds the 28 pt title bar to the window
bounds so none of the art is cut off), 128 px icons, app at 150,196 and the
Applications link at 450,196, hidden toolbar and sidebar. Finder does the layout
through AppleScript, so it needs a logged-in GUI session (a Finder window
flashes open for a few seconds) and cannot run over bare SSH. The layout runs
under a temporary volume name and is renamed to `MikeDown`, so a same-named
volume that is already mounted is left alone. No volume icon is set (LymeScribe
sets none).

Background art lives in `assets/dmg/`: `make-background.py` (Pillow plus the
macOS SF Pro and SF Mono system fonts, run
`python3 assets/dmg/make-background.py`) writes `background.png` (1x, rendered
natively) and `background@2x.png`; `make-dmg.sh` fuses them into a HiDPI TIFF.
The art is a "MikeDown" heading and subtitle, a one-piece gradient arrow in the
icon's periwinkle-to-sky colors, the instruction line, and a faint row of
markdown glyphs along the bottom. It is opaque and light, so Finder's black icon
labels read the same in light and dark appearance. If you move the icons,
change `APP_POS`/`APPS_POS` in `make-dmg.sh` and the `*_ICON_CENTER` constants
in the script together.

To iterate on the look without the 15 minute universal build, restyle an
already stapled app (still signs, notarizes and staples the DMG):

```bash
packages/desktop/deploy/build-mac.sh --dmg-only \
  --app packages/desktop/deploy/dist/0.1.0/MikeDown.app \
  --output packages/desktop/deploy/dist/0.1.0-styled
```

Without `--app` it uses `<output>/MikeDown.app`. It skips the updater payload.

Artifacts are versioned only: `MikeDown-<v>-macos-universal.dmg`,
`MikeDown-<v>-macos-universal.app.tar.gz(.sig)`,
`MikeDown-<v>-windows-x64-setup.exe(.sig)`, plus `latest.json`, `index.html`
(the download page from `website/mikedown-desktop/`), the screenshots it shows
(`screenshot-*.png` next to it) and `web.config`.

## Keys and secrets (none in git)

Backups, rotation and the key runbook: [key-runbook.md](key-runbook.md).

- **Updater signing key (minisign):** `~/.tauri/mikedown.key` on the Mac
  Studio (`michaeljosephwork`), public key in `src-tauri/tauri.conf.json`
  (`plugins.updater.pubkey`, key id `C5386105C2C03AF7`). Its password is in the
  login Keychain, generic password item **`mikedown-updater-key`**
  (`security find-generic-password -s mikedown-updater-key -w`).
  **Back up both** (the key file and the password) somewhere safe, e.g. the
  password manager. Losing either means installed copies can never update
  again: the app only accepts updates signed by this key.
  The key only ever lives on the Mac; the Windows installer is signed for the
  updater after it comes back from BEAST.
- **Apple:** identity `Developer ID Application: INTERAPP DEVELOPMENT, INC.
  (UU626VCLYW)` (`security find-identity -v -p codesigning`). Notarization uses
  a notarytool keychain profile: `mikedown-notary` if stored, else the existing
  `lymescribe-notary` (same team). To make a MikeDown-named one:
  `xcrun notarytool store-credentials mikedown-notary --apple-id <email> --team-id UU626VCLYW --password <app-specific password>`.
- **Windows:** Azure Artifact Signing account `interapp-signing`, profile
  `interapp-public-trust` (`sign-metadata.json`, not secret). The service
  principal's `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_TENANT_ID` are
  the user env vars LymeScribe already uses on BEAST. The wrapper sets
  `MIKEDOWN_SIGN_DLIB` (`C:\tools\ArtifactSigning\bin\x64\Azure.CodeSigning.Dlib.dll`)
  and `MIKEDOWN_SIGN_METADATA` itself.

## One-time setup

**BEAST (RDP console, as `michaeljoseph`):**

1. Replace the M0 tarball snapshot at `C:\git\mikedown` with a clone:
   `Rename-Item C:\git\mikedown mikedown-snapshot; git clone https://github.com/mikejoseph23/mikedown C:\git\mikedown`
   (the build fetches the exact commit from origin).
2. Register the task (one line, PowerShell; `/rp *` prompts for the password):

   ```powershell
   schtasks /create /tn "MikeDownRemoteBuild" /ru michaeljoseph /rp * /rl HIGHEST /f /sc ONCE /st 00:00 /sd 01/01/2020 /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\tools\remote-build\run-mikedown-build.ps1"
   ```

   The task never fires on its own; `remote-build-windows.sh` copies the
   wrapper to `C:\tools\remote-build\` and runs it with `schtasks /run`.
   Why a task: signing over key-auth SSH fails with NTE_PERM (estate-facts
   `beast-signing-ssh-token-blocks-cng`).

**iadev-prod (first release):** create the `/mikedown` virtual directory under
site Interapp (pattern: `C:\WebApps\Downloads\mikedown`, like `/lymedeploy`),
then create the LymeDeploy project from `lymedeploy/deploy.yaml` (its header
has the exact commands). Check with `Get-WebVirtualDirectory -Site Interapp`.

## Core pinning

Release builds (`RELEASE=1`, set by both build scripts) never use the Vite
source alias: `@mikedown/core` resolves through the workspace package to
`packages/core/dist`, and `vite.config.ts` fails the build unless the pin in
`packages/desktop/package.json` equals `packages/core/package.json`'s version.
`check-core-pin.js` also requires that version to be on npm. Core is not
published yet (the core extraction plan's M4), so every release until then
passes `--allow-unpublished-core`, which builds against the workspace copy and
says so. Once core is published, drop the flag; a mismatch or an unpublished
pin then stops the release.

## Minimum OS

macOS 12 (`bundle.macOS.minimumSystemVersion`, `LSMinimumSystemVersion`).
Windows 10 1809 / build 17763: `src-tauri/windows/installer-hooks.nsh` aborts
the NSIS install on older builds. Windows installs per user
(`nsis.installMode: currentUser`), so no UAC prompt. Updates run the installer
with `plugins.updater.windows.installMode: quiet` (no installer window; the app
says "MikeDown will reopen in a moment" and NSIS relaunches it). If the reopen
proves flaky on real machines, switch that value back to `passive`.

## Updater behaviour (edge case 17)

**Cadence.** A silent check runs 10 s after launch, then every 4 h while the
app is open. The checks are claimed once per app, so extra windows don't add
checks. Settings > App > Updates has "Automatically check for updates" (turns
the background checks off) and Check Now.

**Manual check.** Help > Check for Updates… and Check Now both clear any skipped
or snoozed version. They report "Checking for updates…", then the update
window, "MikeDown is up to date (version Y).", or "Couldn't reach the update
server" / "The update feed returned an unexpected response."

**Found notice and window.** A found update shows a non-modal notice with View.
If no MikeDown window is focused, it also posts an OS notification. The plugin
can't report notification clicks, so focusing the app within 10 min of a
notification opens the update window instead.

**Update window buttons.**

- **Skip This Version:** hides that version until a newer one ships.
- **Remind Me Later:** snoozes for 14 days (`DEFAULT_SNOOZE_DAYS`). Escape does the same (Hide, while a download runs).
- **Install and Relaunch:** downloads (with progress), verifies the minisign
  signature and the signed version (`requireSignedVersion`), and runs the normal
  quit dialog for unsaved files. Cancelling that dialog leaves "Update ready.
  Install when you're ready." and keeps the download for the session.

**Pre-install checks.** macOS: `codesign --verify --deep --strict` and Team ID
`UU626VCLYW`. Windows: `WinVerifyTrust` and the expected signer. A failed check
refuses the install and logs why.

Stable channel only. `MIKEDOWN_CHANNEL=store` builds turn the updater off.

**Support: where the files are.** The identifier is `com.interappdev.mikedown`
(`tauri.conf.json`).

| OS | `updater-state.json` (skip and snooze) | `updater.log` |
| --- | --- | --- |
| macOS | `~/Library/Application Support/com.interappdev.mikedown/updater-state.json` | `~/Library/Application Support/com.interappdev.mikedown/logs/updater.log` |
| Windows | `%APPDATA%\com.interappdev.mikedown\updater-state.json` | `%APPDATA%\com.interappdev.mikedown\logs\updater.log` |

The log rolls over to `updater.log.1` past 256 KB. Every check, download,
verification and install outcome is logged. Errors the user never sees (the
silent checks) are logged here and nowhere else.

**Manifest endpoints** (tried in order; the next one is used only after a fetch
or parse failure, not after a bad signature): `https://www.iadev.net/mikedown/latest-{{target}}-{{arch}}.json`,
then the legacy `https://www.iadev.net/mikedown/latest.json`. `{{target}}` is
`darwin` or `windows`, `{{arch}}` is `aarch64` or `x86_64`.

## Staging test (never shipped)

`updater-staging-test.sh` builds version N and N+1 with a config overlay that
points the updater at `http://127.0.0.1:<port>/latest.json`
(`dangerousInsecureTransportProtocol`), serves N+1 locally, and installs N
into a temp folder. The overlay exists only in that script's temp dir; release
builds never pass it, and `build-mac.sh` prints "NOT a release build" when an
overlay is given. `--headless` stops after a Rust-side check, download,
signature verification and install into the temp copy (no window).

Cases (macOS `--headless`, and the same set on Windows via
`updater-staging-test-windows.sh`): per-target N to N+1; per-target 404 falls
back to `latest.json`; tampered artifact; wrong key; downgrade and same
version; replay; offline; skip and snooze; the codesign / Authenticode
pre-checks; a real install over a copy of N. Each case prints PASS, FAIL or
SKIP. Non-admin macOS is a documented hands-on step for T2 (always SKIP here).
Windows relaunch needs an interactive session; without one that case is SKIP.

## Publishing (split releases)

`release.sh` stages and checks `deploy/dist/<v>/upload/`. `pack-for-lymedeploy.sh`
then publishes it through LymeDeploy (`mikedown-downloads`, Production):

1. Pack a `.nupkg` from the staged folder, push, create the release.
2. Deploy: `publish-files` copies into `C:\WebApps\Downloads\mikedown` on
   IADEV-2025 (the `/mikedown` virtual directory). It adds and replaces and
   never prunes. `web.config` is protected, and the manifests are copied last.
3. Smoke-test `latest.json`, `latest-darwin-aarch64.json` and `latest-windows-x86_64.json`
   (the Intel mac file is not smoke-tested; `verify-published.sh` checks it).
4. Purge Cloudflare for the manifest URLs (apex and www) and the download page.
   This step is disabled in `lymedeploy/deploy.yaml` until the `CloudflareToken`
   variable exists (see the note there).
5. `verify-published.sh <v>` checks www and apex, edge and origin, every artifact
   and its signature.

Split-release rule: a Mac-only or Windows-only release changes only its own
per-target files (`--mac-only` / `--windows-only`). `latest.json` moves only
when both platforms ship the same version, so 0.1.x installs never see a
`TargetNotFound`. A platform with no release yet has no file (404, which falls
through to `latest.json`), never an empty block.

Artifacts are not purged: each release has new URLs. Only the manifests and the
download page need a purge. `.sig` files are not published; the signatures live
inside the manifests.

Deploy config changes: `lymedeploy apply -f packages/desktop/deploy/lymedeploy/deploy.yaml --dry-run`
first, then without `--dry-run`. Never pass `--prune`, since Production is shared.

## Rollback

Earlier versions' files stay in place (`publish-files` never prunes). To roll
back, put the previous per-target manifest back (and `latest.json` if it moved),
then purge those URLs on apex and www and run `verify-published.sh` on the
version you rolled back to. Clients only move forward (no downgrades), so a bad
release is fixed by shipping a higher version.
