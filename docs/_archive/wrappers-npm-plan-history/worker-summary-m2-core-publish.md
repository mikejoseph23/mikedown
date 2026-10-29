# Worker Summary: M2 Publish @mikedown/core 0.1.0

**Status:** Completed (items 1, 2, Stop-handoff; items 4 and 5 left for the orchestrator/Mike, unchecked).

Start 16:08, end ~16:12 (2026-10-24).
Worktree: /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a9420fe03c26a1f78
Branch: worktree-agent-a9420fe03c26a1f78
Commit: ffd8ffb "@mikedown/core 0.1.0" (on top of 7548dd8; worktree was created off 0103b15 and reset to 7548dd8 while clean)

## Work completed

- [x] `npm run version:npm -- 0.1.0`: core 0.1.0-rc.1 -> 0.1.0. Its lockfile refresh 404'd (desktop still pinned rc.1), so I bumped the desktop pin and ran `npm install` by hand.
- [x] `packages/core/CHANGELOG.md` with a 0.1.0 entry; added `CHANGELOG.md` to core `files` so it ships. Removed the stale "not yet published" line from core README.
- [x] Desktop pin `@mikedown/core` -> `0.1.0`; `package-lock.json` refreshed (resolves to the workspace copy).
- [x] `npm run test:packages` green (17 tests). `npm run release:npm -- --only core` dry run green.
- [x] `--pack` variant: tarball `.orchestrator/wrappers-npm-plan/artifacts/mikedown-core-0.1.0.tgz` (/Volumes/Storage/LymeStack/packages/npm not writable here, so the fallback was used). Gitignored.
- [x] Throwaway Vite vanilla-ts app (scratchpad `vite-smoke`): `npm install <tarball>` only (npm auto-installed the peers, katex included; optional mermaid absent), `import "@mikedown/core/styles.css"` and `createMikeDownEditor`, `npm run build` succeeded (katex lazy chunk split out; app chunk 2.3 MB, 778 KB gzip, unminimized-by-design editor stack, only the size warning).
- [ ] Stop item: handoff command below.
- [ ] (Orchestrator) `npm view @mikedown/core version dist-tags` shows 0.1.0 on `latest`; record in Progress Log; ask Mike to set "Require two-factor authentication and disallow tokens".
- [ ] (Orchestrator) Ask Mike before tagging `core-v0.1.0` and pushing.

## Packed file list (27 files, tarball 823.4 KB packed i.e. 843,124 bytes gzipped; 2.87 MB unpacked)

LICENSE.md 1.0K; README.md 8.5K; CHANGELOG.md 1.4K; package.json 3.6K; dist/index.js 506.4K (120 KB gzipped); dist/index.js.map 1.05M; dist/index.d.ts 19.9K; dist/styles.css 147.7K; dist/tokens.css 7.5K; dist/shared/{anchoring,imagePaste,sha1,wordCount}.{js,d.ts,js.map}; dist/dictionaries/en/{index.aff 3.0K, index.dic 538.8K, LICENSE 15.4K}; dist/dictionaries/en-GB/{index.aff 3.0K, index.dic 539.2K, LICENSE 15.4K}.

## Publish command for Mike

```
cd ~/git/mikedown && npm run release:npm -- --only core --publish
```

Note: this must run from the main checkout after the orchestrator merges ffd8ffb onto main.

## Files modified

package-lock.json, packages/core/package.json, packages/core/README.md, packages/core/CHANGELOG.md (new), packages/desktop/package.json.

## Test status

- `npm run test:packages`: 17 passed
- `npm run release:npm -- --only core` (dry run): green
- `npm run compile`: success
- `npm run lint`: 0 errors (1066 pre-existing warnings)
- `npm run test:unit`: 115 files, 1516 passed, 2 todo
- `npm run test:edge`: 22 passed

## Issues / notes for orchestrator

- `version:npm` lockfile step fails whenever a desktop pin does not match the workspace version; consider making M1 tooling bump the desktop pin too.
- `scripts/check-core-pin.js` does not exist at that path; I did not touch it. Still use `--allow-unpublished-core` wherever it applies until publish.
- `.orchestrator/` is gitignored, so this summary and the tarball are not in the commit.

## Review Materials

Tarball: /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a9420fe03c26a1f78/.orchestrator/wrappers-npm-plan/artifacts/mikedown-core-0.1.0.tgz
Smoke app: /private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/d074522f-4bf7-4bb6-a1c5-769d272462ec/scratchpad/vite-smoke
