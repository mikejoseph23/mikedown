# M13 worker summary: VS Code page refresh and cross-links

**Status:** Completed

- **Worktree:** `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a5e1f844bbfb43974`
- **Branch:** `worktree-agent-a5e1f844bbfb43974` (reset to `579864e` first; tree was clean)
- **Commits:**
  - `31b1a85` Add a shared site shell and put it on the desktop download page
  - `1596c78` Rebuild the VS Code page on the site shell with current features
- **Start / end:** 2026-10-24 16:17 to 16:40 (local)

## Work completed

- [x] **Shared shell** in `website/shared/`:
  - `shell.css`: the desktop page's tokens (same hex values), Inter, light and dark through `prefers-color-scheme`, plus a `data-theme="light|dark"` override on `<html>` for M12's theme toggles. It also holds the header, footer, `.btn`, skip link, `.visually-hidden` and a shared `.band` cross-link strip.
  - `page.css`: content pieces for Vite pages (`.section`, `.prose`, `.shot` frames, `kbd`/`code`, `.command` with copy button).
  - `partials.js`: header (Desktop · VS Code · Developers · GitHub, `aria-current` on the active page) and footer, both as functions.
  - `vite-plugin.js`: fills `<!--shell:header page="..."-->` and `<!--shell:footer-->` markers. In dev and preview it also serves the desktop page at `/mikedown/` (no Linux block), so the Desktop nav link works locally.
  - `copy.js`: copy buttons (`data-copy` / `data-copy-target`).
- [x] **VS Code page** (`website/vscode/index.html`) rebuilt on the shell. M11 had already done the `git mv`.
- [x] **Copy refreshed** from README and CHANGELOG:
  - Dropped: "beta" and the "no other editor has" claims.
  - Added: sidebar, slash commands, math, tags, zoom (including the unreleased toolbar zoom control), footnotes, heading numbering and spell check.
  - GitHub links now point at `mikejoseph23`.
  - Screenshots are copied beside the page, cropped to the window (the white macOS shadow margin looked wrong on the dark page), with light and dark pairs in `<picture>`. No `../assets/` paths remain.
- [x] **Install options:** Marketplace button, an "Open in VS Code" link (`vscode:extension/interapp.mikedown-editor`), and a copyable Quick Open line (`ext install interapp.mikedown-editor`).
- [x] **Desktop page changes:**
  - Shared nav and footer.
  - "Also for VS Code" band below the screenshots, with a Marketplace button and a link to `/mikedown/vscode/`.
  - "Build it into your app" link to `/mikedown/developers/`.
  - Every `@@LINUX_*@@` placeholder, the `linux:begin/end` blocks and both `data-dl` buttons are intact.
  - Also fixed `.hero p` overriding the version line's top margin, which had it touching the download buttons.
- [x] Committed.

## Files modified

- New:
  - `website/shared/` (`shell.css`, `page.css`, `partials.js`, `vite-plugin.js`, `copy.js`)
  - `website/scripts/sync-desktop-shell.js`
  - `test/unit/site-shell.test.ts`
  - 7 screenshots in `website/vscode/`
- Changed:
  - `website/vscode/index.html`
  - `website/vscode/dark-mode-editor.jpg` (cropped)
  - `website/mikedown-desktop/index.html`
  - `website/vite.config.mjs` (plugin)
  - `website/package.json` (`check:shell`, `sync:shell`; `build` and `build:vite` run the check first)
  - `website/scripts/build-angular.mjs` (fills the shell markers in the built Angular `index.html`)

## Test status

- `render-page.js` with the 0.3.0 inputs and `--linux` pointing at the 0.3.0 AppImage, then `check-upload.js --version 0.3.0` on a clone of `dist/0.3.0/upload`: **OK** ("Staged folder OK: 15 files ... (0.3.0, full)").
- `npm run build:site` (Vite + Angular): **green**.
- `pack-for-lymedeploy.sh --site --site-n 1 --desktop-version 0.3.0 --linux <0.3.0 AppImage> --dry-run`: **OK**. "Site folder OK: 26 files", packed 1.6 MB and verified, with no MIME warnings (only `.html .js .css .jpg .png .ico` in the output). Its `index.html` is byte-identical to the `render-page.js` output.
- `npx vitest run test/unit/site-shell.test.ts`: 10/10.
- `npm run test:unit`: 1538 pass. One failure at first, `packages/desktop/test/unit/standaloneHtml.test.ts`: it needs `packages/core/dist`, which a fresh worktree lacks. After `npm run build:core` it passes 15/15, so it is not caused by this change.
- `npm run test:edge`: 22/22.
- `compile` and `lint` were not run: nothing under `src/` or `packages/core/` changed.
- **Visual check** (Claude in Chrome, dev server):
  - `/mikedown/vscode/` and `/mikedown/` at 1280 px, light, the whole page.
  - Both pages at 400 px in an iframe: `scrollWidth == clientWidth == 400`, nothing overflows.
  - Dark through `data-theme="dark"` at 1280 (VS Code page) and 400 (desktop band).
  - **Not checked:** dark screenshots under a real OS dark setting. The `<picture>` sources follow the OS, not `data-theme`, so the forced-dark check still showed the light captures.

## Notes for orchestrator / M12

- **Using the shell on a page:**
  1. Link `/shared/shell.css` and `/shared/page.css`.
  2. Put `<!--shell:header page="developers"-->` before `<main id="main">` and `<!--shell:footer-->` after it.
  3. Load `/shared/copy.js` for copy buttons.
- **Angular demo:** add the same markers to `developers-angular/src/index.html` and `"../shared/shell.css"` to its `angular.json` styles. The marker hook in `build-angular.mjs` is untested because the Angular `index.html` has no markers yet; if Angular strips comments, it will need another route.
- **Editing the shell:** after changing `shared/shell.css` or `partials.js`, run `npm run sync:shell -w website`. Otherwise `build:site` and the unit test fail on a stale desktop copy.
- **Theme toggles:** a page toggle that sets `data-theme` will not swap `<picture>` screenshots, because they follow the OS. M12 should handle that if its pages show light and dark images.
- **Copy to check:** the page names the toolbar zoom control and the narrow-editor sidebar behaviour, which are in `[Unreleased]` and ship with M3 (2.15.0), before the site goes live at M15. The footer now reads "MikeDown is made by Interapp Development, Inc." on every page, plus links (it used to say "MikeDown Desktop is made by ...").
- **Hosted URLs:** shell links are absolute (`/mikedown/...`), matching the deploy base.
- **Nothing published:** nothing was pushed or deployed. To publish the site after merge: `npm run build:site`, then `packages/desktop/deploy/pack-for-lymedeploy.sh --site --site-n 1` (add `--dry-run` first).

## Issues or blockers

None.

## Review Materials

- **Dev server:**
  - Start: `cd ~/git/mikedown && npm run dev:site` (after merge; or run it in the worktree).
  - `http://localhost:5180/mikedown/vscode/` (VS Code page)
  - `http://localhost:5180/mikedown/` (desktop page, served by the dev plugin, no Linux block)
  - Click path: header nav between Desktop and VS Code; on the desktop page, scroll below Screenshots to the "Also for VS Code" band.
- **Rendered desktop page (0.3.0 with Linux):**
  - `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a5e1f844bbfb43974/packages/desktop/deploy/dist/site-0.3.0-site.1/upload/index.html` (screenshots beside it)
  - Copy: `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/d074522f-4bf7-4bb6-a1c5-769d272462ec/scratchpad/upload-0.3.0/index.html`
