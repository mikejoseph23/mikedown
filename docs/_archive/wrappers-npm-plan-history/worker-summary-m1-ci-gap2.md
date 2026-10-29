# M1 CI gap 2 summary

Status: done
Root cause: no slow timer or wait in the tests. Each boot() builds a full editor in jsdom (0.2-1.2s per test locally; 56 tests in 28s for slashcommandsRoundtrip alone); on the 2-core runner with 118 files this exceeds the 5000 ms default.
Work completed: vitest.config.ts sets testTimeout/hookTimeout to 30000 only when process.env.CI is set. Local defaults unchanged. No tests skipped.
Files modified: vitest.config.ts
Test runs: 3x `CI=1 npx vitest run test/unit packages/core/test --maxWorkers=2` -> 118/118 files passed each time (~66s). (--minWorkers is not a valid flag in this vitest version.)
Issues: worktree was at 6738d38, reset to 636787f (clean). Could not reproduce the runner slowness locally; fix is headroom, real hangs still fail at 30s. .orchestrator/ is gitignored so this summary is uncommitted.
Worktree: /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a15a0df13caee4b72
Branch: worktree-agent-a15a0df13caee4b72
Review Materials: none
