/**
 * Bridges the flat `ai.*` keys in the settings files and the typed
 * `AiSettings` core works with. Pure.
 */
import { parseAiSettings, type AiSettings } from '@mikedown/core/ai';
import type { SettingsRecord } from './schema';

/** The `ai.*` entries of a flat settings record, as `parseAiSettings` reads them. */
export function aiKeys(flat: SettingsRecord): SettingsRecord {
  const out: SettingsRecord = {};
  for (const [key, value] of Object.entries(flat)) {
    if (key.startsWith('ai.')) {out[key] = value;}
  }
  return out;
}

/**
 * Typed AI settings for the editors (`settings.ai`). Secrets are never in the
 * files, so there is nothing to strip. `ai.consent.*` keys (a folder's saved
 * answers, owned by the Rust side) are not part of the schema and are left out.
 */
export function aiSettingsFromFlat(flat: SettingsRecord): AiSettings {
  const keys = aiKeys(flat);
  for (const key of Object.keys(keys)) {
    if (key.startsWith('ai.consent.')) {delete keys[key];}
  }
  return parseAiSettings(keys, { onWarning: (message) => console.warn(`MikeDown: ${message}`) });
}

function engineIds(engines: unknown): string[] {
  if (!Array.isArray(engines)) {return [];}
  return engines
    .map((e) => (e && typeof e === 'object' ? (e as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/** Engine ids that were in `before` and are gone from `after`: their stored keys are orphans. */
export function removedEngineIds(before: unknown, after: unknown): string[] {
  const kept = new Set(engineIds(after));
  return engineIds(before).filter((id) => !kept.has(id));
}
