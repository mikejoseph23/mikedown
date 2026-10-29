/**
 * The AI half of the webview protocol: VsCodeHost's `ai` group correlates
 * replies by requestId and posts aiCancel on abort; the host bridge answers
 * each webview message with the right reply.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseAiSettings, thinkingOverrides, type AiThinkingLevel } from '@mikedown/core/ai';
import { VsCodeHost } from '../../src/webview/vsCodeHost';
import { handleAiMessage, isAiWebviewMessage } from '../../src/ai/webviewBridge';
import { AiEngineService } from '../../src/ai/engineService';
import { createAdapters } from '../../src/ai/providers';
import { AiSecrets } from '../../src/ai/secrets';

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
    const consent = ai.requestCloudConsent!('claude', { feature: 'rewrite', sends: 'document' });
    const secret = ai.setSecret!('claude', 'sk');
    const [t, d, c, s] = posted;
    expect([t.type, d.type, c.type, s.type]).toEqual(['aiTestEngine', 'aiDiscoverModels', 'aiRequestCloudConsent', 'aiSetSecret']);
    expect(c).toMatchObject({ engineId: 'claude', feature: 'rewrite', sends: 'document' });
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
    for (const type of ['aiComplete', 'aiCancel', 'aiListEngines', 'aiTestEngine', 'aiDiscoverModels', 'aiSetSecret', 'aiRequestCloudConsent', 'aiListConsents', 'aiForgetConsent']) {
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

  it('consent carries the feature and a known sends scope from the webview to the service', async () => {
    const requestCloudConsent = vi.fn(async () => true);
    const service = fakeService({ requestCloudConsent });
    const posted: any[] = [];
    await handleAiMessage(service, {}, { type: 'aiRequestCloudConsent', requestId: 'c', engineId: 'claude', feature: 'rewrite', sends: 'document' }, (m) => posted.push(m));
    await handleAiMessage(service, {}, { type: 'aiRequestCloudConsent', requestId: 'd', engineId: 'claude', feature: 'summary', sends: 'everything' }, (m) => posted.push(m));
    expect(requestCloudConsent).toHaveBeenNthCalledWith(1, 'claude', 'rewrite', 'document');
    expect(requestCloudConsent).toHaveBeenNthCalledWith(2, 'claude', 'summary', undefined);
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

describe('VsCodeHost ai group, correlation', () => {
  const second = { ...request, requestId: 'req-2' };

  it('two completions in flight each get only their own tokens and result', async () => {
    const { host, ai } = setup();
    const t1: string[] = [];
    const t2: string[] = [];
    const p1 = ai.complete(request, (d) => t1.push(d), new AbortController().signal);
    const p2 = ai.complete(second, (d) => t2.push(d), new AbortController().signal);
    host.handleReply({ type: 'aiToken', requestId: 'req-2', delta: 'B1' });
    host.handleReply({ type: 'aiToken', requestId: 'req-1', delta: 'A1' });
    host.handleReply({ type: 'aiToken', requestId: 'req-2', delta: 'B2' });
    host.handleReply({ type: 'aiToken', requestId: 'req-1', delta: 'A2' });
    host.handleReply({ type: 'aiDone', requestId: 'req-2', result: { text: 'B1B2', served } });
    host.handleReply({ type: 'aiError', requestId: 'req-1', code: 'rateLimited', message: 'slow down' });
    await expect(p2).resolves.toMatchObject({ text: 'B1B2' });
    await expect(p1).rejects.toEqual({ code: 'rateLimited', message: 'slow down' });
    expect(t1).toEqual(['A1', 'A2']);
    expect(t2).toEqual(['B1', 'B2']);
  });

  it('aiDone for an unknown requestId changes nothing', async () => {
    const { host, ai } = setup();
    const pending = ai.complete(request, () => {}, new AbortController().signal);
    host.handleReply({ type: 'aiDone', requestId: 'someone-else', result: { text: 'x', served } });
    host.handleReply({ type: 'aiError', requestId: 'someone-else', code: 'auth', message: 'no' });
    host.handleReply({ type: 'aiDone', requestId: 'req-1', result: { text: 'mine', served } });
    await expect(pending).resolves.toMatchObject({ text: 'mine' });
  });

  it('a reply after aiDone is ignored (the waiter is gone)', async () => {
    const { host, ai } = setup();
    const tokens: string[] = [];
    const pending = ai.complete(request, (d) => tokens.push(d), new AbortController().signal);
    host.handleReply({ type: 'aiDone', requestId: 'req-1', result: { text: 'ok', served } });
    await pending;
    host.handleReply({ type: 'aiToken', requestId: 'req-1', delta: 'late' });
    host.handleReply({ type: 'aiError', requestId: 'req-1', code: 'unknown', message: 'late' });
    expect(tokens).toEqual([]);
  });

  it('aiError keeps unknown codes as unknown and defaults a missing message', async () => {
    const { host, ai } = setup();
    const pending = ai.complete(request, () => {}, new AbortController().signal);
    host.handleReply({ type: 'aiError', requestId: 'req-1', code: 'not-a-real-code' });
    await expect(pending).rejects.toMatchObject({ code: 'unknown' });
  });

  it('every ai reply type is claimed by handleReply', () => {
    const { host } = setup();
    for (const type of ['aiToken', 'aiDone', 'aiError', 'aiEngineStatus', 'aiConsent', 'aiConsents', 'aiEngines']) {
      expect(host.handleReply({ type, requestId: 'none', engines: [] })).toBe(true);
    }
  });
});

describe('VsCodeHost ai group, cancellation', () => {
  it('an already-aborted signal rejects cancelled without posting anything', async () => {
    const { posted, ai } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(ai.complete(request, () => {}, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(posted).toEqual([]);
  });

  it('aborting one request cancels only that one', async () => {
    const { host, posted, ai } = setup();
    const a = new AbortController();
    const t2: string[] = [];
    const p1 = ai.complete(request, () => {}, a.signal);
    const p2 = ai.complete({ ...request, requestId: 'req-2' }, (d) => t2.push(d), new AbortController().signal);
    a.abort();
    await expect(p1).rejects.toMatchObject({ code: 'cancelled' });
    expect(posted.filter((m) => m.type === 'aiCancel')).toEqual([{ type: 'aiCancel', requestId: 'req-1' }]);
    host.handleReply({ type: 'aiToken', requestId: 'req-2', delta: 'still here' });
    host.handleReply({ type: 'aiDone', requestId: 'req-2', result: { text: 'still here', served } });
    await expect(p2).resolves.toMatchObject({ text: 'still here' });
    expect(t2).toEqual(['still here']);
  });

  it('aborting after the answer arrived posts nothing', async () => {
    const { host, posted, ai } = setup();
    const controller = new AbortController();
    const pending = ai.complete(request, () => {}, controller.signal);
    host.handleReply({ type: 'aiDone', requestId: 'req-1', result: { text: 'ok', served } });
    await pending;
    controller.abort();
    expect(posted.filter((m) => m.type === 'aiCancel')).toEqual([]);
  });

  it('a throwing postMessage rejects the request instead of hanging it', async () => {
    const host = new VsCodeHost({ postMessage: () => { throw new Error('webview disposed'); }, getState: () => undefined, setState: () => undefined });
    await expect(host.ai.complete(request, () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'unknown' });
  });
});

describe('host bridge, errors and ordering', () => {
  const wire = { ...request, messages: [{ role: 'user', content: 'Hi' }] };

  it('tokens are posted in the order the service produced them, before aiDone', async () => {
    const posted: any[] = [];
    const service = {
      complete: async (_p: object, _r: unknown, onToken: (d: string) => void) => {
        for (const d of ['1', '2', '3']) {onToken(d);}
        return { text: '123', served, finishReason: 'stop' };
      },
    } as unknown as AiEngineService;
    await handleAiMessage(service, {}, { type: 'aiComplete', request: wire }, (m) => posted.push(m));
    expect(posted.map((m) => (m.type === 'aiToken' ? m.delta : m.type))).toEqual(['1', '2', '3', 'aiDone']);
    expect(posted.every((m) => m.requestId === 'req-1')).toBe(true);
  });

  it('a cancelled completion answers aiError cancelled', async () => {
    const posted: any[] = [];
    const service = { complete: async () => { throw { code: 'cancelled', message: 'Cancelled.' }; } } as unknown as AiEngineService;
    await handleAiMessage(service, {}, { type: 'aiComplete', request: wire }, (m) => posted.push(m));
    expect(posted).toEqual([{ type: 'aiError', requestId: 'req-1', code: 'cancelled', message: 'Cancelled.' }]);
  });

  it('a plain Error from the service becomes aiError unknown', async () => {
    const posted: any[] = [];
    const service = { complete: async () => { throw new Error('boom'); } } as unknown as AiEngineService;
    await handleAiMessage(service, {}, { type: 'aiComplete', request: wire }, (m) => posted.push(m));
    expect(posted).toEqual([{ type: 'aiError', requestId: 'req-1', code: 'unknown', message: expect.stringContaining('boom') }]);
  });

  it('a failing test, discover, setSecret or consent request answers aiError with the same requestId', async () => {
    const posted: any[] = [];
    const fail = async () => { throw { code: 'unknown', message: 'That engine is no longer in the AI settings.' }; };
    const service = { testEngine: fail, discoverModels: fail, setSecret: fail, requestCloudConsent: fail } as unknown as AiEngineService;
    const post = (m: unknown) => posted.push(m);
    await handleAiMessage(service, {}, { type: 'aiTestEngine', requestId: 't', engineId: 'x' }, post);
    await handleAiMessage(service, {}, { type: 'aiDiscoverModels', requestId: 'd', engineId: 'x' }, post);
    await handleAiMessage(service, {}, { type: 'aiSetSecret', requestId: 's', engineId: 'x', apiKey: 'k' }, post);
    await handleAiMessage(service, {}, { type: 'aiRequestCloudConsent', requestId: 'c', engineId: 'x' }, post);
    expect(posted).toEqual([
      { type: 'aiError', requestId: 't', code: 'unknown', message: 'That engine is no longer in the AI settings.' },
      { type: 'aiError', requestId: 'd', code: 'unknown', message: 'That engine is no longer in the AI settings.' },
      { type: 'aiError', requestId: 's', code: 'unknown', message: 'That engine is no longer in the AI settings.' },
      { type: 'aiError', requestId: 'c', code: 'unknown', message: 'That engine is no longer in the AI settings.' },
    ]);
  });

  it('consent: never reaches the webview as "never", cloudBlocked as an error, and the list and forget messages answer aiConsents', async () => {
    const posted: any[] = [];
    const records = [{ engineId: 'claude', answer: 'allow', at: 1, scope: 'workspace' }];
    const forgetConsent = vi.fn(async () => {});
    const requestCloudConsent = vi.fn()
      .mockResolvedValueOnce('never')
      .mockRejectedValueOnce({ code: 'cloudBlocked', message: 'Allow cloud is off.' });
    const service = { requestCloudConsent, listConsents: () => records, forgetConsent } as unknown as AiEngineService;
    const post = (m: unknown) => posted.push(m);
    await handleAiMessage(service, {}, { type: 'aiRequestCloudConsent', requestId: 'c1', engineId: 'claude' }, post);
    await handleAiMessage(service, {}, { type: 'aiRequestCloudConsent', requestId: 'c2', engineId: 'claude' }, post);
    await handleAiMessage(service, {}, { type: 'aiListConsents', requestId: 'l' }, post);
    await handleAiMessage(service, {}, { type: 'aiForgetConsent', requestId: 'f', engineId: 'claude' }, post);
    expect(forgetConsent).toHaveBeenCalledWith('claude');
    expect(posted).toEqual([
      { type: 'aiConsent', requestId: 'c1', engineId: 'claude', granted: 'never' },
      { type: 'aiError', requestId: 'c2', code: 'cloudBlocked', message: 'Allow cloud is off.' },
      { type: 'aiConsents', requestId: 'l', consents: records },
      { type: 'aiConsents', requestId: 'f', consents: records },
    ]);
  });

  it('the webview host resolves the consent replies', async () => {
    const { host, posted, ai } = setup();
    const never = ai.requestCloudConsent!('claude');
    const list = ai.listConsents!();
    const forget = ai.forgetConsent!('claude');
    const [n, l, f] = posted.slice(-3);
    expect([n.type, l.type, f.type]).toEqual(['aiRequestCloudConsent', 'aiListConsents', 'aiForgetConsent']);
    expect(f.engineId).toBe('claude');
    host.handleReply({ type: 'aiConsent', requestId: n.requestId, engineId: 'claude', granted: 'never' });
    host.handleReply({ type: 'aiConsents', requestId: l.requestId, consents: [{ engineId: 'claude', answer: 'never', at: 1, scope: 'workspace' }] });
    host.handleReply({ type: 'aiConsents', requestId: f.requestId, consents: [] });
    expect(await never).toBe('never');
    expect(await list).toEqual([{ engineId: 'claude', answer: 'never', at: 1, scope: 'workspace' }]);
    await expect(forget).resolves.toBeUndefined();
    const once = ai.requestCloudConsent!('claude');
    const denied = ai.requestCloudConsent!('claude');
    const [o, d] = posted.slice(-2);
    host.handleReply({ type: 'aiConsent', requestId: o.requestId, engineId: 'claude', granted: 'once' });
    host.handleReply({ type: 'aiConsent', requestId: d.requestId, engineId: 'claude', granted: false });
    expect(await once).toBe('once');
    expect(await denied).toBe(false);
  });

  it('a malformed aiComplete answers aiError instead of calling the service', async () => {
    const posted: any[] = [];
    const complete = vi.fn();
    const service = { complete } as unknown as AiEngineService;
    await handleAiMessage(service, {}, { type: 'aiComplete', request: { requestId: 'bad' } }, (m) => posted.push(m));
    expect(complete).not.toHaveBeenCalled();
    expect(posted).toMatchObject([{ type: 'aiError', requestId: 'bad', code: 'unknown' }]);
  });

  it('the API key never travels back in a reply', async () => {
    const posted: any[] = [];
    const service = { setSecret: async (id: string) => ({ engineId: id, hasKey: true }) } as unknown as AiEngineService;
    await handleAiMessage(service, {}, { type: 'aiSetSecret', requestId: 's', engineId: 'claude', apiKey: 'sk-ant-secret' }, (m) => posted.push(m));
    expect(JSON.stringify(posted)).not.toContain('sk-ant-secret');
  });
});

describe('per-request requestOverrides (thinking dial), end to end', () => {
  interface ThinkingCase {
    name: string;
    kind: 'openai-compatible' | 'lmstudio' | 'ollama' | 'anthropic' | 'openai';
    local: boolean;
    level: AiThinkingLevel;
    modelOverrides: Record<string, unknown> | null;
    requestOverrides: Record<string, unknown>;
    expectedBody: Record<string, unknown>;
  }
  const fixture = JSON.parse(readFileSync(join(__dirname, '../ai-fixtures/requests/thinking-overrides.json'), 'utf8')) as { cases: ThinkingCase[] };
  const stream = (kind: string): string[] => JSON.parse(readFileSync(join(__dirname, '../ai-fixtures/sse', kind === 'anthropic' ? 'anthropic-messages-stream.json' : 'openai-chat-stream.json'), 'utf8')).chunks;
  const BASES: Record<ThinkingCase['kind'], [local: string, cloud: string]> = {
    'openai-compatible': ['http://127.0.0.1:8000/v1', 'https://generativelanguage.googleapis.com/v1beta/openai'],
    lmstudio: ['http://127.0.0.1:1234/v1', 'http://127.0.0.1:1234/v1'],
    ollama: ['http://127.0.0.1:11434/v1', 'http://127.0.0.1:11434/v1'],
    anthropic: ['https://api.anthropic.com', 'https://api.anthropic.com'],
    openai: ['https://api.openai.com/v1', 'https://api.openai.com/v1'],
  };

  /** The webview's VsCodeHost posts aiComplete; the bridge hands it to a real AiEngineService and adapter; returns the posted body. */
  async function bodyFor(c: ThinkingCase, requestOverrides: Record<string, unknown> | undefined): Promise<Record<string, unknown>> {
    const settings = parseAiSettings({
      enabled: true,
      allowCloud: true,
      engines: [{ id: 'e', name: 'Engine', kind: c.kind, baseUrl: BASES[c.kind][c.local ? 0 : 1], apiKeyEnv: 'K', models: [{ id: 'm', ...(c.modelOverrides ? { requestOverrides: c.modelOverrides } : {}) }] }],
      routing: { default: { engineId: 'e', modelId: 'm' }, fallback: 'none', tasks: {} },
    }, { onWarning: () => {} });
    const bodies: Array<Record<string, unknown>> = [];
    const chunks = stream(c.kind);
    const fetch = async (_url: string, init?: RequestInit): Promise<Response> => {
      bodies.push(JSON.parse(String(init?.body)));
      const enc = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({ start(ctl) { for (const ch of chunks) {ctl.enqueue(enc.encode(ch));} ctl.close(); } }), { status: 200 });
    };
    const store = new Map<string, string>();
    const service = new AiEngineService({
      readSettings: () => settings,
      secrets: new AiSecrets({ get: async (k) => store.get(k), store: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } }, { K: 'k' }),
      consent: { get: () => undefined, set: async () => {}, forget: async () => {}, ids: () => [] },
      askConsent: async () => 'allow' as const,
      saveEngines: async () => {},
      log: () => {},
      adapters: createAdapters({ fetch }),
    });
    const { host, posted, ai } = setup();
    const pending = ai.complete({ ...request, route: { engineId: 'e', modelId: 'm' }, messages: [{ role: 'user', content: 'hi' }], ...(requestOverrides ? { requestOverrides } : {}) }, () => {}, new AbortController().signal);
    await handleAiMessage(service, {}, posted[0], (reply) => host.handleReply(reply as never));
    await pending;
    expect(bodies).toHaveLength(1);
    return bodies[0];
  }

  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s: the request wins over the model', async (_name, c) => {
    const body = await bodyFor(c, c.requestOverrides);
    for (const [key, value] of Object.entries(c.expectedBody)) {expect(body[key], key).toEqual(value);}
    // Acceptance: the body's thinking fields are the level's.
    expect(body).toMatchObject(thinkingOverrides(c.kind, c.level, { local: c.local }));
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s: without a thinking level the body is the model\'s alone', async (_name, c) => {
    const plain = await bodyFor(c, undefined);
    // An empty object changes nothing either.
    expect(await bodyFor(c, {})).toEqual(plain);
    // Nothing the request would have added is there unless the model set it.
    const own = c.modelOverrides ?? {};
    for (const key of Object.keys(c.requestOverrides)) {
      if (key in own) {expect(plain[key], key).toEqual(own[key]);}
      else {expect(plain, key).not.toHaveProperty(key);}
    }
  });

  it('without requestOverrides the model\'s own still apply', async () => {
    const c = fixture.cases.find((x) => x.kind === 'openai' && x.modelOverrides)!;
    expect(await bodyFor(c, undefined)).toMatchObject(c.modelOverrides!);
  });
});
