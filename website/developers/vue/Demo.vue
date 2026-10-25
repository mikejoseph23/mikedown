<script setup lang="ts">
import { ref } from 'vue';
import { MikeDownEditor } from '@mikedown/vue';
import '@mikedown/core/styles.css';
import { stubAiHost, stubAiSettings } from '../common/stub-ai';

// The demo's AI is a stub: it streams canned text and calls no server.
const host = { ai: stubAiHost };
const settings = { ai: stubAiSettings };

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
      :host="host"
      :settings="settings"
      aria-label="Release notes"
    />
    <pre class="demo__value" tabindex="0" aria-label="Markdown value">{{ markdown }}</pre>
  </div>
</template>
