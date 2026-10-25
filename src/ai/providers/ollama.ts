import {
  buildAuthHeaders,
  engineEndpoints,
  parseOllamaRunning,
  parseOllamaShow,
  parseOllamaTags,
  type AiDiscoveredModel,
  type AiEngineConfig,
  type ProviderAdapter,
} from '@mikedown/core/ai';
import { createChatCompletionsAdapter, listOpenAiModels, type AdapterContext } from './openaiCompatible';
import { mapLimit, requestJson, type AdapterOptions } from './http';

/**
 * Ollama: OpenAI-compatible `/v1` for completions; native endpoints only for
 * metadata. Discovery is `GET /api/tags` for the names, `POST /api/show` per
 * model for capabilities and context length, and `GET /api/ps` (optional)
 * for which models are loaded. Falls back to `/v1/models` when the native
 * API answers with an error.
 */

const SHOW_CONCURRENCY = 4;

async function listOllamaModels(ctx: AdapterContext, engine: AiEngineConfig, apiKey: string | null, signal: AbortSignal): Promise<AiDiscoveredModel[]> {
  const endpoints = engineEndpoints(engine);
  const headers = buildAuthHeaders(engine.kind, apiKey);
  let names: string[];
  try {
    names = parseOllamaTags(await requestJson(ctx.fetch, endpoints.nativeModels!, { headers }, signal, ctx.discoveryTimeoutMs));
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'unreachable' || code === 'cancelled') {throw err;}
    return listOpenAiModels(ctx, engine, apiKey, signal);
  }

  const root = endpoints.nativeModels!.replace(/\/api\/tags$/, '');
  const running = await requestJson(ctx.fetch, `${root}/api/ps`, { headers }, signal, ctx.discoveryTimeoutMs)
    .then(parseOllamaRunning)
    .catch(() => null);

  return mapLimit(names, SHOW_CONCURRENCY, async (name) => {
    let model: AiDiscoveredModel;
    try {
      const body = await requestJson(ctx.fetch, endpoints.nativeShow!, { method: 'POST', headers, body: { model: name } }, signal, ctx.discoveryTimeoutMs);
      model = parseOllamaShow(name, body);
    } catch (err) {
      if ((err as { code?: string }).code === 'cancelled') {throw err;}
      // One model failing to describe itself still lists it, from its name.
      model = { id: name, capabilities: {}, source: 'heuristic' };
    }
    if (running) {model.loaded = running.has(name);}
    return model;
  });
}

export function createOllamaAdapter(opts: AdapterOptions = {}): ProviderAdapter {
  return createChatCompletionsAdapter({ kind: 'ollama', listModels: listOllamaModels }, opts);
}
