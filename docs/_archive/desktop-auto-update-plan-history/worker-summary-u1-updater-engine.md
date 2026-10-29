# Worker summary: U1 Updater engine

**Status:** Completed (caveats under Issues)

**Worktree:** `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a8c9324796886df69`
**Branch:** `worktree-agent-a8c9324796886df69`
**Commit:** `a50c40f`
**Start/end:** 2026-10-23 evening to 2026-10-24 (about 30 min of work)

Step 0: the worktree started at `a2715d9` (not `8ae79b8`), tree clean, so I ran `git reset --hard 8ae79b8` as instructed.

## Work completed (per checkbox)

- `updater-state.json` in app data (`skippedVersion`, `snoozeUntil`, `lastCheckedAt`, `lastResult`): temp file + fsync + rename; missing reads empty silently; corrupt/unreadable reads empty and is logged; unknown keys ignored.
- Skip/snooze filtering in `updater_check` for silent checks (logged, result recorded as `suppressed`, nothing emitted, not stored as pending). Manual checks clear both first.
- New commands `updater_skip(version)`, `updater_snooze(days?)` (default 14), `updater_status()`, plus `updater_download()`.
- Cadence constants in one place (`src/app/updater.ts`): `FIRST_CHECK_DELAY_MS` 10 s, `CHECK_INTERVAL_MS` 4 h (the claim interval), `TICK_MS` 15 min (per-window claim attempts). One claim per app unchanged.
- Progress: `mikedown:update-progress { downloaded, total }` throttled to 100 ms (final chunk always emits). Verified bytes cached in `UpdaterState` per version, so a cancelled quit dialog reuses them (no re-download).
- Controller states `idle, available, downloading, verifying, ready, installing, failed`: Rust `Phase` mirrored to all windows by `mikedown:update-state`; TS controller exposes `getSnapshot()` / `subscribe()`. A check during a busy phase never touches the network or the pending update (Rust), and the TS manual check just toasts (no restart).
- Windows `installMode` now `quiet`. `installing` is emitted right before `update.install()` (which exits the process on Windows).
- Windows pre-install: `WinVerifyTrust` on the downloaded exe written to temp, then signer O (CN only if no O) must equal `Interapp Development, Inc.` exactly. `signer_matches` unit-tested. Non-PE payload (zip/msi) is refused. Code is `#[cfg(windows)]`.
- macOS pre-install: the plugin does not expose the extracted app, so the module extracts the verified `.app.tar.gz` itself (system `tar`) to a temp dir, runs `codesign --verify --deep --strict` and requires `TeamIdentifier=UU626VCLYW`. Runs before the quit handshake; failure logs, sets `failed`, returns the error (UI shows install-failed). Tested with garbage and unsigned-app payloads.
- Channel: `MIKEDOWN_CHANNEL=store` (runtime env, or baked at build via `option_env!`): plugin not registered, claim/check/install are quiet no-ops, Check for Updates hidden from the Help menu (`buildMenuSpec(isMac, { updates:false })`) and the App tab button.
- Existing `updater.log` lines kept; added skip, snooze, suppression, download complete, pre-check pass/fail lines.
- Existing toast still works against the new controller.

## Files modified

`packages/desktop/src-tauri/`: `src/commands/updater.rs` (rewritten), `src/commands/updater_verify.rs` (new), `src/commands/mod.rs`, `src/lib.rs`, `Cargo.toml` (+ `windows-sys` 0.61 under `cfg(windows)`), `Cargo.lock`, `tauri.conf.json`.
`packages/desktop/src/`: `app/updater.ts`, `app/updaterApi.ts`, `main.ts`, `menu/menuSpec.ts`, `settings/appTab.ts`; test `test/unit/updater.test.ts`.

## Test status

- `cargo test` (src-tauri): 115 passed, 0 failed, 4 ignored (staging/e2e).
- `npm run test:unit`: 403 passed, 1 failed (`standaloneHtml.test.ts` "core stylesheet carries no VS Code theme variables"; unrelated, I did not touch export or core CSS).
- `npm run typecheck`: 1 error, `src/ui/diffView.ts(14)` missing types for module `diff` (the worktree resolves the main repo's node_modules). Nothing from the updater files.
- Windows path: compiles with `cargo check --target x86_64-pc-windows-msvc` against windows-sys 0.61.2 in a scratch crate that `#[path]`-includes `updater_verify.rs` (the windows-sys features needed are `Win32_Security_Cryptography_Catalog` and `_Sip` as well, already in Cargo.toml). A full-app Windows `cargo check` was not run (needs an MSVC C toolchain for ring). Not run on a real Windows machine: WinVerifyTrust and subject extraction are untested at runtime.

## Issues or blockers

1. Two failures not from this work: the `diff` typings error and the `standaloneHtml` test. Likely worktree environment; worth a glance on main.
2. Windows runtime behavior unverified (see above).

## Notes for orchestrator

**Endpoints (confirmed in tauri-plugin-updater 2.14.0 source):** `{{target}}` expands to `darwin` / `windows` / `linux` (OS only, no arch), `{{arch}}` to `x86_64` / `aarch64` / `i686` / `armv7`. Config is:

1. `https://www.iadev.net/mikedown/latest-{{target}}-{{arch}}.json`, resolving to `latest-darwin-aarch64.json`, `latest-darwin-x86_64.json`, `latest-windows-x86_64.json` (matches U3's names exactly).
2. `https://www.iadev.net/mikedown/latest.json` (legacy, kept).

The plugin tries endpoints in order and falls through on any non-success status (404 included) or a manifest that fails to parse; it stops at the first success. A 204 means no update. Inside a manifest it looks up `{os}-{arch}-{bundle_type}` then `{os}-{arch}` (e.g. `darwin-aarch64`, `windows-x86_64`).

**Windows payload:** the pre-check requires the windows manifest URL to be a raw NSIS `*-setup.exe` (PE). A `.zip` or `.msi` payload is refused.

**For U2 (events and commands):**

- Events: `mikedown:update-available` (UpdateInfo), `mikedown:update-progress` `{downloaded,total|null}`, `mikedown:update-state` `{state, version, error}`.
- Commands: `updater_check(manual)`, `updater_claim`, `updater_pending`, `updater_download` (download+verify only, ends `ready`), `updater_install` (downloads if needed, pre-check, quit handshake), `updater_skip(version)`, `updater_snooze(days?)`, `updater_status()` returning `{phase, version, channel, lastCheckedAt, lastResult (upToDate|available|suppressed|error), skippedVersion, snoozeUntil}` with times in Unix ms (for the Settings "Last checked" line), `updater_log`.
- TS: `createUpdater` now needs a `setTimeout` dep; controller adds `skip()`, `snooze(days?)`, `applyHostState`, `applyProgress`, `getSnapshot`, `subscribe`, `channel()`. `main.ts` already wires the state and progress events. The OS notification for "no window focused" is not built; state is available via `mikedown:update-state`.
- The old toast's Later is session-only; Skip/Remind Me Later UI is U2's, and `controller.skip()` / `snooze()` are ready for it.
- A cancelled quit dialog returns the phase to `ready` and the toast is offered again.

**macOS pre-check outcome:** not exposed by the plugin before the swap, so implemented by extracting the verified archive ourselves (no new crates). It checks the update, not the running app, so unsigned dev builds are not blocked from updating.

Review Materials: none
