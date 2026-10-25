/**
 * AI provider layer contracts: the settings shape (engines, models, routing,
 * features) and the `ai` host group.
 *
 * Everything under `packages/core/src/ai/` is pure: no network, no DOM, no
 * provider SDK. Inference runs in the host (VS Code extension host, the
 * Desktop Rust side, or an npm consumer's own backend); core only resolves
 * which engine and model should serve a request and renders the UI.
 *
 * Open-ended by design: `routing.tasks` and `features` are open maps, and the
 * parser keeps keys it does not understand on every object (top level,
 * engines, models, routes, feature entries), so a newer version's settings
 * survive a save from an older one. Those extra keys ride along at runtime
 * and are not part of these types.
 */

// ── Engines and models ──────────────────────────────────────────────────────

/**
 * How the host talks to an engine. `openai-compatible` covers oMLX, vLLM,
 * llama.cpp server and the hosted OpenAI-style APIs (OpenRouter, Groq,
 * Gemini, Mistral, DeepSeek, xAI). A settings file written by a newer version
 * may carry a kind this one does not know; such engines are kept on save but
 * never routed (see `isKnownEngineKind`).
 */
export type AiEngineKind = 'openai-compatible' | 'lmstudio' | 'ollama' | 'anthropic' | 'openai';

export const AI_ENGINE_KINDS: readonly AiEngineKind[] = ['openai-compatible', 'lmstudio', 'ollama', 'anthropic', 'openai'];

/** `auto` derives local or cloud from the base URL (see `detectLocality`). */
export type AiLocalitySetting = 'auto' | 'local' | 'cloud';
export type AiLocality = 'local' | 'cloud';

/** Where a model's capability values came from. Re-discovery refreshes `endpoint` and `heuristic`, never `user`. */
export type AiCapabilitiesSource = 'endpoint' | 'heuristic' | 'user';

export interface AiModelCapabilities {
  /** Chat/instruct completion. */
  chat: boolean;
  /** SSE token streaming (assumed true unless the probe says otherwise). */
  stream: boolean;
  /** Image inputs. */
  vision: boolean;
  /** JSON mode or reliable structured output. */
  json: boolean;
  /** Function calling. */
  tools: boolean;
  /** Fill-in-the-middle / raw completion (ghost text). */
  fim: boolean;
  /** Embeddings endpoint. */
  embed: boolean;
  /** Context window in tokens; null when unknown (treated as `DEFAULT_CONTEXT_TOKENS`). */
  contextTokens: number | null;
}

/** The boolean capability flags, for chips and requirement checks. */
export type AiCapabilityFlag = Exclude<keyof AiModelCapabilities, 'contextTokens'>;

export const AI_CAPABILITY_FLAGS: readonly AiCapabilityFlag[] = ['chat', 'stream', 'vision', 'json', 'tools', 'fim', 'embed'];

/** Context window assumed when neither the endpoint nor the id says (OPEN-10). */
export const DEFAULT_CONTEXT_TOKENS = 8192;

export interface AiModelConfig {
  /** The id the endpoint knows the model by (sent as `model`). Unique within its engine. */
  id: string;
  /** Display name. Absent means show the id. */
  label?: string;
  enabled: boolean;
  capabilities: AiModelCapabilities;
  capabilitiesSource: AiCapabilitiesSource;
  /**
   * Merged into the request body last, so it wins (OPEN-6): thinking controls
   * such as `reasoning_effort`, `thinking_budget`, `chat_template_kwargs`.
   */
  requestOverrides?: Record<string, unknown>;
  /** The last discovery did not list this model. Kept (greyed), never routed. */
  missing?: boolean;
  /** Added by hand. A discovery that does not list it leaves it alone (no `missing`). */
  manual?: boolean;
}

export interface AiEngineConfig {
  /** Stable, generated once, never shown. */
  id: string;
  name: string;
  kind: AiEngineKind;
  /** e.g. `http://127.0.0.1:8000/v1` or `https://api.anthropic.com`. */
  baseUrl: string;
  enabled: boolean;
  locality: AiLocalitySetting;
  /** Environment variable the host reads when no key is stored. The key itself is never in settings. */
  apiKeyEnv?: string;
  /** `auto` lists models from the endpoint and merges them with manual ones; `manual` never asks. */
  discovery: 'auto' | 'manual';
  models: AiModelConfig[];
}

// ── Routing and features ────────────────────────────────────────────────────

export interface AiRoute {
  engineId: string;
  modelId: string;
}

/**
 * What to do when a task's route is unusable. `none` disables the surface,
 * `default` tries the default route, `anyLocal` then any usable local
 * model, `any` then cloud engines that pass the gate.
 */
export type AiFallbackMode = 'none' | 'default' | 'anyLocal' | 'any';

export const AI_FALLBACK_MODES: readonly AiFallbackMode[] = ['none', 'default', 'anyLocal', 'any'];

export interface AiRouting {
  /** Null until the user picks one. */
  default: AiRoute | null;
  fallback: AiFallbackMode;
  /** Open map keyed by task id (see `AI_TASKS`). An absent task uses `default`. */
  tasks: Record<string, AiRoute>;
}

/** One feature's saved state. Absent fields fall back to the feature registry. */
export interface AiFeatureSetting {
  enabled?: boolean;
  /** Task override, e.g. `{ task: 'vision' }`. */
  task?: string;
}

/** Open map keyed by feature id (see `AI_FEATURES`). */
export type AiFeatureSettings = Record<string, AiFeatureSetting>;

/** Everything under `mikedown.ai.*`. Built by `parseAiSettings`, saved by `serializeAiSettings`. */
export interface AiSettings {
  /** Master switch. Default false. */
  enabled: boolean;
  /** Global gate for cloud engines. Default false; per-workspace consent applies on top. */
  allowCloud: boolean;
  engines: AiEngineConfig[];
  routing: AiRouting;
  features: AiFeatureSettings;
  /** CIDR ranges (and `.suffix` host names) that count as local. Default RFC 1918. */
  localNetworks: string[];
}

// ── Host group ──────────────────────────────────────────────────────────────

export type AiMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; mime: string; bytes: Uint8Array };

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | AiMessagePart[];
}

export interface AiCompletionRequest {
  requestId: string;
  /** Feature id, for logging and consent copy. */
  feature: string;
  /** Task id, informational for tier-1 hosts. */
  task: string;
  /** Resolved by core; tier-1 hosts may ignore it. */
  route?: AiRoute;
  messages: AiMessage[];
  format?: 'text' | 'json';
  maxTokens?: number;
  temperature?: number;
}

export interface AiServedBy {
  engineId?: string;
  /** e.g. "oMLX (Mac Studio)". */
  engineName: string;
  modelId: string;
  isLocal: boolean;
}

export type AiFinishReason = 'stop' | 'length' | 'cancelled' | 'error';

export interface AiUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface AiCompletionResult {
  text: string;
  served: AiServedBy;
  usage?: AiUsage;
  finishReason?: AiFinishReason;
}

/** One model as the host last saw it. */
export interface AiEngineStatusModel {
  id: string;
  label?: string;
  capabilities: AiModelCapabilities;
  source: AiCapabilitiesSource;
  missing?: boolean;
  /** Loaded in memory right now (LM Studio, Ollama report it). */
  loaded?: boolean;
}

export interface AiEngineStatus {
  engineId: string;
  /** Null = never probed. */
  ok: boolean | null;
  isLocal: boolean;
  hasKey: boolean;
  latencyMs?: number;
  error?: string;
  models: AiEngineStatusModel[];
}

export type AiErrorCode =
  | 'unreachable'
  | 'auth'
  | 'modelNotFound'
  | 'contextOverflow'
  | 'rateLimited'
  | 'cloudBlocked'
  | 'consentDenied'
  | 'cancelled'
  | 'unknown';

export const AI_ERROR_CODES: readonly AiErrorCode[] = [
  'unreachable',
  'auth',
  'modelNotFound',
  'contextOverflow',
  'rateLimited',
  'cloudBlocked',
  'consentDenied',
  'cancelled',
  'unknown',
];

/** What `MikeDownAiHost` methods reject with. A plain object, so it crosses postMessage and Tauri events. */
export interface AiError {
  code: AiErrorCode;
  message: string;
}

/**
 * The `ai` group on `MikeDownHost`. Absent turns every AI surface off.
 *
 * Tier 1 (`complete` only): core shows the master switch, feature toggles and
 * the indicator from whatever `served` the host reports. Tier 2 (plus the
 * registry methods): core shows the full AI tab and routes.
 */
export interface MikeDownAiHost {
  // Tier 1: enough for every feature.
  complete(req: AiCompletionRequest, onToken: (delta: string) => void, signal: AbortSignal): Promise<AiCompletionResult>;
  embed?(texts: string[], route?: AiRoute, signal?: AbortSignal): Promise<number[][]>;
  transcribe?(audio: { mime: string; bytes: Uint8Array }, signal?: AbortSignal): Promise<string>;

  // Tier 2: turns on the engine registry UI and core routing.
  listEngines?(): Promise<AiEngineStatus[]>;
  testEngine?(engineId: string): Promise<AiEngineStatus>;
  discoverModels?(engineId: string): Promise<AiEngineStatus>;
  /** Store (or with null, delete) an engine's key. Never part of `saveSettings`. */
  setSecret?(engineId: string, apiKey: string | null): Promise<void>;
  /** Host UI asking to use a cloud engine in this workspace. Absent means the host decides on its own. */
  requestCloudConsent?(engineId: string): Promise<boolean>;
}

// ── Provider adapters (host side) ───────────────────────────────────────────

/** A model as one discovery call reported it, before merging into settings. */
export interface AiDiscoveredModel {
  id: string;
  label?: string;
  /** Endpoint values; anything absent is filled from the id heuristics on merge. */
  capabilities: Partial<AiModelCapabilities>;
  /** `endpoint` when the server described the model, `heuristic` when only its id was listed. */
  source: 'endpoint' | 'heuristic';
  loaded?: boolean;
}

/**
 * Host-side adapter shape. TypeScript in the extension (`src/ai/providers/`),
 * a Rust trait with the same shape on Desktop. Declared here so both hosts
 * share one contract; core never implements it.
 */
export interface ProviderAdapter {
  readonly kind: AiEngineKind;
  /** Discovery plus capability detection. */
  listModels(engine: AiEngineConfig, apiKey: string | null, signal: AbortSignal): Promise<AiDiscoveredModel[]>;
  /** Test connection: reachability, auth, latency. */
  probe(engine: AiEngineConfig, apiKey: string | null, signal: AbortSignal): Promise<{ ok: boolean; latencyMs: number; error?: AiError }>;
  /** Streaming completion against one model. */
  complete(
    engine: AiEngineConfig,
    apiKey: string | null,
    model: AiModelConfig,
    req: AiCompletionRequest,
    onToken: (delta: string) => void,
    signal: AbortSignal,
  ): Promise<AiCompletionResult>;
  embed?(engine: AiEngineConfig, apiKey: string | null, model: AiModelConfig, texts: string[], signal: AbortSignal): Promise<number[][]>;
}
