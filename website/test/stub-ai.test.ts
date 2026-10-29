// The demos' stub `ai` host: tier 2 (so the AI tab lists an engine), routes to itself, streams canned text.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resolveRoute } from '@mikedown/core/ai';
import { STUB_TEXT, stubAiHost, stubAiSettings } from '../developers/common/stub-ai';

const request = { requestId: 'r1', feature: 'rewrite', task: 'rewrite', messages: [{ role: 'user' as const, content: 'Make it shorter.' }] };

describe('stub ai host', () => {
  it('is tier 2 and routes the rewrite task to its own engine', () => {
    expect(typeof stubAiHost.listEngines).toBe('function');
    const route = resolveRoute(stubAiSettings, [], {}, { feature: 'rewrite' });
    expect(route).toMatchObject({ engineId: 'demo-stub', modelId: 'canned-text', isLocal: true, needsConsent: false });
  });

  it('lists a healthy engine named as a stub and a cloud engine nobody has probed yet', async () => {
    const [engine, cloud] = await stubAiHost.listEngines!();
    expect(engine).toMatchObject({ engineId: 'demo-stub', ok: true, models: [{ id: 'canned-text' }] });
    expect(stubAiSettings.engines[0].name).toMatch(/stub/i);
    expect(cloud).toMatchObject({ engineId: 'demo-cloud', ok: null, isLocal: false, hasKey: false, models: [] });
    expect(stubAiSettings.engines.map((e) => e.id)).toEqual(['demo-stub', 'demo-cloud']);
  });

  it('fetches a provider-shaped model list for a cloud engine, and remembers only that a key was stored', async () => {
    await stubAiHost.setSecret!('demo-cloud', 'sk-demo');
    const status = await stubAiHost.discoverModels!('demo-cloud');
    expect(status).toMatchObject({ engineId: 'demo-cloud', ok: true, isLocal: false, hasKey: true });
    expect(status.models.length).toBeGreaterThanOrEqual(10);
    expect(status.models.map((m) => m.id)).toContain('claude-sonnet-5-5');
    expect(JSON.stringify(status)).not.toContain('sk-demo');
    // A card added on the page gets an id like `openai-ab12`, and a list of its own provider's shape.
    const openai = await stubAiHost.discoverModels!('openai-ab12');
    expect(openai.models.map((m) => m.id)).toContain('gpt-5.5');
    // Any other engine still gets the one canned model.
    expect((await stubAiHost.discoverModels!('lm-studio-1')).models.map((m) => m.id)).toEqual(['canned-text']);
    await stubAiHost.setSecret!('demo-cloud', null);
    expect((await stubAiHost.testEngine!('demo-cloud')).hasKey).toBe(false);
  });

  it('streams the canned text word by word', async () => {
    const tokens: string[] = [];
    const result = await stubAiHost.complete(request, (t) => tokens.push(t), new AbortController().signal);
    expect(tokens.length).toBeGreaterThan(5);
    expect(tokens.join('')).toBe(STUB_TEXT);
    expect(result).toMatchObject({ text: STUB_TEXT, finishReason: 'stop', served: { engineName: expect.stringMatching(/stub/i) } });
  });

  it('ignores per-request requestOverrides (the thinking dial) and streams the same text', async () => {
    const result = await stubAiHost.complete({ ...request, requestOverrides: { reasoning_effort: 'low' } }, () => {}, new AbortController().signal);
    expect(result).toMatchObject({ text: STUB_TEXT, finishReason: 'stop' });
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    const onToken = vi.fn(() => controller.abort());
    const result = await stubAiHost.complete(request, onToken, controller.signal);
    expect(result.finishReason).toBe('cancelled');
    expect(onToken).toHaveBeenCalledTimes(1);
  });
});

const dist = resolve(__dirname, '../dist/developers');
describe.skipIf(!existsSync(resolve(dist, 'index.html')))('built developer pages', () => {
  it('label the demo AI as a stub, and the hub documents tier 1, tier 2, consent and no provider SDK', () => {
    for (const page of ['', 'react/', 'vue/', 'angular/', 'web-component/']) {
      expect(readFileSync(resolve(dist, page, 'index.html'), 'utf8'), page).toContain('The AI here is a stub');
    }
    const hub = readFileSync(resolve(dist, 'index.html'), 'utf8');
    expect(hub).toContain('id="byo-ai"');
    expect(hub).toContain('Tier 1');
    expect(hub).toContain('Tier 2');
    expect(hub).toContain('requestCloudConsent');
    expect(hub).toContain('ships no provider SDK');
  });
});
