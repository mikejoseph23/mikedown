# @mikedown/react

The MikeDown WYSIWYG markdown editor as a React component. It wraps [`@mikedown/core`](https://www.npmjs.com/package/@mikedown/core) (TipTap for rich text, CodeMirror 6 for source mode) and maps props onto its value binding: debounced change reporting, pristine loads, a theme that can follow the page.

ESM only. React 18 and 19.

## Install

```bash
npm install @mikedown/react @mikedown/core react react-dom
```

`@mikedown/core` is a peer, and it has peers of its own (TipTap, CodeMirror, lowlight, KaTeX, optional Mermaid). npm 7+ and pnpm 8+ install them for you. Yarn does not install peers, so list them:

```bash
yarn add @mikedown/react @mikedown/core react react-dom @codemirror/commands @codemirror/lang-markdown @codemirror/language @codemirror/state @codemirror/theme-one-dark @codemirror/view @tiptap/core @tiptap/extension-code-block-lowlight @tiptap/extension-hard-break @tiptap/extension-highlight @tiptap/extension-image @tiptap/extension-link @tiptap/extension-placeholder @tiptap/extension-table @tiptap/extension-table-cell @tiptap/extension-table-header @tiptap/extension-table-row @tiptap/extension-task-item @tiptap/extension-task-list @tiptap/extension-text @tiptap/pm @tiptap/starter-kit katex lowlight mermaid
```

pnpm with `auto-install-peers=false` needs the same list.

Import the stylesheet once:

```ts
import '@mikedown/core/styles.css';
```

## Usage

Controlled:

```tsx
import { useState } from 'react';
import { MikeDownEditor } from '@mikedown/react';
import '@mikedown/core/styles.css';

export function Notes() {
  const [markdown, setMarkdown] = useState('# Hello\n\nStart typing.');
  return (
    <MikeDownEditor
      value={markdown}
      onChange={setMarkdown}
      aria-label="Meeting notes"
      style={{ height: 400 }}
    />
  );
}
```

Uncontrolled:

```tsx
<MikeDownEditor defaultValue="# Draft" onChange={(md) => save(md)} />
```

The editor fills its container, so give the component a height through `style` or `className` (it falls back to a 240px minimum).

### Props

| Prop | Notes |
| --- | --- |
| `value` / `onChange` | Controlled markdown. `onChange` fires after `debounceMs` (default 150) of quiet and at once on blur. |
| `defaultValue` | Initial markdown when uncontrolled. Read once. |
| `theme` | `'light'`, `'dark'` or `'auto'` (default). Reactive. |
| `darkSelector` | For `'auto'`: dark when the editor or an ancestor matches, e.g. `html[data-mode=dark]` or `.dark-theme`. Without it, `auto` follows `prefers-color-scheme`. Read at mount. |
| `readOnly`, `disabled` | Reactive. `disabled` is read-only too. |
| `placeholder`, `features` | Read at mount. `features` switches the toolbar, sidebar, source mode, slash commands, spellcheck, math, mermaid, find/replace and frontmatter. |
| `settings` | Core settings (`fontSize`, `contentWidth`, ...). Compared by content; changes call `updateSettings`. |
| `host` | Optional host methods (image upload, wikilinks, ...). Read through a ref, so a new object never recreates the editor. The set of methods present is fixed at mount, because a missing method turns its feature off. |
| `id`, `aria-label`, `aria-labelledby` | Go on the editable surface. With only an `id`, a `<label for>` is found and used as the name. See [Accessibility](#accessibility). |
| `className`, `style` | On the wrapper `div`. |
| `onReady(handle)` | Called when the editor exists. |
| `onBlur` | Focus left the editor and its toolbar (like a native input's blur). |
| `debounceMs`, `spellcheckDictionaryUrl` | Read at mount. |

The ref is a `MikeDownEditorHandle` (`getMarkdown`, `setMarkdown`, `focus`, `command`, `tiptap`, ...):

```tsx
const ref = useRef<MikeDownEditorHandle>(null);
<MikeDownEditor ref={ref} defaultValue="" />;
ref.current?.command('toggleBold');
```

Calls on the ref before mount or after unmount do nothing.

### Behavior

- The editor is created in an effect and destroyed on cleanup, so it survives React StrictMode's mount, unmount, mount. Unmounting flushes a pending change to `onChange`.
- A parent re-render with the same `value` never touches the document, and a value that equals what the editor already shows is skipped, so the caret stays where it is. An external value loads as the pristine baseline.
- `onChange` and `host` are read through a ref; passing a fresh function each render is fine.
- Nothing touches the DOM at import or render, so server rendering works. The server renders an empty `div`; the editor appears after hydration.

## Accessibility

The editable surface is a `role="textbox"` with `aria-multiline="true"`. Pass `aria-labelledby` (the sturdiest option) or `aria-label`. `<label for>` cannot target a contenteditable `div`, so with only an `id` the component finds `label[for=id]` at mount, uses it as the name and focuses the editor when the label is clicked. The accessible name follows ARIA's order: `aria-labelledby`, then `aria-label`, then `<label for>` elements. The editor is not a page landmark (no `role="main"`). `focus()` is on the ref.

## Vite

```bash
npm create vite@latest my-app -- --template react-ts
cd my-app
npm install @mikedown/react @mikedown/core react react-dom
```

Install the core peers (see the core README), then in `src/App.tsx`:

```tsx
import { useState } from 'react';
import { MikeDownEditor } from '@mikedown/react';
import '@mikedown/core/styles.css';

export default function App() {
  const [md, setMd] = useState('# Hello');
  return (
    <>
      <MikeDownEditor value={md} onChange={setMd} style={{ height: '60vh' }} aria-label="Document" />
      <pre>{md}</pre>
    </>
  );
}
```

`@mikedown/react` ships `'use client'` and no bundler config is needed. Vite needs no plugin. Pre-bundling is automatic.

## Next.js (app router)

The package's entry already starts with `'use client'`, so a Server Component page can import it. Keep state in a small client component:

```tsx
// app/notes/editor.tsx
'use client';

import { useState } from 'react';
import { MikeDownEditor } from '@mikedown/react';
import '@mikedown/core/styles.css';

export function NotesEditor({ initial }: { initial: string }) {
  const [md, setMd] = useState(initial);
  return <MikeDownEditor value={md} onChange={setMd} aria-label="Notes" style={{ height: 480 }} />;
}
```

```tsx
// app/notes/page.tsx (a Server Component)
import { NotesEditor } from './editor';

export default async function Page() {
  const initial = await loadNotes();
  return <NotesEditor initial={initial} />;
}
```

Add the packages to `transpilePackages` only if your Next version cannot load them as ESM:

```js
// next.config.js
module.exports = { transpilePackages: ['@mikedown/react', '@mikedown/core'] };
```

To keep the editor's code out of the first bundle, load it with `next/dynamic`:

```tsx
'use client';
import dynamic from 'next/dynamic';

const MikeDownEditor = dynamic(() => import('@mikedown/react').then((m) => m.MikeDownEditor), { ssr: false });
```

## Testing

Use vitest with jsdom. The editor measures layout, which jsdom lacks, so stub `Range.prototype.getBoundingClientRect` and `getClientRects` (see this package's tests). Jest: add `transformIgnorePatterns: ['/node_modules/(?!(@mikedown|lowlight|devlop)/)']` so the ESM-only packages in core's import graph get transformed (TipTap, CodeMirror and `tiptap-markdown` ship `require` builds). vitest is the recommended runner.

## Theming

Colors, fonts and radii come from `--mikedown-*` custom properties, set on the editor or any ancestor. The token list, light and dark defaults and the portal note are in the [`@mikedown/core` README](https://www.npmjs.com/package/@mikedown/core#theming).

## Browser support

Current Chrome, Edge, Firefox and Safari (ES2020 output, ESM only).

## Privacy

No telemetry. The editor makes no network calls except the ones you configure: spell check dictionaries (when you set a dictionary URL), your `uploadImage` / `host` callbacks, and the lazy `import()` of KaTeX and Mermaid from your own bundle.

## Links

- [Live demo](https://www.iadev.net/mikedown/developers/react/)
- [Developers hub](https://www.iadev.net/mikedown/developers/)
- [npm](https://www.npmjs.com/package/@mikedown/react)
- [GitHub](https://github.com/mikejoseph23/mikedown/tree/main/packages/react)

## License

MIT
