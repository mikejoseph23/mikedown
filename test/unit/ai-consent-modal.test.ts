// The VS Code consent modal (vscodeAi.ts#askCloudConsent): core's words, and
// "Read the provider's policy" opens the policy and asks again.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const showWarningMessage = vi.fn();
const openExternal = vi.fn(async () => true);

vi.mock('vscode', () => ({
  env: { openExternal: (...args: unknown[]) => openExternal(...(args as [])) },
  window: { showWarningMessage: (...args: unknown[]) => showWarningMessage(...args) },
  Uri: { parse: (s: string) => ({ toString: () => s }) },
  workspace: { getConfiguration: () => ({ get: () => undefined, inspect: () => undefined }) },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
}));

import { aiConsentText, aiProviderPolicyForHost, type AiEngineConfig } from '@mikedown/core/ai';
import { askCloudConsent, workspaceConsentStore } from '../../src/ai/vscodeAi';

const anthropic = { id: 'claude', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', models: [] } as unknown as AiEngineConfig;
const proxy = { id: 'p', name: 'Proxy', kind: 'openai-compatible', baseUrl: 'https://llm.example.com/v1', models: [] } as unknown as AiEngineConfig;

describe('askCloudConsent', () => {
  beforeEach(() => {
    showWarningMessage.mockReset();
    openExternal.mockClear();
  });

  it('renders aiConsentText in a modal, with the policy button for a known provider', async () => {
    showWarningMessage.mockImplementation(async (_t: string, _o: unknown, ...items: Array<{ title: string }>) => items[0]);
    expect(await askCloudConsent(anthropic, 'summary')).toBe('allow');
    const expected = aiConsentText({ engineName: 'Anthropic', host: 'api.anthropic.com', feature: 'summary', scopeWord: 'workspace', policy: aiProviderPolicyForHost('api.anthropic.com'), offerNever: true });
    const [title, options, ...items] = showWarningMessage.mock.calls[0];
    expect(title).toBe(expected.title);
    expect(options).toEqual({ modal: true, detail: expected.body });
    expect(items.map((i: { title: string }) => i.title)).toEqual(['Allow for this workspace', 'Not for this workspace', "Read the provider's policy", 'Not now']);
  });

  it('"Read the provider\'s policy" opens it and asks again until an answer', async () => {
    showWarningMessage
      .mockImplementationOnce(async (_t: string, _o: unknown, ...items: Array<{ title: string }>) => items[2])
      .mockImplementationOnce(async () => undefined);
    expect(await askCloudConsent(anthropic, 'rewrite', 'document')).toBe('notNow');
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(String((openExternal.mock.calls[0] as unknown[])[0])).toContain('privacy.claude.com');
    expect(showWarningMessage).toHaveBeenCalledTimes(2);
    expect(showWarningMessage.mock.calls[0][1].detail).toContain('the whole document, up to what fits the model');
  });

  it('has no policy button for an engine no preset knows', async () => {
    showWarningMessage.mockImplementation(async () => undefined);
    expect(await askCloudConsent(proxy, 'rewrite')).toBe('notNow');
    const items = showWarningMessage.mock.calls[0].slice(2).map((i: { title: string }) => i.title);
    expect(items).toEqual(['Allow for this workspace', 'Not for this workspace', 'Not now']);
  });

  it('names GitHub Copilot for a vscode-lm engine, which has no address, and links its policy', async () => {
    const copilot = { id: 'cp', name: 'GitHub Copilot', kind: 'vscode-lm', baseUrl: '', models: [] } as unknown as AiEngineConfig;
    showWarningMessage.mockImplementation(async () => undefined);
    await askCloudConsent(copilot, 'rewrite');
    const [, options, ...items] = showWarningMessage.mock.calls[0];
    expect(options.detail).toContain('is a cloud engine at GitHub Copilot.');
    expect(options.detail).toContain('copilot.github.trust.page');
    expect(items.map((i: { title: string }) => i.title)).toContain("Read the provider's policy");
  });

  it('answers never for "Not for this workspace"', async () => {
    showWarningMessage.mockImplementation(async (_t: string, _o: unknown, ...items: Array<{ title: string }>) => items[1]);
    expect(await askCloudConsent(proxy, 'rewrite')).toBe('never');
  });

  it('stores allow and never with the engine fingerprint, ignores an old bare true, and lists its keys', () => {
    const data = new Map<string, unknown>([['mikedown.ai.consent.old', true], ['other', 1]]);
    const store = workspaceConsentStore({ get: (k: string) => data.get(k) as never, update: async (k: string, v: unknown) => { if (v === undefined) {data.delete(k);} else {data.set(k, v);} }, keys: () => [...data.keys()] });
    expect(store.get('old')).toBeUndefined();
    void store.set('claude', { fingerprint: 'f', answer: 'never', at: 5 });
    expect(store.get('claude')).toEqual({ fingerprint: 'f', answer: 'never', at: 5 });
    expect(store.ids().sort()).toEqual(['claude', 'old']);
    void store.forget('claude');
    expect(store.get('claude')).toBeUndefined();
  });
});
