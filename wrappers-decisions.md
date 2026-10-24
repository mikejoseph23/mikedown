# Wrappers and npm Decisions (M0)

Output of M0 in `wrappers-npm-plan.md`. Checked against the repo, the npm registry, jsDelivr and MDN compat data on 2026-10-24, with spikes in the scratchpad. Each section: **Decision**, **Why**, **Verified**, **What changes in this plan**.

**Gate:** M1 and M5 do not start until Mike approves this file.

**Departures from the plan's defaults (read these first):**

1. **`katex` becomes a required peer of core, before the 0.1.0 publish.** `styles.css` starts with `@import 'katex/dist/katex.min.css'`, npm never installs optional peers, and a Vite build of that import with no `katex` installed fails. So today `npm install @mikedown/core` plus `import '@mikedown/core/styles.css'` breaks. `mermaid` stays optional.
2. **Every package's `exports` gets a `default` condition** next to `import`. Core has only `types` and `import`, so Jest (which resolves with `require`/`default`) cannot find it at all, and `transformIgnorePatterns` alone does not help.
3. **`packages/angular` stays out of the root workspaces**, with its own lockfile. Nested `node_modules` works for TypeScript, but `@angular/core` 17 hoists to the root, where it would clash with the Angular 19 test app and the site's Angular demo.
4. **The family goes to `0.2.0-rc.0` at M5**, not straight to 0.2.0, so no wrapper exists at a final, publishable version before M15.
5. **The spell-check URL is the folder base** (`.../dist/dictionaries`). Core adds `/en/` or `/en-GB/` itself, so the plan's `dist/dictionaries/en` is wrong.
6. **Core gets `placeholder`, `ariaLabel`, `ariaLabelledBy` and `id` options in M5.** Today the Angular wrapper sets the placeholder with a CSS hack, and the editable surface's name is hard-coded to "Document text".
7. **Core's list CSS must survive Tailwind preflight.** Core never sets `list-style-type`, so preflight's `ul, ol { list-style: none }` removes bullets inside the editor. Overriding tokens can't fix that; M6 fixes it in core CSS.

## Versioning

**Decision:** all `@mikedown/*` npm packages share one version (lockstep), independent of the extension (2.x) and Desktop (0.3.x). Wrappers peer on `"@mikedown/core": "^<family>"`; the workspace devDependency uses the same range. On 0.x, caret ranges pin the minor (`^0.2.0` is `>=0.2.0 <0.3.0`), so every family bump republishes every package, changed or not.

**0.x semver policy:** a minor (0.2 → 0.3) may break; a patch (0.2.0 → 0.2.1) never does, in any package. Every release bumps the whole family. One `CHANGELOG.md` per package; a package with no changes gets a one-line "Version bump to match the family" entry. 1.0.0 comes once the wrapper APIs have been stable for one minor release.

**Alternative that lost:** independent versions with Changesets. Each wrapper would carry its own version and a core range, which is more correct on paper. But it adds a tool and a PR ritual, and on 0.x every core minor still forces every wrapper's range to move. That's the same republish lockstep gives, plus a version matrix to explain. With one maintainer and five packages, lockstep is simpler and users only need to know one number.

**Why:** one number to install and document; the "which wrapper version works with which core" question goes away.

**Verified:** semver caret on 0.x (`^0.2.0` → `<0.3.0`); prerelease peers (`^0.2.0-rc.0` also accepts the final `0.2.0`). Not verified: nothing.

**What changes in this plan:** M5 runs `npm run version:npm -- 0.2.0-rc.0` (departure 4), so wrappers are born at `0.2.0-rc.0` with peer `^0.2.0-rc.0`. A premature publish then lands on `rc`, never `latest`. M15 runs `version:npm -- 0.2.0` as planned.

## Peer strategy and install story

**Decision:** confirmed with two corrections.

- Core keeps TipTap, CodeMirror and lowlight as peers (one ProseMirror and one `@codemirror/state` per app; see `core-extraction-decisions.md` §4).
- Wrappers peer on `@mikedown/core` and their framework only. They never re-list the TipTap/CodeMirror peers.
- `katex` becomes a **required** peer (departure 1). `mermaid` stays an optional peer: it is only reached through a dynamic `import()` and ships no CSS.
- npm 7+ installs peers transitively, and pnpm 8+ does too (`auto-install-peers` defaults to true). Yarn (1 and Berry) does not, so every README carries an explicit `yarn add` line with core's full peer list. M14 generates it from `packages/core/package.json` so it never drifts.
- `sideEffects: false` on every wrapper except the web component, which lists `["./dist/define.js", "./dist/mikedown-editor.standalone.js"]`. Core keeps `["*.css"]`.
- Every `exports` entry gets `"default"` after `"import"` (departure 2).

**Why:** required peers are the only kind npm installs, and a stylesheet `@import` is a hard dependency. `katex` is about 4 MB unpacked, and all three downstream apps already install it.

**Verified:**

- Packed a scratch library with `lowlight` as a peer and `katex` as an optional peer, then installed it with npm 11.6.1: `lowlight` was installed, `katex` was not.
- A second library peered on `@tiptap/extension-link`; npm also installed that package's own peers (`@tiptap/core`, `@tiptap/pm`), so peers install transitively.
- `vite build` of a stylesheet containing `@import 'katex/dist/katex.min.css'`, with no `katex` installed, failed in `postcss-import`.

Assumed from their docs: pnpm and Yarn behavior.

**What changes in this plan:** M1 adds two items: drop `katex` from `peerDependenciesMeta`, and add `default` conditions. The shape test checks both. T1's registry smoke imports `@mikedown/core/styles.css` with nothing but `npm install @mikedown/core`.

## rc vs final

**Decision:** confirmed. Core publishes as `0.1.0` on `latest`. The wrappers debut together as `0.2.0` (core bumps too, for the M5 binding export), with `0.2.0-rc.N` in between on the `rc` tag if anything is published early.

**Why:** three apps already run it; 0.x already says pre-1.0; an rc-only package forces `@rc` on every install line.

**Verified:** `npm view @mikedown/core` is still 404 (nothing to supersede); core is `0.1.0-rc.1` in `packages/core/package.json`.

**What changes in this plan:** nothing beyond the `0.2.0-rc.0` step in Versioning.

## Wrap core or the web component, per wrapper

**Decision:** confirmed. React, Vue and Angular wrap core directly through `bindMikeDownValue` (M5). The web component is the route for plain HTML, CDN/no-build, htmx, Lit, Solid, Preact, Svelte, Blazor and server-rendered templates (Rails, Django, Razor).

**Why:**

- **Value binding:** each framework gets its own idiomatic binding (`value`/`onChange`, `v-model`, a ControlValueAccessor) instead of bridging DOM events.
- **No global registry:** nothing goes into the custom-element registry, so two versions can't collide on `customElements.define`.
- **SSR:** the frameworks' own SSR paths stay simple.
- **No double debounce:** the binding debounces once, rather than once in the element and again in the wrapper.

**Verified:** the Angular wrapper already wraps core directly and its logic (pristine writes, debounce, flush on blur, theme follow) is what M5 lifts.

**What changes in this plan:** nothing.

## Other easy wins

| Candidate | Call | Note |
|---|---|---|
| Self-contained CDN bundle of the web component | **Keep** (M6) | See the standalone bundle section |
| `default` export condition on every package | **Keep** (M1) | Departure 2 |
| Core `placeholder` / a11y options instead of wrapper CSS hacks | **Keep** (M5) | Departure 6 |
| Tailwind-preflight fixture on the web component demo | **Keep** (M6) | Catches reset leakage (departure 7) |
| Solid and Preact wrappers | **Defer** | Web component covers Solid; `preact/compat` runs the React wrapper |
| Blazor wrapper | **Defer** to `BACKLOG.md` | Web component works in Razor today |
| Svelte wrapper | **Defer** (M10) | Web component covers it |
| Trim the CDN bundle to lowlight's `common` languages | **Defer** to `BACKLOG.md` | Saves about 245 kB gzipped (757 → 511 kB JS). Needs a core `codeLanguages` option so the language picker matches; not a 0.2.0 change |
| `@mikedown/core/styles-base.css` (no KaTeX `@import`) | **Defer** | Only needed if katex ever goes back to optional |
| `@mikedown/dictionaries` package | **Defer** (already in `BACKLOG.md`) | jsDelivr serves core's `dist/dictionaries` fine |
| Typedoc API reference | **Defer** (M14 adds it to `BACKLOG.md`) | |

**What changes in this plan:** M1, M5 and M6 each gain one item (listed in their sections here); BACKLOG gets Blazor, Solid/Preact and the language trim now.

## Web component shape

**Decision:** light DOM, confirmed.

- **Styles:** npm users import `@mikedown/core/styles.css` themselves. The CDN bundle injects one `<style id="mikedown-styles">` once per document (guarded) and adds one `<link>` to the jsDelivr KaTeX CSS.
- **Attributes (reflected):** `value`, `theme` (`light|dark|auto`), `readonly`, `disabled`, `placeholder`, `name`, `required`, `min-height`, `dark-selector`, `spellcheck-dictionary-url`, `features` (JSON). `aria-label` and `aria-labelledby` are read from the element and forwarded (Accessibility contract).
- **Properties:** `value`, `features`, `settings`, `host` (partial `MikeDownHost`), `handle` (read-only), `form`, `validity`, `validationMessage`, `willValidate`, `checkValidity()`, `reportValidity()`, `focus()`. Function-valued options are properties only.
- **Events:** `change` (`detail: { value }`, debounced, and at once on blur), `ready` (`detail: { handle }`). Both bubble and are composed.
- **Form association:** `static formAssociated = true` with `attachInternals()`, `setFormValue`, `setValidity({ valueMissing })` for `required`, `formResetCallback`, `formDisabledCallback`, `formStateRestoreCallback`. A disabled element is left out of form submission by the browser.
- **`dark-selector` semantics** (shared with React, Vue and Angular through M5): dark when `element.closest(selector)` matches, else light. Without one, `auto` follows `prefers-color-scheme`. `closest()` covers both forks: `html[data-mode=dark]` (LymeStarter) and a `.dark-theme` ancestor (Quantico legacy).
- **Reset leakage:** a consumer reset can still leak into the editor. Token overrides (`--mikedown-font-family`, `--mikedown-surface`, `--mikedown-text`) fix colors and type. Lists need the core CSS fix (departure 7). The README documents both.

**Why:**

- **Portal:** core's overlays mount in `.mikedown-portal` on `<body>`, outside any shadow root, so shadow-scoped CSS would not reach them.
- **Scoped CSS:** every core rule is scoped as `:is(.mikedown-root, .mikedown-portal) ...`, which a shadow root would cut off from the document stylesheet.
- **Selection:** ProseMirror's selection inside a shadow root is unreliable (Firefox and Safari have no `ShadowRoot.getSelection`).
- **Labels:** in light DOM, `aria-labelledby` can point at ids in the page; across a shadow boundary it can't.

**Verified:**

- `portal.ts` mounts `.mikedown-portal` on `<body>`; every stylesheet is scoped that way; there is no `attachShadow` or `getRootNode` anywhere in core.
- MDN compat data 8.1.7:

  | Feature | Chrome | Firefox | Safari |
  |---|---|---|---|
  | `ShadowRoot.getSelection` | 53 | no | no |
  | `Selection.getComposedRanges` (newer replacement) | 137 | 142 | 17 |
  | `ElementInternals`, `attachInternals` | 77 | 93 | 16.4 |
  | `setFormValue`, `setValidity`, `labels` | 77 | 98 | 16.4 |

  So the plan's floor (Chrome 77+, Firefox 98+, Safari 16.4+) is right.
- Tailwind preflight list leakage: confirmed by reading `editor.css`, which sets no `list-style-type` on `.ProseMirror ul/ol`; not run in a browser.

Assumed: preflight's exact rules (from Tailwind's published preflight).

**What changes in this plan:** M6 adds `form`/validity members, the guarded style injection, a preflight fixture section on `demo/index.html`, and the core list-style fix. Its demo with two elements will show the known shared-portal singleton (already in `BACKLOG.md`), so M6 notes it in the README.

## Standalone (CDN) bundle contents

**Decision:**

- `dist/mikedown-editor.standalone.js` inlines core, every required peer and core's CSS (minus the KaTeX `@import`), and defines `<mikedown-editor>` on load.
- An esbuild plugin rewrites the two bare dynamic imports to pinned jsDelivr URLs:
  - `import('katex')` → `https://cdn.jsdelivr.net/npm/katex@<pinned>/+esm`
  - `import('mermaid')` → `https://cdn.jsdelivr.net/npm/mermaid@<pinned>/dist/mermaid.esm.min.mjs` (mermaid's own documented CDN entry; it lazy-loads diagram chunks)
- The pins come from core's installed versions at build time.
- KaTeX CSS loads as a `<link>` to `https://cdn.jsdelivr.net/npm/katex@<pinned>/dist/katex.min.css`, added once and only when math is enabled. Its fonts resolve relative to jsDelivr.
- Math and mermaid stay **on** by default, as in npm builds. Each `features` flag still turns them off, and then nothing is fetched.
- Dictionaries stay out of the bundle. The README documents `spellcheck-dictionary-url="https://cdn.jsdelivr.net/npm/@mikedown/core@<version>/dist/dictionaries"` (the folder base; core appends `/en` or `/en-GB`, departure 5).
- The README documents jsDelivr and unpkg URLs with a pinned version, never `@latest`.
- **Size budget: 850 kB gzipped** for the standalone JS (CSS included). The shape test fails above it.

**Why:** a no-build page has no resolver for bare specifiers. Rewriting keeps parity with npm builds, while defaulting math and mermaid off would surprise users. The 850 kB budget is the measured 780 kB plus about 9% headroom.

**Verified:**

- `src/math.ts:44` `import('katex')` and `src/mermaid.ts:45` `import('mermaid')`; `scripts/build-css.mjs` prepends the KaTeX `@import`; `spellcheck.ts` builds `${base}/${en|en-GB}/index.aff`.
- jsDelivr returns 200 with a `default` export for `katex@0.16.47/+esm`, `mermaid@11.15.0/+esm` and `mermaid@11.15.0/dist/mermaid.esm.min.mjs`. `katex.min.css`, its `fonts/*.woff2` and unpkg's `katex.min.css` return 200. jsDelivr sends `access-control-allow-origin: *` on package files, which the dictionary fetch needs.
- esbuild spike (core `src/index.ts` with peers inlined, mermaid and katex external, minified, ES2020):

  | Build | Raw | Gzip | Brotli |
  |---|---|---|---|
  | JS | 2,436 kB | 757 kB | 613 kB |
  | CSS | 147 kB | 23 kB | |
  | JS + CSS | | about 780 kB | |

  `highlight.js` (all languages, from `createLowlight(all)`) is 1,042 kB of the raw JS. With lowlight's `common` set the JS is 511 kB gzipped (deferred, see Other easy wins).

**What changes in this plan:** M6's CDN item uses the URLs and the 850 kB budget above; M6's README uses the corrected dictionary URL.

## Framework ranges

**Decision:**

| Package | Peer range | Build tool | Test |
|---|---|---|---|
| `@mikedown/web-component` | none | tsup (ESM + d.ts), plus esbuild for the standalone bundle | vitest, jsdom |
| `@mikedown/react` | `react`, `react-dom` `>=18` | tsup with a `'use client'` banner | vitest + Testing Library, smoked on React 18 and 19 |
| `@mikedown/vue` | `vue` `>=3.3` | Vite library mode + `vue-tsc` | vitest + `@vue/test-utils` |
| `@mikedown/angular` | see Angular floor | ng-packagr 17 | Angular test runner section |

- **React:** `forwardRef` is still supported on 19.
- **Vue:** uses explicit `modelValue` / `update:modelValue`, not `defineModel` (which needs 3.4).
- **Module format:** every package is ESM only.
- **Jest:** consumers need, in addition to the `default` condition from departure 2: `transformIgnorePatterns: ['/node_modules/(?!(@mikedown|lowlight|devlop)/)']`. Those are the ESM-only packages in core's import graph; TipTap, CodeMirror and `tiptap-markdown` ship `require` builds. The READMEs recommend vitest.

**Why:** these are the oldest versions with the APIs each wrapper uses.

**Verified:** registry latest versions (React 19.3.1, Vue 3.5.44, Angular 22.2.3, Vue 3.3.13 exists); ESM/CJS shape of each core peer from its `package.json` (`lowlight` 3.3.0 and `devlop` are `type: module` with no `require` condition; `@tiptap/*`, `@codemirror/state`, `tiptap-markdown` have one; `mermaid` is ESM-only but only reached by dynamic import).

Assumed: Jest's resolver conditions (from its docs); not run in Jest.

**What changes in this plan:** M14's READMEs carry the Jest line.

## Angular floor

**Decision:** floor **17**, peer `"@angular/core": ">=17.0.0 <23.0.0"`. The same range applies to `@angular/common` and `@angular/forms`, plus `@angular/router`, which is a required peer because the component imports `Router` statically (injection stays `{ optional: true }`). Also `rxjs ^7.5`. The range widens one major at a time after a T2 smoke build.

The library compiles with ng-packagr 17.3 and TypeScript ~5.4 in partial-Ivy mode.

**Toolchain layout:** `packages/angular` is **excluded from the root workspaces** (`"workspaces": ["packages/*", "!packages/angular", "website"]`) and has its own `package-lock.json`.

- `@mikedown/core` comes in as a `"file:../core"` devDependency.
- CI and the release script run `npm ci --prefix packages/angular`.
- ng-packagr writes `dist/package.json`, so **`@mikedown/angular` is published from `packages/angular/dist`**. README and LICENSE are copied in through `ng-package.json` `assets`.
- `release-npm.mjs` and `version-npm.mjs` find packages by globbing `packages/*/package.json`, not by `npm query .workspace`.

Quantico Creek's legacy Angular 14 app keeps its vendored copy (`quantico-creek-angular-app/src/app/shared/mikedown/`); M16 only adds a comment.

**Why:**

- **Compiler direction:** partial-Ivy output links forward only, so the oldest supported major compiles it.
- **Downstream:** both apps that move to the package are on 19.
- **Support status:** Angular 17, 18 and 19 are all past Angular's LTS window now, but 17 costs nothing extra and widens reach.
- **Why not nest it in the workspace:** nested `node_modules` works for TypeScript but leaks Angular 17 to the root (departure 3).

**Verified:** scratchpad workspace with root `typescript ^5.9.3` (as in the repo) and `packages/angular` on ng-packagr 17.3, `@angular/*` 17.3 and TypeScript ~5.4.5:

- npm nested `typescript` 5.4.5, `ng-packagr` and `@angular/compiler-cli` under `packages/angular/node_modules`, but hoisted `@angular/core`, `common`, `forms`, `platform-browser` and `compiler` 17 to the root.
- ng-packagr 17.3 builds a standalone CVA component on **Node 22.20** (engines `^18.13.0 || >=20.9.0`) in 0.7 s.
- The output selector is `"mikedown-editor, lyme-markdown-editor"`; partial declarations carry `minVersion` 12/14, `version` 17.3.12.
- The generated `dist/package.json` has `sideEffects: false` and no scripts or devDependencies.
- `ng-packagr@17` accepts TypeScript `>=5.2 <5.5`; the repo root has TypeScript 5.9.3.
- `"!packages/b"` negation in `workspaces` excluded that folder on npm 11.6.1.

**What changes in this plan:** M1's release and version scripts and the shape test handle `packages/angular` as a non-workspace package published from `dist/`; CI adds `npm ci --prefix packages/angular`; M9 peer list adds `@angular/common` and `@angular/router`; M11 writes the `workspaces` array with the negation.

## Angular test runner

**Decision:** the ported spec runs as TestBed specs in a small Angular 19 app at `packages/angular/test-app/` (own lockfile), with Karma, Jasmine and ChromeHeadless. It compiles the library **source** through a tsconfig path, while T2's `angular-17`, `angular-19` and `angular-latest` smokes cover the built partial output. Root script `test:angular` runs it; CI includes it (ubuntu runners ship Chrome).

**Why:**

- **Port cost:** the existing 237-line spec is Jasmine (`spyOn(...).and.callFake`) with `fakeAsync`/`tick`, so it ports nearly verbatim.
- **Version match:** 19 matches both consumers.
- **Why not in the library:** its own toolchain is pinned to 17.
- **Alternative that lost:** Angular 21's Vitest runner (no browser), which means rewriting the spies.

**Verified:** the spec's imports and helpers (`fakeAsync`, `flushMicrotasks`, `tick`, `spyOn`); the LymeStarter and assistant specs are identical apart from a header comment; the legacy spec is 287 lines (the extra 50 are `preserveBrackets`).

**What changes in this plan:** M9's spec item names `packages/angular/test-app/` and `test:angular`; it also ports the legacy fork's `preserveBrackets` tests.

## Angular generic inputs

**Decision:** one component, standalone, selector `mikedown-editor, lyme-markdown-editor` (permanent alias). Fork differences become inputs:

| Fork difference | Generic input |
|---|---|
| Quantico legacy `preserveBrackets` + exported `unescapeBrackets` | `@Input() preserveBrackets = false`; `unescapeBrackets` exported from the package (moves to core's binding as an `outputTransform` option so React and Vue get it too) |
| LymeStarter dark source `html[data-mode]` | `darkSelector="html[data-mode=dark]"` |
| Quantico legacy `.dark-theme` ancestor (with route-animation late attach) | `darkSelector=".dark-theme"`; the M5 observer watches `documentElement` subtree attribute changes, with `attributeFilter` derived from the selector (`class` for `.x`, each `[attr]` name) and re-resolves on change, as the legacy fork does |
| Assistant app: no shell mode, follows the OS | no `darkSelector`: `auto` follows `prefers-color-scheme` |
| Fonts: Roboto (LymeStarter) vs Open Sans (Quantico) | `@Input() settings: Partial<MikeDownSettings>`, merged as package form defaults (`contentWidth: '100%'`, `fontSize: 15`, no font) < `settings` input < the user's saved Settings-modal choices (localStorage) |
| Theme SCSS token mapping (three different files) | Stays in each app (glue, not package). The package ships the frame SCSS as component styles reading `--mikedown-field-*` variables with fallbacks, not `--ls-*` |
| `standalone: true` vs NgModule (legacy 14) | Standalone only; optional `MikeDownModule` for NgModule apps on 17+ |
| Constructor injection (legacy 14) vs `inject()` | `inject()` (fine on 17) |

These stay as today: `imageUpload`, `imageBaseUrl`, `imageSrcResolver`, `minHeight`, `placeholder` (now passed to core, departure 6), `features`, `readOnly`, `theme`, output `ready`.

**Why:** the assistant app is byte-identical to LymeStarter except `_mikedown-theme.scss` and header comments, so one package plus app-side SCSS serves both. Mapping `--ls-*` in the package would tie it to LymeStack.

**Verified:** diffed the three copies (read-only copies in the scratchpad):

- **LymeStarter vs assistant:** only the theme SCSS, README and comments differ.
- **LymeStarter vs Quantico legacy:**
  - code: fonts, `DARK_SHELL_CLASS` and the subtree class observer, `preserveBrackets` with `unescapeBrackets` (applied to `queueChange` and to the equality check in `writeValue`), constructor injection, `MikeDownModule`;
  - styles: the frame SCSS reads `--lyme-md-*` instead of `--ls-*`.

**What changes in this plan:** M9's input list adds `settings` merge order and the frame variables; M5's binding takes an optional `outputTransform` (for `preserveBrackets`) and the `closest()` dark-selector rule.

## Website layout and hosting

**Decision:** confirmed.

- **URLs:** `https://www.iadev.net/mikedown/` stays the desktop page; new `/mikedown/vscode/` (refreshed `website/index.html`) and `/mikedown/developers/` plus `/mikedown/developers/<framework>/`.
- **Workspace:** `website/` becomes the private workspace `@mikedown/site` (`"workspaces": ["packages/*", "!packages/angular", "website"]`), Vite multi-page, dev port 5180, base `/mikedown/`.
- **Desktop page:** `website/mikedown-desktop/` stays outside the Vite build and is rendered only by `release.sh` / `render-page.js`.
- **Angular demo:** `website/developers-angular/` is an Angular CLI app with its own lockfile, not a workspace.
- **Going live without a desktop release:**
  - Site pages and the desktop page's cross-links go live through M11's site-only pack for the existing `mikedown-downloads` project, with its own release version (default `0.3.0-site.N`).
  - That pack holds only site files plus a re-rendered `index.html` with the current desktop version. It never includes `latest*.json` or artifacts, and leaves `web.config` untouched.
  - It relies on `publish-files` being additive.

**Why:** one project, one IIS virtual directory, no second deploy target to secure.

**Verified:**

- `deploy.yaml` `publish-files` comment says "never prunes", `web.config` is a `protectedFiles` entry, and the smoke tests only check `latest*.json` (still served after a site release).
- Live: `/mikedown/` returns 200, `/mikedown/vscode/` returns 404 (free), `cf-cache-status: DYNAMIC` (Cloudflare does not cache `/mikedown/`, so purges are not needed today).
- Port 5180 is unused in the repo (desktop uses 1420, core demo 5199).

Not verified, so M11 must check:

- Whether LymeDeploy accepts `0.3.0-site.N`. In semver it sorts **below** `0.3.0`, so it can't outrank the desktop release, but LymeDeploy may refuse a version lower than its latest.
- `retain: 3`: site releases count toward retention, so a few site publishes push the last desktop release out of the rollback set. Files on disk are unaffected; M11 should raise `retain` or note it.
- Whether `publishLast` tolerates listed files missing from a site package.

**What changes in this plan:** M11 adds the three checks above. The Cloudflare purge list stays disabled (already the case), and the T4/M15 purge step becomes "skip unless a cache rule was added".

## Provenance and publish security

**Decision:** provenance deferred. Mike publishes from his terminal with 2FA (OTP or security key) via `release:npm --publish`. Later, CI publishing means npm trusted publishing (GitHub Actions OIDC), which also produces provenance. After each first publish, set the package to "Require two-factor authentication and disallow tokens". `.npmrc` stays ignored.

**Why:** provenance needs a cloud CI identity that a laptop publish can't provide. With 2FA required and long-lived publish tokens retired, trusted publishing is the only CI path.

**Verified:**

- npm docs list provenance generation for GitHub Actions, GitLab and CircleCI only, via OIDC.
- Trusted publishing needs `id-token` permissions, npm CLI 11.5.1+ and Node 22.14+. Moving the `rc` and `latest` dist-tags from CI needs npm CLI 11.21+, so CI must not use the runner's bundled npm.
- Local CLI is 11.6.1; G1 shows 2FA on.

Assumed: npm's 2025 policy text on retired tokens (docs pages fetched only in part).

**What changes in this plan:** `BACKLOG.md` gets the trusted-publishing entry now (M14's item becomes a check).

## Accessibility contract

**Decision:** every wrapper, and the web component, behaves the same through M5's binding:

- **Options:** core gets `id`, `ariaLabel` and `ariaLabelledBy` options.
- **Rich view:** they go on the ProseMirror surface through TipTap `editorProps.attributes`, never by writing to `editor.view.dom`. The surface also gets `role="textbox"` and `aria-multiline="true"`; the default name stays "Document text".
- **Source view:** the same attributes go on CodeMirror's `.cm-content` through `EditorView.contentAttributes`.
- **`<label for>` (React, Vue, Angular):** `<label for>` can't target a contenteditable `div`. When `id` is set and `ariaLabelledBy` isn't, the binding looks for `label[for=<id>]` at mount, uses it as `aria-labelledby` (giving it an id if it has none), and focuses the editor on its click. The READMEs recommend `ariaLabelledBy` as the robust path.
- **Web component:** the element keeps its own `id`, so `<label for>` works natively for a form-associated element. On a click whose target is the element itself, it calls `handle.focus()`, and it forwards `internals.labels` (else `aria-label` / `aria-labelledby`) to the surface.
- **No `role="main"` when embedded:** the binding passes a new core option `landmark: false`, which drops the `role="main"` core puts on `.mikedown-editor-container`. That landmark is right for VS Code and Desktop but wrong for a form field.
- **Methods:** `focus()` is on every wrapper's handle/ref.
- **Name order (Mike's call, M14):** the bullets above list labels first, but M6 implemented the ARIA standard order and Mike kept it: `aria-labelledby`, then `aria-label`, then `<label for>` elements. Every wrapper (through `bindMikeDownValue`, which turns `label[for]` into `aria-labelledby` only when no `ariaLabelledBy` is given) and the web component behave this way, and the READMEs say so.

**Why:** one implementation in core means M6 to M9 can't drift, and changing attributes through PM props keeps the "no DOM writes outside a transaction" rule.

**Verified:** `editor.ts:3084` sets `aria-label: 'Document text'`, `aria-multiline` through `editorProps.attributes`; `editor.ts:170` sets `role="main"`, `aria-label="Markdown editor"` on the container; `ElementInternals.labels` support per MDN (above).

**What changes in this plan:** M5's binding item adds `landmark`, `placeholder`, `outputTransform` and the `label[for]` lookup; M6's labelable item uses `internals.labels`.

## Review

Awaiting Mike's review. M1 and M5 start after approval.
