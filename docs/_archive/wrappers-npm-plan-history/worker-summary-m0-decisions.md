# Worker Summary: M0 — Decisions and spikes

**Status:** Completed. `wrappers-decisions.md` awaits Mike's review (gate for M1 and M5).

Note: the worktree sandbox blocked writing to the main repo's `.orchestrator/`, so this summary is in the worktree's (git-ignored) `.orchestrator/wrappers-npm-plan/`. Copy it to `/Users/michaeljosephwork/git/mikedown/.orchestrator/wrappers-npm-plan/worker-summary-m0-decisions.md`.

## Departures from the plan's defaults (decide these)

1. **`katex` becomes a required peer of core before the 0.1.0 publish.** `styles.css` `@import`s `katex/dist/katex.min.css`, npm never installs optional peers (verified), and a Vite build of that import fails without katex (verified). Without this change, `npm install @mikedown/core` plus the README's CSS import is broken. Adds an M1 item.
2. **Add a `default` condition to every package's `exports`.** Core has only `import`, so Jest can't resolve it. Adds an M1 item.
3. **`packages/angular` is excluded from root workspaces** (`"!packages/angular"`, verified to work) and has its own lockfile. In a workspace spike, npm nested TypeScript 5.4 fine but hoisted `@angular/core` 17 to the root. It is published from `packages/angular/dist` (ng-packagr output). This affects M1's release, version and shape scripts and CI.
4. **The family goes to `0.2.0-rc.0` at M5**, so no wrapper sits at a publishable final version before M15.
5. **The spell-check URL is the folder base** `.../dist/dictionaries`, not `.../dictionaries/en`. Core appends the language.
6. **Core gains `placeholder`, `id`, `ariaLabel`, `ariaLabelledBy`, `landmark` and `outputTransform` options in M5.** This drops the Angular placeholder CSS hack and the `role="main"` on embedded editors, and moves `preserveBrackets` into the binding.
7. **Core list CSS needs `list-style-type`.** Tailwind preflight strips bullets in the editor; M6 fixes it in core.

## Work completed (per checkbox)

- **Versioning:** confirmed lockstep; Changesets alternative recorded; 0.x policy written.
- **Peer strategy:** confirmed, with the katex and `default` corrections. Transitive peer install verified on npm 11.6.1.
- **rc vs final:** confirmed 0.1.0 on `latest`, with wrappers debuting at 0.2.0.
- **Wrap core or the web component:** confirmed.
- **Other easy wins:** keep/defer table written.
- **Web component shape:** light DOM confirmed. Attribute, property and event list fixed (adds form/validity members). `ElementInternals` support checked in MDN compat data. Leakage noted.
- **Standalone bundle:** contents decided. Size measured at about 780 kB gzipped with CSS; **budget set at 850 kB**. jsDelivr URLs verified.
- **Framework ranges:** confirmed, build tools recorded, Jest line written.
- **Angular floor:** 17, peer `>=17.0.0 <23.0.0`. ng-packagr 17.3 builds on Node 22 (spiked). Toolchain layout decided. Legacy app stays vendored.
- **Angular test runner:** Angular 19 Karma/Jasmine harness in `packages/angular/test-app/`.
- **Angular generic inputs:** diffed all three forks and wrote the mapping table. `darkSelector` uses `closest()` semantics.
- **Website layout:** confirmed, with three open checks for M11: semver ordering of `0.3.0-site.N`, `retain: 3`, and `publishLast`.
- **Provenance:** deferred; BACKLOG entry added.
- **Accessibility contract:** written; core already names the PM surface "Document text".
- **Doc written;** awaits Mike's review.

## Files modified

- `wrappers-decisions.md` (new)
- `BACKLOG.md` (new "npm packages and wrappers follow-ups" section: provenance, Blazor, Solid/Preact, Svelte, CDN language trim)

## Test status

No code changed; no tests run. Spikes were run in the scratchpad (`/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/d074522f-4bf7-4bb6-a1c5-769d272462ec/scratchpad/`):

- `sizes/`: esbuild size bundle
- `ngws/`: ng-packagr 17 workspace
- `negws/`: workspace negation
- `optpeer/`: optional and transitive peer install
- `vitecss/`: KaTeX `@import` failure
- `forks/`: read-only copies of the three Angular forks

## Issues or blockers

None. (Summary location: see the note at the top.)

## Notes for orchestrator

- If Mike accepts departures 1 to 3, fold them into M1 before its prompt goes out; M2 must not publish 0.1.0 with katex still optional.
- Cloudflare doesn't cache `/mikedown/` (`cf-cache-status: DYNAMIC`), so the M15 and T4 purge steps can be skipped.
- Angular 17, 18 and 19 are past Angular's LTS window. Floor 17 is kept (no extra cost), but the test harness on 19 should follow the downstream apps when they upgrade.
- M14's BACKLOG item for provenance and Blazor is now a check, not an add.

## Timing

Start 2026-10-24 15:31 EDT; end 15:44 EDT.

## Location

- Worktree: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-aa68eacebb374eb89`
- Branch: `worktree-agent-aa68eacebb374eb89`
- Commit: `729b955` (on base `00ebc4b`)

## Review Materials

- `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-aa68eacebb374eb89/wrappers-decisions.md`
