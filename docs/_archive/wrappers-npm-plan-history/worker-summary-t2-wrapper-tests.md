# T2 summary: wrapper tests and consumer smoke

**Status:** Completed (angular-latest passes on Node 24, skipped on the repo's Node 22.20).

Worktree: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a22bef7cb93de6e90`
Branch: `worktree-agent-a22bef7cb93de6e90`
Commit: `b9431e7` (single commit, on top of main `87684c8`)
Start 17:15, end 17:28 (Oct 24).

Base note: the worktree started at stale `4172f62` (not `01b38bc`, and without the wrappers). It was clean, so I fast-forwarded it to `main` (`87684c8`, which contains `01b38bc`) rather than resetting to `01b38bc`, since the react, vue and angular wrappers are needed.

## Work completed

- `test:wrappers` (root): `test:web-component && test:react && test:vue && test:angular`. Explicit rather than `--workspaces`, which would pull in desktop e2e and miss the non-workspace Angular test app. Green (Angular 25/25 in ChromeHeadless).
- `scripts/consumer-smoke.mjs` + root `test:consumers`: packs core and the wrapper (hash-named tarballs so a changed pack never trips lockfile integrity), scaffolds each target in `$MIKEDOWN_SMOKE_DIR` (default `<tmpdir>/mikedown-consumer-smoke`, never the repo), installs the tarballs, builds. Flags: `--only a,b`, `--list`, `--fresh`. Apps are cached, so re-runs skip `ng new`. Targets: `wc-vite`, `wc-cdn` (`node --check` plus loading the standalone bundle in jsdom and asserting `<mikedown-editor>` is defined), `react-vite` (React 18, `tsc` then `vite build`), `react-next` (Next app router, React 19, `next build`), `vue-vite` (`vue-tsc` then build), `angular-17`, `angular-19`, `angular-latest`, plus an extra `angular-19-no-mermaid`. Type checks run with `skipLibCheck: false`, so the wrappers' `.d.ts` are exercised.
- CI: `test:angular` step replaced by `test:wrappers` (superset). Did not add `test:consumers` to CI (needs network and `ng new`).
- `test:packages` already covers all packages (5 files, 72 tests, includes web-component, react, vue, angular shape tests). `test:unit` 1565 passed, `test:edge` 22 passed.

## Consumer results (Node 22.20.0, cold run with `--fresh`; sizes are JS+CSS in the build output)

| target | build | total | raw | gzip | versions |
| --- | --- | --- | --- | --- | --- |
| wc-vite | 1.7s | 4s | 2665 kB | 855 kB | vite 8.3.5 |
| wc-cdn | 0.9s | 2s | 2560 kB | 779 kB | standalone bundle |
| react-vite | 1.8s | 4s | 2793 kB | 897 kB | react 18.3.1, vite 8.3.5 |
| react-next | 6.0s | 11s | 6575 kB | 1927 kB | next 16.4.3, react 19.3.1 |
| vue-vite | 3.0s | 9s | 2717 kB | 876 kB | vue 3.5.44, vite 8.3.5 |
| angular-17 | 7.9s | 20s | 6255 kB | 1838 kB | angular 17.3.12 |
| angular-19 | 7.8s | 19s | 6269 kB | 1843 kB | angular 19.2.25 |
| angular-latest | 5.7s | 17s | 6082 kB | 1818 kB | angular 22.2.3 (Node 24.22.1 only) |
| angular-19-no-mermaid | 6.1s | 16s | 3179 kB | 956 kB | external mermaid |

Angular and Next sizes include the lazy mermaid chunks (mermaid installed); Vite targets were built without mermaid.

## Findings (for README / owning milestones)

1. **angular-latest needs a newer Node.** Angular CLI 22 on Node 22.20.0: `The Angular CLI requires a minimum Node.js version of v22.22.3 or v24.15.0 or v26.0.0.` The script skips the target with that message on a too-old Node. Verified green on Node 24.22.1 (Angular 22.2.3).
2. **Mermaid.** With mermaid absent: Angular fails (`Could not resolve "mermaid"`, core `index.js` `import("mermaid")`), Next 16 (Turbopack) fails (`Module not found: Can't resolve 'mermaid'`), Vite 7 and 8 build fine (the import is left for runtime). Angular's `externalDependencies: ["mermaid"]` fixes it, so the README can offer it as the alternative to installing mermaid (`angular-19-no-mermaid`, build 6.1s, halves the output size). Next needs mermaid installed too, which the Next README note should say.
3. **Angular default budgets reject the editor.** `ng new` production `initial` budget (500 kB warn, 1 MB error) fails: `bundle initial exceeded maximum budget ... total of 2.99 MB`. The smoke script clears `budgets` (set `SMOKE_KEEP_BUDGETS=1` to keep them); the Angular README should tell users to raise `maximumError` for `initial`. For the Angular owner (M9).
4. No wrapper source bugs found; nothing patched.

## Files modified

- `package.json` (`test:wrappers`, `test:consumers`)
- `scripts/consumer-smoke.mjs` (new)
- `.github/workflows/ci.yml`

## Notes for orchestrator

- Cache/work dir: set `MIKEDOWN_SMOKE_DIR`; first run needs network. A cold full run is about 2 minutes.
- Getting Node 24 locally with Volta shims: scratch-only recipe (a `node@24` npm package plus npm wrapper scripts, `VOLTA_BYPASS=1`); not in the repo.
- Reproduce angular-latest: run with Node >= 22.22.3 or 24.15 first on PATH.

## Review Materials

none
