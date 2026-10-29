/**
 * Pure parsers for discovery responses, one per endpoint shape. Hosts do the
 * HTTP and hand the parsed JSON here, so the VS Code adapters and the Rust
 * port read the same fixtures (`test/ai-fixtures/discovery/`). Every parser
 * tolerates junk: entries without a string id are skipped, never thrown on.
 */

import { AI_ENGINE_PRESETS, type AiEnginePreset } from './presets';
import type { AiApiKeyFile, AiDiscoveredModel, AiEngineKind, AiModelCapabilities } from './types';

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function dataArray(body: unknown, key = 'data'): Json[] {
  if (!isObject(body) || !Array.isArray(body[key])) {return [];}
  return (body[key] as unknown[]).filter(isObject);
}

function positiveInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined;
}

/** `GET {base}/models` on any OpenAI-compatible server: ids only, capabilities from heuristics. */
export function parseOpenAiModelList(body: unknown): AiDiscoveredModel[] {
  return dataArray(body)
    .filter((m) => typeof m.id === 'string' && m.id)
    .map((m) => ({ id: m.id as string, capabilities: {}, source: 'heuristic' as const }));
}

/**
 * LM Studio `GET /api/v0/models`: `type` (`llm`, `vlm`, `embeddings`),
 * `max_context_length`, `state` (`loaded` / `not-loaded`), and on newer
 * builds `capabilities` (`tool_use`).
 */
export function parseLmStudioModels(body: unknown): AiDiscoveredModel[] {
  const out: AiDiscoveredModel[] = [];
  for (const m of dataArray(body)) {
    if (typeof m.id !== 'string' || !m.id) {continue;}
    const caps: Partial<AiModelCapabilities> = {};
    if (m.type === 'embeddings') {
      Object.assign(caps, { chat: false, stream: false, vision: false, tools: false, json: false, embed: true });
    } else if (m.type === 'vlm') {
      Object.assign(caps, { chat: true, vision: true, embed: false });
    } else if (m.type === 'llm') {
      Object.assign(caps, { chat: true, vision: false, embed: false });
    }
    if (Array.isArray(m.capabilities) && m.capabilities.includes('tool_use')) {caps.tools = true;}
    const ctx = positiveInt(m.max_context_length) ?? positiveInt(m.loaded_context_length);
    if (ctx) {caps.contextTokens = ctx;}
    const model: AiDiscoveredModel = { id: m.id, capabilities: caps, source: 'endpoint' };
    if (typeof m.state === 'string') {model.loaded = m.state === 'loaded';}
    out.push(model);
  }
  return out;
}

/**
 * oMLX `GET {base}/models/status` (beside its OpenAI `/models`): per model
 * `loaded` and `model_type` (`llm`, `vlm`, `embedding`, or a non-text type
 * such as `audio_stt` or `markitdown`, which can neither chat nor embed),
 * `model_context_length` and `estimated_size` (bytes).
 */
export function parseOmlxModelStatus(body: unknown): AiDiscoveredModel[] {
  const out: AiDiscoveredModel[] = [];
  for (const m of dataArray(body, 'models')) {
    if (typeof m.id !== 'string' || !m.id) {continue;}
    const caps: Partial<AiModelCapabilities> = {};
    if (m.model_type === 'llm') {
      Object.assign(caps, { chat: true, vision: false, embed: false });
    } else if (m.model_type === 'vlm') {
      Object.assign(caps, { chat: true, vision: true, embed: false });
    } else if (m.model_type === 'embedding' || m.model_type === 'embeddings') {
      Object.assign(caps, { chat: false, stream: false, vision: false, tools: false, json: false, embed: true });
    } else if (typeof m.model_type === 'string') {
      Object.assign(caps, { chat: false, stream: false, vision: false, tools: false, json: false, embed: false });
    }
    const ctx = positiveInt(m.model_context_length);
    if (ctx) {caps.contextTokens = ctx;}
    const model: AiDiscoveredModel = { id: m.id, capabilities: caps, source: Object.keys(caps).length > 0 ? 'endpoint' : 'heuristic' };
    if (typeof m.loaded === 'boolean') {model.loaded = m.loaded;}
    const size = positiveInt(m.estimated_size);
    if (size) {model.sizeBytes = size;}
    out.push(model);
  }
  return out;
}

/**
 * Fold a status listing (`parseOmlxModelStatus`) into the models `/models`
 * listed: the listing decides which models exist, the status adds what it
 * knows about each (capabilities, loaded state).
 */
export function withModelStatus(listed: readonly AiDiscoveredModel[], status: readonly AiDiscoveredModel[]): AiDiscoveredModel[] {
  const byId = new Map(status.map((s) => [s.id, s]));
  return listed.map((m) => {
    const s = byId.get(m.id);
    if (!s) {return m;}
    const next: AiDiscoveredModel = { ...m, capabilities: { ...m.capabilities, ...s.capabilities } };
    if (s.source === 'endpoint') {next.source = 'endpoint';}
    if (s.loaded !== undefined) {next.loaded = s.loaded;}
    if (s.sizeBytes !== undefined) {next.sizeBytes = s.sizeBytes;}
    return next;
  });
}

/**
 * Sizes in bytes by model id from a listing that has them: LM Studio
 * `GET /api/v1/models` (`models[].key`, `size_bytes`; its `/api/v0` has
 * none) and Ollama `GET /api/tags` (`models[].model` or `name`, `size`).
 */
export function parseModelSizes(body: unknown): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of dataArray(body, 'models')) {
    const id = [m.key, m.model, m.name].find((v): v is string => typeof v === 'string' && v.length > 0);
    const size = positiveInt(m.size_bytes) ?? positiveInt(m.size);
    if (id && size) {out.set(id, size);}
  }
  return out;
}

/** `models` with the sizes `parseModelSizes` found added; the rest as they were. */
export function withModelSizes(models: readonly AiDiscoveredModel[], sizes: ReadonlyMap<string, number>): AiDiscoveredModel[] {
  return models.map((m) => {
    const size = sizes.get(m.id);
    return size ? { ...m, sizeBytes: size } : m;
  });
}

/** Ollama `GET /api/tags`: the model names to ask `/api/show` about. */
export function parseOllamaTags(body: unknown): string[] {
  return dataArray(body, 'models')
    .map((m) => (typeof m.model === 'string' && m.model ? m.model : m.name))
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
}

/**
 * Ollama `POST /api/show` for one model: `capabilities` (`completion`,
 * `vision`, `tools`, `embedding`, `insert`) and the context length under
 * `model_info["<arch>.context_length"]`.
 */
export function parseOllamaShow(name: string, body: unknown): AiDiscoveredModel {
  const caps: Partial<AiModelCapabilities> = {};
  if (!isObject(body)) {return { id: name, capabilities: caps, source: 'heuristic' };}
  if (Array.isArray(body.capabilities)) {
    const list = body.capabilities.filter((c): c is string => typeof c === 'string');
    caps.chat = list.includes('completion');
    caps.stream = caps.chat;
    caps.vision = list.includes('vision');
    caps.tools = list.includes('tools');
    caps.embed = list.includes('embedding');
    caps.fim = list.includes('insert');
  }
  if (isObject(body.model_info)) {
    const info = body.model_info;
    const arch = typeof info['general.architecture'] === 'string' ? info['general.architecture'] : null;
    const ctx =
      (arch ? positiveInt(info[`${arch}.context_length`]) : undefined) ??
      positiveInt(Object.entries(info).find(([k]) => k.endsWith('.context_length'))?.[1]);
    if (ctx) {caps.contextTokens = ctx;}
  }
  return { id: name, capabilities: caps, source: Object.keys(caps).length > 0 ? 'endpoint' : 'heuristic' };
}

/** Which Ollama models are loaded right now, from `GET /api/ps` (optional). */
export function parseOllamaRunning(body: unknown): Set<string> {
  return new Set(parseOllamaTags(body));
}

/**
 * Anthropic `GET /v1/models`: `display_name`, `max_input_tokens` (the context
 * window) and the `capabilities` tree (`image_input.supported`,
 * `structured_outputs.supported`). Tools are assumed on.
 */
export function parseAnthropicModels(body: unknown): AiDiscoveredModel[] {
  const out: AiDiscoveredModel[] = [];
  for (const m of dataArray(body)) {
    if (typeof m.id !== 'string' || !m.id) {continue;}
    const caps: Partial<AiModelCapabilities> = { chat: true, stream: true, tools: true, fim: false, embed: false };
    const ctx = positiveInt(m.max_input_tokens);
    if (ctx) {caps.contextTokens = ctx;}
    const tree = isObject(m.capabilities) ? m.capabilities : null;
    const supported = (key: string): boolean | undefined => {
      const node = tree?.[key];
      return isObject(node) && typeof node.supported === 'boolean' ? node.supported : undefined;
    };
    const vision = supported('image_input');
    if (vision !== undefined) {caps.vision = vision;}
    const json = supported('structured_outputs');
    if (json !== undefined) {caps.json = json;}
    const model: AiDiscoveredModel = { id: m.id, capabilities: caps, source: 'endpoint' };
    if (typeof m.display_name === 'string' && m.display_name) {model.label = m.display_name;}
    out.push(model);
  }
  return out;
}

/** Anthropic pages its list; the next `after_id`, or null on the last page. */
export function anthropicNextPage(body: unknown): string | null {
  return isObject(body) && body.has_more === true && typeof body.last_id === 'string' ? body.last_id : null;
}

// ── Local server detection ──────────────────────────────────────────────────

/** The URL detection GETs: `detectPath` under the server root (no `/v1`), else `{baseUrl}/models`. */
export function localDetectUrl(baseUrl: string, detectPath?: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  return detectPath ? `${base.replace(/\/v1$/, '')}${detectPath}` : `${base}/models`;
}

/**
 * How many models a detection answer lists: `data` (OpenAI-style, LM Studio)
 * or `models` (Ollama). LM Studio's embedding models are left out. Undefined
 * for a body of neither shape (the server answered, the count is unknown).
 */
export function countDetectedModels(body: unknown): number | undefined {
  if (!isObject(body)) {return undefined;}
  if (Array.isArray(body.data)) {return dataArray(body).filter((m) => m.type !== 'embeddings').length;}
  if (Array.isArray(body.models)) {return dataArray(body, 'models').length;}
  return undefined;
}

/** What a host needs to probe one detection candidate. */
export interface AiLocalDetectTarget {
  presetId: string;
  baseUrl: string;
  /** The GET. */
  url: string;
  /** For the auth header shape. */
  kind: AiEngineKind;
  /** Where to read a key, only when `baseUrl` is the preset's own address. */
  apiKeyEnv?: string;
  apiKeyFile?: AiApiKeyFile;
}

/**
 * A detection candidate checked against the presets. Null for an unknown or
 * cloud preset, Custom, or an address that is not http(s). A key source
 * (oMLX's key file) comes along only when the address is the preset's own,
 * so a key never goes anywhere the user did not set up.
 */
export function localDetectTarget(
  candidate: { presetId: string; baseUrl: string },
  presets: readonly AiEnginePreset[] = AI_ENGINE_PRESETS,
): AiLocalDetectTarget | null {
  const preset = presets.find((p) => p.id === candidate.presetId);
  if (!preset || preset.family !== 'local' || preset.id === 'custom') {return null;}
  const baseUrl = typeof candidate.baseUrl === 'string' ? candidate.baseUrl.trim() : '';
  if (!/^https?:\/\/[^/]/i.test(baseUrl)) {return null;}
  const target: AiLocalDetectTarget = { presetId: preset.id, baseUrl, url: localDetectUrl(baseUrl, preset.detectPath), kind: preset.kind };
  const own = baseUrl.replace(/\/+$/, '').toLowerCase() === preset.baseUrl.replace(/\/+$/, '').toLowerCase();
  if (own && preset.apiKeyEnv) {target.apiKeyEnv = preset.apiKeyEnv;}
  if (own && preset.apiKeyFile) {target.apiKeyFile = { ...preset.apiKeyFile };}
  return target;
}
