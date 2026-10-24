# Changelog

## 0.2.0 (unreleased)

First release. `<mikedown-editor>`, the MikeDown markdown editor as a custom element built on `@mikedown/core`'s `bindMikeDownValue`.

- Light DOM element; `@mikedown/web-component` exports `MikeDownElement` and `defineMikeDownElement(tag)`, `@mikedown/web-component/define` registers `<mikedown-editor>`.
- Form-associated: `name`, `required` (`valueMissing`), reset, disabled fieldsets, state restore, `checkValidity()` / `reportValidity()`.
- Reflected attributes `value`, `theme`, `readonly`, `disabled`, `placeholder`, `name`, `required`, `min-height`, `dark-selector`, `spellcheck-dictionary-url`, `features`, `debounce`; properties `value`, `settings`, `host`, `handle`.
- `change` (debounced, at once on blur) and `ready` events.
- Progressive enhancement from a child `<textarea>` or `<script type="text/markdown">`.
- `<label for>`, `aria-label` and `aria-labelledby` name the editable surface.
- `dist/mikedown-editor.standalone.js`: a no-build CDN bundle with core, its peers and CSS; KaTeX and Mermaid load from jsDelivr on first use. Third-party licenses in `THIRD_PARTY_NOTICES.md`.
