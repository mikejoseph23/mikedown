/**
 * `mikedown.ai.*` settings: parse (validate, fill defaults, keep unknown
 * keys) and serialize back to a settings patch.
 *
 * `parseAiSettings` never throws. Malformed entries (an engine that is not
 * an object or has no base URL, a model with no id, a route without both
 * ids) are dropped with a warning; everything it does not recognize is kept
 * as is, on every object, so a newer version's settings survive a save.
 * Engines without an id get one, once: the id is written back by
 * `serializeAiSettings`, so it is stable from then on.
 */

import { completeCapabilities, detectCapabilities } from './capabilityHeuristics';
import { DEFAULT_LOCAL_NETWORKS } from './locality';
import { AI_ENGINE_KINDS, AI_FALLBACK_MODES } from './types';
import type {
  AiCapabilitiesSource,
  AiEngineConfig,
  AiEngineKind,
  AiFeatureSetting,
  AiFeatureSettings,
  AiLocalitySetting,
  AiModelCapabilities,
  AiModelConfig,
  AiRoute,
  AiRouting,
  AiSettings,
} from './types';

type Json = Record<string, unknown>;

export interface ParseAiSettingsOptions {
  /** Id for an engine that has none. Default: a slug of its name plus random characters. */
  generateId?: (name: string) => string;
  /** Called once per dropped or repaired entry. Default `console.warn`. */
  onWarning?: (message: string) => void;
}

/** The six top-level keys, without the `ai.` prefix. */
export const AI_SETTINGS_KEYS = ['enabled', 'allowCloud', 'engines', 'routing', 'features', 'localNetworks'] as const;

export function defaultAiSettings(): AiSettings {
  return {
    enabled: false,
    allowCloud: false,
    engines: [],
    routing: { default: null, fallback: 'anyLocal', tasks: {} },
    features: {},
    localNetworks: [...DEFAULT_LOCAL_NETWORKS],
  };
}

export function isKnownEngineKind(kind: string): kind is AiEngineKind {
  return (AI_ENGINE_KINDS as readonly string[]).includes(kind);
}

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Unknown keys of `raw`, copied, so known keys can be written over them. */
function extras(raw: Json, known: readonly string[]): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!known.includes(k)) {out[k] = v;}
  }
  return out;
}

function randomSuffix(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {bytes[i] = Math.floor(Math.random() * 256);}
  }
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** A new engine id: `omlx-mac-studio-k3f9a2`. Never shown, only has to be unique and stable. */
export function generateAiId(name = ''): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, '');
  return slug ? `${slug}-${randomSuffix(6)}` : `engine-${randomSuffix(8)}`;
}

/**
 * Read `raw` as AI settings. Accepts the nested object VS Code returns for
 * `getConfiguration('mikedown.ai')` (`{ enabled, engines, ... }`) or a flat
 * store with `ai.`-prefixed keys (Desktop, a settings patch). Anything else,
 * including undefined, gives the defaults.
 */
export function parseAiSettings(raw: unknown, opts: ParseAiSettingsOptions = {}): AiSettings {
  const warn = opts.onWarning ?? ((m: string) => console.warn(`[mikedown ai] ${m}`));
  const genId = opts.generateId ?? generateAiId;
  const defaults = defaultAiSettings();
  if (!isObject(raw)) {
    if (raw !== undefined && raw !== null) {warn('AI settings are not an object; using defaults.');}
    return defaults;
  }

  const source = unflatten(raw);
  const out = { ...extras(source, AI_SETTINGS_KEYS), ...defaults } as AiSettings;

  if (typeof source.enabled === 'boolean') {out.enabled = source.enabled;}
  if (typeof source.allowCloud === 'boolean') {out.allowCloud = source.allowCloud;}
  if (Array.isArray(source.localNetworks)) {
    out.localNetworks = source.localNetworks.filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
  } else if (source.localNetworks !== undefined) {
    warn('localNetworks is not an array; using the default.');
  }

  out.engines = parseEngines(source.engines, genId, warn);
  out.routing = parseRouting(source.routing, warn);
  out.features = parseFeatures(source.features, warn);
  return out;
}

/** `{ 'ai.enabled': true, ... }` to `{ enabled: true, ... }`; a nested object passes through. */
function unflatten(raw: Json): Json {
  const prefixed = Object.keys(raw).filter((k) => k.startsWith('ai.'));
  if (prefixed.length === 0) {return isObject(raw.ai) ? raw.ai : raw;}
  const out: Json = {};
  for (const k of prefixed) {out[k.slice(3)] = raw[k];}
  return out;
}

const ENGINE_KEYS = ['id', 'name', 'kind', 'baseUrl', 'enabled', 'locality', 'apiKeyEnv', 'discovery', 'models'] as const;

function parseEngines(raw: unknown, genId: (name: string) => string, warn: (m: string) => void): AiEngineConfig[] {
  if (raw === undefined) {return [];}
  if (!Array.isArray(raw)) {
    warn('engines is not an array; ignoring it.');
    return [];
  }
  const engines: AiEngineConfig[] = [];
  const ids = new Set<string>();
  raw.forEach((entry, index) => {
    if (!isObject(entry) || typeof entry.baseUrl !== 'string') {
      warn(`engines[${index}] has no baseUrl; dropped.`);
      return;
    }
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name : entry.baseUrl;
    let kind = typeof entry.kind === 'string' ? entry.kind : 'openai-compatible';
    if (!kind.trim()) {kind = 'openai-compatible';}
    let id = typeof entry.id === 'string' && entry.id.trim() ? entry.id : '';
    if (!id || ids.has(id)) {
      if (id) {warn(`engines[${index}] repeats id "${id}"; gave it a new one.`);}
      do {
        id = genId(name);
      } while (ids.has(id));
    }
    ids.add(id);

    const engine = { ...extras(entry, ENGINE_KEYS) } as unknown as AiEngineConfig;
    engine.id = id;
    engine.name = name;
    // An unknown kind (a newer version's) is kept so the entry survives a save; the router skips it.
    engine.kind = kind as AiEngineKind;
    engine.baseUrl = entry.baseUrl.trim();
    engine.enabled = typeof entry.enabled === 'boolean' ? entry.enabled : true;
    engine.locality = entry.locality === 'local' || entry.locality === 'cloud' ? entry.locality : ('auto' as AiLocalitySetting);
    if (typeof entry.apiKeyEnv === 'string' && entry.apiKeyEnv.trim()) {engine.apiKeyEnv = entry.apiKeyEnv.trim();}
    engine.discovery = entry.discovery === 'manual' ? 'manual' : 'auto';
    engine.models = parseModels(entry.models, engine.kind, `engines[${index}]`, warn);
    engines.push(engine);
  });
  return engines;
}

const MODEL_KEYS = ['id', 'label', 'enabled', 'capabilities', 'capabilitiesSource', 'requestOverrides', 'missing', 'manual'] as const;
const CAPABILITY_SOURCES: readonly AiCapabilitiesSource[] = ['endpoint', 'heuristic', 'user'];

function parseModels(raw: unknown, kind: AiEngineKind, where: string, warn: (m: string) => void): AiModelConfig[] {
  if (raw === undefined) {return [];}
  if (!Array.isArray(raw)) {
    warn(`${where}.models is not an array; ignoring it.`);
    return [];
  }
  const models: AiModelConfig[] = [];
  const ids = new Set<string>();
  raw.forEach((entry, index) => {
    if (!isObject(entry) || typeof entry.id !== 'string' || !entry.id.trim()) {
      warn(`${where}.models[${index}] has no id; dropped.`);
      return;
    }
    if (ids.has(entry.id)) {
      warn(`${where}.models[${index}] repeats id "${entry.id}"; dropped.`);
      return;
    }
    ids.add(entry.id);

    const model = { ...extras(entry, MODEL_KEYS) } as unknown as AiModelConfig;
    model.id = entry.id;
    if (typeof entry.label === 'string' && entry.label.trim()) {model.label = entry.label;}
    model.enabled = typeof entry.enabled === 'boolean' ? entry.enabled : true;
    const known = isKnownEngineKind(kind) ? kind : undefined;
    if (isObject(entry.capabilities)) {
      model.capabilities = completeCapabilities(entry.capabilities as Partial<AiModelCapabilities>, entry.id, known);
      // An explicit null context window means "unknown"; keep it rather than the heuristic guess.
      if (entry.capabilities.contextTokens === null) {model.capabilities.contextTokens = null;}
      model.capabilitiesSource = CAPABILITY_SOURCES.includes(entry.capabilitiesSource as AiCapabilitiesSource)
        ? (entry.capabilitiesSource as AiCapabilitiesSource)
        : 'heuristic';
    } else {
      model.capabilities = detectCapabilities(entry.id, known).capabilities;
      model.capabilitiesSource = 'heuristic';
    }
    if (isObject(entry.requestOverrides)) {
      model.requestOverrides = entry.requestOverrides;
    } else if (entry.requestOverrides !== undefined) {
      warn(`${where}.models[${index}].requestOverrides is not an object; ignoring it.`);
    }
    if (entry.missing === true) {model.missing = true;}
    if (entry.manual === true) {model.manual = true;}
    models.push(model);
  });
  return models;
}

function parseRoute(raw: unknown): AiRoute | null {
  if (!isObject(raw) || typeof raw.engineId !== 'string' || typeof raw.modelId !== 'string' || !raw.engineId || !raw.modelId) {
    return null;
  }
  return { ...raw, engineId: raw.engineId, modelId: raw.modelId };
}

function parseRouting(raw: unknown, warn: (m: string) => void): AiRouting {
  const routing: AiRouting = { default: null, fallback: 'anyLocal', tasks: {} };
  if (raw === undefined) {return routing;}
  if (!isObject(raw)) {
    warn('routing is not an object; using the defaults.');
    return routing;
  }
  const out = { ...extras(raw, ['default', 'fallback', 'tasks']), ...routing } as AiRouting;
  if (raw.default !== undefined && raw.default !== null) {
    out.default = parseRoute(raw.default);
    if (!out.default) {warn('routing.default needs engineId and modelId; cleared.');}
  }
  if (typeof raw.fallback === 'string' && (AI_FALLBACK_MODES as readonly string[]).includes(raw.fallback)) {
    out.fallback = raw.fallback as AiRouting['fallback'];
  } else if (raw.fallback !== undefined) {
    warn(`routing.fallback "${String(raw.fallback)}" is not a fallback mode; using anyLocal.`);
  }
  if (isObject(raw.tasks)) {
    for (const [task, value] of Object.entries(raw.tasks)) {
      const route = parseRoute(value);
      if (route) {
        out.tasks[task] = route;
      } else if (value !== null) {
        warn(`routing.tasks.${task} needs engineId and modelId; dropped.`);
      }
    }
  } else if (raw.tasks !== undefined) {
    warn('routing.tasks is not an object; ignoring it.');
  }
  return out;
}

function parseFeatures(raw: unknown, warn: (m: string) => void): AiFeatureSettings {
  const features: AiFeatureSettings = {};
  if (raw === undefined) {return features;}
  if (!isObject(raw)) {
    warn('features is not an object; ignoring it.');
    return features;
  }
  for (const [id, value] of Object.entries(raw)) {
    if (!isObject(value)) {
      warn(`features.${id} is not an object; dropped.`);
      continue;
    }
    const feature = { ...extras(value, ['enabled', 'task']) } as AiFeatureSetting;
    if (typeof value.enabled === 'boolean') {feature.enabled = value.enabled;}
    if (typeof value.task === 'string' && value.task.trim()) {feature.task = value.task;}
    features[id] = feature;
  }
  return features;
}

/** The settings patch keys, `ai.`-prefixed: what the editor sends to `host.saveSettings`. */
export type AiSettingsPatch = Record<`ai.${string}`, unknown>;

/**
 * Settings to a `saveSettings` patch: one `ai.<key>` per top-level key,
 * including unknown ones, as plain JSON (deep copies). VS Code writes each as
 * `mikedown.ai.<key>`; Desktop stores the flat keys. Secrets are never here.
 */
export function serializeAiSettings(settings: AiSettings): AiSettingsPatch {
  const patch: AiSettingsPatch = {};
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) {continue;}
    patch[`ai.${key}`] = JSON.parse(JSON.stringify(value)) as unknown;
  }
  return patch;
}
