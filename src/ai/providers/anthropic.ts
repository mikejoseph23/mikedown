import {
  anthropicNextPage,
  buildAuthHeaders,
  buildCompletionBody,
  engineEndpoints,
  parseAnthropicModels,
  type AiDiscoveredModel,
  type ProviderAdapter,
} from '@mikedown/core/ai';
import { adapterContext, completionResult, probeModelList } from './openaiCompatible';
import { requestJson, streamCompletion, type AdapterOptions } from './http';

/**
 * Anthropic Messages API: `x-api-key` plus `anthropic-version`, SSE events
 * read by core's Anthropic reader, discovery from the paged `GET /v1/models`
 * (display name, context window, image input). No embeddings endpoint.
 * Core's request builder omits sampling parameters (`temperature`), which
 * the current API version rejects.
 */

const MAX_MODEL_PAGES = 10;

export function createAnthropicAdapter(opts: AdapterOptions = {}): ProviderAdapter {
  const ctx = adapterContext(opts);
  return {
    kind: 'anthropic',
    async listModels(engine, apiKey, signal) {
      const base = engineEndpoints(engine).models;
      const headers = buildAuthHeaders('anthropic', apiKey);
      const out: AiDiscoveredModel[] = [];
      let after: string | null = null;
      for (let page = 0; page < MAX_MODEL_PAGES; page++) {
        const url: string = `${base}?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`;
        const body = await requestJson(ctx.fetch, url, { headers }, signal, ctx.discoveryTimeoutMs);
        out.push(...parseAnthropicModels(body));
        after = anthropicNextPage(body);
        if (!after) {break;}
      }
      return out;
    },
    probe: (engine, apiKey, signal) => probeModelList(ctx, engine, apiKey, signal, `${engineEndpoints(engine).models}?limit=1`),
    async complete(engine, apiKey, model, req, onToken, signal) {
      const body = buildCompletionBody('anthropic', model, req);
      const out = await streamCompletion(ctx.fetch, 'anthropic', engineEndpoints(engine).completions, buildAuthHeaders('anthropic', apiKey), body, onToken, signal);
      return completionResult(engine, model, out);
    },
  };
}
