/**
 * What core adds to a pinned turn: the turn id and locality on the wire, the
 * end-of-turn call, the re-read before the answer. Hosts' enforcement is in
 * test/unit/ai-consent-turn.test.ts and Desktop's commands/ai/tests/command_layer.rs.
 */
import { describe, expect, it, vi } from 'vitest';
import { AI_DOCS_MAX_HOPS_MAX, AI_TURN_GRANT_MAX_USES, docsBasesOffMidTurn, runDocsTurn, type AiDocBaseStatus, type AiRouteOk, type DocsReadHost } from '../src/ai';
import { aiDocsLoopDeps } from '../src/ai-docs-run';
import { resolveAiTurnRoute, runAiCompletion } from '../src/ai-request';
import { aiSettings, ctxOf, fakeAi, fakeDocs, nav, simple, toCloud } from './helpers/ai-docs-fakes';

const signal = (): AbortSignal => new AbortController().signal;
const bases = (docs: DocsReadHost) => ({ kind: 'bases' as const, docs });
const once = () => Promise.resolve<'once'>('once');

describe('a turn on the wire', () => {
  it('every request of a turn carries the same id, the scope, the base ids and the locality', async () => {
    const consent = vi.fn(once);
    const { ai, calls } = fakeAi([nav(['docs/security.md#audit']), nav([], true)], { requestTurnConsent: consent, requestCloudConsent: () => Promise.reject(new Error('not this one')) });
    const { docs } = fakeDocs([simple({ allowCloud: true })]);
    const out = await runDocsTurn(aiDocsLoopDeps(ctxOf(ai, aiSettings(toCloud()))), { question: 'q', scope: bases(docs) }, {}, signal());
    expect(out.kind).toBe('answered');
    expect(calls.length).toBeGreaterThanOrEqual(3);
    const [first] = calls;
    expect(first.turn).toEqual({ id: expect.any(String), sends: 'docsBase', baseIds: ['b'], isLocal: false });
    expect(calls.every((c) => c.turn?.id === first.turn?.id)).toBe(true);
    // The dialog was asked for that same turn.
    expect(consent.mock.calls).toEqual([['claude', { feature: 'chat', sends: 'docsBase', baseIds: ['b'], turnId: first.turn?.id }]]);
  });

  it('two turns have two ids', async () => {
    const { ai } = fakeAi([]);
    const ctx = ctxOf(ai, aiSettings());
    const a = await resolveAiTurnRoute(ctx, { feature: 'chat', task: 'docs' }, signal());
    const b = await resolveAiTurnRoute(ctx, { feature: 'chat', task: 'docs' }, signal());
    expect(a.pin?.turnId).toBeTruthy();
    expect(a.pin?.turnId).not.toBe(b.pin?.turnId);
    expect(a.pin?.isLocal).toBe(true);
  });

  it('a host without requestTurnConsent is asked the ordinary way, and the turn still runs', async () => {
    const consent = vi.fn(once);
    const { ai, calls } = fakeAi([nav([], true)], { requestCloudConsent: consent });
    const { docs } = fakeDocs([simple({ allowCloud: true })]);
    expect((await runDocsTurn(aiDocsLoopDeps(ctxOf(ai, aiSettings(toCloud()))), { question: 'q', scope: bases(docs) }, {}, signal())).kind).toBe('answered');
    expect(consent.mock.calls).toEqual([['claude', { feature: 'chat', sends: 'docsBase', baseIds: ['b'] }]]);
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('a request outside a turn carries none, and asks the ordinary way', async () => {
    const consent = vi.fn(once);
    const turnConsent = vi.fn(once);
    const { ai, calls } = fakeAi([], { requestCloudConsent: consent, requestTurnConsent: turnConsent });
    await runAiCompletion(ctxOf(ai, aiSettings(toCloud())), { feature: 'rewrite', messages: [{ role: 'user', content: 'x' }] }, {}, signal());
    expect(calls[0].turn).toBeUndefined();
    expect(consent.mock.calls[0]).toEqual(['claude', { feature: 'rewrite' }]);
    expect(turnConsent).not.toHaveBeenCalled();
  });

  it('a tier-1 host has no turn', async () => {
    const seen: unknown[] = [];
    const { docs } = fakeDocs([simple({ allowCloud: true })]);
    const out = await runDocsTurn(aiDocsLoopDeps(ctxOf({
      complete: async (req, onToken) => {
        seen.push(req.turn);
        onToken('x');
        return { text: req.format === 'json' ? nav([], true) : 'x', served: { engineName: 'x', modelId: 'm', isLocal: true }, finishReason: 'stop' };
      },
    }, aiSettings())), { question: 'q', scope: bases(docs) }, {}, signal());
    expect(out.kind).toBe('answered');
    expect(seen.every((t) => t === undefined)).toBe(true);
  });
});

describe('the end of a turn', () => {
  const turnWith = async (script: Parameters<typeof fakeAi>[0], extra: Parameters<typeof fakeAi>[1] = {}, abort = signal()) => {
    const endTurn = vi.fn();
    const { ai, calls } = fakeAi(script, { requestCloudConsent: once, endTurn, ...extra });
    const { docs } = fakeDocs([simple({ allowCloud: true })]);
    const out = await runDocsTurn(aiDocsLoopDeps(ctxOf(ai, aiSettings(toCloud()))), { question: 'q', scope: bases(docs) }, {}, abort);
    return { out, endTurn, calls };
  };

  it('is told once on an answer', async () => {
    const { out, endTurn, calls } = await turnWith([nav([], true)]);
    expect(out.kind).toBe('answered');
    expect(endTurn.mock.calls).toEqual([[calls[0].turn?.id]]);
  });

  it('is told on a failed hop', async () => {
    const { out, endTurn } = await turnWith([() => Promise.reject(new Error('boom'))]);
    expect(out.kind).toBe('error');
    expect(endTurn).toHaveBeenCalledTimes(1);
  });

  it('is told on a cancel between hops', async () => {
    const controller = new AbortController();
    const { out, endTurn } = await turnWith([() => { controller.abort(); return nav([], true); }], {}, controller.signal);
    expect(out.kind).toBe('cancelled');
    expect(endTurn).toHaveBeenCalledTimes(1);
  });

  it('is told when consent is refused and nothing can serve the turn', async () => {
    const { out, endTurn } = await turnWith([], { requestCloudConsent: () => Promise.resolve(false) });
    expect(out.kind).toBe('error');
    expect(endTurn).toHaveBeenCalledTimes(1);
  });

  it('a host that throws from endTurn does not disturb the outcome', async () => {
    const { out } = await turnWith([nav([], true)], { endTurn: () => { throw new Error('gone'); } });
    expect(out.kind).toBe('answered');
  });

  it('a host without endTurn works as before', async () => {
    const { ai } = fakeAi([nav([], true)], { requestCloudConsent: once });
    const { docs } = fakeDocs([simple({ allowCloud: true })]);
    expect((await runDocsTurn(aiDocsLoopDeps(ctxOf(ai, aiSettings(toCloud()))), { question: 'q', scope: bases(docs) }, {}, signal())).kind).toBe('answered');
  });
});

describe('a pinned call', () => {
  const pinned = (isLocal: boolean | undefined, engineId = 'omlx', modelId = 'qwen') => ({
    feature: 'chat', task: 'docs', messages: [{ role: 'user' as const, content: 'x' }], pin: { engineId, modelId, ...(isLocal === undefined ? {} : { isLocal }) },
  });

  it('fails if its engine went from local to cloud under the same id', async () => {
    const consent = vi.fn(once);
    const { ai, calls } = fakeAi([], { requestCloudConsent: consent });
    const moved = aiSettings({ engines: [{ id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'https://cloud.example.com/v1', models: [{ id: 'qwen' }] }] });
    await expect(runAiCompletion(ctxOf(ai, moved), pinned(true), {}, signal())).rejects.toMatchObject({ code: 'unknown', engineId: 'omlx', message: expect.stringContaining('moved between local and cloud') });
    expect(consent).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('and from cloud to local', async () => {
    const { ai, calls } = fakeAi([]);
    await expect(runAiCompletion(ctxOf(ai, aiSettings()), pinned(false), {}, signal())).rejects.toMatchObject({ code: 'unknown' });
    expect(calls).toHaveLength(0);
  });

  it('runs when nothing changed', async () => {
    const { ai, calls } = fakeAi([]);
    await runAiCompletion(ctxOf(ai, aiSettings()), pinned(true), {}, signal());
    expect(calls).toHaveLength(1);
  });

  it('"Allow once" asked in the middle of a turn holds for the rest of it', async () => {
    const consent = vi.fn(once);
    const { ai, calls } = fakeAi([], { requestTurnConsent: consent });
    const pin = { engineId: 'claude', modelId: 'sonnet', isLocal: false, turnId: 'T' };
    const req = { feature: 'chat', task: 'docs', sends: 'docsBase' as const, baseIds: ['b'], messages: [{ role: 'user' as const, content: 'x' }], pin };
    const ctx = ctxOf(ai, aiSettings());
    await runAiCompletion(ctx, req, {}, signal());
    await runAiCompletion(ctx, req, {}, signal());
    expect(consent).toHaveBeenCalledTimes(1);
    expect(consent.mock.calls[0]).toEqual(['claude', { feature: 'chat', sends: 'docsBase', baseIds: ['b'], turnId: 'T' }]);
    expect(calls).toHaveLength(2);
  });
});

describe('the re-read before the answer', () => {
  const status = (id: string, over: { allowCloud?: boolean; enabled?: boolean; name?: string } = {}): AiDocBaseStatus => ({
    base: { id, name: over.name ?? id, roots: ['/r'], allowCloud: over.allowCloud ?? true, enabled: over.enabled ?? true },
    active: true,
    roots: [{ root: '/r', label: 'r', found: true, fileCount: 1, oversizeSkipped: 0, capReached: false }],
    fileCount: 1,
    oversizeSkipped: 0,
    rootsMissing: 0,
    capReached: false,
  });
  const cloudRoute = { isLocal: false } as AiRouteOk;
  const localRoute = { isLocal: true } as AiRouteOk;

  it('names what went off: the switch on a cloud route, a disabled or removed base on any route', () => {
    const start = [status('a'), status('b'), status('c')];
    expect(docsBasesOffMidTurn(start, start, cloudRoute)).toEqual([]);
    expect(docsBasesOffMidTurn(start, [status('a', { allowCloud: false }), status('b'), status('c')], cloudRoute)).toEqual([{ id: 'a', name: 'a' }]);
    expect(docsBasesOffMidTurn(start, [status('a', { allowCloud: false }), status('b'), status('c')], localRoute)).toEqual([]);
    expect(docsBasesOffMidTurn(start, [status('a', { enabled: false }), status('b'), status('c')], localRoute)).toEqual([{ id: 'a', name: 'a' }]);
    expect(docsBasesOffMidTurn(start, [status('b'), status('c')], localRoute)).toEqual([{ id: 'a', name: 'a' }]);
    expect(docsBasesOffMidTurn([status('a')], [status('a', { allowCloud: false })], null)).toEqual([{ id: 'a', name: 'a' }]);
  });

  it('a base disabled mid-turn stops a local turn before the answer', async () => {
    const base = simple();
    const { ai, calls } = fakeAi([() => { base.enabled = false; return nav(['docs/security.md#audit'], true); }]);
    const { docs, listBases } = fakeDocs([base]);
    const out = await runDocsTurn(aiDocsLoopDeps(ctxOf(ai, aiSettings())), { question: 'q', scope: bases(docs) }, {}, signal());
    expect(out).toMatchObject({ kind: 'baseLocalOnly', bases: [{ id: 'b', name: 'Handbook' }] });
    expect(calls.every((c) => c.format === 'json')).toBe(true);
    expect(listBases).toHaveBeenCalledTimes(2);
  });

  it('a failed re-read fails the turn: it does not send on a guess', async () => {
    const { ai, calls } = fakeAi([nav(['docs/security.md#audit'], true)]);
    const { docs, listBases } = fakeDocs([simple({ allowCloud: true })]);
    listBases.mockImplementationOnce(listBases.getMockImplementation() as never).mockImplementationOnce(() => Promise.reject(new Error('gone')));
    const out = await runDocsTurn(aiDocsLoopDeps(ctxOf(ai, aiSettings(toCloud()), [], { consent: { claude: true } })), { question: 'q', scope: bases(docs) }, {}, signal());
    expect(out.kind).toBe('error');
    expect(calls.every((c) => c.format === 'json')).toBe(true);
  });

  it('This document has no bases to re-read', async () => {
    const { ai } = fakeAi([nav([], true)]);
    const { listBases } = fakeDocs([simple()]);
    const out = await runDocsTurn(aiDocsLoopDeps(ctxOf(ai, aiSettings())), { question: 'q', scope: { kind: 'document', text: '# A\n\nbody' } }, {}, signal());
    expect(out.kind).toBe('answered');
    expect(listBases).not.toHaveBeenCalled();
  });
});

describe('the use cap', () => {
  it('is what the longest turn can use: a navigation call and a repair per hop, and the answer', () => {
    expect(AI_TURN_GRANT_MAX_USES).toBe(AI_DOCS_MAX_HOPS_MAX * 2 + 1);
    expect(AI_TURN_GRANT_MAX_USES).toBe(11);
  });
});
