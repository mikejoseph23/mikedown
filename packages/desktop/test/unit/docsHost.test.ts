/**
 * The Desktop `MikeDownDocsHost` over a fake `DocsApi` (the Rust commands and
 * their change event): pass-through, errors, the watcher's reference count and
 * `saveBases`' re-validation. The Rust side has its own tests
 * (`src-tauri/src/commands/docs/tests.rs`).
 */
import { describe, expect, it, vi } from 'vitest';
import type { AiDocBase } from '@mikedown/core/ai';
import { createDocsHost } from '../../src/host/docsHost';
import type { DocsApi } from '../../src/host/docsApi';

type Changed = (baseId: string) => void;

function setup(overrides: Partial<{ pickFolder: () => Promise<string | null> }> = {}) {
  const listeners = new Set<Changed>();
  const api = {
    listBases: vi.fn(async () => []),
    index: vi.fn(async (baseId: string) => ({ baseId, roots: [], pages: [], homes: [], truncated: false, oversizeSkipped: 0, builtAt: 0 })),
    readSections: vi.fn(async (_baseId: string, _ids: string[]) => []),
    keywordSearch: vi.fn(async (_baseId: string, _query: string) => []),
    syncRoots: vi.fn(async () => 1),
    watch: vi.fn(async (_baseId: string) => 1),
    unwatch: vi.fn(async (_baseId: string) => undefined),
    onChanged: vi.fn(async (h: Changed) => {
      listeners.add(h);
      return () => { listeners.delete(h); };
    }),
  };
  const saveBases = vi.fn(async (_bases: AiDocBase[]) => undefined);
  const host = createDocsHost({ api: api as unknown as DocsApi, saveBases, ...overrides });
  const emit = (baseId: string): void => { for (const l of [...listeners]) {l(baseId);} };
  return { host, api, saveBases, emit, listeners: () => listeners.size };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const BASE: AiDocBase = { id: 'b1', name: 'Handbook', roots: ['/Users/me/handbook'], allowCloud: false, enabled: true };

describe('createDocsHost', () => {
  it('passes base ids and ids straight to the commands and nothing else', async () => {
    const { host, api } = setup();
    await host.listBases();
    await host.index('b1');
    await host.readSections('b1', ['docs/a.md#x', '../../etc/passwd']);
    await host.keywordSearch('b1', 'key rotation');
    expect(api.index).toHaveBeenCalledWith('b1');
    expect(api.readSections).toHaveBeenCalledWith('b1', ['docs/a.md#x', '../../etc/passwd']);
    expect(api.keywordSearch).toHaveBeenCalledWith('b1', 'key rotation');
  });

  it('turns a string from Rust into an Error with that sentence', async () => {
    const { host, api } = setup();
    api.index.mockRejectedValueOnce('That documentation base is not in your settings.');
    await expect(host.index('nope')).rejects.toThrow('That documentation base is not in your settings.');
    api.readSections.mockRejectedValueOnce({ message: 'boom' });
    await expect(host.readSections('b1', [])).rejects.toThrow('boom');
  });

  it('has pickFolder only when the app can show a folder dialog', async () => {
    expect(setup().host.pickFolder).toBeUndefined();
    const { host } = setup({ pickFolder: async () => '/Users/me/notes' });
    expect(await host.pickFolder?.()).toBe('/Users/me/notes');
    expect(host.addWorkspaceFolder).toBeUndefined();
  });

  describe('watch', () => {
    it('starts the Rust watchers, calls back for its own base only, and stops them with the last subscriber', async () => {
      const { host, api, emit, listeners } = setup();
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      const off1 = host.watch?.('w1', cb1) as () => void;
      const off2 = host.watch?.('w1', cb2) as () => void;
      await tick();
      expect(api.watch).toHaveBeenCalledTimes(2);
      emit('w1');
      emit('other');
      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
      off1();
      expect(api.unwatch).not.toHaveBeenCalled();
      emit('w1');
      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(2);
      off2();
      expect(api.unwatch).toHaveBeenCalledTimes(1);
      expect(api.unwatch).toHaveBeenCalledWith('w1');
      expect(listeners()).toBe(0);
      off2();
      expect(api.unwatch).toHaveBeenCalledTimes(1);
    });

    it('stopping before the watchers started cleans up without leaving a listener', async () => {
      const { host, api, listeners } = setup();
      const off = host.watch?.('w2', vi.fn()) as () => void;
      off();
      await tick();
      expect(listeners()).toBe(0);
      expect(api.watch).not.toHaveBeenCalled();
    });

    it('stopping while Rust is still starting the watchers stops them again', async () => {
      const { host, api, listeners } = setup();
      let release: () => void = () => undefined;
      api.watch.mockImplementationOnce(() => new Promise<number>((r) => { release = () => r(1); }));
      const off = host.watch?.('w3', vi.fn()) as () => void;
      await tick();
      off();
      release();
      await tick();
      expect(api.unwatch).toHaveBeenCalledWith('w3');
      expect(listeners()).toBe(0);
    });

    it('a failure to watch is not an error for the caller', async () => {
      const { host, api } = setup();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      api.watch.mockRejectedValueOnce('no such base');
      const off = host.watch?.('w4', vi.fn()) as () => void;
      await tick();
      expect(() => off()).not.toThrow();
      warn.mockRestore();
    });
  });

  describe('saveBases', () => {
    it('re-validates, saves the survivors user-level, then lets the roots into the fs scope', async () => {
      const { host, saveBases, api } = setup();
      const bad: AiDocBase = { id: 'b2', name: 'Bad', roots: ['relative/path'], allowCloud: true, enabled: true };
      const dup: AiDocBase = { id: 'b3', name: 'Dup', roots: ['/Users/me/handbook/'], allowCloud: false, enabled: true };
      await host.saveBases([BASE, bad, dup]);
      expect(saveBases).toHaveBeenCalledTimes(1);
      expect(saveBases.mock.calls[0][0].map((b) => b.id)).toEqual(['b1']);
      expect(api.syncRoots).toHaveBeenCalledTimes(1);
      expect(saveBases.mock.invocationCallOrder[0]).toBeLessThan(api.syncRoots.mock.invocationCallOrder[0]);
    });

    it('refuses a list with nothing valid in it, so it cannot wipe a good one', async () => {
      const { host, saveBases, api } = setup();
      await expect(host.saveBases([{ ...BASE, roots: ['../escape'] }])).rejects.toThrow(/nothing was saved/);
      expect(saveBases).not.toHaveBeenCalled();
      expect(api.syncRoots).not.toHaveBeenCalled();
    });

    it('an empty list is a real "delete every base"', async () => {
      const { host, saveBases } = setup();
      await host.saveBases([]);
      expect(saveBases).toHaveBeenCalledWith([]);
    });

    it('does not sync the roots when the write failed', async () => {
      const { host, saveBases, api } = setup();
      saveBases.mockRejectedValueOnce(new Error('disk full'));
      await expect(host.saveBases([BASE])).rejects.toThrow('disk full');
      expect(api.syncRoots).not.toHaveBeenCalled();
    });
  });
});
