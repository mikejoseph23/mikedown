// Page glue: loads the sample (demo.ts) in a deferred chunk and passes it the
// stage's controls (website/developers/common/stage.js, loaded as a script).
import { Component, signal } from '@angular/core';
import { Demo } from './demo';

type Controls = { theme: 'auto' | 'light' | 'dark'; readOnly: boolean };

declare global {
  interface Window {
    mikedownStage?: { readonly state: Controls };
  }
}

@Component({
  selector: 'app-root',
  imports: [Demo],
  template: `
    @defer (on immediate) {
      <app-demo [theme]="theme()" [readOnly]="readOnly()" />
    } @placeholder {
      <p class="stage__loading">Loading the editor...</p>
    }
  `,
})
export class App {
  protected readonly theme = signal<Controls['theme']>(window.mikedownStage?.state.theme ?? 'auto');
  protected readonly readOnly = signal(window.mikedownStage?.state.readOnly ?? false);

  constructor() {
    document.addEventListener('stage:controls', (event) => {
      const { theme, readOnly } = (event as CustomEvent<Controls>).detail;
      this.theme.set(theme);
      this.readOnly.set(readOnly);
    });
  }
}
