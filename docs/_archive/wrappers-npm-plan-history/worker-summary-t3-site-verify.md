# T3 summary: Website and docs verification

**Status:** Completed (automated items). Hands-on pass is Mike's.
**Start/end:** 17:42 to 17:53 EDT, 2026-10-24
**Worktree:** /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a0e9734b3e6aeb1bf
**Branch:** worktree-agent-a0e9734b3e6aeb1bf
**Commit:** see final report line (one commit)

The worktree started on a stale commit (f3e342f, behind 17bdd94 with a clean tree); reset to 17bdd94 as instructed.

## Work completed

- [x] `website/test/links.test.ts`: over `website/dist` plus the desktop page (source rendered with `renderLinuxPage(html, null)`, as the dev server does). Per page: every internal href/src resolves to a file in dist or `website/mikedown-desktop/`, hash anchors exist; npm links name a public workspace package; Marketplace links use `itemName=interapp.mikedown-editor` (also the `vscode:extension/` link); GitHub links use `mikejoseph23`. Also checks built CSS `url()` targets and that exactly the 7 expected pages exist. 23 tests, all pass.
- [x] Demo mount: `website/test/mount-{web-component,react,vue,angular}.test.ts` (shared `mount-suite.ts`). Loads the page's built HTML into jsdom, imports its real script bundles, asserts no `error` events and exactly one `.ProseMirror`. One file per page because pages leak state into each other when run in one file (Angular saw 2 editors). jsdom needs a stubbed `fetch` and synthetic `load` events on `<link>` (Vite's dynamic-import preloader waits on them). All 4 pass.
- [x] README link check: `scripts/check-readme-links.mjs` (`npm run check:readme-links`, needs network, not in CI). 28 URLs in 7 READMEs: 15 return 200, 0 fail. Expected-unpublished (not failures):
  - npm: `@mikedown/web-component`, `react`, `vue`, `angular` package pages (publish in M15)
  - `cdn.jsdelivr.net/npm/@mikedown/core@0.2.0/dist/dictionaries` (core 0.2.0 not on npm; only 0.1.0)
  - `cdn.jsdelivr.net` and `unpkg.com` `@mikedown/web-component@0.2.0/dist/mikedown-editor.standalone.js` (web-component unpublished)
  - 6 site pages 404 until the site deploys: `https://www.iadev.net/mikedown/vscode/` and `/developers/` (+ `web-component/`, `react/`, `vue/`, `angular/`)
- [x] `test:wrappers` green (web-component, react, vue, angular 25/25). `test:packages` green (72 tests).

## Files modified

- `website/vitest.config.mjs` (new), `website/test/links.test.ts`, `website/test/mount-suite.ts`, `website/test/mount-*.test.ts` (new)
- `scripts/check-readme-links.mjs` (new)
- `package.json`: added `test:site` (build:site, then tests), `test:site:built` (tests only, against an existing `website/dist`), `check:readme-links`

## Test status

- `npm run test:site`: build ok; 5 files, 27 tests pass
- `npm run test:wrappers`: pass
- `npm run test:packages`: pass
- `node scripts/check-readme-links.mjs`: 0 failed (see above)
- compile/lint/unit/edge not rerun: no `src/` or `packages/core/` changes

## Issues / notes for orchestrator

- No gap-fills found for M12/M13: no broken links, anchors or assets, and no demo page throws on load.
- CI: `test:site` NOT added to ci.yml. It runs offline, but needs the full site build (all packages + Angular CLI build + `npm ci` of `website/developers-angular`), which is slow and would need a new install step. Add it later if wanted.
- READMEs reference `@mikedown/*@0.2.0` CDN URLs; they only resolve after the 0.2.0 family publish (M15).
- The Marketplace/GitHub/npm checks are shape checks (offline), not fetches.

## Review Materials (hands-on, about 15 minutes)

Start: `cd ~/git/mikedown && npm run dev:site` (builds packages first, serves on port 5180).

Pages:

- http://localhost:5180/mikedown/developers/
- http://localhost:5180/mikedown/developers/web-component/ , /react/ , /vue/ , /angular/
- http://localhost:5180/mikedown/vscode/
- Desktop page: http://localhost:5180/mikedown/ in the dev server (same render as release, Linux blocks removed). To render it to a file as the Desktop release does:
  `cd ~/git/mikedown && node packages/desktop/deploy/render-page.js --in website/mikedown-desktop/index.html --out /tmp/mikedown-desktop-index.html --version 0.3.0`
  (screenshots sit beside the source in `website/mikedown-desktop/`; copy the PNGs next to the output to view it standalone, or just use the dev server URL.) The release itself renders via `packages/desktop/deploy/stage-site.js` / `pack-for-lymedeploy.sh --site`.

On each demo page:

- [ ] Typing updates the value panel within a moment; theme toggle flips editor and page; read-only blocks typing; copy buttons copy the install command and sample.
- [ ] Web component page: form submit shows the markdown in the submitted data.
- [ ] Nav works across all pages; at 400 px wide nothing scrolls sideways.
- [ ] Judge the look: spacing, type, code blocks, dark mode, consistency with the desktop page. Orchestrator pauses for sign-off.
