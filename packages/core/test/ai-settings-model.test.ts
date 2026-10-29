/**
 * Edge cases of `autoFetchDecision` (B2) beyond the main table in
 * ai-express-model.test.ts: what an absent `hasKey` or `modelCount` means, and
 * the Copilot (host) engine, which has no address or key to wait for.
 */
import { describe, expect, it } from 'vitest';
import { autoFetchDecision, type AutoFetchState } from '../src/ai-settings-model';

const cloudOpen = (over: Partial<AutoFetchState> = {}): AutoFetchState => ({
  event: 'open', family: 'cloud', key: '', baseUrl: 'https://api.anthropic.com', discovery: 'auto', hasKey: true, modelCount: 0, neverProbed: true, ...over,
});

describe('autoFetchDecision: cloud open (B2) edge cases', () => {
  it('fetches at once on open with a host-held key, no models and no probe', () => {
    const d = autoFetchDecision(null, cloudOpen());
    expect(d).toMatchObject({ fetch: true, delayMs: 0, storeKey: false, cancelPending: true });
    expect(d.fingerprint).toBe('key:');
  });

  it('does not fetch when the host did not say it has a key', () => {
    expect(autoFetchDecision(null, cloudOpen({ hasKey: undefined })).fetch).toBe(false);
    expect(autoFetchDecision(null, cloudOpen({ hasKey: false })).fetch).toBe(false);
  });

  it('reads an absent model count as no models, and fetches', () => {
    expect(autoFetchDecision(null, cloudOpen({ modelCount: undefined })).fetch).toBe(true);
  });

  it('does not fetch when it was probed already, or when that is not known', () => {
    expect(autoFetchDecision(null, cloudOpen({ neverProbed: false })).fetch).toBe(false);
    expect(autoFetchDecision(null, cloudOpen({ neverProbed: undefined })).fetch).toBe(false);
  });

  it('does not fetch from an address that is not a URL', () => {
    expect(autoFetchDecision(null, cloudOpen({ baseUrl: 'not a url' })).fetch).toBe(false);
  });

  it('never stores a key on open: nothing was typed', () => {
    expect(autoFetchDecision(null, cloudOpen({ key: 'sk-typed' })).storeKey).toBe(false);
  });
});

describe('autoFetchDecision: the Copilot (host) engine', () => {
  const host = (over: Partial<AutoFetchState> = {}): AutoFetchState => ({ event: 'open', family: 'host', key: '', baseUrl: '', discovery: 'auto', neverProbed: true, ...over });

  it('fetches on first open without an address, like a local server, and not again once probed', () => {
    expect(autoFetchDecision(null, host())).toMatchObject({ fetch: true, delayMs: 0, storeKey: false });
    expect(autoFetchDecision(null, host({ neverProbed: false })).fetch).toBe(false);
    expect(autoFetchDecision(null, host({ discovery: 'manual' })).fetch).toBe(false);
  });
});
