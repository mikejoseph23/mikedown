import type { AiEngineKind, ProviderAdapter } from '@mikedown/core/ai';
import type { AdapterOptions } from './http';
import { createAnthropicAdapter } from './anthropic';
import { createLmStudioAdapter } from './lmstudio';
import { createOllamaAdapter } from './ollama';
import { createOpenAiAdapter } from './openai';
import { createOpenAiCompatibleAdapter } from './openaiCompatible';

export { createAnthropicAdapter, createLmStudioAdapter, createOllamaAdapter, createOpenAiAdapter, createOpenAiCompatibleAdapter };
export type { AdapterOptions, FetchLike } from './http';

/** One adapter per engine kind. */
export function createAdapters(opts: AdapterOptions = {}): Map<AiEngineKind, ProviderAdapter> {
  return new Map<AiEngineKind, ProviderAdapter>([
    ['openai-compatible', createOpenAiCompatibleAdapter(opts)],
    ['lmstudio', createLmStudioAdapter(opts)],
    ['ollama', createOllamaAdapter(opts)],
    ['anthropic', createAnthropicAdapter(opts)],
    ['openai', createOpenAiAdapter(opts)],
  ]);
}
