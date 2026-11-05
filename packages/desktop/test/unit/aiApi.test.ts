/** What the consent commands put on the wire to Rust. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const { aiApi } = await import('../../src/host/aiApi');

describe('consent commands', () => {
  beforeEach(() => invoke.mockClear());

  it('a chat turn names itself', async () => {
    await aiApi.requestCloudConsent('e1', { feature: 'chat', sends: 'docsBase', baseIds: ['b'], turnId: 'T' });
    expect(invoke).toHaveBeenCalledWith('ai_request_cloud_consent', { id: 'e1', feature: 'chat', sends: 'docsBase', baseIds: ['b'], turnId: 'T' });
  });

  it('anything else sends what it always did', async () => {
    await aiApi.requestCloudConsent('e1', { feature: 'rewrite' });
    expect(invoke).toHaveBeenCalledWith('ai_request_cloud_consent', { id: 'e1', feature: 'rewrite', sends: null, baseIds: null });
    await aiApi.requestCloudConsent('e1');
    expect(invoke).toHaveBeenLastCalledWith('ai_request_cloud_consent', { id: 'e1', feature: null, sends: null, baseIds: null });
  });

  it('the end of a turn reaches its command', async () => {
    await aiApi.endTurn('T');
    expect(invoke).toHaveBeenCalledWith('ai_end_turn', { turnId: 'T' });
  });
});
