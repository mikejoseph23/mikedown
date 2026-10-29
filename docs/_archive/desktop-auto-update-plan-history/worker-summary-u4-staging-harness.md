# Worker Summary: U4 Staging harness

**Status:** Completed (all checkboxes done; the continuity item is a labeled equivalent and the non-admin item is a documented T2 hands-on step).
**Start:** 2026-10-24 00:19 EDT. **End:** about 01:15 EDT.
**Worktree:** `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-aabd4c5b809bef338`
**Branch:** `worktree-agent-aabd4c5b809bef338`
**Commit:** `ec729ed` (on top of `c3984be`; f4c35a5 and 9a93cf6 were absent and the tree was clean, so I reset there). Nothing pushed, published or purged. This summary was written to the worktree path because the worktree guard blocks the main repo path.

## Work completed

- **macOS headless cases** (`deploy/updater-staging-test.sh --headless [--reuse]`): per-target N to N+1 (a 9.9.9 decoy `latest.json` proves the per-target file wins); per-target 404 falls back to `latest.json` (server log checked); tampered artifact; manifest signed with a throwaway key; downgrade and same version; replay (N artifact + N signature under an N+1 version, refused: "signed for version 0.1.0 but the endpoint announced 0.1.1"); offline; skipped and snoozed versions on a silent check (a manual check clears the skip); codesign / Team ID pre-check accepts ours and refuses an ad-hoc app, a signature-stripped app and garbage; shipped endpoint config assertion; a real install over a copy of N. The engine under test is the shipped `src/commands/updater.rs` and `updater_verify.rs`, compiled by path into `src-tauri/tests/updater_cases.rs` (replaces `tests/updater_staging.rs`, whose two tests are covered and extended). The controller's `install` is not driven (it would replace the running test binary); installs use the plugin directly over a copy, as before.
- **Continuity.** 0.1.0 has `https://www.iadev.net/mikedown/latest.json` baked in and the plugin has no run-time override. Pointing the real 0.1.0 *process* at staging needs a hosts entry, a trusted CA or a proxy (rustls with bundled roots ignores env cert settings): all system changes. So the real 0.1.0 process is never launched on the Mac. **Closest honest equivalent, labeled in the output:** the same plugin version (2.14.0) configured with 0.1.0's own shipped `plugins.updater` block (read from git at `a2715d9`, the commit 0.1.0 was built from: one endpoint, `requireSignedVersion`) at version 0.1.0, installing over a COPY of the real notarized `deploy/dist/0.1.0/MikeDown.app`; only `latest.json` is served and the server log proves no per-target request. macOS: PASS. Windows: the old side is an unsigned staging 0.0.9 (below), with the same 0.1.0 updater block (`installMode: passive`).
- **Windows** (`deploy/updater-staging-test-windows.sh` on the Mac; `deploy/updater-staging-test.ps1` Build and Run modes; `deploy/staging-serve.js`): builds an unsigned staging N=0.0.9 installer and the test exe on BEAST from a copy of the working tree (no push needed; `C:\temp\mikedown-u4`), signs payloads on the Mac, runs on DEVBOX1 over SSH. The genuine Trusted-Signed 0.1.0 installer is the N+1 payload (the only Authenticode-signed installer that exists, and Windows signing needs the BEAST password logon). Flows: quiet install N to N+1 with the installer relaunching the app; an update-key-signed **unsigned** `.exe` refused by the pre-check; an update-key-signed `.exe` with a byte changed after signing (broken Authenticode) refused; all shared engine cases; the continuity equivalent.
- **Non-admin macOS case:** documented in the `updater-staging-test.sh` header as a T2 hands-on step; printed as SKIP in every run.
- **PASS/FAIL/SKIP:** every case prints one; both scripts exit non-zero on any FAIL (the Windows runs exited 1 while cases were failing during development).

## Files modified

`packages/desktop/deploy/`: `updater-staging-test.sh` (extended), `updater-staging-test.ps1`, `updater-staging-test-windows.sh`, `staging-scenarios.js`, `staging-serve.js`, `windows-test.manifest`, `lib/verify-cli.js`. `packages/desktop/src-tauri/tests/updater_cases.rs` (new), `updater_staging.rs` (removed). No Rust source, config or U2 files touched.

## Issues, blockers, findings

- **No U1 bugs found.** Engine behaviour matched the design in every case.
- **Windows relaunch needs an interactive session.** The NSIS `/R` relaunch (`RunAsUser`) does nothing when the installer is started from an SSH session (verified by hand). The Run script runs the hand-over test through a transient per-user `schtasks /it` task in DEVBOX1's existing disconnected interactive session (deleted afterwards). With no such session the relaunch case prints SKIP. The test exe's own arguments get forwarded to the relaunched app via `/ARGS`; a harness artifact only.
- **Windows test exe needs a comctl32 v6 manifest** (else 0xC0000139 at load). Build mode links `windows-test.manifest` through `cargo rustc --test ... -- -C link-arg`; build.rs is untouched.
- **One early contact with iadev.net:** my first Windows staging build (0.0.9) still had the production endpoint and one silent check ran from it on DEVBOX1 ("Could not fetch a valid release JSON": a GET of the manifest, nothing written or published). Fixed: Build mode now overlays the endpoints to 127.0.0.1. The relaunched real 0.1.0 is killed within 250 ms (its first check comes about 10 s after start).
- **Not tested (needs Mike):** the real 0.1.0 *process* updating on either OS; a Trusted-Signed N+1 built from this tree (Windows signing needs the BEAST console logon).

## Notes for orchestrator (T2)

- Mac: `cd packages/desktop && MIKEDOWN_LEGACY_DIST=<main>/packages/desktop/deploy/dist/0.1.0 deploy/updater-staging-test.sh --headless [--reuse]` (about 2 min with `--reuse`; the first run builds twice). GUI mode (no flag) is unchanged for the toast flow; `--keep-serving` leaves the server up. Printed paths: `deploy/dist/staging/{headless.log,results.txt,http.log,serve/}`; the N copy is `deploy/dist/staging/install/MikeDown.app`.
- Windows: `deploy/updater-staging-test-windows.sh [--skip-build] [--keep]` from the Mac (needs BEAST and DEVBOX1 SSH and the Mac minisign key in the Keychain). Copies of the output in `deploy/dist/staging-windows/{build.log,run.log}`; on DEVBOX1 `C:\temp\mikedown-u4\bundle\work\` has `cases.log`, `flow-*.log`, `http.log`.
- T2 hands-on: non-admin install into `/Applications` (admin prompt); the real-0.1.0-process update on both OSes once a staged-domain approach is acceptable.

## Review Materials

none

## Results: macOS (`updater-staging-test.sh --headless --reuse`, final run)

```
TOTAL: 20 PASS, 0 FAIL, 1 SKIP
downgrade offers nothing: PASS (manifest 0.0.1 below the running version)
same version offers nothing: PASS
install N to N+1 over the staging N copy (per-target file): PASS 0.1.0 -> 0.1.1 (Team ID UU626VCLYW); codesign --verify OK
continuity (equivalent): real 0.1.0 .app copy updates through the legacy latest.json path: PASS 0.1.0 -> 0.1.1
manifest signed with a different key rejected: PASS ("signature was created with a different key")
per-target N to N+1: PASS (9.9.9 decoy latest.json ignored)
offline logs and stays silent: PASS
per-target 404 falls back to latest.json: PASS
codesign pre-check accepts the genuine payload: PASS (Team ID UU626VCLYW)
codesign pre-check refuses ad-hoc signed app: PASS ("not signed with a Team ID")
codesign pre-check refuses app with its signature removed: PASS
codesign pre-check refuses a file that is not an archive: PASS
replay (N artifact under N+1 version) rejected: PASS
shipped-config: PASS (per-target then latest.json, requireSignedVersion on, windows quiet)
skipped version not announced on a silent check: PASS
snoozed check not announced on a silent check: PASS
tampered artifact rejected: PASS ("signature verification failed")
non-admin install into /Applications: SKIP (needs the macOS admin prompt; T2 hands-on)
server log: per-target 404 then latest.json 200: PASS
server log: per-target file served, latest.json never asked for: PASS
server log: 0.1.0 config asked only for latest.json: PASS
```

## Results: Windows (`updater-staging-test-windows.sh --skip-build`, DEVBOX1, final run)

```
TOTAL: 23 PASS, 0 FAIL, 2 SKIP   (the 2 SKIPs are the macOS-only install cases in the shared test binary)
downgrade / same version offers nothing: PASS
manifest signed with a different key rejected: PASS
per-target N to N+1 (0.0.9 -> 0.1.0): PASS
per-target 404 falls back to latest.json: PASS
offline logs and stays silent: PASS
Authenticode pre-check accepts the genuine payload: PASS (WinVerifyTrust OK, signer Interapp Development, Inc.)
Authenticode pre-check refuses unsigned installer: PASS (0x800B0100)
Authenticode pre-check refuses genuine installer with a byte changed after signing: PASS (0x80096010)
Authenticode pre-check refuses a file that is not an installer: PASS
replay rejected: PASS ("signed for version 0.0.9 but the endpoint announced 0.1.0")
shipped-config: PASS
skipped / snoozed versions not announced: PASS
tampered artifact rejected: PASS
server log: per-target 404 then latest.json 200: PASS
windows: unsigned .exe (update-key signed) refused by the Authenticode pre-check: PASS (installed version stays 0.0.9)
windows: .exe with broken Authenticode (update-key signed) refused: PASS (installed version stays 0.0.9)
windows: quiet install N to N+1: PASS 0.0.9 -> 0.1.0, installed exe Authenticode Valid
windows: quiet install relaunch: PASS (installer relaunched mikedown-desktop, killed at once)
continuity (equivalent): 0.1.0 updater block, legacy latest.json only, passive install: PASS 0.0.9 -> 0.1.0
continuity relaunch: PASS
server log: 0.1.0 config asked only for latest.json: PASS
```
