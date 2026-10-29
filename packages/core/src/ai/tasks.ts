/**
 * Task taxonomy. A feature names a task; the router picks the engine and
 * model routed to that task and checks the model has what the task needs.
 * Task ids are the keys of `routing.tasks`; unknown ids saved by a newer
 * version are kept and route like any other (with no requirements).
 */

import { DEFAULT_CONTEXT_TOKENS } from './types';
import type { AiCapabilityFlag, AiModelCapabilities } from './types';

/** A task's needs. Booleans must be true on the model; `contextTokens` is a minimum. */
export type AiCapabilityRequirements = Partial<AiModelCapabilities>;

export interface AiTaskDefinition {
  id: string;
  label: string;
  description: string;
  requires: AiCapabilityRequirements;
  /**
   * Nice to have, never a gate: the router tries candidates that meet these
   * first and still uses one that does not (a model without JSON mode, a
   * small context window).
   */
  prefers?: AiCapabilityRequirements;
  /** At least one of these flags must be true (ghost text: a FIM model, or a chat model with a continue prompt). */
  requiresAny?: AiCapabilityFlag[];
  /** Served by a host method rather than a model completion. */
  hostMethod?: 'embed' | 'transcribe';
}

/** The "comfortable" context for `summarize`: preferred by the router, and the point below which the UI may warn. Not a gate. */
export const SUMMARIZE_MIN_CONTEXT_TOKENS = 32768;

export const AI_TASKS: readonly AiTaskDefinition[] = [
  {
    id: 'rewrite',
    label: 'Rewrite',
    description: 'Selection rewrite, explain or expand, reading level, translation.',
    requires: { chat: true, stream: true },
  },
  {
    id: 'continue',
    label: 'Continue',
    description: 'Inline ghost text. Prefers a small fill-in-the-middle model.',
    requires: { stream: true },
    requiresAny: ['fim', 'chat'],
  },
  {
    id: 'chat',
    label: 'Chat',
    description: 'Chat with the document, prompt blocks.',
    requires: { chat: true, stream: true },
  },
  {
    id: 'summarize',
    label: 'Summarize',
    description: 'Summaries and "what changed". Works best with a large context window; long documents are cut and labelled.',
    requires: { chat: true },
    prefers: { contextTokens: SUMMARIZE_MIN_CONTEXT_TOKENS },
  },
  {
    id: 'structure',
    label: 'Structure',
    description: 'Frontmatter and tags, Mermaid, tables, code, titles, paste cleanup. Prefers a model with JSON output.',
    requires: { chat: true },
    prefers: { json: true },
  },
  {
    id: 'notes',
    label: 'Notes',
    description: 'Meeting notes to action items.',
    requires: { chat: true, json: true },
  },
  {
    id: 'review',
    label: 'Review',
    description: 'Grammar pass and consistency checks.',
    requires: { chat: true, json: true },
  },
  {
    id: 'vision',
    label: 'Vision',
    description: 'Alt text for images.',
    requires: { vision: true },
  },
  {
    id: 'embed',
    label: 'Embeddings',
    description: 'Workspace search and link suggestions.',
    requires: { embed: true },
    hostMethod: 'embed',
  },
  {
    id: 'transcribe',
    label: 'Transcribe',
    description: 'Dictation, through the host.',
    requires: {},
    hostMethod: 'transcribe',
  },
];

export function getAiTask(id: string): AiTaskDefinition | undefined {
  return AI_TASKS.find((t) => t.id === id);
}

/** Merge two requirement sets: flags OR together, `contextTokens` takes the larger minimum. */
export function combineRequirements(a: AiCapabilityRequirements, b: AiCapabilityRequirements): AiCapabilityRequirements {
  const out: AiCapabilityRequirements = { ...a };
  for (const [key, value] of Object.entries(b) as Array<[keyof AiModelCapabilities, unknown]>) {
    if (key === 'contextTokens') {
      if (typeof value === 'number') {out.contextTokens = Math.max(out.contextTokens ?? 0, value);}
    } else if (value === true) {
      out[key] = true;
    }
  }
  return out;
}

/**
 * The capabilities a model lacks for these requirements, as flag names (and
 * `contextTokens` when the window is too small). Empty means it qualifies.
 * An unknown context window counts as `DEFAULT_CONTEXT_TOKENS`.
 */
export function missingCapabilities(
  caps: AiModelCapabilities,
  requires: AiCapabilityRequirements,
  requiresAny?: readonly AiCapabilityFlag[],
  defaultContextTokens = DEFAULT_CONTEXT_TOKENS,
): Array<keyof AiModelCapabilities> {
  const missing: Array<keyof AiModelCapabilities> = [];
  for (const [key, value] of Object.entries(requires) as Array<[keyof AiModelCapabilities, unknown]>) {
    if (key === 'contextTokens') {
      if (typeof value === 'number' && (caps.contextTokens ?? defaultContextTokens) < value) {missing.push('contextTokens');}
    } else if (value === true && !caps[key]) {
      missing.push(key);
    }
  }
  if (requiresAny && requiresAny.length > 0 && !requiresAny.some((flag) => caps[flag])) {
    missing.push(requiresAny[0]);
  }
  return missing;
}
