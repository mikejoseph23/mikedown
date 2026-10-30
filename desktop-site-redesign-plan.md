# Desktop Site Redesign Plan

## Summary

Redesign of the MikeDown Desktop download page (`website/mikedown-desktop/index.html`, served at https://www.iadev.net/mikedown/) plus a new comparison page. Written 2026-10-30 from an audit of the code on `develop` (Desktop 0.4.0, npm family 0.3.0, VS Code 2.16.0 released; the AI work and 0.4.0 are unpushed on `develop`).

Goals, in Mike's words:

1. **Feature the new experimental AI features.** Off by default, behind `ai.enabled`. Local engines first (oMLX, LM Studio, Ollama); cloud engines opt-in, with per-folder consent and keys in the OS keychain.
2. **Say much more about what Desktop does**, as a feature tour grouped by theme: writing, files and folders (tree, tabs, split panes, folder search), version history, export, multi-window (the macOS Dock menu and Windows taskbar New Window, and Open Containing Folder opening an outside file's folder in its own window), AI.
3. **A comparison chart** of which features are available where: Desktop, the VS Code extension, the `<mikedown-editor>` web component, and the React, Vue and Angular wrappers.

Decisions already made:

- **Ships as a site-only release after Desktop 0.4.0**, not inside it. The path is `packages/desktop/deploy/README.md` ("Publishing the website without a desktop release") and `CLAUDE.md` (Releasing, Website). The first one after 0.4.0 is `0.4.0-site.1`.
- **The page's privacy section is already correct for AI** (commit `0a3cd53`). New AI copy must agree with it, with `packages/desktop/README.md` (the Privacy lines under "AI engines", around line 276) and with `packages/core/src/ai/privacy.ts` (`AI_CLOUD_PRIVACY`, `AI_SENDS_TEXT`, `aiConsentStepNote`). No claims about any provider's retention or training; "may", and a link to the provider's policy.
- **Recommended, open for Mike to confirm:** the comparison chart is its own page, `website/compare/`, linked from the Desktop, VS Code and Developers pages, because it spans every product (OQ1).
- **Two or three AI screenshots** are needed, taken from Desktop with a local engine set up (M4).

Critical success factors:

- Every cell of the comparison chart is true of the code, with the deciding file named in this plan. Unsure cells are in [Needs Mike's check](#needs-mikes-check), not guessed.
- The Desktop page keeps working through the release pipeline: flat staging, the `shell:css` sync, the `linux:begin/end` markers, PNG screenshots next to the page, and the manifest-driven download script.
- The compare page is built by Vite, allowed by the site package gate, and found by the link test. Nothing in the site release touches a manifest or an artifact.
- Every page passes at 360 px wide, in light and dark, with no horizontal scroll; `npm run build:site` passes; the site-only `--dry-run` passes.

Defaults applied by the planning skill: incremental verification (acceptance checks on every milestone, one hands-on pass at the end), automated checks first, no Playwright, screenshots by hand (M4), Opus on the two page-design milestones, no database, no LymeStack mode.

### Milestone Progress Tracker

| Milestone | Model | Status | Duration (min) | Notes |
|---|---|---|---|---|
| [M1 Comparison matrix: data and Mike's review](#m1-comparison-matrix-data-and-mikes-review) | Sonnet (audit done here), Mike | ⬜ Not Started | — | The matrix below is the draft; Mike resolves the check list |
| [M2 Compare page](#m2-compare-page) | Opus | ⬜ Not Started | — | `website/compare/`, Vite input, site gate, link test |
| [M3 Desktop page: feature tour and AI section](#m3-desktop-page-feature-tour-and-ai-section) | Opus | ⬜ Not Started | — | Inline CSS only; markers and script untouched |
| [M4 AI screenshots](#m4-ai-screenshots) | Mike (Sonnet for the page edits) | ⬜ Not Started | — | 2 or 3 PNGs from Desktop with a local engine |
| [M5 Links from the VS Code and Developers pages](#m5-links-from-the-vs-code-and-developers-pages) | Sonnet | ⬜ Not Started | — | Bands, footer, maybe the nav (OQ2) |
| [M6 Site-only publish and verification](#m6-site-only-publish-and-verification) | Sonnet, Mike for the real publish | ⬜ Not Started | — | `0.4.0-site.1`, after Desktop 0.4.0 is live |

[Return to Top](#desktop-site-redesign-plan)

---

## Table of Contents

- [Summary](#summary)
- [Audit: the comparison matrix](#audit-the-comparison-matrix)
- [Audit: Desktop page constraints](#audit-desktop-page-constraints)
- [Audit: building and packing a compare page](#audit-building-and-packing-a-compare-page)
- [Needs Mike's check](#needs-mikes-check)
- [Open Questions for Mike](#open-questions-for-mike)
- [Rules for every worker](#rules-for-every-worker)
- [M1 Comparison matrix: data and Mike's review](#m1-comparison-matrix-data-and-mikes-review)
- [M2 Compare page](#m2-compare-page)
- [M3 Desktop page: feature tour and AI section](#m3-desktop-page-feature-tour-and-ai-section)
- [M4 AI screenshots](#m4-ai-screenshots)
- [M5 Links from the VS Code and Developers pages](#m5-links-from-the-vs-code-and-developers-pages)
- [M6 Site-only publish and verification](#m6-site-only-publish-and-verification)
- [Parallel Development Recommendations](#parallel-development-recommendations)
- [Progress Log / Notes](#progress-log--notes)

---

## Audit: the comparison matrix

Filled from the code on 2026-10-30, time-boxed (greps and excerpts, not whole files). Files read: `packages/core/src/types.ts` (`MikeDownFeatures`, defaults), `packages/core/src/host.ts` (the optional host methods), the `editor.ts` import list, `packages/desktop/src/host/tauriHost.ts` and `aiHost.ts`, the `packages/desktop/src` folders (`tree/`, `panes/`, `search/`, `documents/`, `export/`, `settings/`), the Rust module headers in `packages/desktop/src-tauri/src/commands/` (`multiwindow.rs`, `versions.rs`, `updater.rs`, `print.rs`, `search.rs`) and `dock.rs`, `src/webview/editor-main.ts` (the VS Code host adapter and its protocol comment), `src/export.ts`, `src/settings.ts`, the `mikedown.*` commands in `package.json`, `packages/web-component/src/element.ts` and its README, `packages/react/src/MikeDownEditor.ts`, `packages/vue/src/MikeDownEditor.ts`, `packages/angular/src/lib/mikedown-editor.component.ts` and `angular-mikedown-host.ts`, `packages/core/README.md` ("Bring your own AI"), `docs/wrappers-decisions.md`, `website/developers/index.html` and the demos' `common/stub-ai.ts`.

Legend:

- **Yes**: in the product as shipped.
- **Partial**: present, with a limit named in the Notes column.
- **Host must provide**: core has the hook; the surrounding application supplies it (a `host` method, the `ai` host, a dictionary URL, storage). For the VS Code column it means VS Code itself provides the feature (its Explorer, tabs, Search, Marketplace), not the extension.
- **No**: nothing in that package does it.
- **n/a**: the row does not apply to that product.

The three wrappers (React, Vue, Angular) share one column: they are thin layers over `bindMikeDownValue` and `host`, so they match on every row except the last two, where the Notes say how each one differs.

| Feature | Desktop | VS Code | Web component | React / Vue / Angular | Decided by | Notes |
|---|---|---|---|---|---|---|
| WYSIWYG and source mode | Yes | Yes | Yes | Yes | `packages/core/src/types.ts` (`sourceMode` default on); CodeMirror in `editor.ts` | Cmd+/ toggles in every host. |
| Tables, callouts, math, Mermaid, emoji, footnotes | Yes | Yes | Yes | Yes | `editor.ts` imports: `table-align`, `callout-node`, `math`, `mermaid`, `emoji`, `footnote` | `features.math` / `features.mermaid` can switch the renderers off. The CDN bundle loads KaTeX and Mermaid from jsDelivr on first use (`packages/web-component/README.md`, CDN section). |
| Spellcheck | Yes | Partial | Host must provide | Host must provide | `packages/desktop/src/main.ts:320` (bundled dictionaries); `src/settings.ts:144` (`spellCheck.enabled`, default false); `types.ts` ("inert unless `spellcheckDictionaryUrl` is set") | VS Code ships dictionaries but the setting is off by default. Web component: `spellcheck-dictionary-url` attribute. Angular: `spellcheckDictionaryUrl` input. React and Vue: see check C2. |
| Image paste to disk | Yes | Yes | Host must provide | Host must provide | `tauriHost.ts` (`uploadImage`, `pickImage`, `resizeImage`); `src/markdownEditorProvider.ts` (`savePastedImage`) with `src/imagePaste.ts`; `host.ts:170` ("Absent disables image paste and drop") | Wrappers: `host.uploadImage` (Angular: the `imageUpload` input). |
| Find and replace | Yes | Yes | Yes | Yes | `types.ts` (`findReplace` default on); `packages/core/src/findreplace.ts` | |
| Outline sidebar | Yes | Yes | Partial | Partial | `types.ts` (`sidebar` default off); `package.json` command `mikedown.toggleSidebar`; `mikedown-editor.component.ts:191` | Wrappers and the web component get it with `features: { sidebar: true }`. Outline and Properties work alone; Backlinks and Tags need host methods (next rows). See check C3. |
| Backlinks | Yes | Yes | Host must provide | Host must provide | `packages/desktop/src/tree/backlinks.ts`, `mdIndex.ts`, `tauriHost.ts#refreshBacklinks`; `src/backlinkProvider.ts` and the `backlinks` message in `editor-main.ts` | No backlink index ships in core; a host pushes items through the editor handle (`setBacklinks`). See check C4. |
| Wikilinks and tags | Yes | Yes | Host must provide | Host must provide | `tauriHost.ts` (`resolveWikilinks`, `createWikilink`, `getTags`); `editor-main.ts` (`wikilinksResolved`, `tags`, `openTag`); `host.ts` (`resolveWikilinks`, `getTags`) | The `[[` and `#` syntax parses everywhere; resolution and the Tags section need the host. Row added by the audit; drop it if the chart gets long. |
| Properties and frontmatter | Yes | Yes | Yes | Yes | `types.ts` (`frontmatter` default on); `packages/core/src/frontmatterParse.ts`; the Properties section of `outlineSidebar.ts` | The frontmatter block is on everywhere; the Properties panel needs the sidebar (row above). |
| Folder tree | Yes | Host must provide | No | No | `packages/desktop/src/tree/fileTree.ts`, `folderWorkspace.ts` | VS Code: its own Explorer. |
| Tabs | Yes | Host must provide | No | No | `packages/desktop/src/panes/paneManager.ts` | VS Code: its own editor tabs. |
| Split panes | Yes | Host must provide | No | No | `packages/desktop/src/panes/paneLayout.ts` | Each Desktop pane has its own tabs and sidebar. VS Code: editor groups. |
| Folder search | Yes | Host must provide | No | No | `packages/desktop/src/search/searchPanel.ts`; `commands/search.rs` | Plain text, case and whole-word options, hidden and `node_modules` folders skipped. VS Code: its own Search view. |
| Version history | Yes | Host must provide | No | No | `packages/desktop/src/documents/versioning.ts`; `commands/versions.rs` | Snapshots in `.mikedown/versions/` on every save inside an open folder, side-by-side diff, restore; a lone-file window never snapshots (check C5). Hot-exit backups too (`documents/backups.ts`). VS Code: Git and Timeline are VS Code's. |
| HTML and PDF export | Yes | Yes | Host must provide | Host must provide | `packages/desktop/src/export/exporter.ts`, `commands/print.rs`; `src/export.ts`, commands `mikedown.exportHtml`, `mikedown.print` ("Print / Export as PDF"), `mikedown.viewInBrowser`; `host.ts` (`exportHtml`, `printDocument`, `viewInBrowser`) | PDF goes through the OS print dialog on both apps (Save as PDF). Wrappers: `handle.getHtml()` plus your own download. |
| Multi-window | Yes | Host must provide | No | No | `commands/multiwindow.rs`; `dock.rs` (Dock menu on macOS, taskbar jump list on Windows); Open Containing Folder in `packages/desktop/src/main.ts:357` and `ui/chrome.ts` | New in 0.4.0: New Window from the Dock or taskbar; Open Containing Folder on an outside file opens that folder in its own window. |
| Auto-update | Partial | Host must provide | No | No | `commands/updater.rs`; the Linux card in `website/mikedown-desktop/index.html` | macOS and Windows update in-app; the Linux AppImage does not. VS Code: the Marketplace. Wrappers: npm. |
| Settings UI | Yes | Yes | Partial | Partial | `packages/core/src/editor.ts#showSettingsModal`; `packages/desktop/src/settings/appTab.ts` (App tab, folder override); `host.ts:163` (`saveSettings`) | The gear modal opens everywhere; persisting a change needs `host.saveSettings` in the web component and wrappers ("Your storage decides" on the Developers hub). |
| Toolbar customization | Yes | Yes | Partial | Partial | `types.ts` (`customizeToolbar` default on); `packages/core/src/toolbar-customize.ts`; `mikedown.toolbarLayout` in `package.json` | Same limit as Settings: the layout persists only through `host.saveSettings`. |
| AI writing tools | Yes (experimental, off by default) | Yes (experimental, off by default) | Host must provide | Host must provide | `packages/desktop/src/host/aiHost.ts`, `commands/ai.rs`; `src/ai/` and the `mikedown.ai.*` commands; `element.ts:358` (`ai` property); `packages/react/src/MikeDownEditor.ts:41` and `packages/vue/src/MikeDownEditor.ts:41` (`host.ai`); `mikedown-editor.component.ts:127` (`ai` input) | Rewrite, Explain, Translate, Summarize, Suggest titles and properties. In the web component and wrappers the UI appears only when an `ai` host is given; the AI UI is a lazy chunk. The site demos use a stub host (`website/developers/common/stub-ai.ts`). See check C1. |
| AI engine setup | Yes | Yes | Host must provide | Host must provide | `aiHost.ts` (`detectLocalServers`, `hardwareInfo`, `setSecret`, `requestCloudConsent`, `listConsents`); `src/ai/engineService.ts`, `providers/vscodeLm.ts` (Copilot, VS Code only); `packages/core/README.md` "Bring your own AI" (tier 1 and tier 2) | Both apps find running local servers, run the setup wizard, keep keys in secure storage and ask consent per folder or workspace. A tier 2 host gets the same Engines page UI from core, but transport, keys and the consent dialog are the host's; core ships no provider SDK. |
| Two-way value binding | n/a | n/a | Yes | Yes | `element.ts` (`value` property, `change` event); `MikeDownEditor.ts` (`value` / `onChange`, controlled or uncontrolled); Vue `modelValue` / `update:modelValue`; Angular `ControlValueAccessor` | |
| Native form field | n/a | n/a | Yes | Partial | `element.ts:94` (`static formAssociated = true`); `mikedown-editor.component.ts:66` (`ControlValueAccessor`) | Web component: submits under `name`, honors `required`, resets with the form. Angular: reactive and template forms. React and Vue: two-way binding only; wrap the web component or post the value yourself. |

[Return to Top](#desktop-site-redesign-plan)

---

## Audit: Desktop page constraints

Confirmed from the files on 2026-10-30. Every worker on M3 and M4 reads this section first.

**The page is staged flat, beside the manifests.**

- `packages/desktop/deploy/release.sh:252` renders the page with `render-page.js` into the upload folder's `index.html`, and line 256 copies every `*.png` found directly in `website/mikedown-desktop/` (max depth 1) next to it. Nothing else from that folder ships.
- `check-upload.js` (desktop releases) requires a flat folder, and `lib/publish-checks.js#pageImageNames` collects every `src="name.png"` with a bare file name and fails the upload if one is missing. Only `.png` is matched: a `.jpg`, a `srcset`, a `<picture>` source or an image in a subfolder is invisible to the check and, for site releases, a non-PNG at the top level is rejected outright by `lib/site-checks.js` ("only index.html, favicon.ico and the .png screenshots and icons may sit at the top level").
- So: new screenshots are `screenshot-<name>.png`, referenced with a plain `src=` attribute, sitting next to the page. A lightbox link is fine as `href` on the same file. Keep file sizes reasonable; the existing four are 2000 by 1250.
- `stage-site.js` (site releases) does the same render and copy, then runs `checkSitePackage`; `verify-site.js` fetches every staged file after the deploy and checks that `latest.json` still announces the desktop version.

**The shell block is generated.**

- The `<style>` block between `/* shell:css:begin */` and `/* shell:css:end */`, and the markup between `<!--shell:header:begin-->` / `end` and `<!--shell:footer:begin-->` / `end`, are copies written by `website/scripts/sync-desktop-shell.js` from `website/shared/shell.css` and `website/shared/partials.js`. Edit those sources, then run `npm run sync:shell -w website`. `npm run build:site` runs `check:shell` first and fails when the copy is stale.
- `shell.css` must stay free of `url()` and `@import` (its own header says why: the page is staged flat and ships only the files it already has). So no web fonts beyond the Google Fonts `<link>` already in the page head, and no background images.
- The page's own styles (hero, cards, screenshots, band, prose) are an inline `<style>` after the shell block. `website/shared/page.css` is not inlined there; the desktop page keeps its own copies of the few primitives it uses. New sections (feature tour, AI section, compare teaser) need their CSS added inline in the desktop page, scoped so nothing in the shell changes.

**The Linux markers.**

- `<!--linux:begin-->` / `<!--linux:end-->` wrap three blocks: the hero sentence fragment, the hero Linux download line (with `@@LINUX_URL@@` and `@@LINUX_MB@@`) and the Install card. `lib/publish-checks.js#renderLinuxPage` fills or removes them; `checkSitePackage` fails if a placeholder survives. New copy must not split, nest or move these blocks, and must not mention Linux outside them (a release without a Linux build removes them).

**The download script.**

- The inline script at the bottom rewrites `[data-dl]` buttons, `[data-min]` lines, `[data-version]` and `[data-notes]` from `latest-darwin-aarch64.json`, `latest-windows-x86_64.json` and `latest.json`. Keep those hooks, the manifest names and the cache-buster. No module script, no external script: the page promises "no third-party scripts". New sections must not reuse those `data-` attributes.

**Where it is previewed.**

- `website/shared/vite-plugin.js` serves the desktop page at `/mikedown/` in `npm run dev:site` and `vite preview`, rendered with no Linux block and with the fallback button hrefs (no manifests locally). That is the review surface for M3 and M4.
- `website/test/links.test.ts` checks every internal link in the built site and in the desktop page source. A link to a page that is not built (for example `/mikedown/compare/` before M2 lands) fails it.

[Return to Top](#desktop-site-redesign-plan)

---

## Audit: building and packing a compare page

What a new `website/compare/index.html` needs, confirmed from the files.

**Build (Vite).** `website/vite.config.mjs` lists pages by hand under `build.rollupOptions.input`; add `compare: page('compare')`. The page uses the shell markers `<!--shell:header page="compare"-->` and `<!--shell:footer-->` (`website/shared/partials.js#applyShellMarkers` fills them) and loads `shared/shell.css` and `shared/page.css` like `website/vscode/index.html` does. Assets land in `site-assets/` (`assetsDir`). No JavaScript is needed for a static table.

**Navigation.** `partials.js` has a fixed `PAGES` array (Desktop, VS Code, Developers) that renders every header, including the desktop page's synced copy. Adding a Compare entry changes the header on all four pages and needs `npm run sync:shell -w website` afterwards, or `check:shell` fails the build. The footer (`renderFooter`) is a separate list; a Compare link there is cheap. Whether Compare goes in the main nav is OQ2; at 360 px the nav already holds three links plus GitHub, so the worker checks wrapping before deciding.

**Pack (site-only release).** `packages/desktop/deploy/lib/site-checks.js` rejects any top-level folder that is not in `SITE_TOP_DIRS = ['vscode', 'developers', 'site-assets']`. Add `'compare'`, and add `compare/index.html` to `SITE_REQUIRED` so a build that drops the page cannot ship. Update `packages/desktop/test/unit/release-pipeline.test.ts`, which covers `checkSitePackage` (the site-checks header names it). `stage-site.js` and `verify-site.js` walk the folder and need no change. `pack-for-lymedeploy.sh --site` only validates extensions: the site package adds content types for `js`, `css`, `jpg`, `svg`, `woff2` and so on, and `site-checks.js` warns on anything outside `html js css png jpg jpeg ico txt json gif` because iadev-prod may not serve it. Use PNG or JPG images and inline SVG; no `.svg` or `.webp` files, no self-hosted fonts.

**Docs.** `packages/desktop/deploy/README.md` ("Publishing the website without a desktop release") and `CLAUDE.md` (Releasing, Website) both list the packed folders as `vscode/`, `developers/`, site assets and the desktop `index.html`; add `compare/` to both. `website/package.json#description` says the same in one line.

**Tests.** `website/test/links.test.ts` picks the new page up on its own (it walks `website/dist`). A small test in `website/test/` that reads `website/compare/index.html` and asserts the row and column counts, and that every `Host must provide` cell has a note, keeps the table honest after edits (M2).

[Return to Top](#desktop-site-redesign-plan)

---

## Needs Mike's check

Cells the audit could not settle from excerpts. Mike answers these in M1; the compare page and the Desktop copy follow his answers.

- **C1. Web component and AI.** Mike's example was "the web component has no AI interactivity yet". The code says `<mikedown-editor>` has an `ai` property (`packages/web-component/src/element.ts:358`, README Properties table) and the site demo wires the stub host to it (`website/developers/web-component/form.js:12`). The matrix says "Host must provide" for all four npm packages. If Mike means something narrower (no AI from the CDN or no-build path, since a property cannot be set from an attribute; or that no real host exists outside the demos), the cell note should say that instead. Which wording?
- **C2. React and Vue dictionary URL.** Angular has a `spellcheckDictionaryUrl` input. The audit did not confirm the option name on `@mikedown/react` and `@mikedown/vue` (it is probably passed through to `bindMikeDownValue` options). Confirm before the compare page names it.
- **C3. Sidebar in the wrappers.** `features.sidebar` is off by default and Angular spreads `this.features` over `{ sidebar: false }`, so it can be turned on. Confirm the Outline and Properties sections are usable without any host method, so "Partial" is right and not "Host must provide".
- **C4. Backlinks in the wrappers.** The host interface has no backlinks method; the VS Code adapter pushes them with `handle.setBacklinks`. Confirm that handle method is public for wrapper authors; otherwise the wrapper cell is "No".
- **C5. Version history wording.** Snapshots happen only for files inside the window's open folder; a lone-file window never snapshots (`versioning.ts` header). Confirm the page says "in a folder" rather than "on every save".
- **C6. Export wording.** Both apps make PDFs through the OS print dialog (Save as PDF). Confirm "Export to HTML or PDF" stays, or becomes "Export to HTML, print or save as PDF".
- **C7. Auto-update on Linux.** The matrix marks Desktop "Partial" because the AppImage does not update itself. Confirm that footnote is wanted on the compare page, since the desktop page's Linux copy can disappear in a release without a Linux build.
- **C8. Settings and toolbar persistence in the wrappers.** Marked "Partial" because saving needs `host.saveSettings`. Confirm, or rename to "Host must provide" so the two rows match the others.
- **C9. Angular `ai` input on npm.** The input exists in the tree; confirm the published `@mikedown/angular` 0.3.0 was built from it, so the compare page does not promise something the registry does not have.
- **C10. Spellcheck in VS Code.** `spellCheck.enabled` defaults to false (`src/settings.ts:144`). Confirm "Partial, off by default" is how Mike wants it shown, or "Yes" with a note.
- **C11. The Wikilinks and tags row.** Added by the audit because both apps do it and the wrappers need a host. Keep or drop.

[Return to Top](#desktop-site-redesign-plan)

---

## Open Questions for Mike

- **OQ1. Where the chart lives.** Recommended: its own page at `website/compare/` (built by Vite, linked from all three product pages). The alternative, a section on the Desktop page, would duplicate on the VS Code and Developers pages or be hard to find from them, and a six-column table does not fit the Desktop page's inline-CSS budget well. Confirm.
- **OQ2. Main nav or links only.** Recommended: a footer link on every page plus an in-page link from each product page's band, and a nav entry only if it still fits on one line at 360 px (the worker measures). The page title suggestion is "Compare", with the H1 "Which MikeDown?".
- **OQ3. Hero tagline.** Keep "A free WYSIWYG markdown editor for macOS and Windows ... Double-click a .md file, or open a folder of notes, and write", or add one short line about AI below it? Recommended: keep the tagline; AI gets its own section with the Experimental badge, and the first feature group stays about writing.
- **OQ4. Order of the tour.** Recommended: Writing, Files and folders, Version history, Export, Multi-window, AI. AI last because it is experimental and off by default. Confirm or move it up.
- **OQ5. Which AI screenshots.** Recommended three: (a) the Rewrite popover on a selection with a streamed result, (b) the AI Engines page with a local card showing Running (LM Studio or oMLX) after one-click setup, (c) Suggest properties chips in the Properties panel, or the Summarize callout. Light mode for (a) and (b), dark for (c), 2000 by 1250 like the existing shots. Confirm the three and the engine.
- **OQ6. Compare page format on phones.** Recommended: at under 720 px each feature row becomes a card with four labelled cells, so there is no horizontal scroll (a scrolling table wrapper would pass the page check but is hard to read). Confirm.
- **OQ7. Site release number.** `0.4.0-site.1` once Desktop 0.4.0 is live. If the site must go out before 0.4.0 is published, `--site` would re-render the page for 0.3.0 while the copy describes 0.4.0 features, so the plan assumes 0.4.0 ships first. Confirm.

[Return to Top](#desktop-site-redesign-plan)

---

## Rules for every worker

- Work on `develop`, no branches. Commit completed milestones with a plain message; no AI attribution anywhere in git. Never push; never touch the Desktop release commits or any `latest*.json`.
- Read [Audit: Desktop page constraints](#audit-desktop-page-constraints) before editing `website/mikedown-desktop/index.html`. Do not edit anything between the `shell:*` markers by hand; edit `website/shared/shell.css` or `partials.js` and run `npm run sync:shell -w website`. Do not move or split the `linux:*` markers. Do not change the `data-dl`, `data-min`, `data-version` or `data-notes` hooks or the script.
- Screenshots are PNG, bare file names, next to the page, referenced with `src=`.
- AI copy says what the apps do and nothing about any provider's retention or training. Reuse the sentences in `packages/core/src/ai/privacy.ts` and the page's existing Privacy paragraph; link to the Privacy section rather than restating it.
- No new fonts, no `url()` in the shell, no `.svg` or `.webp` files, no external scripts. Inline SVG is fine.
- Acceptance checks for every milestone that touches a page: 360 px wide in Chrome device mode, light and dark (the shell follows `prefers-color-scheme`), no horizontal scroll, `npm run build:site` passes, `npx vitest run --config website/vitest.config.mjs` passes, and from M2 on `packages/desktop/deploy/pack-for-lymedeploy.sh --site --site-n 1 --dry-run` passes.
- Log every milestone in [Progress Log / Notes](#progress-log--notes): commit, minutes, what was checked, anything left for Mike.

[Return to Top](#desktop-site-redesign-plan)

---

## M1 Comparison matrix: data and Mike's review

**Recommended model: none needed for the data** (the audit above is the draft). Mike reviews; a Sonnet worker applies his answers.

- [ ] Mike answers C1 to C11 in [Needs Mike's check](#needs-mikes-check) and OQ1, OQ2, OQ6 and OQ7.
- [ ] Update the matrix in this plan with the answers (cell values and notes), and strike the resolved checks.
- [ ] Decide the final row list (drop or keep Wikilinks and tags, C11) and the final column labels. Suggested labels: Desktop, VS Code extension, Web component, React / Vue / Angular.
- [ ] Decide the per-cell marks: plain words (Yes, Partial, Host must provide, No) with a small icon, never color alone (the compare page must read in grayscale and to a screen reader).
- [ ] Write the footnotes the page will carry: experimental and off-by-default AI; VS Code's own tree, tabs, search and Marketplace; the Linux AppImage; what "Host must provide" means in one sentence with a link to the Developers hub's "Bring your own AI" and "Toolbar layout" sections.

Acceptance: the matrix in this plan has no cell left in the check list, and Mike has said "go" on OQ1.

[Return to Top](#desktop-site-redesign-plan)

---

## M2 Compare page

**Recommended model: Opus** (a dense table that has to read well at 360 px and in both themes; the page is the one place all four products meet).

- [ ] Create `website/compare/index.html` from the structure of `website/vscode/index.html`: `<head>` with the shared favicons and Google Fonts link, `shared/shell.css` and `shared/page.css`, the `<!--shell:header page="compare"-->` and `<!--shell:footer-->` markers, a `<main id="main">`.
- [ ] Content: a short hero ("Which MikeDown?" and one paragraph: the same editor in four forms, where each runs, who it is for), the matrix as a real `<table>` with `<th scope>` on rows and columns and a caption, the legend above it, the footnotes below it, and a closing band with the four calls to action (download Desktop, Marketplace, Developers hub, GitHub).
- [ ] Page CSS in `website/compare/compare.css`: the table at desktop width; under 720 px each row becomes a card with the feature name as its heading and four labelled cells (OQ6). Marks are words with an inline SVG icon; the icon never carries the meaning alone. Check both themes against the shell tokens (`--bg`, `--bg-raised`, `--text`, `--muted`, `--accent`, `--border`).
- [ ] `website/vite.config.mjs`: add `compare: page('compare')` to `rollupOptions.input`.
- [ ] `website/shared/partials.js`: add a Compare link to `renderFooter`. Add it to `PAGES` only if OQ2 says so and it fits on one line at 360 px; then run `npm run sync:shell -w website` and commit the regenerated desktop page markup.
- [ ] `packages/desktop/deploy/lib/site-checks.js`: add `'compare'` to `SITE_TOP_DIRS` and `compare/index.html` to `SITE_REQUIRED`; extend `packages/desktop/test/unit/release-pipeline.test.ts` (a package with `compare/index.html` passes; one with a stray top-level folder still fails).
- [ ] Docs: `packages/desktop/deploy/README.md` (site-only section), `CLAUDE.md` (Releasing, Website) and `website/package.json#description` name `compare/` among the packed folders.
- [ ] `website/test/compare.test.ts`: reads the page source, asserts the expected rows and columns, that every cell is one of the five legend values, and that each Partial or Host must provide cell has a note or footnote reference.
- [ ] Add the page to `website/test/links.test.ts` only if it does not pick it up on its own (it walks `website/dist`).

Acceptance: `npm run build:site` emits `website/dist/compare/index.html`; the website vitest run passes; `pack-for-lymedeploy.sh --site --site-n 1 --dry-run` reports the compare folder in the package and no problems; the page passes 360 px, light and dark, no horizontal scroll in `npm run dev:site` at `/mikedown/compare/`.

[Return to Top](#desktop-site-redesign-plan)

---

## M3 Desktop page: feature tour and AI section

**Recommended model: Opus** (copy and layout on the product's front door; it has to stay calm, scan well, and respect the staging constraints).

Section order after this milestone: Hero (unchanged apart from OQ3), Feature tour, AI, Screenshots, Compare teaser, Also for VS Code, Install, Release notes, Privacy.

- [ ] Replace the three cards with a **feature tour**: six groups, each a heading, two or three sentences and a short list. Reuse the existing `.grid` and `.card` styles where they fit; add inline CSS for a two-column "group" layout that stacks at 720 px. Copy sources: `packages/desktop/deploy/release-notes/0.2.0.md` to `0.4.0.md`, the module headers in `packages/desktop/src` and `src-tauri/src/commands`, and the matrix notes.
  - **Writing:** WYSIWYG with a source mode toggle, tables, callouts, math, Mermaid, emoji, footnotes, slash commands, find and replace, spellcheck (dictionaries included), outline, properties, backlinks, wikilinks and tags, light and dark.
  - **Files and folders:** the file tree, tabs, split panes each with their own tabs and sidebar, folder-wide search (plain text, case and whole-word options), image paste saved next to the note, external change detection, hot-exit backups.
  - **Version history:** a snapshot on every save inside an open folder in `.mikedown/versions/`, side-by-side diff, one-click restore, pruning by count and size (C5 wording).
  - **Export:** standalone HTML, print, PDF through the system print dialog (C6 wording), copy as rich text.
  - **Multi-window:** as many windows as folders; New Window from File, from the Dock icon's menu on macOS and from the taskbar's right-click menu on Windows; Open Containing Folder on a file from outside the open folder opens that folder in its own window; files from the OS land in the window that already has their folder.
  - **AI (experimental):** one card that points down to the AI section.
- [ ] Add the **AI section** (`id="ai"`), with an Experimental badge (match the shell's accent tokens; the apps use the same word). Four short blocks:
  - What it does: rewrite a selection (length, tone, audience), explain, translate, summarize, suggest a title and properties; every AI edit is one undo step.
  - Off until you turn it on: nothing is visible and nothing is sent until you set up an engine (wording from the 0.4.0 notes).
  - Local first: Desktop finds a server you already run (oMLX, LM Studio, Ollama and others) and sets it up in one click; a local engine keeps everything on your machine or your network (`AI_CLOUD_PRIVACY.local`).
  - Cloud, opt in: Anthropic, OpenAI and other providers are available after you turn on cloud engines; the first request in a folder asks you and says what it sends; keys stay in your system keychain; each provider's policy is linked where you add the engine. End with a link to `#privacy`. No retention or training claims.
- [ ] Add the screenshot figures for M4's images to the Screenshots section (placeholders are not allowed in a commit; M3 lands the markup only when M4's PNGs exist, otherwise M4 adds the figures).
- [ ] Add a **compare teaser**: one short band above "Also for VS Code" ("The same editor, four ways" plus a link to `/mikedown/compare/`). Lands with or after M2, never before, because of the link test.
- [ ] Update `<meta name="description">` and the header comment of the page if the section list changes.
- [ ] Keep every constraint in [Audit: Desktop page constraints](#audit-desktop-page-constraints). Run `npm run check:shell -w website` after editing.

Acceptance: `npm run dev:site` at `/mikedown/` passes 360 px, light and dark, no horizontal scroll; `npm run build:site` passes (`check:shell` included); `node packages/desktop/deploy/render-page.js --in website/mikedown-desktop/index.html --out /tmp/x.html --version 0.4.0` runs with and without `--linux` and both outputs are free of `@@LINUX`; the website vitest run passes; the dry-run pack passes.

[Return to Top](#desktop-site-redesign-plan)

---

## M4 AI screenshots

**Recommended model: Mike takes the shots; Sonnet adds the figures.** The existing Desktop shots were taken by hand at 2000 by 1250 (the `listing-screenshots` skill covers the VS Code listing, not Desktop).

- [ ] Set up a local engine in a Desktop 0.4.0 build (oMLX or LM Studio on the Mac Studio, or Ollama) on the sample folder used for the existing shots, so the tree and documents match.
- [ ] Take the two or three shots from OQ5: `screenshot-ai-rewrite.png`, `screenshot-ai-engines.png`, `screenshot-ai-properties.png` (or `screenshot-ai-summary.png`). 2000 by 1250, PNG, no key or personal path visible, the Experimental badge in frame where it appears.
- [ ] Put them in `website/mikedown-desktop/` and add the `<figure class="shot">` entries with real `alt` text and captions. Give the AI figures their own subheading inside Screenshots or place them in the AI section (the worker picks what reads better at 360 px).
- [ ] Check the page weight: the four existing PNGs plus three new ones; if the total passes about 6 MB, re-encode the new ones (still PNG) or crop.

Acceptance: `node packages/desktop/deploy/check-upload.js` style check is covered by the dry-run pack (every `src=` PNG present); the figures pass 360 px, light and dark.

[Return to Top](#desktop-site-redesign-plan)

---

## M5 Links from the VS Code and Developers pages

**Recommended model: Sonnet** (small, mechanical edits in three HTML files and the shared partials).

- [ ] `website/vscode/index.html`: in the closing band ("Also as a desktop app" / "For developers"), add a link to `/mikedown/compare/` ("Compare the four"), and one sentence in the hero or "What you can do in it" that the AI tools are also in the extension, pointing to the README's AI section (no new AI section on this page in this plan).
- [ ] `website/developers/index.html`: a link to the compare page under "Which package do I need?" ("How the packages compare with the apps"), and in "Bring your own AI" one sentence that the apps ship their own engines while the packages take a host.
- [ ] `website/mikedown-desktop/index.html`: the compare teaser from M3 and the footer link from M2 (regenerated by `sync:shell`).
- [ ] If OQ2 chose a nav entry, this milestone verifies the header on all four pages at 360 px after the sync.

Acceptance: `website/test/links.test.ts` passes on a fresh `npm run build:site`; the three pages pass 360 px, light and dark, no horizontal scroll.

[Return to Top](#desktop-site-redesign-plan)

---

## M6 Site-only publish and verification

**Recommended model: Sonnet for the checks; Mike runs the real publish.**

- [ ] Preconditions: Desktop 0.4.0 is published (`latest.json` on the site announces 0.4.0), M2 to M5 are committed on `develop`, and the working tree is clean.
- [ ] `npm run build:site` from the repo root (builds the packages, Vite pages and the Angular demo).
- [ ] `npx vitest run --config website/vitest.config.mjs` (links, mounts, stub AI, the new compare test).
- [ ] `packages/desktop/deploy/pack-for-lymedeploy.sh --site --site-n 1 --dry-run`. Read the staged folder list: `index.html`, the seven PNGs, `vscode/`, `developers/`, `compare/`, `site-assets/`, `favicon.ico`; no `latest*.json`, no artifact, no `web.config`. Confirm the rendered `index.html` has the Linux blocks filled or removed as the live release has them (`--site` reads the published version; pass `--linux` or `--no-linux` to match).
- [ ] Mike: the same command without `--dry-run`. It pushes, releases, deploys and runs `verify-site.js`, which fetches every file and checks `latest.json` still says 0.4.0.
- [ ] After the deploy: open https://www.iadev.net/mikedown/, `/mikedown/compare/`, `/mikedown/vscode/` and `/mikedown/developers/` on a phone and a desktop, light and dark; confirm the download buttons still rewrite from the manifests (version line and notes appear) and the new PNGs load.
- [ ] Commit `Website: Desktop feature tour, AI section and compare page` if anything changed during the publish, and note the site version in `RESUME.md`.

Acceptance: `verify-site.js` reports every file identical and the desktop version unchanged; the four pages pass the phone and theme checks live.

[Return to Top](#desktop-site-redesign-plan)

---

## Parallel Development Recommendations

| Group | Milestones | Why |
|---|---|---|
| A (first) | M1 | Everything else uses the settled matrix and OQ1. |
| B (parallel) | M2, M3, M4 | Different files: `website/compare/` plus the deploy gate; the desktop page body; the PNGs. M3's compare teaser and M4's figures are added last, after M2's page exists. One rule: only one worker edits `website/mikedown-desktop/index.html` at a time (M3 first, then M4's figures). |
| C | M5 | After M2 (the link target must build). |
| D | M6 | After everything, and after Desktop 0.4.0 is live. |

Nothing here touches `packages/core`, `src/` or the Desktop app, so it can run beside other work on `develop`. If OQ2 chooses a nav entry, M2 and M5 share `partials.js`; do them in sequence.

[Return to Top](#desktop-site-redesign-plan)

---

## Progress Log / Notes

**2026-10-30** - Plan written from a code audit (no page changes yet). Findings that shape the work: the web component and all three wrappers accept an AI host today (`ai` property or input, `host.ai`), so the chart says "Host must provide", not "No" (C1 for Mike); the site package gate (`lib/site-checks.js`) only allows `vscode/`, `developers/` and `site-assets/` at the top level, so a compare page needs that list and its test extended; the desktop page's image check only recognises bare `.png` names in `src=`; the shell header and footer on the desktop page are regenerated by `sync:shell`, so a nav change is a four-page change. Nothing committed beyond this plan and the pointers in `RESUME.md` and `BACKLOG.md`.
