# Changelog

## 0.2.0

- `bindMikeDownValue` (`@mikedown/core/binding`): the framework-neutral value binding the React, Vue, Angular and web component wrappers are built on (pristine writes, debounced change, flush on blur, read-only, disabled and touched state).
- Editor options for `placeholder`, `id` and ARIA naming, and a landmark role on the editor.
- The bound theme is re-applied only when it changes, which ends a theme update loop.
- List markers are set explicitly, so page CSS resets can no longer strip bullets and numbers.
- Completed task text uses the muted text color, keeping at least 4.5:1 contrast in light and dark themes.
- Task checkboxes are named after their item for screen readers and have a 24 by 24px click and touch target.
- Toolbar buttons that show text have screen reader names that start with that text; toolbar icons are hidden from assistive technology.
- The floating table toolbar shows only while a focused cursor is in a table.
- Toolbar buttons that don't fit move into a More (⋯) menu at the end of the toolbar instead of being cut off.

## 0.1.0

First public release. The MikeDown WYSIWYG markdown editor as a framework-agnostic package, the same editor that ships in the MikeDown VS Code extension and MikeDown Desktop.

- `createMikeDownEditor(element, options)` returns a `MikeDownEditorHandle` (`getMarkdown`, `setMarkdown`, `markSaved`, `setTheme`, `updateSettings`, `setReadOnly`, `setTags`, `setBacklinks`, `setDocMeta`, `scrollToAnchor`, `getHtml`, `command`, `on`, `destroy`).
- `MikeDownHost` interface: only `onChange` is required; every other method is optional and turns its feature off when omitted. `NoopHost` is a minimal ready-made host.
- Rich editing on TipTap (ProseMirror) with `tiptap-markdown`, plus a CodeMirror 6 source mode (`Cmd/Ctrl+/`).
- Feature switches via `options.features`: toolbar, sidebar, source mode, slash commands, spell check, math (KaTeX), Mermaid, find and replace, frontmatter.
- Tables, task lists, GFM callouts, `==highlight==`, footnotes, emoji, wikilinks and code blocks with a language picker.
- Themeable through `--mikedown-*` custom properties (`@mikedown/core/tokens.css`), light, dark and auto themes. Styles ship as `@mikedown/core/styles.css`.
- Bundled Hunspell dictionaries (`en`, `en-GB`) in `dist/dictionaries/`, used only when `spellcheckDictionaryUrl` is set.
- Shared pure helpers under `@mikedown/core/shared/*`.
- ESM only. TipTap, CodeMirror, lowlight and `katex` are peer dependencies; `mermaid` is an optional peer.
