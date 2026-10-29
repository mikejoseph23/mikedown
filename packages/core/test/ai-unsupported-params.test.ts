// @vitest-environment node
// OpenAI reasoning models take only the default sampling, and a 400 that
// names an unsupported parameter is retried once without it. The bodies and
// error cases are the shared fixtures the Rust port runs too.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCompletionBody, isOpenAiReasoningModel, unsupportedRequestParam, withoutRequestParam } from '@mikedown/core/ai';
import type { AiCompletionRequest, AiEngineKind } from '@mikedown/core/ai';

const FIXTURES = join(__dirname, '..', '..', '..', 'test', 'ai-fixtures', 'requests');
const load = (name: string): any => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

describe('OpenAI reasoning models', () => {
  it('Summarize on gpt-5.5 sends no temperature (it rejects anything but the default)', () => {
    const req: AiCompletionRequest = { feature: 'summary', messages: [{ role: 'user', content: 'Summarize.' }], maxTokens: 600, temperature: 0.3 };
    const body = buildCompletionBody('openai', { id: 'gpt-5.5' }, req);
    expect(body).not.toHaveProperty('temperature');
    expect(body.max_completion_tokens).toBe(600);
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('is detected by id on the openai kind, and only for openai/ ids elsewhere', () => {
    expect(isOpenAiReasoningModel('gpt-5.5', 'openai')).toBe(true);
    expect(isOpenAiReasoningModel('o4-mini', 'openai')).toBe(true);
    expect(isOpenAiReasoningModel('gpt-4o', 'openai')).toBe(false);
    expect(isOpenAiReasoningModel('gpt-oss-20b', 'openai')).toBe(false);
    expect(isOpenAiReasoningModel('omni-moderation-latest', 'openai')).toBe(false);
    expect(isOpenAiReasoningModel('openai/o3', 'openai-compatible')).toBe(true);
    expect(isOpenAiReasoningModel('o3-mini', 'openai-compatible')).toBe(false);
    expect(isOpenAiReasoningModel('openai/gpt-oss-120b', 'openai-compatible')).toBe(false);
  });

  const fx = load('openai-reasoning.json');
  it.each((fx.cases as any[]).map((c) => [c.name, c] as const))('fixture: %s', (_name, c) => {
    const body = buildCompletionBody(c.kind as AiEngineKind, { id: c.modelId, requestOverrides: c.modelOverrides }, fx.request as AiCompletionRequest);
    for (const [key, value] of Object.entries(c.expected)) {expect(body[key], key).toEqual(value);}
    for (const key of c.absent as string[]) {expect(body, key).not.toHaveProperty(key);}
  });
});

describe('unsupported parameter retry', () => {
  const fx = load('unsupported-params.json');
  it.each((fx.errors as any[]).map((c) => [c.name, c] as const))('error: %s', (_name, c) => {
    expect(unsupportedRequestParam(c.status, c.body)).toBe(c.param);
  });
  it.each((fx.adjust as any[]).map((c) => [c.name, c] as const))('adjust: %s', (_name, c) => {
    const before = structuredClone(c.body);
    expect(withoutRequestParam(c.body, c.param)).toEqual(c.expected);
    expect(c.body).toEqual(before);
  });
});
