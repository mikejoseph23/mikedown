// @vitest-environment node
// Smoke tests: every shared fixture in test/ai-fixtures/ agrees with the pure
// AI modules. The full suites (schema, router, locality, capabilities, SSE,
// requests) are milestone T1.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  anthropicNextPage,
  buildCompletionBody,
  createCompletionStreamReader,
  detectCapabilities,
  detectLocality,
  mergeDiscoveredModels,
  parseAiSettings,
  parseAnthropicModels,
  parseLmStudioModels,
  parseModelSizes,
  parseOllamaShow,
  parseOllamaTags,
  parseOmlxModelStatus,
  parseOpenAiModelList,
  resolveRoute,
  serializeAiSettings,
  withModelStatus,
} from '@mikedown/core/ai';
import type { AiCompletionRequest, AiEngineKind, AiEngineStatus } from '@mikedown/core/ai';

const FIXTURES = join(__dirname, '..', '..', '..', 'test', 'ai-fixtures');
const load = (rel: string): any => JSON.parse(readFileSync(join(FIXTURES, rel), 'utf8'));

describe('SSE fixtures', () => {
  for (const file of [
    'openai-chat-stream.json',
    'openai-reasoning-length-stream.json',
    'openai-truncated-stream.json',
    'openai-usage-stream.json',
    'openai-no-usage-stream.json',
    'anthropic-messages-stream.json',
    'anthropic-error-stream.json',
  ]) {
    it(file, () => {
      const fx = load(`sse/${file}`);
      const reader = createCompletionStreamReader(fx.kind as AiEngineKind);
      const deltas = (fx.chunks as string[]).flatMap((c) => reader.push(c));
      const outcome = reader.finish();
      expect(deltas).toEqual(fx.expected.deltas);
      const { deltas: _d, ...rest } = fx.expected;
      expect(outcome).toEqual(rest);
      if (fx.outputChars !== undefined) {expect(reader.outputChars()).toBe(fx.outputChars);}
    });
  }
});

describe('discovery fixtures', () => {
  it('LM Studio /api/v0/models', () => {
    const fx = load('discovery/lmstudio-api-v0-models.json');
    expect(parseLmStudioModels(fx.response)).toEqual(fx.expected);
  });

  it('LM Studio /api/v0/models with the loaded model further down', () => {
    const fx = load('discovery/lmstudio-api-v0-models-loaded-later.json');
    expect(parseLmStudioModels(fx.response)).toEqual(fx.expected);
  });

  it('LM Studio /api/v1/models gives the sizes /api/v0 lacks', () => {
    const fx = load('discovery/lmstudio-api-v1-models-sizes.json');
    expect(Object.fromEntries(parseModelSizes(fx.response))).toEqual(fx.expectedSizes);
  });

  it('oMLX /v1/models plus /v1/models/status', () => {
    const fx = load('discovery/omlx-models-status.json');
    expect(withModelStatus(parseOpenAiModelList(fx.listed), parseOmlxModelStatus(fx.response))).toEqual(fx.expected);
  });

  it('Ollama /api/tags then /api/show', () => {
    const tags = load('discovery/ollama-api-tags.json');
    const show = load('discovery/ollama-api-show.json');
    const names = parseOllamaTags(tags.response);
    expect(names).toEqual(tags.expectedNames);
    expect(Object.fromEntries(parseModelSizes(tags.response))).toEqual(tags.expectedSizes);
    expect(names.map((n) => parseOllamaShow(n, show.responses[n]))).toEqual(show.expected);
  });

  it('bare /v1/models uses the id heuristics', () => {
    const fx = load('discovery/openai-v1-models-bare.json');
    expect(parseOpenAiModelList(fx.response)).toEqual(fx.expected);
    for (const [id, caps] of Object.entries(fx.expectedHeuristics)) {
      expect(detectCapabilities(id, 'openai-compatible').capabilities).toEqual(caps);
    }
    const merged = mergeDiscoveredModels([], parseOpenAiModelList(fx.response), 'openai-compatible');
    expect(merged.map((m) => m.capabilities)).toEqual(Object.values(fx.expectedHeuristics));
  });

  it('Anthropic /v1/models', () => {
    const fx = load('discovery/anthropic-v1-models.json');
    expect(parseAnthropicModels(fx.response)).toEqual(fx.expected);
    expect(anthropicNextPage(fx.response)).toBe(fx.expectedNextPage);
  });
});

describe('routing fixtures', () => {
  const fx = load('routing/scenarios.json');
  for (const sc of fx.scenarios) {
    it(sc.name, () => {
      const settings = parseAiSettings(sc.settings, { onWarning: (m) => { throw new Error(m); } });
      const result = resolveRoute(settings, sc.statuses as AiEngineStatus[], sc.consent, sc.request);
      expect(result).toMatchObject(sc.expected);
    });
  }
});

describe('contracts smoke', () => {
  it('parse and serialize round-trip keeps generated ids and unknown keys', () => {
    const raw = { enabled: true, futureKey: 1, engines: [{ name: 'oMLX', baseUrl: 'http://127.0.0.1:8000/v1', extra: 'kept', models: [{ id: 'm', x: 2 }] }] };
    const first = parseAiSettings(raw, { onWarning: () => {} });
    const patch = serializeAiSettings(first);
    expect(patch['ai.futureKey']).toBe(1);
    const again = parseAiSettings(patch, { onWarning: () => {} });
    expect(again.engines[0].id).toBe(first.engines[0].id);
    expect((again.engines[0] as any).extra).toBe('kept');
    expect((again.engines[0].models[0] as any).x).toBe(2);
  });

  it('locality', () => {
    expect(detectLocality('http://127.0.0.1:8000/v1')).toBe('local');
    expect(detectLocality('http://studio.local:1234/v1')).toBe('local');
    expect(detectLocality('http://10.0.98.4:8000/v1', ['10.0.98.0/24'])).toBe('local');
    expect(detectLocality('https://api.anthropic.com')).toBe('cloud');
    expect(detectLocality('http://[::1]:11434')).toBe('local');
  });

  it('request overrides win and anthropic drops sampling parameters', () => {
    const req: AiCompletionRequest = {
      requestId: 'r1',
      feature: 'rewrite',
      task: 'rewrite',
      messages: [
        { role: 'system', content: 'Keep markdown.' },
        { role: 'user', content: [{ type: 'text', text: 'hi' }, { type: 'image', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }] },
      ],
      temperature: 0.2,
      format: 'json',
    };
    const oai = buildCompletionBody('openai-compatible', { id: 'm', requestOverrides: { temperature: 0.9, chat_template_kwargs: { enable_thinking: false } } }, req);
    expect(oai.temperature).toBe(0.9);
    expect(oai.response_format).toEqual({ type: 'json_object' });
    expect((oai.messages as any)[1].content[1].image_url.url).toBe('data:image/png;base64,AQID');
    const claude = buildCompletionBody('anthropic', { id: 'claude-sonnet-5-5' }, req);
    expect(claude.temperature).toBeUndefined();
    expect(claude.system).toContain('Keep markdown.');
    expect((claude.messages as any)[0].content[1].source).toEqual({ type: 'base64', media_type: 'image/png', data: 'AQID' });
  });
});
