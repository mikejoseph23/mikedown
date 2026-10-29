# Worker summary: M4 Vite pin gap

Status: Completed

## Work completed
- `assertCorePin` in `packages/desktop/vite.config.ts` now uses new `checkInstalledCore` (in `deploy/lib/release-lib.js`): pin equals workspace version is OK; otherwise `packages/desktop/node_modules/@mikedown/core` must exist at exactly the pin, else it throws with an `npm install` hint.
- Header comment updated. Unit tests added to `packages/desktop/test/unit/deploy.test.ts`.
- Base: tree was clean on stale 4172f62 (01b38bc not an ancestor); reset --hard to 01b38bc as instructed.

## Files modified
- packages/desktop/vite.config.ts
- packages/desktop/deploy/lib/release-lib.js
- packages/desktop/test/unit/deploy.test.ts

## Tests
- `RELEASE=1 npx vite build` (frontend only, pin 0.1.0 vs workspace 0.2.0-rc.0): passes.
- `npm run build:desktop`: green (note: it runs `tauri build`, an unsigned local bundle; nothing uploaded).
- `npm run test:unit -w packages/desktop`: 534 passed.
- `npm run test:unit` (root): 1568 passed, 2 todo.

## Which core copy the release build bundles
No resolution fix was needed: Vite resolves from `packages/desktop/`, and the nearest node_modules holds the registry 0.1.0 copy. Proved with a throwaway Vite build plus a `moduleParsed` plugin under `RELEASE=1`; every `@mikedown/core` module came from `packages/desktop/node_modules/@mikedown/core` (0.1.0), none from `packages/core`. Script deleted afterwards.

## Notes
- The unconditional `packages/core/dist` existence check in the config still requires `build:core` even when bundling the registry copy; harmless, left alone.
- Worktree: /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-af86aed7e2b01c1f3
- Branch: worktree-agent-af86aed7e2b01c1f3
- Commit: b0d3b32
- Review Materials: none
