# MikeDown Desktop release pipeline

Signed, notarized macOS `.dmg` and a signed Windows NSIS installer, both
self-updating from `https://www.iadev.net/mikedown/latest.json`. Modeled on
`~/git/lymescribe/deploy/`. Nothing here uploads, purges, pushes or publishes;
`release.sh` stages everything in `deploy/dist/<version>/upload/` and prints
the checklist.

| Script | Runs on | Does |
| --- | --- | --- |
| `release.sh <patch\|minor\|major\|x.y.z>` | Mac | bump + commit, Mac build, Windows build, `latest.json`, stage upload |
| `build-mac.sh` | Mac | universal build, Developer ID, notarize + staple app and DMG, updater `.app.tar.gz` + `.sig` |
| `make-dmg.sh` | Mac (GUI session) | styled drag-to-install DMG from a signed app (called by `build-mac.sh`) |
| `remote-build-windows.sh` | Mac | drives the BEAST Scheduled Task, verifies, copies back, makes the updater `.sig` |
| `build-windows.ps1` | BEAST | NSIS build, Trusted Signing via `sign-artifact.ps1` |
| `beast/run-mikedown-build.ps1` | BEAST task | exact-commit checkout, `npm ci`, `build-windows.ps1`, restore, sentinel |
| `sync-version.js` | either | keeps `package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock` in sync (`--check`) |
| `check-core-pin.js` | either | `@mikedown/core` release gate (below) |
| `make-latest-json.js` | Mac | updater manifest (Tauri static format) + website `downloads` block |
| `updater-staging-test.sh` | Mac | local end-to-end updater test (N to N+1 from `127.0.0.1`) |

## Styled DMG

`make-dmg.sh` (adapted from LymeScribe's) lays out the install window: 600x400
window, 128 px icons, app at 150,185 and the Applications link at 450,185,
hidden toolbar and sidebar, brand background. Finder does the layout through
AppleScript, so it needs a logged-in GUI session (a Finder window flashes open
for a few seconds) and cannot run over bare SSH. The layout runs under a
temporary volume name and is renamed to `MikeDown`, so a same-named volume that
is already mounted is left alone. No volume icon is set (LymeScribe sets none).

Background art lives in `assets/dmg/`: `make-background.py` (Pillow, run
`python3 assets/dmg/make-background.py`) writes `background.png` (1x) and
`background@2x.png`; `make-dmg.sh` fuses them into a HiDPI TIFF. If you move the
icons, change `APP_POS`/`APPS_POS` in `make-dmg.sh` and the `*_ICON_CENTER`
constants in the script together.

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
(the download page from `website/mikedown-desktop/`) and `web.config`.

## Keys and secrets (none in git)

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
then upload. Check with `Get-WebVirtualDirectory -Site Interapp`.

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
(`nsis.installMode: currentUser`), so no UAC prompt; updates run the installer
in passive mode.

## Updater behaviour (edge case 17)

Silent check at launch (Settings > App, "Check for updates on launch") and
every 24 h, once per app however many windows are open. Every outcome goes to
`<app-data>/logs/updater.log` (`~/Library/Application Support/com.interappdev.mikedown/logs/`,
`%APPDATA%\com.interappdev.mikedown\logs\`); silent errors are swallowed.
Help > Check for Updates… reports up to date / available / could not check.
"Update available" toast: Restart Now downloads, verifies the minisign
signature and the signed version (`requireSignedVersion`), runs the normal
quit dialog for unsaved files, installs and relaunches; Later hides it until
the next check. Stable channel only.

## Staging test (never shipped)

`updater-staging-test.sh` builds version N and N+1 with a config overlay that
points the updater at `http://127.0.0.1:<port>/latest.json`
(`dangerousInsecureTransportProtocol`), serves N+1 locally, and installs N
into a temp folder. The overlay exists only in that script's temp dir; release
builds never pass it, and `build-mac.sh` prints "NOT a release build" when an
overlay is given. `--headless` stops after a Rust-side check, download,
signature verification and install into the temp copy (no window).

## Rollback

Leave earlier versions' files in place; put the previous `latest.json` back
and purge Cloudflare for it. Clients only move forward (no downgrades), so a
bad release is fixed by shipping a higher version.
