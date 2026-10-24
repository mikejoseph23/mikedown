# Changelog

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
