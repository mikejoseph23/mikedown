// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_DEFAULT_MAX_TOKENS,
  JSON_ONLY_INSTRUCTION,
  base64ToBytes,
  buildAuthHeaders,
  buildCompletionBody,
  buildEmbeddingsBody,
  bytesToBase64,
  engineEndpoints,
  mergeRequestOverrides,
  parseEmbeddingsResponse,
} from '@mikedown/core/ai';
import type { AiCompletionRequest, AiEngineKind } from '@mikedown/core/ai';

const req = (over: Partial<AiCompletionRequest> = {}): AiCompletionRequest => ({
  requestId: 'r1',
  feature: 'rewrite',
  task: 'rewrite',
  messages: [
    { role: 'system', content: 'Keep markdown.' },
    { role: 'user', content: 'Shorten this.' },
  ],
  ...over,
});
const model = { id: 'm1' };
const OPENAI_STYLE: AiEngineKind[] = ['openai-compatible', 'lmstudio', 'ollama', 'openai'];

describe('engineEndpoints', () => {
  it('openai-compatible: base plus the standard paths, trailing slashes trimmed', () => {
    expect(engineEndpoints({ kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1/' })).toEqual({
      completions: 'http://127.0.0.1:8000/v1/chat/completions',
      models: 'http://127.0.0.1:8000/v1/models',
      embeddings: 'http://127.0.0.1:8000/v1/embeddings',
    });
  });

  it('lmstudio: native models endpoint hangs off the root, /v1 added when missing', () => {
    for (const baseUrl of ['http://127.0.0.1:1234/v1', 'http://127.0.0.1:1234']) {
      expect(engineEndpoints({ kind: 'lmstudio', baseUrl })).toMatchObject({
        completions: 'http://127.0.0.1:1234/v1/chat/completions',
        models: 'http://127.0.0.1:1234/v1/models',
        nativeModels: 'http://127.0.0.1:1234/api/v0/models',
      });
    }
  });

  it('ollama: /api/tags and /api/show from the root', () => {
    expect(engineEndpoints({ kind: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' })).toMatchObject({
      completions: 'http://127.0.0.1:11434/v1/chat/completions',
      nativeModels: 'http://127.0.0.1:11434/api/tags',
      nativeShow: 'http://127.0.0.1:11434/api/show',
    });
  });

  it('anthropic: /v1/messages with or without /v1 on the base, no embeddings', () => {
    for (const baseUrl of ['https://api.anthropic.com', 'https://api.anthropic.com/v1', 'https://api.anthropic.com/']) {
      const e = engineEndpoints({ kind: 'anthropic', baseUrl });
      expect(e.completions).toBe('https://api.anthropic.com/v1/messages');
      expect(e.models).toBe('https://api.anthropic.com/v1/models');
      expect(e.embeddings).toBeUndefined();
    }
  });
});

describe('buildAuthHeaders', () => {
  it('Bearer token for OpenAI-style kinds, none without a key', () => {
    expect(buildAuthHeaders('openai-compatible', 'sk-1')).toEqual({ 'content-type': 'application/json', authorization: 'Bearer sk-1' });
    expect(buildAuthHeaders('lmstudio', null)).toEqual({ 'content-type': 'application/json' });
  });

  it('Anthropic: x-api-key and the pinned API version, never Authorization', () => {
    const h = buildAuthHeaders('anthropic', 'sk-ant');
    expect(h).toEqual({ 'content-type': 'application/json', 'anthropic-version': ANTHROPIC_API_VERSION, 'x-api-key': 'sk-ant' });
    expect(buildAuthHeaders('anthropic', null)).not.toHaveProperty('x-api-key');
    expect(ANTHROPIC_API_VERSION).toBe('2026-10-21');
  });
});

describe('completion body per kind', () => {
  it('Chat Completions kinds: model, messages, stream, optional max_tokens and temperature', () => {
    for (const kind of OPENAI_STYLE) {
      const body = buildCompletionBody(kind, model, req({ maxTokens: 200, temperature: 0.3 }));
      expect(body.model, kind).toBe('m1');
      expect(body.stream, kind).toBe(true);
      expect(body.messages, kind).toEqual([
        { role: 'system', content: 'Keep markdown.' },
        { role: 'user', content: 'Shorten this.' },
      ]);
      expect(body.temperature, kind).toBe(0.3);
      expect(body[kind === 'openai' ? 'max_completion_tokens' : 'max_tokens'], kind).toBe(200);
      expect(body[kind === 'openai' ? 'max_tokens' : 'max_completion_tokens'], kind).toBeUndefined();
    }
  });

  it('leaves max_tokens, temperature and response_format out when the request has none', () => {
    const body = buildCompletionBody('openai-compatible', model, req());
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'stream']);
  });

  it('only openai asks for usage in the stream, and only when streaming', () => {
    expect(buildCompletionBody('openai', model, req()).stream_options).toEqual({ include_usage: true });
    expect(buildCompletionBody('openai', model, req(), { stream: false }).stream_options).toBeUndefined();
    expect(buildCompletionBody('openai-compatible', model, req()).stream_options).toBeUndefined();
  });

  it('stream: false is honoured on every kind', () => {
    for (const kind of [...OPENAI_STYLE, 'anthropic'] as AiEngineKind[]) {
      expect(buildCompletionBody(kind, model, req(), { stream: false }).stream, kind).toBe(false);
    }
  });

  it('Anthropic: system prompts lifted out, max_tokens always set, no temperature', () => {
    const body = buildCompletionBody('anthropic', model, req({ temperature: 0.2 }));
    expect(body.system).toBe('Keep markdown.');
    expect(body.messages).toEqual([{ role: 'user', content: 'Shorten this.' }]);
    expect(body.max_tokens).toBe(ANTHROPIC_DEFAULT_MAX_TOKENS);
    expect(ANTHROPIC_DEFAULT_MAX_TOKENS).toBe(4096);
    expect(body).not.toHaveProperty('temperature');
    expect(body.stream).toBe(true);
    expect(buildCompletionBody('anthropic', model, req({ maxTokens: 50 })).max_tokens).toBe(50);
  });

  it('Anthropic: several system messages join in order; none means no system field', () => {
    const body = buildCompletionBody(
      'anthropic',
      model,
      req({
        messages: [
          { role: 'system', content: 'A' },
          { role: 'user', content: 'q' },
          { role: 'assistant', content: 'a' },
          { role: 'system', content: [{ type: 'text', text: 'B' }, { type: 'text', text: 'C' }] },
        ],
      }),
    );
    expect(body.system).toBe('A\n\nB\n\nC');
    expect((body.messages as any[]).map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(buildCompletionBody('anthropic', model, req({ messages: [{ role: 'user', content: 'hi' }] }))).not.toHaveProperty('system');
  });
});

describe("format: 'json' mapping per kind", () => {
  it('openai-compatible, ollama and openai use json_object', () => {
    for (const kind of ['openai-compatible', 'ollama', 'openai'] as AiEngineKind[]) {
      expect(buildCompletionBody(kind, model, req({ format: 'json' })).response_format, kind).toEqual({ type: 'json_object' });
    }
  });

  it('lmstudio uses json_schema with a permissive object schema (it rejects json_object)', () => {
    expect(buildCompletionBody('lmstudio', model, req({ format: 'json' })).response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'response', schema: { type: 'object' } },
    });
  });

  it('anthropic has no JSON mode: a system line is added, even with no system prompt', () => {
    expect(buildCompletionBody('anthropic', model, req({ format: 'json' })).system).toBe(`Keep markdown.\n\n${JSON_ONLY_INSTRUCTION}`);
    const bare = buildCompletionBody('anthropic', model, req({ format: 'json', messages: [{ role: 'user', content: 'x' }] }));
    expect(bare.system).toBe(JSON_ONLY_INSTRUCTION);
    expect(bare).not.toHaveProperty('response_format');
  });

  it("'text' and absent formats add nothing", () => {
    for (const format of ['text', undefined] as const) {
      expect(buildCompletionBody('openai-compatible', model, req({ format }))).not.toHaveProperty('response_format');
      expect(buildCompletionBody('anthropic', model, req({ format })).system).toBe('Keep markdown.');
    }
  });
});

describe('image parts', () => {
  const png = new Uint8Array([1, 2, 3]);
  const withImage = req({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Describe' }, { type: 'image', mime: 'image/png', bytes: png }] }],
  });

  it('Chat Completions kinds: image_url with a base64 data URL', () => {
    for (const kind of OPENAI_STYLE) {
      const content = (buildCompletionBody(kind, model, withImage).messages as any[])[0].content;
      expect(content, kind).toEqual([
        { type: 'text', text: 'Describe' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
      ]);
    }
  });

  it('Anthropic: an image block with a base64 source', () => {
    const content = (buildCompletionBody('anthropic', model, withImage).messages as any[])[0].content;
    expect(content).toEqual([
      { type: 'text', text: 'Describe' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQID' } },
    ]);
  });

  it('keeps part order and mime types', () => {
    const r = req({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', mime: 'image/jpeg', bytes: new Uint8Array([255]) },
            { type: 'text', text: 'a' },
            { type: 'image', mime: 'image/webp', bytes: new Uint8Array([0, 1]) },
          ],
        },
      ],
    });
    const urls = ((buildCompletionBody('openai-compatible', model, r).messages as any[])[0].content as any[]).map((p) => p.image_url?.url ?? p.text);
    expect(urls).toEqual(['data:image/jpeg;base64,/w==', 'a', 'data:image/webp;base64,AAE=']);
  });
});

describe('requestOverrides', () => {
  it('win over request-derived fields, on every kind', () => {
    for (const kind of [...OPENAI_STYLE, 'anthropic'] as AiEngineKind[]) {
      const body = buildCompletionBody(kind, { id: 'm1', requestOverrides: { max_tokens: 7, stream: false, model: 'forced' } }, req({ maxTokens: 500 }));
      expect(body.max_tokens, kind).toBe(7);
      expect(body.stream, kind).toBe(false);
      expect(body.model, kind).toBe('forced');
    }
  });

  it('override a request temperature on OpenAI-style kinds', () => {
    const body = buildCompletionBody('openai-compatible', { id: 'm1', requestOverrides: { temperature: 0.9 } }, req({ temperature: 0.2 }));
    expect(body.temperature).toBe(0.9);
  });

  it('can add fields the request does not set (thinking controls)', () => {
    const body = buildCompletionBody('openai-compatible', { id: 'm1', requestOverrides: { reasoning_effort: 'low', chat_template_kwargs: { enable_thinking: false } } }, req());
    expect(body.reasoning_effort).toBe('low');
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    const claude = buildCompletionBody('anthropic', { id: 'c', requestOverrides: { thinking: { type: 'disabled' } } }, req());
    expect(claude.thinking).toEqual({ type: 'disabled' });
  });

  it('merge nested objects deeply and replace arrays and scalars', () => {
    const merged = mergeRequestOverrides(
      { a: { x: 1, y: { z: 1 } }, list: [1, 2], keep: 'k', s: 'old' },
      { a: { y: { w: 2 }, q: 3 }, list: [9], s: { now: 'object' } },
    );
    expect(merged).toEqual({ a: { x: 1, y: { z: 1, w: 2 }, q: 3 }, list: [9], keep: 'k', s: { now: 'object' } });
  });

  it('do not mutate the body or the overrides, and no overrides returns the body', () => {
    const body = { a: { x: 1 } };
    const over = { a: { y: 2 } };
    const out = mergeRequestOverrides(body, over);
    expect(body).toEqual({ a: { x: 1 } });
    expect(over).toEqual({ a: { y: 2 } });
    expect(out).toEqual({ a: { x: 1, y: 2 } });
    expect(mergeRequestOverrides(body, undefined)).toBe(body);
  });

  it('a null override replaces the field (the way to remove a default)', () => {
    expect(mergeRequestOverrides({ a: 1 }, { a: null })).toEqual({ a: null });
  });
});

describe('embeddings', () => {
  it('body is { model, input } with overrides merged, and null for Anthropic', () => {
    expect(buildEmbeddingsBody('openai-compatible', { id: 'nomic-embed-text-v1.5' }, ['a', 'b'])).toEqual({ model: 'nomic-embed-text-v1.5', input: ['a', 'b'] });
    expect(buildEmbeddingsBody('lmstudio', { id: 'e', requestOverrides: { dimensions: 256 } }, ['a'])).toEqual({ model: 'e', input: ['a'], dimensions: 256 });
    expect(buildEmbeddingsBody('anthropic', { id: 'x' }, ['a'])).toBeNull();
  });

  it('parseEmbeddingsResponse returns vectors in input order, tolerating junk', () => {
    expect(
      parseEmbeddingsResponse({ data: [{ index: 1, embedding: [3, 4] }, { index: 0, embedding: [1, 2] }, { embedding: 'bad' }, 'x'] }),
    ).toEqual([[1, 2], [3, 4], []]);
    expect(parseEmbeddingsResponse(null)).toEqual([]);
    expect(parseEmbeddingsResponse({ data: 'x' })).toEqual([]);
    expect(parseEmbeddingsResponse({ data: [{ embedding: [1, 'a', 2] }] })).toEqual([[1, 2]]);
  });
});

describe('base64 helpers', () => {
  it('match known vectors for every padding length', () => {
    const enc = (s: string) => bytesToBase64(new TextEncoder().encode(s));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('Zg==');
    expect(enc('fo')).toBe('Zm8=');
    expect(enc('foo')).toBe('Zm9v');
    expect(enc('foob')).toBe('Zm9vYg==');
    expect(enc('fooba')).toBe('Zm9vYmE=');
    expect(enc('foobar')).toBe('Zm9vYmFy');
  });

  it('round-trip arbitrary bytes and agree with Node\'s Buffer', () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 37 + 11) % 256);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
    for (let n = 0; n < 6; n++) {
      const b = bytes.slice(0, n);
      expect(Array.from(base64ToBytes(bytesToBase64(b)))).toEqual(Array.from(b));
    }
  });

  it('decode ignores whitespace and accepts URL-safe characters', () => {
    expect(Array.from(base64ToBytes('Zm9v\nYmFy'))).toEqual(Array.from(new TextEncoder().encode('foobar')));
    expect(Array.from(base64ToBytes('_-8'))).toEqual(Array.from(Buffer.from('/+8=', 'base64')));
  });
});
