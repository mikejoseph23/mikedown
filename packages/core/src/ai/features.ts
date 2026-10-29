/**
 * Feature registry. A feature's defaults (on or off, which task it uses,
 * what else it needs from a model) live here, so adding a feature is one
 * entry plus its UI and never a settings migration. `features.<id>` in
 * settings overrides `enabled` and `task`.
 */

import type { AiCapabilityRequirements } from './tasks';
import type { AiFeatureSettings, AiSendsScope } from './types';

export interface AiFeatureDefinition {
  id: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  defaultTask: string;
  /** Needs on top of the task's own. */
  requires: AiCapabilityRequirements;
  /** `planned` features are listed greyed ("coming later") and never surface. */
  status: 'available' | 'planned';
  /** What a request sends, for the consent dialogs and tooltips (`whatIsSent`). Absent: a generic sentence. */
  sends?: AiSendsScope;
}

export const AI_FEATURES: readonly AiFeatureDefinition[] = [
  {
    id: 'rewrite',
    label: 'Rewrite selection',
    description: 'Shorter, longer, fix flow or a custom prompt, previewed before it replaces the selection.',
    defaultEnabled: true,
    defaultTask: 'rewrite',
    requires: { chat: true, stream: true },
    status: 'available',
    sends: 'selection',
  },
  {
    id: 'ghostText',
    label: 'Inline suggestions',
    description: 'Dim continuation text while you write. Sends the text around the cursor as you type.',
    // Separate opt-in even with the master switch on (brainstorm idea 1).
    defaultEnabled: false,
    defaultTask: 'continue',
    requires: { stream: true },
    status: 'planned',
  },
  {
    id: 'chat',
    label: 'Chat with this document',
    description: 'A sidebar chat with the document as context.',
    defaultEnabled: true,
    defaultTask: 'chat',
    requires: { chat: true, stream: true },
    status: 'planned',
    sends: 'document',
  },
  {
    id: 'summary',
    label: 'Summary',
    description: 'Insert a summary or outline of the document.',
    defaultEnabled: true,
    defaultTask: 'summarize',
    requires: { chat: true },
    status: 'available',
    sends: 'document',
  },
  {
    id: 'frontmatter',
    label: 'Frontmatter and tags',
    description: 'Suggest a title, tags and other properties.',
    defaultEnabled: true,
    defaultTask: 'structure',
    requires: { chat: true },
    status: 'available',
    sends: 'documentAndTags',
  },
  {
    id: 'title',
    label: 'Suggest titles',
    description: 'Offer a few titles for the document.',
    defaultEnabled: true,
    defaultTask: 'structure',
    requires: { chat: true },
    status: 'available',
    sends: 'document',
  },
  {
    id: 'altText',
    label: 'Image alt text',
    description: 'Describe pasted images for their alt text.',
    defaultEnabled: true,
    defaultTask: 'vision',
    requires: { vision: true },
    status: 'planned',
  },
];

export function getAiFeature(id: string): AiFeatureDefinition | undefined {
  return AI_FEATURES.find((f) => f.id === id);
}

export interface ResolvedAiFeature {
  id: string;
  /** Saved value, else the registry default. Unknown features default to off. */
  enabled: boolean;
  /** Saved override, else the registry default task, else the feature id. */
  task: string;
  requires: AiCapabilityRequirements;
  definition?: AiFeatureDefinition;
}

/** A feature's effective state from saved settings plus the registry. Ignores the master switch. */
export function resolveAiFeature(features: AiFeatureSettings, id: string): ResolvedAiFeature {
  const definition = getAiFeature(id);
  const saved = features[id] ?? {};
  return {
    id,
    enabled: saved.enabled ?? definition?.defaultEnabled ?? false,
    task: saved.task ?? definition?.defaultTask ?? id,
    requires: definition?.requires ?? {},
    definition,
  };
}
