import {
  buildAuthHeaders,
  buildCompletionBody,
  buildEmbeddingsBody,
  engineEndpoints,
  engineLocality,
  makeAiError,
  parseEmbeddingsResponse,
  parseOmlxModelStatus,
  parseOpenAiModelList,
  withModelStatus,
  withoutRequestParam,
  type AiCompletionRequest,
  type AiCompletionResult,
  type AiDiscoveredModel,
  type AiEngineConfig,
  type AiEngineKind,
  type AiError,
  type AiModelConfig,
  type ProviderAdapter,
} from '@mikedown/core/ai';
import {
  DEFAULT_DISCOVERY_TIMEOUT_MS,
  DEFAULT_PROBE_TIMEOUT_MS,
  networkError,
  requestJson,
  resolveFetch,
  streamCompletion,
  type AdapterOptions,
  type FetchLike,
  type HttpAiError,
} from './http';

/**
 * Chat Completions adapter: `openai-compatible` (oMLX, vLLM, llama.cpp
 * server, OpenRouter, Groq, Gemini, Mistral, DeepSeek, xAI) and the base the
 * `openai`, `lmstudio` and `ollama` adapters build on. Discovery is
 * `GET {base}/models` with capabilities from the id heuristics.
 */

export interface ChatCompletionsAdapterParts {
  kind: AiEngineKind;
  /** Discovery; defaults to the bare `GET {base}/models` list. */
  listModels?: (ctx: AdapterContext, engine: AiEngineConfig, apiKey: string | null, signal: AbortSignal) => Promise<AiDiscoveredModel[]>;
}

export interface AdapterContext {
  fetch: FetchLike;
  probeTimeoutMs: number;
  discoveryTimeoutMs: number;
}

export function adapterContext(opts: AdapterOptions): AdapterContext {
  return {
    fetch: resolveFetch(opts),
    probeTimeoutMs: opts.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    discoveryTimeoutMs: opts.discoveryTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS,
  };
}

/** `GET {base}/models`, parsed as a bare OpenAI model list. */
export async function listOpenAiModels(ctx: AdapterContext, engine: AiEngineConfig, apiKey: string | null, signal: AbortSignal): Promise<AiDiscoveredModel[]> {
  const url = engineEndpoints(engine).models;
  const body = await requestJson(ctx.fetch, url, { headers: buildAuthHeaders(engine.kind, apiKey) }, signal, ctx.discoveryTimeoutMs);
  return parseOpenAiModelList(body);
}

/**
 * `GET {base}/models`, plus on a local server `GET {base}/models/status`
 * when it answers (oMLX: which models are loaded, and their types). The
 * status is a bonus: any failure there keeps the bare list.
 */
export async function listOpenAiCompatibleModels(ctx: AdapterContext, engine: AiEngineConfig, apiKey: string | null, signal: AbortSignal): Promise<AiDiscoveredModel[]> {
  const listed = await listOpenAiModels(ctx, engine, apiKey, signal);
  if (engineLocality(engine) !== 'local' || listed.length === 0) {return listed;}
  try {
    const url = `${engineEndpoints(engine).models}/status`;
    const body = await requestJson(ctx.fetch, url, { headers: buildAuthHeaders(engine.kind, apiKey) }, signal, ctx.probeTimeoutMs);
    return withModelStatus(listed, parseOmlxModelStatus(body));
  } catch (err) {
    if ((err as { code?: string }).code === 'cancelled') {throw err;}
    return listed;
  }
}

/**
 * Test connection: time one `GET` of the model list. A 404 there means the
 * base URL is wrong (no model list), not a missing model.
 */
export async function probeModelList(
  ctx: AdapterContext,
  engine: AiEngineConfig,
  apiKey: string | null,
  signal: AbortSignal,
  url = engineEndpoints(engine).models,
): Promise<{ ok: boolean; latencyMs: number; error?: AiError }> {
  const started = Date.now();
  try {
    await requestJson(ctx.fetch, url, { headers: buildAuthHeaders(engine.kind, apiKey) }, signal, ctx.probeTimeoutMs);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    let error = networkError(err, url);
    if (error.code === 'modelNotFound') {
      error = makeAiError('unreachable', `${url} was not found (HTTP 404). Check the base URL.`);
    }
    return { ok: false, latencyMs: Date.now() - started, error };
  }
}

/** The result shape every adapter returns. The engine service fills `served.isLocal` from the user's local networks. */
export function completionResult(engine: AiEngineConfig, model: AiModelConfig, out: { text: string; finishReason: AiCompletionResult['finishReason']; usage?: AiCompletionResult['usage'] }): AiCompletionResult {
  const result: AiCompletionResult = {
    text: out.text,
    served: { engineId: engine.id, engineName: engine.name || engine.id, modelId: model.id, isLocal: engineLocality(engine) === 'local' },
    finishReason: out.finishReason,
  };
  if (out.usage) {result.usage = out.usage;}
  return result;
}

/**
 * Completions retry once when the model rejects a parameter (a 400 that
 * names `temperature`, `max_tokens` and the like), without it or with its
 * replacement. The parameter is remembered per engine (and base URL) and model for the
 * session, so the next request leaves it out from the start.
 */
export function createChatCompletionsAdapter(parts: ChatCompletionsAdapterParts, opts: AdapterOptions = {}): ProviderAdapter {
  const ctx = adapterContext(opts);
  const list = parts.listModels ?? listOpenAiModels;
  const rejected = new Map<string, string[]>();
  return {
    kind: parts.kind,
    listModels: (engine, apiKey, signal) => list(ctx, engine, apiKey, signal),
    probe: (engine, apiKey, signal) => probeModelList(ctx, engine, apiKey, signal),
    async complete(engine, apiKey, model, req: AiCompletionRequest, onToken, signal) {
      const key = `${engine.id}\n${engine.baseUrl}\n${model.id}`;
      let body = buildCompletionBody(parts.kind, model, req);
      for (const param of rejected.get(key) ?? []) {body = withoutRequestParam(body, param) ?? body;}
      const send = (b: Record<string, unknown>) =>
        streamCompletion(ctx.fetch, parts.kind, engineEndpoints(engine).completions, buildAuthHeaders(parts.kind, apiKey), b, onToken, signal);
      let out;
      try {
        out = await send(body);
      } catch (err) {
        const param = (err as HttpAiError).unsupportedParam;
        const retry = param ? withoutRequestParam(body, param) : null;
        if (!param || !retry) {throw err;}
        rejected.set(key, [...(rejected.get(key) ?? []), param]);
        out = await send(retry);
      }
      return completionResult(engine, model, out);
    },
    async embed(engine, apiKey, model, texts, signal) {
      const url = engineEndpoints(engine).embeddings;
      const body = buildEmbeddingsBody(parts.kind, model, texts);
      if (!url || !body) {throw makeAiError('unknown', `${engine.name} has no embeddings endpoint.`);}
      const json = await requestJson(ctx.fetch, url, { method: 'POST', headers: buildAuthHeaders(parts.kind, apiKey), body }, signal, 0);
      return parseEmbeddingsResponse(json);
    },
  };
}

export function createOpenAiCompatibleAdapter(opts: AdapterOptions = {}): ProviderAdapter {
  return createChatCompletionsAdapter({ kind: 'openai-compatible', listModels: listOpenAiCompatibleModels }, opts);
}
