# Worker summary: U3 — Manifests, hosting and release pipeline

**Status:** Completed

- **Worktree:** `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a1f1e8b8e5dcb9d15`
- **Branch:** `worktree-agent-a1f1e8b8e5dcb9d15`
- **Commit:** `989169c` (on top of `8ae79b8`; the worktree started at `a2715d9`, an ancestor, and was reset to `8ae79b8` per Step 0)
- **Start:** 2026-10-23 23:59 EDT. **End:** 2026-10-24 00:17 EDT.
- This file had to go in the worktree (the isolation guard blocks writes to the main checkout). Copy it to `/Users/michaeljosephwork/git/mikedown/.orchestrator/desktop-auto-update-plan/worker-summary-u3-release-pipeline.md`.

## Plugin template check (for U1)

Confirmed in `tauri-plugin-updater-2.14.0/src/updater.rs`: `{{target}}` = `darwin` / `windows` (`updater_os()`), `{{arch}}` = `aarch64` / `x86_64` (`updater_arch()`, compile-time per slice, so the universal Mac binary reports its real arch). So `latest-{{target}}-{{arch}}.json` gives exactly the three filenames this pipeline writes. Two notes for U1:

- If U1 calls `.target(...)` on the builder, `{{target}}` becomes that whole custom string and the lookup changes. Don't.
- A non-2xx endpoint (the 404 placeholder case) just logs and moves on to the next endpoint without setting `last_error`, so a per-target 404 does fall through to `latest.json`. A 200 with a body that won't parse sets `last_error` and still tries the next endpoint.

## Work completed

- [x] **make-latest-json.js:** writes the per-target files (one `platforms` entry each, plus `sha256`/`size`, plus that platform's `downloads` entry), and `latest.json` only for a full release. `--platforms mac|windows|mac,windows`. Stale manifest names left over from an earlier run are deleted. Before writing anything it verifies every `.sig` with minisign against the `tauri.conf.json` pubkey, including the signed version. Pure logic is in `lib/release-lib.js` (`makeTargetManifests`, `planManifests`, `checkManifestShape`), and the verifier is new (`lib/minisign.js`, uses only node:crypto, checked against the real 0.1.0 artifacts, key id `C5386105C2C03AF7`).
- [x] **release.sh:** added `--mac-only` / `--windows-only`; shows the notes and asks for confirmation before any build (`--yes` skips it; without a terminal it refuses); refuses to run without `~/.tauri/mikedown.key` and the Keychain item; refuses a signature that lacks the signed version (through make-latest-json). Also added `--dry-run`, `--publish` (chains into pack) and `--dist`, and gates the staged folder with the new `check-upload.js`.
- [x] **pack-for-lymedeploy.sh:** nupkg (`MikeDown.Downloads`, stored, round-trip checked) → `push-package` → `create-release` → `deploy --wait` (CLI 1.8.0 has `--wait`, so no table parsing) → `verify-published.sh`. Has `--dry-run`, `--from-pack|push|release|deploy`, and `--release-version` for re-snapshotting variables.
- [x] **LymeDeploy project definition:** `deploy/lymedeploy/deploy.yaml`, built from a read-only `lymedeploy export` of `lymescribe-downloads`. `lymedeploy apply --dry-run` accepts it (9 creates, nothing written, 1 expected warning for the missing token).
- [x] **verify-published.sh `<version>`:** fetches each manifest four ways (www and apex, each cache-busted and plain) and requires all four to be byte-identical. Then it checks shape and version, HEADs each artifact for 200 and matching Content-Length, downloads it, and checks size, sha256, minisign signature and signed version. Split releases are handled: `latest.json` must still be live, and the platform that didn't ship may be 404.
- [x] **IIS MIME check:** results are under Notes. No MIME maps were added.
- [x] **Download page** (`website/mikedown-desktop/index.html`, where release.sh stages it from, not `deploy/site/`): reads `latest-darwin-aarch64.json` and `latest-windows-x86_64.json`, falls back to `latest.json` per platform, and shows both versions when they differ. I also updated the privacy text to the new cadence and setting name.
- [x] **Tests and dry run:** new `test/unit/release-pipeline.test.ts` passes. `release.sh --no-bump --dry-run --allow-unpublished-core --dist <main repo>/packages/desktop/deploy/dist/0.1.0` is green end to end, for a full release, `--mac-only` and `--windows-only`. It used the real signed 0.1.0 artifacts read-only and wrote to a temp dir. `verify-published.sh 0.1.0` against a local server serving that staged folder: PASSED.
- [x] **Commit:** `989169c`.

## Files modified

- `packages/desktop/deploy/make-latest-json.js`, `lib/release-lib.js`, `release.sh`, `site/web.config`, `README.md` (intro, script table and rollback only; U5 owns the rewrite)
- New: `deploy/lib/minisign.js`, `deploy/lib/publish-checks.js`, `deploy/check-upload.js`, `deploy/pack-for-lymedeploy.sh`, `deploy/verify-published.sh`, `deploy/verify-published.js`, `deploy/lymedeploy/deploy.yaml`
- `website/mikedown-desktop/index.html`
- New test: `packages/desktop/test/unit/release-pipeline.test.ts`

## Test status

- `deploy.test.ts` 14/14 and `release-pipeline.test.ts` 29/29 pass, so 43/43 for the deploy tests.
- Full desktop vitest run: 421/422. The one failure is `standaloneHtml.test.ts`, and it's unrelated: `packages/core/dist/styles.css` isn't built in this worktree.
- Dry runs: `release.sh` full, Mac-only and Windows-only all green. A real run without a terminal stops at the notes prompt (checked after the commit, and nothing changed).

## Issues and deviations

1. **PublishRoot is `C:\WebApps\Downloads\mikedown`, not `C:\WebApps\Interapp\mikedown`.** Every other downloads project is published from a `/<product>` virtual directory pointing at `C:\WebApps\Downloads\<product>`. LymeScribe itself moved off `Interapp\lymescribe` on 2026-08-16 (`lymedeploy/docs/reference/lymescribe-downloads-pipeline.md`, estate fact `iadev-net-webroot-vdirs-not-content`), and the site root belongs to the Interapp website's own deploy. The plan's path came from LymeScribe's out-of-date `docs/deployment.md`. Changing it is one variable.
2. **web.config is now comment-free and has no mimeMap, and `.sig` files are no longer staged.** Estate fact `iadev2025-webconfig-comment-mimemap-500`: on that server, comments plus mimeMap entries 500 the whole folder. A duplicate map does the same, and that would take `latest.json` down for every 0.1.0 install. Nothing fetches `.sig` (the signature is inside the manifest), so the old `.sig` map is gone. The explanation moved into the `deploy.yaml` header, and `check-upload.js` rejects comments and `<remove>`.
3. **Purge token:** `credentials.yaml` says it was never provisioned, but `lymescribe-downloads` has a working `CloudflareToken` (enabled 2026-08-16). LymeDeploy can't give a secret back, so Mike needs the value from wherever he saved it, or a new zone-scoped Cache > Purge token.

## Notes for orchestrator

**MIME check:** nothing is published at `/mikedown/` yet, so every URL there is 404, and I could not test the folder itself. From the same IIS site, through `/lymescribe/` (whose web.config maps only `.pkg` and `.AppImage`):

- **Confirmed 200:** `.tar.gz` (`application/x-gzip`, the engines tarball), `.dmg`, `.json`, `.msi`.
- **Not tested directly:** `.exe`. It relies on estate fact `iadev2025-webconfig-comment-mimemap-500`, which says the machine-wide maps already cover `.exe`. No `.exe` is live on iadev.net to test.
- **Not testable from outside:** the 404 bodies for mapped and unmapped extensions are identical (1245 bytes), so a 404.3 can't be told from a 404.0.
- **Re-check after the first publish:** `verify-published.sh` does it, since it HEADs every artifact.

**Live-site observations:** the apex `https://iadev.net/mikedown/…` 301s to `www` and keeps the query string. Cloudflare reports `.json` as DYNAMIC (not cached), and `.dmg`/`.exe`/`.tar.gz` as MISS (the "Cache installer artifacts" rule).

**Mike must do by hand (in order):**

1. On iadev-prod: create `C:\WebApps\Downloads\mikedown` and the `/mikedown` vdir under site Interapp, and give the agent write access (commands are in the `deploy.yaml` header).
2. `lymedeploy apply -f packages/desktop/deploy/lymedeploy/deploy.yaml --dry-run`, then run it without `--dry-run`, then `lymedeploy doctor --project mikedown-downloads`. Never use `--prune`: Production is shared with DEVCENTER2019 and PMO-PROD-VM.
3. Cloudflare: add the Sensitive `CloudflareToken` to `mikedown-downloads` (zone id is already in the file), set the purge step to `enabled: true`, and re-apply. Releases made before the variable existed won't see it, so cut a new one (`--release-version <v>-r2 --from-release`).
4. The key backup (U5) still blocks any real publish.

## Review Materials

- `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a1f1e8b8e5dcb9d15/packages/desktop/deploy/lymedeploy/deploy.yaml`: the LymeDeploy project definition and the one-time IIS steps.
- `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a1f1e8b8e5dcb9d15/packages/desktop/deploy/site/web.config`: what will sit in front of `latest.json`.
