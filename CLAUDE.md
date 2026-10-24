# [CLAUDE.md](http://CLAUDE.md)

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run compile             # webpack — builds both bundles (extension + webview)
npm run watch               # webpack --watch
npm run dev                 # build, then open a dev host on test/workspace (no debugger; F5 attach is flaky)
npm run package             # production build (used by vscode:prepublish)
npm run vsix                # patch-bump the extension version, build, package .vsix (does not touch packages/*)
npm run vsix:minor          # same, minor bump
npm run version:npm -- X.Y.Z   # set one version on every public packages/* package + their @mikedown/core peer
npm run release:npm         # dry run of every public package (build, npm pack --dry-run); --only a,b / --publish / --otp
npm run release:core        # alias for release:npm -- --only core
npm run build:core          # build packages/core dist (tsup + CSS + dictionaries)
npm run test:packages       # build every public package, then test/packages/package-shape.test.ts (test:core-package is an alias)
npm run test:wrappers       # every wrapper's own test script (web-component, react, vue, angular)
npm run test:consumers      # scaffold real consumer apps (Vite, Next, Nuxt, Angular...) and build them against the packed packages; --only <target> for one
npm run dev:site            # website/ dev server (Vite, port 5180, base /mikedown/)
npm run build:site          # build website/ (Vite pages, then the Angular demo)
npm run lint                # eslint on src/**/*.ts
npm run format              # prettier
npm run test:unit           # vitest (jsdom) — pure logic + DOM utilities
npm run test:unit:watch
npm run test:integration    # @vscode/test-electron — boots real VS Code against test/workspace
npm run test:edge           # vitest on test/edge-cases + test/performance

# Single unit test (file or by name)
npx vitest run test/unit/links.test.ts   # core-only tests: packages/core/test/
npx vitest run -t 'highlight round-trip'
```

`test:integration` requires the bundle (`pretest` runs `compile`). VS Code integration tests cannot share a vitest process — keep them under `test/integration/`.

## Architecture

This is a VS Code custom editor extension. It compiles into **two separate bundles** with different webpack targets and tsconfigs — keep them mentally distinct:

| Bundle | Target | Entry | Out | tsconfig |
| --- | --- | --- | --- | --- |
| Extension host | `node` | `src/extension.ts` | `dist/extension.js` | `tsconfig.json` (excludes `src/webview`; includes `packages/core/src/shared`) |
| Webview | `web` | `src/webview/editor-main.ts` (thin; imports `packages/core/src/editor-main.ts`) | `out/webview/editor-main.js` | `tsconfig.webview.json` (DOM lib, transpile-only) |

The repo is an npm workspace (`"workspaces": ["packages/*", "!packages/angular", "website"]`). The editor sources live in `packages/core` (`@mikedown/core`, public on npm); the VS Code extension at the root consumes them.

Packages (`wrappers-decisions.md` has the reasoning):

- `packages/core`: `@mikedown/core`, the framework-agnostic editor plus `bindMikeDownValue` (`@mikedown/core/binding`).
- `packages/web-component`: `@mikedown/web-component`, the form-associated `<mikedown-editor>` (light DOM, plus a standalone CDN bundle).
- `packages/react`, `packages/vue`: thin wrappers over `bindMikeDownValue`.
- `packages/angular`: `@mikedown/angular`, a form control. Outside the root workspaces with its own lockfile; built by ng-packagr and published from `packages/angular/dist`.
- `packages/desktop`: MikeDown Desktop (Tauri), private, with its own plan.
- `website/` (`@mikedown/site`, private): the VS Code page (`vscode/`) and the developers hub with a demo per wrapper (`developers/`), built by Vite (base `/mikedown/`), shared shell in `website/shared/`. The Angular demo is a separate app in `website/developers-angular/`, built by `ng build` into the site output. The desktop download page (`website/mikedown-desktop/`) is rendered by the Desktop release script, not by Vite.

All wrappers (and the web component) peer on `@mikedown/core` and their framework only; they share one lockstep family version.

The extension host has zero DOM types. The webview has zero `vscode` Node APIs. They only communicate via `postMessage`.

### Extension host (`src/`)

- `extension.ts` — activation. Registers the custom editor (`mikedown.editor`), every `mikedown.*` command, and a workspace-wide backlink index. Most commands just forward `{ type: 'command', command: <name> }` to `MarkdownEditorProvider.activePanel`.
- `markdownEditorProvider.ts` — the `CustomTextEditorProvider`. \~1600 LOC and the central nerve of the host side: webview HTML, `postMessage` routing, `applyEdit` debouncing for `update`/`edit` messages, image-paste write-to-disk, image cleanup baselines, diff-view detection (multiple panels per `fsPath` → redirect to source diff), backlinks + outline broadcast.
- `imagePaste.ts` — pure helpers (resolve folder, render filename pattern, alt text, dedupe by hash, sibling-resize paths). Tested by `test/unit/imagePaste.test.ts`.
- `settings.ts` — reads `mikedown.*` from `vscode.workspace.getConfiguration`. **If you add a setting, also register it in** `package.json#contributes.configuration` **AND wire it into the in-editor Settings modal** (see Settings rule below).
- `backlinkProvider.ts` / `outlineProvider.ts` — workspace-wide markdown link index + outline symbol provider.
- `export.ts` — HTML/PDF export by reusing the webview's rendered HTML (Chromium print).
- Host-and-webview pure modules (`imageDisplayPath`, `tagExtract`, `tagSyntax`, `wordCount`, `anchoring`, `frontmatterYaml`, `headingNumbering`) live in `packages/core/src/shared/`. The host imports them as `@mikedown/core/shared/<name>` (alias in `tsconfig.json`, `webpack.config.js` and `vitest.config.ts`).

### Webview (`packages/core/src/`)

Stylesheets are in `packages/core/src/styles/` (the CSS list in `markdownEditorProvider.ts#getWebviewContent` points there). Core-only unit tests are in `packages/core/test/`; host-side tests stay in `test/unit/`. `.vscodeignore` ships only `out/webview/editor-main.js`, the CSS, `dictionaries/` and `katex.min.css`. Webview-only npm dependencies are declared in `packages/core/package.json`; the root keeps `katex` so its CSS ships in the `.vsix`.

- `editor-main.ts` — \~3800 LOC. Constructs the TipTap editor (ProseMirror under the hood) with `tiptap-markdown` for parse/serialize. Also constructs a CodeMirror 6 instance for source mode (`Cmd+/` toggles). Wires every UI extension below. Sets CSS custom properties (`--mikedown-font-*`, `--mikedown-content-width`, etc.) from settings broadcasts.
- TipTap extensions (custom): `smartpaste.ts`, `imagepaste.ts`, `callout-node.ts` (GFM `[!NOTE]` admonitions), `emoji.ts` + `emojiautocomplete.ts` + `emojipicker.ts`, `highlight.ts` (`==text==`), `htmlanchor.ts`, `linkAutolink.ts`, `tablecheckbox.ts`, `taskitem-drag.ts`, `findreplace.ts`.
- UI overlays: `contextmenu.ts`, `toolbar-dropdown.ts`, `tablepicker.ts` + `tabledrag.ts`, `languagepicker.ts`, `outlineSidebar.ts` (the in-editor sidebar — Properties / Outline / Backlinks / footer), `linkautocomplete.ts`.
- Settings modal lives inside `editor-main.ts` (`showSettingsModal` \~line 522) and posts `{ type: 'saveSettings', settings: {...} }` back to the host, which persists via `vscode.workspace.getConfiguration().update(...)`.

### Webview ↔ extension protocol

Message shapes are documented at the top of `packages/core/src/editor-main.ts`. Key flows:

- Host → webview: `update` (full markdown), `command` (toolbar/keybinding), `settings` (broadcast on config change), `backlinks`, `properties`, `linkSuggestions`, `imagePathPrefix`.
- Webview → host: `ready`, `edit` (full markdown back), `stats` (plain text for status bar), `saveSettings`, `openLink`, `savePastedImage` (binary → host writes file → host returns inserted path).

Always send full document content for `update`/`edit`. The host re-applies into `vscode.TextDocument` via `WorkspaceEdit` and lets VS Code dedupe.

## Critical constraints

- **Never mutate** `editor.view.dom` **outside a ProseMirror transaction.** This poisons PM's MutationObserver queue and produces delayed, hard-to-debug selection clobbering. See commit `f5415e0`. Use `editor.commands.*` or a `view.dispatch(tr)`.
- **Webpack alias for** `tiptap-markdown`**.** Its UMD build is broken under webpack's `web` target (strict mode `this === undefined`). `webpack.config.js` forces the ES module entry. Don't undo that, and prefer `mainFields: ['module', 'browser', 'main']` ordering for any new package added to the webview bundle.
- **VS Code's built-in Outline view cannot host webviews** (it binds to `activeTextEditor`, undefined for custom editors — VS Code issue #105448). The in-webview outline sidebar is the workaround; don't try to surface it via `vscode.SymbolProvider` again.
- **Custom editor uses** `retainContextWhenHidden: true`**.** Webview state survives tab switches — don't rely on re-init for cleanup. Listen to `onDidDispose`.
- **Diff view detection.** When VS Code opens a Git diff, two panels resolve for the same `fsPath`. The provider detects this (second `resolveCustomTextEditor` for the same path) and redirects to the source-text diff. Don't break that path; non-`file://` URIs (e.g. `git:`) also trigger it.

## Releasing

The npm family (`@mikedown/*`, every public `packages/*` package) and the extension release independently. The `@mikedown/*` packages share one (lockstep) family version (see `wrappers-decisions.md`, Versioning) that has nothing to do with the extension's 2.x.

npm family:

1. `npm run version:npm -- X.Y.Z` sets the version on every public package and each wrapper's `@mikedown/core` peer to `^X.Y.Z`. It refuses a lower version.
2. `npm run test:packages` builds every public package and runs the shape test.
3. `npm run release:npm` is a dry run (default): build, `npm pack --dry-run`, file list; nothing is published. Add `--only core,react` to limit it.
4. `npm run release:npm -- --publish [--otp 123456]` publishes core first, then the rest, with `--access public` (`--tag rc` for prereleases). A version already on npm is skipped. If `npm whoami` fails it packs tarballs to `/Volumes/Storage/LymeStack/packages/npm/` (falling back to `.orchestrator/wrappers-npm-plan/artifacts/`) instead of publishing; `--pack` writes them without publishing.
5. `packages/angular` (when it exists) is outside the root workspaces with its own lockfile and is published from `packages/angular/dist`; the scripts handle it.

Website (`https://www.iadev.net/mikedown/`): `npm run build:site`, then the site-only publish through the same LymeDeploy project as Desktop (`mikedown-downloads`): `packages/desktop/deploy/pack-for-lymedeploy.sh --site --site-n N --dry-run` first, then without `--dry-run`. It packs only `vscode/`, `developers/`, site assets and the re-rendered desktop `index.html`, as release `<desktop-version>-site.N`, and never touches Desktop artifacts or manifests. Details in `packages/desktop/deploy/README.md`.

Extension:

1. `npm run vsix` (patch) or `npm run vsix:minor` bumps only the root version, builds and packages the `.vsix`. It no longer touches `packages/*`.
2. Upload the `.vsix` to the Marketplace by hand, then commit `Release X.Y.Z` and tag `vX.Y.Z`.

The order (npm first) only matters when the extension or Desktop needs a new core version: publish core, then bump the pin in Desktop and the downstream apps (LymeStarter, Quantico Creek). CI (`.github/workflows/ci.yml`) runs lint, `test:unit`, `test:edge` and `test:packages`; it does not publish.

## Settings rule

Any new `mikedown.*` setting must be added in **three places**:

1. `package.json#contributes.configuration.properties` (schema + default).
2. `src/settings.ts` (reader).
3. The in-editor Settings modal in `packages/core/src/editor-main.ts#showSettingsModal` — the toolbar gear button is the primary UX, the VS Code settings UI is secondary.

## Repo conventions

- Reserved root files — never archive, move, or rename: `CLAUDE.md`, `RESUME.md`, `BACKLOG.md`, `PLANNING.md`, `README.md`, `CHANGELOG.md`.
- Don't commit `.claude/settings.local.json`.
- `ZOMBIE`-prefixed commented code blocks are intentional — leave them.
- Markdown rules: escape `$` as `\$` (LaTeX would otherwise render), and put blank lines before and after lists (MD032). Not needed in codeblocks or HTML
- Don't mention Claude or Anthropic in commit messages.
- When replying to a GitHub issue after its fix/feature ships, write in first person as Mike (not as his AI assistant), thank the reporter, name the release it landed in, and close with a short, no-pressure ask for a VS Code Marketplace review if they're finding MikeDown useful. Skip the ask on unresolved or declined issues, and ask only once per person when replying to several of their issues together.
