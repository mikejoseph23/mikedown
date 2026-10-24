import { Component, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MikeDownEditorComponent } from '@mikedown/angular';

const starter = `# Release notes

Edit this text. The markdown value follows **as you type**.

- [x] Tables, task lists and code blocks
- [ ] Diagrams and math

| Framework | Package |
| --- | --- |
| Angular | @mikedown/angular |

Type / for headings, callouts and more.
`;

@Component({
  selector: 'app-demo',
  imports: [ReactiveFormsModule, MikeDownEditorComponent],
  template: `
    <div class="demo">
      <mikedown-editor
        class="demo__editor"
        [formControl]="notes"
        [theme]="theme()"
        [readOnly]="readOnly()"
        ariaLabel="Release notes"
        minHeight="440px"
      />
      <pre class="demo__value" tabindex="0" aria-label="Markdown value">{{ markdown() }}</pre>
    </div>
  `,
})
export class Demo {
  readonly theme = input<'auto' | 'light' | 'dark'>('auto');
  readonly readOnly = input(false);

  readonly notes = new FormControl(starter, { nonNullable: true });
  readonly markdown = toSignal(this.notes.valueChanges, { initialValue: starter });
}
