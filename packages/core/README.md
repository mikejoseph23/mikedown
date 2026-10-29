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
| `ai` | no AI features, no AI tab (see [Bring your own AI](#bring-your-own-ai)) |

Request and response methods return Promises. For example `uploadImage(file)` receives `{ mime, bytes, name }` and resolves `{ src, alt }`.

The returned `MikeDownEditorHandle` takes pushes from the host: `setMarkdown`, `markSaved`, `updateSettings`, `setReadOnly`, `setTags`, `setBacklinks`, `setDocMeta`, `scrollToAnchor`, `getHtml`, `command(name)` and more. `handle.on('ready' | ...)` subscribes to events. All types are exported from the package root.

## Bring your own AI

`host.ai` turns on the editor's AI features (selection rewrite today, more later) and an AI tab in the Settings modal. Leave it out and nothing AI shows. **`@mikedown/core` ships no provider SDK and makes no AI network calls of its own.** Your `host.ai` does the transport; `@mikedown/core/ai` holds only pure helpers (settings schema, router, request builders, stream parsers) you may use or ignore.

There are two tiers. Pick by how much of the engine setup you want the editor to own.

**Tier 1: one method.** Implement `complete` and proxy it to your backend. Your server picks the model, holds the keys and decides what may leave your network. The editor shows the on/off switch and the feature toggles in Settings, but no engine list.

```ts
import { createMikeDownEditor, type MikeDownAiHost } from '@mikedown/core';

const ai: MikeDownAiHost = {
  async complete(req, onToken, signal) {
    const res = await fetch('/api/ai/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Image parts carry raw bytes; encode them first (bytesToBase64 from '@mikedown/core/ai') if you forward them.
      body: JSON.stringify({ feature: req.feature, task: req.task, messages: req.messages, maxTokens: req.maxTokens }),
      signal,
    });
    if (!res.ok) throw { code: res.status === 429 ? 'rateLimited' : 'unknown', message: await res.text() };
    // This backend streams plain text. Rejecting with an AbortError (or aborting `signal`) cancels cleanly.
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const delta = decoder.decode(value, { stream: true });
      text += delta;
      onToken(delta);
    }
    return { text, served: { engineName: 'Our AI service', modelId: 'server-chosen', isLocal: false }, finishReason: 'stop' };
  },
};

createMikeDownEditor(el, { host: { onChange, ai } });
```

**Tier 2: an engine registry.** Add `listEngines` (and optionally `testEngine`, `discoverModels`, `setSecret`, `requestCloudConsent`) and the editor shows the full AI tab: engines, models, capabilities and per-task routing. Core resolves which engine and model serves each request and passes it as `req.route`; your host sends it. The example calls a local Ollama from the browser, which suits development (start Ollama with `OLLAMA_ORIGINS` set to your dev origin so the browser may call it; in production, send these calls through your server).

```ts
import { createMikeDownEditor, type MikeDownAiHost } from '@mikedown/core';
import {
  aiErrorCodeFromHttp, buildAuthHeaders, buildCompletionBody, completeCapabilities, createCompletionStreamReader,
  engineEndpoints, makeAiError, parseAiSettings, parseOllamaTags, type AiEngineStatus,
} from '@mikedown/core/ai';

const settings = parseAiSettings({
  enabled: true,
  engines: [{ id: 'ollama', name: 'Ollama (dev)', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: [{ id: 'qwen3:8b' }] }],
  routing: { default: { engineId: 'ollama', modelId: 'qwen3:8b' }, fallback: 'none', tasks: {} },
});
const engine = settings.engines[0];
const urls = engineEndpoints(engine);

async function probe(): Promise<AiEngineStatus> {
  const started = performance.now();
  try {
    const res = await fetch(urls.nativeModels!);
    if (!res.ok) throw makeAiError(aiErrorCodeFromHttp(res.status));
    const ids = parseOllamaTags(await res.json());
    return {
      engineId: engine.id, ok: true, isLocal: true, hasKey: false, latencyMs: Math.round(performance.now() - started),
      models: ids.map((id) => ({ id, capabilities: completeCapabilities({}, id, engine.kind), source: 'heuristic' as const })),
    };
  } catch (err) {
    return { engineId: engine.id, ok: false, isLocal: true, hasKey: false, error: err instanceof Error ? err.message : 'Ollama is not reachable', models: [] };
  }
}

const ai: MikeDownAiHost = {
  async complete(req, onToken, signal) {
    const model = engine.models.find((m) => m.id === req.route?.modelId) ?? engine.models[0];
    const res = await fetch(urls.completions, {
      method: 'POST',
      headers: buildAuthHeaders(engine.kind, null),
      body: JSON.stringify(buildCompletionBody(engine.kind, model, req)),
      signal,
    });
    if (!res.ok) throw makeAiError(aiErrorCodeFromHttp(res.status, await res.text()));
    const stream = createCompletionStreamReader(engine.kind);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const delta of stream.push(decoder.decode(value, { stream: true }))) onToken(delta);
    }
    const out = stream.finish();
    return {
      text: out.text, usage: out.usage, finishReason: out.finishReason,
      served: { engineId: engine.id, engineName: engine.name, modelId: model.id, isLocal: true },
    };
  },
  listEngines: async () => [await probe()],
  testEngine: probe,
  discoverModels: probe,
};

createMikeDownEditor(el, { host: { onChange, ai, saveSettings /* persists the ai.* keys */ }, settings: { ai: settings } });
```

**Consent.** Cloud engines are off until the user turns on *Allow cloud engines* in the AI tab. Even then, in tier 2 the first request a cloud engine would serve calls your `requestCloudConsent(engineId)`. Show your own dialog naming the engine, its URL and what is sent (the selection and one paragraph for rewrite; `aiConsentText` in `@mikedown/core/ai` has the words), and resolve `true` (allowed for the workspace; core remembers it for the session), `'once'` (this request only; the next one calls you again), `false` (declined; it counts as unusable for that request, and you may answer later calls with `false` without a dialog, as VS Code and Desktop do until a restart) or `'never'` (a stored refusal; core disables the entries for that engine for the session). **A host without `requestCloudConsent` sends to cloud engines without asking** (the *Allow cloud engines* switch still applies), so implement it if users can add cloud engines. Optionally add `listConsents()` (records of `{ engineId, answer, at, scope }`) and `forgetConsent(engineId)`: the AI tab then shows a *Cloud consents* list with a Forget button for each. In tier 1 core never sees which model answers, so consent is your backend's and your UI's to handle.

**Setup wizard.** With no engines configured, the toolbar's AI button opens a setup wizard (on the AI Engines page) instead of the engine form. It uses three more optional methods, each of which just hides its part of the wizard when absent: `detectLocalServers(candidates, signal)` looks for running local servers (one GET each, 1.5 s cap, only on request, never in the background; send a key only to the preset's own address), `hardwareInfo()` reports memory, CPU and GPU for the local model size hint, and `detectHostEngines()` lists models the host itself offers without an address or key (VS Code uses it for GitHub Copilot, the `vscode-lm` engine kind). Set `shellEnv: false` if your process cannot see shell variables, so the engine form points at a key file or a pasted key instead of `apiKeyEnv`. Choosing a cloud provider in the wizard turns *Allow cloud engines* on, and AI turns on when the user finishes with a usable default model.

The wrappers pass `host.ai` through untouched: `host={{ ai }}` in React, `:host` in Vue, the `[ai]` input in Angular, and the `ai` property (properties only, no attribute) on `<mikedown-editor>`. Wrapper docs list the exact binding. The [developers hub](https://www.iadev.net/mikedown/developers/#byo-ai) has a live demo with a stub host that streams canned text.

### Feature ids and request overrides

Each AI feature has an id, and `host.ai` receives requests tagged with it. `rewrite` covers the rewrite popover, Explain and Translate; `summary` covers `/summary` and Summarize document; `title` covers `/title` and Suggest titles; `frontmatter` covers Properties Suggest (tags, title, description); `altText` covers image alt text. The full list is in `packages/core/src/ai/features.ts`. Use the id to route or log a feature, or to turn one off in your own UI.

`AiCompletionRequest.requestOverrides` is a set of extra request body fields (for example `reasoning_effort` or `chat_template_kwargs`). Core fills it when the user changes the thinking dial in the rewrite popover, and merges it over the model's configured overrides, so the request wins. Hosts that do not support per-request fields can ignore it.

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
| `customizeToolbar` | on | Settings > Toolbar section (Customize, Reset). Off keeps the toolbar fixed for the user |

Also built in: tables, task lists, GFM callouts (`> [!NOTE]`), `==highlight==`, footnotes, emoji, wikilinks, code blocks with language picker.

**Toolbar layout.** Users can reorder, remove and add toolbar buttons in the editor (Settings, then Toolbar). The result is one JSON value, `settings.toolbarLayout` (`{ version, items, seen }`, typed `ToolbarLayout`). Pass it in `settings` to preset or restore a layout, and store the value your `host.saveSettings` receives; `null` means Reset to Default, and an absent or invalid value shows the default toolbar. Set `features.customizeToolbar: false` to hide the customize controls; a `toolbarLayout` you pass still applies. `ToolbarLayout`, `ToolbarItemId`, `TOOLBAR_ITEM_IDS`, `DEFAULT_TOOLBAR_LAYOUT` and `normalizeToolbarLayout` are exported from `@mikedown/core`.

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

The core binds `Mod-/` (Cmd on macOS, Ctrl elsewhere) to the source toggle in both the rich editor and source mode. A host that binds the shortcut itself, such as the VS Code keybinding, passes `hostOwnsShortcuts: true` so one keystroke never toggles twice. The same goes for `Mod-Alt-K`, which opens the AI rewrite popover when the host has an `ai` group (VS Code binds it as `mikedown.ai.rewrite`).

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

No telemetry. The editor makes no network calls except the ones you configure: spell check dictionaries (when `spellcheckDictionaryUrl` is set), your `host` callbacks (including `host.ai`, which is the only way AI requests leave the page), and the lazy `import()` of KaTeX and Mermaid from your own bundle.

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
