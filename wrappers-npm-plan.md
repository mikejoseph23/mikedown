# MikeDown npm Packages, Framework Wrappers and Website — Planning Document

## Summary

`@mikedown/core` (`createMikeDownEditor(container, { host })`) already powers the VS Code extension, MikeDown Desktop and a vendored Angular wrapper, but nothing is on npm and the public web presence is one desktop download page. This plan publishes the core, adds a family of framework packages on top of it, ships VS Code 2.15.0, and gives developers a place to find, try and install all of it.

**Objectives**

1. `@mikedown/core` on npm (0.1.0 final), then the downstream apps and desktop releases consume the registry version.
2. A package family in this workspace, all MIT, typed, with READMEs: `@mikedown/web-component` (`<mikedown-editor>`), `@mikedown/react`, `@mikedown/vue`, `@mikedown/angular` (the existing CVA wrapper as a real ng-packagr library, Angular 17+). Svelte is deferred (the web component covers it).
3. One release script for every public package: dry-run, `--tag rc` for prereleases, lockstep versions, a shape test.
4. Website: a Developers hub with a live demo per wrapper, a refreshed VS Code page, and cross-links between VS Code, Desktop and npm. Root README links to all of it.
5. VS Code extension 2.15.0 released from `main`.

**Critical success factors**

- Each wrapper is proven by a consumer smoke test: pack the tarball, install it into a throwaway app for that framework, build it.
- The VS Code extension and desktop builds stay green at every commit.
- The Angular package installs in Angular 17+ apps (LymeStarter and the Quantico assistant app are on 19). Quantico Creek's legacy Angular 14 app is out of scope and keeps its vendored copy.
- Nothing is published, pushed or deployed without Mike's say-so.

**Defaults applied (override any of these):** incremental testing after each phase; Playwright off; no schema; not LymeStack mode; no screenshots (the demo pages are judged in the T3 hands-on pass); core goes out as **0.1.0 final**, not another rc; the `@mikedown/*` npm packages are versioned **in lockstep with each other** and **independently of** the VS Code extension and Desktop; React, Vue and Angular wrap **core directly**, and the web component is the route for everything else (plain HTML, CDN, htmx, Lit, Solid, Svelte, Blazor, server-rendered pages); the web component uses **light DOM** (the core's portal and scoped CSS assume it); Angular floor is **17** (no Angular 14 build; Quantico Creek legacy stays vendored); `lyme-markdown-editor` stays a permanent alias of `mikedown-editor`; Svelte is deferred; CI (lint and test, no publish) is a required M1 item; the website pages live under `https://www.iadev.net/mikedown/` (`/mikedown/` stays the desktop page, new `/mikedown/vscode/` and `/mikedown/developers/`), all through the **one existing LymeDeploy project** `mikedown-downloads` via a site-only publish path (no second project); npm provenance is deferred (it needs a CI publish); every package is **ESM only** (matching core), ships `.d.ts`, targets ES2020 evergreen browsers (Safari 16.4+ for the form-associated web component), and is **telemetry-free**; 0.x semver: minors may break, patches never, and every release bumps the whole family.

### Milestone Progress Tracker

| Milestone | Model | Status | Duration (min) | Notes |
|---|---|---|---|---|
| [M0 — Decisions and spikes](#m0--decisions-and-spikes) | Opus | ✅ Complete | 13 | `wrappers-decisions.md` approved 2026-10-24 |
| [G1 — npm account and org (Mike)](#g1--npm-account-and-org-mike) | — (Mike) | ✅ Complete | — | `interapp` owns `mikedown`; 2FA on for auth and publishing (security key) |
| [M1 — Release tooling and versioning](#m1--release-tooling-and-versioning) | Sonnet | ✅ Complete | 20 | Decouple core from the vsix bump |
| [M2 — Publish `@mikedown/core` 0.1.0](#m2--publish-mikedowncore-010) | Sonnet | ✅ Complete | 2 | 0.1.0 on `latest` 2026-10-24; tagged `core-v0.1.0` |
| [M3 — VS Code extension 2.15.0](#m3--vs-code-extension-2150) | Sonnet | ✅ Complete | 5 | Mike uploads the `.vsix` |
| [M4 — Downstream onto registry core](#m4--downstream-onto-registry-core) | Sonnet | ✅ Complete | 15 | LymeStarter, Quantico Creek, Desktop pin |
| [T1 — Release verification](#t1--release-verification) | Sonnet | 🔄 Awaiting Mike hands-on | 8 | unit/integration + registry smoke |
| [M5 — Core value binding helper](#m5--core-value-binding-helper) | Sonnet | ✅ Complete | 12 | Shared by every wrapper; family at 0.2.0-rc.0 |
| [M6 — `@mikedown/web-component`](#m6--mikedownweb-component) | Opus | ✅ Complete | 21 | `<mikedown-editor>`, form-associated, CDN bundle |
| [M7 — `@mikedown/react`](#m7--mikedownreact) | Sonnet | ✅ Complete | 4 | Controlled/uncontrolled, ref, SSR-safe |
| [M8 — `@mikedown/vue`](#m8--mikedownvue) | Sonnet | ✅ Complete | 3 | Vue 3, `v-model` |
| [M9 — `@mikedown/angular`](#m9--mikedownangular) | Opus | ✅ Complete | 15 | ng-packagr, partial Ivy, Angular 17+ |
| [M10 — `@mikedown/svelte` (deferred)](#m10--mikedownsvelte-deferred) | Sonnet | ⏸ Deferred | — | Out of this plan; web component covers Svelte |
| [T2 — Wrapper tests and consumer smoke](#t2--wrapper-tests-and-consumer-smoke) | Sonnet | ✅ Complete | 11 | vitest per package + throwaway apps |
| [M11 — Site build and deploy path](#m11--site-build-and-deploy-path) | Sonnet | ✅ Complete | 11 | `website/` Vite MPA, site-only publish via `mikedown-downloads` |
| [M12 — Developers hub and demo pages](#m12--developers-hub-and-demo-pages) | Opus | ✅ Complete | 27 | UI design |
| [M13 — VS Code page refresh and cross-links](#m13--vs-code-page-refresh-and-cross-links) | Opus | ✅ Complete | 14 | UI design |
| [M14 — READMEs](#m14--readmes) | Sonnet | ✅ Complete | 3 | Root (Marketplace listing) + per package |
| [T3 — Website and docs verification](#t3--website-and-docs-verification) | Sonnet | ✅ Complete | 7 | link check + hands-on |
| [M15 — Publish the 0.2.0 family and the site](#m15--publish-the-020-family-and-the-site) | Sonnet | 🔄 Awaiting Mike publish | 6 | Mike runs publish and deploy |
| [M16 — Downstream onto `@mikedown/angular`](#m16--downstream-onto-mikedownangular) | Sonnet | ⬜ Not Started | — | LymeStarter + Quantico assistant onto the package; legacy stays vendored |
| [T4 — Final verification](#t4--final-verification) | Sonnet | ⬜ Not Started | — | registry smoke + production URLs |

**Model Assignment Guidelines:** Haiku for mechanical/boilerplate; Sonnet for well-defined feature work; Opus for architecture, ambiguous decisions, and all front-end UI design work.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## Table of Contents

- [Summary](#summary)
- [Current state (verified 2026-10-24)](#current-state-verified-2026-10-24)
- [Worker rules](#worker-rules)
- [Phase 1 — Core publish and extension release](#phase-1--core-publish-and-extension-release)
  - [M0 — Decisions and spikes](#m0--decisions-and-spikes)
  - [G1 — npm account and org (Mike)](#g1--npm-account-and-org-mike)
  - [M1 — Release tooling and versioning](#m1--release-tooling-and-versioning)
  - [M2 — Publish `@mikedown/core` 0.1.0](#m2--publish-mikedowncore-010)
  - [M3 — VS Code extension 2.15.0](#m3--vs-code-extension-2150)
  - [M4 — Downstream onto registry core](#m4--downstream-onto-registry-core)
  - [T1 — Release verification](#t1--release-verification)
- [Phase 2 — Wrappers](#phase-2--wrappers)
  - [M5 — Core value binding helper](#m5--core-value-binding-helper)
  - [M6 — `@mikedown/web-component`](#m6--mikedownweb-component)
  - [M7 — `@mikedown/react`](#m7--mikedownreact)
  - [M8 — `@mikedown/vue`](#m8--mikedownvue)
  - [M9 — `@mikedown/angular`](#m9--mikedownangular)
  - [M10 — `@mikedown/svelte` (deferred)](#m10--mikedownsvelte-deferred)
  - [T2 — Wrapper tests and consumer smoke](#t2--wrapper-tests-and-consumer-smoke)
- [Phase 3 — Website and docs](#phase-3--website-and-docs)
  - [M11 — Site build and deploy path](#m11--site-build-and-deploy-path)
  - [M12 — Developers hub and demo pages](#m12--developers-hub-and-demo-pages)
  - [M13 — VS Code page refresh and cross-links](#m13--vs-code-page-refresh-and-cross-links)
  - [M14 — READMEs](#m14--readmes)
  - [T3 — Website and docs verification](#t3--website-and-docs-verification)
- [Phase 4 — Ship the family](#phase-4--ship-the-family)
  - [M15 — Publish the 0.2.0 family and the site](#m15--publish-the-020-family-and-the-site)
  - [M16 — Downstream onto `@mikedown/angular`](#m16--downstream-onto-mikedownangular)
  - [T4 — Final verification](#t4--final-verification)
- [Decisions (2026-10-24)](#decisions-2026-10-24)
- [Parallel Development Recommendations](#parallel-development-recommendations)
- [Gap-Filling Prompts](#gap-filling-prompts)
- [Progress Log / Notes](#progress-log--notes)

---

## Current state (verified 2026-10-24)

- **Core:** `packages/core/package.json` is `@mikedown/core@0.1.0-rc.1`, `publishConfig.access: public`, ESM only, 25 peer deps (TipTap 3, CodeMirror 6, lowlight; `mermaid`/`katex` optional). `npm view @mikedown/core` is 404 and `npm whoami` fails. The package README wrongly says it is "published under the `rc` tag".
- **Version coupling bug:** `npm run vsix` runs `scripts/sync-core-version.js`, which sets core's version to the extension's. The next `npm run vsix` would turn core `0.1.0-rc.1` into `2.14.3`. M1 fixes this before M3.
- **Release scripts:** `scripts/release-core.sh` publishes with `--tag rc` for prereleases, or packs to `/Volumes/Storage/LymeStack/packages/npm/` when not logged in. `test:core-package` runs `packages/core/test/package-shape.test.ts`.
- **Angular wrapper** (`MikeDownEditorComponent`, `<lyme-markdown-editor>`, CVA, ~290 LOC + `AngularMikeDownHost`, spec 237 LOC) exists in three vendored copies:
  - `~/git/lymestarter/ng-app/src/app/lymestack-optional/mikedown/` (Angular 19.2, standalone, LymeStack `html[data-mode]` theme, Roboto). Branch `develop`; Karma tests.
  - `~/git/quanticocreek/quantico-creek-angular-app/src/app/shared/mikedown/` (Angular 14.2, TS 4.7, NgModule, `.dark-theme` ancestor, Open Sans, extra `preserveBrackets` input). Branch `master`. **Legacy: stays vendored, out of scope for the package.**
  - `~/git/quanticocreek/quantico-creek-assistant-app/src/app/shared/mikedown/` (Angular 19.2).
  - All three pin `"@mikedown/core": "file:vendor/mikedown-core-0.1.0-rc.1.tgz"`.
- **Desktop** pins `@mikedown/core` `0.1.0-rc.1` exactly; `deploy/check-core-pin.js` makes every release pass `--allow-unpublished-core` until the pinned version is on npm.
- **Websites:**
  - `website/mikedown-desktop/index.html` is live at `https://www.iadev.net/mikedown/` (IIS virtual dir on iadev-prod, Cloudflare-fronted). `release.sh` renders it with the release version into `deploy/dist/<v>/upload/`; `check-upload.js` requires that folder to be flat and exact; LymeDeploy project `mikedown-downloads` publishes additively (never prunes); M11 adds a site-only publish path to it. VS Code is only a footer link.
  - `website/index.html` (VS Code landing page, March 2026) is **not hosted anywhere**: no GitHub Pages, no CNAME, no deploy script, images point at `../assets/screenshots/`. Its copy is stale ("beta", 1.0-era features) and the footer links `github.com/michaeljoseph` (the repo owner is `mikejoseph23`).
- **Root `README.md` is the VS Code Marketplace listing** (vsce packages it). It links the Marketplace and GitHub only.
- **Extension:** 2.14.2. `CHANGELOG.md` `## [Unreleased]` holds the zoom control, tooltip, callout, save-race, serializer round-trip, dark code block and narrow-sidebar fixes.
- **Toolchain:** Node 22 default (no Angular 14 / Node 18 build needed: the Angular floor is 17).

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## Worker rules

Apply to every milestone.

- Read `CLAUDE.md` in each repo you touch (`~/git/mikedown`, `~/git/lymestarter`, `~/git/quanticocreek`).
- **Complete every checkbox in your milestone.** Don't skip items as low priority or slightly out of scope. If an item should be dropped or deferred, say so in your summary for the orchestrator to decide, but attempt it unless truly blocked.
- **Branches:** never create one. MikeDown work lands on `main`; LymeStarter on `develop`; Quantico Creek on `master`. If the orchestrator isolates parallel workers in worktrees, it brings the commits onto `main` and removes the worktree branch.
- **Commits:** one per logical step, written as a human developer. Never mention Claude, Anthropic, AI, or add `Co-Authored-By` / `Generated with` lines.
- **Never** run `git push`, `npm publish`, `lymedeploy` deploys, Cloudflare purges or a Marketplace upload. Prepare them, dry-run them, and hand Mike the exact command.
- Keep the extension green: `npm run compile`, `npm run lint`, `npm run test:unit`, `npm run test:edge` before each commit that touches `src/` or `packages/core/`.
- Core constraints still apply: never mutate `editor.view.dom` outside a ProseMirror transaction; keep the `tiptap-markdown` ES alias and `mainFields: ['module', 'browser', 'main']`.
- Markdown you write: escape `$` as `\$`, blank lines before and after lists.
- When done: commit, write `.orchestrator/worker-summary-<milestone-slug>.md` (what changed, what was skipped and why, files touched, follow-ups), then prompt the user to clear the context. Only the orchestrator ticks this plan's checkboxes and tracker.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## Phase 1 — Core publish and extension release

## M0 — Decisions and spikes

**Recommended model:** Opus. Several cross-cutting decisions plus a toolchain spike.

**Goal:** settle every decision the wrapper milestones would otherwise re-litigate. Output: `wrappers-decisions.md` at the repo root. **Gate:** Mike approves it before M1 and M5 start.

**Worker completion requirement:** complete ALL items below; note any you think should be dropped, but attempt them.

- [x] **Versioning.** Confirm the default: the `@mikedown/*` npm packages share one version (lockstep), independent of the extension (2.x) and Desktop (0.3.x). Wrappers declare `@mikedown/core` as a peer with `^<family version>` (on 0.x, `^0.2.0` means `<0.3.0`, which is why the whole family republishes on every bump). Record the alternative (independent versions with changesets) and why it lost. Write the 0.x semver policy (minors may break, patches never; one `CHANGELOG.md` per package).
- [x] **Peer strategy and install story.** Confirm: wrappers peer on core only and never re-list the TipTap/CodeMirror peers; core keeps them as peers (one ProseMirror/CodeMirror per app, see `core-extraction-decisions.md`). npm 7+ and pnpm 8+ auto-install peers transitively; Yarn does not, so READMEs carry an explicit peer install line. `sideEffects: false` on wrappers except the web component's `./define` entry.
- [x] **rc vs final.** Confirm the default: core goes out as `0.1.0` on `latest` (three apps already run it; 0.x already signals pre-1.0; an rc-only package forces `@rc` on every install). Wrappers debut together as `0.2.0` (core bumps too, for the M5 binding export).
- [x] **Wrap core or the web component, per wrapper.** Confirm the default: React, Vue and Angular wrap core directly (idiomatic value binding, no global custom-element registry, simpler SSR, no double debounce). The web component serves plain HTML, CDN/no-build, htmx, Lit, Solid, Preact, Svelte (deferred), Blazor, Rails/Django templates.
- [x] **Other easy wins.** List candidates with a keep/defer call each. Defaults: keep a self-contained CDN bundle of the web component (jsDelivr/unpkg, core and peers inlined, CSS injected); defer Solid/Preact (covered by the web component and `preact/compat`); defer a Blazor wrapper to `BACKLOG.md`.
- [x] **Web component shape.** Confirm light DOM: core's `.mikedown-portal` on `<body>` and `.mikedown-root`-scoped CSS break in a shadow root, and ProseMirror's selection handling inside shadow roots is unreliable (Safari has no `shadowRoot.getSelection`). Cost: consumer resets (Tailwind preflight, global `p`/`h1` rules) can leak into the editor; document the token overrides that fix it. Fix the attribute/property/event list (see M6) and how styles load (npm: consumer imports `@mikedown/core/styles.css`; CDN bundle: injects one `<style>`). Confirm form association via `ElementInternals` (Chrome 77+, Firefox 98+, Safari 16.4+).
- [x] **Standalone (CDN) bundle contents.** `styles.css` starts with `@import 'katex/dist/katex.min.css'` (fonts via relative URLs) and core loads `mermaid`/`katex` with bare dynamic `import()`, which fails in a no-build page. Default: the standalone bundle rewrites those two imports to pinned jsDelivr `+esm` URLs and loads the KaTeX CSS from jsDelivr; the alternative is math and mermaid off by default. Dictionaries stay out of the bundle (document the jsDelivr `dist/dictionaries/en` URL for `spellcheck-dictionary-url`). Set a gzipped size budget.
- [x] **Framework ranges.** Defaults: React `>=18` (test 18 and 19; `forwardRef` still works on 19), Vue `>=3.3` (explicit `modelValue`/`update:modelValue`, not `defineModel`, which needs 3.4), Angular `>=17` (see the floor item below). Record the build tool per package (tsup for web-component and React; Vite library mode + `vue-tsc` for Vue; ng-packagr for Angular). All ESM only; note the Jest `transformIgnorePatterns` line consumers need.
- [x] **Angular floor.** Decided: no Angular 14 build; `@mikedown/angular` targets Angular 17+ (partial-Ivy output is forward-compatible only, so compile with the oldest supported major). Confirm the floor you pick is >=17 and state **17** as the default. Record the peer range (default `>=17.0.0 <23.0.0`, widened per major after a smoke build) and how the ng-packagr toolchain lives in the workspace (nested `node_modules` in `packages/angular`, or excluded from `workspaces` with its own lockfile, so root TypeScript 5 never hoists over it). Quantico Creek's legacy Angular 14 app keeps its vendored copy; note that.
- [x] **Angular test runner.** Pick how the ported 237-line spec runs (default: TestBed specs in a small Angular 19 harness under `packages/angular/test-app/`, because the library's own toolchain is pinned to the floor, 17).
- [x] **Angular generic inputs.** Map each fork difference to a generic input so LymeStarter and the Quantico assistant app can use one package: `preserveBrackets`, dark-mode source (`theme="auto"` plus a `darkSelector` input such as `html[data-mode=dark]` or `.dark-theme`), fonts through a `settings` input, `imageBaseUrl` / `imageSrcResolver` / `imageUpload` as today. Selector (decided): export `mikedown-editor` and keep `lyme-markdown-editor` as a permanent alias; no template migration.
- [x] **Website layout and hosting.** Decided: one LymeDeploy project (`mikedown-downloads`), everything under `https://www.iadev.net/mikedown/`. Confirm `/mikedown/` stays the desktop page; new `/mikedown/vscode/` (refreshed `website/index.html`) and `/mikedown/developers/` (hub, plus `/developers/<framework>/` demos). Confirm the `website/` folder becomes a private workspace (`"workspaces": ["packages/*", "website"]`, Vite multi-page, dev port 5180, base `/mikedown/`), with the desktop page still rendered only by `release.sh`. Record how site pages and the desktop page's cross-links go live without a desktop release: the site-only publish path (see M11).
- [x] **Provenance and publish security.** Record the default: provenance deferred. `npm publish --provenance` needs a CI OIDC publish (GitHub Actions trusted publishing); local publishes can't attest. npm's 2025 policy requires 2FA on every publish and has retired long-lived publish tokens, so Mike publishes from his terminal with an OTP and CI publishing later means trusted publishing. Add to `BACKLOG.md`.
- [x] **Accessibility contract.** Every wrapper forwards `id`, `aria-label` and `aria-labelledby` to the editable surface; the web component is labelable (`<label for>` focuses it). Record it so M5–M10 implement it the same way.
- [x] Write `wrappers-decisions.md` with each decision and a one-line "what changes in this plan". **Stop and ask Mike to review it.**

**Review locator:** `~/git/mikedown/wrappers-decisions.md`.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## G1 — npm account and org (Mike)

**Owner:** Mike. No worker. Blocks M2 (and M15).

- [x] `npm login` on the Mac Studio (`npm whoami` returns your user). *(user `interapp`)*
- [x] Create the free org `mikedown` on npmjs.com (Add Organization), which reserves the `@mikedown` scope.
- [x] Turn on 2FA (authenticator app or passkey). npm now requires it on every publish and no longer issues long-lived publish tokens, so the publish commands in M2 and M15 prompt for an OTP and you run them in your terminal.
- [x] Tell the orchestrator it's done.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## M1 — Release tooling and versioning

**Recommended model:** Sonnet.

**Goal:** one script releases any or all public packages; the extension's version no longer drags core along.

**Worker completion requirement:** complete ALL items below; note any you think should be dropped, but attempt them.

- [x] Remove the core sync from `npm run vsix` (drop `scripts/sync-core-version.js` from the chain; delete the file or repurpose it). Add `vsix:minor` (`npm version minor --no-git-tag-version && npm run package && vsce package`); `vsix` stays the patch variant.
- [x] `scripts/version-npm.mjs <version>`: sets the version on every public `packages/*` package (core, web-component, react, vue, angular as they exist), updates each wrapper's `@mikedown/core` peer to `^<version>` and the workspace devDependency, and refuses a version lower than the current one.
- [x] `scripts/release-npm.mjs`: discovers public packages (no `"private": true`), builds each, runs `npm pack --dry-run` and prints the file list. Flags: `--only <name,...>`, `--dry-run` (default; publishes nothing), `--publish`, `--otp <code>` passthrough. Prerelease versions publish with `--tag rc`; `--access public` always. Skips a package whose version is already on npm. Without `npm whoami`, packs to `/Volumes/Storage/LymeStack/packages/npm/` (fallback `.orchestrator/wrappers-npm-plan/artifacts/`) like `release-core.sh`. Publishes core first, then the rest.
- [x] Root scripts: `release:npm` (the new script), `version:npm`; keep `release:core` as `release:npm -- --only core`; delete `scripts/release-core.sh` once the alias works.
- [x] Generalize the shape test into `test/packages/package-shape.test.ts` (keep core's specific checks): for every public package, `exports` targets exist, `types` resolve, `files` includes `dist`, `README.md`, `LICENSE.md`, `license` is MIT, `repository.directory` matches, no `private`, wrapper core peer equals `^<family version>`. Root script `test:packages` (builds then tests); keep `test:core-package` as an alias.
- [x] Fix `packages/core/README.md` status line (not yet published; install will be `npm install @mikedown/core`). Add `.npmrc` to `.gitignore` (no tokens in the repo).
- [x] `.github/workflows/ci.yml` (required, decided): lint, `test:unit`, `test:edge`, `test:packages` on push and PR; no publish step. Trusted publishing later builds on it.
- [x] Update `CLAUDE.md` "Releasing" and the command table: npm family releases are independent of the extension; `npm run vsix` no longer touches core; the order (npm first) is only required when the extension or desktop needs a new core version.
- [x] *(M0)* Core: `katex` becomes a required peer (drop it from `peerDependenciesMeta`; `mermaid` stays optional). Shape test checks it.
- [x] *(M0)* Every `exports` entry in every public package gets `"default"` after `"import"` (Jest resolution). Shape test checks it.
- [x] *(M0)* `version-npm.mjs`, `release-npm.mjs` and the shape test find packages by globbing `packages/*/package.json`, and treat `packages/angular` (when it exists) as a non-workspace package with its own lockfile, published from `packages/angular/dist`. CI runs `npm ci --prefix packages/angular` when that folder exists.
- [x] `npm run lint`, `test:unit`, `test:edge`, `test:packages`, and `npm run release:npm` (dry run) green. Commit.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## M2 — Publish `@mikedown/core` 0.1.0

**Recommended model:** Sonnet. **Needs:** G1, M1.

**Worker completion requirement:** complete ALL items below; note any you think should be dropped, but attempt them.

- [x] `npm run version:npm -- 0.1.0`. Add `packages/core/CHANGELOG.md` with a 0.1.0 entry (first public release; API summary).
- [x] `npm run test:packages` and `npm run release:npm -- --only core` (dry run) green; paste the packed file list and gzipped size into the summary. Commit `@mikedown/core 0.1.0`.
- [x] **Stop.** Hand Mike: `cd ~/git/mikedown && npm run release:npm -- --only core --publish` (he enters the OTP).
- [x] After Mike confirms: `npm view @mikedown/core version dist-tags` shows `0.1.0` on `latest`. Record it in the Progress Log. Ask Mike to set the package to "Require two-factor authentication and disallow tokens" on npmjs.com.
- [x] Ask Mike before tagging `core-v0.1.0` and pushing.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## M3 — VS Code extension 2.15.0

**Recommended model:** Sonnet. **Needs:** M1 (version decoupling). The extension bundles core from source, so it does not need the publish; prefer running after M2 so the README can link npm, but if G1 drags, release 2.15.0 first and let M14 add the npm link.

**Worker completion requirement:** complete ALL items below; note any you think should be dropped, but attempt them.

- [x] Root `README.md`: add a short "More MikeDown" block near the top linking MikeDown Desktop (`https://www.iadev.net/mikedown/`) and, if M2 has shipped, `@mikedown/core` on npm (`https://www.npmjs.com/package/@mikedown/core`). Absolute URLs only (this file is the Marketplace listing). The Developers and VS Code pages are added in M14 once they exist.
- [x] `CHANGELOG.md`: `## [Unreleased]` becomes `## [2.15.0] - <date>`; check every merged fix since 2.14.2 is listed (`git log v2.14.2..HEAD --oneline -- src packages/core`); fix the Internal note to say `@mikedown/core` is now on npm.
- [x] `npm run lint`, `test:unit`, `test:edge`, `test:integration` green.
- [x] `npm run vsix:minor` → `mikedown-editor-2.15.0.vsix`; size within 10% of `mikedown-editor-2.14.2.vsix`; core's version unchanged.
- [x] Commit `Release 2.15.0`. Hand Mike the `.vsix` path for the manual Marketplace upload; ask before tagging `v2.15.0` and pushing.
- [x] After upload: GitHub issues fixed in this release get a reply per `CLAUDE.md` (first person as Mike, release name, one review ask per person; skip users in the memory list). Draft only, Mike posts.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## M4 — Downstream onto registry core

**Recommended model:** Sonnet. **Needs:** M2.

**Worker completion requirement:** complete ALL items below; note any you think should be dropped, but attempt them.

- [x] LymeStarter (`develop`): `ng-app/package.json` `"@mikedown/core": "^0.1.0"`; delete `ng-app/vendor/mikedown-core-0.1.0-rc.1.tgz`; `npm install`; `ng build` and `ng test --watch=false` green; update the doc that mentions the vendored tarball. Commit.
- [x] Quantico Creek (`master`): same in `quantico-creek-angular-app` and `quantico-creek-assistant-app`; both `ng build` green. Commit.
- [x] Desktop: pin `"@mikedown/core": "0.1.0"`; `node packages/desktop/deploy/check-core-pin.js` passes **without** `--allow-unpublished-core`. Remove the flag from `RESUME.md`, `packages/desktop/deploy/README.md` and the release examples; keep the flag in the script for future unpublished bumps. `npm run build:desktop` green. Commit.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## T1 — Release verification

**Recommended model:** Sonnet. **Modes:** unit/integration, a registry consumer smoke, one short hands-on check.

**Worker completion requirement:** complete ALL automated items; report failures, don't fix them (open a gap-fill for the owning milestone).

- [x] MikeDown: `test:unit`, `test:edge`, `test:integration`, `test:packages`, `test:desktop` green.
- [x] Registry smoke: in the scratchpad, `npm create vite@latest smoke -- --template vanilla-ts`, `npm install @mikedown/core` (peers auto-install), mount the README example, `npm run build` green; `node -e "import('@mikedown/core')"` succeeds (import stays SSR-safe).
- [x] LymeStarter and both Quantico Creek apps build from the registry core package (re-run if M4 did it before the smoke).
- [ ] **Hands-on (Mike, 3 minutes):** in VS Code, Extensions panel, confirm MikeDown Editor shows 2.15.0 after the Marketplace update; open `~/git/mikedown/test/workspace/` any `.md` file; type, save, use the toolbar zoom `[−] 15 [+]`; open a callout document and confirm no duplicated body text. Orchestrator pauses for sign-off.

**Also (M0):** apply the "What changes in this plan" lines for T1 in `wrappers-decisions.md`.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## Phase 2 — Wrappers

Package layout for every wrapper: `packages/<name>/` with `package.json` (MIT, `type: module`, `exports` with `types`, `sideEffects`, `files`, `repository.directory`, `publishConfig.access: public`), `src/`, `test/`, `README.md`, `LICENSE.md` (copy of the root), `tsconfig.json`, a `build` and `test` script. Wrappers start at the family version and peer on `@mikedown/core` `^<family>`.

## M5 — Core value binding helper

**Recommended model:** Sonnet. **Needs:** M0.

**Goal:** the logic every wrapper repeats (debounced change, external-write dedupe, pristine loads, theme `auto`) lives once in core.

**Worker completion requirement:** complete ALL items below; note any you think should be dropped, but attempt them.

- [x] `packages/core/src/binding.ts` exporting `bindMikeDownValue(container, { initialValue, debounceMs = 150, onValue, theme, darkSelector?, ...MikeDownOptions })` → `{ handle, setValue(md), flush(), setTheme(t), destroy() }`. Lift the behavior from the Angular wrapper: `setValue` loads pristine and skips when equal; keystrokes report after the debounce and at once on blur; `theme: 'auto'` follows `darkSelector` (MutationObserver) or `prefers-color-scheme`. Accepts `ariaLabel` / `ariaLabelledBy` / `id` and applies them to the editable surface (M0 accessibility contract); exposes `focus()`.
- [x] Export from the package root and as `@mikedown/core/binding`; add to `exports` and `index.d.ts`.
- [x] Unit tests in `packages/core/test/binding.test.ts` (jsdom): debounce, flush on blur, equal-value skip, pristine load, auto theme on selector change and media change, destroy removes observers.
- [x] Core README section. `test:unit`, `test:packages` green. Commit.

**Also (M0):** apply the "What changes in this plan" lines for M5 in `wrappers-decisions.md`.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## M6 — `@mikedown/web-component`

**Recommended model:** Opus. Public API design plus form association and a no-build bundle.

**Worker completion requirement:** complete ALL items below; note any you think should be dropped, but attempt them.

- [x] `MikeDownElement extends HTMLElement`, light DOM, built on `bindMikeDownValue`. `@mikedown/web-component` exports the class and `defineMikeDownElement(tag = 'mikedown-editor')`; `@mikedown/web-component/define` registers it (guarded against double definition) and is the only entry listed in `sideEffects`.
- [x] Labelable and focusable: `<label for>` focuses the editor; `aria-label` / `aria-labelledby` forwarded per M0.
- [x] Attributes (reflected): `value`, `theme` (`light|dark|auto`), `readonly`, `disabled`, `placeholder`, `name`, `required`, `min-height`, `dark-selector`, `spellcheck-dictionary-url`, `features` (JSON).
- [x] Properties: `value`, `features`, `settings`, `host` (partial `MikeDownHost`, e.g. `uploadImage`, `openLink`), `handle` (read-only). Function-valued options are properties only.
- [x] Events: `change` (`detail: { value }`, debounced), `ready` (`detail: { handle }`). Bubbling, composed.
- [x] Initial value: `value` attribute, else the text of a child `<textarea>` or `<script type="text/markdown">` (progressive enhancement for server-rendered pages), which is then hidden.
- [x] Form-associated: `static formAssociated = true`, `setFormValue`, `required` → `valueMissing` validity, `formResetCallback` (back to the initial value), `formDisabledCallback`, `formStateRestoreCallback`. Works inside a plain `<form>` submit.
- [x] Lifecycle: create on `connectedCallback`, destroy on `disconnectedCallback`; moving the element in the DOM must not lose the value.
- [x] CDN bundle `dist/mikedown-editor.standalone.js`: core, peers and `styles.css` inlined, defines the element on load; mermaid/KaTeX handled per M0 (jsDelivr `+esm` rewrite or off). Gzipped size recorded and asserted against the M0 budget in the shape test. Document jsDelivr and unpkg URLs (pinned version, never `@latest`).
- [x] `THIRD_PARTY_NOTICES.md` generated for the standalone bundle (it redistributes TipTap, ProseMirror, CodeMirror, lowlight and friends; all MIT, but the notices must ship). Listed in `files`.
- [x] `packages/web-component/demo/index.html` (plain HTML, form submit, two elements).
- [x] Tests (vitest, jsdom): attribute/property sync, events, form value and reset, validity, child-textarea init, disconnect/reconnect.
- [x] README: install, npm usage, CDN usage, attribute/property/event table, styling, htmx and server-rendered examples. Commit.

**Also (M0):** apply the "What changes in this plan" lines for M6 in `wrappers-decisions.md`.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## M7 — `@mikedown/react`

**Recommended model:** Sonnet.

**Worker completion requirement:** complete ALL items below; note any you think should be dropped, but attempt them.

- [x] `<MikeDownEditor>` with `value` + `onChange` (controlled) or `defaultValue` (uncontrolled), `theme`, `readOnly`, `placeholder`, `features`, `settings`, `host`, `darkSelector`, `className`, `style`, `onReady(handle)`. `forwardRef` exposes `MikeDownEditorHandle`.
- [x] Built on `bindMikeDownValue`; created in `useEffect`, destroyed in cleanup; correct under React StrictMode double mount (mount, unmount, mount); `onChange`/`host` read through a ref so a new callback identity never recreates the editor; a parent re-render with the same `value` never resets the cursor.
- [x] SSR-safe: no DOM access at import or render; `'use client'` banner kept in the build (tsup `banner`). *(optional)* `lazy` prop loading core with dynamic `import()`; `next/dynamic` covers the same need, so cut it if time is short.
- [x] Peer `react`/`react-dom` `>=18`. tsup ESM + d.ts; `react`, `react-dom` and core external. Forward `id`, `aria-label`, `aria-labelledby`.
- [x] Tests (vitest + `@testing-library/react`, jsdom): controlled and uncontrolled, ref, StrictMode, readOnly/theme updates, unmount cleanup.
- [x] README with Vite and Next.js (app router) examples. Commit.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## M8 — `@mikedown/vue`

**Recommended model:** Sonnet.

**Worker completion requirement:** complete ALL items below; note any you think should be dropped, but attempt them.

- [x] `<MikeDownEditor v-model="md">` (`modelValue` / `update:modelValue`), props `theme`, `readOnly`, `placeholder`, `features`, `settings`, `host`, `darkSelector`; emits `ready`; `defineExpose({ handle })`. Also a plugin (`app.use(MikeDown)`) registering the component globally.
- [x] Built on `bindMikeDownValue`; created in `onMounted`, destroyed in `onBeforeUnmount`; prop watchers for theme/readOnly.
- [x] Peer `vue >=3.3` (explicit prop/emit, no `defineModel`, per M0). Vite library mode with `vue` and core external, `vue-tsc` d.ts. Forward `id`, `aria-label`, `aria-labelledby`.
- [x] Tests (vitest + `@vue/test-utils`, jsdom): v-model both directions, expose, prop updates, unmount.
- [x] README with Vite and Nuxt (`<ClientOnly>`) examples. Commit.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## M9 — `@mikedown/angular`

**Recommended model:** Opus. Version-range engineering plus folding the forks into one API.

**Worker completion requirement:** complete ALL items below; note any you think should be dropped, but attempt them.

- [x] `packages/angular/` as an ng-packagr library compiled with Angular 17 (the floor, partial Ivy), toolchain isolated as M0 decided. Source starts from the LymeStarter copy (`~/git/lymestarter/ng-app/src/app/lymestack-optional/mikedown/`), not the forks. The Angular 14 legacy fork is not a target.
- [x] Fold in the fork differences as generic inputs per M0 (the legacy fork's `preserveBrackets` stays supported): `preserveBrackets` (with the exported `unescapeBrackets`), `darkSelector`, `settings` (fonts and other defaults), existing `imageUpload`/`imageBaseUrl`/`imageSrcResolver`, `minHeight`, `placeholder`, `features`, `readOnly`, `theme`, output `ready`.
- [x] Selector `mikedown-editor` plus `lyme-markdown-editor` (permanent alias, decided). Standalone component; a `MikeDownModule` for NgModule apps on 17+ is optional (cut it if time is short).
- [x] Use only APIs available in the floor major (decorator `@Input`s; `inject()` in field initializers is fine). Router stays optional.
- [x] Peer range per M0; `rxjs` `^7.5`.
- [x] Port the existing spec to the runner M0 chose; cover CVA write/read, pristine writes, disabled, debounce, `preserveBrackets`, `darkSelector`.
- [x] README: install, standalone (and NgModule, if built) examples, reactive forms and `ngModel`, `angular.json` styles and dictionaries assets (from the core README), supported Angular versions. Commit.

**Also (M0):** apply the "What changes in this plan" lines for M9 in `wrappers-decisions.md`.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## M10 — `@mikedown/svelte` (deferred)

**Deferred (decided 2026-10-24):** out of this plan. The web component covers Svelte; revisit later. No work here and no tracker row beyond "Deferred".

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## T2 — Wrapper tests and consumer smoke

**Recommended model:** Sonnet. **Modes:** unit/integration (vitest + each framework's testing library, jsdom) and automated consumer builds. No hands-on here; T3 covers interaction on the demo pages.

**Worker completion requirement:** complete ALL items; report failures as gap-fills for the owning wrapper milestone rather than patching wrapper code here.

- [x] Root `test:wrappers` runs every wrapper's `test` script (`npm run test --workspaces --if-present`, excluding desktop's e2e); green.
- [x] `scripts/consumer-smoke.mjs`: packs core and the wrapper (`npm pack`), scaffolds a throwaway app in the scratchpad, installs the tarballs, builds. Targets:
  - [ ] `wc-vite` (vanilla Vite, `@mikedown/web-component/define`);
  - [ ] `wc-cdn` (static HTML loading the standalone bundle from the tarball; `jsdom` or `node --check` load);
  - [ ] `react-vite` (pinned to React 18) and `react-next` (React 19, Next.js app router, `next build` proves SSR safety);
  - [ ] `vue-vite`;
  - [ ] `angular-17`, `angular-19`, `angular-latest`.
- [x] Root script `test:consumers` (all targets, `--only` for one; cache the scaffolded apps in the scratchpad so re-runs skip `ng new`). Every target green; record build times and bundle sizes in the summary.
- [x] `test:packages` covers all new packages; MikeDown `test:unit`, `test:edge` still green.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## Phase 3 — Website and docs

## M11 — Site build and deploy path

**Recommended model:** Sonnet. Can start after M0.

**Worker completion requirement:** complete ALL items below; note any you think should be dropped, but attempt them.

- [x] `website/package.json` (private `@mikedown/site`), added to root `workspaces`. Vite multi-page config: base `/mikedown/`, dev port 5180, pages `vscode/index.html`, `developers/index.html`, `developers/{web-component,react,vue,angular}/index.html` (placeholder content; M12/M13 design them). Demos import the wrappers from the workspace. `website/mikedown-desktop/` stays outside the Vite build.
- [x] Angular demo: a minimal Angular app under `website/developers-angular/` built with `ng build --base-href /mikedown/developers/angular/` into the site output (Vite can't build Angular). Scaffold and wire the build only; M12 adds the editor once `@mikedown/angular` exists.
- [x] **Site-only publish path in the existing `mikedown-downloads` project** (decided: no second LymeDeploy project, no `website/deploy/`). Extend `packages/desktop/deploy/lymedeploy/deploy.yaml` and `pack-for-lymedeploy.sh` with a site mode that packs only site files (`vscode/`, `developers/`, demo assets, screenshots, and the re-rendered desktop `index.html`) into its own release version. Default scheme `<desktop-version>-site.N` (e.g. `0.3.0-site.1`); alternative `site-YYYYMMDD.N`. **Confirm LymeDeploy's version rules accept the scheme** and note that it must not outrank or replace the desktop release. It relies on `publish-files` being additive (never prunes), so desktop artifacts and manifests are untouched. Guards: the site package never includes `latest*.json` or any artifact (fail the pack if present), and `web.config` stays protected and unchanged. Dry-run by default; Mike runs the apply.
- [x] Confirm from the project's steps that `publish-files` never removes subfolders or existing files (so `/vscode/` and `/developers/` survive desktop releases and desktop files survive site releases); write the finding in the summary.
- [x] Desktop page re-render (folded into the site path): re-render `website/mikedown-desktop/index.html` with the currently published version (read from `https://www.iadev.net/mikedown/latest.json` and the last staged `packages/desktop/deploy/dist/<v>/upload/`) and include just that `index.html` in the site package. If that is not safe, say so and the links ride the next desktop release.
- [x] MIME check: `curl -sI` a `.woff2`, `.mjs`, `.svg` and `.webmanifest` already served by iadev-prod; list any type the new pages need that isn't served. Never add a `mimeMap` for a type already mapped machine-wide (duplicate entry 500s the folder, `latest.json` included).
- [x] Cloudflare purge list for every new page URL (apex and www), added to the `mikedown-downloads` yaml but disabled like the existing desktop entries.
- [x] Root scripts `dev:site`, `build:site`. Commit.

**Also (M0):** apply the "What changes in this plan" lines for M11 in `wrappers-decisions.md`.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## M12 — Developers hub and demo pages

**Recommended model:** Opus. Front-end design. **Needs:** M11, M13 (the shared site shell), Group C.

**Design bar:** this is a public developer page; it should feel hand-designed. Build on the shell M13 made from the desktop page's type and color system (Inter, its tokens) so every page reads as one product. Reference Stripe docs, Vercel and the TipTap site: generous spacing, clear hierarchy, a live editor as the hero, quiet code blocks, subtle transitions, real light and dark themes, phone-width layout with no horizontal scroll.

**Worker completion requirement:** complete ALL items below; note any you think should be dropped, but attempt them.

- [x] `/mikedown/developers/`: what MikeDown is in two sentences, a live editor, a package grid (name, one line, install command with copy button, npm link, demo link), a "which package?" guide (framework → package; anything else → web component or CDN), links to Desktop, VS Code and GitHub.
- [x] One page per wrapper (`web-component`, `react`, `vue`, `angular`): live editor using that wrapper, a live markdown value panel, theme and read-only toggles, the install command, a minimal copy-paste code sample (the same code that runs on the page), framework notes (Next/Nuxt/Angular standalone; Svelte via the web component), and a link to the package README.
- [x] Web component page also shows the CDN snippet and a plain `<form>` submit.
- [x] Use the shared shell from M13 (`website/shared/`); extend it only if a demo page needs something new, and apply the change to every page.
- [ ] *(optional)* "Open in StackBlitz" link per demo built from the page's own sample code.
- [x] Page titles, meta descriptions, Open Graph tags. Lighthouse accessibility pass (`npx lighthouse` CLI; contrast, labels, focus order) recorded in the summary.
- [x] `npm run build:site` green. Commit.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## M13 — VS Code page refresh and cross-links

**Recommended model:** Opus. Front-end design and copy. **Needs:** M11 only, so it runs while the wrappers build and hands M12 a finished shell.

**Worker completion requirement:** complete ALL items below; note any you think should be dropped, but attempt them.

- [x] Shared site shell in `website/shared/` (header nav Desktop · VS Code · Developers · GitHub, footer as on the desktop page, tokens and type lifted from `website/mikedown-desktop/index.html`, light and dark). The M12 design bar applies.
- [x] `git mv website/index.html website/vscode/index.html`; rebuild it on the shell.
- [x] Refresh the copy from the current `README.md` and `CHANGELOG.md` (drop "beta", add sidebar, slash commands, math, tags, zoom); fix the footer GitHub link to `mikejoseph23`; copy the screenshots it needs into the site (no `../assets/` paths).
- [x] Prominent Marketplace install button and "Open in VS Code" deep link (`vscode:extension/interapp.mikedown-editor`).
- [x] Desktop page (`website/mikedown-desktop/index.html`): add the shared nav and a visible "Also for VS Code" band below the screenshots (Marketplace button + link to `/mikedown/vscode/`), plus a "Build it into your app" link to `/mikedown/developers/`. Keep every `@@PLACEHOLDER@@` and the `data-dl` buttons intact; run `packages/desktop/deploy/render-page.js` against the 0.3.0 inputs and `check-upload.js` rules to prove the page still renders and passes.
- [x] Commit.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## M14 — READMEs

**Recommended model:** Sonnet.

**Worker completion requirement:** complete ALL items below; note any you think should be dropped, but attempt them.

- [x] Root `README.md` (Marketplace listing, absolute URLs only): extend the M3 "More MikeDown" block with the VS Code page, the Developers hub and each npm package; npm version badge for core; update "Repository layout" for the new packages and `website/`.
- [x] Each package README: consistent sections (install for npm/pnpm plus the explicit Yarn peer line, minimal example, API table, accessibility props, theming pointer to core, browser support, "no telemetry, no network calls except the ones you configure", links to the demo page, Developers hub and GitHub). Core README links every wrapper.
- [x] `CLAUDE.md`: architecture section lists the new packages, `website/` workspace, `test:wrappers` / `test:consumers` / `test:packages`, `dev:site` / `build:site`, and the site publish flow.
- [x] `BACKLOG.md`: provenance via GitHub Actions trusted publishing; Blazor wrapper; typedoc API reference; any M0 deferrals. Commit.

**Also (M0):** apply the "What changes in this plan" lines for M14 in `wrappers-decisions.md`.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## T3 — Website and docs verification

**Recommended model:** Sonnet. **Modes:** automated link and build checks, then one hands-on pass (Mike). No screenshots: the look is judged in the hands-on pass.

**Worker completion requirement:** complete ALL automated items, then hand Mike the hands-on list; fixes go back to M12/M13 as gap-fills.

**Automated**

- [x] `website/test/links.test.ts` over the built site: every internal link and asset resolves; every npm link names a package in this workspace; every Marketplace/GitHub link uses `interapp.mikedown-editor` / `mikejoseph23`.
- [x] Each demo page's bundle loads in jsdom without throwing and mounts one editor.
- [x] README link check: every absolute URL in root and package READMEs returns 200, except npm package URLs not yet published (listed in the summary).
- [x] `test:wrappers`, `test:packages` green.

**Hands-on (Mike, about 15 minutes).** Start: `cd ~/git/mikedown && npm run dev:site`. Pages:

- `http://localhost:5180/mikedown/developers/`
- `http://localhost:5180/mikedown/developers/web-component/`, `/react/`, `/vue/`, `/angular/`
- `http://localhost:5180/mikedown/vscode/`
- Desktop page: open the M13 render output path the worker reports.

On each demo page:

- [x] Typing updates the value panel within a moment; theme toggle flips editor and page; read-only blocks typing; copy buttons copy the install command and sample.
- [x] The web component page's form submit shows the markdown in the submitted data.
- [x] Nav works across all pages; at 400 px wide nothing scrolls sideways.
- [x] Judge the look: spacing, type, code blocks, dark mode, consistency with the desktop page. Orchestrator pauses for sign-off.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## Phase 4 — Ship the family

## M15 — Publish the 0.2.0 family and the site

**Recommended model:** Sonnet. **Needs:** T2, T3, G1.

**Worker completion requirement:** complete ALL items below; note any you think should be dropped, but attempt them.

- [x] `npm run version:npm -- 0.2.0`; per-package `CHANGELOG.md` entries; `test:packages`, `test:wrappers`, `test:consumers` green; `npm run release:npm` dry run lists every package. Commit `npm packages 0.2.0`.
- [ ] **Stop.** Hand Mike: `npm run release:npm -- --publish`. After he confirms, `npm view @mikedown/<name> version` for each; record versions in the Progress Log. Ask before tagging `npm-v0.2.0` and pushing.
- [x] Update the site's install commands if they pin versions; rebuild.
- [x] **Stop.** Hand Mike, in order: the M11 site-only pack (`pack-for-lymedeploy.sh` site mode) and `lymedeploy` apply of that site release for `mikedown-downloads`, dry-run first (it includes the re-rendered desktop page); the Cloudflare purge (or wait out the edge cache). Check the package holds no `latest*.json` or artifacts before he applies.
- [ ] After Mike confirms, `curl -s -o /dev/null -w "%{http_code}"` each production URL in T4 returns 200, and `https://www.iadev.net/mikedown/latest.json` is unchanged, as are the desktop artifacts.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## M16 — Downstream onto `@mikedown/angular`

**Recommended model:** Sonnet. **Needs:** M15.

**Worker completion requirement:** complete ALL items below; note any you think should be dropped, but attempt them.

- [ ] LymeStarter (`develop`): `lymestack-optional/mikedown/` keeps only LymeStack glue (theme SCSS token mapping, demo page, README) and imports the component from `@mikedown/angular` with `darkSelector="html[data-mode=dark]"` and Roboto settings. Check `lymetools adopt` and the scaffold strip still work (see its `CLAUDE.md`). `ng build`, `ng test --watch=false` green. Commit.
- [ ] Quantico Creek assistant app: replace `src/app/shared/mikedown/` with the package; `ng build` green. Commit.
- [ ] Quantico Creek legacy app (Angular 14): out of scope, stays vendored. Optionally add a comment there noting the package exists for Angular 17+. Commit if changed.
- [ ] Add `@mikedown/angular` to the LymeStarter docs that list optional components.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## T4 — Final verification

**Recommended model:** Sonnet. **Modes:** automated registry smoke, downstream builds, short production hands-on.

**Worker completion requirement:** complete ALL automated items; report failures, don't patch packages here.

- [ ] `npm run test:consumers -- --from-registry` (installs `@mikedown/*@0.2.0` from npm instead of tarballs): every target green.
- [ ] LymeStarter and the Quantico assistant app build and test green on the package (legacy app unchanged, still on its vendored copy).
- [ ] MikeDown full run: `test:unit`, `test:edge`, `test:integration`, `test:packages`, `test:wrappers`, `test:desktop`.
- [ ] **Hands-on (Mike, 5 minutes):** open `https://www.iadev.net/mikedown/`, `https://www.iadev.net/mikedown/vscode/`, `https://www.iadev.net/mikedown/developers/` and two demo pages; follow the nav between them; type in a demo editor; click a Marketplace and an npm link. Then `https://www.npmjs.com/package/@mikedown/react` shows its README. Orchestrator pauses for sign-off.
- [ ] Update `RESUME.md`; archive this plan's processed summaries.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## Decisions (2026-10-24)

1. **Angular floor 17.** No Angular 14 build; `@mikedown/angular` targets Angular 17+ (M0 confirms the floor is at least 17, default 17). Quantico Creek's legacy Angular 14 app keeps its vendored copy. LymeStarter and the Quantico assistant app (Angular 19) move to the package in M16.
2. **Selector.** `lyme-markdown-editor` stays a permanent alias beside `mikedown-editor`; no template migration.
3. **Svelte deferred.** Out of this plan (M10 marked Deferred); the web component covers Svelte. Revisit later.
4. **One LymeDeploy project.** Everything stays under `https://www.iadev.net/mikedown/`. No `mikedown-site` project: M11 adds a site-only publish path to `mikedown-downloads` (distinct site release version, additive `publish-files`, never `latest*.json` or artifacts, `web.config` untouched). M11 confirms LymeDeploy accepts the version scheme.
5. **CI required.** The lint-and-test `.github/workflows/ci.yml` is a required M1 item; no publish step.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## Parallel Development Recommendations

**Sequential blockers**

- M0 (approval) blocks everything except G1.
- G1 blocks M2 and M15. M1 blocks M2 and M3. M2 blocks M3, M4. M5 blocks M6–M9.
- T2 and T3 block M15; M15 blocks M16 and T4.

**Parallel groups**

| Group | Milestones | When |
|---|---|---|
| A | M1 first (short), then M5 and M11 in parallel | After M0 approval (G1 can run alongside any time). M1 and M11 both edit root `package.json`, so M1 lands before M11 starts |
| B | M2 → M3 and M4 | After G1 + M1 (M3 may precede M2 if G1 drags); runs alongside Group C |
| C | M6, M7, M8, M9 | After M5. M9 is the long pole (M10 Svelte deferred) |
| D | M13 | After M11; independent of the wrappers. Produces the shared shell M12 needs |
| E | M12, M14 | After Group C, M11 and M13 |

**Shared-file conflicts.** Every wrapper edits root `package.json` and `package-lock.json`. Parallel workers must not hand-resolve the lockfile: the orchestrator merges one worker at a time and re-runs `npm install` at the root after each merge, then `test:packages`. M11 owns `website/` scaffolding and the `workspaces` entry for it; M13 owns `website/shared/`, `website/vscode/` and `website/mikedown-desktop/`; M12 owns `website/developers*` and may extend `website/shared/` only after M13 has landed.

**Orchestrator context management.** If dispatching several workers fills the orchestrator context, prompt the user to run `/compact` while the workers run. The orchestrator watches its own context use and suggests compacting before it gets tight. After compacting, it resumes from `.orchestrator/state.json`.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## Gap-Filling Prompts

When a milestone comes back with items skipped or half done, the orchestrator writes a follow-up prompt that:

- Uses the same structure as the original (header labeled **"Worker Context: <Milestone> - Gap Fill"**, mission statement, reference to this plan and the milestone section).
- States what the first attempt finished, which files it changed, and what is left (from its worker summary).
- Lists the other active workers and the directories they own, to avoid conflicts.
- Ends with the standard completion steps: (1) commit code changes before writing the summary; (2) write `.orchestrator/worker-summary-<milestone-slug>-gap.md`; (3) prompt the user to close or clear the context.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)

---

## Progress Log / Notes

**2026-10-24 20:20** - M15: Mike published the 0.2.0 family (all five "published"; core live as `latest`, the four wrappers still 404 on the registry at 20:20, first publish of new names). Site deployed (Mike asked): `0.3.0-site.1` verify failed on one file, because Cloudflare email obfuscation rewrote `web-component@0.2.0` in the CDN snippet; fixed in `be3e303` (tag around the `@` in highlighted samples), `0.3.0-site.2` verified 195 files identical, `latest.json` still 0.3.0. All seven production pages 200.

**2026-10-24 20:05** - M15 prep done (`npm packages 0.2.0`, 6 min): all five packages at 0.2.0, wrapper peers `^0.2.0`, per-package CHANGELOGs (react's added to `files`), site already pins `@0.2.0`. Main tree: lint, `test:unit`, `test:edge`, `test:packages`, `test:wrappers` green; `test:consumers` green in the worktree except `angular-latest` (skipped, local Node 22.20 < 22.22.3); `release:npm` dry run lists all five at 0.2.0. Angular lockfile kept to the version bumps (the worker's regen dropped optional rollup entries). Site pack dry run: `0.3.0-site.1`, 195 files, no `latest*.json`, no Desktop artifacts. Waiting on Mike: `release:npm -- --publish`, then the site pack and apply.

**2026-10-24 19:45** - T3 hands-on: Mike signed off the developers hub, four demo pages and the VS Code page ("fucking awesome"). T3 complete; M15 unblocked.

**2026-10-24 19:20** - M12 core gap fill merged (`7a9135f`, `67e74dc`, `855a988`, `95e9bb3`, `8bbafc7`, 18 min): completed-task text 5.0:1+ in light and dark; task checkboxes named after their item with a 24 px target (still drawn at 14 px, through the node view); toolbar button names start with their visible text; table toolbar only while a focused cursor is in a table (and wraps on phones); toolbar buttons that don't fit move into a More (⋯) menu, not horizontal scroll (keeps the 2.15.0 tooltip fix). Lighthouse accessibility 100 on all five developer pages (was 88). Playwright sweep 320/400/1280 light/dark: no sideways scroll, no table toolbar on load. CHANGELOG `[Unreleased]` lists the fixes (they ship in the next extension release, not 2.15.0). Main tree: compile, lint (0 errors), `test:unit` (1577), `test:edge` (22), `test:packages` (72), `test:wrappers`, `test:site` (27), `test:integration` (47) green.

**2026-10-24 19:00** - T3 automated items done (`332263b`, 7 min): `test:site` builds the site and runs `website/test/` (27: every internal link, anchor and asset resolves, npm/Marketplace/GitHub links are correct, each demo bundle mounts exactly one editor in jsdom); `check:readme-links` (network) has 0 failures, with the four wrapper npm pages, the `@0.2.0` CDN URLs and six iadev.net site pages expected to 404 until M15. `test:wrappers`, `test:packages` green. `test:site` stays out of CI (full site build plus the Angular demo install). Hands-on waits for the core editor gap fill, then Mike.

**2026-10-24 18:50** - CI green for the first time (run `40135439913`, `f3e342f`): three editor-boot tests had timed out at 5 s on the 2-core runner; `vitest.config.ts` now uses 30 s test and hook timeouts when `CI` is set (local defaults unchanged). All steps pass: lint, `build:core`, `test:unit`, `test:edge`, `test:packages`, `test:wrappers`.

**2026-10-24 18:45** - M12 done (`bdefa6a`, `ceb0959`, 27 min): `/mikedown/developers/` hub (intro, live editor, package grid with copy buttons, "which package?" guide, Desktop/VS Code/GitHub links) and one demo page per wrapper (live editor through that wrapper, live markdown panel, theme and read-only toggles, install command, the running sample as code, framework notes; web component page adds the CDN snippet and a plain `<form>` submit). Titles, descriptions, Open Graph. Angular demo uses `file:` links to `packages/angular/dist` and `packages/core`, so `build:site` now builds every npm package first (+1 min) and a fresh checkout needs `npm ci --prefix website/developers-angular`. KaTeX CSS from jsDelivr to keep font files out; output types `.html .js .css .jpg .ico .txt .json`, site packer check accepts 195 files. StackBlitz (optional) cut: packages aren't on npm yet. Lighthouse accessibility 88 on all five pages; every remaining failure is inside core (completed-task text contrast 3.94:1, unlabeled small task checkboxes, toolbar button labels not matching text). Core findings: toolbar clipped below ~520 px; table toolbar shows on load when a document ends with a table. Checked at 1280/400 px light and dark. Main tree: `build:site`, `test:unit` (1568) green.

**2026-10-24 18:35** - CI fix (`6738d38`, 3 min): every CI run since M1 failed at `test:unit` (`standaloneHtml.test.ts` reads `packages/core/dist/styles.css`, which only `test:packages` built, later), so later steps never ran in CI. Added `npm run build:core` before `test:unit`. A fresh clone on Node 22 (macOS) passed every step in order; Karma's `ChromeHeadlessCI` already uses `--no-sandbox`.

**2026-10-24 18:25** - M14 gap fill (`34ed745`, 1 min): Angular README gains a `budgets` snippet (3.5 MB warning, 4 MB error against the 2.99 MB initial bundle), the `externalDependencies: ["mermaid"]` alternative (the placement T2's `angular-19-no-mermaid` target builds with) and the Angular 22 Node floor; React README's Next.js section says to install `mermaid`; core README notes Angular and Next need `mermaid`, Vite doesn't.

**2026-10-24 18:20** - T2 done (`5d0dfa9`, 11 min): `test:wrappers` (web component, React, Vue, Angular 25 specs) and CI switched from `test:angular` to `test:wrappers`; `scripts/consumer-smoke.mjs` / `test:consumers` (`--only`, scaffold cache in the scratchpad) builds `wc-vite`, `wc-cdn`, `react-vite` (React 18), `react-next` (React 19, `next build`), `vue-vite`, `angular-17`, `angular-19`, plus `angular-19-no-mermaid`; `angular-latest` (Angular 22.2.3) builds on Node 24.22.1 and is skipped on Node 22.20 (needs 22.22.3, 24.15 or 26). Not in CI (needs network and `ng new`). Findings, no wrapper bugs: without `mermaid` installed Angular and Next builds fail, Vite builds pass; Angular `externalDependencies: ["mermaid"]` works around it; Angular's default `initial` budget (1 MB error) rejects the editor (2.99 MB), so READMEs need a budget note (docs gap fill dispatched). Main tree: `test:wrappers` green, `test:consumers --only vue-vite` ok (876 kB gzip).

**2026-10-24 18:10** - T1 automated items done (8 min, no commits): `test:unit`, `test:edge`, `test:packages`, `test:integration` (47) and `test:desktop` (50 e2e) green; one unit test failed once and passed on three reruns (not identified, watch for flakiness). Registry smoke: `@mikedown/core` 0.1.0 installs its peers, the README example and a bare `styles.css` import build in a fresh Vite app, `import('@mikedown/core')` is SSR-safe. LymeStarter and both Quantico Creek apps build from the registry core (budget warnings only). Hands-on waits on Mike's Marketplace upload.

**2026-10-24 18:05** - Mike approved pushing and tagging. Tagged `core-v0.1.0` (`e7d4530`, core identical to the published tarball) and `v2.15.0` (`97a4929`), pushed with `main` (`4172f62..454ee8b`); LymeStarter `develop` (`779e906..f0be935`) and Quantico Creek `master` (`a310a42..59ed7d8`) pushed. Later merges in this plan get pushed as they land. Still with Mike: npm "disallow tokens" setting, Marketplace upload of `mikedown-editor-2.15.0.vsix`.

**2026-10-24 18:00** - M4 complete (gap fill 2 `553d4a6`, 5 min): `vite.config.ts#assertCorePin` accepts a pin that differs from the workspace core when exactly that version is installed under `packages/desktop/node_modules` (shared `checkInstalledCore` in `deploy/lib/release-lib.js`, unit tests), else throws with an `npm install` hint. A `RELEASE=1` Vite build bundled every `@mikedown/core` module from the registry 0.1.0 copy, none from the workspace. `build:desktop` (unsigned local bundle, nothing uploaded), Desktop unit (534), root `test:unit` (1568) green.

**2026-10-24 17:55** - M14 done (`e895307`, 3 min): root README (More MikeDown block with VS Code page, Developers hub and every npm package, core npm badge, Repository layout), five package READMEs made consistent (Yarn peer line from core's `package.json`, ARIA accessible-name order, Jest line, theming pointer, browser support, no-telemetry line, demo/hub/GitHub links), CLAUDE.md (packages, `website/`, `test:wrappers`/`test:consumers`/`test:packages`, `dev:site`/`build:site`, site publish flow), BACKLOG (typedoc and `styles-base.css` added; Blazor and trusted publishing already there), `wrappers-decisions.md` note recording the ARIA order (Mike kept the standard order). Demo URLs go live in M15. `test:packages` green.

**2026-10-24 17:45** - M6 done (`60b30e4` list markers, `65feeb5` theme fix, `d7fba47` package, 21 min): `@mikedown/web-component` 0.2.0-rc.0, light-DOM `<mikedown-editor>` over `bindMikeDownValue`, `/define` entry (only `sideEffects` entry), reflected attributes, properties, `change`/`ready` events, child `<textarea>`/`<script type="text/markdown">` init, form-associated (value, `required` validity, reset, disabled, state restore), CDN bundle 779 kB gzipped (budget 850 kB, asserted), `THIRD_PARTY_NOTICES.md`, demo with preflight fixture, `test:web-component` (48), README. Demo checked in Chrome (form submit, reset, disabled fieldset, label click, dark mode, KaTeX and Mermaid from jsDelivr). Core fix: a class-based `darkSelector` looped forever in a real browser (each theme apply woke the observer); the binding now re-applies only on change, with a test; M7 to M9 get it through core. Noted: `math` off is page-wide (added to the BACKLOG singleton line); label order is ARIA standard (`aria-labelledby` > `aria-label` > `<label>`), unlike the decisions doc, held for Mike; CI doesn't run the wrapper suites yet (T2). Main tree: compile, lint (0 errors), `test:unit` (1565), `test:edge` (22), `test:packages` (72), `test:web-component` (48), `test:react` (22), `test:vue` (11), `test:angular` (25), `release:npm` dry run green.

**2026-10-24 17:35** - M9 done (`32302c3`, `a342c8b`, 15 min): `@mikedown/angular` 0.2.0-rc.0, ng-packagr library compiled with Angular 17 (partial Ivy, own lockfile, outside the root workspaces, published from `dist/`), started from the LymeStarter copy and built on `bindMikeDownValue`; generic inputs incl. `preserveBrackets`/`unescapeBrackets`, `darkSelector`, `settings`, image inputs, `minHeight`; selectors `mikedown-editor` and `lyme-markdown-editor`. Specs ported to an Angular 19 Karma test app (`packages/angular/test-app/`, `test:angular` 25/25). Packed tarballs install and `ng build` in fresh Angular 17.3 and 19.2 apps. `version-npm.mjs` now leaves the `file:../core` dev link alone; CI gains two lines. Finding: Angular's esbuild fails with `Could not resolve "mermaid"` when mermaid isn't installed (core's lazy `import('mermaid')`, optional peer); the README tells Angular users to install it. Main tree: compile, lint (0 errors), `test:unit` (1564), `test:edge` (22), `test:packages` (51), `test:angular` (25), `test:react` (22), `test:vue` (11) green.

**2026-10-24 17:25** - M4 gap fill merged (`84314ef`, 4 min): `checkCorePin` accepts a published pin that differs from the workspace core (warns with both versions); an unpublished pin must still equal the workspace and needs `--allow-unpublished-core`. Header comment, deploy README Core pinning section and `release.sh`/`build-mac.sh` comments updated; tests cover all four cases. `check-core-pin.js` with no flag passes (`0.1.0 (published)`). Desktop unit (531), root `test:unit` (1564), `build:desktop` green. Still open: `packages/desktop/vite.config.ts#assertCorePin` has the old equal-version rule, so a `RELEASE=1` Desktop build would fail; the file belongs to the desktop-app session, held for Mike.

**2026-10-24 17:15** - M4 partial (6 min): LymeStarter `f0be935` on `develop` (`^0.1.0` from the registry, vendored tarball and doc mention removed; `ng build` green, `ng test` 558/558) and Quantico Creek `59ed7d8` on `master` (both apps; `ng build` green, `ng test` 148/148 and 45/45). Desktop docs drop `--allow-unpublished-core` (`f396810`), `build:desktop` green. Gap: `check-core-pin.js` fails because `checkCorePin` requires the pin to equal the workspace core version (`0.1.0` vs `0.2.0-rc.0`), which the decoupled family versioning breaks; gap fill dispatched to accept a published pin that differs from the workspace.

**2026-10-24 17:10** - M3 done (`97a4929` Release 2.15.0, 5 min): README "More MikeDown" block (Desktop and npm, absolute URLs), CHANGELOG `[2.15.0] - 2026-10-24` with two missing user-facing fixes added and the Internal note saying core is on npm; every claim on the VS Code page (zoom, narrow sidebar) is covered. `mikedown-editor-2.15.0.vsix` 4.60 MB vs 4.46 MB for 2.14.2 (+3.1%), copied to the repo root; core stays `0.2.0-rc.0`. No issue replies to draft (issues #1 to #10 all closed by 2026-10-20). In the worktree `test:integration` failed on IPC socket path length (`listen EINVAL`); in the main tree it passed (47). Main tree: compile, lint (0 errors), `test:unit` (1563), `test:edge` (22) green. Waiting on Mike: Marketplace upload, `v2.15.0` tag, push.

**2026-10-24 17:05** - M7 done (`5c4ef61`, lockfile `7965a25`, 4 min): `@mikedown/react` 0.2.0-rc.0, `<MikeDownEditor>` over `bindMikeDownValue` (controlled/uncontrolled, `forwardRef` handle proxy, latest-props ref so new `onChange`/`host` identities never recreate the editor, equal-value `setValue` skip keeps the caret, StrictMode safe), `'use client'` banner, peers `>=18`, `test:react` 22 tests (passed on React 19.3.1 and 18.3.1), `test/packages/react-shape.test.ts`, README with Vite and Next.js app router (`next/dynamic` in place of the optional `lazy` prop, cut). `placeholder`, `features`, `darkSelector`, `debounceMs` are mount-only (documented). Main tree: compile, lint (0 errors), `test:unit` (1563), `test:packages` (38), `test:react` (22), `test:vue` (11) green.

**2026-10-24 17:00** - M8 done (`8eae38a`, lockfile `97a13d6`, 3 min): `@mikedown/vue` 0.2.0-rc.0, render-function component over `bindMikeDownValue` (no SFC compile), explicit `modelValue`/`update:modelValue`, `ready`, exposed `handle`, `app.use(MikeDown)` plugin, watchers for theme/readOnly/disabled/settings (`placeholder`, `features`, `host` read at mount, documented), Vite lib build plus `vue-tsc` d.ts, `test:vue` (11, binding mocked), `test/packages/vue-shape.test.ts`, README with Vite and Nuxt `<ClientOnly>`. Not yet run in a real Vue app (T2 consumer smoke). Main tree: compile, lint (0 errors), `test:unit` (1563), `test:edge` (22), `test:packages` (26), `test:vue` (11) green.

**2026-10-24 16:55** - M5 merged (`f85a151`, `f0d3898`, cherry-picked onto `973a69b`, about 12 min plus a gap fill): `bindMikeDownValue` (debounce, blur flush, pristine and equal-value skips, pending-write cancel, `closest(darkSelector)` or `prefers-color-scheme` theme, `label[for]` lookup, `outputTransform`, `readOnly`/`disabled`, `onTouched`), core `placeholder`/`id`/`ariaLabel`/`ariaLabelledBy`/`landmark` options, root and `./binding` exports (alias of the root entry; a separate tsup entry needed splitting and broke the shape test), 24 binding tests, core README section. Gap fill compared against the LymeStarter Angular wrapper; zone, router, localStorage and upload concerns stay with M9. Family bumped to `0.2.0-rc.0` first (`973a69b`); Desktop's exact `0.1.0` pin now resolves from the registry. Main tree: compile, lint (0 errors), `test:unit` (1563), `test:edge` (22), `test:packages` (17) green.

**2026-10-24 16:45** - M2 published: Mike ran the publish at 16:42 (PUT 202, "being processed"); `npm view @mikedown/core` shows `0.1.0` on `latest` from 16:45, shasum `feecb779bd3811520dc7a5cb07743e6531c847d4`, 27 files, 843.1 kB, access public. npm normalized `repository.url` to `git+https://...`; fixed in source with the 0.2.0-rc.0 bump. Open: package 2FA setting "disallow tokens", `core-v0.1.0` tag and push (Mike).

**2026-10-24 17:10** - M13 done (`31b1a85`, `1596c78`, 14 min): shared shell in `website/shared/` (nav, footer, tokens from the desktop page, light/dark), VS Code page rebuilt with current features, Marketplace and `vscode:` deep-link buttons, desktop page gets the nav, an "Also for VS Code" band and a Developers link. Desktop page renders for 0.3.0 and passes `check-upload.js`; site pack dry run green (26 files, no MIME warnings). Checked at 1280/400 px light and dark. For M12: the desktop page carries an inline copy of the shell, so run `npm run sync:shell -w website` after any `website/shared/` edit (`build:site` fails on a stale copy); the Angular demo index needs the shell markers. VS Code page copy mentions the zoom control and narrow-sidebar fix, which ship in 2.15.0 (M3). Main tree: `build:site`, `test:unit` (1539) green.

**2026-10-24 16:50** - M11 done (`4f0f971`, `cf86f41`, lockfile `23c945c`, 11 min): `website/` workspace (`@mikedown/site`, Vite MPA, base `/mikedown/`, port 5180), `website/index.html` moved to `website/vscode/`, placeholder developer pages, Angular 21 demo scaffold (own lockfile; newest CLI refuses Node 22.20), `pack-for-lymedeploy.sh --site` with guards (no `latest*.json`, artifacts, `web.config`), `verify-site.js`, disabled Cloudflare purge step. LymeDeploy checks: `0.3.0-site.N` accepted (versions are free strings, never compared); `retain: 3` only prunes agent work folders, left as is; `publishLast` tolerates missing files (`index.html` added). `publish-files` has no delete path. Desktop re-render is byte-identical to live. MIME check partial: no `.woff2/.mjs/.svg/.webmanifest` found on iadev.net to probe; the packer warns on any extension beyond `.html .js .css .jpg .png .ico .txt .json`. Main tree: `build:site`, compile, `test:unit` (1529), `test:packages` green. M13 dispatched (Opus).

**2026-10-24 16:35** - M2 prep done (`e7d4530`, 2 min): core 0.1.0, `packages/core/CHANGELOG.md` (shipped via `files`), Desktop pin `0.1.0`, lockfile refreshed. Main tree: `test:packages` 17 passed; dry run 27 files, 823 KB packed / 2.87 MB unpacked; tarball installs and builds in a throwaway Vite app with no extra peers. Waiting on Mike's `release:npm -- --only core --publish`.

**2026-10-24 16:20** - M1 done (`a66b865`, `7d4b4ab`, 20 min): `version-npm.mjs`, `release-npm.mjs` (dry run default, `--pack` for tarballs), shared `scripts/lib/npm-packages.mjs`, `test/packages/package-shape.test.ts`, `vsix:minor`, CI workflow (YAML-validated only, no actionlint), katex required peer, `default` export conditions; `release-core.sh` and `sync-core-version.js` removed. Re-verified in the main tree: compile, `test:packages` (17) and the `release:npm` dry run green. Note for M2: Desktop pins core `0.1.0-rc.1` exactly and `version:npm` doesn't touch it, so M2 bumps that pin in the same commit. The worktree was again created off a stale commit (`0103b15`) and reset to base.

**2026-10-24 16:05** - Mike approved `wrappers-decisions.md` (all seven departures). M0 items for M1 added to its checklist; M5, M6, M9, M11, M14 and T1 point at their "What changes" lines. M1 dispatched (Sonnet, worktree).

**2026-10-24 15:44** - M0 done (commit `729b955`, 13 min): `wrappers-decisions.md` and BACKLOG follow-ups. Departures from defaults awaiting Mike: `katex` becomes a required core peer before 0.1.0 (optional peer + CSS `@import` breaks a plain install); every `exports` gets a `default` condition (Jest); `packages/angular` stays out of root workspaces with its own lockfile; family goes to `0.2.0-rc.0` at M5; dictionary URL is the `dist/dictionaries` base; M5 adds placeholder/id/aria/landmark/outputTransform core options; core list CSS sets `list-style-type` (Tailwind). Standalone bundle ~780 kB gz, budget 850 kB. Cloudflare doesn't cache `/mikedown/`, so purge steps can be skipped.

**2026-10-24 15:01** - Open questions answered by Mike: (1) Angular floor 17, no Angular 14 build, Quantico Creek legacy stays vendored, M16 limited to LymeStarter and the Quantico assistant app; (2) `lyme-markdown-editor` kept as a permanent alias; (3) Svelte (M10) deferred; (4) one LymeDeploy project, so M11 extends `mikedown-downloads` with a site-only publish path (no `mikedown-site`, no `website/deploy/`); (5) CI workflow required in M1.

**2026-10-24 14:45** - Plan created. Research findings that shaped it: `npm run vsix` would overwrite core's version with the extension's (fixed in M1 before the 2.15.0 release); `website/index.html` has never been hosted, so the VS Code page moves under `iadev.net/mikedown/vscode/`; the Angular wrapper exists as three diverging vendored copies (LymeStarter, Quantico Creek legacy with `preserveBrackets`, Quantico Creek assistant), which M9 folds into one package; `check-upload.js` requires the desktop upload to be flat, so new pages get their own LymeDeploy project. No npm scope or packages exist yet (all `@mikedown/*` names return 404).

**2026-10-24 14:48** - Plan reviewed; changes: standalone CDN bundle gap recorded (core's bare `import('mermaid'|'katex')` and the KaTeX `@import` fail in a no-build page; M0 decides jsDelivr rewrite vs off) plus a size budget and `THIRD_PARTY_NOTICES.md`; peer strategy spelled out (wrappers peer on core only; Yarn needs an explicit peer line; `sideEffects` only on the web component's `define` entry); 0.x semver, ESM-only, browser-support and telemetry-free statements added to defaults and READMEs; accessibility contract (aria/id forwarding, labelable element) added to M0 and every wrapper; npm 2FA wording updated to the 2025 policy, `.npmrc` ignored, post-publish "disallow tokens" setting; partial-Ivy direction, Node 18 for Angular 14 and standalone-in-14 caveat clarified; Vue floor keeps explicit prop/emit (no `defineModel`); React `onChange` through a ref, React 18 and 19 both smoked; M3 no longer hard-blocked on the npm publish; M13 now owns the shared site shell so M12 depends on it (Group E) and the M12/M13 circular reference is gone; M1 serialized before M11 (shared root `package.json`); M11 Angular demo scaffold only until M9 ships; `lazy` prop, `use:mikedown`, `--page-only` and StackBlitz links marked optional; T1–T4 given completion notes; optional CI workflow added as open question 5.

[Return to Top](#mikedown-npm-packages-framework-wrappers-and-website--planning-document)
