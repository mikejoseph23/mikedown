# @mikedown/web-component

`<mikedown-editor>`: the MikeDown WYSIWYG markdown editor as a form-associated custom element. It is the route for plain HTML pages, CDN and no-build pages, htmx, server-rendered templates (Rails, Django, Razor, Laravel), and frameworks without a dedicated MikeDown package (Lit, Svelte, Solid, Preact, Blazor). React, Vue and Angular have their own packages.

```html
<form method="post" action="/posts">
  <label for="body">Body</label>
  <mikedown-editor id="body" name="body" required></mikedown-editor>
  <button>Save</button>
</form>
```

It submits like a `<textarea>`: the markdown goes out under its `name`, `required` blocks an empty submit, and a reset puts the initial text back.

- Light DOM (no shadow root), so page CSS and `--mikedown-*` tokens reach the editor.
- ESM only, typed, telemetry-free.

## Install

```bash
npm install @mikedown/web-component @mikedown/core
```

`@mikedown/core` is a peer dependency, and its own peers (TipTap, CodeMirror, lowlight, KaTeX) install with it on npm 7+ and pnpm 8+. Yarn does not install peers, so list them:

```bash
yarn add @mikedown/web-component @mikedown/core @codemirror/commands @codemirror/lang-markdown @codemirror/language @codemirror/state @codemirror/theme-one-dark @codemirror/view @tiptap/core @tiptap/extension-code-block-lowlight @tiptap/extension-hard-break @tiptap/extension-highlight @tiptap/extension-image @tiptap/extension-link @tiptap/extension-placeholder @tiptap/extension-table @tiptap/extension-table-cell @tiptap/extension-table-header @tiptap/extension-table-row @tiptap/extension-task-item @tiptap/extension-task-list @tiptap/extension-text @tiptap/pm @tiptap/starter-kit katex lowlight mermaid
```

Or skip all of it with the CDN bundle below.

## Use with a bundler

```js
import '@mikedown/core/styles.css';
import '@mikedown/web-component/define'; // registers <mikedown-editor>
```

Or register it yourself, under another tag if you like:

```js
import '@mikedown/core/styles.css';
import { defineMikeDownElement, MikeDownElement } from '@mikedown/web-component';

defineMikeDownElement();               // <mikedown-editor>
defineMikeDownElement('md-field');     // also <md-field>
```

`defineMikeDownElement` is safe to call more than once. Only `@mikedown/web-component/define` has side effects; importing the package root defines nothing.

## Use from a CDN (no build step)

One `<script type="module">` loads a self-contained bundle: core, its peers and its CSS, and it defines `<mikedown-editor>` on load. Pin the version; never use `@latest`.

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@mikedown/web-component@0.2.0/dist/mikedown-editor.standalone.js"></script>

<mikedown-editor name="notes" value="# Hello"></mikedown-editor>
```

unpkg works the same way:

```html
<script type="module" src="https://unpkg.com/@mikedown/web-component@0.2.0/dist/mikedown-editor.standalone.js"></script>
```

About the bundle:

- It is about 815 kB gzipped up front (the budget is 850 kB). Most of that is syntax highlighting for every language highlight.js knows.
- It is split into a few files next to each other in `dist/`: the entry, a chunk it imports at once, and the AI UI (about 56 kB gzipped), which loads only when an element gets an `ai` host. The one `<script>` tag above is all a page needs; the browser fetches the chunks from the same folder. To self-host, copy every `dist/mikedown-editor.*.js` file, not only the entry.
- The stylesheet goes into one `<style id="mikedown-styles">` at the start of `<head>`, once per page, so your own stylesheets come later and win. Don't also load `@mikedown/core/styles.css`.
- KaTeX and Mermaid are not bundled. The first formula loads KaTeX (and one `<link>` to its CSS) from jsDelivr, the first diagram loads Mermaid, both pinned to the versions the bundle was built with. Turn either off with `features='{"math":false}'` or `features='{"mermaid":false}'` and nothing is fetched.
- To use the module's exports (`MikeDownElement`, `defineMikeDownElement`), import the same URL: `import { MikeDownElement } from 'https://cdn.jsdelivr.net/npm/@mikedown/web-component@0.2.0/dist/mikedown-editor.standalone.js'`.
- It redistributes TipTap, ProseMirror, CodeMirror, lowlight, highlight.js, markdown-it and friends; their licenses are in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md), shipped in the package.

Spell checking needs dictionaries. Point `spellcheck-dictionary-url` at the folder that holds `en/` and `en-GB/` (core appends the language), for example core's copy on jsDelivr:

```html
<mikedown-editor spellcheck-dictionary-url="https://cdn.jsdelivr.net/npm/@mikedown/core@0.2.0/dist/dictionaries"></mikedown-editor>
```

## Attributes

Every attribute has a matching property; setting either updates the other.

| Attribute | Property | Default | |
|---|---|---|---|
| `value` | `defaultValue` | `''` | Initial markdown and the form-reset target. Changing it later replaces the content. |
| `name` | `name` | | Form field name. |
| `required` | `required` | off | Empty (or whitespace only) is `valueMissing`. |
| `disabled` | `disabled` | off | Read-only and left out of the form submission. A disabled `<fieldset>` does the same. |
| `readonly` | `readOnly` | off | Read-only; still submitted. |
| `placeholder` | `placeholder` | core's | Text shown in an empty editor. |
| `theme` | `theme` | `auto` | `light`, `dark` or `auto`. |
| `dark-selector` | `darkSelector` | | With `auto`: dark when `element.closest(selector)` matches (`html.dark`, `html[data-mode=dark]`, `.dark-theme`); without it `auto` follows `prefers-color-scheme`. |
| `min-height` | `minHeight` | `240px` | Any CSS length; a bare number means pixels. Sets `--mikedown-min-height`. |
| `spellcheck-dictionary-url` | `spellcheckDictionaryUrl` | | Folder base of the Hunspell dictionaries. Spell checking stays off without it. |
| `features` | `features` | all on but `sidebar` | JSON object of feature switches: `toolbar`, `sidebar`, `sourceMode`, `slashCommands`, `spellcheck`, `math`, `mermaid`, `findReplace`, `frontmatter`. |
| `debounce` | `debounce` | `150` | Milliseconds of quiet before `change` fires. |
| `aria-label`, `aria-labelledby` | | | Forwarded to the editable surface. |

`placeholder`, `features`, `dark-selector`, `spellcheck-dictionary-url`, `debounce` and the ARIA attributes are read when the editor is created; changing one rebuilds the editor and keeps the text.

## Properties

| Property | Type | |
|---|---|---|
| `value` | `string` | The current markdown, updated on every keystroke. Setting it loads the text as the clean baseline and fires no `change`. |
| `settings` | `Partial<MikeDownSettings>` | Core settings (`fontFamily`, `fontSize`, `contentWidth`, `spellCheckLanguage`, ...), applied live. |
| `host` | `Partial<MikeDownHost>` | Host methods: `uploadImage`, `openLink`, `resolveImageSrc`, `pickImage`, `getLinkSuggestions`, ... Core turns a feature on only when its method is present. Setting it rebuilds the editor. |
| `ai` | `MikeDownAiHost` | The AI host group (`complete`, and for tier 2 `listEngines`, ...), passed to the core untouched. A property only, no attribute; `host.ai` works too. Setting it rebuilds the editor. See [Bring your own AI](https://github.com/mikejoseph23/mikedown/tree/main/packages/core#bring-your-own-ai). |
| `handle` | `MikeDownEditorHandle \| null` | Read only. The core editor handle while connected (`command`, `getHtml`, `insertImage`, ...). |
| `form`, `labels`, `validity`, `validationMessage`, `willValidate` | | As on native form controls. |

Methods: `focus()`, `checkValidity()`, `reportValidity()`.

**Toolbar layout.** Users can reorder, remove and add toolbar buttons in the editor (Settings, then Toolbar). The result is one JSON value, `settings.toolbarLayout` (`{ version, items, seen }`, typed `ToolbarLayout`). Pass it in `settings` to preset or restore a layout, and store the value your `host.saveSettings` receives; `null` means Reset to Default, and an absent or invalid value shows the default toolbar. Set `features.customizeToolbar: false` to hide the customize controls; a `toolbarLayout` you pass still applies. `ToolbarLayout`, `ToolbarItemId`, `TOOLBAR_ITEM_IDS`, `DEFAULT_TOOLBAR_LAYOUT` and `normalizeToolbarLayout` are exported from `@mikedown/core`.

Function-valued options (`host`) and objects (`settings`) are properties only:

```js
const editor = document.querySelector('mikedown-editor');
editor.settings = { fontFamily: 'Georgia, serif', contentWidth: '720px' };
editor.host = {
  async uploadImage({ bytes, mime, name }) {
    const res = await fetch('/uploads', { method: 'POST', headers: { 'Content-Type': mime }, body: bytes });
    return { src: (await res.json()).url, alt: name };
  },
  openLink(href) { window.open(href, '_blank', 'noopener'); },
};
```

## Events

Both bubble and are composed.

| Event | `detail` | When |
|---|---|---|
| `change` | `{ value }` | After the user stops typing (`debounce`, 150 ms), and at once when focus leaves the editor. Not for programmatic `value` writes. |
| `ready` | `{ handle }` | A microtask after the editor is created: on connect, and again after a rebuild or a move in the DOM. |

```js
editor.addEventListener('change', (e) => save(e.detail.value));
```

Native `change` events from inputs inside the editor (the find bar, dialogs) are stopped at the element, so a `change` listener only hears the element's own.

## Forms

The element is form-associated (`ElementInternals`), so `new FormData(form)`, a plain submit, `form.reset()`, `form.reportValidity()`, `:invalid`, a disabled `<fieldset>` and the browser's back/forward form restore all work as they do for a `<textarea>`.

- **Value:** the form value is kept current on every keystroke, so a submit right after typing sends the latest text.
- **Reset:** goes back to the `value` attribute, or to the server-rendered text below.
- **Required:** an empty editor reports `valueMissing`; `reportValidity()` points the browser's message at the editor.
- **Without form internals** (jsdom in tests, very old browsers) the element falls back to a hidden `<input>` with the same name, so `FormData` still sees the value.

## Server-rendered pages (progressive enhancement)

Render a `<textarea>` inside the element. Without JavaScript the textarea is the field. Once the element upgrades, it takes the textarea's text as its value, takes over its `name`, `required` and `placeholder`, and hides and disables it so the value is submitted once.

```erb
<%# Rails %>
<mikedown-editor>
  <%= f.text_area :body %>
</mikedown-editor>
```

```django
{# Django #}
<mikedown-editor>{{ form.body }}</mikedown-editor>
```

```cshtml
@* Razor *@
<mikedown-editor>
  <textarea asp-for="Body"></textarea>
</mikedown-editor>
```

For read-mostly pages, `<script type="text/markdown">` works too; its template indentation is removed:

```html
<mikedown-editor name="notes">
  <script type="text/markdown">
    # Meeting notes

    - Decide on the launch date
  </script>
</mikedown-editor>
```

A `value` attribute wins over child content. Use a textarea when the text may contain `</script>`.

## htmx

`change` bubbles, so a form can save as the user types:

```html
<form hx-post="/notes/42" hx-trigger="change delay:500ms" hx-swap="none">
  <mikedown-editor name="body" value="# Notes"></mikedown-editor>
</form>
```

htmx reads the form with `FormData`, which includes the element's value. Swapping in HTML that contains `<mikedown-editor>` creates the editor when it connects and destroys the one that was swapped out.

## Labels and accessibility

- `<label for="id">` names the editor and focuses it on click. The element keeps its own `id`; the label is linked to the editable surface through `aria-labelledby`. Prefer `<label for>` to a wrapping `<label>`.
- The accessible name of the editable surface follows ARIA's order: `aria-labelledby`, then `aria-label`, then the element's `<label>`s.
- The surface has `role="textbox"` and `aria-multiline="true"`. The editor is not a page landmark.

## Styling

- The element is `display: block` (set at zero specificity, so any rule of yours wins). The editor fills the element; give it a height, or rely on `min-height` (240px by default).
- Theme the editor with the `--mikedown-*` tokens from `@mikedown/core/tokens.css`, for example `mikedown-editor { --mikedown-font-ui: Inter, sans-serif; --mikedown-surface: #fff; --mikedown-text: #111; }`. See the [core README](https://github.com/mikejoseph23/mikedown/tree/main/packages/core) for the full list. The document font and size come from `settings` (`fontFamily`, `headingFontFamily`, `fontSize`).
- `dark-selector` follows your app's dark mode: `<mikedown-editor dark-selector="html.dark">`.
- CSS resets: the editor sets its own list markers, heading sizes and margins, so a reset such as Tailwind's preflight (`ul, ol { list-style: none }`) does not reach editor content. If a reset still changes colors or type, override the tokens above.

## Frameworks

The element works anywhere custom elements do. Set `value`, `settings`, `host` and `features` as properties where the framework allows it:

```html
<!-- Lit -->
<mikedown-editor .value=${this.body} .host=${this.host} @change=${(e) => (this.body = e.detail.value)}></mikedown-editor>

<!-- Svelte -->
<mikedown-editor value={body} on:change={(e) => (body = e.detail.value)}></mikedown-editor>
```

React, Vue and Angular: use `@mikedown/react`, `@mikedown/vue` or `@mikedown/angular`, which wrap core directly.

## Testing

Use vitest with jsdom (the element falls back to a hidden `<input>` without form internals). Jest: add `transformIgnorePatterns: ['/node_modules/(?!(@mikedown|lowlight|devlop)/)']` so the ESM-only packages in core's import graph get transformed (TipTap, CodeMirror and `tiptap-markdown` ship `require` builds). vitest is the recommended runner.

## Known limitations

- **Several editors on one page share some state.** Core's menus and dialogs live in one `.mikedown-portal` that follows the last-focused editor, Mermaid's theme is set page-wide, and turning `math` off in one editor's `features` turns KaTeX rendering off for every editor on the page. Give editors on the same page the same `math` switch.
- **Moving the element** in the DOM destroys and recreates the editor (keeping the text, and reporting a pending edit as `change` first). Undo history and the caret do not survive the move.

## Theming

Colors, fonts and radii come from `--mikedown-*` custom properties, set on the editor or any ancestor. The token list, light and dark defaults and the portal note are in the [`@mikedown/core` README](https://www.npmjs.com/package/@mikedown/core#theming).

## Browser support

Current Chrome, Edge, Firefox and Safari (ES2020 output, ESM only). The element itself needs form-associated custom elements: Chrome 77+, Firefox 98+, Safari 16.4+.

## Privacy

No telemetry. The editor makes no network calls except the ones you configure: spell check dictionaries (when you set a dictionary URL), your `uploadImage` / `host` callbacks, and the lazy `import()` of KaTeX and Mermaid from your own bundle (the CDN bundle loads KaTeX and Mermaid from jsDelivr instead; turn them off in `features` and nothing is fetched).

## Links

- [Live demo](https://www.iadev.net/mikedown/developers/web-component/)
- [Developers hub](https://www.iadev.net/mikedown/developers/)
- [npm](https://www.npmjs.com/package/@mikedown/web-component)
- [GitHub](https://github.com/mikejoseph23/mikedown/tree/main/packages/web-component)

## License

MIT. The standalone bundle includes third-party code under MIT, ISC, BSD-2-Clause and BSD-3-Clause licenses; see [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
