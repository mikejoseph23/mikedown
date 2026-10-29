import type { AiEngineKind, ProviderAdapter } from '@mikedown/core/ai';
import type { AdapterOptions } from './http';
import { createAnthropicAdapter } from './anthropic';
import { createLmStudioAdapter } from './lmstudio';
import { createOllamaAdapter } from './ollama';
import { createOpenAiAdapter } from './openai';
import { createOpenAiCompatibleAdapter } from './openaiCompatible';
import { createVsCodeLmAdapter, type VsCodeLmApi } from './vscodeLm';

export { createAnthropicAdapter, createLmStudioAdapter, createOllamaAdapter, createOpenAiAdapter, createOpenAiCompatibleAdapter, createVsCodeLmAdapter };
export type { AdapterOptions, FetchLike } from './http';
export type { VsCodeLmApi } from './vscodeLm';

/**
 * One adapter per engine kind. `vscodeLm` (the `vscode` API, from
 * vscodeAi.ts) adds the `vscode-lm` kind; without it that kind is
 * unsupported, as in tests.
 */
export function createAdapters(opts: AdapterOptions & { vscodeLm?: VsCodeLmApi } = {}): Map<AiEngineKind, ProviderAdapter> {
  const adapters = new Map<AiEngineKind, ProviderAdapter>([
    ['openai-compatible', createOpenAiCompatibleAdapter(opts)],
    ['lmstudio', createLmStudioAdapter(opts)],
    ['ollama', createOllamaAdapter(opts)],
    ['anthropic', createAnthropicAdapter(opts)],
    ['openai', createOpenAiAdapter(opts)],
  ]);
  if (opts.vscodeLm) {adapters.set('vscode-lm', createVsCodeLmAdapter(opts.vscodeLm));}
  return adapters;
}
