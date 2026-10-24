# @mikedown/vue

Vue 3 component for the [MikeDown](https://github.com/mikejoseph23/mikedown) WYSIWYG markdown editor. A thin wrapper over `@mikedown/core`'s `bindMikeDownValue`: `v-model`, theme following, read-only and an accessible name.

## Install

```bash
npm install @mikedown/vue @mikedown/core
```

Yarn does not install peers. Add core's peers by hand (the full list is in the `@mikedown/core` README).

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
| `placeholder` | `string` | Read once at mount. |
| `features` | `Partial<MikeDownFeatures>` | Read once at mount. |
| `settings` | `Partial<MikeDownSettings>` | Initial settings; later changes are pushed with `updateSettings`. |
| `host` | `Partial<MikeDownHost>` | Image upload, wikilinks and other host methods. Read once at mount. |
| `darkSelector` | `string` | CSS selector for `theme="auto"`, such as `html.dark`. |
| `id`, `aria-label`, `aria-labelledby` | `string` | Go to the editable surface, not the wrapper. A `<label for="id">` names it. |

## Events and expose

- `update:modelValue(markdown)`: debounced while typing (150 ms), immediate on blur.
- `ready(handle)`: the editor is up.

A template ref exposes `handle`, the `MikeDownEditorHandle` (`null` until mounted):

```ts
const editor = ref<{ handle: MikeDownEditorHandle | null }>();
editor.value?.handle?.command('toggleBold');
```

## Notes

- Created in `onMounted` and destroyed in `onBeforeUnmount`; pending text is flushed first.
- No `defineModel`, so Vue 3.3 works.
- MIT, ESM only.
