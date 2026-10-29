# Worker Summary: M1 CI gap (CI red on every push)

Status: Complete
Start/end: 2026-10-24 (single session)
Worktree: /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a05e800af62270c66
Branch: worktree-agent-a05e800af62270c66
Commit: b7ac712 (fix); the summary lands in a follow-up commit

## Root cause

`npm run test:unit` includes `packages/desktop/test/unit/standaloneHtml.test.ts`, which reads `packages/core/dist/styles.css`. In CI nothing built core before that step (only `test:packages`, later), so it failed with ENOENT and the job stopped before the later steps.

## Work completed

Added `npm run build:core` before `test:unit` in `.github/workflows/ci.yml`. No test weakened or skipped.

## Files modified

- `.github/workflows/ci.yml`

## Local CI reproduction

Fresh clone in scratchpad at b7ac712, Node v22.20.0, steps in ci.yml order:

- `npm ci`, `npm ci --prefix packages/angular`, `npm ci --prefix packages/angular/test-app`: ok
- `npm run lint`: 0 errors (1066 warnings)
- `npm run build:core`: ok
- `npm run test:unit`: 118 files, 1568 passed, 2 todo
- `npm run test:edge`: 22 passed
- `npm run test:packages`: 72 passed
- `npm run test:wrappers`: Karma 25 of 25 SUCCESS (web-component, react, vue ran earlier in the chain)
- ci.yml parses as valid YAML

## Issues

- No further failures found. Karma already defines `ChromeHeadlessCI` with `--no-sandbox` and the test-app script uses it, so no change was needed there.
- Caveat: reproduced on macOS, not Ubuntu; Chrome on ubuntu-latest is assumed present.

Review Materials: none
