# @mikedown/vue

Vue 3 component for the [MikeDown](https://github.com/mikejoseph23/mikedown) WYSIWYG markdown editor. A thin wrapper over `@mikedown/core`'s `bindMikeDownValue`: `v-model`, theme following, read-only and an accessible name.

## Install

```bash
npm install @mikedown/vue @mikedown/core
```

npm 7+ and pnpm 8+ install core's peers (TipTap, CodeMirror, lowlight, KaTeX) for you. Yarn does not, so list them:

```bash
yarn add @mikedown/vue @mikedown/core vue @codemirror/commands @codemirror/lang-markdown @codemirror/language @codemirror/state @codemirror/theme-one-dark @codemirror/view @tiptap/core @tiptap/extension-code-block-lowlight @tiptap/extension-hard-break @tiptap/extension-highlight @tiptap/extension-image @tiptap/extension-link @tiptap/extension-placeholder @tiptap/extension-table @tiptap/extension-table-cell @tiptap/extension-table-header @tiptap/extension-table-row @tiptap/extension-task-item @tiptap/extension-task-list @tiptap/extension-text @tiptap/pm @tiptap/starter-kit katex lowlight mermaid
```

Requires `vue >=3.3`.

## Use (Vite)

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { MikeDownEditor } from '@mikedown/vue';
import '@mikedown/core/styles.css';

const md = ref('# Hello');
</script>

<template>
  <label id="notes-label">Notes</label>
  <MikeDownEditor v-model="md" aria-labelledby="notes-label" placeholder="Start writing..." />
</template>
```

Register it globally instead:

```ts
import { createApp } from 'vue';
import MikeDown from '@mikedown/vue';

createApp(App).use(MikeDown).mount('#app');
```

Give the editor a height with CSS on the component (`class` and `style` land on its container).

## Nuxt

The editor needs the DOM, so render it on the client only:

```vue
<template>
  <ClientOnly>
    <MikeDownEditor v-model="md" />
  </ClientOnly>
</template>

<script setup lang="ts">
import { MikeDownEditor } from '@mikedown/vue';
import '@mikedown/core/styles.css';

const md = ref('# Hello');
</script>
```

If the server render complains about the stylesheet import, add `@mikedown/core` and `@mikedown/vue` to `build.transpile`.

## Props

| Prop | Type | Notes |
| --- | --- | --- |
| `modelValue` | `string` | Use with `v-model`. External changes load as the pristine baseline and are skipped when equal to the current text. |
| `theme` | `'light' \| 'dark' \| 'auto'` | Default `'auto'`: follows `darkSelector`, else `prefers-color-scheme`. Reactive. |
| `readOnly` | `boolean` | Reactive. |
| `disabled` | `boolean` | Reactive; implies read-only. |
| `placeholder` | `string` | Read once at mount. `host.ai` goes to the core untouched; see [Bring your own AI](https://github.com/mikejoseph23/mikedown/tree/main/packages/core#bring-your-own-ai). |
| `features` | `Partial<MikeDownFeatures>` | Read once at mount. |
| `settings` | `Partial<MikeDownSettings>` | Initial settings; later changes are pushed with `updateSettings`. |
| `host` | `Partial<MikeDownHost>` | Image upload, wikilinks and other host methods. Read once at mount. |
| `darkSelector` | `string` | CSS selector for `theme="auto"`, such as `html.dark`. |
| `id`, `aria-label`, `aria-labelledby` | `string` | Go to the editable surface, not the wrapper. A `<label for="id">` names it. |

**Toolbar layout.** Users can reorder, remove and add toolbar buttons in the editor (Settings, then Toolbar). The result is one JSON value, `settings.toolbarLayout` (`{ version, items, seen }`, typed `ToolbarLayout`). Pass it in `settings` to preset or restore a layout, and store the value your `host.saveSettings` receives; `null` means Reset to Default, and an absent or invalid value shows the default toolbar. Set `features.customizeToolbar: false` to hide the customize controls; a `toolbarLayout` you pass still applies. `ToolbarLayout`, `ToolbarItemId`, `TOOLBAR_ITEM_IDS`, `DEFAULT_TOOLBAR_LAYOUT` and `normalizeToolbarLayout` are exported from `@mikedown/core`.

## Events and expose

- `update:modelValue(markdown)`: debounced while typing (150 ms), immediate on blur.
- `ready(handle)`: the editor is up.

A template ref exposes `handle`, the `MikeDownEditorHandle` (`null` until mounted):

```ts
const editor = ref<{ handle: MikeDownEditorHandle | null }>();
editor.value?.handle?.command('toggleBold');
```

## Accessibility

The editable surface is a `role="textbox"` with `aria-multiline="true"`. `aria-labelledby` is the sturdiest way to name it; `aria-label` works too. `<label for>` cannot target a contenteditable `div`, so with only an `id` the component finds `label[for=id]` at mount, uses it as the name and focuses the editor when the label is clicked. The accessible name follows ARIA's order: `aria-labelledby`, then `aria-label`, then `<label for>` elements. The editor is not a page landmark (no `role="main"`).

## Notes

- Created in `onMounted` and destroyed in `onBeforeUnmount`; pending text is flushed first.
- No `defineModel`, so Vue 3.3 works.
- Testing: use vitest with jsdom, stubbing `Range.prototype.getBoundingClientRect` and `getClientRects`. Jest: add `transformIgnorePatterns: ['/node_modules/(?!(@mikedown|lowlight|devlop)/)']` so the ESM-only packages in core's import graph get transformed (TipTap, CodeMirror and `tiptap-markdown` ship `require` builds). vitest is the recommended runner.
- ESM only.

## Theming

Colors, fonts and radii come from `--mikedown-*` custom properties, set on the editor or any ancestor. The token list, light and dark defaults and the portal note are in the [`@mikedown/core` README](https://www.npmjs.com/package/@mikedown/core#theming).

## Browser support

Current Chrome, Edge, Firefox and Safari (ES2020 output, ESM only).

## Privacy

No telemetry. The editor makes no network calls except the ones you configure: spell check dictionaries (when you set a dictionary URL), your `uploadImage` / `host` callbacks, and the lazy `import()` of KaTeX and Mermaid from your own bundle.

## Links

- [Live demo](https://www.iadev.net/mikedown/developers/vue/)
- [Developers hub](https://www.iadev.net/mikedown/developers/)
- [npm](https://www.npmjs.com/package/@mikedown/vue)
- [GitHub](https://github.com/mikejoseph23/mikedown/tree/main/packages/vue)

## License

MIT
