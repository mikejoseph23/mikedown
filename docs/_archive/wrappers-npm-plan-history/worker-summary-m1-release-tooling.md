# M1 worker summary: Release tooling and versioning

**Status:** Completed (all checkboxes attempted and done; angular paths untested, see Issues).

Worktree: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-aad2ad0a2c16fbb1a`
Branch: `worktree-agent-aad2ad0a2c16fbb1a`
Commits: `a66b865` (tooling, shape test, core package.json, README, .gitignore), `7d4b4ab` (CI workflow, CLAUDE.md). Base `28421c0` (worktree started at `0103b15`; reset to `28421c0` per the prompt, tree was clean).
Start 2026-10-24 ~15:50, end ~16:10 (local).

## Work completed

- **vsix:** sync-core-version.js deleted; `vsix` is now `npm version patch --no-git-tag-version && npm run package && vsce package` (also dropped `build:core`, the extension compiles core from source via aliases); `vsix:minor` added.
- **`scripts/version-npm.mjs <version> [--dry-run] [--no-lock]`:** sets version on every public package, wrapper `@mikedown/core` peer and devDependency to `^<version>`, refuses lower than the current highest, validates semver (prerelease aware), then refreshes the lockfile (`npm install --package-lock-only`). Tested: lower refused, bogus refused, equal ok, real write to rc.2 (reverted).
- **`scripts/release-npm.mjs`:** discovers public packages (core first), builds, `npm pack --dry-run --json` file list with sizes, `--only`, `--dry-run` (default), `--publish`, `--otp`, plus `--pack`. `--access public` always, `--tag rc` for prereleases, skips versions already on npm (E404 = not published), packs to the share (fallback `.orchestrator/wrappers-npm-plan/artifacts/`) when `--publish` is used while not logged in. Never publishes without `--publish`.
- **Shared helpers:** `scripts/lib/npm-packages.mjs` (glob discovery, angular as non-workspace published from `packages/angular/dist`, build helper, semver compare); `scripts/build-npm.mjs` builds all public packages.
- **Root scripts:** `release:npm`, `version:npm`, `release:core` = `release:npm -- --only core`; `scripts/release-core.sh` deleted. `test:packages` (build all, then shape test), `test:core-package` alias.
- **Shape test:** moved to `test/packages/package-shape.test.ts`, core dist checks kept. Per package: not private, MIT, `repository.directory`, `files` has dist/README/LICENSE, `types` resolves, every exports target exists (incl. `*` patterns), `types` before `import` before `default` with `default === import`, version equals family, wrapper peer (and devDependency if present) equals `^<family>`. Core: `katex` required peer, `mermaid` optional. Verified it fails on a deliberately bad fake package (6 failures), then removed the fake.
- **Core package.json:** `default` added to `.` and `./shared/*`; `katex` dropped from `peerDependenciesMeta`. Lockfile refreshed (only the katex meta line changed).
- **README/.gitignore:** core README status and install line fixed (no `@rc`), peer table/text updated for required katex; `.npmrc` ignored.
- **CI:** `.github/workflows/ci.yml` (push + PR; Node 22; `npm ci`; `npm ci --prefix packages/angular` if that folder exists; lint, test:unit, test:edge, test:packages; no publish). Valid YAML; `npx actionlint` is not available, so it is **unchecked by actionlint**.
- **CLAUDE.md:** command list and Releasing rewritten (independent npm family and extension flows, order only matters when the extension/desktop needs a new core).

## Files modified

`package.json`, `package-lock.json`, `.gitignore`, `CLAUDE.md`, `packages/core/package.json`, `packages/core/README.md`, `.github/workflows/ci.yml` (new), `scripts/lib/npm-packages.mjs`, `scripts/build-npm.mjs`, `scripts/version-npm.mjs`, `scripts/release-npm.mjs` (new), `scripts/release-core.sh` and `scripts/sync-core-version.js` (deleted), `packages/core/test/package-shape.test.ts` -> `test/packages/package-shape.test.ts`.

## Test status

- `npm run compile`: green
- `npm run lint`: 0 errors (1066 warnings, pre-existing)
- `npm run test:unit`: 115 files, 1516 passed, 2 todo
- `npm run test:edge`: 3 files, 22 passed
- `npm run test:packages`: 17 passed (builds core first)
- `npm run release:npm` (dry run) and `npm run release:core`: green; `npm whoami` returned `interapp` (logged in) and nothing was published. `--pack` tested once: wrote the tarball to the fallback folder (share gives Permission denied), tarball removed.

## `npm run release:npm` dry-run output (core, 0.1.0-rc.1)

```
Files in mikedown-core-0.1.0-rc.1.tgz:
   1.0 KB LICENSE.md          8.6 KB README.md
   3.0 KB dist/dictionaries/en-GB/index.aff   539.2 KB .../en-GB/index.dic   15.4 KB .../en-GB/LICENSE
   3.0 KB dist/dictionaries/en/index.aff      538.8 KB .../en/index.dic      15.4 KB .../en/LICENSE
  19.9 KB dist/index.d.ts    506.4 KB dist/index.js    1.05 MB dist/index.js.map
  dist/shared/{anchoring,imagePaste,sha1,wordCount}.{js,d.ts,js.map}  (797 B ... 24.5 KB)
 147.7 KB dist/styles.css    7.5 KB dist/tokens.css    3.6 KB package.json
26 files, packed 823.0 KB, unpacked 2.87 MB
```

index.js gzipped: 117.6 KB (budget 400 KB).

## Issues / notes for orchestrator

- `release:core` is now a dry run by default (it used to pack when logged out). To get tarballs for downstream vendoring use `release:npm -- --only core --pack`. Logged-out `--publish` also packs.
- `packages/angular` code paths (own `npm ci`, publish from dist, shape-test dist handling) are written but untested since the folder does not exist.
- M2 heads-up: Desktop pins `@mikedown/core` at exactly `0.1.0-rc.1`. `version:npm` does not touch that pin, and its lockfile refresh will try the registry for the pin once core moves to 0.1.0. M2/M4 must bump the Desktop pin (or use `--no-lock`).
- `test:unit` no longer includes the shape test (it moved to `test/packages`), so the stale-dist failure noted in earlier work is gone.
- No version bumped, planning doc and CHANGELOG untouched.

Review Materials: none
