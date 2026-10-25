# @mikedown/angular

The MikeDown WYSIWYG markdown editor as an Angular form control. The value is a markdown string; it works with reactive forms and `ngModel`. Built on [`@mikedown/core`](https://www.npmjs.com/package/@mikedown/core) (TipTap rich view, CodeMirror source view, the same editor as the MikeDown VS Code extension).

- Standalone component, selector `<mikedown-editor>` (alias `<lyme-markdown-editor>`, kept permanently). `MikeDownModule` for NgModule apps.
- Loading a value (`setValue`, `patchValue`, `reset`, `ngModel`) never marks the control dirty. Typing reports the markdown 150 ms after the last keystroke, and at once when focus leaves the control.
- ESM only, typed, no telemetry. MIT.

## Supported Angular versions

| Angular | Status |
| --- | --- |
| 17, 18, 19, 20, 21, 22 | Supported (peer range `>=17.0.0 <23.0.0`) |
| 16 and older | Not supported |

Angular 22's CLI needs Node 22.22.3 or newer, 24.15 or newer, or 26. On older Node it refuses to run, whatever this package does.

The library is compiled with Angular 17 in partial-Ivy mode, so your app's compiler links it for whichever supported version you run. The specs run on Angular 19; consumer builds are checked on 17, 19 and 22. `rxjs` `^7.5`. `@angular/router` is a peer because links use it when it is provided; an app without routes works too.

## Install

```bash
npm install @mikedown/angular @mikedown/core mermaid
```

npm 7+ and pnpm 8+ install core's peers (TipTap, CodeMirror, lowlight, KaTeX) for you. Install `mermaid` yourself even though it is an optional peer of core: diagrams load lazily, but the Angular builder still resolves `import('mermaid')` at build time and fails without it.

Yarn does not install peers, so list them:

```bash
yarn add @mikedown/angular @mikedown/core @codemirror/commands @codemirror/lang-markdown @codemirror/language @codemirror/state @codemirror/theme-one-dark @codemirror/view @tiptap/core @tiptap/extension-code-block-lowlight @tiptap/extension-hard-break @tiptap/extension-highlight @tiptap/extension-image @tiptap/extension-link @tiptap/extension-placeholder @tiptap/extension-table @tiptap/extension-table-cell @tiptap/extension-table-header @tiptap/extension-table-row @tiptap/extension-task-item @tiptap/extension-task-list @tiptap/extension-text @tiptap/pm @tiptap/starter-kit katex lowlight mermaid
```

### angular.json: styles and dictionaries

Add the editor stylesheet to `styles`, and (for spell check) copy core's dictionaries into your assets:

```json
"build": {
  "options": {
    "styles": ["node_modules/@mikedown/core/dist/styles.css", "src/styles.css"],
    "assets": [
      { "glob": "**/*", "input": "node_modules/@mikedown/core/dist/dictionaries", "output": "assets/mikedown-dictionaries" }
    ]
  }
}
```

From Sass, `@use '@mikedown/core/styles.css';` in `styles.scss` works instead of the `styles` entry. The stylesheet is scoped to the editor (`.mikedown-root`, `.mikedown-portal`) and imports KaTeX's CSS. Spell check stays off until you pass the dictionaries' folder: `spellcheckDictionaryUrl="/assets/mikedown-dictionaries"` (the folder that holds `en/` and `en-GB/`; the editor appends the language).

## Standalone components

```ts
import { Component } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MikeDownEditorComponent } from '@mikedown/angular';

@Component({
  selector: 'app-note-form',
  standalone: true,
  imports: [ReactiveFormsModule, MikeDownEditorComponent],
  template: `
    <form [formGroup]="form">
      <label for="notes">Notes</label>
      <mikedown-editor formControlName="notes" inputId="notes" minHeight="320px" />
    </form>
  `,
})
export class NoteFormComponent {
  form = new FormGroup({
    notes: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
}
```

`Validators.required` treats an empty editor as invalid, and `.ng-invalid.ng-touched` draws the invalid border. `control.disable()` makes the editor read-only and the frame inert.

### ngModel

```ts
@Component({
  standalone: true,
  imports: [FormsModule, MikeDownEditorComponent],
  template: `<mikedown-editor [(ngModel)]="body" ariaLabel="Message body" />`,
})
export class MessageComponent {
  body = '# Hello';
}
```

## NgModule apps

```ts
import { NgModule } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MikeDownModule } from '@mikedown/angular';

@NgModule({
  imports: [ReactiveFormsModule, MikeDownModule],
  declarations: [NoteFormComponent],
})
export class NotesModule {}
```

Import it into the feature module that uses the editor (not a shared module) so the editor stays in that feature's lazy chunk.

## Inputs and outputs

| Input | Default | Notes |
| --- | --- | --- |
| `theme` | `'auto'` | `'auto'` follows `darkSelector`, or the OS (`prefers-color-scheme`) without one. `'light'` or `'dark'` pins it. |
| `darkSelector` | none | CSS selector that means dark, matched with `closest()` from the editor: `html[data-mode=dark]`, `.dark-theme`. Changes to the attributes it names are followed. Read once. |
| `settings` | `{}` | `Partial<MikeDownSettings>`: `fontFamily`, `headingFontFamily`, `fontSize`, `contentWidth`, `headingNumbering`... See [Settings](#settings). |
| `features` | `{}` | `Partial<MikeDownFeatures>`: `toolbar`, `sourceMode`, `slashCommands`, `math`, `mermaid`, `findReplace`, `frontmatter`, `spellcheck`. The sidebar and support card stay off. Read once. |
| `readOnly` | `false` | Text stays selectable; the toolbar greys out. |
| `preserveBrackets` | `false` | Report literal `[` and `]` unescaped. See [Bracket tokens](#bracket-tokens). |
| `placeholder` | core's "Type / for commands" | Shown in an empty editor. Read once. |
| `minHeight` | `'240px'` | Starting height and the smallest the user can drag it to (the frame resizes vertically). Any CSS length. |
| `debounceMs` | `150` | Quiet time after the last keystroke before the control updates. Read once. |
| `spellcheckDictionaryUrl` | none | Base URL of the dictionaries folder (see angular.json above). Read once. |
| `inputId` | none | `id` of the editable surface, so `<label for>` names and focuses it. Read once. |
| `ariaLabel` | "Document text" | Accessible name of the editable surface. Read once. |
| `ariaLabelledBy` | none | Id of the element that names the surface. The most robust option. Read once. |
| `imageUpload` | none | `(file) => Observable<{ src, alt? }>`. Without it, pasting or dropping an image does nothing. |
| `imageBaseUrl` | none | Base URL for relative image paths in the markdown. |
| `imageSrcResolver` | none | `(src) => string \| null`, full control over image paths. Wins over `imageBaseUrl`. |
| `ai` | none | The AI host group (`complete`, and for tier 2 `listEngines`, ...), passed to the core untouched. Without it the AI features stay off. Read once, at creation. See [Bring your own AI](https://github.com/mikejoseph23/mikedown/tree/main/packages/core#bring-your-own-ai). |

"Read once" means the input is read when the editor is created. `theme`, `readOnly` and `settings` changes apply live.

| Output | Notes |
| --- | --- |
| `ready` | Emits the `MikeDownEditorHandle` (`command`, `getHtml`, `focus`, ...) once the editor exists. |

The component also has a public `focus()` method and a `handle` getter.

## Dark mode

```html
<!-- Follows the OS -->
<mikedown-editor formControlName="notes" />

<!-- Follows an attribute on <html> (LymeStack: html[data-mode]) -->
<mikedown-editor formControlName="notes" darkSelector="html[data-mode=dark]" />

<!-- Follows a class on a shell wrapper, including views attached to it later (route animations) -->
<mikedown-editor formControlName="notes" darkSelector=".dark-theme" />
```

## Settings

The editor's settings are merged in this order, later wins:

1. Form-field defaults: `contentWidth: '100%'`, `fontSize: 15` (exported as `MIKEDOWN_FORM_FIELD_SETTINGS`). No font, so set one if the editor should use your app's.
2. The `settings` input, e.g. `[settings]="{ fontFamily: 'Roboto, sans-serif', headingFontFamily: 'Roboto, sans-serif' }"`.
3. Choices the user saved from the editor's own Settings dialog, kept in `localStorage` under `mikedown.settings` (per user, per browser).

## Styling

Colours inside the editor come from core's `--mikedown-*` tokens (see core's README, Theming). The frame around it reads `--mikedown-field-*` variables, with neutral fallbacks, so you can map them to your design system in global styles:

```css
mikedown-editor,
lyme-markdown-editor {
  --mikedown-field-border: var(--bs-border-color);
  --mikedown-field-border-hover: var(--bs-secondary-color);
  --mikedown-field-radius: var(--bs-border-radius);
  --mikedown-field-focus: var(--bs-primary);
  --mikedown-field-focus-ring: rgba(var(--bs-primary-rgb), 0.25);
  --mikedown-field-invalid: var(--bs-form-invalid-border-color);
}
```

| Variable | Fallback |
| --- | --- |
| `--mikedown-field-bg` | `transparent` |
| `--mikedown-field-border` | `rgba(127, 127, 127, 0.4)` |
| `--mikedown-field-border-hover` | `rgba(127, 127, 127, 0.7)` |
| `--mikedown-field-border-disabled` | `rgba(127, 127, 127, 0.3)` |
| `--mikedown-field-radius` | `6px` |
| `--mikedown-field-focus` | `#2563eb` |
| `--mikedown-field-focus-ring` | `rgba(37, 99, 235, 0.25)` |
| `--mikedown-field-invalid` | `#dc3545` |
| `--mikedown-field-invalid-ring` | `rgba(220, 53, 69, 0.25)` |
| `--mikedown-field-padding` | `16px 20px 24px` |

The host element has the class `mikedown-field`, plus `mikedown-field--readonly` or `mikedown-field--disabled`.

## Bracket tokens

The markdown serializer writes a literal `[Token]` as `\[Token\]`. That breaks bracket template tokens (prompt templates, mail merge). With `preserveBrackets`, `\[` and `\]` outside code reach the form as `[` and `]`:

```html
<mikedown-editor formControlName="prompt" preserveBrackets />
```

The same transform is exported as `unescapeBrackets(markdown)`. Use it only for text that nothing but the editor renders as markdown: a hand-typed `[text](url)` meant as plain text reloads as a link.

## Images

`imageUpload` receives `{ mime, bytes: Uint8Array, name? }`. Post the bytes and map the response to the URL the editor should store and load:

```ts
uploadImage = (file: ImageUploadRequest) => {
  const body = new FormData();
  body.append('file', new Blob([file.bytes], { type: file.mime }), file.name ?? 'image');
  return this.http.post<{ url: string }>('/api/files', body).pipe(map((r) => ({ src: r.url, alt: file.name })));
};
```

```html
<mikedown-editor formControlName="body" [imageUpload]="uploadImage" imageBaseUrl="/api/files/" />
```

Use an arrow function (or `.bind(this)`), because the editor calls it without `this`. Absolute `src` values (`https:`, `data:`, `blob:`) render as they are. A relative `src` such as `files/42.png` renders only with `imageBaseUrl` or `imageSrcResolver`; the stored markdown keeps the relative path either way.

## Accessibility

The editable surface is a `role="textbox"` with `aria-multiline="true"`. `<label for>` cannot target it directly, so pass `inputId` with a matching `<label for>`: the label then names the surface (`aria-labelledby`) and focuses it on click. `ariaLabelledBy` is the most robust option; `ariaLabel` sets a name directly. The accessible name follows ARIA's order: `aria-labelledby`, then `aria-label`, then `<label for>` elements. The editor drops core's `role="main"` landmark, which is wrong for a form field.

## Behaviour notes

- **Links.** `http(s)` and other absolute links open in a new tab. Relative links go through the Angular router when there is one, else `location.assign`.
- **Zone.** The editor runs outside the Angular zone. Value changes, touched, `ready`, link navigation and `imageUpload` re-enter it.
- **SSR.** The editor is created only in the browser; on the server the component renders its empty frame.
- **Shortcuts.** Cmd/Ctrl+/ toggles the markdown source view.
- **CommonJS warnings.** The build warns that `nspell`, `markdown-it-task-lists` and some of mermaid's dependencies are not ESM. They work; list them in `allowedCommonJsDependencies` in `angular.json` to silence the warnings.
- **Bundle.** The editor is large (about 2.6 MB raw, 660 kB transfer) and belongs behind a lazy route. Mermaid and KaTeX load only when a document uses them.
- **Budgets.** The default `ng new` production `initial` budget (500 kB warning, 1 MB error) rejects the editor: a consumer build measured about 3 MB for the initial bundle. A lazy route keeps the editor out of `initial`; if it must be there, raise the limit in `angular.json`:

```json
"budgets": [
  { "type": "initial", "maximumWarning": "3.5mb", "maximumError": "4mb" }
]
```

## Testing

The specs here run on Angular's own runner. Jest: add `transformIgnorePatterns: ['/node_modules/(?!(@mikedown|lowlight|devlop)/)']` so the ESM-only packages in core's import graph get transformed (TipTap, CodeMirror and `tiptap-markdown` ship `require` builds). vitest is the recommended runner.

## Known limitations

- **`mermaid` must be installed**, even though diagrams load lazily, because the Angular builder resolves `import('mermaid')` at build time. An app that does not want diagrams can skip it instead: add `"externalDependencies": ["mermaid"]` to the build `options` in `angular.json` and set `features: { mermaid: false }`. The build then passes and about half the output goes away, but diagrams do not render.
- **Several editors on one page share some state.** Overlays live in one portal that follows the last-focused editor, and turning `math` off in one editor's `features` turns KaTeX off page-wide.

## Migrating from the vendored copy

Apps that copied the wrapper (LymeStarter's `lymestack-optional/mikedown`, Quantico Creek's `shared/mikedown`) switch to `import { MikeDownEditorComponent } from '@mikedown/angular'`. The `<lyme-markdown-editor>` tag keeps working. Then:

- Dark mode: `darkSelector="html[data-mode=dark]"` (LymeStack) or `darkSelector=".dark-theme"` (Quantico Creek).
- Fonts: `[settings]="{ fontFamily: 'Roboto, ...', headingFontFamily: 'Roboto, ...' }"` (the package sets no font).
- Frame colours: map `--mikedown-field-*` to your tokens (the copies read `--ls-*` or `--lyme-md-*`). The `lyme-md__*` and `lyme-md--*` classes are now `mikedown-field__*` and `mikedown-field--*`.
- `preserveBrackets` and `unescapeBrackets` work as in the Quantico Creek copy. `MikeDownModule` is there for NgModule apps on Angular 17+. Angular 14 apps keep their vendored copy.

## Versioning

`@mikedown/*` packages share one version. On 0.x a minor release may break, a patch never does. Install matching versions of `@mikedown/angular` and `@mikedown/core`.

## Theming

Colors, fonts and radii come from `--mikedown-*` custom properties, set on the editor or any ancestor. The token list, light and dark defaults and the portal note are in the [`@mikedown/core` README](https://www.npmjs.com/package/@mikedown/core#theming).

## Browser support

Current Chrome, Edge, Firefox and Safari (ES2020 output, ESM only).

## Privacy

No telemetry. The editor makes no network calls except the ones you configure: spell check dictionaries (when you set a dictionary URL), your `uploadImage` / `host` callbacks, and the lazy `import()` of KaTeX and Mermaid from your own bundle.

## Links

- [Live demo](https://www.iadev.net/mikedown/developers/angular/)
- [Developers hub](https://www.iadev.net/mikedown/developers/)
- [npm](https://www.npmjs.com/package/@mikedown/angular)
- [GitHub](https://github.com/mikejoseph23/mikedown/tree/main/packages/angular)

## License

MIT
