/**
 * The consent messages of the webview bridge against a real AiEngineService
 * (the fakes-only cases live in ai-protocol.test.ts): aiListConsents and
 * aiForgetConsent answer aiConsents, a failing store answers aiError, and
 * aiRequestCloudConsent carries the three answers and cloudBlocked.
 */
import { describe, expect, it, vi } from 'vitest';
import { parseAiSettings, type AiEngineKind, type ProviderAdapter } from '@mikedown/core/ai';
import { AiEngineService, type ConsentDialogAnswer, type StoredConsent } from '../../src/ai/engineService';
import { AiSecrets } from '../../src/ai/secrets';
import { handleAiMessage } from '../../src/ai/webviewBridge';

const raw = {
  enabled: true,
  allowCloud: true,
  engines: [
    { id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', models: [{ id: 'qwen' }] },
    { id: 'claude', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', models: [{ id: 'm' }] },
    { id: 'oai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', models: [{ id: 'g' }] },
  ],
  routing: { default: { engineId: 'omlx', modelId: 'qwen' }, fallback: 'none', tasks: {} },
};

function setup(over: { allowCloud?: boolean; answer?: ConsentDialogAnswer; forget?: () => Promise<void> } = {}) {
  const settings = parseAiSettings({ ...raw, allowCloud: over.allowCloud ?? true }, { onWarning: () => {} });
  const stored = new Map<string, StoredConsent>();
  const askConsent = vi.fn(async (): Promise<ConsentDialogAnswer> => over.answer ?? 'allow');
  const adapter = (kind: AiEngineKind): ProviderAdapter => ({ kind, listModels: async () => [], probe: async () => ({ ok: true, latencyMs: 1 }), complete: vi.fn() });
  const service = new AiEngineService({
    readSettings: () => settings,
    secrets: new AiSecrets({ get: async () => undefined, store: async () => {}, delete: async () => {} }, {}),
    consent: {
      get: (id) => stored.get(id),
      set: async (id, record) => { stored.set(id, record); },
      forget: over.forget ?? (async (id) => { stored.delete(id); }),
      ids: () => [...stored.keys()],
    },
    askConsent,
    saveEngines: async () => {},
    log: () => {},
    adapters: new Map(['openai-compatible', 'anthropic', 'openai'].map((k) => [k as AiEngineKind, adapter(k as AiEngineKind)])),
  });
  const posted: any[] = [];
  const send = (message: Record<string, unknown>) => handleAiMessage(service, {}, message as never, (m) => posted.push(m));
  return { service, stored, askConsent, posted, send };
}

describe('consent messages through the bridge', () => {
  it('aiListConsents answers aiConsents with the stored answers, newest first', async () => {
    const { send, posted, stored } = setup();
    await send({ type: 'aiListConsents', requestId: 'l0' });
    expect(posted.at(-1)).toEqual({ type: 'aiConsents', requestId: 'l0', consents: [] });

    await send({ type: 'aiRequestCloudConsent', requestId: 'c1', engineId: 'claude' });
    await send({ type: 'aiRequestCloudConsent', requestId: 'c2', engineId: 'oai' });
    stored.get('claude')!.at = 100;
    stored.get('oai')!.at = 200;
    await send({ type: 'aiListConsents', requestId: 'l1' });
    expect(posted.at(-1)).toEqual({
      type: 'aiConsents',
      requestId: 'l1',
      consents: [
        { engineId: 'oai', answer: 'allow', at: 200, scope: 'workspace' },
        { engineId: 'claude', answer: 'allow', at: 100, scope: 'workspace' },
      ],
    });
  });

  it('aiForgetConsent removes the answer and answers with the list that remains', async () => {
    const { send, posted, stored } = setup();
    await send({ type: 'aiRequestCloudConsent', requestId: 'c1', engineId: 'claude' });
    await send({ type: 'aiRequestCloudConsent', requestId: 'c2', engineId: 'oai' });
    await send({ type: 'aiForgetConsent', requestId: 'f', engineId: 'claude' });
    expect(stored.has('claude')).toBe(false);
    const reply = posted.at(-1);
    expect(reply).toMatchObject({ type: 'aiConsents', requestId: 'f' });
    expect(reply.consents.map((r: { engineId: string }) => r.engineId)).toEqual(['oai']);
  });

  it('forgetting an engine with no answer is harmless', async () => {
    const { send, posted } = setup();
    await send({ type: 'aiForgetConsent', requestId: 'f', engineId: 'claude' });
    expect(posted.at(-1)).toEqual({ type: 'aiConsents', requestId: 'f', consents: [] });
  });

  it('a store that cannot forget answers aiError instead of aiConsents', async () => {
    const { send, posted } = setup({ forget: async () => { throw new Error('could not write settings'); } });
    await send({ type: 'aiForgetConsent', requestId: 'f', engineId: 'claude' });
    expect(posted.at(-1)).toMatchObject({ type: 'aiError', requestId: 'f' });
    expect(posted.at(-1).message).toContain('could not write settings');
  });

  it('aiRequestCloudConsent carries the three answers as granted values', async () => {
    for (const [answer, granted] of [['allow', true], ['allowOnce', 'once'], ['deny', false]] as const) {
      const { send, posted } = setup({ answer });
      await send({ type: 'aiRequestCloudConsent', requestId: 'c', engineId: 'claude' });
      expect(posted.at(-1), answer).toEqual({ type: 'aiConsent', requestId: 'c', engineId: 'claude', granted });
    }
  });

  it('with Allow cloud off, aiRequestCloudConsent answers a cloudBlocked error and never asks', async () => {
    const { send, posted, askConsent } = setup({ allowCloud: false });
    await send({ type: 'aiRequestCloudConsent', requestId: 'c', engineId: 'claude' });
    expect(posted.at(-1)).toMatchObject({ type: 'aiError', requestId: 'c', code: 'cloudBlocked' });
    expect(askConsent).not.toHaveBeenCalled();
  });

  it('passes the feature and what it sends through to the consent dialog', async () => {
    const { send, askConsent } = setup();
    await send({ type: 'aiRequestCloudConsent', requestId: 'c', engineId: 'claude', feature: 'rewrite', sends: 'document' });
    expect(askConsent).toHaveBeenCalledWith(expect.objectContaining({ id: 'claude' }), 'rewrite', 'document');
  });
});
