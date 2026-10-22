# @mikedown/core

The MikeDown WYSIWYG markdown editor as a framework-agnostic package: TipTap (ProseMirror) for the rich view, CodeMirror 6 for source mode, `tiptap-markdown` for parse and serialize. It is the same editor that ships in the MikeDown VS Code extension. No Angular, React or VS Code dependency.

Status: `0.1.0-rc.1`, published under the `rc` tag.

## Install

```bash
npm install @mikedown/core@rc
```

Install the peer dependencies too (see [Peer dependencies](#peer-dependencies)). The package is ESM only.

## Minimal example

```ts
import { createMikeDownEditor } from '@mikedown/core';
import '@mikedown/core/styles.css';

const handle = createMikeDownEditor(document.getElementById('editor')!, {
  host: {
    onChange(markdown, { pristine }) {
      if (!pristine) saveSomewhere(markdown);
    },
  },
  initialMarkdown: '# Hello\n\nStart typing.',
  theme: 'auto',
});

handle.getMarkdown();
handle.setTheme('dark');
handle.destroy();
```

The editor fills its container (`height: 100%`), so give the container a height. Without one the editor falls back to a `240px` minimum height; set `--mikedown-min-height` to change that floor.

## Host interface

`options.host` is a `MikeDownHost`. Only `onChange` is required. Every other method is optional, and leaving one out turns its feature off and hides its UI. `NoopHost` is a ready-made host with just `onChange`.

| Method | Without it |
| --- | --- |
| `onChange(markdown, { pristine })` | required |
| `onStats` | no status statistics |
| `openLink` | external links open in a new tab, relative links are ignored |
| `saveSettings` | Settings modal changes last for the session |
| `toggleTheme` | the editor flips its own theme |
| `openKeybindings` | Hotkeys tab button hidden |
| `uploadImage` | image paste and drop disabled |
| `pickImage` | `/image` hidden |
| `resizeImage` | image resize items hidden |
| `resolveImageSrc` | relative or absolute image paths show the missing-image placeholder with the raw path |
| `getLinkSuggestions`, `getFileHeadings` | link and `[[` wikilink autocomplete off |
| `resolveWikilinks`, `createWikilink`, `checkLinks` | wikilinks and broken-link marking off |
| `getTags`, `openTag` | tag autocomplete and sidebar tags off |
| `getDiffBaseline` | diff button hidden |
| `onHeadingRenamed`, `onHeadingRenameAmbiguous` | no rename callbacks |
| `exportHtml`, `printDocument`, `viewInBrowser` | export buttons hidden |
| `sidebarPrefs` | sidebar keeps in-memory defaults |

Request and response methods return Promises. For example `uploadImage(file)` receives `{ mime, bytes, name }` and resolves `{ src, alt }`.

The returned `MikeDownEditorHandle` takes pushes from the host: `setMarkdown`, `markSaved`, `updateSettings`, `setReadOnly`, `setTags`, `setBacklinks`, `setDocMeta`, `scrollToAnchor`, `getHtml`, `command(name)` and more. `handle.on('ready' | ...)` subscribes to events. All types are exported from the package root.

## Features

Switch UI blocks with `options.features`. Defaults shown.

| Feature | Default | Notes |
| --- | --- | --- |
| `toolbar` | on | Formatting toolbar |
| `sidebar` | off | Properties, Outline, Backlinks and Tags |
| `sourceMode` | on | CodeMirror view, `Cmd/Ctrl+/` |
| `slashCommands` | on | `/` menu |
| `spellcheck` | on | Inert unless `spellcheckDictionaryUrl` is set |
| `math` | on | KaTeX, `$...$` and `$$...$$` |
| `mermaid` | on | Renders `mermaid` fenced blocks |
| `findReplace` | on | `Cmd/Ctrl+F` and `Cmd/Ctrl+H` |
| `frontmatter` | on | Collapsible YAML block |
| `supportCard` | off | VS Code only |

Also built in: tables, task lists, GFM callouts (`> [!NOTE]`), `==highlight==`, footnotes, emoji, wikilinks, code blocks with language picker.

## Theming

Colors, fonts and radii come only from `--mikedown-*` custom properties, with light and dark defaults in `@mikedown/core/tokens.css` (already included in `styles.css`). Every selector is scoped under `.mikedown-root` and `.mikedown-portal`, so the stylesheet cannot restyle your page. Set `theme: 'light' | 'dark' | 'auto'` or call `handle.setTheme()`.

To re-theme, set tokens on `.mikedown-root` (light) and `.mikedown-root[data-mikedown-theme="dark"]`. Menus and dialogs live in a `.mikedown-portal` element on `<body>`, so set the same tokens there. The full token list is in `src/styles/tokens.md` in the repository.

Menus and dialogs share one portal that mirrors the theme of the most recently focused editor. Two editors on one page with different themes can therefore show overlays in the other editor's theme. Mermaid's theme is initialised once globally for the same reason. Pages that toggle all editors together (as the demo does) are unaffected.

## Spell check dictionaries

The package ships Hunspell dictionaries in `dist/dictionaries/` (`en/` and `en-GB/`, each with `index.aff`, `index.dic` and a license). Copy that folder to somewhere your app serves, then point the editor at it:

```ts
createMikeDownEditor(el, { host, spellcheckDictionaryUrl: '/assets/mikedown-dictionaries' });
```

Without `spellcheckDictionaryUrl`, spell check stays off and nothing is fetched. In an Angular app, add `{ "glob": "**/*", "input": "node_modules/@mikedown/core/dist/dictionaries", "output": "assets/mikedown-dictionaries" }` to the `assets` array in `angular.json`.

## Shortcuts

The core binds `Mod-/` (Cmd on macOS, Ctrl elsewhere) to the source toggle in both the rich editor and source mode. A host that binds the shortcut itself, such as the VS Code keybinding, passes `hostOwnsShortcuts: true` so one keystroke never toggles twice.

## Peer dependencies

The app must have exactly one copy of ProseMirror and CodeMirror, so these are peers.

| Peer | Range |
| --- | --- |
| `@tiptap/core`, `@tiptap/pm`, `@tiptap/starter-kit` and the extension packages (code-block-lowlight, hard-break, highlight, image, link, placeholder, table, table-cell, table-header, table-row, task-item, task-list, text) | `^3.20.0` (highlight `^3.23.5`) |
| `@codemirror/state` | `^6.5.2` |
| `@codemirror/view` | `^6.36.4` |
| `@codemirror/commands` | `^6.8.0` |
| `@codemirror/language` | `^6.10.8` |
| `@codemirror/lang-markdown` | `^6.3.2` |
| `@codemirror/theme-one-dark` | `^6.1.2` |
| `lowlight` | `^3.3.0` |
| `mermaid` (optional) | `^11.15.0` |
| `katex` (optional) | `^0.16.47` |

`tiptap-markdown`, `markdown-it-emoji`, `markdown-it-footnote`, `markdown-it-mark` and `nspell` are regular dependencies and install with the package.

`mermaid` and `katex` are loaded with dynamic `import()` the first time a diagram or formula appears, so they stay out of your initial bundle. Install them to use those features. Without them the block shows an error or the raw source.

## Bundler notes

- **tiptap-markdown** is not bundled. Its `exports` map sends ESM consumers to the ES build, which Angular's builders, Vite and webpack 5 all honour. If your bundler resolves its UMD `main` file, add an alias to `tiptap-markdown/dist/tiptap-markdown.es.js` or put `module` first in `resolve.mainFields`.
- **KaTeX CSS.** `styles.css` begins with `@import 'katex/dist/katex.min.css'`, which Vite, webpack `css-loader` and the Angular application builder resolve from `node_modules`. If your toolchain does not, add `node_modules/katex/dist/katex.min.css` to your global styles (in Angular, the `styles` array in `angular.json`) and the import becomes harmless.
- **Old Angular CLI (14).** `exports` is ignored under `moduleResolution: node`, which is why `types` and `module` are set at the top level. Add `node_modules/@mikedown/core/dist/styles.css` to `angular.json` `styles` instead of importing it from Sass. Use `skipLibCheck: true`.
- **Types.** The published `.d.ts` references no `mermaid`, `katex` or `nspell` types.

## Content Security Policy (Mermaid)

Mermaid renders SVG with `securityLevel: 'strict'` and loads its diagram types by dynamic `import()`. Your CSP needs `script-src 'self'` (or wherever your chunks are served from) and must allow inline styles for the SVG output (`style-src 'unsafe-inline'`, or a nonce on the style elements your bundler injects). A page that cannot allow this should set `features: { mermaid: false }`. KaTeX needs no script or eval permissions, only its stylesheet and fonts.

## Demo

From a clone of the repository:

```bash
npm run demo:core
```

This builds the package and serves `packages/core/demo/` with two editors side by side, a theme toggle, a "Log markdown" button and an `uploadImage` stub that returns an object URL.

## Build

```bash
npm run build -w packages/core
```

Produces `dist/index.js` (ESM), `dist/index.d.ts`, `dist/styles.css`, `dist/tokens.css` and `dist/dictionaries/`.

## License

MIT
