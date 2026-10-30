# MikeDown Backlog

Ideas and feature requests for future versions. Not a roadmap — just a parking lot. Pull from here when planning a release.

## Features

- **Desktop site redesign (do soon).** AI section, full feature tour and a where-is-each-feature comparison chart. Plan: `desktop-site-redesign-plan.md`. Ships as a site-only release after Desktop 0.4.0. _From the 2026-10-30 session._
- **Review the local AI blog post before linking it.** "Your own computer can run AI" is drafted at `website/blog/local-ai/` (blog index at `website/blog/`). It isn't linked from the footer or any page yet. Mike may edit it or split it into a few posts. Check the claims not backed by the code: "using it for months," the speed wording, 30B vs 8B, the LM Studio/Ollama steps, and the 4-bit download size. Then add the footer link back (`website/shared/partials.js` `renderFooter`, then `npm run sync:shell -w website`). The site-only pack still uploads `blog/`, so the page is reachable by URL. _From the 2026-10-30 session._
- **Blog post: "Why Markdown? Why MikeDown?"** Start with an interview with Mike (one question at a time), then write the post. Why Markdown:
  - it's the de facto language for talking to AI
  - it reads fine in any plain text editor
  - it's lighter on tokens than Word, HTML or other markup
  - it's a standard many tools read (MikeDown among them)

  Why MikeDown:
  - free and open source, where much of the competition isn't
  - possibly that a major competitor is a Chinese entity, a concern for sensitive documents (Mike is undecided whether to mention it; check the facts first)
  - anything else the interview turns up

  Touch on local AI and link the local AI post. _From the 2026-10-30 session._
- **Definition lists** — `term\n: definition` (pandoc / PHP Markdown Extra).
- **Custom containers** — `:::note ... :::` style (VuePress / MkDocs).
- **Image captions** — render alt text or title as a `<figcaption>` under images.
- **PDF export bookmarks** (#11). Exported PDFs should carry a bookmark outline from the headings. Export goes through Chromium print today, which doesn't reliably emit an outline, so this likely means post-processing the PDF or generating it ourselves.
- **Inline footnotes** — the `^[text]` form (reference footnotes shipped in 2.14.0).
- **PlantUML / D2 diagram** support (less common than Mermaid).
- **AI Recipes (user-defined prompt templates).** Let users define a recipe that takes a kind of document, asks the model for a specific structure back, and runs a follow-up action. A recipe is a markdown file with frontmatter (name, document-type hint, prompt, output template as headings or a JSON shape), stored per user or per workspace (e.g. `.mikedown/recipes/*.md`). Run it from the AI menu or `/recipe` through the existing router and `documentBudget`. Follow-up actions come from a fixed list only: insert at cursor, replace selection or document, append a section, set frontmatter properties, save as a new file (no shell, no URLs). A workspace recipe can only change the prompt, never the endpoint, and may need a first-run confirmation. Ship a few built-ins (meeting notes to action items, bug report triage) as examples. Properties Suggest (`ai/json.ts` plus apply chips) is the existing pattern to generalize. _From the 2026-10-29 session._

## Polish

- **Buy Me A Coffee link in Settings → About tab.** Needs a final BMAC URL. The About tab (`src/webview/vsCodeSettingsSections.ts`, copy in `src/supportCopy.ts`) already has GitHub / changelog / issue links — add a BMAC link there once the URL exists.
- **Support card photo avatar.** Replace the "M" initial in the "A note from Mike" support card's avatar slot with a small photo of Mike. Needs an image asset shipped in the bundle (webview `localResourceRoots`, `asWebviewUri`) and a CSP check that `img-src` allows `${webview.cspSource}`. No card redesign needed — the slot is already built for it (`avatar: { kind: 'image', src, alt }` in `src/webview/supportCard.ts`). _From the review appeal follow-ups, 2026-09-26._
- **Review appeal: 30/60 day measurement check-in.** Re-run `npx @vscode/vsce show interapp.mikedown-editor` and record installs, rating, and review count here. Baseline at 2.11.0 release (2026-09-26): 391 installs, 5 reviews, 5.00 rating, 982 lifetime downloads.
  - [x] 30 days (checked 2026-10-28): 448 installs, 6 reviews, 5.00 rating.
  - [ ] 60 days after the 2.11.0 release (2026-11-25)
- **Webview type-safety warnings.** ~945 `no-unsafe-*` / `no-explicit-any` warnings, downgraded from errors in 2.11.0.

## Core extraction follow-ups

- **M8 hands-on** of `angular-core-extraction-plan.md`: Quantico Creek image upload is code-complete, hands-on pass pending.
- **Publish dictionaries separately** (e.g. `@mikedown/dictionaries`) instead of copying them into core `dist`.
- **Content width setting is not persisted by VS Code** (setting round-trip gap in the host).
- **Shared module singletons across two editors**: the portal mirrors the last-focused editor and the Mermaid theme init is global, and turning `math` off in one editor's `features` turns KaTeX off for every editor on the page.
- **Fixed-position overlays under transformed ancestors** misplace when a host wraps the editor in a CSS transform.

## npm packages and wrappers follow-ups

Deferred in `docs/wrappers-decisions.md` (M0 of `docs/wrappers-npm-plan.md`).

- **Provenance via npm trusted publishing.** Publish from GitHub Actions with OIDC (`id-token: write`, npm CLI 11.5.1+, 11.21+ to move dist-tags) so every package gets a provenance statement. Builds on the M1 `ci.yml`; local publishes cannot attest.
- **Trim the CDN bundle's code languages.** lowlight `common` instead of `all` cuts the standalone bundle from about 757 to 511 kB gzipped. Needs a core `codeLanguages` option so the language picker lists the same set.
- **Typedoc API reference** for core and the wrappers, generated from the `.d.ts` and linked from the Developers hub.
- **Blazor wrapper.** The web component already works in Razor pages; a typed Blazor component with `@bind-Value` would be the wrapper.
- **Svelte wrapper** (M10, deferred). The web component covers Svelte.
- **Solid and Preact wrappers.** Covered for now by the web component (Solid) and `preact/compat` with `@mikedown/react`.
- **`@mikedown/core/styles-base.css`** (no KaTeX `@import`), only needed if `katex` ever goes back to an optional peer.

## Release history

See [CHANGELOG.md](CHANGELOG.md).
