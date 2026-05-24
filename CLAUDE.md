# [CLAUDE.md](http://CLAUDE.md)

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run compile             # webpack — builds both bundles (extension + webview)
npm run watch               # webpack --watch
npm run package             # production build (used by vscode:prepublish)
npm run vsix                # patch-bump version, build, package .vsix
npm run lint                # eslint on src/**/*.ts
npm run format              # prettier
npm run test:unit           # vitest (jsdom) — pure logic + DOM utilities
npm run test:unit:watch
npm run test:integration    # @vscode/test-electron — boots real VS Code against test/workspace
npm run test:edge           # vitest on test/edge-cases + test/performance

# Single unit test (file or by name)
npx vitest run test/unit/links.test.ts
npx vitest run -t 'highlight round-trip'
```

`test:integration` requires the bundle (`pretest` runs `compile`). VS Code integration tests cannot share a vitest process — keep them under `test/integration/`.

## Architecture

This is a VS Code custom editor extension. It compiles into **two separate bundles** with different webpack targets and tsconfigs — keep them mentally distinct:

| Bundle | Target | Entry | Out | tsconfig |
| --- | --- | --- | --- | --- |
| Extension host | `node` | `src/extension.ts` | `dist/extension.js` | `tsconfig.json` (excludes `src/webview`) |
| Webview | `web` | `src/webview/editor-main.ts` | `out/webview/editor-main.js` | `tsconfig.webview.json` (DOM lib, transpile-only) |

The extension host has zero DOM types. The webview has zero `vscode` Node APIs. They only communicate via `postMessage`.

### Extension host (`src/`)

- `extension.ts` — activation. Registers the custom editor (`mikedown.editor`), every `mikedown.*` command, and a workspace-wide backlink index. Most commands just forward `{ type: 'command', command: <name> }` to `MarkdownEditorProvider.activePanel`.
- `markdownEditorProvider.ts` — the `CustomTextEditorProvider`. \~1600 LOC and the central nerve of the host side: webview HTML, `postMessage` routing, `applyEdit` debouncing for `update`/`edit` messages, image-paste write-to-disk, image cleanup baselines, diff-view detection (multiple panels per `fsPath` → redirect to source diff), backlinks + outline broadcast.
- `imagePaste.ts` — pure helpers (resolve folder, render filename pattern, alt text, dedupe by hash, sibling-resize paths). Tested by `test/unit/imagePaste.test.ts`.
- `settings.ts` — reads `mikedown.*` from `vscode.workspace.getConfiguration`. **If you add a setting, also register it in** `package.json#contributes.configuration` **AND wire it into the in-editor Settings modal** (see Settings rule below).
- `backlinkProvider.ts` / `outlineProvider.ts` — workspace-wide markdown link index + outline symbol provider.
- `export.ts` — HTML/PDF export by reusing the webview's rendered HTML (Chromium print).
- `imageDisplayPath.ts` — converts between on-disk paths and webview-resolvable URIs. Used on **both sides** (only file in src/ imported by the webview bundle).

### Webview (`src/webview/`)

- `editor-main.ts` — \~3800 LOC. Constructs the TipTap editor (ProseMirror under the hood) with `tiptap-markdown` for parse/serialize. Also constructs a CodeMirror 6 instance for source mode (`Cmd+/` toggles). Wires every UI extension below. Sets CSS custom properties (`--mikedown-font-*`, `--mikedown-content-width`, etc.) from settings broadcasts.
- TipTap extensions (custom): `smartpaste.ts`, `imagepaste.ts`, `callout-node.ts` (GFM `[!NOTE]` admonitions), `emoji.ts` + `emojiautocomplete.ts` + `emojipicker.ts`, `highlight.ts` (`==text==`), `htmlanchor.ts`, `linkAutolink.ts`, `tablecheckbox.ts`, `taskitem-drag.ts`, `findreplace.ts`.
- UI overlays: `contextmenu.ts`, `toolbar-dropdown.ts`, `tablepicker.ts` + `tabledrag.ts`, `languagepicker.ts`, `outlineSidebar.ts` (the in-editor sidebar — Properties / Outline / Backlinks / footer), `linkautocomplete.ts`.
- Settings modal lives inside `editor-main.ts` (`showSettingsModal` \~line 522) and posts `{ type: 'saveSettings', settings: {...} }` back to the host, which persists via `vscode.workspace.getConfiguration().update(...)`.

### Webview ↔ extension protocol

Message shapes are documented at the top of `src/webview/editor-main.ts`. Key flows:

- Host → webview: `update` (full markdown), `command` (toolbar/keybinding), `settings` (broadcast on config change), `backlinks`, `properties`, `linkSuggestions`, `imagePathPrefix`.
- Webview → host: `ready`, `edit` (full markdown back), `stats` (plain text for status bar), `saveSettings`, `openLink`, `pasteImage` (binary → host writes file → host returns inserted path).

Always send full document content for `update`/`edit`. The host re-applies into `vscode.TextDocument` via `WorkspaceEdit` and lets VS Code dedupe.

## Critical constraints

- **Never mutate** `editor.view.dom` **outside a ProseMirror transaction.** This poisons PM's MutationObserver queue and produces delayed, hard-to-debug selection clobbering. See commit `f5415e0`. Use `editor.commands.*` or a `view.dispatch(tr)`.
- **Webpack alias for** `tiptap-markdown`**.** Its UMD build is broken under webpack's `web` target (strict mode `this === undefined`). `webpack.config.js` forces the ES module entry. Don't undo that, and prefer `mainFields: ['module', 'browser', 'main']` ordering for any new package added to the webview bundle.
- **VS Code's built-in Outline view cannot host webviews** (it binds to `activeTextEditor`, undefined for custom editors — VS Code issue #105448). The in-webview outline sidebar is the workaround; don't try to surface it via `vscode.SymbolProvider` again.
- **Custom editor uses** `retainContextWhenHidden: true`**.** Webview state survives tab switches — don't rely on re-init for cleanup. Listen to `onDidDispose`.
- **Diff view detection.** When VS Code opens a Git diff, two panels resolve for the same `fsPath`. The provider detects this (second `resolveCustomTextEditor` for the same path) and redirects to the source-text diff. Don't break that path; non-`file://` URIs (e.g. `git:`) also trigger it.

## Settings rule

Any new `mikedown.*` setting must be added in **three places**:

1. `package.json#contributes.configuration.properties` (schema + default).
2. `src/settings.ts` (reader).
3. The in-editor Settings modal in `src/webview/editor-main.ts#showSettingsModal` — the toolbar gear button is the primary UX, the VS Code settings UI is secondary.

## Repo conventions

- Reserved root files — never archive, move, or rename: `CLAUDE.md`, `RESUME.md`, `BACKLOG.md`, `PLANNING.md`, `README.md`, `CHANGELOG.md`.
- Don't commit `.claude/settings.local.json`.
- `ZOMBIE`-prefixed commented code blocks are intentional — leave them.
- Markdown rules: escape `$` as `\$` (LaTeX would otherwise render), and put blank lines before and after lists (MD032). Not needed in codeblocks or HTML
- Don't mention Claude or Anthropic in commit messages.