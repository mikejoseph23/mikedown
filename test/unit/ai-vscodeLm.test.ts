/**
 * The `vscode-lm` adapter (GitHub Copilot through `vscode.lm`) against a fake
 * `vscode` API, VS Code's hardware read, and the engine service's setup
 * wizard methods (host engines, hardware) through the webview bridge.
 */
import { describe, expect, it, vi } from 'vitest';
import { parseAiSettings, type AiEngineConfig, type AiModelConfig } from '@mikedown/core/ai';
import { AiEngineService } from '../../src/ai/engineService';
import { hardwareLogLine, readHardwareInfo } from '../../src/ai/hardware';
import { createAdapters } from '../../src/ai/providers';
import { createVsCodeLmAdapter, vscodeLmError, type VsCodeLmApi, type VsCodeLmModel } from '../../src/ai/providers/vscodeLm';
import { AiSecrets } from '../../src/ai/secrets';
import { handleAiMessage, isAiWebviewMessage } from '../../src/ai/webviewBridge';

function lmModel(family: string, opts: { chunks?: string[]; fail?: unknown; seen?: unknown[][] } = {}): VsCodeLmModel {
  return {
    id: `opaque-${family}`,
    name: family.toUpperCase(),
    vendor: 'copilot',
    family,
    maxInputTokens: 64000,
    sendRequest: async (messages) => {
      opts.seen?.push(messages);
      if (opts.fail) {throw opts.fail;}
      return {
        text: (async function* () {
          for (const c of opts.chunks ?? ['Hel', 'lo']) {yield c;}
        })(),
      };
    },
  };
}

function fakeApi(models: VsCodeLmModel[]): VsCodeLmApi & { cancelled: number } {
  const api = {
    cancelled: 0,
    selectChatModels: async (selector: { vendor?: string; family?: string }) =>
      models.filter((m) => (!selector.vendor || m.vendor === selector.vendor) && (!selector.family || m.family === selector.family)),
    userMessage: (text: string) => ({ role: 'user', text }),
    assistantMessage: (text: string) => ({ role: 'assistant', text }),
    tokenSource: () => ({ token: {}, cancel: () => { api.cancelled++; }, dispose: () => {} }),
  };
  return api;
}

const engine: AiEngineConfig = { id: 'cp', name: 'GitHub Copilot', kind: 'vscode-lm', baseUrl: '', enabled: true, locality: 'auto', discovery: 'auto', models: [] };
const model: AiModelConfig = { id: 'copilot/gpt-4o', enabled: true, capabilities: { chat: true, stream: true, vision: false, json: false, tools: false, fim: false, embed: false, contextTokens: 64000 }, capabilitiesSource: 'endpoint' };
const request = { requestId: 'r1', feature: 'rewrite', task: 'rewrite', messages: [{ role: 'system' as const, content: 'Be brief.' }, { role: 'user' as const, content: 'Fix this.' }] };

describe('vscode-lm adapter', () => {
  it('lists Copilot models as vendor/family with their context window', async () => {
    const adapter = createVsCodeLmAdapter(fakeApi([lmModel('gpt-4o'), lmModel('gpt-4o'), lmModel('claude-sonnet-4')]));
    const models = await adapter.listModels(engine, null, new AbortController().signal);
    expect(models.map((m) => m.id)).toEqual(['copilot/gpt-4o', 'copilot/claude-sonnet-4']);
    expect(models[0]).toMatchObject({ label: 'GPT-4O', source: 'endpoint', capabilities: { chat: true, stream: true, contextTokens: 64000 } });
    expect(await adapter.probe(engine, null, new AbortController().signal)).toMatchObject({ ok: true });
  });

  it('probes false and lists nothing when Copilot has no models', async () => {
    const adapter = createVsCodeLmAdapter(fakeApi([]));
    expect(await adapter.probe(engine, null, new AbortController().signal)).toMatchObject({ ok: false, error: { code: 'unreachable' } });
    await expect(adapter.listModels(engine, null, new AbortController().signal)).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('streams text parts, sending the system prompt as a user message', async () => {
    const seen: unknown[][] = [];
    const adapter = createVsCodeLmAdapter(fakeApi([lmModel('gpt-4o', { seen })]));
    const tokens: string[] = [];
    const result = await adapter.complete(engine, null, model, request, (d) => tokens.push(d), new AbortController().signal);
    expect(tokens).toEqual(['Hel', 'lo']);
    expect(result).toMatchObject({ text: 'Hello', finishReason: 'stop', served: { modelId: 'copilot/gpt-4o', isLocal: false } });
    expect(seen[0]).toEqual([{ role: 'user', text: 'Be brief.' }, { role: 'user', text: 'Fix this.' }]);
  });

  it('cancels the token source on abort', async () => {
    const api = fakeApi([lmModel('gpt-4o')]);
    const adapter = createVsCodeLmAdapter(api);
    const controller = new AbortController();
    const run = adapter.complete(engine, null, model, request, () => controller.abort(), controller.signal);
    await expect(run).rejects.toMatchObject({ code: 'cancelled' });
    expect(api.cancelled).toBe(1);
  });

  it('maps vscode.lm errors', async () => {
    expect(vscodeLmError({ code: 'NoPermissions', message: 'x' })).toEqual({ code: 'auth', message: 'Allow MikeDown to use Copilot in the VS Code prompt.' });
    expect(vscodeLmError({ code: 'Blocked', message: 'Blocked by policy' }).code).toBe('badOutput');
    expect(vscodeLmError({ code: 'Blocked', message: 'You have exceeded your quota' }).code).toBe('rateLimited');
    expect(vscodeLmError({ code: 'NotFound', message: 'gone' }).code).toBe('modelNotFound');
    expect(vscodeLmError(new Error('boom')).code).toBe('unknown');
    const adapter = createVsCodeLmAdapter(fakeApi([lmModel('gpt-4o', { fail: { code: 'NoPermissions', message: 'denied' } })]));
    await expect(adapter.complete(engine, null, model, request, () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'auth' });
    await expect(adapter.complete(engine, null, { ...model, id: 'copilot/gone' }, request, () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'modelNotFound' });
  });

  it('is only registered when the vscode API is passed in', () => {
    expect(createAdapters().has('vscode-lm')).toBe(false);
    expect(createAdapters({ vscodeLm: fakeApi([]) }).has('vscode-lm')).toBe(true);
  });
});

describe('hardware', () => {
  it('reads memory, CPU and Apple Silicon from os and process', () => {
    const info = readHardwareInfo({
      os: { totalmem: () => 32 * 1024 ** 3, cpus: () => [{ model: ' Apple M2 Max ' }] as ReturnType<typeof import('os').cpus> },
      process: { arch: 'arm64', platform: 'darwin' },
    });
    expect(info).toMatchObject({ arch: 'arm64', platform: 'darwin', totalMemoryBytes: 32 * 1024 ** 3, appleSilicon: true, cpu: 'Apple M2 Max', gpu: { vendor: 'apple' } });
    expect(hardwareLogLine(info)).toBe('Hardware: darwin arm64, Apple M2 Max, 32 GB, Apple Silicon');
    const pc = readHardwareInfo({ os: { totalmem: () => 16 * 1024 ** 3, cpus: () => [] }, process: { arch: 'x64', platform: 'win32' } });
    expect(pc.appleSilicon).toBe(false);
    expect(pc.gpu).toBeUndefined();
  });
});

describe('engine service: setup wizard methods', () => {
  function service(models: VsCodeLmModel[]) {
    const log: string[] = [];
    const readHardware = vi.fn(() => readHardwareInfo({ os: { totalmem: () => 16 * 1024 ** 3, cpus: () => [] }, process: { arch: 'x64', platform: 'linux' } }));
    const settings = parseAiSettings({ engines: [engine] }, { onWarning: () => {} });
    const svc = new AiEngineService({
      readSettings: () => settings,
      secrets: new AiSecrets({ get: async () => undefined, store: async () => {}, delete: async () => {} }, {}),
      consent: { get: () => undefined, set: async () => {}, forget: async () => {}, ids: () => [] },
      askConsent: async () => 'notNow',
      saveEngines: async () => {},
      log: (l) => log.push(l),
      adapters: createAdapters({ vscodeLm: fakeApi(models) }),
      readHardware,
    });
    return { svc, log, readHardware };
  }

  it('answers aiDetectHostEngines and aiHardwareInfo, reading the hardware once', async () => {
    const { svc, log, readHardware } = service([lmModel('gpt-4o')]);
    const posted: Array<Record<string, unknown>> = [];
    const post = (m: unknown) => posted.push(m as Record<string, unknown>);
    expect(isAiWebviewMessage({ type: 'aiDetectHostEngines' })).toBe(true);
    await handleAiMessage(svc, {}, { type: 'aiDetectHostEngines', requestId: 'a' }, post);
    expect(posted[0]).toEqual({ type: 'aiHostEngines', requestId: 'a', probes: [{ presetId: 'vscodelm', kind: 'vscode-lm', ok: true, models: 1 }] });
    await handleAiMessage(svc, {}, { type: 'aiHardwareInfo', requestId: 'b' }, post);
    await handleAiMessage(svc, {}, { type: 'aiHardwareInfo', requestId: 'c' }, post);
    expect(posted[1]).toMatchObject({ type: 'aiHardware', requestId: 'b', info: { platform: 'linux', totalMemoryBytes: 16 * 1024 ** 3 } });
    expect(readHardware).toHaveBeenCalledTimes(1);
    expect(log.filter((l) => l.startsWith('Hardware:'))).toHaveLength(1);
  });

  it('probes a vscode-lm engine in listEngines (it only lists models) and reports no models when signed out', async () => {
    const { svc } = service([lmModel('gpt-4o')]);
    const [status] = await svc.listEngines();
    expect(status).toMatchObject({ engineId: 'cp', ok: true, isLocal: false });
    const none = service([]);
    expect((await none.svc.detectHostEngines())[0]).toMatchObject({ ok: false, models: 0 });
  });
});
