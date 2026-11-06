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
 * Gemini, Mistral, DeepSeek, xAI). `vscode-lm` is a model VS Code itself
 * offers (GitHub Copilot, through `vscode.lm`): no address, no key, VS Code
 * host only (see `AI_HOST_ENGINE_KINDS`). A settings file written by a newer
 * version may carry a kind this one does not know; such engines are kept on
 * save but never routed (see `isKnownEngineKind`).
 */
export type AiEngineKind = 'openai-compatible' | 'lmstudio' | 'ollama' | 'anthropic' | 'openai' | 'vscode-lm';

export const AI_ENGINE_KINDS: readonly AiEngineKind[] = ['openai-compatible', 'lmstudio', 'ollama', 'anthropic', 'openai', 'vscode-lm'];

/**
 * Kinds only one host can run (no base URL, no key: the host's own model
 * API). A host runs one only when it reports a status for the engine
 * (`listEngines`); elsewhere such an engine is kept and never routed, the
 * same as an unknown kind. The kind picker offers them only to an engine
 * that already has one.
 */
export const AI_HOST_ENGINE_KINDS: readonly AiEngineKind[] = ['vscode-lm'];

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

export interface AiApiKeyFile {
  path: string;
  jsonPath: string;
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
  /**
   * A JSON file in the user's home folder the host reads when no key is stored and
   * `apiKeyEnv` is unset. `path` may start with `~/`; `jsonPath` is a dotted path to
   * a string value (`auth.api_key`). The key itself is never in settings.
   */
  apiKeyFile?: AiApiKeyFile;
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
  /** `ghostText` only (see `AiGhostTextOptions`; read through `ghostTextOptions`). */
  delayMs?: number;
  maxTokens?: number;
  trigger?: AiGhostTrigger;
  localOnly?: boolean;
}

/** When Inline suggestions fire: after an idle pause, or only from the shortcut / menu. */
export type AiGhostTrigger = 'auto' | 'manual';

/** The `features.ghostText` knobs with defaults applied and ranges clamped (`ghostTextOptions`). */
export interface AiGhostTextOptions {
  /** Idle time after a keystroke before a request fires, in ms. Default 400. */
  delayMs: number;
  /** Output budget in tokens. Default 48. */
  maxTokens: number;
  /** Default `auto`. */
  trigger: AiGhostTrigger;
  /** Reject cloud engines for this feature. Default true. */
  localOnly: boolean;
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
  /** The AI button on the toolbar (hosts with AI support only). Default true. */
  showToolbarButton: boolean;
  /** Record what each AI request sent and received, in memory, and show it in the Activity panel. Default false. */
  activityPanel: boolean;
  /**
   * Documentation bases (`mikedown.ai.docBases`). User-level only: a host
   * reads this key from its user settings and never from a workspace, so a
   * repository cannot add or redirect a base. `parseAiSettings` drops invalid
   * entries with a reason (see `parseDocBases`).
   */
  docBases: AiDocBase[];
  /** Advanced options for chatting with the bases (`mikedown.ai.docs`), user-level only like `docBases`. */
  docs: AiDocsOptions;
}

// ── Documentation bases ─────────────────────────────────────────────────────

/**
 * One documentation base: user-level folders of markdown the chat can
 * navigate and answer from. Roots are absolute, normalized folder paths.
 */
export interface AiDocBase {
  /** Stable, generated once, never shown. The wire and the consent dialog name a base by id; the host maps it to a name from its own settings. */
  id: string;
  name: string;
  /** Absolute normalized folders (`validateDocRoot`). At least one. */
  roots: string[];
  /** Per-base override for the home document's file name, relative to each root (`HOME.md`). Absent: `INDEX.md`, `README.md`, then a map. */
  homeFile?: string;
  /** May pages from this base be sent to a cloud engine. Default false. */
  allowCloud: boolean;
  /** A disabled base is never indexed for or sent with a request. Default true. */
  enabled: boolean;
}

export type AiDocsNavigateBy = 'section' | 'page';

export const AI_DOCS_NAVIGATE_BY: readonly AiDocsNavigateBy[] = ['section', 'page'];

/** The advanced options (`ai.docs`), without the bases. */
export interface AiDocsOptions {
  /** Navigation calls before the answer. Clamped to `AI_DOCS_MAX_HOPS_MIN`..`AI_DOCS_MAX_HOPS_MAX`. Default 3. */
  maxHops: number;
  /** Percent of the route's context the answer's sections may take. Clamped to `AI_DOCS_SOURCE_SHARE_MIN`..`AI_DOCS_SOURCE_SHARE_MAX`. Default 60. */
  sourceShare: number;
  /** Whether the model asks for `page#heading` sections or whole pages. Default `section`. */
  navigateBy: AiDocsNavigateBy;
}

/** The options the loop runs with: `ai.docs` plus the bases (`resolveDocsSettings`). */
export interface AiDocsSettings extends AiDocsOptions {
  bases: AiDocBase[];
}

export const AI_DOCS_MAX_HOPS_MIN = 1;
export const AI_DOCS_MAX_HOPS_MAX = 5;
/**
 * The most requests one "Allow once" can admit in a chat turn: a navigation
 * call and its one repair per hop, then the answer. Hosts stop honouring a grant
 * past this, so a webview that never ends its turn cannot keep sending on it.
 * `TURN_GRANT_MAX_USES` in Desktop's `commands/ai.rs` is the same number.
 */
export const AI_TURN_GRANT_MAX_USES = AI_DOCS_MAX_HOPS_MAX * 2 + 1;
export const AI_DOCS_MAX_HOPS_DEFAULT = 3;
export const AI_DOCS_SOURCE_SHARE_MIN = 30;
export const AI_DOCS_SOURCE_SHARE_MAX = 80;
export const AI_DOCS_SOURCE_SHARE_DEFAULT = 60;
export const AI_DOCS_NAVIGATE_BY_DEFAULT: AiDocsNavigateBy = 'section';

// ── Documentation bases: what a host reports ────────────────────────────────

/** Where a root's home document came from (decision 3). `map` means none was found and core builds an in-memory map. */
export type AiDocHomeKind = 'override' | 'index' | 'readme' | 'map';

/** One root of a base, as the host last saw it. */
export interface AiDocRootStatus {
  /** The root as configured (absolute). */
  root: string;
  /** The label ids use for this root (the same rule on both hosts; `docs/index.ts`). */
  label: string;
  /** The folder exists and is readable. False: "Root not found"; the root is skipped for requests, never deleted. */
  found: boolean;
  /** Which home precedence step won; `map` is the "No home document" state. Absent when the root is not found. */
  home?: AiDocHomeKind;
  /** The home document's path relative to the root, when `home` is not `map`. */
  homePath?: string;
  /** Markdown files indexed under this root. */
  fileCount: number;
  /** Files over the byte cap, skipped. */
  oversizeSkipped: number;
  /** The file cap was reached; later files were not indexed. */
  capReached: boolean;
  /** Files that are not UTF-8 text (a UTF-16 or UTF-32 byte order mark, or NUL bytes), skipped. */
  notTextSkipped?: number;
  /** The folder cap was reached; later folders were not read. */
  dirCapReached?: boolean;
  /** The build's time budget ran out; the index covers what was read before that. */
  timedOut?: boolean;
}

/**
 * A base plus its health, as `listBases` reports it. Computed when the
 * manager page opens and on Refresh. "Active" means enabled with at least one
 * root found; only active bases are indexed for or sent to a request.
 */
export interface AiDocBaseStatus {
  base: AiDocBase;
  /** Enabled and at least one root found. */
  active: boolean;
  roots: AiDocRootStatus[];
  /** Sum over roots. */
  fileCount: number;
  oversizeSkipped: number;
  /** Roots not found on disk. */
  rootsMissing: number;
  /** Any root hit the file cap. */
  capReached: boolean;
  /** Files skipped because they are not UTF-8 text, over every root. */
  notTextSkipped?: number;
  /** Any root hit the folder cap. */
  dirCapReached?: boolean;
  /** The build's time budget ran out; the index and the counts cover what was read before that. */
  timedOut?: boolean;
  /** Relative links that leave every root or point at no page. Absent when the host did not compute it. */
  brokenLinks?: number;
}

/** A heading in the index (a section starts at each). Bodies are never in the index. */
export interface AiDocsHeading {
  /** The section id: `<page id>#<slug>`. */
  id: string;
  /** 1 to 6. */
  level: number;
  text: string;
  slug: string;
}

/** A link as written in a page. Core resolves it (`docs/links.ts`); the host only extracts. */
export interface AiDocsLink {
  /** The target as written: a relative path with an optional `#fragment`, or a wikilink name. */
  target: string;
  /** The link text. */
  text: string;
  kind: 'markdown' | 'wikilink';
}

/** One markdown page of a base, without its body. */
export interface AiDocsPage {
  /** `<root label>/<rel path>`, with `/` separators (`docs/index.ts`). The only thing the model names. */
  id: string;
  /** The root's label (the first segment of `id`). */
  root: string;
  /** Path relative to the root, with `/` separators. */
  relPath: string;
  /** Frontmatter title, else the first heading, else the file name. */
  title: string;
  headings: AiDocsHeading[];
  links: AiDocsLink[];
  /** Size of the file in characters (not bytes), for the budget. */
  chars: number;
}

/** The home document chosen for a root. */
export interface AiDocsHome {
  /** The root's label. */
  root: string;
  kind: AiDocHomeKind;
  /** The home page's id; null for `map`. */
  pageId: string | null;
}

/** A base's index: pages with headings and links, no bodies. Built lazily on the host, in memory. */
export interface AiDocsIndex {
  baseId: string;
  /** Roots that were found, in configured order. */
  roots: Array<{ label: string }>;
  pages: AiDocsPage[];
  homes: AiDocsHome[];
  /** The file cap cut the walk short. */
  truncated: boolean;
  oversizeSkipped: number;
  /** Unix milliseconds the index was built. */
  builtAt: number;
}

/** A section (or whole page) as `readSections` returns it: the only call that carries a body. */
export interface AiDocsSection {
  /** The id that was asked for: `<page id>#<slug>` or a page id. */
  id: string;
  pageId: string;
  /** The page's title. */
  title: string;
  /** Path relative to the root, for the chip and the relative link. */
  relPath: string;
  /** The section's heading text; absent for a whole page. */
  heading?: string;
  /** The markdown, capped at the section byte cap by the host. */
  text: string;
  /** The host cut `text` at the cap. */
  truncated: boolean;
}

/** A keyword match: ids and labels only, no text. The loop reads the bodies through `readSections`. */
export interface AiDocsSectionRef {
  /** `<page id>#<slug>`, or a page id for text before the first heading. */
  id: string;
  pageId: string;
  title: string;
  relPath: string;
  heading?: string;
  /** Higher is a better match; the order is `docs/keyword.ts`'s. */
  score: number;
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
  /**
   * Per-request body fields (the popover's thinking dial). The host merges
   * them over the model's configured `requestOverrides`, deeply, so the
   * request wins. Tier-1 hosts may ignore them.
   */
  requestOverrides?: Record<string, unknown>;
  /** Set on every request of a chat turn (`AiRoutePin`); absent on every other request. */
  turn?: AiCompletionTurn;
}

/**
 * What a request of a chat turn says about that turn. A host uses it to find
 * the "Allow once" it holds for the turn, and to word a dialog it has to raise
 * in the middle of one (`sends`, and `baseIds`, which it maps to names from its
 * own settings). It is a claim, not consent: a host admits the request only
 * against a grant it made itself when the user answered, for this panel or
 * window, this turn, this engine and this set of bases.
 */
export interface AiCompletionTurn {
  id: string;
  sends?: AiSendsScope;
  baseIds?: string[];
  /** The engine's locality when the turn was routed. A host fails the request if it no longer holds. */
  isLocal?: boolean;
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

/**
 * How long a completion took, measured by the host from sending the request.
 * Optional on the wire: an older host sends none.
 */
export interface AiTiming {
  /** To the end of the answer. */
  totalMs: number;
  /** To the first output, answer or reasoning. Absent when the server did not stream. */
  firstTokenMs?: number;
  /** Characters of output (answer plus reasoning), to estimate tokens when the engine reports no usage. */
  outputChars?: number;
}

export interface AiCompletionResult {
  text: string;
  served: AiServedBy;
  usage?: AiUsage;
  finishReason?: AiFinishReason;
  timing?: AiTiming;
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
  /** What the server says the model takes, in bytes (oMLX, LM Studio, Ollama report it). */
  sizeBytes?: number;
  /** The server says it is a mixture of experts (LM Studio `arch`, oMLX `config_model_type`). */
  moe?: boolean;
}

/** Where a host found an engine's key: its secret store, a variable, or a key file. */
export type AiKeySource = 'stored' | 'env' | 'file';

export interface AiEngineStatus {
  engineId: string;
  /** Null = never probed. */
  ok: boolean | null;
  isLocal: boolean;
  hasKey: boolean;
  /**
   * Where the key came from, when `hasKey` and the host knows: its secret store,
   * the engine's `apiKeyEnv` variable, or its `apiKeyFile`. Absent for no key or
   * a host that does not say (the engine form then guesses from the engine's
   * settings).
   */
  keySource?: AiKeySource;
  latencyMs?: number;
  error?: string;
  models: AiEngineStatusModel[];
}

/**
 * One local model server as `detectLocalServers` found it: whether its preset's
 * address answered, and how many models it listed when it did.
 */
export interface AiLocalServerProbe {
  presetId: string;
  baseUrl: string;
  ok: boolean;
  /** Models the server listed (embedding models left out where the server says which they are). */
  models?: number;
  latencyMs?: number;
}

/**
 * A model API built into the host (VS Code's `vscode.lm`, which GitHub
 * Copilot serves), as `detectHostEngines` found it. Nothing is saved.
 */
export interface AiHostEngineProbe {
  /** The preset to add it from (`vscodelm`). */
  presetId: string;
  kind: AiEngineKind;
  /** At least one chat model is available right now. */
  ok: boolean;
  /** Chat models available. */
  models: number;
  /** Why none is available, when the host knows (no Copilot extension, signed out). */
  error?: string;
}

/**
 * What a host can tell about this machine, for the setup wizard's "can it
 * run models locally" hint (`recommendSetupPath`, `modelSizeHint`). A rough
 * call, not a benchmark: VS Code reads no GPU at all.
 */
export interface AiHardwareInfo {
  /** Node's `process.arch` names: `arm64`, `x64`. */
  arch: string;
  /** Node's `process.platform` names: `darwin`, `win32`, `linux`. */
  platform: string;
  totalMemoryBytes: number;
  /** macOS on arm64: the GPU shares `totalMemoryBytes` (unified memory). */
  appleSilicon: boolean;
  /** CPU brand string, when the host read one ("Apple M2 Max"). */
  cpu?: string;
  /** A discrete GPU, when the host could read one (Desktop: NVIDIA through `nvidia-smi`; Apple Silicon reports `apple`). */
  gpu?: { vendor: 'nvidia' | 'amd' | 'apple' | 'other'; vramBytes?: number; name?: string };
}

export type AiErrorCode =
  | 'unreachable'
  | 'auth'
  | 'modelNotFound'
  | 'modelLoadFailed'
  | 'contextOverflow'
  | 'rateLimited'
  | 'cloudBlocked'
  | 'consentDenied'
  | 'cancelled'
  | 'badOutput'
  | 'unknown';

export const AI_ERROR_CODES: readonly AiErrorCode[] = [
  'unreachable',
  'auth',
  'modelNotFound',
  'modelLoadFailed',
  'contextOverflow',
  'rateLimited',
  'cloudBlocked',
  'consentDenied',
  'cancelled',
  'badOutput',
  'unknown',
];

/** What `MikeDownAiHost` methods reject with. A plain object, so it crosses postMessage and Tauri events. */
export interface AiError {
  code: AiErrorCode;
  message: string;
  /** The engine the failed request went to (or the router turned down), when known. */
  engineId?: string;
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
  /**
   * Look for model servers on this machine at the local presets' default
   * addresses (`localDetectCandidates()`), one GET each, capped at
   * `AI_LOCAL_DETECT_TIMEOUT_MS`. Only on request (the first-run panel, the
   * quick-start cards), never in the background. The host looks each preset
   * up by id itself and sends a key (oMLX's key file) only to the preset's
   * own address. One result per candidate, in order. Nothing is saved.
   */
  detectLocalServers?(candidates: { presetId: string; baseUrl: string }[], signal: AbortSignal): Promise<AiLocalServerProbe[]>;
  /**
   * Model APIs built into the host that need no address or key (VS Code:
   * `vscode.lm`, GitHub Copilot's models), one result per `AI_HOST_ENGINE_KINDS`
   * kind the host runs. Lists models only; sends no text. Absent: the host
   * has none, and the `host` preset family stays hidden.
   */
  detectHostEngines?(): Promise<AiHostEngineProbe[]>;
  /**
   * This machine's memory, CPU and (where the host can read it) GPU, for the
   * setup wizard's local hint. Static, so hosts may answer from a cache; null
   * when the host cannot tell.
   */
  hardwareInfo?(): Promise<AiHardwareInfo | null>;
  testEngine?(engineId: string): Promise<AiEngineStatus>;
  discoverModels?(engineId: string): Promise<AiEngineStatus>;
  /** Store (or with null, delete) an engine's key. Never part of `saveSettings`. */
  setSecret?(engineId: string, apiKey: string | null): Promise<void>;
  /**
   * False when the host process may not see variables set in a shell profile
   * (MikeDown Desktop opened from the Dock or Start menu), so `apiKeyEnv` is
   * unreliable there and the engine form points at the key file or a pasted
   * key instead. Absent: the host reads them (VS Code resolves the shell
   * environment) or does not say.
   */
  readonly shellEnv?: boolean;
  /**
   * Host UI asking to use a cloud engine in this workspace. Absent means the
   * host decides on its own. `about` names the request that asked, so the
   * dialog can say what is sent (`aiConsentText`).
   */
  requestCloudConsent?(engineId: string, about?: AiConsentAbout): Promise<AiConsentReply>;
  /**
   * `requestCloudConsent` for a chat turn, where `'once'` means the whole turn:
   * the host holds the grant and admits the turn's requests (`req.turn`) on it.
   * Absent: core asks `requestCloudConsent`.
   */
  requestTurnConsent?(engineId: string, about: AiTurnConsentAbout): Promise<AiConsentReply>;
  /**
   * The chat turn `turnId` is over (answered, refused, failed or cancelled):
   * forget any "Allow once" held for it. Fire and forget. A host that holds no
   * grant per turn can leave it out.
   */
  endTurn?(turnId: string): void;
  /**
   * The cloud consents for this workspace or folder, for the Cloud consents
   * list on the AI tab: the stored answers, plus this session's "Don't
   * allow" (`deny`), so it can be forgotten without a restart. "Allow once"
   * leaves nothing to list.
   */
  listConsents?(): Promise<AiConsentRecord[]>;
  /** Forget the answer for an engine (stored or this session's), so the next request asks again. */
  forgetConsent?(engineId: string): Promise<void>;
}

/**
 * What `requestCloudConsent` resolves to: `true` allowed for the workspace
 * (remembered), `'once'` allowed for this request only (the next one asks
 * again), or for the whole turn from `requestTurnConsent`, `false` declined for this request (a host may also stop asking for
 * the session; it then answers `false` without a dialog), `'never'` a stored
 * refusal from an older version (the host answers it without asking). A host
 * that only knows allow and decline keeps returning booleans.
 */
export type AiConsentReply = boolean | 'once' | 'never';

/** One stored cloud consent answer (`MikeDownAiHost.listConsents`). */
export interface AiConsentRecord {
  engineId: string;
  /** `allow` and `never` (older versions) are stored; `deny` is this session's "Don't allow". */
  answer: 'allow' | 'never' | 'deny';
  /** Unix milliseconds. */
  at: number;
  /** What the answer covers: VS Code's workspace, Desktop's folder. */
  scope: 'workspace' | 'folder';
}

/**
 * What a request sends to the engine, for the privacy copy (`whatIsSent`):
 * the selection with its neighbouring paragraphs, the whole document, the
 * document with its frontmatter and the workspace's tag names, pages from
 * the documentation bases the user turned on, or the text around the cursor
 * on every pause (Inline suggestions).
 */
export type AiSendsScope = 'selection' | 'document' | 'documentAndTags' | 'docsBase' | 'cursor';

/**
 * The request behind a consent prompt. `sends` overrides the feature's own
 * scope (whole-document Translate; the docs chat sends `docsBase`).
 */
export interface AiConsentAbout {
  feature?: string;
  sends?: AiSendsScope;
  /**
   * The documentation bases the request would send pages from, by id. The
   * host maps ids to names from its own user-level settings and drops unknown
   * ids, so a name from the webview never reaches its modal.
   */
  baseIds?: string[];
}

/** A consent prompt from a chat turn (`AiCompletionTurn.id`): an "Allow once" holds for that turn and no other. */
export interface AiTurnConsentAbout extends AiConsentAbout {
  turnId: string;
}

// ── Docs host group ─────────────────────────────────────────────────────────

/**
 * The `docs` group on `MikeDownHost`: documentation bases, read through the
 * host. Absent (npm consumers): the chat's scope picker shows "This document"
 * only. Defined next to `MikeDownAiHost` so hosts reach it through
 * `@mikedown/core/ai`; `host.ts` re-exports it.
 *
 * Containment is the host's job and is code, not prompt (S1, S2, S3, S9):
 *
 * - Every method takes a base id and resolves the roots from the host's own
 *   user-level configuration. A root that configuration does not list is
 *   refused, so a webview message can never name a folder. A disabled base is
 *   refused.
 * - `readSections` looks ids up in the host's own index and refuses anything
 *   else. No path is ever built from an id's text.
 * - Reads canonicalize the root and the file, refuse anything outside the
 *   root (whole path components), non-markdown, symlinks, non-regular files
 *   and oversize files.
 * - The model names ids from core's index and nothing else.
 */
export interface MikeDownDocsHost {
  /**
   * Every configured base with its health (disabled ones included). The bases
   * themselves (`enabled`, `allowCloud`, names) are read afresh on every call.
   * A plain call is cheap and must not walk a base that already has a usable
   * index: the chat loop calls it once per turn. `refresh: true` forces a walk
   * and fills the health (file counts, broken links); the manager page passes
   * it when its section opens and on Refresh.
   */
  listBases(opts?: { refresh?: boolean }): Promise<AiDocBaseStatus[]>;
  /** The base's index (pages, headings, links, homes; no bodies), built lazily and kept in memory. Rejects for an unknown, disabled or inactive base. */
  index(baseId: string): Promise<AiDocsIndex>;
  /**
   * Bodies for section ids (`<page id>#<slug>`) or page ids, each capped at
   * the section byte cap. Ids the host's index does not know are left out of
   * the result (never an error, never a path); a read that fails a
   * containment check is left out too. Order follows `ids`.
   */
  readSections(baseId: string, ids: string[]): Promise<AiDocsSection[]>;
  /** Case-folded scan over the base's files, headings weighted, best first, at most 20 (`docs/keyword.ts`). Ids and labels only. */
  keywordSearch(baseId: string, query: string): Promise<AiDocsSectionRef[]>;
  /** Tell core when the base's files change (a watcher per root only). Returns the function that stops watching. */
  watch?(baseId: string, onChange: () => void): () => void;
  /**
   * Save the user's bases. The host re-validates with `parseAiSettings` and
   * writes the user-level setting only, never a workspace one. Rejects when
   * nothing valid is left to write over something valid.
   */
  saveBases(bases: AiDocBase[]): Promise<void>;
  /** VS Code: offer the open workspace folders (a picker when there are several) and resolve one's absolute path; null when cancelled or none is open. */
  addWorkspaceFolder?(): Promise<string | null>;
  /** Desktop: the native folder picker; resolves the chosen absolute path, null when cancelled. */
  pickFolder?(): Promise<string | null>;
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
  /** Bytes the model takes, as the server reports it (oMLX `estimated_size`, LM Studio `size_bytes`, Ollama `size`). */
  sizeBytes?: number;
  /** The server says it is a mixture of experts: an architecture name with `moe` in it (LM Studio `arch`, oMLX `config_model_type`). */
  moe?: boolean;
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
