# Core Extraction Decisions (M0)

Output of M0 in `angular-core-extraction-plan.md`. Every decision below was checked against the repo or a spike run on 2026-10-22. Each section ends with **What changes in the plan**.

**Gate:** M1 does not start until Mike approves this file.

## 1. Package name and registry

- `npm view @mikedown/core` returns 404, `npm org ls mikedown` returns "Scope not found", a registry user lookup for `mikedown` finds nothing, and a scope search returns zero packages. **The `@mikedown` scope is free.**
- **Decision:** publish as **`@mikedown/core`**, public, MIT. Creating the scope means creating a free npm org named `mikedown` on npmjs.com under Mike's npm account. Scoped packages publish private by default, so the first publish needs `npm publish --access public` (or `"publishConfig": { "access": "public" }` in the package).
- **Publishing account:** `npm whoami` returns `ENEEDAUTH` on this machine. Mike must run `npm login` once, then create the `mikedown` org, before M4 publishes.
- **Fallback (no public publish):** `npm pack` tarballs dropped in `/Volumes/Storage/LymeStack/packages/npm/` and consumed as `"@mikedown/core": "file:/Volumes/Storage/LymeStack/packages/npm/mikedown-core-0.1.0.tgz"`. This mirrors the folder NuGet feed in `~/git/lymestarter/framework-package-design.md`. Downside: every consumer needs the share mounted at install time, and Windows uses the UNC path, so the `file:` path differs per machine.

**What changes in the plan:** nothing structural. M4 gains two prerequisites for Mike (npm login, create the `mikedown` org) and `publishConfig.access: public`.

## 2. Angular 14 / TS 4.7 spike

**Setup:** `npx @angular/cli@14 new spike --minimal`, Node 18 via Volta (Angular 14 does not support Node 22), TypeScript 4.7.4, `@angular-devkit/build-angular` 14.2.13 (the webpack `browser` builder, same as Quantico Creek). Added `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/pm` (3.20+), `tiptap-markdown` 0.9, `@codemirror/state`, `@codemirror/view`, `katex`, `lowlight`, `mermaid` 11, `nspell`. One component imports and **runs** all of them: TipTap with the Markdown extension, a CodeMirror view, KaTeX render, lowlight highlight, Mermaid render, nspell.

**Results, in order:**

| Run | Change | Result |
|---|---|---|
| 1 | as generated (no `skipLibCheck`) | 222 errors. 202 in `@types/node`, 15 in `@types/d3-dispatch`, 2 in TS lib, 1 in `@tiptap/core` (TS2380 get/set accessor), 1 in `prosemirror-markdown` (TS1259 default import), 1 missing types for `nspell` |
| 2 | `skipLibCheck: true`, `declare module 'nspell'` | 59 errors: 50 in `@types/node/ffi.d.ts`, 9 in `@types/d3-dispatch`. These are **parse** errors (TS 5 syntax), which `skipLibCheck` does not suppress |
| 3 | pin `@types/node` 18.19.130 (what Quantico Creek already uses) | 9 errors, all `@types/d3-dispatch` |
| 4 | pin `@types/d3-dispatch` 3.0.6 | TypeScript clean. Only error is the Angular budget (initial 2.89 MB vs 1 MB) |
| 5 | raise the budget | **Build succeeds** |
| 6 | Mermaid via dynamic `import()` | Build succeeds, initial bundle drops |

**Where each error comes from:**

- **`@types/node`:** not caused by MikeDown. Angular 14's own `rxjs` typings reference `node`, and a fresh install today pulls `@types/node` 26, which uses TS 5 syntax. Quantico Creek pins `@types/node` 18.19.130, so it does not hit this.
- **`@types/d3-dispatch` 3.0.7:** pulled in by `mermaid` → `@types/d3`. It uses TS 5.0 `const` type parameters, a parse error under TS 4.7. It only loads when the app's program imports Mermaid's types. If `@mikedown/core`'s published `.d.ts` never imports from `mermaid`, a consumer never loads `@types/d3` and needs no pin.
- **`@tiptap/core` TS2380 and `prosemirror-markdown` TS1259:** type-check errors in `.d.ts` files, suppressed by `skipLibCheck`. Quantico Creek already has `skipLibCheck: true`, `esModuleInterop` and `allowSyntheticDefaultImports`.
- **`nspell`:** ships no types. The core's public `.d.ts` must not reference it.

**Runtime check:** served `dist/` and loaded it in headless Chrome. TipTap with tiptap-markdown parsed and re-serialized markdown correctly. KaTeX, CodeMirror, lowlight and the Mermaid SVG all rendered. tiptap-markdown resolved to its ES build with **no alias**, because its `package.json` has an `exports` map whose `import` condition points at the ES file.

**Bundle sizes (production):**

| Variant | Initial raw | Initial transfer |
|---|---|---|
| Mermaid imported statically | 2.89 MB | 701 kB |
| Mermaid via dynamic `import()` | 2.15 MB | 545 kB |

**Conclusion: compatible with `skipLibCheck`**, provided two rules hold in the core's published types:

1. The public `.d.ts` exposes no `mermaid`, `nspell` or `katex` types (own small option types instead).
2. A TS 4.7 consumer fixture compiles against the published `.d.ts` in T2, so a TS 5-only construct in our own declarations is caught.

Pre-bundling TipTap into a self-contained build is **not required**.

**What changes in the plan:** M4 does not need to pre-bundle TipTap. M4's `.d.ts` must follow the two rules above. T2 adds a TS 4.7 type-check fixture. M6 does not need `@types/node` or `@types/d3-dispatch` pins as long as rule 1 holds. If it does not, the fallback is an `overrides` entry for `@types/d3-dispatch` 3.0.6 in Quantico Creek. M6 needs Node 18 (or 16) for the Angular 14 CLI.

## 3. Angular 19 build spike

**Setup:** `rsync` copy of `~/git/lymestarter/ng-app` into the scratchpad (no `node_modules`, no `dist`), `git init`, throwaway branch `spike-mikedown`, `npm ci`. Nothing in `~/git/lymestarter` was touched. Added the same packages and a standalone component behind a lazy route (`/md-spike`, `loadComponent`), the realistic shape for a feature screen.

**Results:** `ng build` (application builder, esbuild, TS 5.5, `skipLibCheck: true` already set) **succeeds with no errors** and no pins. Warnings only: CommonJS modules (`nspell`, and Mermaid's `dayjs`, `cytoscape-fcose`, `@braintree/sanitize-url`) and the template's existing budget warnings.

| Measure | Baseline | With spike route | Delta |
|---|---|---|---|
| Initial total, raw | 1.24 MB | 1.24 MB | about 0 |
| Initial total, transfer | 262.58 kB | 263.13 kB | +0.55 kB |
| Lazy `md-spike` chunk | n/a | 1.88 MB raw, 464 kB transfer | new |
| `dist/` on disk | 3.7 MB | 9.1 MB | +5.4 MB, mostly Mermaid diagram chunks |

A runtime load of `/md-spike` was attempted but the LymeStack shell waits on its API during bootstrap, so the page never reaches the route without a backend. The Angular 14 run covers runtime behavior.

**What changes in the plan:** nothing. M5 and M9 can use the editor behind a lazy route with no toolchain changes.

## 4. Core build tool

**Decision: `tsup`** (esbuild) for the JS bundle and `.d.ts`, plus a plain copy step for the CSS files.

- **Why not vite library mode:** it works, but needs `vite-plugin-dts` for declarations and adds a second config style. `vite` stays useful for the demo page in M4 (dev server only).
- **Why not a second webpack config:** slowest to write and maintain, and produces worse ESM output.

**Externals and dependencies:**

| Package | How | Why |
|---|---|---|
| `@tiptap/*` (core, pm, starter-kit and the 13 extension packages) | **peer**, external | The app must have exactly one ProseMirror. Duplicates break `instanceof` checks |
| `@codemirror/*` (state, view, commands, language, lang-markdown, theme-one-dark) | **peer**, external | Same reason. CodeMirror refuses to run with two copies of `@codemirror/state` |
| `mermaid` | **optional peer**, external, loaded with dynamic `import()` only when enabled | Saves about 740 kB raw from the consumer's initial bundle |
| `katex` | **optional peer**, external, dynamic `import()` when math is on | Same pattern. Consumer also loads `katex/dist/katex.min.css` |
| `lowlight` | **peer**, external | Large, the app may already use highlight.js |
| `tiptap-markdown`, `markdown-it-*`, `nspell` | **dependency**, external | See below |
| spellcheck dictionaries | static files in `dist/dictionaries/` | Host passes a base URL, spellcheck is off unless the host opts in |

**tiptap-markdown: dependency, not bundled.** The plan suggested bundling it so consumers never need the webpack alias. Both spikes show the alias is not needed by Angular's builders: its `exports` map sends ESM consumers to the ES build. Bundling would also pull `markdown-it` and `prosemirror-markdown` into our bundle or force careful partial externals. If T2 finds a consumer that resolves the UMD file, switch to `noExternal: ['tiptap-markdown']` in `tsup.config.ts`, a one-line change. **The VS Code extension's webpack alias and `mainFields` ordering stay unchanged.**

**VS Code webview CSP:** the extension's webpack build currently forces Mermaid eager because of the webview CSP. Once the core uses dynamic `import()`, the VS Code webpack config must keep a single chunk (`LimitChunkCountPlugin` with `maxChunks: 1`, or `webpackMode: "eager"` comments in the core source).

**`package.json` for `packages/core`:**

```json
{
  "name": "@mikedown/core",
  "type": "module",
  "module": "./dist/index.js",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./styles.css": "./dist/styles.css",
    "./tokens.css": "./dist/tokens.css",
    "./package.json": "./package.json"
  },
  "sideEffects": ["*.css"],
  "files": ["dist"],
  "publishConfig": { "access": "public" }
}
```

The top-level `types` and `module` fields are required, not optional. TS 4.7 with `moduleResolution: node` (Quantico Creek) ignores `exports`. For CSS in Angular 14, the consumer adds `node_modules/@mikedown/core/dist/styles.css` to `angular.json` `styles`, which avoids relying on the Sass resolver honoring `exports`.

**What changes in the plan:** M4 drops "bundle tiptap-markdown". M4 adds dynamic imports for Mermaid and KaTeX, the VS Code single-chunk setting, `peerDependenciesMeta` for the optional peers, and top-level `types`/`module` fields.

## 5. Feature split: message dispositions

This is the spec for M2. One rule decides most rows:

- **Push messages** from the host become **methods on the editor handle** (core API).
- **Request/response pairs** become **async host adapter methods** returning a Promise. The `requestId` plumbing stays inside the VS Code shell.
- An optional host method that is absent turns its feature off and hides its UI.

Covers every type in the `editor-main.ts` header, every `postMessage` call site in `src/webview/`, every `message.type` check in the inbound listener, and every `case` in the provider's `onDidReceiveMessage` switch.

### Host to webview

| Message | Disposition | Core shape |
|---|---|---|
| `update` | core API | `handle.setMarkdown(md, { pristine })` |
| `command` (all toolbar and keybinding names, plus `openSettings` with `tab`) | core API | `handle.command(name, args)` |
| `settings` | core API | `handle.updateSettings(patch)`, a new method not in the plan's handle sketch |
| `theme` (fonts and size) | core API, merged | folded into `updateSettings`. The separate message is dropped |
| `saved` | core API | `handle.markSaved()` resets the pristine baseline |
| `setReadOnly` | core API | `handle.setReadOnly(bool)`. **Today the webview never handles it**, so the host's send at the end of a diff session is a no-op. M2 should wire it |
| `toggleSource` | core API | `handle.command('toggleSource')` |
| `copyAsRichText` | core API | `handle.command('copyAsRichText')` |
| `scrollToAnchor` | core API | `handle.scrollToAnchor(slug)` |
| `revealLinkHref` | core API | `handle.revealLink(href)` |
| `requestExportHtml`, `requestPrint`, `requestViewInBrowser` | core API | `handle.getHtml()`. The VS Code shell calls it and does the export itself, so the request-and-reply round trip goes away |
| `imageFileFound`, `imageFileMissing` | core API | `handle.setImageStatus(src, 'found' or 'missing')`. Only the VS Code file watcher calls it |
| `tags` | core API, knowledge-base | `handle.setTags(tags)`. Only used when the host implements `getTags` |
| `backlinks` | core API, sidebar | `handle.setBacklinks(list)`. Backlinks section shows only when the host pushes data |
| `docMeta` | core API, sidebar | `handle.setDocMeta({ mtimeMs })` for the sidebar footer |
| `sidebarState` | core API, sidebar | `handle.setSidebarState(state)` |
| `diffStatus` | core API | `handle.setDiffAvailable(bool)` |
| `pastedImageResult` | dropped | becomes the Promise result of `host.uploadImage` |
| `pickedImageResult` | dropped | becomes the Promise result of `host.pickImage` |
| `resizeImageResult` | dropped | becomes the Promise result of `host.resizeImage` |
| `linkSuggestions` | dropped | Promise result of `host.getLinkSuggestions` |
| `fileHeadings` | dropped | Promise result of `host.getFileHeadings` |
| `wikilinksResolved` | dropped | Promise result of `host.resolveWikilinks` |
| `brokenLinks` | dropped | Promise result of `host.checkLinks` |
| `diffData` | dropped | Promise result of `host.getDiffBaseline` |
| `showSupportCard`, `supportCopied` | VS Code shell only | support card code (`supportCard.ts`) stays in the shell |

### Webview to host

| Message | Disposition | Core shape |
|---|---|---|
| `ready` | core API | `on('ready')` event. The shell posts `ready` from it |
| `edit` | host adapter | `onChange(markdown, { pristine })` |
| `stats` | host adapter | `onStats?(stats)` |
| `openLink` | host adapter | `openLink?(href, behavior)`. Absent means the core opens external links in a new tab |
| `saveSettings` (with optional `source: 'slashMenu'`) | host adapter | `saveSettings?(patch, { source })`. Absent means settings apply for the session only |
| `savePastedImage` | host adapter | `uploadImage?(file)`. Absent disables paste and drop of images |
| `pickImage` | host adapter | `pickImage?()`. Absent hides `/image` |
| `resizeImage` | host adapter | `resizeImage?(src, size)`. Absent hides the resize popover's save |
| `toggleTheme` | host adapter | `toggleTheme?()`. Absent means the core flips its own theme |
| `getLinkSuggestions` | host adapter | `getLinkSuggestions?()` |
| `getFileHeadings` | host adapter | `getFileHeadings?(path)` |
| `resolveWikilinks` | host adapter | `resolveWikilinks?(targets)` |
| `createWikilink` | host adapter | `createWikilink?(target)` |
| `checkLinks` | host adapter | `checkLinks?(links)` |
| `getTags` | host adapter | `getTags?()` |
| `openTag` | host adapter | `openTag?(tag)` |
| `requestDiff` | host adapter | `getDiffBaseline?()`. Quantico Creek's KB editor already diffs revisions, so this is useful outside VS Code |
| `headingRenamed`, `headingRenameAmbiguous` | host adapter | `onHeadingRenamed?(oldSlug, newSlug)`, `onHeadingRenameAmbiguous?(base)` |
| `exportHtml`, `printDocument`, `viewInBrowser` | host adapter | optional methods taking the HTML, buttons hidden when absent |
| `openKeybindings` | host adapter | `openKeybindings?()`. Hotkeys tab button hidden when absent |
| `sidebarRequestState`, `sidebarSetPref`, `sidebarApplyDefaults`, `sidebarSectionCollapsed` | host adapter | an optional `sidebarPrefs` group. Absent means the sidebar keeps in-memory defaults |
| `toggleSource` | dropped | today it is an echo: the host just posts `toggleSource` back. The core toggles locally |
| `supportCardShown`, `busy`, `supportAction` | VS Code shell only | support card |
| `printReady`, `copyRichText`, `showDiff` | dropped | the host switch handles them but no webview code sends them. Dead cases |

**What changes in the plan:** the `MikeDownHost` and `MikeDownEditorHandle` sketches in the plan's Target architecture grow to cover the rows above. In particular, the handle gains `updateSettings`, `markSaved`, `getHtml`, `scrollToAnchor`, `revealLink`, `setImageStatus` and the sidebar setters. The host gains `pickImage`, `resizeImage`, `checkLinks`, `getFileHeadings`, `createWikilink`, `openTag`, `getDiffBaseline`, `toggleTheme`, `openKeybindings`, the heading-rename callbacks and `sidebarPrefs`. M2 also wires `setReadOnly`.

## 6. Settings ownership

`MikeDownSettings` in the core is the core-owned set. VS Code keeps reading all `mikedown.*` keys and passes the core subset through `updateSettings`.

| Setting | Owner | Note |
|---|---|---|
| `fontFamily`, `headingFontFamily`, `fontSize` | core | today sent as the separate `theme` message |
| content width (`contentWidth`) | core | **Not persisted today.** The modal sends it in `saveSettings`, but there is no `mikedown.contentWidth` in `package.json` and the host ignores it, so it resets on reload. Either fix it in M2 (three-place settings rule) or record it as a known gap |
| `ctrlWheelZoom` | core | |
| `editorTheme` (`auto`, `light`, `dark`) | core | also settable by `options.theme` |
| `linkClickBehavior` | core | passed to `host.openLink` as `behavior` |
| `renderMermaidDiagrams`, `renderMath` | core | also gate the dynamic imports |
| `markdownNormalization`, `normalizationStyle.*` | core | serializer lives in the core |
| `headingNumbering` | core | |
| `spellCheck.enabled`, `.language`, `.ignoreCodeBlocks`, `.userWords` | core | dictionary base URL is a host option, not a setting |
| `slashCommands.enabled`, `.dateFormat`, `.timeZone` | core | |
| `tags.enabled` | core | autocomplete and Tags section need `host.getTags` |
| `imagePaste.enabled` | core | needs `host.uploadImage` |
| `imagePaste.folder`, `.folderRelativeTo`, `.filenamePattern`, `.pathStyle`, `.altText`, `.maxSizeMB`, `.cleanupUnreferenced` | VS Code only | file-system policy lives in the host's `uploadImage` |
| `imageResize.overwrite` | VS Code only | |
| `headingRename.updateLinks` | VS Code only | |
| `wikilink.createOnClick` | VS Code only | |
| `sidebar.visibility`, `.width`, `.position` | VS Code only | core takes the initial sidebar state as an option |
| `support.showSidebarLink` | VS Code only | |
| `defaultEditor`, `autoReloadUnmodifiedFiles`, `themeToggleScope` | VS Code only | |

**Settings modal:** the core renders sections for core-owned settings, and hides any control whose feature the host disabled (for example, the image-paste toggle when `uploadImage` is absent). The VS Code shell adds its own sections (image paste details, sidebar, support and About, Hotkeys, VS Code behavior) through an `extraSettingsSections` option. Without `host.saveSettings` the modal still works, with changes lasting for the session only.

**What changes in the plan:** M2 adds `extraSettingsSections` and decides the content-width gap. The Settings rule in `CLAUDE.md` still applies to VS Code-only settings. A new core-owned setting also needs a field in `MikeDownSettings`.

## 7. Quantico Creek target screen

`quantico-creek-angular-app` routes `admin` → `admin/admin.routes.ts`. `ngx-markdown` is registered in `app.module.ts` and `shared/shared.module.ts`.

| Screen | Route | Component | Field |
|---|---|---|---|
| **KB article editor** | `/admin/knowledge-base/add`, `/admin/knowledge-base/edit/:id` | `admin/knowledge-base/kb-article-editor/kb-article-editor.component.*` | `model.markdown`: a markdown textarea beside a live `<markdown>` preview, with revision diffs |
| AI prompt form | `/admin/ai/ai-prompts/add`, `/edit/:id` | `admin/ai/ai-prompts/ai-prompt-form/ai-prompt-form.component.*` | `model.promptText`, textarea plus `<markdown>` preview |
| Announcement form | `/admin/announcements/add`, `/edit/:id` | `admin/announcements/announcement-form/announcement-form.component.*` | `model.message` textarea |
| Web lead detail | `/admin/web-leads/:id` | `admin/web-leads/web-lead-detail/web-lead-detail.component.*` | `model.notes` (3 rows) and `model.assistantSummary` |
| Quick note parser | `/…/quick-notes/parse` | `order-manager/quick-notes/quick-note-parser/quick-note-parser.component.*` | pasted text for a parser, not prose. Not a fit |

**Recommendation: the KB article editor.** It is already a markdown authoring screen, the replacement is one control, and the side-by-side preview can go away. It binds with `[(ngModel)]` (template-driven), not `formControlName`. A `ControlValueAccessor` serves both, so M6 works either way. Its existing dirty check compares `model.markdown` to the saved text, which `writeValue` with `pristine: true` keeps correct.

**What changes in the plan:** M6 targets `kb-article-editor` and tests the wrapper with `ngModel`. T3 adds an `ngModel` spec alongside the reactive-forms spec. The AI prompt form is a natural second screen.

## Spike artifacts

Scratchpad root: `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/ed16b267-e627-406a-8c11-a6c3c7d23644/scratchpad`

- Angular 14 project: `ng14/spike/`, logs `ng14/spike/build-1-as-is.log` through `build-6-lazy-mermaid.log`, runtime DOM dump `ng14/runtime-dom.html`
- Angular 19 copy: `ng19/ng-app/` (branch `spike-mikedown`), logs `ng19/ng-app/build-1-baseline.log` and `build-2-spike.log`

The scratchpad is temporary. The numbers above are the record.
