import { buildAuthHeaders, engineEndpoints, parseLmStudioModels, type AiDiscoveredModel, type AiEngineConfig, type ProviderAdapter } from '@mikedown/core/ai';
import { createChatCompletionsAdapter, listOpenAiModels, type AdapterContext } from './openaiCompatible';
import { requestJson, type AdapterOptions } from './http';

/**
 * LM Studio: OpenAI-compatible `/v1` for completions; discovery from the
 * native `GET /api/v0/models` (type llm/vlm/embeddings, context length,
 * loaded state). Falls back to the bare `/v1/models` list when `/api/v0`
 * answers with an error (an older build, or a proxy in front). LM Studio
 * accepts any non-empty key, so none is required.
 */

async function listLmStudioModels(ctx: AdapterContext, engine: AiEngineConfig, apiKey: string | null, signal: AbortSignal): Promise<AiDiscoveredModel[]> {
  const url = engineEndpoints(engine).nativeModels;
  if (url) {
    try {
      const body = await requestJson(ctx.fetch, url, { headers: buildAuthHeaders(engine.kind, apiKey) }, signal, ctx.discoveryTimeoutMs);
      return parseLmStudioModels(body);
    } catch (err) {
      // Server down or request cancelled: the fallback would fail the same way.
      const code = (err as { code?: string }).code;
      if (code === 'unreachable' || code === 'cancelled') {throw err;}
    }
  }
  return listOpenAiModels(ctx, engine, apiKey, signal);
}

export function createLmStudioAdapter(opts: AdapterOptions = {}): ProviderAdapter {
  return createChatCompletionsAdapter({ kind: 'lmstudio', listModels: listLmStudioModels }, opts);
}
