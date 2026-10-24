import { NgModule } from '@angular/core';
import { MikeDownEditorComponent } from './mikedown-editor.component';

/**
 * For NgModule-based apps (Angular 17+): import `MikeDownModule` into the feature module that uses the editor, so the
 * editor's bundle stays in that feature's lazy chunk. Standalone components import `MikeDownEditorComponent` directly.
 */
@NgModule({
  imports: [MikeDownEditorComponent],
  exports: [MikeDownEditorComponent],
})
export class MikeDownModule {}
