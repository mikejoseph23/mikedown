import type { ProviderAdapter } from '@mikedown/core/ai';
import { createChatCompletionsAdapter, listOpenAiModels } from './openaiCompatible';
import type { AdapterOptions } from './http';

/**
 * OpenAI (`kind: 'openai'`): Chat Completions with `max_completion_tokens`
 * and usage in the stream (both from core's request builder), capabilities
 * from core's OpenAI model table. `/v1/models` lists every model the key can
 * see, including image, audio and moderation ones; discovery keeps the text
 * and embedding models only.
 */

const NON_TEXT_MODEL = /(dall-e|whisper|tts|audio|realtime|transcribe|image|moderation|davinci|babbage|search|computer-use|sora)/i;

export function isOpenAiTextModel(id: string): boolean {
  return !NON_TEXT_MODEL.test(id);
}

export function createOpenAiAdapter(opts: AdapterOptions = {}): ProviderAdapter {
  return createChatCompletionsAdapter(
    {
      kind: 'openai',
      listModels: async (ctx, engine, apiKey, signal) => (await listOpenAiModels(ctx, engine, apiKey, signal)).filter((m) => isOpenAiTextModel(m.id)),
    },
    opts,
  );
}
