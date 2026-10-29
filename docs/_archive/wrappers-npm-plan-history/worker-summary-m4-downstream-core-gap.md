# Worker Summary: M4 Desktop pin gate gap

Status: Completed (with one out-of-scope follow-up, below)

## Work completed

- `checkCorePin` now uses the decoupled rule: exact pin required; published pin passes (warning names both versions when it differs from the workspace); unpublished pin must equal the workspace core version and still needs `--allow-unpublished-core`.
- Header comment in `check-core-pin.js` updated; `packages/desktop/deploy/README.md` "Core pinning" rewritten; flag comments in `release.sh` and `build-mac.sh` no longer call it routine.
- `deploy.test.ts` covers all four cases (published equal, published differing, unpublished equal with/without flag, unpublished differing).

## Output of `node packages/desktop/deploy/check-core-pin.js` (no flag)

```
warning: @mikedown/core is pinned to 0.1.0 but packages/core/package.json is 0.2.0-rc.0; the release builds against the registry copy of 0.1.0, not the workspace
@mikedown/core 0.1.0 (published)
```

## Files modified

- packages/desktop/deploy/lib/release-lib.js (checkCorePin only)
- packages/desktop/deploy/check-core-pin.js (header comment)
- packages/desktop/deploy/README.md, release.sh, build-mac.sh (comments/docs)
- packages/desktop/test/unit/deploy.test.ts (core pin tests)

## Test status

- check-core-pin.js, no flag: pass (above)
- packages/desktop `npm run test:unit`: 531 passed
- root `npm run test:unit`: 1564 passed, 2 todo
- `npm run build:desktop`: green (tauri build; not RELEASE=1)

## Issues / notes for orchestrator

- Base was stale (HEAD 4172f62, behind main); reset --hard to ab72aae on a clean tree, as instructed.
- FOLLOW-UP, not fixed (outside my allowed files): `packages/desktop/vite.config.ts` `assertCorePin()` (RELEASE=1) still throws unless the pin equals `packages/core/package.json`'s version, so a RELEASE=1 build (build-mac.sh / build-windows.ps1) will fail with core at 0.2.0-rc.0 even though the check script passes. Its header comment says the same. desktop-app owns that file; it needs the same published-vs-workspace rule (and the build must resolve `@mikedown/core` to the desktop-local registry copy, `packages/desktop/node_modules/@mikedown/core`, rather than `../core/dist`; `coreDir`/`coreDist` in that config point at the workspace).

Review Materials: none
