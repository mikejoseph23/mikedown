/**
 * @mikedown/core — framework-agnostic WYSIWYG markdown editor.
 *
 *   const handle = createMikeDownEditor(element, {
 *     host: { onChange: (markdown, { pristine }) => save(markdown) },
 *     initialMarkdown: '# Hello',
 *   });
 *   handle.setMarkdown(text, { pristine: true });   // load without dirtying
 *   handle.getMarkdown();
 *   handle.destroy();
 *
 * The host adapter (`MikeDownHost`) is the only way the editor reaches its
 * environment. Every method except `onChange` is optional; leaving one out
 * turns its feature off and hides its UI. `features` switches UI blocks
 * (toolbar, sidebar, source mode, slash commands, spellcheck, math, mermaid,
 * find/replace, frontmatter). The returned `MikeDownEditorHandle` receives
 * pushes from the host (settings, tags, backlinks, saved) and runs commands.
 */

export { createMikeDownEditor } from './editor';
export { NoopHost } from './host';
export type {
  MikeDownHost,
  MikeDownSidebarPrefs,
  LinkOpenBehavior,
  LinkSuggestion,
  WikilinkResolution,
  TagCount,
  BacklinkItem,
  ImageUploadRequest,
  ImageInsertResult,
  ImageResizeRequest,
  ImageResizeResult,
  LinkCheckRequest,
  DiffBaseline,
  MikeDownStats,
} from './host';
export { DEFAULT_FEATURES } from './types';
export type {
  MikeDownSettings,
  MikeDownSettingsPatch,
  NormalizationStyle,
  ImagePathMapping,
  MikeDownFeatures,
  MikeDownOptions,
  MikeDownEditorHandle,
  MikeDownCommand,
  MikeDownEvent,
  MikeDownViewState,
  SidebarStateUpdate,
  SidebarFooterLink,
  MikeDownSettingsSection,
  MikeDownSettingsSectionBuild,
  MikeDownSettingsSectionContext,
} from './types';
