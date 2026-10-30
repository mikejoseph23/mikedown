/**
 * The AI UI the editor loads on demand (see `ai-lite.ts`): everything
 * `editor.ts` calls at run time once the host has an AI adapter. Import this
 * module only through `loadAiUi()` (or `ai-ui-eager.ts`), never statically
 * from the editor, or the AI code lands in every consumer's main bundle.
 */

export {
  AI_ENGINE_PRESETS, CHARS_PER_TOKEN, DEFAULT_CONTEXT_TOKENS, PROPERTY_VOCABULARY_MAX, aiErrorCopy, aiLengthLimitCopy, budgetDocument, buildPropertiesMessages,
  headingsOutline, isRouteUsable, jsonRepairMessages, makeAiError, parseAiSettings,
  parsePropertySuggestions, propertiesMaxTokens, renderHeadingOutline, resolveRoute, rewriteVisibleText, thinkingChoices, toAiError,
} from './ai';
export { aiConsentHost, hostOfUrl, isHostEngineKind, whatIsSent } from './ai';
export { loadThinkingLevel, rememberThinkingLevel, thinkingLevelFor } from './ai-prefs';
export { buildAiSettingsSection } from './ai-settings';
export { mountAiEnginesPage } from './ai-engines-page';
export { withSavedAiKeys } from './ai-settings-session';
export { bestLocalServer, detectLocalServers, scanForSetup, setUpLocalEngine } from './ai-local-setup';
export { aiIndicatorState, aiNextRouteChanged, engineDisplayName } from './ai-settings-model';
export { experimentalBadge, privacyCard, privacyLine } from './ai-settings-dom';
export {
  AI_TURN_ON_PATCH, aiSetupTarget, aiToolbarMenuEntries,
  hideAiFirstRunPanel, isAiFirstRunPanelOpen, showAiFirstRunPanel,
} from './ai-toolbar';
export { aiFeatureAvailability, aiRunThinkingOn, runAiCompletion } from './ai-request';
export {
  aiRewriteMenuGroups, applyRichTitle, applySourceTitle,
  createAiRewritePopover, cursorInsertTarget, richDocumentTarget, richRewriteTarget, setYamlTitle, sourceCursorTarget,
  sourceDocumentTarget, sourceRewriteTarget, yamlHasTitle,
} from './ai-rewrite';
