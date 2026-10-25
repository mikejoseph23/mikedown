/**
 * Request building per engine kind: endpoint URLs, auth headers and the
 * completion and embedding bodies. Pure, so the VS Code adapters and the Rust
 * port produce identical requests (checked against the same fixtures).
 *
 * Bodies:
 * - Chat Completions kinds: `{ model, messages, stream, max_tokens,
 *   temperature, response_format }`; `openai` uses `max_completion_tokens`
 *   and asks for usage in the stream.
 * - `anthropic`: Messages API, system prompts lifted into `system`,
 *   `max_tokens` always set (required). No sampling parameters: API version
 *   2026-10-21 rejects `temperature`.
 *
 * `model.requestOverrides` merge last, deeply (objects merge, everything else
 * replaces), so they win (OPEN-6).
 */

import type { AiCompletionRequest, AiEngineConfig, AiEngineKind, AiMessage, AiMessagePart, AiModelConfig } from './types';

/** `anthropic-version` sent by the Anthropic adapter. */
export const ANTHROPIC_API_VERSION = '2026-10-21';

/** `max_tokens` for Anthropic when the request sets none (the API requires it). */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096;

/** Appended to the system prompt for `format: 'json'` on kinds with no schema-free JSON mode. */
export const JSON_ONLY_INSTRUCTION = 'Respond with a single valid JSON value and nothing else.';

type Json = Record<string, unknown>;

// ── Endpoints ───────────────────────────────────────────────────────────────

export interface AiEngineEndpoints {
  /** Streaming completion. */
  completions: string;
  /** Model list used for Test connection and bare discovery. */
  models: string;
  /** Embeddings, absent for kinds without them. */
  embeddings?: string;
  /** Native discovery endpoint (LM Studio `/api/v0/models`, Ollama `/api/tags`). */
  nativeModels?: string;
  /** Ollama `POST /api/show` (body `{ model }`). */
  nativeShow?: string;
}

function trimSlash(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * URLs for an engine. OpenAI-style base URLs include `/v1`
 * (`http://127.0.0.1:8000/v1`); for LM Studio and Ollama a base without it
 * gets `/v1` added for completions, and their native endpoints hang off the
 * root. Anthropic's base is the host (`https://api.anthropic.com`), with or
 * without `/v1`.
 */
export function engineEndpoints(engine: Pick<AiEngineConfig, 'kind' | 'baseUrl'>): AiEngineEndpoints {
  const base = trimSlash(engine.baseUrl);
  const root = base.replace(/\/v1$/, '');
  const v1 = `${root}/v1`;
  switch (engine.kind) {
    case 'anthropic':
      return { completions: `${v1}/messages`, models: `${v1}/models` };
    case 'lmstudio':
      return { completions: `${v1}/chat/completions`, models: `${v1}/models`, embeddings: `${v1}/embeddings`, nativeModels: `${root}/api/v0/models` };
    case 'ollama':
      return {
        completions: `${v1}/chat/completions`,
        models: `${v1}/models`,
        embeddings: `${v1}/embeddings`,
        nativeModels: `${root}/api/tags`,
        nativeShow: `${root}/api/show`,
      };
    default:
      return { completions: `${base}/chat/completions`, models: `${base}/models`, embeddings: `${base}/embeddings` };
  }
}

/** Headers for every request to the engine (JSON content type included). */
export function buildAuthHeaders(kind: AiEngineKind, apiKey: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (kind === 'anthropic') {
    headers['anthropic-version'] = ANTHROPIC_API_VERSION;
    if (apiKey) {headers['x-api-key'] = apiKey;}
  } else if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

// ── Bodies ──────────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep merge: nested plain objects merge, anything else in `overrides` replaces. Inputs are not mutated. */
export function mergeRequestOverrides(body: Json, overrides: Json | undefined): Json {
  if (!overrides) {return body;}
  const out: Json = { ...body };
  for (const [key, value] of Object.entries(overrides)) {
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? mergeRequestOverrides(current, value) : value;
  }
  return out;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 with padding, no line breaks. No `Buffer` or `btoa`, so it runs in every host. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += BASE64_ALPHABET[(n >> 18) & 63] + BASE64_ALPHABET[(n >> 12) & 63] + BASE64_ALPHABET[(n >> 6) & 63] + BASE64_ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += `${BASE64_ALPHABET[(n >> 18) & 63]}${BASE64_ALPHABET[(n >> 12) & 63]}==`;
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += `${BASE64_ALPHABET[(n >> 18) & 63]}${BASE64_ALPHABET[(n >> 12) & 63]}${BASE64_ALPHABET[(n >> 6) & 63]}=`;
  }
  return out;
}

/** Inverse of `bytesToBase64`; ignores whitespace and accepts URL-safe characters. */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[\s=]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (const ch of clean) {
    const idx = BASE64_ALPHABET.indexOf(ch);
    if (idx === -1) {continue;}
    value = (value << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 0xff;
    }
  }
  return out.slice(0, o);
}

function textOf(content: AiMessage['content']): string {
  if (typeof content === 'string') {return content;}
  return content
    .filter((p): p is Extract<AiMessagePart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n\n');
}

function openAiContent(content: AiMessage['content']): string | Json[] {
  if (typeof content === 'string') {return content;}
  return content.map((part): Json =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : { type: 'image_url', image_url: { url: `data:${part.mime};base64,${bytesToBase64(part.bytes)}` } },
  );
}

function anthropicContent(content: AiMessage['content']): string | Json[] {
  if (typeof content === 'string') {return content;}
  return content.map((part): Json =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : { type: 'image', source: { type: 'base64', media_type: part.mime, data: bytesToBase64(part.bytes) } },
  );
}

export interface BuildCompletionOptions {
  /** Default true. */
  stream?: boolean;
}

/** The JSON body for one completion against `model` on an engine of `kind`. */
export function buildCompletionBody(kind: AiEngineKind, model: Pick<AiModelConfig, 'id' | 'requestOverrides'>, req: AiCompletionRequest, opts: BuildCompletionOptions = {}): Json {
  const stream = opts.stream ?? true;
  const body = kind === 'anthropic' ? anthropicBody(model.id, req, stream) : chatCompletionsBody(kind, model.id, req, stream);
  return mergeRequestOverrides(body, model.requestOverrides);
}

function chatCompletionsBody(kind: AiEngineKind, modelId: string, req: AiCompletionRequest, stream: boolean): Json {
  const body: Json = {
    model: modelId,
    messages: req.messages.map((m) => ({ role: m.role, content: openAiContent(m.content) })),
    stream,
  };
  if (req.maxTokens !== undefined) {body[kind === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = req.maxTokens;}
  if (req.temperature !== undefined) {body.temperature = req.temperature;}
  if (req.format === 'json') {
    // LM Studio accepts only `json_schema`; a permissive object schema is the schema-free equivalent.
    body.response_format =
      kind === 'lmstudio'
        ? { type: 'json_schema', json_schema: { name: 'response', schema: { type: 'object' } } }
        : { type: 'json_object' };
  }
  if (kind === 'openai' && stream) {body.stream_options = { include_usage: true };}
  return body;
}

function anthropicBody(modelId: string, req: AiCompletionRequest, stream: boolean): Json {
  const system = req.messages.filter((m) => m.role === 'system').map((m) => textOf(m.content));
  if (req.format === 'json') {system.push(JSON_ONLY_INSTRUCTION);}
  const body: Json = {
    model: modelId,
    max_tokens: req.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
    messages: req.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: anthropicContent(m.content) })),
    stream,
  };
  if (system.length > 0) {body.system = system.join('\n\n');}
  return body;
}

/** Embeddings body (`POST .../embeddings`), or null for kinds without an embeddings endpoint. */
export function buildEmbeddingsBody(kind: AiEngineKind, model: Pick<AiModelConfig, 'id' | 'requestOverrides'>, texts: string[]): Json | null {
  if (kind === 'anthropic') {return null;}
  return mergeRequestOverrides({ model: model.id, input: texts }, model.requestOverrides);
}

/** Vectors from an OpenAI-style embeddings response, in input order. */
export function parseEmbeddingsResponse(body: unknown): number[][] {
  if (!isPlainObject(body) || !Array.isArray(body.data)) {return [];}
  return (body.data as unknown[])
    .filter(isPlainObject)
    .map((d, i) => ({ index: typeof d.index === 'number' ? d.index : i, embedding: d.embedding }))
    .sort((a, b) => a.index - b.index)
    .map((d) => (Array.isArray(d.embedding) ? d.embedding.filter((x): x is number => typeof x === 'number') : []));
}
