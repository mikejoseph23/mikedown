/*
 * Public API of @mikedown/angular.
 */
export { MikeDownEditorComponent, MIKEDOWN_FORM_FIELD_SETTINGS } from './lib/mikedown-editor.component';
export type { MikeDownThemeInput } from './lib/mikedown-editor.component';
export { MikeDownModule } from './lib/mikedown.module';
export { unescapeBrackets } from './lib/unescape-brackets';
export { AngularMikeDownHost, MIKEDOWN_SETTINGS_KEY } from './lib/angular-mikedown-host';
export type {
  AngularMikeDownHostBindings,
  MikeDownImageSrcResolver,
  MikeDownImageUpload,
} from './lib/angular-mikedown-host';
export type {
  ImageInsertResult,
  ImageUploadRequest,
  MikeDownEditorHandle,
  MikeDownFeatures,
  MikeDownSettings,
} from '@mikedown/core';
