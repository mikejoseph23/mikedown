/**
 * VS Code provider adapters against the shared fixtures, with a fake fetch:
 * streaming reassembly, discovery per kind, HTTP and network error mapping,
 * cancellation mid-stream.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseAiSettings, type AiCompletionRequest, type AiEngineConfig, type AiModelConfig } from '@mikedown/core/ai';
import { createAdapters, type FetchLike } from '../../src/ai/providers';
import { isOpenAiTextModel } from '../../src/ai/providers/openai';

const fixture = (rel: string): any => JSON.parse(readFileSync(join(__dirname, '../ai-fixtures', rel), 'utf8'));

function engine(kind: AiEngineConfig['kind'], baseUrl: string, models: Array<Partial<AiModelConfig>> = [{ id: 'm' }]): AiEngineConfig {
  return parseAiSettings({ engines: [{ id: 'e1', name: 'Engine', kind, baseUrl, models }] }, { onWarning: () => {} }).engines[0];
}

const request: AiCompletionRequest = { requestId: 'r1', feature: 'rewrite', task: 'rewrite', messages: [{ role: 'user', content: 'Hi' }] };

function sseResponse(chunks: string[], init: { signal?: AbortSignal; hold?: boolean } = {}): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {controller.enqueue(enc.encode(c));}
      if (init.hold) {
        init.signal?.addEventListener('abort', () => controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      } else {
        controller.close();
      }
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Call = { url: string; init?: RequestInit };

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    },
  };
}

describe('streaming completions', () => {
  it('openai-compatible streams the fixture deltas and posts the core-built body', async () => {
    const fx = fixture('sse/openai-chat-stream.json');
    const { fetch, calls } = fakeFetch(() => sseResponse(fx.chunks));
    const adapter = createAdapters({ fetch }).get('openai-compatible')!;
    const e = engine('openai-compatible', 'http://127.0.0.1:8000/v1', [{ id: 'qwen', requestOverrides: { reasoning_effort: 'low' } }]);
    const tokens: string[] = [];
    const result = await adapter.complete(e, 'sk-local', e.models[0], request, (d) => tokens.push(d), new AbortController().signal);
    expect(tokens).toEqual(fx.expected.deltas);
    expect(result).toMatchObject({ text: fx.expected.text, finishReason: 'stop', usage: fx.expected.usage, served: { engineId: 'e1', modelId: 'qwen', isLocal: true } });
    expect(calls[0].url).toBe('http://127.0.0.1:8000/v1/chat/completions');
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe('Bearer sk-local');
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ model: 'qwen', stream: true, reasoning_effort: 'low' });
  });

  it('anthropic streams Messages events with x-api-key and no temperature', async () => {
    const fx = fixture('sse/anthropic-messages-stream.json');
    const { fetch, calls } = fakeFetch(() => sseResponse(fx.chunks));
    const adapter = createAdapters({ fetch }).get('anthropic')!;
    const e = engine('anthropic', 'https://api.anthropic.com', [{ id: 'claude-sonnet-5-5' }]);
    const tokens: string[] = [];
    const result = await adapter.complete(e, 'sk-ant', e.models[0], { ...request, temperature: 0.3 }, (d) => tokens.push(d), new AbortController().signal);
    expect(tokens.join('')).toBe(fx.expected.text);
    expect(result.served.isLocal).toBe(false);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect((calls[0].init?.headers as Record<string, string>)['x-api-key']).toBe('sk-ant');
    expect(JSON.parse(String(calls[0].init?.body)).temperature).toBeUndefined();
  });

  it('a truncated stream rejects instead of returning half an answer', async () => {
    const fx = fixture('sse/openai-truncated-stream.json');
    const { fetch } = fakeFetch(() => sseResponse(fx.chunks));
    const e = engine('openai-compatible', 'http://127.0.0.1:8000/v1');
    await expect(createAdapters({ fetch }).get('openai-compatible')!.complete(e, null, e.models[0], request, () => {}, new AbortController().signal))
      .rejects.toMatchObject({ code: 'unknown' });
  });

  it('a stream error event maps to its code', async () => {
    const fx = fixture('sse/anthropic-error-stream.json');
    const { fetch } = fakeFetch(() => sseResponse(fx.chunks));
    const e = engine('anthropic', 'https://api.anthropic.com');
    await expect(createAdapters({ fetch }).get('anthropic')!.complete(e, 'k', e.models[0], request, () => {}, new AbortController().signal))
      .rejects.toMatchObject({ code: 'rateLimited' });
  });

  it('aborting mid-stream rejects with cancelled', async () => {
    const controller = new AbortController();
    const { fetch } = fakeFetch((_url, init) => sseResponse(['data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'], { signal: init?.signal ?? undefined, hold: true }));
    const e = engine('lmstudio', 'http://127.0.0.1:1234/v1');
    const tokens: string[] = [];
    const pending = createAdapters({ fetch }).get('lmstudio')!.complete(e, null, e.models[0], request, (d) => {
      tokens.push(d);
      controller.abort();
    }, controller.signal);
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(tokens).toEqual(['Hel']);
  });
});

describe('HTTP and network errors', () => {
  const cases: Array<[number, string, string]> = [
    [401, '{"error":{"message":"bad key"}}', 'auth'],
    [403, '', 'auth'],
    [404, '{"error":"model not found"}', 'modelNotFound'],
    [413, '', 'contextOverflow'],
    [400, '{"error":{"message":"maximum context length is 8192 tokens"}}', 'contextOverflow'],
    [429, '', 'rateLimited'],
  ];
  it.each(cases)('HTTP %i maps to %s', async (status, body, code) => {
    const { fetch } = fakeFetch(() => new Response(body, { status }));
    const e = engine('openai-compatible', 'http://127.0.0.1:8000/v1');
    await expect(createAdapters({ fetch }).get('openai-compatible')!.complete(e, null, e.models[0], request, () => {}, new AbortController().signal))
      .rejects.toMatchObject({ code: code });
  });

  it('a refused connection is unreachable, in completions and probes', async () => {
    const { fetch } = fakeFetch(() => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })));
    const adapter = createAdapters({ fetch }).get('ollama')!;
    const e = engine('ollama', 'http://127.0.0.1:11434/v1');
    await expect(adapter.complete(e, null, e.models[0], request, () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'unreachable', message: expect.stringContaining('ECONNREFUSED') });
    const probe = await adapter.probe(e, null, new AbortController().signal);
    expect(probe).toMatchObject({ ok: false, error: { code: 'unreachable' } });
  });

  it('a probe 404 says the base URL is wrong, not that a model is missing', async () => {
    const { fetch } = fakeFetch(() => new Response('', { status: 404 }));
    const e = engine('openai-compatible', 'http://127.0.0.1:8000');
    const probe = await createAdapters({ fetch }).get('openai-compatible')!.probe(e, null, new AbortController().signal);
    expect(probe.error).toMatchObject({ code: 'unreachable', message: expect.stringContaining('base URL') });
  });
});

describe('discovery', () => {
  it('LM Studio reads /api/v0/models', async () => {
    const fx = fixture('discovery/lmstudio-api-v0-models.json');
    const { fetch, calls } = fakeFetch(() => json(fx.response));
    const models = await createAdapters({ fetch }).get('lmstudio')!.listModels(engine('lmstudio', 'http://127.0.0.1:1234/v1'), null, new AbortController().signal);
    expect(calls[0].url).toBe('http://127.0.0.1:1234/api/v0/models');
    expect(models).toEqual(fx.expected);
  });

  it('LM Studio falls back to /v1/models when /api/v0 errors', async () => {
    const bare = fixture('discovery/openai-v1-models-bare.json');
    const { fetch, calls } = fakeFetch((url) => (url.includes('/api/v0') ? new Response('', { status: 404 }) : json(bare.response)));
    const models = await createAdapters({ fetch }).get('lmstudio')!.listModels(engine('lmstudio', 'http://127.0.0.1:1234/v1'), null, new AbortController().signal);
    expect(calls.map((c) => c.url)).toEqual(['http://127.0.0.1:1234/api/v0/models', 'http://127.0.0.1:1234/v1/models']);
    expect(models).toEqual(bare.expected);
  });

  it('Ollama reads /api/tags, then /api/show per model, plus loaded state from /api/ps', async () => {
    const tags = fixture('discovery/ollama-api-tags.json');
    const show = fixture('discovery/ollama-api-show.json');
    const { fetch } = fakeFetch((url, init) => {
      if (url.endsWith('/api/tags')) {return json(tags.response);}
      if (url.endsWith('/api/ps')) {return json({ models: [{ name: 'gemma3:12b', model: 'gemma3:12b' }] });}
      if (url.endsWith('/api/show')) {return json(show.responses[JSON.parse(String(init?.body)).model]);}
      return new Response('', { status: 404 });
    });
    const models = await createAdapters({ fetch }).get('ollama')!.listModels(engine('ollama', 'http://127.0.0.1:11434/v1'), null, new AbortController().signal);
    expect(models.map((m) => m.id)).toEqual(tags.expectedNames);
    expect(models.map((m) => m.loaded)).toEqual([true, false, false]);
    expect(models[0].source).toBe('endpoint');
  });

  it('Anthropic follows pages', async () => {
    const fx = fixture('discovery/anthropic-v1-models.json');
    const { fetch, calls } = fakeFetch((url) => (url.includes('after_id') ? json({ data: [{ id: 'claude-next' }], has_more: false }) : json(fx.response)));
    const models = await createAdapters({ fetch }).get('anthropic')!.listModels(engine('anthropic', 'https://api.anthropic.com'), 'k', new AbortController().signal);
    expect(calls.length).toBe(fx.expectedNextPage ? 2 : 1);
    expect(models.slice(0, fx.expected.length)).toEqual(fx.expected);
  });

  it('OpenAI keeps text and embedding models only', () => {
    expect(['gpt-5.5', 'o4-mini', 'text-embedding-3-small'].every(isOpenAiTextModel)).toBe(true);
    expect(['dall-e-3', 'whisper-1', 'tts-1', 'gpt-realtime', 'omni-moderation-latest', 'gpt-image-1'].some(isOpenAiTextModel)).toBe(false);
  });
});
