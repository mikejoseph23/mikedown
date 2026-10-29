# Worker summary: M1 imagePaste helpers into core shared

**Status:** Completed

**Worktree:** `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a88f9e5d8e62f2e17`, branch `worktree-agent-a88f9e5d8e62f2e17`, commit `7e87d45` (on top of `e9322cf`; the worktree started at `b18d23c`, an ancestor, and was reset to `e9322cf` while clean).

Note: this file belongs at `/Users/michaeljosephwork/git/mikedown/.orchestrator/desktop-app-plan/worker-summary-m1-imagepaste-shared.md`, but worktree isolation blocked writes outside the worktree, so it was written to the scratchpad instead.

## Work completed

- [x] `git mv src/imagePaste.ts packages/core/src/shared/imagePaste.ts`. Node `path`/`crypto` imports removed. Path- and hash-dependent helpers come from `createImagePasteHelpers({ path: PathOps, sha1Hex? })`. `PathOps` = `sep, join, resolve, dirname, basename, extname, relative, isAbsolute, normalize` (`resolve` and `extname` added to the plan's list because the helpers use them). Path-free helpers (`extensionFromMime`, `sanitizeForFilename`, `extractLocalImageRefs`, `looksLikeAutoPastedImage`, `resolveAltText`) are plain exports and are also on the factory result. New `packages/core/src/shared/sha1.ts` is a pure synchronous SHA-1, used as the default hash.
- [x] `ImagePasteSettings` moved into the shared module. `src/settings.ts` re-exports it.
- [x] `src/markdownEditorProvider.ts` imports from `@mikedown/core/shared/imagePaste` and builds the helpers once at module scope with Node `path` + `crypto` SHA-1. Call sites are unchanged. No other file imported `./imagePaste`.
- [x] `test/unit/imagePaste.test.ts` stays put with the same assertions. Only the import block changed (it destructures from `createImagePasteHelpers({ path, sha1Hex: node crypto })`). Added `packages/core/test/imagePasteShared.test.ts`: POSIX (`path.posix`) and Windows (`path.win32`) fixtures, cross-drive containment, and pure SHA-1 checked against node:crypto across block boundaries.
- [x] `packages/core/src/index.ts` does not export the helpers. Added a tsup entry `shared/imagePaste` (giving `dist/shared/imagePaste.js` + `.d.ts`) and a `./shared/*` export in `packages/core/package.json`. `package-shape.test.ts` now checks that the shared build exists, is ESM, has no Node imports, and that the main `index.d.ts` does not expose it.
- [x] compile, lint, test:unit, test:edge, and test:core-package all pass. Committed.

## Files modified

- `packages/core/src/shared/imagePaste.ts` (moved from `src/imagePaste.ts`)
- `packages/core/src/shared/sha1.ts` (new)
- `packages/core/test/imagePasteShared.test.ts` (new)
- `packages/core/test/package-shape.test.ts`
- `packages/core/tsup.config.ts`
- `packages/core/package.json` (exports only)
- `src/markdownEditorProvider.ts` (imports + helper construction)
- `src/settings.ts` (type moved, re-exported)
- `test/unit/imagePaste.test.ts` (import block only)

Root `package.json` and `package-lock.json` were not touched. `npm install` bumped the lockfile's `packages/core` version field (0.0.0 to 0.1.0-rc.1); I reverted that before committing.

## Test/build status

- `npm run compile`: both bundles compiled successfully
- `npx tsc --noEmit -p tsconfig.json`: clean
- `npm run lint`: 0 errors (the warnings were already there, none are new in touched code)
- `npm run test:unit`: 66 files passed, 1 skipped; 937 tests passed
- `npm run test:edge`: 22 passed
- `npm run test:core-package`: 9 passed (including 2 new shared-subpath checks)
- Acceptance: `grep -rn "from './imagePaste'" src/` finds nothing; `src/imagePaste.ts` is gone; the shared module's only import is `./sha1`.

## Issues/blockers

None, apart from the summary location noted above.

## Notes for orchestrator

- The helpers stay synchronous, so the desktop app needs a **synchronous** `PathOps`. `@tauri-apps/api/path` is async and will not fit directly. Options are a small pure path implementation in the desktop package, or `path-browserify` (POSIX only, so Windows needs its own). The plan's alternative `pathPosix.ts` was not built; injection was chosen.
- `crypto.subtle` is async too. The desktop can omit `sha1Hex` and get the pure SHA-1 default, which matches the extension's hash (Node crypto SHA-1).
- The webview's own `ImagePasteSettings` copy in `src/webview/vsCodeSettingsSections.ts` was left alone (out of scope).
- The `./shared/*` export only resolves for modules built as tsup entries (just `imagePaste` today).

## Times

Start 14:21 EDT, end 14:25 EDT, 2026-10-23.

## Review Materials

none (pure refactor, extension behavior unchanged; verified by tests above).
