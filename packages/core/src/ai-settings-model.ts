/**
 * Pure helpers behind the AI settings tab (`ai-settings.ts`) and the sidebar
 * indicator chip: which engine/model pairs a picker may offer, the warnings an
 * engine row shows, the route a task would really get, draft edits that must
 * keep unknown keys, and the chip's text. No DOM here, so all of it is unit
 * tested without mounting the modal.
 *
 * Settings objects carry keys this version does not know (a newer version's);
 * every edit spreads the object it changes rather than rebuilding it.
 */

import {
  AI_TASKS,
  DEFAULT_CONTEXT_TOKENS,
  detectCapabilities,
  detectLocality,
  engineLocality,
  generateAiId,
  getAiTask,
  isKnownEngineKind,
  localityMismatch,
  mergeDiscoveredModels,
  missingCapabilities,
  resolveRoute,
  serializeAiSettings,
} from './ai';
import type {
  AiCapabilityFlag,
  AiCapabilityRequirements,
  AiDiscoveredModel,
  AiEngineConfig,
  AiEngineKind,
  AiEnginePreset,
  AiEngineStatus,
  AiLocality,
  AiModelCapabilities,
  AiModelConfig,
  AiRoute,
  AiRouteResolution,
  AiServedBy,
  AiSettings,
  AiSettingsPatch,
  MikeDownAiHost,
} from './ai';

// ── Host tier ───────────────────────────────────────────────────────────────

/** 1: `complete` only, the host routes. 2: the host has an engine registry and core routes. */
export type AiHostTier = 1 | 2;

export function aiHostTier(ai: MikeDownAiHost): AiHostTier {
  return typeof ai.listEngines === 'function' ? 2 : 1;
}

// ── Labels ──────────────────────────────────────────────────────────────────

export const AI_ENGINE_KIND_LABELS: Readonly<Record<AiEngineKind, string>> = {
  'openai-compatible': 'OpenAI-compatible',
  lmstudio: 'LM Studio',
  ollama: 'Ollama',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

export function engineKindLabel(kind: string): string {
  return isKnownEngineKind(kind) ? AI_ENGINE_KIND_LABELS[kind] : `Unknown (${kind})`;
}

/** Chips in the models table, in display order. `stream` is assumed and not shown. */
export const AI_CAPABILITY_CHIPS: ReadonlyArray<{ flag: AiCapabilityFlag; label: string; title: string }> = [
  { flag: 'chat', label: 'chat', title: 'Chat and instruct completions' },
  { flag: 'vision', label: 'vision', title: 'Image inputs' },
  { flag: 'json', label: 'json', title: 'JSON mode or reliable structured output' },
  { flag: 'tools', label: 'tools', title: 'Function calling' },
  { flag: 'fim', label: 'fim', title: 'Fill-in-the-middle (inline suggestions)' },
  { flag: 'embed', label: 'embed', title: 'Embeddings' },
];

const CAPABILITY_WORDS: Record<keyof AiModelCapabilities, string> = {
  chat: 'chat',
  stream: 'streaming',
  vision: 'vision',
  json: 'JSON output',
  tools: 'tools',
  fim: 'fill-in-the-middle',
  embed: 'embeddings',
  contextTokens: 'a large enough context window',
};

export function engineDisplayName(engine: Pick<AiEngineConfig, 'id' | 'name'>): string {
  return engine.name.trim() || engine.id;
}

export function modelDisplayName(model: Pick<AiModelConfig, 'id' | 'label'>): string {
  return model.label?.trim() || model.id;
}

/** `127.0.0.1:8000` or `api.anthropic.com`, for the engine row's subline. */
export function shortUrl(baseUrl: string): string {
  const stripped = baseUrl.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const authority = stripped.split(/[/?#]/, 1)[0];
  return authority || baseUrl.trim();
}

/** 262144 to "256k", 200000 to "200k", 8192 to "8k". */
export function formatTokens(tokens: number | null | undefined): string {
  const n = tokens ?? DEFAULT_CONTEXT_TOKENS;
  if (n >= 1024 * 1024 && n % (1024 * 1024) === 0) {return `${n / (1024 * 1024)}M`;}
  if (n >= 1000000 && n % 1000000 === 0) {return `${n / 1000000}M`;}
  if (n >= 1024 && n % 1024 === 0) {return `${n / 1024}k`;}
  if (n >= 1000 && n % 1000 === 0) {return `${n / 1000}k`;}
  return String(n);
}

// ── Drafts and ids ──────────────────────────────────────────────────────────

/** A deep, plain-JSON copy the tab can edit without touching the host's object. */
export function cloneAiSettings(settings: AiSettings): AiSettings {
  return JSON.parse(JSON.stringify(settings)) as AiSettings;
}

/** A fresh engine id that no engine in `existing` uses. Ids are never shown or edited. */
export function uniqueEngineId(name: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  let id = generateAiId(name);
  while (taken.has(id)) {id = generateAiId(name);}
  return id;
}

export function engineFromPreset(preset: AiEnginePreset, existingIds: Iterable<string>): AiEngineConfig {
  const engine: AiEngineConfig = {
    id: uniqueEngineId(preset.name, existingIds),
    name: preset.name,
    kind: preset.kind,
    baseUrl: preset.baseUrl,
    enabled: true,
    locality: 'auto',
    discovery: 'auto',
    models: [],
  };
  if (preset.apiKeyEnv) {engine.apiKeyEnv = preset.apiKeyEnv;}
  return engine;
}

/** Group presets for the Add engine menu by where they run. */
export function groupPresets(presets: readonly AiEnginePreset[]): { local: AiEnginePreset[]; cloud: AiEnginePreset[] } {
  const local: AiEnginePreset[] = [];
  const cloud: AiEnginePreset[] = [];
  for (const p of presets) {(detectLocality(p.baseUrl) === 'local' ? local : cloud).push(p);}
  return { local, cloud };
}

/** Replace one engine (by id), keeping the order. */
export function withEngine(settings: AiSettings, engine: AiEngineConfig): AiSettings {
  return { ...settings, engines: settings.engines.map((e) => (e.id === engine.id ? engine : e)) };
}

/** Drop an engine and every route that points at it. */
export function removeEngine(settings: AiSettings, engineId: string): AiSettings {
  const tasks: Record<string, AiRoute> = {};
  for (const [task, route] of Object.entries(settings.routing.tasks)) {
    if (route.engineId !== engineId) {tasks[task] = route;}
  }
  const def = settings.routing.default?.engineId === engineId ? null : settings.routing.default;
  return {
    ...settings,
    engines: settings.engines.filter((e) => e.id !== engineId),
    routing: { ...settings.routing, default: def, tasks },
  };
}

/** Drop routes to one model (after it is removed from its engine). */
export function removeRoutesTo(settings: AiSettings, engineId: string, modelId: string): AiSettings {
  const hits = (r: AiRoute | null | undefined) => !!r && r.engineId === engineId && r.modelId === modelId;
  const tasks: Record<string, AiRoute> = {};
  for (const [task, route] of Object.entries(settings.routing.tasks)) {
    if (!hits(route)) {tasks[task] = route;}
  }
  return { ...settings, routing: { ...settings.routing, default: hits(settings.routing.default) ? null : settings.routing.default, tasks } };
}

export function withModel(engine: AiEngineConfig, model: AiModelConfig): AiEngineConfig {
  return { ...engine, models: engine.models.map((m) => (m.id === model.id ? model : m)) };
}

/** Flip one capability chip. Any hand edit makes the row `user`, so re-discovery leaves it alone. */
export function toggleModelCapability(model: AiModelConfig, flag: AiCapabilityFlag): AiModelConfig {
  return {
    ...model,
    capabilities: { ...model.capabilities, [flag]: !model.capabilities[flag] },
    capabilitiesSource: 'user',
  };
}

/** Set the context window; null means unknown (treated as the default). */
export function setModelContextTokens(model: AiModelConfig, tokens: number | null): AiModelConfig {
  return { ...model, capabilities: { ...model.capabilities, contextTokens: tokens }, capabilitiesSource: 'user' };
}

/** Parse the context field: blank is unknown, otherwise a positive whole number. */
export function parseContextTokens(text: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const t = text.trim().replace(/[_,\s]/g, '');
  if (!t) {return { ok: true, value: null };}
  const m = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(t);
  if (!m) {return { ok: false, error: 'Enter a number of tokens, such as 32768 or 32k.' };}
  const scale = m[2] === '' ? 1 : m[2].toLowerCase() === 'k' ? 1024 : 1024 * 1024;
  const value = Math.round(Number(m[1]) * scale);
  if (!Number.isFinite(value) || value <= 0) {return { ok: false, error: 'Enter a number of tokens, such as 32768 or 32k.' };}
  return { ok: true, value };
}

/** Add a model by hand. It stays put when a later discovery does not list it. */
export function addManualModel(engine: AiEngineConfig, rawId: string): { ok: true; engine: AiEngineConfig; model: AiModelConfig } | { ok: false; error: string } {
  const id = rawId.trim();
  if (!id) {return { ok: false, error: 'Enter the model id the server knows it by.' };}
  if (engine.models.some((m) => m.id === id)) {return { ok: false, error: `${id} is already in the list.` };}
  const model: AiModelConfig = {
    id,
    enabled: true,
    capabilities: detectCapabilities(id, isKnownEngineKind(engine.kind) ? engine.kind : undefined).capabilities,
    capabilitiesSource: 'heuristic',
    manual: true,
  };
  return { ok: true, engine: { ...engine, models: [...engine.models, model] }, model };
}

/**
 * The per-model `requestOverrides` editor. Blank clears it; anything else
 * must be a JSON object, which is merged into the request body last.
 */
export function parseRequestOverrides(text: string): { ok: true; value: Record<string, unknown> | undefined } | { ok: false; error: string } {
  const t = text.trim();
  if (!t) {return { ok: true, value: undefined };}
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch (err) {
    const detail = err instanceof Error ? err.message.replace(/^JSON\.parse:\s*/, '') : '';
    return { ok: false, error: detail ? `Not valid JSON: ${detail}` : 'Not valid JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'Must be a JSON object, such as { "reasoning_effort": "low" }.' };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

export function formatRequestOverrides(value: Record<string, unknown> | undefined): string {
  return value && Object.keys(value).length > 0 ? JSON.stringify(value, null, 2) : '';
}

/**
 * Merge a `discoverModels` result into the draft engine. Models the host
 * marks missing are left out of the discovered list, so the merge marks
 * them missing too (manual models excepted).
 */
export function mergeDiscoveryStatus(engine: AiEngineConfig, status: AiEngineStatus): AiEngineConfig {
  const discovered: AiDiscoveredModel[] = status.models
    .filter((m) => !m.missing)
    .map((m) => {
      const d: AiDiscoveredModel = { id: m.id, capabilities: m.capabilities, source: m.source === 'endpoint' ? 'endpoint' : 'heuristic' };
      if (m.label !== undefined) {d.label = m.label;}
      if (m.loaded !== undefined) {d.loaded = m.loaded;}
      return d;
    });
  const kind = isKnownEngineKind(engine.kind) ? engine.kind : undefined;
  return { ...engine, models: mergeDiscoveredModels(engine.models, discovered, kind) };
}

/** True when the fields the host needs to reach an engine differ (so Test must save first). */
export function connectionDiffers(a: AiEngineConfig | undefined, b: AiEngineConfig | undefined): boolean {
  if (!a || !b) {return a !== b;}
  return a.kind !== b.kind
    || a.baseUrl !== b.baseUrl
    || (a.apiKeyEnv ?? '') !== (b.apiKeyEnv ?? '')
    || a.locality !== b.locality
    || a.enabled !== b.enabled
    || a.discovery !== b.discovery;
}

/**
 * The `saveSettings` patch for the tab: only the `ai.*` keys whose value
 * changed, so opening and saving the modal never writes AI keys the user did
 * not touch into their settings file.
 */
export function changedAiPatch(original: AiSettings, draft: AiSettings): AiSettingsPatch {
  const before = serializeAiSettings(original) as Record<string, unknown>;
  const after = serializeAiSettings(draft) as Record<string, unknown>;
  const patch: AiSettingsPatch = {};
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(value) !== JSON.stringify(before[key])) {patch[key as `ai.${string}`] = value;}
  }
  return patch;
}

// ── Locality and engine issues ──────────────────────────────────────────────

export interface EngineLocalityInfo {
  /** What the router uses. */
  locality: AiLocality;
  /** What the URL says, whatever the pin. */
  detected: AiLocality;
  /** A pin that disagrees with the URL. */
  mismatch: boolean;
}

export function engineLocalityInfo(engine: AiEngineConfig, localNetworks: readonly string[]): EngineLocalityInfo {
  return {
    locality: engineLocality(engine, localNetworks),
    detected: detectLocality(engine.baseUrl, localNetworks),
    mismatch: localityMismatch(engine, localNetworks),
  };
}

export interface EngineIssue {
  level: 'warning' | 'info';
  /** Short tag for the row (pill or tooltip). */
  code: 'unsupportedKind' | 'badUrl' | 'noKey' | 'cloudBlocked' | 'localityMismatch';
  text: string;
}

/** A base URL the host can fetch: http(s) with a host. Empty string when fine, else the problem. */
export function baseUrlProblem(baseUrl: string): string {
  const t = baseUrl.trim();
  if (!t) {return 'Enter the server address, such as http://127.0.0.1:8000/v1.';}
  if (!/^https?:\/\//i.test(t)) {return 'Start the address with http:// or https://.';}
  try {
    const u = new URL(t);
    if (!u.hostname) {return 'The address has no host name.';}
  } catch {
    return 'This is not a valid address.';
  }
  return '';
}

/**
 * What an engine row warns about. `hasKey` comes from the host's status
 * (or the tab's own record of a key it just stored).
 */
export function engineIssues(engine: AiEngineConfig, settings: AiSettings, hasKey: boolean): EngineIssue[] {
  const issues: EngineIssue[] = [];
  if (!isKnownEngineKind(engine.kind)) {
    issues.push({ level: 'warning', code: 'unsupportedKind', text: `This version does not support the engine kind "${String(engine.kind)}". It is kept, but never used.` });
  }
  const urlProblem = baseUrlProblem(engine.baseUrl);
  if (urlProblem) {issues.push({ level: 'warning', code: 'badUrl', text: urlProblem });}
  const info = engineLocalityInfo(engine, settings.localNetworks);
  if (info.locality === 'cloud' && !hasKey && !engine.apiKeyEnv?.trim()) {
    issues.push({ level: 'warning', code: 'noKey', text: 'No API key. Store one, or name the environment variable that holds it.' });
  }
  if (info.mismatch) {
    issues.push({
      level: 'warning',
      code: 'localityMismatch',
      text: info.locality === 'cloud'
        ? 'Pinned to cloud, but the address looks local.'
        : 'Pinned to local, but the address looks like a cloud server. Text sent to it leaves this network.',
    });
  }
  if (info.locality === 'cloud' && !settings.allowCloud) {
    issues.push({ level: 'info', code: 'cloudBlocked', text: 'Blocked by Allow cloud.' });
  }
  return issues;
}

// ── Route pickers ───────────────────────────────────────────────────────────

export interface RoutePairOption {
  engineId: string;
  modelId: string;
  engineName: string;
  modelName: string;
  isLocal: boolean;
  /** False when the pair can never serve this route (the option is listed disabled). */
  selectable: boolean;
  /** Why it is not selectable, or a caveat on a selectable one (blocked by Allow cloud, failed test). */
  note?: string;
}

export interface RouteRequirements {
  requires: AiCapabilityRequirements;
  requiresAny?: readonly AiCapabilityFlag[];
}

/** The default route serves any task without its own route: it needs chat. */
export const DEFAULT_ROUTE_REQUIREMENTS: RouteRequirements = { requires: { chat: true } };

export function taskRequirements(taskId: string): RouteRequirements {
  const task = getAiTask(taskId);
  return task ? { requires: task.requires, requiresAny: task.requiresAny } : { requires: {} };
}

function lackingText(lacking: Array<keyof AiModelCapabilities>): string {
  return `lacks ${lacking.map((c) => CAPABILITY_WORDS[c] ?? c).join(', ')}`;
}

/**
 * Every engine/model pair for a picker, in registry order. Pairs that can
 * never serve the route (engine or model off, model no longer listed, a
 * missing capability, an unknown engine kind) are marked not selectable with
 * the reason. Cloud pairs stay selectable while Allow cloud is off (the user
 * may be setting routes up first) but carry a note.
 */
export function routePairs(settings: AiSettings, statuses: readonly AiEngineStatus[], req: RouteRequirements): RoutePairOption[] {
  const statusById = new Map(statuses.map((s) => [s.engineId, s]));
  const out: RoutePairOption[] = [];
  for (const engine of settings.engines) {
    const status = statusById.get(engine.id);
    const isLocal = engineLocality(engine, settings.localNetworks) === 'local';
    for (const model of engine.models) {
      const option: RoutePairOption = {
        engineId: engine.id,
        modelId: model.id,
        engineName: engineDisplayName(engine),
        modelName: modelDisplayName(model),
        isLocal,
        selectable: false,
      };
      const lacking = missingCapabilities(model.capabilities, req.requires, req.requiresAny);
      if (!isKnownEngineKind(engine.kind)) {option.note = 'engine kind not supported';}
      else if (!engine.enabled) {option.note = 'engine is off';}
      else if (!model.enabled) {option.note = 'model is off';}
      else if (model.missing || status?.models.find((m) => m.id === model.id)?.missing) {option.note = 'no longer listed';}
      else if (lacking.length > 0) {option.note = lackingText(lacking);}
      else {
        option.selectable = true;
        if (!isLocal && !settings.allowCloud) {option.note = 'blocked by Allow cloud';}
        else if (status?.ok === false) {option.note = 'failed its last test';}
      }
      out.push(option);
    }
  }
  return out;
}

export function routeKey(route: AiRoute | null | undefined): string {
  return route ? `${route.engineId}\u0000${route.modelId}` : '';
}

export function parseRouteKey(key: string): AiRoute | null {
  const i = key.indexOf('\u0000');
  if (i <= 0 || i === key.length - 1) {return null;}
  return { engineId: key.slice(0, i), modelId: key.slice(i + 1) };
}

/** "oMLX · Qwen 3.8 Flash Next", or the raw ids for a route that no longer resolves. */
export function routeLabel(settings: AiSettings, route: AiRoute): string {
  const engine = settings.engines.find((e) => e.id === route.engineId);
  const model = engine?.models.find((m) => m.id === route.modelId);
  return `${engine ? engineDisplayName(engine) : route.engineId} · ${model ? modelDisplayName(model) : route.modelId}`;
}

/** Feature id used only to ask the router about a task (no feature gate, no extra needs). */
const PREVIEW_FEATURE = '\u0000aiSettingsPreview';

/**
 * The route a task would really get right now, as the router sees it, with
 * AI and the feature assumed on and no consent answers yet (a cloud engine
 * that would ask first counts as usable).
 */
export function previewTaskRoute(settings: AiSettings, statuses: readonly AiEngineStatus[], task: string): AiRouteResolution {
  const probe: AiSettings = { ...settings, enabled: true, features: { ...settings.features, [PREVIEW_FEATURE]: { enabled: true } } };
  return resolveRoute(probe, statuses, {}, { feature: PREVIEW_FEATURE, task });
}

export interface TaskRouteNote {
  level: 'warning' | 'info';
  text: string;
}

/**
 * The warning under a task row: its route (own or default) cannot serve it,
 * with what serves it instead or that nothing will. Null when the route is
 * fine, or when the task has no route and no default exists yet.
 */
export function taskRouteNote(settings: AiSettings, statuses: readonly AiEngineStatus[], task: string): TaskRouteNote | null {
  const own = settings.routing.tasks[task];
  if (!own && !settings.routing.default) {return null;}
  const r = previewTaskRoute(settings, statuses, task);
  if ('unusable' in r) {
    // A task nobody routed is only informational (most setups have no embeddings model, say).
    if (!own) {return { level: 'info', text: `No model can serve this yet. ${r.reason}` };}
    const tail = settings.routing.fallback === 'none' ? 'Fallback is off, so this task will not run.' : 'No fallback can serve it either.';
    return { level: 'warning', text: `${r.reason} ${tail}` };
  }
  if (r.viaFallback) {
    return { level: own ? 'warning' : 'info', text: `${r.reason ?? 'The route is unavailable.'} Falls back to ${routeLabel(settings, r)}.` };
  }
  return null;
}

/** Task ids saved in `routing.tasks` that this version's taxonomy does not know. */
export function unknownRoutedTasks(settings: AiSettings): string[] {
  const known = new Set(AI_TASKS.map((t) => t.id));
  return Object.keys(settings.routing.tasks).filter((t) => !known.has(t));
}

/**
 * Make an engine the default: its first pair that can serve the default
 * route. Null when it has none (no models yet, or none with chat).
 */
export function defaultRouteForEngine(settings: AiSettings, statuses: readonly AiEngineStatus[], engineId: string): AiRoute | null {
  const pair = routePairs(settings, statuses, DEFAULT_ROUTE_REQUIREMENTS).find((p) => p.engineId === engineId && p.selectable);
  return pair ? { engineId: pair.engineId, modelId: pair.modelId } : null;
}

// ── Indicator chip ──────────────────────────────────────────────────────────

export type AiIndicatorTone = 'off' | 'on' | 'local' | 'cloud' | 'none';

export interface AiIndicatorState {
  /** Visible text, e.g. "AI: local · oMLX · Qwen 3.8 Flash Next". */
  text: string;
  tone: AiIndicatorTone;
  /** Tooltip. */
  title: string;
  /** A fallback served the last request. */
  fallback: boolean;
  /** The serving engine's pinned locality disagrees with its address. */
  warn: boolean;
}

export interface AiIndicatorInput {
  settings: AiSettings;
  statuses: readonly AiEngineStatus[];
  tier: AiHostTier;
  /** What served the last request, if anything has. */
  served: AiServedBy | null;
  viaFallback: boolean;
}

function servedLabels(settings: AiSettings, served: AiServedBy): { engine: string; model: string; warn: boolean } {
  const engine = served.engineId ? settings.engines.find((e) => e.id === served.engineId) : undefined;
  const model = engine?.models.find((m) => m.id === served.modelId);
  return {
    engine: served.engineName || (engine ? engineDisplayName(engine) : served.engineId ?? ''),
    model: model ? modelDisplayName(model) : served.modelId,
    warn: engine ? localityMismatch(engine, settings.localNetworks) : false,
  };
}

/**
 * The sidebar chip. Null hides it: AI has never been set up (off with no
 * engines), so a release that ships AI dark shows nothing new. Otherwise
 * `AI: off`, the engine and model that served the last request, the route
 * the next request would take (before anything was sent), `AI: no route`,
 * or `AI: on` for a host that routes by itself.
 */
export function aiIndicatorState(input: AiIndicatorInput): AiIndicatorState | null {
  const { settings, statuses, tier, served, viaFallback } = input;
  if (!settings.enabled) {
    if (settings.engines.length === 0) {return null;}
    return { text: 'AI: off', tone: 'off', title: 'AI features are turned off. Click to open AI settings.', fallback: false, warn: false };
  }
  if (served) {
    const where = served.isLocal ? 'local' : 'cloud';
    const l = servedLabels(settings, served);
    const parts = [`AI: ${where}`, l.engine, l.model].filter(Boolean);
    const text = parts.join(' · ') + (viaFallback ? ' (fallback)' : '');
    const title = `Last request served by ${l.engine} · ${l.model}, ${served.isLocal ? 'on this network' : 'a cloud engine'}${viaFallback ? ', through the fallback route' : ''}.${l.warn ? ' Its pinned locality disagrees with its address.' : ''} Click to open AI settings.`;
    return { text, tone: where, title, fallback: viaFallback, warn: l.warn };
  }
  if (tier === 1) {
    return { text: 'AI: on', tone: 'on', title: 'AI features are on. Click to open AI settings.', fallback: false, warn: false };
  }
  const r = previewTaskRoute(settings, statuses, getAiTask('rewrite') ? 'rewrite' : AI_TASKS[0].id);
  if ('unusable' in r) {
    return { text: 'AI: no route', tone: 'none', title: `${r.reason} Click to open AI settings.`, fallback: false, warn: false };
  }
  const engine = settings.engines.find((e) => e.id === r.engineId);
  const where = r.isLocal ? 'local' : 'cloud';
  const label = routeLabel(settings, r);
  const warn = engine ? localityMismatch(engine, settings.localNetworks) : false;
  return {
    text: `AI: ${where} · ${label}${r.viaFallback ? ' (fallback)' : ''}`,
    tone: where,
    title: `Requests go to ${label}${r.isLocal ? '' : ', a cloud engine'}. Nothing has been sent yet. Click to open AI settings.`,
    fallback: r.viaFallback,
    warn,
  };
}
