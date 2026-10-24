import type { App } from 'vue';
import { MikeDownEditor } from './MikeDownEditor';

export { MikeDownEditor } from './MikeDownEditor';
export type { MikeDownEditorExposed } from './MikeDownEditor';
export type {
  BindingTheme,
  MikeDownEditorHandle,
  MikeDownFeatures,
  MikeDownHost,
  MikeDownSettings,
} from '@mikedown/core';

/** `app.use(MikeDown)` registers `<MikeDownEditor>` globally. */
export const MikeDown = {
  install(app: App): void {
    app.component('MikeDownEditor', MikeDownEditor);
  },
};

export default MikeDown;
