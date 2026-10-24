/** U2: the OS notification posts only when no window is focused, once per version a day, and a soon focus opens the window. */
import { describe, expect, it, vi } from 'vitest';
import { CLICK_WINDOW_MS, createUpdateNotifier, RENOTIFY_MS, type NotifierDeps } from '../../src/ui/updateNotification';
import type { UpdateInfo } from '../../src/app/updaterApi';

const INFO: UpdateInfo = { version: '0.2.0', currentVersion: '0.1.0', notes: null, date: null };

function setup(over: Partial<NotifierDeps> = {}) {
  let now = 1_000;
  const map = new Map<string, string>();
  const deps: NotifierDeps = {
    anyWindowFocused: vi.fn(async () => false),
    ensurePermission: vi.fn(async () => true),
    post: vi.fn(),
    storage: { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => { map.delete(k); } },
    now: () => now,
    ...over,
  };
  return { n: createUpdateNotifier(deps), deps, advance: (ms: number) => { now += ms; } };
}

describe('update notifier', () => {
  it('posts when no window is focused', async () => {
    const t = setup();
    expect(await t.n.found(INFO)).toBe(true);
    expect(t.deps.post).toHaveBeenCalledWith('MikeDown 0.2.0 is available', expect.stringContaining('0.1.0'));
  });

  it('stays quiet when a window is focused, and asks no permission', async () => {
    const t = setup({ anyWindowFocused: vi.fn(async () => true) });
    expect(await t.n.found(INFO)).toBe(false);
    expect(t.deps.ensurePermission).not.toHaveBeenCalled();
    expect(t.deps.post).not.toHaveBeenCalled();
  });

  it('respects a refused permission', async () => {
    const t = setup({ ensurePermission: vi.fn(async () => false) });
    expect(await t.n.found(INFO)).toBe(false);
    expect(t.deps.post).not.toHaveBeenCalled();
  });

  it('posts a version at most once a day', async () => {
    const t = setup();
    await t.n.found(INFO);
    t.advance(4 * 60 * 60 * 1000);
    expect(await t.n.found(INFO)).toBe(false);
    t.advance(RENOTIFY_MS);
    expect(await t.n.found(INFO)).toBe(true);
    expect(t.deps.post).toHaveBeenCalledTimes(2);
  });

  it('the first focus soon after opens the window, once', async () => {
    const t = setup();
    await t.n.found(INFO);
    t.advance(5_000);
    expect(t.n.onFocus('0.2.0')).toBe(true);
    expect(t.n.onFocus('0.2.0')).toBe(false);
  });

  it('a late focus or another version does not', async () => {
    const t = setup();
    await t.n.found(INFO);
    expect(t.n.onFocus('0.3.0')).toBe(false);
    expect(t.n.onFocus(null)).toBe(false);
    t.advance(CLICK_WINDOW_MS + 1);
    expect(t.n.onFocus('0.2.0')).toBe(false);
  });

  it('survives storage that throws', async () => {
    const t = setup({ storage: { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); }, removeItem: () => undefined } });
    expect(await t.n.found(INFO)).toBe(true);
    expect(t.n.onFocus('0.2.0')).toBe(false);
  });
});
