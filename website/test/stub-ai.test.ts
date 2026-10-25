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

  it('lists one healthy engine named as a stub', async () => {
    const [engine] = await stubAiHost.listEngines!();
    expect(engine).toMatchObject({ engineId: 'demo-stub', ok: true, models: [{ id: 'canned-text' }] });
    expect(stubAiSettings.engines[0].name).toMatch(/stub/i);
  });

  it('streams the canned text word by word', async () => {
    const tokens: string[] = [];
    const result = await stubAiHost.complete(request, (t) => tokens.push(t), new AbortController().signal);
    expect(tokens.length).toBeGreaterThan(5);
    expect(tokens.join('')).toBe(STUB_TEXT);
    expect(result).toMatchObject({ text: STUB_TEXT, finishReason: 'stop', served: { engineName: expect.stringMatching(/stub/i) } });
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
