# Changelog

## 0.2.0-rc.0

First release. The MikeDown editor as an Angular form control, folded from the vendored LymeStarter and Quantico Creek copies into one package.

- `MikeDownEditorComponent`, standalone, selectors `<mikedown-editor>` and `<lyme-markdown-editor>` (permanent alias). `MikeDownModule` for NgModule apps.
- ControlValueAccessor on `@mikedown/core`'s `bindMikeDownValue`: pristine writes, 150 ms debounce (`debounceMs`), flush and touched on blur, disabled state.
- Inputs: `theme`, `darkSelector`, `settings`, `features`, `readOnly`, `preserveBrackets`, `placeholder`, `minHeight`, `debounceMs`, `spellcheckDictionaryUrl`, `inputId`, `ariaLabel`, `ariaLabelledBy`, `imageUpload`, `imageBaseUrl`, `imageSrcResolver`. Output `ready`.
- `unescapeBrackets` export (the legacy fork's bracket-token helper).
- Frame styles read `--mikedown-field-*` variables with neutral fallbacks.
- Compiled with Angular 17 in partial-Ivy mode; peers `@angular/*` `>=17.0.0 <23.0.0`, `rxjs` `^7.5.0`. ESM only.
