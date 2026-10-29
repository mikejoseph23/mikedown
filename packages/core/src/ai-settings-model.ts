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
  AI_ENGINE_PRESETS,
  AI_TASKS,
  DEFAULT_CONTEXT_TOKENS,
  aiConsentHost,
  detectCapabilities,
  detectLocality,
  engineLocality,
  generateAiId,
  getAiTask,
  isHostEngineKind,
  isKnownEngineKind,
  localityMismatch,
  mergeDiscoveredModels,
  missingCapabilities,
  presetForEngine,
  resolveRoute,
  serializeAiSettings,
  whatIsSent,
  withThinkingLevel,
} from './ai';
import type {
  AiCapabilityFlag,
  AiCapabilityRequirements,
  AiDiscoveredModel,
  AiEngineConfig,
  AiEngineKind,
  AiEnginePreset,
  AiEngineStatus,
  AiErrorCode,
  AiLocalServerProbe,
  AiLocality,
  AiModelCapabilities,
  AiModelConfig,
  AiPopularRule,
  AiPresetFamily,
  AiRoute,
  AiRouteResolution,
  AiSendsScope,
  AiServedBy,
  AiSettings,
  AiSettingsPatch,
  AiThinkingLevel,
} from './ai';
import type { AiHostTier } from './ai-lite';

// ── Host tier ───────────────────────────────────────────────────────────────

// In ai-lite.ts: the editor needs it before the AI UI loads.
export { aiHostTier, type AiHostTier } from './ai-lite';

// ── Labels ──────────────────────────────────────────────────────────────────

export const AI_ENGINE_KIND_LABELS: Readonly<Record<AiEngineKind, string>> = {
  'openai-compatible': 'OpenAI-compatible',
  lmstudio: 'LM Studio',
  ollama: 'Ollama',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'vscode-lm': 'GitHub Copilot (VS Code)',
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
  if (preset.apiKeyFile) {engine.apiKeyFile = { ...preset.apiKeyFile };}
  return engine;
}

/**
 * Group presets for the quick-start cards by family (where they run). `host`
 * presets (VS Code's Copilot models) are kept apart: they show only where
 * the host reports one (`detectHostEngines`).
 */
export function groupPresets(presets: readonly AiEnginePreset[]): { local: AiEnginePreset[]; cloud: AiEnginePreset[]; host: AiEnginePreset[] } {
  const groups: { local: AiEnginePreset[]; cloud: AiEnginePreset[]; host: AiEnginePreset[] } = { local: [], cloud: [], host: [] };
  for (const p of presets) {groups[p.family].push(p);}
  return groups;
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
  // A host kind (`vscode-lm`) has no address and no key.
  const hostKind = isHostEngineKind(engine.kind);
  const urlProblem = hostKind ? '' : baseUrlProblem(engine.baseUrl);
  if (urlProblem) {issues.push({ level: 'warning', code: 'badUrl', text: urlProblem });}
  const info = engineLocalityInfo(engine, settings.localNetworks);
  if (!hostKind && info.locality === 'cloud' && !hasKey && !engine.apiKeyEnv?.trim() && !engine.apiKeyFile?.path.trim()) {
    issues.push({ level: 'warning', code: 'noKey', text: 'No API key. Store one, or name the environment variable or key file that holds it.' });
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

/**
 * Whether the default route can serve a request as saved: an enabled engine
 * of a known kind and an enabled, still listed chat model. The Engines page
 * opened by "Set up" turns AI on at Done only then (B3).
 */
export function hasUsableDefaultRoute(settings: Pick<AiSettings, 'engines' | 'routing'>): boolean {
  const route = settings.routing.default;
  const engine = route && settings.engines.find((e) => e.id === route.engineId);
  if (!route || !engine || !engine.enabled || !isKnownEngineKind(engine.kind)) {return false;}
  const model = engine.models.find((m) => m.id === route.modelId);
  return !!model && model.enabled && !model.missing && model.capabilities.chat;
}

// ── Local server detection ──────────────────────────────────────────────────

/** One local quick-start card after detection. */
export interface LocalServerCard {
  presetId: string;
  baseUrl: string;
  running: boolean;
  /** Models the server listed, when it answered with a list. */
  models?: number;
  latencyMs?: number;
  /** An engine at this address already exists (`engineId`): the card opens it instead of adding another. */
  alreadyAdded: boolean;
  engineId?: string;
}

/** Scheme, host and port, with `localhost` and `127.0.0.1` the same, plus the path without a trailing slash. */
function addressKey(url: string): string {
  try {
    const u = new URL(url.trim());
    const host = u.hostname === 'localhost' || u.hostname === '[::1]' ? '127.0.0.1' : u.hostname;
    return `${u.protocol}//${host}:${u.port || (u.protocol === 'https:' ? '443' : '80')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * The local cards' order after a detection: servers that answered and are
 * not set up yet first (most models first), then the ones that did not
 * answer, then those that already have an engine. Ties keep the probe order
 * (the presets'). An engine counts as this preset's when it has the same kind
 * and address and does not look like another preset's (oMLX and vLLM share
 * port 8000; `presetForEngine` tells them apart by key variable).
 */
export function rankLocalCandidates(
  probes: readonly AiLocalServerProbe[],
  existingEngines: readonly Pick<AiEngineConfig, 'id' | 'kind' | 'baseUrl' | 'apiKeyEnv'>[],
  presets: readonly AiEnginePreset[] = AI_ENGINE_PRESETS,
): LocalServerCard[] {
  const cards = probes.map((probe, index) => {
    const preset = presets.find((p) => p.id === probe.presetId);
    const engine = preset && existingEngines.find((e) =>
      e.kind === preset.kind
      && addressKey(e.baseUrl) === addressKey(probe.baseUrl)
      && (presetForEngine(e, presets)?.id ?? preset.id) === preset.id);
    const card: LocalServerCard = { presetId: probe.presetId, baseUrl: probe.baseUrl, running: probe.ok, alreadyAdded: !!engine };
    if (engine) {card.engineId = engine.id;}
    if (probe.ok && probe.models !== undefined) {card.models = probe.models;}
    if (probe.latencyMs !== undefined) {card.latencyMs = probe.latencyMs;}
    return { card, index };
  });
  const rank = (c: LocalServerCard) => (c.alreadyAdded ? 2 : c.running ? 0 : 1);
  return cards
    .sort((a, b) => rank(a.card) - rank(b.card)
      || (a.card.running && b.card.running ? (b.card.models ?? 0) - (a.card.models ?? 0) : 0)
      || a.index - b.index)
    .map((x) => x.card);
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

/**
 * What served a request, plus the request's feature and scope when the
 * editor knows them (the popover attaches them), so the chip can say what
 * was sent. Hosts never set the extra fields.
 */
export type AiServedRequest = AiServedBy & { feature?: string; sends?: AiSendsScope };

export interface AiIndicatorInput {
  settings: AiSettings;
  statuses: readonly AiEngineStatus[];
  tier: AiHostTier;
  /** What served the last request, if anything has. */
  served: AiServedRequest | null;
  viaFallback: boolean;
}

/** " It sent text to api.anthropic.com: the selected text …." for a cloud request; empty for a local one. */
function cloudSentNote(settings: AiSettings, served: AiServedRequest): string {
  if (served.isLocal) {return '';}
  const engine = served.engineId ? settings.engines.find((e) => e.id === served.engineId) : undefined;
  const host = engine ? aiConsentHost(engine) : null;
  const what = served.feature || served.sends ? whatIsSent(served.feature, served.sends) : '';
  if (host) {return what ? ` It sent text to ${host}: ${what}.` : ` It sent text to ${host}.`;}
  return what ? ` It sent ${what}.` : '';
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
 * the next request would take (before anything was sent), `AI: no model
 * chosen`, or `AI: on` for a host that routes by itself. The tooltip ends
 * with what a click opens (`openAiFromChip`): the Tasks page when no model
 * is chosen, the AI tab otherwise.
 */
/** The chip tooltip's last sentence: what a click opens (U7). */
export const AI_CHIP_CLICK_SETTINGS = 'Click for AI settings.';
export const AI_CHIP_CLICK_CHOOSE = 'Click to choose a model.';

export function aiIndicatorState(input: AiIndicatorInput): AiIndicatorState | null {
  const { settings, statuses, tier, served, viaFallback } = input;
  if (!settings.enabled) {
    if (settings.engines.length === 0) {return null;}
    return { text: 'AI: off', tone: 'off', title: `AI features are turned off. ${AI_CHIP_CLICK_SETTINGS}`, fallback: false, warn: false };
  }
  if (served) {
    const where = served.isLocal ? 'local' : 'cloud';
    const l = servedLabels(settings, served);
    const parts = [`AI: ${where}`, l.engine, l.model].filter(Boolean);
    const text = parts.join(' · ') + (viaFallback ? ' (fallback)' : '');
    const title = `Last request served by ${l.engine} · ${l.model}, ${served.isLocal ? 'on this network' : 'a cloud engine'}${viaFallback ? ', through the fallback route' : ''}.${cloudSentNote(settings, served)}${l.warn ? ' Its pinned locality disagrees with its address.' : ''} ${AI_CHIP_CLICK_SETTINGS}`;
    return { text, tone: where, title, fallback: viaFallback, warn: l.warn };
  }
  if (tier === 1) {
    return { text: 'AI: on', tone: 'on', title: `AI features are on. ${AI_CHIP_CLICK_SETTINGS}`, fallback: false, warn: false };
  }
  const r = previewTaskRoute(settings, statuses, getAiTask('rewrite') ? 'rewrite' : AI_TASKS[0].id);
  if ('unusable' in r) {
    return { text: 'AI: no model chosen', tone: 'none', title: `${r.reason} ${AI_CHIP_CLICK_CHOOSE}`, fallback: false, warn: false };
  }
  const engine = settings.engines.find((e) => e.id === r.engineId);
  const where = r.isLocal ? 'local' : 'cloud';
  const label = routeLabel(settings, r);
  const warn = engine ? localityMismatch(engine, settings.localNetworks) : false;
  return {
    text: `AI: ${where} · ${label}${r.viaFallback ? ' (fallback)' : ''}`,
    tone: where,
    title: `Requests go to ${label}${r.isLocal ? '' : ', a cloud engine'}. Nothing has been sent yet. ${AI_CHIP_CLICK_SETTINGS}`,
    fallback: r.viaFallback,
    warn,
  };
}

// ── Express engine form ─────────────────────────────────────────────────────

/** What the Express form needs to know about an engine's preset, real or inferred. */
export interface EngineFormPreset {
  /** Preset id, or `custom` for an engine no preset fits. */
  id: string;
  /** Preset name ("LM Studio"), used in failure copy. */
  name: string;
  family: AiPresetFamily;
  needsKey: boolean;
  keyHint: string;
  /** Where the provider makes API keys (cloud presets); the key hint links to it. */
  keyUrl?: string;
  /** The provider's API pricing page (cloud presets), for the "Pricing" link beside the key link. */
  pricingUrl?: string;
  popular: readonly AiPopularRule[];
}

/**
 * The preset behind a saved engine (see `presetForEngine`), or a stand-in
 * whose family follows the engine's locality: a hand-made engine on a cloud
 * address gets the cloud form.
 */
export function enginePreset(engine: AiEngineConfig, localNetworks: readonly string[]): EngineFormPreset {
  const p = presetForEngine(engine);
  if (p) {
    return {
      id: p.id,
      name: p.name,
      family: p.family,
      needsKey: p.needsKey,
      keyHint: p.keyHint,
      ...(p.keyUrl ? { keyUrl: p.keyUrl } : {}),
      ...(p.pricingUrl ? { pricingUrl: p.pricingUrl } : {}),
      popular: p.popular ?? [],
    };
  }
  const family: AiPresetFamily = engineLocality(engine, localNetworks) === 'local' ? 'local' : 'cloud';
  return {
    id: 'custom',
    name: engineDisplayName(engine),
    family,
    needsKey: family === 'cloud',
    keyHint: family === 'cloud' ? 'The API key from the provider’s console.' : 'Leave blank if the server has no auth.',
    popular: [],
  };
}

export type ExpressField = 'name' | 'key' | 'baseUrl' | 'models' | 'defaultModel' | 'thinking' | 'enabled';
export type AdvancedField = 'kind' | 'baseUrl' | 'locality' | 'key' | 'keyEnv' | 'keyFile' | 'discovery' | 'modelsTable';

/**
 * Which fields the Express form shows for a preset (design call 1), in
 * order, and which sit under Advanced. Cloud: the key, never the URL. Local:
 * the URL, and the key only when the server expects one (or for Custom);
 * otherwise the key moves under Advanced, so nothing is lost.
 */
export function expressFields(preset: Pick<EngineFormPreset, 'id' | 'family' | 'needsKey'>): { express: ExpressField[]; advanced: AdvancedField[] } {
  // Built into the host (VS Code's Copilot models): no address, no key, no thinking fields.
  if (preset.family === 'host') {
    return { express: ['name', 'models', 'defaultModel', 'enabled'], advanced: ['discovery', 'modelsTable'] };
  }
  if (preset.family === 'cloud') {
    return {
      express: ['name', 'key', 'models', 'defaultModel', 'thinking', 'enabled'],
      advanced: ['kind', 'baseUrl', 'locality', 'keyEnv', 'keyFile', 'discovery', 'modelsTable'],
    };
  }
  const keyExpress = preset.needsKey || preset.id === 'custom';
  return {
    express: keyExpress
      ? ['name', 'baseUrl', 'key', 'models', 'defaultModel', 'thinking', 'enabled']
      : ['name', 'baseUrl', 'models', 'defaultModel', 'thinking', 'enabled'],
    advanced: keyExpress
      ? ['kind', 'locality', 'keyEnv', 'keyFile', 'discovery', 'modelsTable']
      : ['kind', 'locality', 'key', 'keyEnv', 'keyFile', 'discovery', 'modelsTable'],
  };
}

export interface ModelPickerOption {
  id: string;
  /** Display name (label or id). */
  name: string;
  /** The label differs from the id (the row shows both). */
  hasLabel: boolean;
  enabled: boolean;
  loaded: boolean;
  missing: boolean;
  manual: boolean;
}

/**
 * The models picker's rows: filtered by id or label (case-insensitive),
 * loaded models first on LM Studio, models the server no longer lists last;
 * otherwise in the engine's order.
 */
export function modelPickerOptions(engine: AiEngineConfig, status: AiEngineStatus | undefined, filter = ''): ModelPickerOption[] {
  const loaded = new Map((status?.models ?? []).map((m) => [m.id, !!m.loaded]));
  const needle = filter.trim().toLowerCase();
  const rows = engine.models
    .map((m, index): ModelPickerOption & { index: number } => ({
      id: m.id,
      name: modelDisplayName(m),
      hasLabel: !!m.label?.trim() && m.label.trim() !== m.id,
      enabled: m.enabled,
      loaded: loaded.get(m.id) ?? false,
      missing: !!(m.missing || status?.models.find((s) => s.id === m.id)?.missing),
      manual: !!m.manual,
      index,
    }))
    .filter((o) => !needle || o.id.toLowerCase().includes(needle) || o.name.toLowerCase().includes(needle));
  const rank = (o: ModelPickerOption) => (o.missing ? 2 : engine.kind === 'lmstudio' && o.loaded ? 0 : 1);
  rows.sort((a, b) => rank(a) - rank(b) || a.index - b.index);
  return rows.map(({ index: _index, ...o }) => o);
}

/** "312 models, 2 picked". Missing models are not counted. */
export function modelCountLine(engine: AiEngineConfig): string {
  const listed = engine.models.filter((m) => !m.missing);
  const picked = listed.filter((m) => m.enabled).length;
  if (listed.length === 0) {return 'No models yet';}
  return `${listed.length} ${listed.length === 1 ? 'model' : 'models'}, ${picked} picked`;
}

/**
 * Merge a discovery with OPEN-12's enabled rule: on a local engine new
 * models arrive enabled; on a cloud engine they arrive off unless `picked`
 * names them. Models already in the engine keep their own `enabled`.
 */
export function applyDiscoveryForFamily(
  engine: AiEngineConfig,
  status: AiEngineStatus,
  family: AiPresetFamily,
  picked: Iterable<string> = [],
): AiEngineConfig {
  const merged = mergeDiscoveryStatus(engine, status);
  if (family === 'local') {return merged;}
  const before = new Set(engine.models.map((m) => m.id));
  const pick = new Set(picked);
  return {
    ...merged,
    models: merged.models.map((m) => (before.has(m.id) ? m : { ...m, enabled: pick.has(m.id) })),
  };
}

/** Numbers in an id, split into a version (short numbers) and a date stamp (6+ digits). */
function versionOf(id: string): { version: number[]; date: number } {
  const version: number[] = [];
  let date = 0;
  for (const n of id.match(/\d+/g) ?? []) {
    if (n.length >= 6) {date = Math.max(date, Number(n));} else {version.push(Number(n));}
  }
  return { version, date };
}

/** Negative when `a` should rank first: a `prefer` match (a `-latest` alias), then the newer version. */
function compareNewest(a: string, b: string, prefer?: RegExp): number {
  if (prefer) {
    const pa = prefer.test(a) ? 0 : 1;
    const pb = prefer.test(b) ? 0 : 1;
    if (pa !== pb) {return pa - pb;}
  }
  const va = versionOf(a);
  const vb = versionOf(b);
  for (let i = 0; i < Math.max(va.version.length, vb.version.length); i++) {
    const d = (vb.version[i] ?? 0) - (va.version[i] ?? 0);
    if (d !== 0) {return d;}
  }
  // An undated alias outranks its dated snapshots; among snapshots, the latest date.
  if (va.date !== vb.date) {return va.date === 0 ? -1 : vb.date === 0 ? 1 : vb.date - va.date;}
  return a.length - b.length || a.localeCompare(b);
}

/**
 * The Popular group: for each of the preset's rules, the newest listed model
 * that matches, in rule order. No hardcoded ids: whatever the endpoint lists
 * today decides.
 */
export function popularModels<M extends Pick<AiModelConfig, 'id'> & { missing?: boolean }>(
  preset: Pick<EngineFormPreset, 'popular'> | Pick<AiEnginePreset, 'popular'>,
  models: readonly M[],
): M[] {
  const out: M[] = [];
  for (const rule of preset.popular ?? []) {
    const hits = models.filter((m) => !m.missing && rule.match.test(m.id) && !(rule.exclude?.test(m.id)) && !out.includes(m));
    if (hits.length === 0) {continue;}
    out.push(hits.slice().sort((a, b) => compareNewest(a.id, b.id, rule.prefer))[0]);
  }
  return out;
}

/**
 * The model to pick after a cloud engine's first fetch: the first Popular
 * model that can chat, else the only chat model when there is just one.
 * Null when there is nothing sensible to guess.
 */
export function autoPickDefault(
  preset: Pick<EngineFormPreset, 'popular'> | Pick<AiEnginePreset, 'popular'>,
  models: readonly AiModelConfig[],
): string | null {
  const chat = (m: AiModelConfig) => !m.missing && m.capabilities.chat;
  const popular = popularModels(preset, models).find(chat);
  if (popular) {return popular.id;}
  const chatModels = models.filter(chat);
  return chatModels.length === 1 ? chatModels[0].id : null;
}

/**
 * The model to pick after a host engine's first fetch (VS Code's Copilot
 * models, which have no Popular rules): the first listed chat model, in the
 * host's own order. Null when none can chat.
 */
export function firstChatModelId(models: readonly AiModelConfig[]): string | null {
  return models.find((m) => !m.missing && m.capabilities.chat)?.id ?? null;
}

/**
 * The engine's Default model: the default route's model when this is the
 * default engine, else its first enabled model that is still listed (which
 * is what the star picks). Null when nothing is enabled.
 */
export function engineDefaultModelId(settings: AiSettings, engineId: string): string | null {
  const engine = settings.engines.find((e) => e.id === engineId);
  if (!engine) {return null;}
  const def = settings.routing.default;
  if (def?.engineId === engineId && engine.models.some((m) => m.id === def.modelId)) {return def.modelId;}
  return engine.models.find((m) => m.enabled && !m.missing)?.id ?? null;
}

/**
 * Make a model the engine's Default model: it is enabled and moved first
 * (so the star and a routing row pick it, no new settings key), and it
 * becomes the default route when this is the default engine or no default
 * route exists yet.
 */
export function setEngineDefaultModel(settings: AiSettings, engineId: string, modelId: string): AiSettings {
  const engine = settings.engines.find((e) => e.id === engineId);
  const model = engine?.models.find((m) => m.id === modelId);
  if (!engine || !model) {return settings;}
  const models = [{ ...model, enabled: true }, ...engine.models.filter((m) => m.id !== modelId)];
  const next = withEngine(settings, { ...engine, models });
  const def = settings.routing.default;
  if (!def || def.engineId === engineId) {
    return { ...next, routing: { ...next.routing, default: { ...(def ?? {}), engineId, modelId } } };
  }
  return next;
}

/**
 * Turn one model on or off in the picker. Picking a chat model while no
 * default route exists makes it the default (key = done, without a trip to
 * the star); turning off the default route's model moves the route to the
 * engine's next enabled model (or clears it).
 */
export function setModelPicked(settings: AiSettings, engineId: string, modelId: string, enabled: boolean): AiSettings {
  const engine = settings.engines.find((e) => e.id === engineId);
  const model = engine?.models.find((m) => m.id === modelId);
  if (!engine || !model) {return settings;}
  const next = withEngine(settings, withModel(engine, { ...model, enabled }));
  const def = next.routing.default;
  if (enabled && !def && model.capabilities.chat && engine.enabled) {
    return { ...next, routing: { ...next.routing, default: { engineId, modelId } } };
  }
  if (enabled || def?.engineId !== engineId || def.modelId !== modelId) {return next;}
  const replacement = next.engines.find((e) => e.id === engineId)?.models.find((m) => m.enabled && !m.missing);
  return { ...next, routing: { ...next.routing, default: replacement ? { ...def, modelId: replacement.id } : null } };
}

/** Set (or with null, clear) a model's thinking level inside its `requestOverrides`. */
export function setModelThinking(model: AiModelConfig, kind: string, level: AiThinkingLevel | null, local: boolean): AiModelConfig {
  const next: AiModelConfig = { ...model };
  const overrides = withThinkingLevel(kind, model.requestOverrides, level, { local });
  if (overrides) {next.requestOverrides = overrides;} else {delete next.requestOverrides;}
  return next;
}

// ── Auto-fetch ──────────────────────────────────────────────────────────────

/** What can set off a model fetch in the Express form. */
export type AutoFetchEvent = 'open' | 'key' | 'url' | 'manual' | 'retry' | 'save';

/** A snapshot of the form fields that matter for fetching, plus the event that changed them. */
export interface AutoFetchState {
  event: AutoFetchEvent;
  family: AiPresetFamily;
  /** What is in the key field (not the stored key, which the form never sees). */
  key: string;
  baseUrl: string;
  discovery: 'auto' | 'manual';
  /** The host has never probed or discovered this engine. */
  neverProbed?: boolean;
  /** The host has a key for the engine (stored, a variable or a key file), whatever the field says. */
  hasKey?: boolean;
  /** Models the engine has in settings now. */
  modelCount?: number;
  /** The URL or key the last fetch ran for, so a blur without a change does not fetch again. */
  fetchedFor?: string;
}

export interface AutoFetchDecision {
  fetch: boolean;
  /** Wait this long first (a settling key); 0 runs now. */
  delayMs: number;
  /** Store the key field through `setSecret` before discovering (discovery reads the stored key). */
  storeKey: boolean;
  /** Drop a scheduled or running fetch (a newer trigger, or the key was emptied). */
  cancelPending: boolean;
  /** Value to remember as `fetchedFor` once the fetch runs. */
  fingerprint: string;
}

/** How long the key field must settle before it is stored and models are fetched (design call 3). */
export const AUTO_FETCH_KEY_DELAY_MS = 600;

/** What a fetch ran for: the key field on a cloud engine, the URL on a local one. */
export function fetchFingerprint(family: AiPresetFamily, key: string, baseUrl: string): string {
  return family === 'cloud' ? `key:${key.trim()}` : `url:${baseUrl.trim()}`;
}

const NO_FETCH = (cancelPending: boolean, fingerprint = ''): AutoFetchDecision => ({ fetch: false, delayMs: 0, storeKey: false, cancelPending, fingerprint });

/**
 * When the Express form fetches models (design call 3), as plain data so
 * tests need no timers. Cloud: 600 ms after the key field settles on a new,
 * non-empty value, storing the key first, and on open for an engine with no
 * models that the host never probed but already has a key for (from
 * `ANTHROPIC_API_KEY` or a key file, B2). Local: when the URL changes (on
 * change or blur) to a new valid address, and when the form opens for an
 * engine the host never probed. Manual and Retry always run (the user
 * asked). A plain save never fetches; `discovery: manual` never auto-fetches.
 */
export function autoFetchDecision(prev: AutoFetchState | null, next: AutoFetchState): AutoFetchDecision {
  // A host engine (VS Code's Copilot models) has no address to check.
  const urlOk = next.family === 'host' || !baseUrlProblem(next.baseUrl);
  const key = next.key.trim();
  const cloudFingerprint = fetchFingerprint('cloud', key, next.baseUrl);
  const localFingerprint = fetchFingerprint('local', key, next.baseUrl);
  const fingerprint = next.family === 'cloud' ? cloudFingerprint : localFingerprint;
  if (next.event === 'save') {return NO_FETCH(false);}
  if (next.event === 'manual' || next.event === 'retry') {
    if (!urlOk || next.discovery === 'manual') {return NO_FETCH(false);}
    return { fetch: true, delayMs: 0, storeKey: next.family === 'cloud' ? !!key : false, cancelPending: true, fingerprint };
  }
  if (next.discovery === 'manual' || !urlOk) {return NO_FETCH(next.event === 'key' && !key);}
  if (next.family === 'cloud') {
    // The key came from a variable or a key file: the hard part is done, so fetch on open.
    if (next.event === 'open') {
      return next.hasKey && !next.modelCount && next.neverProbed
        ? { fetch: true, delayMs: 0, storeKey: false, cancelPending: true, fingerprint: cloudFingerprint }
        : NO_FETCH(false);
    }
    if (next.event !== 'key') {return NO_FETCH(false);}
    if (!key) {return NO_FETCH(true);}
    const already = (next.fetchedFor ?? prev?.fetchedFor) === cloudFingerprint;
    if (already || (prev && prev.key.trim() === key && prev.event === 'key')) {return NO_FETCH(false, cloudFingerprint);}
    return { fetch: true, delayMs: AUTO_FETCH_KEY_DELAY_MS, storeKey: true, cancelPending: true, fingerprint: cloudFingerprint };
  }
  if (next.event === 'open') {
    return next.neverProbed
      ? { fetch: true, delayMs: 0, storeKey: false, cancelPending: true, fingerprint: localFingerprint }
      : NO_FETCH(false, localFingerprint);
  }
  if (next.event === 'url') {
    if ((next.fetchedFor ?? prev?.fetchedFor) === localFingerprint) {return NO_FETCH(false, localFingerprint);}
    return { fetch: true, delayMs: 0, storeKey: false, cancelPending: true, fingerprint: localFingerprint };
  }
  // A key typed into a local engine's field is stored, but the URL drives fetching.
  return NO_FETCH(false);
}

// ── Fetch failures ──────────────────────────────────────────────────────────

export interface DiscoveryProblem {
  kind: 'unreachable' | 'auth' | 'empty' | 'other';
  text: string;
  /** Put focus back here (the key field after a rejected key). */
  focus?: 'key';
  /** Offer Retry. */
  retry: boolean;
}

const AUTH_TEXT = /\bHTTP 40[13]\b|unauthori[sz]ed|forbidden|invalid[^.]*\bkey|incorrect[^.]*\bkey|api key|authentication/i;
const UNREACHABLE_TEXT = /could not reach|no answer|timed out|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|fetch failed|connection refused|network/i;

/** The host's error code when it gave one, else read from the message (statuses carry text only). */
export function discoveryErrorCode(code: AiErrorCode | undefined, message: string | undefined): AiErrorCode {
  if (code && code !== 'unknown') {return code;}
  const text = message ?? '';
  if (AUTH_TEXT.test(text)) {return 'auth';}
  if (UNREACHABLE_TEXT.test(text)) {return 'unreachable';}
  return 'unknown';
}

/**
 * The inline message under Models after a fetch (design call 4), or null
 * when it went fine. Every failure still lets the user type a model id.
 */
export function discoveryProblem(input: {
  family: AiPresetFamily;
  presetName: string;
  baseUrl: string;
  ok: boolean;
  code?: AiErrorCode;
  message?: string;
  /** Models the server listed (missing ones excluded). */
  listed: number;
}): DiscoveryProblem | null {
  if (input.ok) {
    return input.listed === 0
      ? { kind: 'empty', text: 'Server is up but no models are loaded.', retry: true }
      : null;
  }
  const code = discoveryErrorCode(input.code, input.message);
  // VS Code's Copilot models: no key or address to point at; the host's message says what to do.
  if (input.family === 'host') {
    return { kind: code === 'auth' ? 'auth' : 'other', text: input.message || `Could not list ${input.presetName}’s models.`, retry: true };
  }
  if (code === 'auth') {
    return { kind: 'auth', text: `Key rejected by ${shortUrl(input.baseUrl)}.`, focus: 'key', retry: true };
  }
  if (code === 'unreachable' && input.family === 'local') {
    const name = input.presetName.startsWith('Custom') ? 'the server' : input.presetName;
    return { kind: 'unreachable', text: `Nothing answered at ${input.baseUrl.trim()}. Is ${name} running?`, retry: true };
  }
  if (code === 'unreachable') {
    return { kind: 'unreachable', text: `Could not reach ${shortUrl(input.baseUrl)}.`, retry: true };
  }
  return { kind: 'other', text: input.message ? `Could not fetch models: ${input.message}` : 'Could not fetch models.', retry: true };
}
