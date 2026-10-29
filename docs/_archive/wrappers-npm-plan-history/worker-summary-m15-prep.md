# Worker Summary: M15 prep

## Status

Completed

## Work completed

- `npm run version:npm -- 0.2.0`: core, web-component, react, vue, angular at 0.2.0, wrapper `@mikedown/core` peers `^0.2.0`. `packages/desktop` still pins core `0.1.0` (version 0.3.0).
- CHANGELOG 0.2.0 entries: core (new entry above 0.1.0), web-component, vue, angular (rc headings renamed to 0.2.0), react (new file, also added to its `files` so it ships like the others).
- Site: no page pins a version literally (web component CDN URL uses a `%WEB_COMPONENT_VERSION%` template filled from the package version). `npm run build:site` rebuilt after the bump.

## Files modified

package-lock.json, packages/angular/package-lock.json, package.json of the five packages, the five CHANGELOG.md files (react new), packages/react/package.json (files).

## Test status

- test:packages: pass (72 tests)
- test:wrappers: pass (25 Angular karma tests plus others)
- test:consumers: pass; angular-latest SKIPPED (local Node v22.20.0 is below the Angular CLI latest minimum 22.22.3)
- test:site: pass (27)
- test:unit: pass (1577, 2 todo)
- lint: 0 errors (1066 warnings, pre-existing)
- build:site: pass

## Release dry run (`npm run release:npm`, nothing published)

- @mikedown/core@0.2.0: 27 files, packed 836.7 KB, unpacked 2.92 MB (includes CHANGELOG.md)
- @mikedown/angular@0.2.0: 24 files, packed 42.1 KB, unpacked 140.5 KB (includes CHANGELOG.md)
- @mikedown/react@0.2.0: 7 files, packed 8.7 KB (CHANGELOG, LICENSE, README, dist/index.{d.ts,js,js.map}, package.json)
- @mikedown/vue@0.2.0: 8 files, packed 6.5 KB
- @mikedown/web-component@0.2.0: 15 files, packed 806.3 KB (standalone bundle 2.51 MB, THIRD_PARTY_NOTICES.md)

## Site pack dry run

`packages/desktop/deploy/pack-for-lymedeploy.sh --site --site-n 1 --dry-run --linux <main repo>/packages/desktop/deploy/dist/0.3.0/MikeDown-0.3.0-linux-x86_64.AppImage`

Release `0.3.0-site.1` (desktop 0.3.0 unchanged), 195 files, 13.4 MB, verified. Contents: `index.html` (desktop page), 4 `screenshot-*.png`, `site-assets/`, `vscode/`, `developers/` (angular, react, vue, web-component, index.html). No `latest*.json`, no dmg/exe/AppImage/tar.gz, no SHA256SUMS.txt, no web.config. No earlier site release was found locally, so N=1 (confirm against the LymeDeploy project; a repeated version is a Conflict).

Non-dry-run command (from the main repo, where the 0.3.0 AppImage exists, after `npm run build:site` on the merged tree):

`packages/desktop/deploy/pack-for-lymedeploy.sh --site --site-n 1`

## Issues

- The worktree has no `deploy/dist/0.3.0/` (gitignored), so the dry run needed `--linux` pointing at the main repo's AppImage. In the main repo no flag is needed.
- angular-latest consumer target skipped for the Node version reason above.

## Notes for orchestrator

- Build outputs (`packages/desktop/deploy/dist/site-0.3.0-site.1`) are gitignored and left in the worktree.

## Times

Start and end: 2026-10-24 (about 20 minutes).

## Worktree

- Path: /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a445b7541267e07be
- Branch: worktree-agent-a445b7541267e07be
- Commits: see below

## Review Materials

`git show --stat` on the `npm packages 0.2.0` commit; the five CHANGELOG.md files.
