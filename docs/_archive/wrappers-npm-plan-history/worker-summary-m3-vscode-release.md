# Worker summary: M3 VS Code extension 2.15.0

Status: Completed (tag, push and Marketplace upload deliberately not done).
Start 16:49, end ~16:56 (2026-10-24).
Worktree: /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a84d3a545747a0aac
Branch: worktree-agent-a84d3a545747a0aac

## Work completed

- Worktree was stale (no 0a9d1b8); tree clean, `git reset --hard 0a9d1b8`.
- README.md: "More MikeDown" block (Desktop + @mikedown/core on npm, absolute URLs) before "Why MikeDown?".
- CHANGELOG.md: Unreleased became `[2.15.0] - 2026-10-24`. Reviewed `git log v2.14.2..HEAD -- src packages/core`: added two missing user-facing lines (editor textbox named for assistive tech; 15px font size fallback unified). Internal note now says core is on npm. Zoom control and narrow-sidebar fix are both in the entry; every claim on the M13 website VS Code page (zoom, narrow sidebar, footnotes, math, heading numbering, callouts) is backed by a changelog entry. Nothing unbacked found.
- vsix:minor: package.json and package-lock.json 2.14.2 to 2.15.0; packages/core stays 0.2.0-rc.0.
- .vsix: /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a84d3a545747a0aac/mikedown-editor-2.15.0.vsix, 4,603,281 bytes vs 4,463,889 for 2.14.2 (+3.1%).

## Tests

- npm run lint: 0 errors (1066 warnings, pre-existing).
- npm run test:unit: 1 failure at first (desktop standaloneHtml test needs packages/core/dist/styles.css); after `npm run build:core` all pass. Fresh worktrees need build:core before test:unit.
- npm run test:edge: 22 passed.
- npm run test:integration: the stock command fails in this worktree (Electron IPC socket path over 103 chars, "listen EINVAL"; environment, not a test failure). Re-ran after `npm run compile` with a throwaway config adding `--user-data-dir=/tmp/mdvs-ud --extensions-dir=/tmp/mdvs-ext` (deleted, not committed): 47 passing.

## Commands for Mike

- Upload the .vsix to the Marketplace by hand.
- Then `git tag v2.15.0` and push (not done; awaiting approval).

## Issue reply drafts

None. Every GitHub issue (#1 to #10) was closed on or before 2026-10-20; no open or newly closed issue is fixed by 2.15.0 changes.

## Notes for orchestrator

- The reset to 0a9d1b8 means this branch lacks the M11/M13 commits that are on main; the merge touches only CHANGELOG, README, package.json, package-lock.json and this summary.

Review Materials: /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a84d3a545747a0aac/mikedown-editor-2.15.0.vsix
