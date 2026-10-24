<script setup lang="ts">
import { ref } from 'vue';
import { MikeDownEditor } from '@mikedown/vue';
import '@mikedown/core/styles.css';

defineProps<{ theme?: 'auto' | 'light' | 'dark'; readOnly?: boolean }>();

const markdown = ref(`# Release notes

Edit this text. The markdown value follows **as you type**.

- [x] Tables, task lists and code blocks
- [ ] Diagrams and math

| Framework | Package |
| --- | --- |
| Vue | @mikedown/vue |

Type / for headings, callouts and more.
`);
</script>

<template>
  <div class="demo">
    <MikeDownEditor
      v-model="markdown"
      class="demo__editor"
      :theme="theme"
      :read-only="readOnly"
      aria-label="Release notes"
    />
    <pre class="demo__value" tabindex="0" aria-label="Markdown value">{{ markdown }}</pre>
  </div>
</template>
