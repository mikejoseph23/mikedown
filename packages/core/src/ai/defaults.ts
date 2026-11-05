/**
 * The settings before the host sends any. Its own module so the editor can
 * start from them without loading the rest of the AI layer (see `ai-lite.ts`).
 */

import { DEFAULT_LOCAL_NETWORKS } from './locality';
import { AI_DOCS_MAX_HOPS_DEFAULT, AI_DOCS_NAVIGATE_BY_DEFAULT, AI_DOCS_SOURCE_SHARE_DEFAULT } from './types';
import type { AiDocsOptions, AiSettings } from './types';

/** The advanced docs options before the user changes any. */
export function defaultAiDocsOptions(): AiDocsOptions {
  return { maxHops: AI_DOCS_MAX_HOPS_DEFAULT, sourceShare: AI_DOCS_SOURCE_SHARE_DEFAULT, navigateBy: AI_DOCS_NAVIGATE_BY_DEFAULT };
}

export function defaultAiSettings(): AiSettings {
  return {
    enabled: false,
    allowCloud: false,
    engines: [],
    routing: { default: null, fallback: 'anyLocal', tasks: {} },
    features: {},
    localNetworks: [...DEFAULT_LOCAL_NETWORKS],
    showToolbarButton: true,
    activityPanel: false,
    docBases: [],
    docs: defaultAiDocsOptions(),
  };
}
