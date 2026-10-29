# Worker summary: M11 site build and deploy path

**Status:** Completed (all items attempted; MIME check partly unverifiable, see below)
**Worktree:** /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a71cf38888b7035e0
**Branch:** worktree-agent-a71cf38888b7035e0 (reset to 7548dd8 first; the worktree started on a stale commit with a clean tree)
**Commits:** ceb6f7b (site workspace + Angular scaffold), 77cea12 (site-only publish path)
**Start/end:** 2026-10-24 ~16:05 to ~16:16 local

## Work completed

- **Site workspace.** `website/package.json` (private `@mikedown/site`, vite ^7.3.7), `website/vite.config.mjs` (base `/mikedown/`, port 5180 strict, assetsDir `site-assets`, six pages). Root `workspaces` is now `["packages/*", "!packages/angular", "website"]`; root scripts `dev:site`, `build:site`. `website/index.html` was moved (git mv) to `website/vscode/index.html` (its screenshot copied next to it as `dark-mode-editor.jpg`, so Vite hashes it into `site-assets/`). Placeholder pages: `developers/`, `developers/{web-component,react,vue,angular}/`. `website/mikedown-desktop/` untouched and outside the build. No wrapper packages created (they do not exist yet).
- **Angular demo.** `website/developers-angular/` (Angular 21 CLI app, own lockfile, not a workspace; the newest CLI refused Node 22.20, v21 works). `angular.json` outputPath is `../dist/developers/angular`; `website/scripts/build-angular.mjs` runs `npm ci` if needed then `ng build --base-href /mikedown/developers/angular/`. `npm run build:site` = `vite build` then the Angular build into the same `website/dist`. Verified end to end.
- **Site-only publish path.** `pack-for-lymedeploy.sh --site` (flags `--desktop-version`, `--site-n`, `--site-version`, `--linux`, `--no-linux`, `--dist`), new `stage-site.js`, `lib/site-checks.js`, `verify-site.js`, README section, `deploy.yaml` comments. Version default `<desktop-version>-site.N`. Desktop version is read from the live `latest.json`. Guards (pack fails): any `latest*.json`, any artifact extension, `SHA256SUMS.txt`, any `web.config`, unknown top-level folders, missing entry pages, unrendered Linux placeholders; the Python packer re-checks the finished zip. Desktop mode is unchanged (dry-run of the real 0.3.0 upload still packs 15 files). Unit tests: `packages/desktop/test/unit/site-pack.test.ts`.
- **Checks (LymeDeploy source at ~/git/lymedeploy):**
  - *Version scheme:* accepted. A release version is a free string, unique per project (`ReleasesController` only calls `VersionExistsAsync`); a package version is read from the nuspec and used as a folder name. Nothing sorts or compares versions, so `0.3.0-site.N` cannot outrank or replace the desktop release (semver puts it below anyway). Each N must be new (Conflict otherwise).
  - *`retain: 3`:* it is `RetainLastN` = the agent's keep-newest-N of extracted package folders in its work area (`PackageManager.PruneOldVersions`, by write time). It never touches the published folder. Rollback re-downloads the pinned package, and server retention never purges packages of a publish-files project (`publish-files.md`, M1 retention note). Left at 3, with a comment in the yaml.
  - *`publishLast` with missing files:* tolerated. `Partition` only matches files present; an empty last set just skips the log line. I added `index.html` to `publishLast`; patterns without a `/` match by file name anywhere, so this also defers every site page until assets are in place. Existing test updated.
- **`publish-files` never prunes (confirmed in `PublishFilesExecutor.cs`):** it only hashes, copies, and `Directory.CreateDirectory` for subfolders inside the target; no delete path exists. So `/vscode/` and `/developers/` survive desktop releases (a desktop package simply does not contain them) and desktop files survive site releases. Subfolders are supported (created on demand). `protectedFiles: web.config` matches a `web.config` in any subfolder too.
- **Desktop page re-render.** Safe, done in the site package. `render-page.js` on the current source with 0.3.0 and the 0.3.0 AppImage is **byte-identical to the live page and to the staged `dist/0.3.0/upload/index.html`**. So today the re-render is a no-op; it will carry the cross-links once M12/M13 add them to `website/mikedown-desktop/index.html`. The Linux size comes from the local `dist/0.3.0/*.AppImage` (published copy returns 200).
- **MIME check.** Could not be completed as asked: iadev.net serves no `.woff2`, `.mjs`, `.svg` or `.webmanifest` file I could find (crawled the home page, /app/, /products/ etc.), and 404 bodies are identical for mapped and unmapped extensions, so probing is not informative. Confirmed served: `.css` (text/css), `.js` (application/javascript), `.png` (image/png), `.html`, `.json`. Current pages need only `.html .js .css .jpg .png .ico .txt .json` (all IIS defaults or machine-wide). `stage-site.js` warns for any other extension in the package (e.g. `.woff2`, `.svg`, `.mjs`, `.webmanifest`, `.map`) so M12/M13 notice before publishing. Nothing added to `web.config`; never add a `mimeMap` for a mapped type. `verify-site.js` fetches every file after deploy, which will catch an unserved type (404).
- **Cloudflare purge list.** New disabled step "Purge Cloudflare cache for the site pages" (sortOrder 6) in `deploy.yaml`: six page URLs, each with and without `index.html`, apex and www (24 URLs). Not needed while `/mikedown/` is DYNAMIC.
- **Root scripts + commit:** done.

## Files modified

Root: `package.json`. `website/`: `package.json`, `vite.config.mjs`, `scripts/build-angular.mjs`, `vscode/index.html` (moved) + `vscode/dark-mode-editor.jpg`, `developers/**/index.html`, `developers-angular/**` (with its own `package-lock.json`). `packages/desktop/deploy/`: `pack-for-lymedeploy.sh`, `stage-site.js`, `verify-site.js`, `lib/site-checks.js`, `lymedeploy/deploy.yaml`, `README.md`. Tests: `packages/desktop/test/unit/site-pack.test.ts` (new), `release-pipeline.test.ts` (publishLast expectation).

## Test status

- `npm run build:site`: pass (vite 6 pages + Angular build into `website/dist`).
- `lymedeploy apply -f ... --dry-run`: diff is exactly the `index.html` publishLast change and the new disabled purge step (nothing written).
- `pack-for-lymedeploy.sh --site ... --dry-run`: pass (17 files, 0.7 MB); desktop dry-run on the 0.3.0 upload: pass.
- `npm run lint`: 0 errors (1066 pre-existing warnings). `npm run test:edge`: 22 pass.
- `npm run test:unit`: 1527 pass, 1 fail: `standaloneHtml.test.ts` needs `packages/core/dist/styles.css` (core not built in this worktree); unrelated to M11. New and updated tests pass.
- `npm run compile` not run (no `src/`, core, or webpack changes).

## Issues / notes for orchestrator

- **`package-lock.json`:** `npm install` changed it (new `website` workspace, vite, etc.); I reverted it and did not commit it. Re-run `npm install` after merging and commit the lockfile (and merge with M2's).
- `packages/angular` does not exist; the `!packages/angular` exclusion is inert until then.
- The root `workspaces` entry `website` makes `website/developers-angular` still separate (own `node_modules`, `npm ci`).
- `website/dist` is ignored by the existing `dist/` rule.
- Site mode needs the project yaml applied only for the optional `index.html` ordering and the disabled purge; a site release works against the current live project config too.
- Smoke tests in the yaml were not extended to the new pages (a desktop release before the first site publish would fail them with 404).
- `.orchestrator/` is gitignored, so this summary is not committed; the orchestrator copies it.

## Exact commands (Mike runs these; nothing was applied)

```bash
# 1. Update the project (optional but recommended before the first site release)
lymedeploy apply -f packages/desktop/deploy/lymedeploy/deploy.yaml --dry-run
lymedeploy apply -f packages/desktop/deploy/lymedeploy/deploy.yaml
# 2. Build and publish the site
npm install && npm run build:site
packages/desktop/deploy/pack-for-lymedeploy.sh --site --site-n 1 --dry-run
packages/desktop/deploy/pack-for-lymedeploy.sh --site --site-n 1
# (reads the desktop version from https://www.iadev.net/mikedown/latest.json; add
#  --linux <AppImage> if packages/desktop/deploy/dist/<v>/ no longer has it)
# 3. Confirm
node packages/desktop/deploy/verify-site.js --dir packages/desktop/deploy/dist/site-0.3.0-site.1/upload --desktop-version 0.3.0
```

## Review Materials

- Dev server: `npm run dev:site` then http://localhost:5180/mikedown/vscode/ and http://localhost:5180/mikedown/developers/
- Built output: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a71cf38888b7035e0/website/dist`
- Staged site package: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a71cf38888b7035e0/packages/desktop/deploy/dist/site-0.3.0-site.1/upload`
