/**
 * The settings before the host sends any. Its own module so the editor can
 * start from them without loading the rest of the AI layer (see `ai-lite.ts`).
 */

import { DEFAULT_LOCAL_NETWORKS } from './locality';
import type { AiSettings } from './types';

export function defaultAiSettings(): AiSettings {
  return {
    enabled: false,
    allowCloud: false,
    engines: [],
    routing: { default: null, fallback: 'anyLocal', tasks: {} },
    features: {},
    localNetworks: [...DEFAULT_LOCAL_NETWORKS],
    showToolbarButton: true,
  };
}
