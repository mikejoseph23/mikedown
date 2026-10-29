/**
 * The setup wizard's messages through the webview bridge against a real
 * AiEngineService with a fake network (the consent messages are in
 * ai-consent-bridge.test.ts, the rest of the protocol in ai-protocol.test.ts):
 * aiDetectLocalServers answers aiEngineProbes for every candidate in order,
 * survives malformed input, and a failing service reaches the webview as
 * aiError with the request id.
 */
import { describe, expect, it, vi } from 'vitest';
import { parseAiSettings } from '@mikedown/core/ai';
import { AiEngineService } from '../../src/ai/engineService';
import { AiSecrets } from '../../src/ai/secrets';
import { AI_WEBVIEW_MESSAGE_TYPES, handleAiMessage, isAiWebviewMessage } from '../../src/ai/webviewBridge';

const LMS = { presetId: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1' };
const OLLAMA = { presetId: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' };

function setup(fetchBy: Record<string, () => Response> = {}) {
  const fetch = vi.fn(async (url: string) => {
    const route = fetchBy[url];
    if (!route) {throw new TypeError('fetch failed');}
    return route();
  });
  const settings = parseAiSettings({ enabled: true, engines: [] }, { onWarning: () => {} });
  const service = new AiEngineService({
    readSettings: () => settings,
    secrets: new AiSecrets({ get: async () => undefined, store: async () => {}, delete: async () => {} }, {}, () => '/nonexistent-home'),
    consent: { get: () => undefined, set: async () => {}, forget: async () => {}, ids: () => [] },
    askConsent: async () => 'notNow',
    saveEngines: async () => {},
    log: () => {},
    adapters: new Map(),
    fetch,
    readHardware: () => ({ arch: 'arm64', platform: 'darwin', totalMemoryBytes: 32 * 1024 ** 3, appleSilicon: true }),
  });
  const posted: Array<Record<string, any>> = [];
  const send = (message: Record<string, unknown>) => handleAiMessage(service, {}, message as never, (m) => posted.push(m as Record<string, any>));
  return { service, fetch, posted, send };
}

const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });

describe('aiDetectLocalServers through the bridge', () => {
  it('is one of the messages the bridge claims', () => {
    expect(AI_WEBVIEW_MESSAGE_TYPES.has('aiDetectLocalServers')).toBe(true);
    expect(isAiWebviewMessage({ type: 'aiDetectLocalServers', requestId: 'x' })).toBe(true);
    expect(isAiWebviewMessage({ type: 'aiDetectLocalServer' })).toBe(false);
    expect(isAiWebviewMessage(null)).toBe(false);
  });

  it('answers aiEngineProbes with the request id and one probe per candidate, in order', async () => {
    const { send, posted } = setup({
      'http://127.0.0.1:1234/api/v0/models': ok({ data: [{ id: 'a' }, { id: 'b' }] }),
    });
    await send({ type: 'aiDetectLocalServers', requestId: 'd1', candidates: [OLLAMA, LMS] });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: 'aiEngineProbes', requestId: 'd1' });
    expect(posted[0].probes).toHaveLength(2);
    expect(posted[0].probes[0]).toEqual({ ...OLLAMA, ok: false });
    expect(posted[0].probes[1]).toMatchObject({ ...LMS, ok: true, models: 2 });
  });

  it('keeps two overlapping requests apart by their ids', async () => {
    const { send, posted } = setup({ 'http://127.0.0.1:1234/api/v0/models': ok({ data: [] }) });
    await Promise.all([
      send({ type: 'aiDetectLocalServers', requestId: 'one', candidates: [LMS] }),
      send({ type: 'aiDetectLocalServers', requestId: 'two', candidates: [OLLAMA] }),
    ]);
    const byId = Object.fromEntries(posted.map((m) => [m.requestId, m.probes[0].presetId]));
    expect(byId).toEqual({ one: 'lmstudio', two: 'ollama' });
  });

  it('answers an empty list, still with the id, when candidates is missing or not an array', async () => {
    const { send, posted, fetch } = setup();
    await send({ type: 'aiDetectLocalServers', requestId: 'a' });
    await send({ type: 'aiDetectLocalServers', requestId: 'b', candidates: 'lmstudio' });
    await send({ type: 'aiDetectLocalServers', requestId: 'c', candidates: { presetId: 'lmstudio' } });
    expect(posted).toEqual([
      { type: 'aiEngineProbes', requestId: 'a', probes: [] },
      { type: 'aiEngineProbes', requestId: 'b', probes: [] },
      { type: 'aiEngineProbes', requestId: 'c', probes: [] },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers a failed probe for every malformed candidate and makes no request for it', async () => {
    const { send, posted, fetch } = setup();
    await send({
      type: 'aiDetectLocalServers',
      requestId: 'm',
      candidates: [null, 7, 'lmstudio', {}, { presetId: 'anthropic', baseUrl: 'https://api.anthropic.com' }, { presetId: 'ollama', baseUrl: 'ftp://127.0.0.1/' }, { presetId: 5, baseUrl: {} }],
    });
    expect(posted[0].type).toBe('aiEngineProbes');
    expect(posted[0].probes).toHaveLength(7);
    expect(posted[0].probes.every((p: { ok: boolean }) => p.ok === false)).toBe(true);
    expect(posted[0].probes.every((p: { presetId: unknown; baseUrl: unknown }) => typeof p.presetId === 'string' && typeof p.baseUrl === 'string')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a message with no request id is answered with an empty one, not dropped', async () => {
    const { send, posted } = setup();
    await send({ type: 'aiDetectLocalServers', candidates: [] });
    expect(posted).toEqual([{ type: 'aiEngineProbes', requestId: '', probes: [] }]);
  });

  it('a service that throws reaches the webview as aiError with the request id', async () => {
    const { send, posted, service } = setup();
    vi.spyOn(service, 'detectLocalServers').mockRejectedValue(new Error('boom'));
    await send({ type: 'aiDetectLocalServers', requestId: 'e1', candidates: [LMS] });
    expect(posted).toEqual([{ type: 'aiError', requestId: 'e1', code: 'unknown', message: 'boom' }]);
  });
});

describe('the other setup messages through the bridge', () => {
  it('aiHardwareInfo answers aiHardware with the host\'s memory and Apple Silicon flag', async () => {
    const { send, posted } = setup();
    await send({ type: 'aiHardwareInfo', requestId: 'h1' });
    expect(posted).toEqual([{ type: 'aiHardware', requestId: 'h1', info: { arch: 'arm64', platform: 'darwin', totalMemoryBytes: 32 * 1024 ** 3, appleSilicon: true } }]);
  });

  it('aiHardwareInfo answers info: null when the hardware cannot be read, rather than nothing', async () => {
    const { send, posted, service } = setup();
    vi.spyOn(service, 'hardwareInfo').mockReturnValue(null);
    await send({ type: 'aiHardwareInfo', requestId: 'h2' });
    expect(posted).toEqual([{ type: 'aiHardware', requestId: 'h2', info: null }]);
  });

  it('aiDetectHostEngines answers an empty list where the host has no built-in models', async () => {
    const { send, posted } = setup();
    await send({ type: 'aiDetectHostEngines', requestId: 'p1' });
    expect(posted).toEqual([{ type: 'aiHostEngines', requestId: 'p1', probes: [] }]);
  });

  it('aiDetectHostEngines failing is an aiError with the id', async () => {
    const { send, posted, service } = setup();
    vi.spyOn(service, 'detectHostEngines').mockRejectedValue(new Error('no lm api'));
    await send({ type: 'aiDetectHostEngines', requestId: 'p2' });
    expect(posted[0]).toMatchObject({ type: 'aiError', requestId: 'p2', message: 'no lm api' });
  });
});
