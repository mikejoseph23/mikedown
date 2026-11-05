/**
 * The docs* messages of the webview bridge, the base-name plumbing of the
 * cloud consent dialog (A3), and the scope rules for docBases / docs (S4).
 */
import { describe, expect, it, vi } from 'vitest';
import { parseAiSettings, type AiEngineKind, type ProviderAdapter } from '@mikedown/core/ai';
import { AiEngineService, type ConsentDialogAnswer } from '../../src/ai/engineService';
import { AiSecrets } from '../../src/ai/secrets';
import { AI_WEBVIEW_MESSAGE_TYPES, handleAiMessage, type DocsBridgeHost } from '../../src/ai/webviewBridge';
import { effectiveAiRaw } from '../../src/settings';

function fakeDocs(over: Partial<DocsBridgeHost> = {}): DocsBridgeHost {
  return {
    listBases: vi.fn(async () => []),
    index: vi.fn(async () => ({ baseId: 'b1', roots: [], pages: [], homes: [], truncated: false, oversizeSkipped: 0, builtAt: 0 })),
    readSections: vi.fn(async () => []),
    keywordSearch: vi.fn(async () => []),
    saveBases: vi.fn(async () => {}),
    addWorkspaceFolder: vi.fn(async () => '/work/space'),
    ...over,
  };
}

function bridge(docs: DocsBridgeHost | undefined, enabled = true) {
  const settings = parseAiSettings({ enabled }, { onWarning: () => {} });
  const service = new AiEngineService({
    readSettings: () => settings,
    secrets: new AiSecrets({ get: async () => undefined, store: async () => {}, delete: async () => {} }, {}),
    consent: { get: () => undefined, set: async () => {}, forget: async () => {}, ids: () => [] },
    askConsent: async () => 'deny',
    saveEngines: async () => {},
    log: () => {},
    adapters: new Map(),
  });
  const posted: any[] = [];
  const send = (message: Record<string, unknown>) =>
    handleAiMessage(service, {}, message as never, (m) => posted.push(m), docs ? { docs: { host: docs, isEnabled: () => enabled } } : {});
  return { posted, send };
}

describe('docs* messages', () => {
  it('are claimed by the bridge', () => {
    for (const t of ['docsListBases', 'docsIndex', 'docsReadSections', 'docsKeywordSearch', 'docsSaveBases', 'docsAddWorkspaceFolder']) {
      expect(AI_WEBVIEW_MESSAGE_TYPES.has(t)).toBe(true);
    }
  });

  it('answer unavailable when AI is off or no docs host exists', async () => {
    const docs = fakeDocs();
    const off = bridge(docs, false);
    await off.send({ type: 'docsListBases', requestId: 'r1' });
    expect(off.posted).toEqual([{ type: 'docsError', requestId: 'r1', code: 'unavailable', message: expect.stringContaining('AI is turned off') }]);
    expect(docs.listBases).not.toHaveBeenCalled();
    const none = bridge(undefined);
    await none.send({ type: 'docsReadSections', requestId: 'r2', baseId: 'b1', ids: [] });
    expect(none.posted[0]).toMatchObject({ type: 'docsError', code: 'unavailable' });
  });

  it('route each message to the host and reply with the matching type', async () => {
    const docs = fakeDocs();
    const { send, posted } = bridge(docs);
    await send({ type: 'docsListBases', requestId: 'a', refresh: true });
    await send({ type: 'docsIndex', requestId: 'b', baseId: 'b1' });
    await send({ type: 'docsReadSections', requestId: 'c', baseId: 'b1', ids: ['p.md#x', 7, '', 'q.md'] });
    await send({ type: 'docsKeywordSearch', requestId: 'd', baseId: 'b1', query: 'key' });
    await send({ type: 'docsSaveBases', requestId: 'e', bases: [{ name: 'X', roots: ['/x/y'] }] });
    await send({ type: 'docsAddWorkspaceFolder', requestId: 'f' });
    expect(posted.map((m) => [m.type, m.requestId])).toEqual([
      ['docsBases', 'a'],
      ['docsIndexResult', 'b'],
      ['docsSections', 'c'],
      ['docsKeywordResults', 'd'],
      ['docsSaved', 'e'],
      ['docsWorkspaceFolder', 'f'],
    ]);
    expect(posted[5].path).toBe('/work/space');
    expect(docs.listBases).toHaveBeenCalledWith({ refresh: true });
    expect(docs.readSections).toHaveBeenCalledWith('b1', ['p.md#x', 'q.md']);
    expect(docs.saveBases).toHaveBeenCalledWith([{ name: 'X', roots: ['/x/y'] }]);
  });

  it('validate every field', async () => {
    const docs = fakeDocs();
    const { send, posted } = bridge(docs);
    await send({ type: 'docsIndex', requestId: 'a' });
    await send({ type: 'docsIndex', requestId: 'b', baseId: 7 });
    await send({ type: 'docsIndex', requestId: 'c', baseId: 'x'.repeat(201) });
    await send({ type: 'docsReadSections', requestId: 'd', baseId: 'b1', ids: 'not-a-list' });
    await send({ type: 'docsKeywordSearch', requestId: 'e', baseId: 'b1', query: { q: 1 } });
    await send({ type: 'docsSaveBases', requestId: 'f', bases: 'nope' });
    await send({ type: 'docsSaveBases', requestId: 'g', bases: Array.from({ length: 101 }, () => ({})) });
    expect(posted.map((m) => m.code)).toEqual(Array(7).fill('badRequest'));
    expect(docs.index).not.toHaveBeenCalled();
    expect(docs.saveBases).not.toHaveBeenCalled();
    posted.length = 0;
    await send({ type: 'docsListBases' }); // no request id: nothing to answer
    expect(posted).toEqual([]);
  });

  it('cap the ids and query, and turn a host failure into docsError', async () => {
    const docs = fakeDocs({ keywordSearch: vi.fn(async () => { throw new Error('Unknown documentation base.'); }) });
    const { send, posted } = bridge(docs);
    await send({ type: 'docsReadSections', requestId: 'a', baseId: 'b1', ids: Array.from({ length: 500 }, (_, i) => `p${i}.md`) });
    expect((docs.readSections as any).mock.calls[0][1]).toHaveLength(200);
    await send({ type: 'docsKeywordSearch', requestId: 'b', baseId: 'nope', query: 'x'.repeat(5000) });
    expect((docs.keywordSearch as any).mock.calls[0][1]).toHaveLength(2000);
    expect(posted.at(-1)).toEqual({ type: 'docsError', requestId: 'b', code: 'failed', message: 'Unknown documentation base.' });
  });
});

describe('base names in the consent dialog (A3)', () => {
  const raw = {
    enabled: true,
    allowCloud: true,
    engines: [{ id: 'claude', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', models: [{ id: 'm' }] }],
    docBases: [
      { id: 'b1', name: 'Handbook', roots: ['/docs/handbook'] },
      { id: 'b2', name: 'Runbooks', roots: ['/docs/runbooks'] },
    ],
  };

  function setup() {
    const settings = parseAiSettings(raw, { onWarning: () => {} });
    const resolvers: Array<(a: ConsentDialogAnswer) => void> = [];
    const askConsent = vi.fn((_e: unknown, _f: unknown, _s: unknown, _n?: string[]) => new Promise<ConsentDialogAnswer>((resolve) => { resolvers.push(resolve); }));
    const adapter = (kind: AiEngineKind): ProviderAdapter => ({ kind, listModels: async () => [], probe: async () => ({ ok: true, latencyMs: 1 }), complete: vi.fn() });
    const stored = new Map<string, any>();
    const service = new AiEngineService({
      readSettings: () => settings,
      secrets: new AiSecrets({ get: async () => undefined, store: async () => {}, delete: async () => {} }, {}),
      consent: { get: (id) => stored.get(id), set: async (id, r) => { stored.set(id, r); }, forget: async () => {}, ids: () => [...stored.keys()] },
      askConsent,
      saveEngines: async () => {},
      log: () => {},
      adapters: new Map([['anthropic' as AiEngineKind, adapter('anthropic')]]),
    });
    const posted: any[] = [];
    const send = (message: Record<string, unknown>) => handleAiMessage(service, {}, message as never, (m) => posted.push(m));
    return { askConsent, resolvers, send, posted };
  }

  it('maps ids to the names in the user settings and drops unknown ids', async () => {
    const { askConsent, resolvers, send, posted } = setup();
    const done = send({ type: 'aiRequestCloudConsent', requestId: 'c', engineId: 'claude', feature: 'chat', sends: 'docsBase', baseIds: ['b2', 'evil', 'b1', 'b2', 7] });
    await vi.waitFor(() => expect(askConsent).toHaveBeenCalled());
    expect(askConsent.mock.calls[0].slice(2)).toEqual(['docsBase', ['Runbooks', 'Handbook']]);
    resolvers[0]('allowOnce');
    await done;
    expect(posted.at(-1)).toMatchObject({ type: 'aiConsent', granted: 'once' });
  });

  it('shares a dialog only with an identical ask; another ask waits and never shows these names', async () => {
    const { askConsent, resolvers, send, posted } = setup();
    const first = send({ type: 'aiRequestCloudConsent', requestId: 'a', engineId: 'claude', feature: 'chat', sends: 'docsBase', baseIds: ['b1'] });
    const same = send({ type: 'aiRequestCloudConsent', requestId: 'b', engineId: 'claude', feature: 'chat', sends: 'docsBase', baseIds: ['b1'] });
    const other = send({ type: 'aiRequestCloudConsent', requestId: 'c', engineId: 'claude', feature: 'chat', sends: 'docsBase', baseIds: ['b2'] });
    await vi.waitFor(() => expect(askConsent).toHaveBeenCalledTimes(1));
    expect(askConsent.mock.calls[0][3]).toEqual(['Handbook']);
    resolvers[0]('allowOnce');
    await Promise.all([first, same]);
    await vi.waitFor(() => expect(askConsent).toHaveBeenCalledTimes(2));
    expect(askConsent.mock.calls[1][3]).toEqual(['Runbooks']);
    resolvers[1]('deny');
    await other;
    expect(posted.map((m) => [m.requestId, m.granted])).toEqual([['a', 'once'], ['b', 'once'], ['c', false]]);
  });

  it('a stored allow answers a waiting ask without a second dialog', async () => {
    const { askConsent, resolvers, send, posted } = setup();
    const first = send({ type: 'aiRequestCloudConsent', requestId: 'a', engineId: 'claude', baseIds: ['b1'] });
    const other = send({ type: 'aiRequestCloudConsent', requestId: 'b', engineId: 'claude', baseIds: ['b2'] });
    await vi.waitFor(() => expect(askConsent).toHaveBeenCalledTimes(1));
    resolvers[0]('allow');
    await Promise.all([first, other]);
    expect(askConsent).toHaveBeenCalledTimes(1);
    expect(posted.map((m) => m.granted)).toEqual([true, true]);
  });
});

describe('docBases and docs are user settings only (S4, A9)', () => {
  const inspect = (values: Record<string, Record<string, unknown>>) => (key: string) => values[key];

  it('effectiveAiRaw reads globalValue only', () => {
    const raw = effectiveAiRaw(inspect({
      docBases: { globalValue: [{ id: 'mine' }], workspaceValue: [{ id: 'evil' }], workspaceFolderValue: [{ id: 'evil2' }] },
      docs: { globalValue: { maxHops: 2 }, workspaceValue: { maxHops: 5 } },
    }));
    expect(raw.docBases).toEqual([{ id: 'mine' }]);
    expect(raw.docs).toEqual({ maxHops: 2 });
  });

  it('a workspace-only value is ignored', () => {
    const raw = effectiveAiRaw(inspect({ docBases: { workspaceValue: [{ id: 'evil' }] }, docs: { workspaceFolderValue: { maxHops: 5 } } }));
    expect(raw.docBases).toEqual([]);
    expect(raw.docs).toBeUndefined();
    expect(parseAiSettings(raw, { onWarning: () => {} }).docBases).toEqual([]);
  });

  it('saveSettings writes docBases and docs to user settings even when a workspace value exists', async () => {
    vi.resetModules();
    const update = vi.fn(async () => {});
    vi.doMock('vscode', () => ({
      ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
      window: { showErrorMessage: vi.fn(), showWarningMessage: vi.fn() },
      workspace: {
        getConfiguration: () => ({
          inspect: (key: string) => (key === 'ai.docBases' || key === 'ai.docs' ? { globalValue: [], workspaceValue: [{ id: 'evil', roots: ['/etc'] }], workspaceFolderValue: { maxHops: 5 } } : undefined),
          update,
        }),
      },
    }));
    const { saveAiSettingsPatch } = await import('../../src/ai/vscodeAi');
    const written = await saveAiSettingsPatch({
      'ai.docBases': [{ id: 'b1', name: 'Mine', roots: ['/docs/mine'] }],
      'ai.docs': { maxHops: 2 },
    });
    expect(written.sort()).toEqual(['docBases', 'docs']);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls.every((c: unknown[]) => c[2] === 1)).toBe(true);
    vi.doUnmock('vscode');
  });
});
