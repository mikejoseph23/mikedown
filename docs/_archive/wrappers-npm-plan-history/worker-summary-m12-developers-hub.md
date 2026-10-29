# Worker summary: M12 — Developers hub and demo pages

**Status:** Completed (StackBlitz links, which were optional, are cut; see below).

- Start: 2026-10-24 17:16 EDT. End: 2026-10-24 17:43 EDT.
- Worktree: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a7a30c60692d184dc`
- Branch: `worktree-agent-a7a30c60692d184dc`
- Base: the worktree started on stale `4172f62` (clean, not on `01b38bc`'s line), so it was reset to `01b38bc` as instructed.
- Commits: `8b333bf` (wire the demos to the workspace packages), `ad0c586` (hub and four demo pages).

## Work completed

- **Hub `/mikedown/developers/`:** two-sentence intro, install line with copy button, live editor (web component) next to its live markdown value with theme and read-only controls, package grid (web-component, react, vue, angular, plus core) with one line, install command and copy button, npm, demo and README links each, a "Which package do I need?" list (React, Vue, Angular 17+, Svelte/Lit/Solid/Preact/Blazor, server-rendered forms and htmx, no build step → CDN), and a band linking Desktop, VS Code and GitHub.
- **Four wrapper pages:** each runs its wrapper live on a shared "stage" (editor and markdown value side by side, stacked on phones), with a theme segmented control (Auto/Light/Dark) and a read-only switch, the install command, the sample file shown with a copy button, framework notes and a README link.
  - The sample shown is the file that runs: `react/Demo.tsx`, `vue/Demo.vue`, `web-component/form.html` + `form.js`, `developers-angular/src/app/demo.ts`. Each page's glue (`main.*`, `app.ts`) only mounts it and passes `theme`/`readOnly`. Code blocks are highlighted at build time (highlight.js, no runtime JS).
  - Notes: React (Next.js app router, `next/dynamic`, Vite/StrictMode, Svelte → web component); Vue (Nuxt `<ClientOnly>`, plugin registration, template-ref `handle`, Vue 3.3/Svelte); Angular (standalone with `inputId`, NgModule, angular.json styles, versions/lazy/darkSelector); web component (Svelte, Lit, htmx, Rails/Django/Razor/Laravel textarea wrapping).
- **Web component page:** the demo is a plain `<form>` with a progressive-enhancement `<textarea>`; Submit shows the `FormData` body length (no server), `required` blocks an empty submit with the browser's message, Reset restores the text (all verified in Chrome). CDN snippet section (`#cdn`) with the version read from `packages/web-component/package.json` at build time (`0.2.0-rc.0` today).
- **Shared shell:** used as is; `website/shared/` is unchanged, so no `sync:shell` was needed. Developer-only pieces live in `website/developers/common/` (`developers.css`, `stage.js`, `samples.js`).
- **StackBlitz (optional): cut.** The packages are not on npm yet, so a StackBlitz project could not install them. Revisit after the first publish.
- **Meta:** titles, meta descriptions, canonical, Open Graph (`og:image` is the live desktop screenshot `https://www.iadev.net/mikedown/screenshot-outline-light.png`) and a Twitter card on all five pages, plus an inline data-URI SVG favicon (the site has no `/favicon.ico`; the Angular scaffold's Angular-logo favicon is removed).
- **Lighthouse (CLI 13.5.0, headless Chrome, built site via `vite preview`):** accessibility 88, best practices 100, SEO 100 on all five pages. Every remaining accessibility failure is inside core's editor, not the page:
  - `color-contrast`: completed task-list text is `#808080` on white (3.94:1, needs 4.5:1).
  - `label` and `target-size`: task-list checkboxes have no accessible name and are under 24 px.
  - `label-content-name-mismatch`: toolbar buttons whose `aria-label` differs from their visible text ("Text Format", the font-size button).
  - Best practices flags `valid-source-maps` (a dependency's source map reference in the bundle); informational.
  - Page chrome passes contrast, labels and focus order (skip link → nav → install/copy → stage controls → editor → value → code copy buttons).
- **`npm run build:site`:** green (also after a clean `npm ci` in `website/developers-angular/`).

## Files modified

- `website/package.json` (devDeps: wrappers via `file:`, `@vitejs/plugin-vue`, highlight.js, react, react-dom, vue; scripts `build:packages`, `build` runs it first, `dev` runs `scripts/ensure-packages.mjs`), `package-lock.json`
- `website/vite.config.mjs` (Vue plugin, `esbuild.jsx: 'automatic'`, `developerPages()` plugin)
- `website/scripts/build-angular.mjs`, `website/scripts/ensure-packages.mjs` (new)
- `website/developers/index.html`, `hub.js`, `common/{developers.css,stage.js,samples.js}`
- `website/developers/{react,vue,web-component}/*`, `website/developers/angular/index.html` (dev-server stand-in)
- `website/developers-angular/`: `package.json`, `package-lock.json`, `angular.json`, `.gitignore`, `src/index.html`, `src/app/app.ts`, `src/app/demo.ts` (new); removed `app.html`, `app.css`, `app.spec.ts`, `public/favicon.ico`

## Test status

- `npm run build:site`: pass (check:shell, build of every npm package, Vite build, Angular build).
- `npx vitest run test/unit packages/core/test`: 1565 passed, 2 todo.
- `npm run compile`, `lint`, `test:edge`: not run; nothing under `src/`, `packages/` or the extension build changed.
- `node packages/desktop/deploy/stage-site.js --dist website/dist ... --desktop-version 0.3.0`: "Site folder OK: 195 files" (the site pack gate accepts the new output).
- Manual (Chrome): typing updates the value panel on all four wrappers; theme and read-only toggles reach each editor; form submit, required and reset on the web component page.
- Playwright sweep of all five pages at 1280 and 400 px, light and dark: no horizontal page overflow, no console errors.

## Issues and notes for the orchestrator

- **Angular wiring:** local `file:` links, not a tarball: `@mikedown/angular` → `file:../../packages/angular/dist`, `@mikedown/core` → `file:../../packages/core`, with `preserveSymlinks: true` so Angular, core's peers and core's own deps resolve from the demo's `node_modules` (no second Angular copy from `packages/angular/node_modules`). Core's peers and dependencies are listed explicitly in the demo's `package.json`. So `packages/angular/dist` must exist before `build:angular`; `build:site` now builds every package first (adds about a minute).
- **File types:** output is only `.html .js .css .jpg .ico .txt .json` (the `.json` is Angular's `prerendered-routes.json`, the `.txt` its license file). No `.svg`, `.woff2`, `.mjs` or `.webmanifest`. KaTeX's fonts are kept out by stripping core's `@import 'katex/dist/katex.min.css'` and linking KaTeX's CSS from jsDelivr (pinned to the installed 0.16.47). The Angular page inlines the Google Fonts CSS (fonts come from fonts.gstatic.com).
- **Size:** `dist` is about 13 MB, mostly Mermaid's lazy chunks, emitted twice (once by Vite, once by Angular). Nothing loads until a document has a diagram.
- **Core gaps to consider (for a core gap-fill, not M12):** the four Lighthouse items above; the toolbar does not fit below about 520 px (it overflows, so the right-hand buttons are cut off on phones); when a document ends with a table, the table's floating toolbar shows on load without focus (the demos end with a paragraph to avoid it).
- **Dev server:** `/mikedown/developers/angular/` under `npm run dev:site` is a stand-in that says to build and preview; the Angular page is real only after `build:site`.
- The VS Code and desktop pages also 404 on `/favicon.ico`; adding the same data-URI icon to them is a one-line change each, left to their owner.
- Nothing to push, publish or deploy from this milestone. Going live is M15's site pack: `packages/desktop/deploy/pack-for-lymedeploy.sh --site --desktop-version 0.3.0 --site-n <N>` (dry run by default), then Mike's `lymedeploy` apply.

## Review Materials

- Built site: `cd /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a7a30c60692d184dc && npm run build:site && npm run preview -w website`, then open `http://localhost:5180/mikedown/developers/` (click a package's "Live demo" for each wrapper page). Dev server: `npm run dev:site` (same URL; the Angular page needs the preview).
- Screenshots (1280 and 400 px, light and dark, full page), in `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/bcdeef5a-0084-4a26-a5d3-4847724c0e44/scratchpad/screenshots/`:
  - `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/bcdeef5a-0084-4a26-a5d3-4847724c0e44/scratchpad/screenshots/developers-1280-light.png` (and `-1280-dark`, `-400-light`, `-400-dark`)
  - `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/bcdeef5a-0084-4a26-a5d3-4847724c0e44/scratchpad/screenshots/developers-web-component-1280-light.png` (and the other three)
  - `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/bcdeef5a-0084-4a26-a5d3-4847724c0e44/scratchpad/screenshots/developers-react-1280-light.png` (and the other three)
  - `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/bcdeef5a-0084-4a26-a5d3-4847724c0e44/scratchpad/screenshots/developers-vue-1280-light.png` (and the other three)
  - `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/bcdeef5a-0084-4a26-a5d3-4847724c0e44/scratchpad/screenshots/developers-angular-1280-light.png` (and the other three)
- Lighthouse JSON reports: `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/bcdeef5a-0084-4a26-a5d3-4847724c0e44/scratchpad/lh/`
