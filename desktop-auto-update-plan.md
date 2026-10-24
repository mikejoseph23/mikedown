# MikeDown Desktop Auto Update (LymeScribe parity) — Planning Document

## Summary

**Purpose.** Bring MikeDown Desktop's self-update up to the behavior LymeScribe ships on macOS and Windows: the same prompt (release notes, Skip This Version, Remind Me Later, Install and Relaunch), the same cadence and manual-check feedback, the same manifest discipline (per-platform versions so split releases are safe), and the same publish path (LymeDeploy to `iadev.net/<product>/`, Cloudflare purge, post-publish verification). It must work on both OSes and must never strand an installed 0.1.0.

**Approach in one line.** Keep `tauri-plugin-updater` (minisign) as the engine on both OSes and rebuild LymeScribe's UX and release discipline on top of it. Do not adopt Sparkle or a custom Windows installer runner: the plugin already does what those do for LymeScribe (verify, swap or run the installer, relaunch), and switching engines would need a second key and a bridge release (see [Gap analysis](#gap-analysis)).

**Key objectives**

- Sparkle-style update window on both OSes, with release notes and persisted Skip / Remind Me Later.
- Download progress, a clear installing state, and a relaunch on the new version.
- Per-platform manifests so a Mac-only or Windows-only release never nags or breaks the other OS.
- One-command publish through LymeDeploy with the Cloudflare purge and a verification pass.
- A test harness covering N to N+1 on both OSes, tampered artifact, wrong key, offline, downgrade and replay refusal, and 0.1.0 continuity.

**Critical success factors**

- Every release stays signed with the existing minisign key (`~/.tauri/mikedown.key`, key id `C5386105C2C03AF7`) and `https://www.iadev.net/mikedown/latest.json` keeps serving a valid manifest, because both are baked into 0.1.0.
- The update never loses unsaved work (the existing quit handshake stays in the path).
- No failure mode tells the user "up to date" when it isn't, and silent checks never pop errors.

**Defaults applied without asking:** incremental testing, automated tests first, no Playwright, no screenshots (one hands-on pass per OS instead), no schema milestone (no database), model per milestone recommended below.

### Milestone Progress Tracker

| Milestone | Model | Status | Duration (min) | Notes |
|---|---|---|---|---|
| [U1 — Updater engine: state, cadence, progress, channel](#u1--updater-engine-state-cadence-progress-channel) | Sonnet | ⬜ Not Started | — | Rust + TS logic, no UI |
| [U2 — Update window and settings UI](#u2--update-window-and-settings-ui) | Opus | ⬜ Not Started | — | Sparkle-style window, both OSes |
| [T1 — Engine and UI tests](#t1--engine-and-ui-tests) | Sonnet | ⬜ Not Started | — | vitest, cargo, e2e |
| [U3 — Manifests, hosting and release pipeline](#u3--manifests-hosting-and-release-pipeline) | Opus | ⬜ Not Started | — | touches `deploy/`; wait for the DMG styling worker |
| [U4 — Staging harness: adversarial and continuity cases](#u4--staging-harness-adversarial-and-continuity-cases) | Sonnet | ⬜ Not Started | — | macOS + Windows staging |
| [T2 — Release verification on both OSes](#t2--release-verification-on-both-oses) | Sonnet | ⬜ Not Started | — | hands-on, Mike signs off |
| [U5 — Docs and runbooks](#u5--docs-and-runbooks) | Haiku | ⬜ Not Started | — | README, key backup and rotation |

---

## Table of Contents

- [Summary](#summary)
- [Research: how LymeScribe updates](#research-how-lymescribe-updates)
- [Research: MikeDown today (M10)](#research-mikedown-today-m10)
- [Gap analysis](#gap-analysis)
- [Architecture](#architecture)
- [Update UX (both OSes)](#update-ux-both-oses)
- [Channels](#channels)
- [Manifest and hosting layout](#manifest-and-hosting-layout)
- [Signing and key continuity](#signing-and-key-continuity)
- [Open questions](#open-questions)
- [U1 — Updater engine: state, cadence, progress, channel](#u1--updater-engine-state-cadence-progress-channel)
- [U2 — Update window and settings UI](#u2--update-window-and-settings-ui)
- [T1 — Engine and UI tests](#t1--engine-and-ui-tests)
- [U3 — Manifests, hosting and release pipeline](#u3--manifests-hosting-and-release-pipeline)
- [U4 — Staging harness: adversarial and continuity cases](#u4--staging-harness-adversarial-and-continuity-cases)
- [T2 — Release verification on both OSes](#t2--release-verification-on-both-oses)
- [U5 — Docs and runbooks](#u5--docs-and-runbooks)
- [Risks](#risks)
- [Parallel Development Recommendations](#parallel-development-recommendations)
- [Progress Log / Notes](#progress-log--notes)

---

## Research: how LymeScribe updates

Sources: `~/git/lymescribe/deploy/CHANNELS.md`, `docs/deployment.md`, `docs/auto-updater.md`, `deploy/updates/*`, `deploy/updates-personal/BRIDGE.md`, `src/LymeScribe/LymeScribeMacShared/SharedSparkleUpdateService.swift`, `src/LymeScribe.Core/Services/UpdateService.cs`, `src/LymeScribe.Wpf/Platform/MsiUpdateInstaller.cs`, `src/LymeScribe.Wpf/Views/UpdateWindow.xaml`.

**macOS (Sparkle 2).**

- `Info.plist`: `SUFeedURL https://iadev.net/lymescribe/appcast.xml`, `SUPublicEDKey` (Ed25519), `SUEnableAutomaticChecks`, `SUScheduledCheckInterval 14400`.
- Sparkle's own scheduler is switched **off**. A custom timer (first check 10 s after launch, then every 4 h) fetches `latest.json`, compares the **`mac.version`** block (not the top-level version), honors skip and snooze, and only then calls `checkForUpdatesInBackground()`. That gate exists because the appcast is bumped on Windows-only releases too; without it, split releases nag.
- Sparkle's standard window is the only update UI: HTML release notes from the appcast, Install Update / Skip This Version / Remind Me Later, download progress, Ed25519 verification, install, relaunch. A Skip choice is mirrored into LymeScribe's own skipped-version setting.
- Manual "Check for Updates…" clears skip and snooze, then asks Sparkle directly.
- A dev feed override is honored only for `localhost` / `127.0.0.1` / `::1`.

**Windows (custom C# updater).**

- `UpdateService` fetches `latest.json` on startup (1 h throttle) and every 4 h; reads the `windows` block, preferring its per-platform `version`; treats a block with an empty `sha256` as a placeholder, never as a release.
- Skip This Version (persisted, version-specific), Remind Me Later (snooze 14 days, any version), manual check clears both and bypasses the throttle.
- Manual outcomes: "You're up to date", "Couldn't reach the update server…", "The update feed returned an unexpected response…". Silent checks never show errors.
- Update window: "A new version of LymeScribe is available", "LymeScribe X is available", a major-update note, "What's new" notes, then Remind Me Later / Install and Relaunch / Skip This Version; status "Downloading update…" with progress, "Verifying and installing…", and on failure "The update couldn't be installed. Please try again, or download it from the website."
- An OS notification is posted when an update is found.
- Install: verify SHA-256 from the manifest (no signature on the manifest), write a hidden PowerShell helper that waits for the app to exit, runs `msiexec /qn` elevated (perMachine MSI, one UAC prompt), relaunches the app unelevated, and deletes itself. The user sees the app blink and come back.

**Manifests and hosting.**

- `latest.json`: top-level `version` plus per-platform blocks (`windows`, `mac`, `linux`, …) each with `version`, `url`, `size`, `sha256`, `releaseNotes`, and `minimumSystemVersion` for mac. `appcast.xml` is Sparkle RSS with `sparkle:edSignature`.
- Artifacts use versioned filenames only; old versions stay in place so rollback is a manifest swap.
- Host: IIS on `iadev-prod`, `C:\WebApps\Interapp\lymescribe`, Cloudflare-fronted with a ~4 h edge cache. `web.config` adds CORS (`*`, for the product site) and MIME maps for extensions IIS 404s on (`.pkg`, `.AppImage`).
- Publish: `release.sh` chains `stage-release.sh --remote-msi` → `pack-for-lymedeploy.sh` (nupkg) → LymeDeploy `create-release` → `deploy`, and blocks until the deployment is terminal. It shows the release notes and makes Mike confirm them before building. The Cloudflare purge is a LymeDeploy step that exists but is disabled until `CloudflareZoneId` and a sensitive `CloudflareToken` exist; until then it is a dashboard click, with a cache-buster `curl` to verify.
- Windows signing: Azure Trusted Signing via `sign-artifact.ps1` on BEAST, through a Scheduled Task (SSH key sessions fail with `NTE_PERM`).

**Channels.** LymeScribe's "channels" are **distribution** channels set at compile time (`CHANNEL_MAC_DIRECT`, `CHANNEL_WINDOWS_DIRECT`, `CHANNEL_MS_STORE`). A store channel makes the updater fully inert and hides Check for Updates. There is no beta or stable/personal release train; `updates-personal/` is a one-time **bridge feed** that served the unified app, signed with the old Personal key at the old URL, so old installs could migrate.

[Return to Top](#mikedown-desktop-auto-update-lymescribe-parity--planning-document)

---

## Research: MikeDown today (M10)

Sources: `desktop-app-plan.md` M10 and the 2026-10-23 log, `packages/desktop/src/app/updater.ts`, `src/ui/updateToast.ts`, `src-tauri/src/commands/updater.rs`, `src-tauri/tauri.conf.json`, `deploy/README.md`.

- Engine: `tauri-plugin-updater` 2.14, minisign pubkey in `tauri.conf.json`, endpoint `https://www.iadev.net/mikedown/latest.json`, `requireSignedVersion: true` (the signature binds the version, so an old artifact can't be replayed under a higher version), Windows `installMode: passive`, NSIS per-user.
- Cadence: launch check if `updates.checkOnLaunch`, then once per 24 h for the whole app (`updater_claim`). Every outcome logged to `<app-data>/logs/updater.log`.
- UX: a bottom-right toast "Update available, MikeDown X is ready to install (you have Y)" with Later / Restart Now. Later lasts for the session only. No release notes shown, no Skip, no snooze, no progress (a "Downloading…" toast), no OS notification. Manual check reports up to date / available / could not check.
- Install: download and verify, then the multi-window quit handshake (dirty-file dialogs, sessions), then `install` and `request_restart`; a cancelled dialog keeps the update pending.
- Manifest: Tauri static format (`version`, `notes`, `pub_date`, `platforms.{darwin-aarch64,darwin-x86_64,windows-x86_64}.{signature,url}`), generated by `deploy/make-latest-json.js`.
- Publish: `release.sh` stages `deploy/dist/<v>/upload/`; upload is manual RDP, purge manual, no verification step.
- 0.1.0 RC artifacts are built (signed DMG, signed NSIS); T4 is with Mike.

[Return to Top](#mikedown-desktop-auto-update-lymescribe-parity--planning-document)

---

## Gap analysis

| Piece | LymeScribe | MikeDown now | Decision | Why |
|---|---|---|---|---|
| Mac engine | Sparkle 2, EdDSA appcast | plugin, minisign | **Keep the plugin** | It verifies, swaps the `.app` (with an admin-privileges fallback for a non-writable `/Applications`), and relaunches. Sparkle in Tauri needs a native bridge plus a second key and an appcast, and 0.1.0 can only ever accept a plugin update, so a Sparkle switch still ships through the plugin first. Two engines, two keys, no user-visible gain. |
| Windows engine | custom C#: SHA-256, elevated `msiexec /qn` helper, relaunch | plugin runs NSIS `/P` (passive), app exits, NSIS relaunches | **Keep the plugin**, switch to `quiet` (open question) | Per-user NSIS needs no UAC, so `quiet` gives LymeScribe's "blink and come back" without the PowerShell helper. Minisign is stronger than LymeScribe's unsigned-manifest SHA-256. |
| Windows Authenticode pre-check | none (relies on SHA-256) | none | **Add** (defense in depth) | Before handing the downloaded `.exe` to the plugin, check `WinVerifyTrust` and that the signer is Interapp Development, Inc. Cheap, and it catches a key compromise that minisign alone would not. |
| Mac code-signature pre-check | Sparkle checks the new app's code signature matches | none | **Add** (best effort) | After download, `codesign --verify` the extracted app and compare Team ID `UU626VCLYW` before swap, if the plugin exposes the staged path; otherwise document as not possible and rely on minisign. |
| Update window | Sparkle window / WPF window with notes and three buttons | toast, two buttons | **Rebuild** in the webview | Same wording and button set on both OSes; see [Update UX](#update-ux-both-oses). |
| Release notes | HTML (mac), plain text (win) | not shown | **Add** | Plugin `notes` (markdown), rendered sanitized in the window. |
| Skip This Version | persisted | none | **Add** | Persist in `<app-data>/updater-state.json`. |
| Remind Me Later | 14-day snooze, persisted | session-only | **Add** | Same 14-day default. |
| Manual check clears skip/snooze | yes | n/a | **Add** | |
| Cadence | 10 s after launch, then every 4 h; win 1 h throttle | launch, then 24 h | **Match: 4 h** (open question) | Plugin `check()` is a single small GET. |
| Auto-check toggle | yes | `updates.checkOnLaunch` (launch only) | **Rename in UI** to "Automatically check for updates", keep the key | No settings migration. |
| Progress | percent bar | "Downloading…" toast | **Add** | The plugin's download callback reports chunk and total. |
| OS notification | yes (win) | none | **Add, only when no MikeDown window is focused** | Avoids double prompting. |
| Major-update note | yes | none | **Add** | Major version bump shows one line. |
| Per-platform versions / split releases | `latest.json` per-platform `version` + placeholder rule | one top-level version | **Per-target manifests** via the plugin's `{{target}}` URL template, legacy `latest.json` kept for 0.1.x | See [Manifest and hosting layout](#manifest-and-hosting-layout). |
| Store channel kill switch | compile-time `Channel`, updater inert | none | **Add** a build-time `MIKEDOWN_CHANNEL` (`direct` default, `store` inert) | Free now, needed for any future store build. |
| Beta channel | none | none | **Don't add** (open question) | LymeScribe has none. |
| Dev feed override | localhost only | build-time staging overlay | **Keep the overlay** | Already stricter: no shipped switch at all. |
| Publish | LymeDeploy pack → release → deploy, blocking | manual RDP | **Adopt LymeDeploy** | Same server, agent already polls outbound. |
| Cloudflare purge | built, disabled pending token | manual | **Purge by API** for apex and `www` forms of every manifest URL | `www.iadev.net` is what 0.1.0 calls. |
| Release-notes confirmation | `release.sh` shows and confirms | none | **Add** | Stale notes are the one silent failure. |
| Post-publish verification | cache-buster `curl` | none | **Add** a scripted verify | Fetch each manifest, verify each signature against the pubkey, HEAD each URL for 200 and the right length. |
| Bridge feed pattern | Personal → unified | n/a | **Reuse the idea** for any future key or endpoint change | See [Signing and key continuity](#signing-and-key-continuity). |
| Delta updates, install-on-quit | Sparkle supports both, LymeScribe uses neither | none | **Skip** | Not part of LymeScribe's behavior; artifacts are ~6 MB. |

[Return to Top](#mikedown-desktop-auto-update-lymescribe-parity--planning-document)

---

## Architecture

```
webview (each window)                          Rust host (one per app)
─────────────────────                          ────────────────────────
updater.ts  controller (state machine)  ──▶   commands/updater.rs
  idle → available → downloading →              claim(interval)        4 h, app-wide
  verifying → installing | failed               check(manual)          plugin check(), skip/snooze filter
updateWindow.ts  (U2, replaces toast)  ◀──      install()              download (progress events),
  notes, progress, Skip / Later / Install         + platform pre-check   Authenticode / codesign check,
appTab Settings: auto-check, last checked         + quit handshake       quit handshake, install, restart
                                                state: updater-state.json  skippedVersion, snoozeUntil,
                                                                           lastCheckedAt, lastResult
events: mikedown:update-available, mikedown:update-progress, mikedown:update-state
```

- Skip and snooze are filtered in Rust, so every window sees the same decision and a silent check never announces a skipped version. A manual check clears both before checking (LymeScribe semantics).
- `updater-state.json` is app state, not a setting: it lives in `<app-data>/`, is never written into `settings.json`, and a corrupt file is treated as empty (logged).
- The engine choice per OS is the same code path; OS differences are the install mode and the pre-install signature check.

[Return to Top](#mikedown-desktop-auto-update-lymescribe-parity--planning-document)

---

## Update UX (both OSes)

Wording follows LymeScribe, adapted to MikeDown's existing voice. One window design on both OSes, styled with the desktop chrome tokens (light and dark).

1. **Found (silent check).** A small non-modal notice, "MikeDown X is available", with **View** (opens the window) and a close button (equals Remind Me Later only if the user closes the window too; closing the notice alone just hides it for the session). If no MikeDown window is focused, also post an OS notification; clicking it opens the window.
2. **Update window** (modal to the window it opens in):
   - Title "A new version of MikeDown is available"; subtitle "MikeDown X is available. You have Y."
   - Major bump: "This is a major update and may include important changes."
   - "What's new": the release notes rendered from markdown, sanitized, scrollable; "No release notes were provided for this version." when empty.
   - Buttons: **Skip This Version** (left), **Remind Me Later**, **Install and Relaunch** (primary, default).
3. **Install and Relaunch.** Buttons give way to a progress bar: "Downloading update… 42%", then "Verifying…". Then the existing quit handshake (dirty-file dialogs). Cancelled: back to the window with "Update ready. Install when you're ready." and the button re-enabled; the download is kept for the session. Approved: macOS swaps and relaunches; Windows shows "Installing. MikeDown will reopen in a moment." then exits, and NSIS relaunches.
4. **Failure.** "The update couldn't be installed. Please try again, or download it from the MikeDown website." with a link to `https://www.iadev.net/mikedown/`. Details go to `updater.log`.
5. **Manual check** (Help > Check for Updates…, Settings > App > Check Now): clears skip and snooze; "Checking for updates…", then the window, or "MikeDown is up to date (version Y).", or "Couldn't reach the update server. Check your connection and try again." / "The update feed returned an unexpected response. Try again later."
6. **Settings > App > Updates:** "Automatically check for updates" toggle, "Last checked: <relative time>", Check Now.

[Return to Top](#mikedown-desktop-auto-update-lymescribe-parity--planning-document)

---

## Channels

- One release train (stable), matching LymeScribe.
- Build-time `MIKEDOWN_CHANNEL`: `direct` (default; updater live) or `store` (updater never initialized, Check for Updates hidden, Settings Updates group hidden). Set through the Tauri config overlay or a Cargo feature, read in one place on each side.
- A beta train can be added later as a second endpoint template (`beta/latest-{{target}}.json`); out of scope unless Mike asks.

[Return to Top](#mikedown-desktop-auto-update-lymescribe-parity--planning-document)

---

## Manifest and hosting layout

**Endpoints in 0.2.0+ builds** (tried in order; the plugin falls through only on fetch or parse failure):

```
https://www.iadev.net/mikedown/latest-{{target}}-{{arch}}.json   per-target, authoritative
https://www.iadev.net/mikedown/latest.json                       legacy combined, 0.1.x
```

The exact template needs checking against the plugin's `{{target}}` / `{{arch}}` values (`darwin`/`windows`, `aarch64`/`x86_64`) in U3; the per-target file keeps the Tauri static format with one `platforms` entry, so its `version` is that platform's version (LymeScribe's per-platform `version`).

**Folder `iadev.net/mikedown/`** (IIS `C:\WebApps\Interapp\mikedown`, Cloudflare-fronted):

```
latest.json                                  legacy combined; bumped only on full releases
latest-darwin-aarch64.json                   per-target
latest-darwin-x86_64.json
latest-windows-x86_64.json
MikeDown-<v>-macos-universal.dmg             download page
MikeDown-<v>-macos-universal.app.tar.gz      updater artifact (mac)
MikeDown-<v>-windows-x64-setup.exe           download page + updater artifact (win)
index.html                                   download page (rewrites from a manifest)
web.config                                   MIME maps only if verification shows a 404
```

- Each per-target manifest also carries LymeScribe's `sha256` and `size` as extra fields (the plugin ignores unknown fields; the download page and the verify script use them).
- **Split release rule:** a Mac-only release rewrites only the two darwin files and leaves `latest.json` alone; same for Windows. `latest.json` moves only when both platforms ship the same version. A 0.1.x install on the platform that didn't ship sees no change, never a `TargetNotFound`.
- **Placeholder rule:** a platform with no release yet has no file (404 → falls through to `latest.json`), never an empty block.
- **Rollback:** put the previous per-target file back and purge. Clients only move forward, so the real fix is a higher version.
- **Purge:** every manifest URL in both apex and `www` forms, by API (token scoped to purge), then verify with a cache-buster.

[Return to Top](#mikedown-desktop-auto-update-lymescribe-parity--planning-document)

---

## Signing and key continuity

- **Minisign key** (`~/.tauri/mikedown.key`, password in Keychain item `mikedown-updater-key`, id `C5386105C2C03AF7`): every release, forever, until a deliberate rotation. Backing it up is still open from M10 and is a **blocker for publishing 0.1.0** (U5 checks it off with Mike).
- **Rotation (if ever needed):** release N signed with the old key that ships the new pubkey; every later release signed with the new key. Installs that skip N can't jump straight to N+1, so N's per-target files stay published under the old key as a bridge (LymeScribe's Personal bridge pattern). Documented in U5, not built.
- **Endpoint continuity:** `https://www.iadev.net/mikedown/latest.json` must keep answering with a manifest signed by the current key. Never redirect it to the apex in a way that drops the body; never let it lapse.
- **`requireSignedVersion`:** keep it on. Release signing must keep producing version-bearing signatures (U3 asserts this in the verify script).
- **Authenticode / notarization:** unchanged from M10 (Trusted Signing on BEAST via the Scheduled Task; Developer ID + notarytool on the Mac). U1 adds the client-side check of both.

[Return to Top](#mikedown-desktop-auto-update-lymescribe-parity--planning-document)

---

## Open questions

Answer before dispatching U1 and U3. Each has a recommended default that the plan already assumes.

1. **Mac engine: plugin with Sparkle-style UX, or real Sparkle?** Recommend the plugin (see Gap analysis). Real Sparkle means a native bridge, an EdDSA key and appcast alongside minisign, and a plugin-delivered bridge release for 0.1.0.
2. **Windows install mode: `quiet` (LymeScribe parity, app blinks and returns) or keep `passive` (NSIS progress window)?** Recommend `quiet` with the in-app "MikeDown will reopen in a moment" line.
3. **Publish via LymeDeploy with the Cloudflare purge enabled?** Recommend yes: a `mikedown-downloads` LymeDeploy project and a purge-only Cloudflare token (LastPass), which also unblocks LymeScribe's disabled purge step.
4. **Check cadence: 4 h (LymeScribe) or keep 24 h?** Recommend 4 h.
5. **Beta channel?** Recommend no.
6. **Remind Me Later length: 14 days (LymeScribe) or shorter?** Recommend 14 days.
7. **OS notification on a found update?** Recommend yes, only when no MikeDown window is focused.

[Return to Top](#mikedown-desktop-auto-update-lymescribe-parity--planning-document)

---

## U1 — Updater engine: state, cadence, progress, channel

**Recommended model:** Sonnet. Well-defined Rust and TS changes around an existing module; Opus if the Authenticode check gets hairy.

**Files:** `packages/desktop/src-tauri/src/commands/updater.rs`, `src-tauri/tauri.conf.json` (`plugins.updater`), `src-tauri/Cargo.toml`, `packages/desktop/src/app/updater.ts`, `src/app/updaterApi.ts`, `src/main.ts`.

> **Worker requirement:** complete ALL items. If one should be deferred, say so in your summary but still attempt it unless truly blocked.

- [ ] `updater-state.json` in `<app-data>/`: `skippedVersion`, `snoozeUntil`, `lastCheckedAt`, `lastResult`; atomic write; corrupt or missing file reads as empty and is logged.
- [ ] Skip and snooze filtering in `updater_check` for silent checks; manual checks clear both first.
- [ ] New commands `updater_skip(version)`, `updater_snooze(days)` (default 14), `updater_status()` (for the Settings "Last checked" line).
- [ ] Cadence: first silent check 10 s after launch, then every 4 h, still one claim per app; constants in one place.
- [ ] Download progress: emit `mikedown:update-progress { downloaded, total }` (throttled to ~10/s) from the plugin's chunk callback; keep the verified bytes for the session so a cancelled quit dialog doesn't re-download.
- [ ] Controller states `idle → available → downloading → verifying → ready → installing | failed`, exposed to the UI; a manual check while downloading does not restart the download.
- [ ] Windows: `installMode` per the open question (default `quiet`); emit `installing` before the plugin exits the app so the UI can show the reopen line.
- [ ] Windows pre-install check: `WinVerifyTrust` on the downloaded `.exe` plus signer subject `Interapp Development, Inc.`; on failure log, refuse, and surface the install-failed message. Unit-test the subject matcher.
- [ ] macOS pre-install check: if the plugin exposes the extracted app before the swap, `codesign --verify --deep --strict` and Team ID `UU626VCLYW`; if not, log the limitation in the summary and skip.
- [ ] Endpoints: per-target template first, legacy `latest.json` second (exact template confirmed against the plugin's target and arch strings).
- [ ] Channel: `MIKEDOWN_CHANNEL=store` leaves the updater uninitialized and hides Check for Updates; default `direct`.
- [ ] Keep the existing `updater.log` lines and add skip, snooze, progress-complete, pre-check results.
- [ ] Rust unit tests for state file read/write/corrupt, skip/snooze filter, cadence claim; TS unit tests for the controller transitions.
- [ ] Commit.

[Return to Top](#mikedown-desktop-auto-update-lymescribe-parity--planning-document)

---

## U2 — Update window and settings UI

**Recommended model:** Opus (front-end design work).

**Files:** new `packages/desktop/src/ui/updateWindow.ts` (+ CSS), retire or reduce `src/ui/updateToast.ts` to the found-notice, `src/settings/appActions.ts` and the App tab section, Help menu label.

> **Worker requirement:** complete ALL items. If one should be deferred, say so in your summary but still attempt it unless truly blocked.

Design bar: this should feel like a native macOS Software Update sheet or VS Code's own update notification, not a generic web modal. Use the chrome's existing tokens, a clear hierarchy (title, version line, notes, actions), comfortable spacing, a quiet progress bar, subtle transitions that respect `prefers-reduced-motion`, and correct `forced-colors` behavior.

- [ ] Found-notice (non-modal, bottom-right, replaces today's toast): "MikeDown X is available" with View and close.
- [ ] Update window per [Update UX](#update-ux-both-oses): title, subtitle, major-update line, "What's new" rendered from markdown and sanitized (no scripts, no remote images, links open in the browser), empty-notes text.
- [ ] Buttons Skip This Version / Remind Me Later / Install and Relaunch, keyboard order and default button correct, Escape equals Remind Me Later.
- [ ] Progress and states: downloading with percent, verifying, ready (after a cancelled quit dialog), installing (Windows reopen line), failed with the website link.
- [ ] OS notification when no window is focused (`tauri-plugin-notification`, permission requested lazily); clicking it opens the window.
- [ ] Settings > App > Updates: "Automatically check for updates" (existing `updates.checkOnLaunch` key), "Last checked", Check Now; hidden in the store channel.
- [ ] Manual-check feedback strings per [Update UX](#update-ux-both-oses).
- [ ] ARIA: `alertdialog` for the window, live region for progress, focus returns to the previous element on close.
- [ ] Commit.

[Return to Top](#mikedown-desktop-auto-update-lymescribe-parity--planning-document)

---

## T1 — Engine and UI tests

**Recommended model:** Sonnet. **Modes:** unit/integration (vitest, cargo) and the existing desktop e2e harness. No screenshots; the look is judged in T2's hands-on pass.

> **Worker requirement:** complete ALL items. If one should be deferred, say so in your summary but still attempt it unless truly blocked.

- [ ] cargo: state file round trip, corrupt file, skip filters only the skipped version, snooze expiry, manual check clears both, claim at 4 h.
- [ ] cargo (mock runtime, extends `tests/updater_staging.rs`): progress events emitted and monotonic; per-target endpoint 404 falls through to `latest.json`; manifest missing this target surfaces an error only on manual checks.
- [ ] vitest: controller transitions including cancel-at-quit-dialog → ready, failure → failed, manual check during download.
- [ ] vitest: notes sanitizer strips `<script>`, event handlers and remote images; empty notes text.
- [ ] e2e: window opens from the notice, Skip persists across relaunch (stub host), Remind Me Later hides until snooze end, keyboard path through the three buttons.
- [ ] Write the tests, then run desktop tsc, unit, e2e and cargo green; report counts.
- [ ] Commit.

[Return to Top](#mikedown-desktop-auto-update-lymescribe-parity--planning-document)

---

## U3 — Manifests, hosting and release pipeline

**Recommended model:** Opus. Release engineering; mistakes reach customers.

**Files:** `packages/desktop/deploy/make-latest-json.js`, `lib/release-lib.js`, `release.sh`, new `pack-for-lymedeploy.sh`, new `verify-published.sh`, `web.config` if needed. **Do not start until the DMG styling worker's `deploy/` changes are merged.** Hard limits: no publish to Production, no purge, no push without Mike's go-ahead in this run.

> **Worker requirement:** complete ALL items. If one should be deferred, say so in your summary but still attempt it unless truly blocked.

- [ ] `make-latest-json.js`: write per-target files (`latest-<target>-<arch>.json`) with `sha256` and `size` extras; write combined `latest.json` only for full releases; unit tests for both and for the split-release rule.
- [ ] `release.sh`: `--mac-only` / `--windows-only`; show the release notes and require confirmation (`--yes` to skip), as LymeScribe does; refuse to sign without the minisign key and refuse a signature that lacks the signed version.
- [ ] `pack-for-lymedeploy.sh` modeled on LymeScribe's: pack `upload/` into a nupkg, push, `create-release`, `deploy` to a `mikedown-downloads` project, block until terminal, `--dry-run`, `--from-<stage>` resume.
- [ ] LymeDeploy project definition (documented for Mike to create if the CLI can't): `publish-files` to `C:\WebApps\Interapp\mikedown`, never deleting older versions; purge step covering apex and `www` for every manifest URL, disabled until the token variables exist.
- [ ] `verify-published.sh <version>`: cache-busted fetch of each manifest, minisign-verify each signature against the `tauri.conf.json` pubkey, version-in-signature check, HEAD each artifact URL for 200 and matching length, and confirm `www` and apex agree.
- [ ] IIS MIME check: confirm `.tar.gz`, `.exe`, `.dmg`, `.json` serve (200, not 404) from `iadev.net/mikedown/`; add `web.config` maps only for what fails, without `<remove>` guards for unmapped types (LymeScribe gotcha).
- [ ] Download page reads the Windows and Mac per-target manifests (falls back to `latest.json`).
- [ ] Unit tests for `release-lib.js` changes; `release.sh --dry-run` end to end green.
- [ ] Commit.

[Return to Top](#mikedown-desktop-auto-update-lymescribe-parity--planning-document)

---

## U4 — Staging harness: adversarial and continuity cases

**Recommended model:** Sonnet.

**Files:** `packages/desktop/deploy/updater-staging-test.sh` (after U3 merges), a PowerShell counterpart for Windows staging on DevBox1 or BEAST.

> **Worker requirement:** complete ALL items. If one should be deferred, say so in your summary but still attempt it unless truly blocked.

- [ ] macOS headless cases (local `127.0.0.1` server, staging overlay): N to N+1 via the per-target file; per-target 404 falls back to `latest.json`; tampered artifact rejected; manifest signed with a different key rejected; downgrade (manifest version lower than running) offers nothing; replay (N-1 artifact and signature under an N+1 version) rejected by `requireSignedVersion`; offline (server down) logs and stays silent; skipped version not announced on a silent check.
- [ ] Continuity: the real 0.1.0 build (from `deploy/dist/0.1.0/`) updates to a staging N+1 through the **legacy `latest.json` path only**, on both OSes.
- [ ] Windows staging script: install N per-user, serve N+1 locally, trigger the update, confirm N+1 runs after relaunch (`quiet` mode), and that a tampered or unsigned `.exe` is refused by the Authenticode pre-check.
- [ ] Non-admin macOS case documented as a T2 hands-on step (the harness can't fake the admin prompt).
- [ ] Every case prints PASS/FAIL; the script exits non-zero on any FAIL. Run both OSes and paste results in the summary.
- [ ] Commit.

[Return to Top](#mikedown-desktop-auto-update-lymescribe-parity--planning-document)

---

## T2 — Release verification on both OSes

**Recommended model:** Sonnet (orchestrates; Mike does the hands-on). **Modes:** U4's harness re-run green, then one hands-on pass per OS. The visual judgment of the update window is folded into this pass; no screenshots.

> **Worker requirement:** complete ALL items. If one should be deferred, say so in your summary but still attempt it unless truly blocked.

- [ ] Re-run `packages/desktop/deploy/updater-staging-test.sh` (macOS) and the Windows staging script; all PASS.
- [ ] Build a staging N and N+1 (`updater-staging-test.sh --keep`, which prints the install path and server URL); hand Mike the exact paths.
- [ ] **macOS hands-on** (Mac Studio, Mike's non-admin account; N installed into `/Applications` by `macadmin`): launch N from `/Applications/MikeDown.app`; within ~10 s the "MikeDown N+1 is available" notice appears bottom-right → View → window shows notes and the three buttons in light and dark (toggle with the theme button) → Remind Me Later, relaunch, no notice → Help > Check for Updates… shows the window again → open a file, type, leave it dirty → Install and Relaunch → progress bar → dirty-file dialog → Cancel keeps the app open with "Update ready" → Install again → Save → admin password prompt appears (non-writable `/Applications`) → app relaunches; Help > About shows N+1.
- [ ] **Windows hands-on** (DevBox1 over RDP, per-user install): same walk, plus Skip This Version then relaunch (no notice) then Check for Updates (window back); Install and Relaunch shows "MikeDown will reopen in a moment", app closes and reopens on N+1 within ~15 s with no UAC prompt.
- [ ] Mike signs off (orchestrator pauses here).
- [ ] After sign-off and Mike's go-ahead: first real publish through `release.sh` and LymeDeploy, purge, `verify-published.sh` green, and a 0.1.0 install on each OS updates from production.

[Return to Top](#mikedown-desktop-auto-update-lymescribe-parity--planning-document)

---

## U5 — Docs and runbooks

**Recommended model:** Haiku. Mechanical once U1 to U4 land.

> **Worker requirement:** complete ALL items. If one should be deferred, say so in your summary but still attempt it unless truly blocked.

- [ ] `packages/desktop/deploy/README.md`: updater behavior rewritten for the new UX and cadence, manifest layout, split-release rule, LymeDeploy publish, purge, verify, rollback.
- [ ] Key runbook: backup locations for `~/.tauri/mikedown.key` and its Keychain password, confirmed with Mike (checkbox stays open until he confirms); rotation procedure with the bridge pattern.
- [ ] `updater-state.json` and log locations per OS for support.
- [ ] Commit.

[Return to Top](#mikedown-desktop-auto-update-lymescribe-parity--planning-document)

---

## Risks

- **Key loss** strands every install permanently. Mitigation: backup before 0.1.0 ships (U5, blocking).
- **`www` vs apex drift** behind Cloudflare: 0.1.0 calls `www`. Mitigation: purge and verify both.
- **IIS 404 on an unmapped extension** (LymeScribe lost `.pkg` downloads for months this way). Mitigation: U3 MIME check.
- **macOS non-admin swap**: the plugin's admin-privileges fallback is unproven on Mike's setup. Mitigation: T2 hands-on step; fallback message points to the website.
- **`quiet` NSIS looks like a crash** if the reopen fails. Mitigation: the reopen line, a log entry, and the T2 timing check; revert to `passive` if flaky.
- **Split release breaks 0.1.x** if `latest.json` is bumped for one platform. Mitigation: the script enforces the rule and has unit tests.
- **Plugin upgrade changes semantics** (endpoint fallback, `requireSignedVersion`). Mitigation: pin the minor version and keep U4's cases in CI-like runs before each release.

[Return to Top](#mikedown-desktop-auto-update-lymescribe-parity--planning-document)

---

## Parallel Development Recommendations

- **Group A (parallel):** U1 (app code) and U3 (deploy code). U3 waits only for the DMG styling worker's `deploy/` merge.
- **Sequential:** U2 after U1 (needs the commands and events). T1 after U1 and U2. U4 after U1 and U3. T2 after T1 and U4. U5 after U3 and U4.
- **Blocker for any publish:** the key backup (U5) and Mike's T2 sign-off.

Gap-filling prompts follow the original milestone prompt's structure (header, mission, this document's path), are labeled "Worker Context: <Milestone> - Gap Fill", say what the first attempt finished and which files it touched, list other active workers and their directories, and end with: commit, write `.orchestrator/worker-summary-<milestone-slug>-gap.md`, then ask Mike to close the context.

If dispatching fills the orchestrator's context, prompt Mike to run `/compact` while workers run; resume from `.orchestrator/state.json`.

[Return to Top](#mikedown-desktop-auto-update-lymescribe-parity--planning-document)

---

## Progress Log / Notes

Newest first. Format: `**YYYY-MM-DD HH:MM** - entry`.

**2026-10-23 23:53** - Plan written from research of LymeScribe (`deploy/`, `docs/deployment.md`, Sparkle and WPF updater code) and MikeDown's M10 updater. Decision: keep `tauri-plugin-updater` on both OSes and rebuild LymeScribe's UX, cadence, per-platform manifests and LymeDeploy publish on top of it. Seven open questions, defaults assumed. Not started.

[Return to Top](#mikedown-desktop-auto-update-lymescribe-parity--planning-document)
