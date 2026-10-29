# M14 READMEs summary

Status: Completed
Worktree: /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a1da393f988f3cd1b
Branch: worktree-agent-a1da393f988f3cd1b (reset to 87684c8; the stale base 4172f62 lacked 01b38bc)

## Work completed

- Root README.md: More MikeDown block (VS Code page, Developers hub, each package with demo links, core npm badge); Repository layout lists the packages and website/. Absolute URLs.
- Package READMEs (core, web-component, react, vue, angular): npm/pnpm note plus explicit Yarn line generated from packages/core/package.json peerDependencies, Accessibility (ARIA order), Theming pointer to core, Browser support, Privacy (no telemetry), Links (demo, hub, npm, GitHub), Jest line, Testing. Core links every wrapper. Angular gets Known limitations (mermaid must be installed, shared page state). Existing API tables checked against source (react/vue props, angular inputs); no corrections needed.
- CLAUDE.md: packages and website/ in Architecture, test:wrappers, test:consumers, dev:site, build:site, site publish flow (pack-for-lymedeploy.sh --site).
- BACKLOG.md: trusted-publishing entry already existed (checked); added typedoc API reference and styles-base.css; Blazor, Solid/Preact, Svelte already present; React wrapper item marked done.
- wrappers-decisions.md: note recording Mike's call to keep the ARIA name order.

## Files modified

README.md, CLAUDE.md, BACKLOG.md, wrappers-decisions.md, packages/{core,web-component,react,vue,angular}/README.md

## Test status

Docs only; no src/ or build changes, so compile/lint/tests not run. npm install ok.

## Issues / notes for orchestrator

- test:wrappers and test:consumers are documented under the names in the plan; T2 must land them with those names.
- Demo URLs go live only after M15.

Review Materials: none
