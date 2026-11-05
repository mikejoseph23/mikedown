/**
 * "Allow once" across a chat turn on VS Code, through everything real: the loop,
 * `runAiCompletion`, VsCodeHost, the bridge and AiEngineService. Only the
 * provider adapter and the consent modal are fakes. Desktop's twin of these
 * cases is at the end of commands/ai/tests/command_layer.rs; the two answer the same.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  AI_TURN_GRANT_MAX_USES,
  aiConsentText,
  parseAiSettings,
  runDocsTurn,
  type AiCompletionRequest,
  type AiEngineConfig,
  type AiEngineKind,
  type AiSendsScope,
  type AiSettings,
  type DocsTurnOutcome,
  type ProviderAdapter,
} from '@mikedown/core/ai';
import { AiEngineService, type ConsentDialogAnswer, type StoredConsent } from '../../src/ai/engineService';
import { handleAiMessage, isAiWebviewMessage } from '../../src/ai/webviewBridge';
import { AiSecrets } from '../../src/ai/secrets';
import { VsCodeHost } from '../../src/webview/vsCodeHost';
import { aiDocsLoopDeps } from '../../packages/core/src/ai-docs-run';
import type { AiRunContext } from '../../packages/core/src/ai-request';
import { fakeDocs, nav, simple } from '../../packages/core/test/helpers/ai-docs-fakes';

const CHAT = { chat: true, stream: true, vision: false, json: true, tools: false, fim: false, embed: false, contextTokens: 32768 };
const raw = {
  enabled: true,
  allowCloud: true,
  engines: [
    { id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', models: [{ id: 'qwen', capabilities: CHAT, capabilitiesSource: 'user' }] },
    { id: 'claude', name: 'Cloud', kind: 'anthropic', baseUrl: 'https://api.example.com', models: [{ id: 'sonnet', capabilities: CHAT, capabilitiesSource: 'user' }] },
    { id: 'other', name: 'Other', kind: 'anthropic', baseUrl: 'https://other.example.com', models: [{ id: 'm', capabilities: CHAT, capabilitiesSource: 'user' }] },
  ],
  docBases: [
    { id: 'b', name: 'Handbook', roots: ['/r/b'], allowCloud: true, enabled: true },
    { id: 'c', name: 'Runbook', roots: ['/r/c'], allowCloud: true, enabled: true },
  ],
  routing: { default: { engineId: 'claude', modelId: 'sonnet' }, fallback: 'none', tasks: {} },
};
const parse = (over: Record<string, unknown> = {}): AiSettings => parseAiSettings({ ...raw, ...over }, { onWarning: () => {} });
const toLocal = { routing: { default: { engineId: 'omlx', modelId: 'qwen' }, fallback: 'none', tasks: {} } };

/** A real service and a real webview host, joined the way postMessage joins them. */
function setup(opts: { answer?: ConsentDialogAnswer; navScript?: Array<string | (() => string)>; settings?: AiSettings } = {}) {
  let hostSettings = opts.settings ?? parse();
  let webviewSettings = hostSettings;
  const sent: AiCompletionRequest[] = [];
  const failNext = { error: null as unknown };
  const script = opts.navScript ?? [nav(['docs/security.md#audit']), nav(['docs/ops.md#backups']), nav([], true)];
  let step = 0;
  const adapter = (kind: AiEngineKind): ProviderAdapter => ({
    kind,
    listModels: async () => [],
    probe: async () => ({ ok: true, latencyMs: 1 }),
    complete: async (engine, _key, model, req, onToken) => {
      if (failNext.error) {
        const e = failNext.error;
        failNext.error = null;
        throw e;
      }
      sent.push(req);
      const scripted = script[Math.min(step, script.length - 1)];
      const text = req.format === 'json' ? (step++, typeof scripted === 'function' ? scripted() : scripted) : 'the answer [1]';
      onToken(text);
      return { text, served: { engineId: engine.id, engineName: engine.name, modelId: model.id, isLocal: false }, finishReason: 'stop' };
    },
  });
  const stored = new Map<string, StoredConsent>();
  const dialogs: Array<{ engineId: string; feature?: string; sends?: AiSendsScope; baseNames?: string[] }> = [];
  const answer = { next: opts.answer ?? ('allowOnce' as ConsentDialogAnswer) };
  const askConsent = vi.fn(async (engine: AiEngineConfig, feature?: string, sends?: AiSendsScope, baseNames?: string[]): Promise<ConsentDialogAnswer> => {
    dialogs.push({ engineId: engine.id, feature, sends, baseNames });
    return answer.next;
  });
  const service = new AiEngineService({
    readSettings: () => hostSettings,
    secrets: new AiSecrets({ get: async () => undefined, store: async () => {}, delete: async () => {} }, {}),
    consent: { get: (id) => stored.get(id), set: async (id, r) => { stored.set(id, r); }, forget: async (id) => { stored.delete(id); }, ids: () => [...stored.keys()] },
    askConsent,
    saveEngines: async () => {},
    log: () => {},
    adapters: new Map((['openai-compatible', 'anthropic'] as AiEngineKind[]).map((k) => [k, adapter(k)])),
  });
  const panel = {};
  const host: VsCodeHost = new VsCodeHost({
    postMessage: (m) => {
      if (isAiWebviewMessage(m)) {void handleAiMessage(service, panel, m, (reply) => { host.handleReply(reply as never); });}
    },
    getState: () => undefined,
    setState: () => undefined,
  });
  const ctx: AiRunContext = { ai: host.ai, settings: () => webviewSettings, statuses: () => [], consent: {} };
  const signal = new AbortController().signal;
  const { docs, listBases } = fakeDocs([simple({ allowCloud: true })]);
  const turn = (abort: AbortSignal = signal): Promise<DocsTurnOutcome> =>
    runDocsTurn(aiDocsLoopDeps(ctx), { question: 'how do keys rotate?', scope: { kind: 'bases', docs } }, {}, abort);
  return {
    service, panel, ctx, dialogs, sent, stored, answer, turn, failNext, listBases,
    setHostSettings: (s: AiSettings) => { hostSettings = s; },
    setSettings: (s: AiSettings) => { hostSettings = s; webviewSettings = s; },
  };
}

const cloudReq = (turn: Record<string, unknown> | undefined, requestId = 'r1'): AiCompletionRequest => ({
  requestId,
  feature: 'chat',
  task: 'docs',
  route: { engineId: 'claude', modelId: 'sonnet' },
  messages: [{ role: 'user', content: 'pages' }],
  ...(turn ? { turn: { sends: 'docsBase', baseIds: ['b'], isLocal: false, ...turn } as AiCompletionRequest['turn'] } : {}),
});

describe('"Allow once" over a whole turn, through the real service', () => {
  it('a three-hop turn asks once and finishes, and stores nothing', async () => {
    const { turn, dialogs, sent, stored } = setup();
    const out = await turn();
    expect(out.kind).toBe('answered');
    expect(dialogs).toEqual([{ engineId: 'claude', feature: 'chat', sends: 'docsBase', baseNames: ['Handbook'] }]);
    // Three hops and the answer, all on the one answer.
    expect(sent.filter((r) => r.format === 'json')).toHaveLength(3);
    expect(sent).toHaveLength(4);
    expect(new Set(sent.map((r) => r.turn?.id)).size).toBe(1);
    expect(stored.size).toBe(0);
  });

  it('a second turn asks again', async () => {
    const { turn, dialogs, sent } = setup();
    expect((await turn()).kind).toBe('answered');
    expect((await turn()).kind).toBe('answered');
    expect(dialogs).toHaveLength(2);
    expect(new Set(sent.map((r) => r.turn?.id)).size).toBe(2);
  });

  it('"Allow for this workspace" asks once ever and is stored, as before', async () => {
    const { turn, dialogs, stored } = setup({ answer: 'allow' });
    expect((await turn()).kind).toBe('answered');
    expect((await turn()).kind).toBe('answered');
    expect(dialogs).toHaveLength(1);
    expect(stored.get('claude')?.answer).toBe('allow');
  });

  it('a local route asks nothing', async () => {
    const { turn, dialogs, sent } = setup({ settings: parse(toLocal) });
    expect((await turn()).kind).toBe('answered');
    expect(dialogs).toHaveLength(0);
    expect(sent[0].turn?.isLocal).toBe(true);
  });
});

describe('what a grant covers', () => {
  const grant = (s: ReturnType<typeof setup>, turnId = 'A', baseIds = ['b'], panel: object = s.panel) =>
    s.service.requestCloudConsent('claude', 'chat', 'docsBase', baseIds, { panel, id: turnId });

  it('turn A\'s grant does not admit turn B', async () => {
    const s = setup();
    expect(await grant(s)).toBe('once');
    s.answer.next = 'deny';
    await expect(s.service.complete(s.panel, cloudReq({ id: 'B' }), () => {})).rejects.toMatchObject({ code: 'consentDenied' });
    expect(s.sent).toHaveLength(0);
    expect(s.dialogs).toHaveLength(2);
  });

  it('nor another panel, even under the same turn id', async () => {
    const s = setup();
    await grant(s);
    s.answer.next = 'deny';
    await expect(s.service.complete({}, cloudReq({ id: 'A' }), () => {})).rejects.toMatchObject({ code: 'consentDenied' });
    expect(s.sent).toHaveLength(0);
  });

  it.each([
    ['another engine', { ...cloudReq({ id: 'A' }), route: { engineId: 'other', modelId: 'm' } }],
    ['a different base set', cloudReq({ id: 'A', baseIds: ['b', 'c'] })],
    ['a smaller base set', cloudReq({ id: 'A', baseIds: [] })],
    ['another scope', cloudReq({ id: 'A', sends: 'selection' })],
    ['another feature', { ...cloudReq({ id: 'A' }), feature: 'rewrite' }],
  ])('nor %s, and the mismatch ends it', async (_name, req) => {
    const s = setup();
    await grant(s);
    s.answer.next = 'deny';
    await expect(s.service.complete(s.panel, req as AiCompletionRequest, () => {})).rejects.toMatchObject({ code: 'consentDenied' });
    expect(s.sent).toHaveLength(0);
    // The refusal also counts for the session, so "asks again" cannot show this one: look at what is held.
    expect((s.service as unknown as { turnGrants: Map<object, unknown> }).turnGrants.has(s.panel)).toBe(false);
  });

  it('base ids count as a set: the order and repeats do not matter', async () => {
    const s = setup();
    await grant(s, 'A', ['b', 'c']);
    await s.service.complete(s.panel, cloudReq({ id: 'A', baseIds: ['c', 'b', 'c'] }), () => {});
    expect(s.dialogs).toHaveLength(1);
    expect(s.sent).toHaveLength(1);
  });

  it('a claim alone is not consent: a webview that invents a turn gets a dialog, and a refusal sends nothing', async () => {
    const s = setup({ answer: 'deny' });
    await expect(s.service.complete(s.panel, cloudReq({ id: 'made-up' }), () => {})).rejects.toMatchObject({ code: 'consentDenied' });
    expect(s.dialogs).toHaveLength(1);
    expect(s.sent).toHaveLength(0);
  });

  it('a grant cannot be spent past what one turn can use', async () => {
    const s = setup();
    await grant(s);
    for (let i = 0; i < AI_TURN_GRANT_MAX_USES; i++) {
      await s.service.complete(s.panel, cloudReq({ id: 'A' }, `r${i}`), () => {});
    }
    expect(s.dialogs).toHaveLength(1);
    s.answer.next = 'deny';
    await expect(s.service.complete(s.panel, cloudReq({ id: 'A' }, 'over'), () => {})).rejects.toMatchObject({ code: 'consentDenied' });
    expect(s.sent).toHaveLength(AI_TURN_GRANT_MAX_USES);
  });

  it('one dialog never makes grants for two turns', async () => {
    const s = setup();
    await Promise.all([grant(s, 'A'), grant(s, 'B')]);
    expect(s.dialogs).toHaveLength(2);
  });
});

describe('when a grant ends', () => {
  const asksAgain = async (s: ReturnType<typeof setup>, turnId = 'A') => {
    s.answer.next = 'deny';
    await expect(s.service.complete(s.panel, cloudReq({ id: turnId }, 'after'), () => {})).rejects.toMatchObject({ code: 'consentDenied' });
  };
  const grant = (s: ReturnType<typeof setup>) => s.service.requestCloudConsent('claude', 'chat', 'docsBase', ['b'], { panel: s.panel, id: 'A' });

  it('with the turn', async () => {
    const s = setup();
    await grant(s);
    await s.service.complete(s.panel, cloudReq({ id: 'A' }), () => {});
    s.service.endTurn(s.panel, 'A');
    await asksAgain(s);
  });

  it('on an error', async () => {
    const s = setup();
    await grant(s);
    s.failNext.error = Object.assign(new Error('boom'), { code: 'unknown' });
    await expect(s.service.complete(s.panel, cloudReq({ id: 'A' }), () => {})).rejects.toBeTruthy();
    await asksAgain(s);
  });

  it('on cancel', async () => {
    const s = setup();
    await grant(s);
    let release: (() => void) | undefined;
    const started = new Promise<void>((r) => { release = r; });
    const adapters = (s.service as unknown as { adapters: Map<AiEngineKind, ProviderAdapter> }).adapters;
    const anthropic = adapters.get('anthropic') as ProviderAdapter;
    adapters.set('anthropic', {
      ...anthropic,
      complete: (_e, _k, _m, _r, _t, signal) => new Promise((_, reject) => {
        release?.();
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    });
    const running = s.service.complete(s.panel, cloudReq({ id: 'A' }), () => {});
    await started;
    s.service.cancel(s.panel, 'r1');
    await expect(running).rejects.toMatchObject({ code: 'cancelled' });
    adapters.set('anthropic', anthropic);
    await asksAgain(s);
  });

  it('when the panel closes', async () => {
    const s = setup();
    await grant(s);
    s.service.disposePanel(s.panel);
    await asksAgain(s);
  });

  it('when the consent is forgotten', async () => {
    const s = setup();
    await grant(s);
    await s.service.forgetConsent('claude');
    await asksAgain(s);
  });

  it('when the engine now points somewhere else', async () => {
    const s = setup();
    await grant(s);
    s.setHostSettings(parse({ engines: raw.engines.map((e) => (e.id === 'claude' ? { ...e, baseUrl: 'https://elsewhere.example.com' } : e)) }));
    await asksAgain(s);
  });

  it('a whole turn ends it however it finishes: the webview tells the host', async () => {
    const s = setup();
    const spy = vi.spyOn(s.service, 'endTurn');
    expect((await s.turn()).kind).toBe('answered');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a failed hop ends the turn, and the next turn asks', async () => {
    const s = setup();
    s.failNext.error = Object.assign(new Error('boom'), { code: 'unknown' });
    expect((await s.turn()).kind).toBe('error');
    expect((await s.turn()).kind).toBe('answered');
    expect(s.dialogs).toHaveLength(2);
  });
});

describe('a dialog raised during a completion', () => {
  it('carries the real scope and base names, so it cannot say "the whole document" for base pages', async () => {
    const s = setup({ answer: 'deny' });
    await expect(s.service.complete(s.panel, cloudReq({ id: 'T', baseIds: ['b', 'unknown', 'c'] }), () => {})).rejects.toMatchObject({ code: 'consentDenied' });
    expect(s.dialogs).toEqual([{ engineId: 'claude', feature: 'chat', sends: 'docsBase', baseNames: ['Handbook', 'Runbook'] }]);
    const { body } = aiConsentText({ engineName: 'Cloud', host: 'api.example.com', feature: 'chat', sends: s.dialogs[0].sends, baseNames: s.dialogs[0].baseNames, scopeWord: 'workspace' });
    expect(body).toContain('Handbook');
    expect(body).not.toContain('the whole document');
  });

  it('when a stored allow is forgotten mid-turn, the turn asks once more, with the names, and "Allow once" covers the rest', async () => {
    const s = setup({
      answer: 'allow',
      navScript: [
        nav(['docs/security.md#audit']),
        () => {
          // The user forgets the answer while the turn runs. The webview's copy is forgotten by the next broadcast, later.
          void s.service.forgetConsent('claude');
          s.answer.next = 'allowOnce';
          return nav(['docs/ops.md#backups']);
        },
        nav([], true),
      ],
    });
    expect((await s.turn()).kind).toBe('answered');
    expect(s.dialogs).toEqual([
      { engineId: 'claude', feature: 'chat', sends: 'docsBase', baseNames: ['Handbook'] },
      { engineId: 'claude', feature: 'chat', sends: 'docsBase', baseNames: ['Handbook'] },
    ]);
    expect(s.sent).toHaveLength(4);
  });
});

describe('everything else behaves as before', () => {
  const rewrite = (id = 'r'): AiCompletionRequest => ({ ...cloudReq(undefined, id), feature: 'rewrite', task: 'rewrite' });

  it('"Allow once" for a rewrite lets one request through, then asks with no scope', async () => {
    const s = setup();
    expect(await s.service.requestCloudConsent('claude', 'rewrite')).toBe('once');
    await s.service.complete(s.panel, rewrite('r1'), () => {});
    expect(s.dialogs).toHaveLength(1);
    await s.service.complete(s.panel, rewrite('r2'), () => {});
    expect(s.dialogs[1]).toEqual({ engineId: 'claude', feature: 'rewrite', sends: undefined, baseNames: undefined });
  });

  it('a rewrite\'s "Allow once" is not a turn\'s, and a turn\'s is not a rewrite\'s', async () => {
    const s = setup();
    await s.service.requestCloudConsent('claude', 'rewrite');
    s.answer.next = 'deny';
    await expect(s.service.complete(s.panel, cloudReq({ id: 'T' }), () => {})).rejects.toMatchObject({ code: 'consentDenied' });
    expect(s.dialogs[1]).toMatchObject({ sends: 'docsBase', baseNames: ['Handbook'] });

    const t = setup();
    await t.service.requestCloudConsent('claude', 'chat', 'docsBase', ['b'], { panel: t.panel, id: 'T' });
    t.answer.next = 'deny';
    await expect(t.service.complete(t.panel, rewrite(), () => {})).rejects.toMatchObject({ code: 'consentDenied' });
    expect(t.sent).toHaveLength(0);
  });
});

describe('F6: changes during a turn', () => {
  it('a base\'s cloud switch flipped mid-turn stops before the answer', async () => {
    const base = simple({ allowCloud: true });
    const { docs, listBases } = fakeDocs([base]);
    const s = setup({ navScript: [() => { base.allowCloud = false; return nav(['docs/security.md#audit'], true); }] });
    const out = await runDocsTurn(aiDocsLoopDeps(s.ctx), { question: 'q', scope: { kind: 'bases', docs } }, {}, new AbortController().signal);
    expect(out).toMatchObject({ kind: 'baseLocalOnly', bases: [{ id: 'b', name: 'Handbook' }] });
    expect(s.sent.every((r) => r.format === 'json')).toBe(true);
    expect(listBases.mock.calls.every((args) => (args as unknown[]).length === 0)).toBe(true);
  });

  it('a local engine re-pointed to a cloud URL under the same id fails the pin, in core', async () => {
    const s = setup({
      settings: parse(toLocal),
      navScript: [() => {
        s.setSettings(parse({ ...toLocal, engines: raw.engines.map((e) => (e.id === 'omlx' ? { ...e, baseUrl: 'https://cloud.example.com/v1' } : e)) }));
        return nav(['docs/security.md#audit']);
      }],
    });
    const out = await s.turn();
    expect(out).toMatchObject({ kind: 'error', error: { code: 'unknown' } });
    if (out.kind === 'error') {expect(out.error.message).toContain('moved between local and cloud');}
    expect(s.sent).toHaveLength(1);
    expect(s.dialogs).toHaveLength(0);
  });

  it('and on the host, when the webview has not heard about the change yet', async () => {
    const s = setup({
      settings: parse(toLocal),
      navScript: [() => {
        s.setHostSettings(parse({ ...toLocal, engines: raw.engines.map((e) => (e.id === 'omlx' ? { ...e, baseUrl: 'https://cloud.example.com/v1' } : e)) }));
        return nav(['docs/security.md#audit']);
      }],
    });
    const out = await s.turn();
    expect(out).toMatchObject({ kind: 'error', error: { code: 'unknown' } });
    if (out.kind === 'error') {expect(out.error.message).toContain('moved between local and cloud');}
    expect(s.sent).toHaveLength(1);
    expect(s.dialogs).toHaveLength(0);
  });
});
