/**
 * The AI half of the webview protocol: VsCodeHost's `ai` group correlates
 * replies by requestId and posts aiCancel on abort; the host bridge answers
 * each webview message with the right reply.
 */
import { describe, expect, it, vi } from 'vitest';
import { VsCodeHost } from '../../src/webview/vsCodeHost';
import { handleAiMessage, isAiWebviewMessage } from '../../src/ai/webviewBridge';
import type { AiEngineService } from '../../src/ai/engineService';

function setup() {
  const posted: any[] = [];
  const host = new VsCodeHost({ postMessage: (m) => posted.push(m), getState: () => undefined, setState: () => undefined });
  return { host, posted, ai: host.ai };
}

const request = {
  requestId: 'req-1',
  feature: 'rewrite',
  task: 'rewrite',
  route: { engineId: 'omlx', modelId: 'qwen' },
  messages: [{ role: 'user' as const, content: [{ type: 'image' as const, mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }] }],
};
const served = { engineId: 'omlx', engineName: 'oMLX', modelId: 'qwen', isLocal: true };

describe('VsCodeHost ai group', () => {
  it('posts aiComplete with base64 images, forwards tokens in order, resolves on aiDone', async () => {
    const { host, posted, ai } = setup();
    const tokens: string[] = [];
    const pending = ai.complete(request, (d) => tokens.push(d), new AbortController().signal);
    expect(posted[0]).toMatchObject({ type: 'aiComplete', request: { requestId: 'req-1', messages: [{ content: [{ type: 'image', dataBase64: 'AQID' }] }] } });
    host.handleReply({ type: 'aiToken', requestId: 'other', delta: 'x' });
    host.handleReply({ type: 'aiToken', requestId: 'req-1', delta: 'Hel' });
    host.handleReply({ type: 'aiToken', requestId: 'req-1', delta: 'lo' });
    expect(host.handleReply({ type: 'aiDone', requestId: 'req-1', result: { text: 'Hello', served } })).toBe(true);
    await expect(pending).resolves.toEqual({ text: 'Hello', served });
    expect(tokens).toEqual(['Hel', 'lo']);
  });

  it('rejects with the AiError from aiError', async () => {
    const { host, ai } = setup();
    const pending = ai.complete(request, () => {}, new AbortController().signal);
    host.handleReply({ type: 'aiError', requestId: 'req-1', code: 'auth', message: 'HTTP 401' });
    await expect(pending).rejects.toEqual({ code: 'auth', message: 'HTTP 401' });
  });

  it('abort posts aiCancel and rejects with cancelled; late replies are ignored', async () => {
    const { host, posted, ai } = setup();
    const controller = new AbortController();
    const tokens: string[] = [];
    const pending = ai.complete(request, (d) => tokens.push(d), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(posted[1]).toEqual({ type: 'aiCancel', requestId: 'req-1' });
    host.handleReply({ type: 'aiToken', requestId: 'req-1', delta: 'late' });
    expect(tokens).toEqual([]);
  });

  it('test, discover, setSecret and consent correlate by requestId', async () => {
    const { host, posted, ai } = setup();
    const test = ai.testEngine!('omlx');
    const discover = ai.discoverModels!('omlx');
    const consent = ai.requestCloudConsent!('claude');
    const secret = ai.setSecret!('claude', 'sk');
    const [t, d, c, s] = posted;
    expect([t.type, d.type, c.type, s.type]).toEqual(['aiTestEngine', 'aiDiscoverModels', 'aiRequestCloudConsent', 'aiSetSecret']);
    expect(s).toMatchObject({ engineId: 'claude', apiKey: 'sk' });
    host.handleReply({ type: 'aiEngineStatus', requestId: d.requestId, status: { engineId: 'omlx', ok: true, models: ['d'] } });
    host.handleReply({ type: 'aiEngineStatus', requestId: t.requestId, status: { engineId: 'omlx', ok: true, models: ['t'] } });
    host.handleReply({ type: 'aiConsent', requestId: c.requestId, engineId: 'claude', granted: true });
    host.handleReply({ type: 'aiError', requestId: s.requestId, code: 'unknown', message: 'keychain locked' });
    expect((await test as any).models).toEqual(['t']);
    expect((await discover as any).models).toEqual(['d']);
    expect(await consent).toBe(true);
    await expect(secret).rejects.toMatchObject({ code: 'unknown' });
  });

  it('aiEngines answers every listEngines waiter and reaches push listeners', async () => {
    const { host, posted, ai } = setup();
    const pushed = vi.fn();
    host.onAiEngines(pushed);
    const a = ai.listEngines!();
    const b = ai.listEngines!();
    expect(posted.filter((m) => m.type === 'aiListEngines')).toHaveLength(2);
    host.handleReply({ type: 'aiEngines', engines: [{ engineId: 'omlx' }] });
    expect(await a).toEqual([{ engineId: 'omlx' }]);
    expect(await b).toEqual([{ engineId: 'omlx' }]);
    expect(pushed).toHaveBeenCalledTimes(1);
  });
});

describe('host bridge', () => {
  function fakeService(overrides: Partial<Record<keyof AiEngineService, unknown>> = {}): AiEngineService {
    return {
      complete: async (_panel: object, req: any, onToken: (d: string) => void) => {
        onToken('a');
        onToken('b');
        return { text: 'ab', served, finishReason: 'stop', _images: req.messages[0].content[0].bytes };
      },
      cancel: vi.fn(),
      listEngines: async () => [{ engineId: 'omlx' }],
      testEngine: async (id: string) => ({ engineId: id, ok: true }),
      discoverModels: async (id: string) => ({ engineId: id, ok: true }),
      setSecret: async (id: string, key: string | null) => ({ engineId: id, hasKey: !!key }),
      requestCloudConsent: async () => true,
      ...overrides,
    } as unknown as AiEngineService;
  }

  it('recognises exactly the seven webview messages', () => {
    for (const type of ['aiComplete', 'aiCancel', 'aiListEngines', 'aiTestEngine', 'aiDiscoverModels', 'aiSetSecret', 'aiRequestCloudConsent']) {
      expect(isAiWebviewMessage({ type })).toBe(true);
    }
    expect(isAiWebviewMessage({ type: 'aiToken' })).toBe(false);
    expect(isAiWebviewMessage({ type: 'edit' })).toBe(false);
  });

  it('streams aiToken then aiDone and decodes images', async () => {
    const posted: any[] = [];
    const onServed = vi.fn();
    const wire = { ...request, messages: [{ role: 'user', content: [{ type: 'image', mime: 'image/png', dataBase64: 'AQID' }] }] };
    await handleAiMessage(fakeService(), {}, { type: 'aiComplete', request: wire }, (m) => posted.push(m), { onServed });
    expect(posted.map((m) => m.type)).toEqual(['aiToken', 'aiToken', 'aiDone']);
    expect(posted[2].result._images).toEqual(new Uint8Array([1, 2, 3]));
    expect(onServed).toHaveBeenCalledTimes(1);
  });

  it('a failed completion posts aiError with the code', async () => {
    const posted: any[] = [];
    const service = fakeService({ complete: async () => { throw { code: 'rateLimited', message: 'slow down' }; } });
    const wire = { ...request, messages: [{ role: 'user', content: 'Hi' }] };
    await handleAiMessage(service, {}, { type: 'aiComplete', request: wire }, (m) => posted.push(m));
    expect(posted).toEqual([{ type: 'aiError', requestId: 'req-1', code: 'rateLimited', message: 'slow down' }]);
  });

  it('answers the registry messages', async () => {
    const posted: any[] = [];
    const service = fakeService();
    const post = (m: unknown) => posted.push(m);
    await handleAiMessage(service, {}, { type: 'aiListEngines' }, post);
    await handleAiMessage(service, {}, { type: 'aiTestEngine', requestId: 't', engineId: 'omlx' }, post);
    await handleAiMessage(service, {}, { type: 'aiSetSecret', requestId: 's', engineId: 'claude', apiKey: null }, post);
    await handleAiMessage(service, {}, { type: 'aiRequestCloudConsent', requestId: 'c', engineId: 'claude' }, post);
    await handleAiMessage(service, {}, { type: 'aiCancel', requestId: 'x' }, post);
    expect(posted).toEqual([
      { type: 'aiEngines', engines: [{ engineId: 'omlx' }] },
      { type: 'aiEngineStatus', requestId: 't', status: { engineId: 'omlx', ok: true } },
      { type: 'aiEngineStatus', requestId: 's', status: { engineId: 'claude', hasKey: false } },
      { type: 'aiConsent', requestId: 'c', engineId: 'claude', granted: true },
    ]);
    expect(service.cancel).toHaveBeenCalledWith({}, 'x');
  });
});

describe('status bar label', () => {
  it('names locality, engine and the model label', async () => {
    const { servedLabel } = await import('../../src/ai/statusBar');
    const { parseAiSettings } = await import('@mikedown/core/ai');
    const settings = parseAiSettings({ engines: [{ id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', models: [{ id: 'qwen', label: 'Qwen 3.8 Flash Next' }] }] }, { onWarning: () => {} });
    expect(servedLabel({ served }, settings).text).toBe('$(home) AI: local · oMLX · Qwen 3.8 Flash Next');
    expect(servedLabel({ served: { engineName: 'Anthropic', modelId: 'claude-sonnet-5-5', isLocal: false } }).text).toBe('$(cloud) AI: cloud · Anthropic · claude-sonnet-5-5');
  });
});
