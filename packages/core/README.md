# @mikedown/core

The MikeDown WYSIWYG markdown editor as a framework-agnostic package: TipTap (ProseMirror) for the rich view, CodeMirror 6 for source mode, `tiptap-markdown` for parse and serialize. It is the same editor that ships in the MikeDown VS Code extension. No Angular, React or VS Code dependency.

## Install

```bash
npm install @mikedown/core
```

npm 7+ and pnpm 8+ install the peer dependencies for you (see [Peer dependencies](#peer-dependencies)); Yarn does not, so use the `yarn add` line under [Framework wrappers](#framework-wrappers). The package is ESM only.

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

## Binding a value

`bindMikeDownValue` is the glue a form field or framework wrapper needs, in one call. Import it from the package root or from `@mikedown/core/binding`.

```ts
import { bindMikeDownValue } from '@mikedown/core/binding';

const field = bindMikeDownValue(container, {
  initialValue: '# Hello',
  debounceMs: 150,
  onValue: (markdown) => save(markdown),
  theme: 'auto',
  darkSelector: 'html[data-mode=dark]',
  id: 'notes',
  ariaLabel: 'Meeting notes',
  placeholder: 'Start writing…',
});

field.setValue(fromServer);   // loads pristine; skipped when equal to the current value
field.flush();                // report a pending change now
field.setTheme('dark');
field.focus();
field.handle;                 // the MikeDownEditorHandle
field.destroy();              // flushes, then removes observers and listeners
```

- **Change reporting.** `onValue` fires after `debounceMs` of quiet and at once on blur. `outputTransform(markdown)` maps the text on its way out; `setValue` compares against its output.
- **Theme.** `auto` is dark when the container or an ancestor matches `darkSelector` (it uses `closest()`, so both `html[data-mode=dark]` and a `.dark-theme` wrapper work), re-checked when attributes change. Without a selector it follows `prefers-color-scheme`.
- **Accessibility.** `id`, `ariaLabel` and `ariaLabelledBy` go on the editable surface in both views (rich text and source). With only an `id`, the binding looks up `label[for=id]`, uses it as the name and focuses the editor when it is clicked. `ariaLabelledBy` is the sturdier choice. The accessible name follows ARIA's order: `aria-labelledby`, then `aria-label`, then `<label for>` elements. A bound editor drops `role="main"` (`landmark: false`), since a field is not a page landmark; the same `landmark`, `placeholder`, `id`, `ariaLabel` and `ariaLabelledBy` options exist on `createMikeDownEditor`.

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
| `katex` | `^0.16.47` |

`tiptap-markdown`, `markdown-it-emoji`, `markdown-it-footnote`, `markdown-it-mark` and `nspell` are regular dependencies and install with the package.

`katex` is a required peer because `styles.css` imports its stylesheet. `mermaid` is optional. Both are loaded with dynamic `import()` the first time a diagram or formula appears, so they stay out of your initial bundle. Without `mermaid` the diagram block shows an error or the raw source. Install it anyway for Angular and Next.js (Turbopack) builds, which resolve the `import('mermaid')` at build time and fail without it; Vite builds pass.

## Bundler notes

- **tiptap-markdown** is not bundled. Its `exports` map sends ESM consumers to the ES build, which Angular's builders, Vite and webpack 5 all honour. If your bundler resolves its UMD `main` file, add an alias to `tiptap-markdown/dist/tiptap-markdown.es.js` or put `module` first in `resolve.mainFields`.
- **KaTeX CSS.** `styles.css` begins with `@import 'katex/dist/katex.min.css'`, which Vite, webpack `css-loader` and the Angular application builder resolve from `node_modules`. If your toolchain does not, add `node_modules/katex/dist/katex.min.css` to your global styles (in Angular, the `styles` array in `angular.json`) and the import becomes harmless.
- **Old Angular CLI (14).** `exports` is ignored under `moduleResolution: node`, which is why `types` and `module` are set at the top level. Add `node_modules/@mikedown/core/dist/styles.css` to `angular.json` `styles` instead of importing it from Sass. Use `skipLibCheck: true`.
- **Types.** The published `.d.ts` references no `mermaid`, `katex` or `nspell` types.

## Content Security Policy (Mermaid)

Mermaid renders SVG with `securityLevel: 'strict'` and loads its diagram types by dynamic `import()`. Your CSP needs `script-src 'self'` (or wherever your chunks are served from) and must allow inline styles for the SVG output (`style-src 'unsafe-inline'`, or a nonce on the style elements your bundler injects). A page that cannot allow this should set `features: { mermaid: false }`. KaTeX needs no script or eval permissions, only its stylesheet and fonts.

## Framework wrappers

- [`@mikedown/web-component`](https://www.npmjs.com/package/@mikedown/web-component): `<mikedown-editor>`, a form-associated custom element for plain HTML, CDN pages and server-rendered templates.
- [`@mikedown/react`](https://www.npmjs.com/package/@mikedown/react): `MikeDownEditor` for React 18 and 19.
- [`@mikedown/vue`](https://www.npmjs.com/package/@mikedown/vue): `MikeDownEditor` with `v-model` for Vue 3.3+.
- [`@mikedown/angular`](https://www.npmjs.com/package/@mikedown/angular): a form control for Angular 17+.

Each wrapper depends only on core and its framework. Yarn does not install peers, so list core's:

```bash
yarn add @mikedown/core @codemirror/commands @codemirror/lang-markdown @codemirror/language @codemirror/state @codemirror/theme-one-dark @codemirror/view @tiptap/core @tiptap/extension-code-block-lowlight @tiptap/extension-hard-break @tiptap/extension-highlight @tiptap/extension-image @tiptap/extension-link @tiptap/extension-placeholder @tiptap/extension-table @tiptap/extension-table-cell @tiptap/extension-table-header @tiptap/extension-table-row @tiptap/extension-task-item @tiptap/extension-task-list @tiptap/extension-text @tiptap/pm @tiptap/starter-kit katex lowlight mermaid
```

## Testing

Use vitest with jsdom, stubbing `Range.prototype.getBoundingClientRect` and `getClientRects`. Jest: add `transformIgnorePatterns: ['/node_modules/(?!(@mikedown|lowlight|devlop)/)']` so the ESM-only packages in core's import graph get transformed (TipTap, CodeMirror and `tiptap-markdown` ship `require` builds). vitest is the recommended runner.

## Demo

From a clone of the repository:

```bash
npm run demo:core
```

This builds the package and serves `packages/core/demo/` with two editors side by side, a theme toggle, a "Log markdown" button and an `uploadImage` stub that returns an object URL.

## Browser support

Current Chrome, Edge, Firefox and Safari (ES2020 output, ESM only).

## Privacy

No telemetry. The editor makes no network calls except the ones you configure: spell check dictionaries (when `spellcheckDictionaryUrl` is set), your `host` callbacks, and the lazy `import()` of KaTeX and Mermaid from your own bundle.

## Links

- [Developers hub](https://www.iadev.net/mikedown/developers/)
- [npm](https://www.npmjs.com/package/@mikedown/core)
- [GitHub](https://github.com/mikejoseph23/mikedown/tree/main/packages/core)

## Build

```bash
npm run build -w packages/core
```

Produces `dist/index.js` (ESM), `dist/index.d.ts`, `dist/styles.css`, `dist/tokens.css` and `dist/dictionaries/`.

## License

MIT
