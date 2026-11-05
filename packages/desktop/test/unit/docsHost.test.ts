/**
 * The Desktop `MikeDownDocsHost` over a fake `DocsApi` (the Rust commands and
 * their change event): pass-through, errors, the watcher's reference count and
 * `saveBases`' re-validation. The Rust side has its own tests
 * (`src-tauri/src/commands/docs/tests.rs`).
 */
import { describe, expect, it, vi } from 'vitest';
import type { AiDocBase, AiDocBaseStatus, AiDocsIndex } from '@mikedown/core/ai';
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

function status(id: string, over: Partial<AiDocBaseStatus> = {}): AiDocBaseStatus {
  return {
    base: { id, name: id, roots: [`/docs/${id}`], allowCloud: false, enabled: true },
    active: true,
    roots: [],
    fileCount: 2,
    oversizeSkipped: 0,
    rootsMissing: 0,
    capReached: false,
    ...over,
  };
}

/** Two pages: `a.md` links to a page that exists, one that does not, a site and a wikilink with no page. */
function indexWithLinks(baseId: string): AiDocsIndex {
  const page = (relPath: string, links: Array<{ target: string; text: string; kind: 'markdown' | 'wikilink' }>) => ({ id: `docs/${relPath}`, root: 'docs', relPath, title: relPath, headings: [], links, chars: 10 });
  return {
    baseId,
    roots: [{ label: 'docs' }],
    pages: [
      page('a.md', [
        { target: 'b.md', text: 'ok', kind: 'markdown' },
        { target: 'gone.md', text: 'broken', kind: 'markdown' },
        { target: 'https://example.com', text: 'external', kind: 'markdown' },
        { target: 'Nowhere', text: 'broken wikilink', kind: 'wikilink' },
      ]),
      page('b.md', [{ target: '../../escape.md', text: 'outside', kind: 'markdown' }]),
    ],
    homes: [],
    truncated: false,
    oversizeSkipped: 0,
    builtAt: 0,
  };
}

describe('createDocsHost', () => {
  describe('listBases fills brokenLinks from the index (review fix 2)', () => {
    it('counts broken links with core\'s resolver for each base Rust walked', async () => {
      const { host, api } = setup();
      api.listBases.mockResolvedValueOnce([status('b1')] as never);
      api.index.mockImplementation(async (baseId: string) => indexWithLinks(baseId));
      const [one] = await host.listBases();
      expect(one.brokenLinks).toBe(3); // gone.md, Nowhere, ../../escape.md; the external link is not broken
      expect(api.index).toHaveBeenCalledWith('b1');
    });

    it('leaves it undefined for a disabled or inactive base and never asks for its index', async () => {
      const { host, api } = setup();
      const off = status('off', { active: false, base: { id: 'off', name: 'off', roots: ['/x'], allowCloud: false, enabled: false } });
      const missing = status('missing', { active: false, fileCount: 0, rootsMissing: 1 });
      api.listBases.mockResolvedValueOnce([off, missing] as never);
      const list = await host.listBases();
      expect(list.map((s) => s.brokenLinks)).toEqual([undefined, undefined]);
      expect(api.index).not.toHaveBeenCalled();
    });

    it('keeps the status, without a count, when the index cannot be read', async () => {
      const { host, api } = setup();
      api.listBases.mockResolvedValueOnce([status('a'), status('b')] as never);
      api.index.mockImplementation(async (baseId: string) => {
        if (baseId === 'a') {throw 'No folder of the documentation base was found.';}
        return indexWithLinks(baseId);
      });
      const list = await host.listBases();
      expect(list.map((s) => [s.base.id, s.brokenLinks])).toEqual([['a', undefined], ['b', 3]]);
    });

    it('a base with no broken links reports zero, not undefined', async () => {
      const { host, api } = setup();
      api.listBases.mockResolvedValueOnce([status('clean')] as never);
      api.index.mockImplementation(async (baseId: string) => ({ ...indexWithLinks(baseId), pages: [] }));
      expect((await host.listBases())[0].brokenLinks).toBe(0);
    });

    it('only the index command is added: no listBases call of its own beyond the one', async () => {
      const { host, api } = setup();
      api.listBases.mockResolvedValueOnce([status('a'), status('b')] as never);
      api.index.mockImplementation(async (baseId: string) => indexWithLinks(baseId));
      await host.listBases();
      expect(api.listBases).toHaveBeenCalledTimes(1);
      expect(api.index).toHaveBeenCalledTimes(2);
    });

    it('a failure of listBases itself still rejects with the sentence', async () => {
      const { host, api } = setup();
      api.listBases.mockRejectedValueOnce('settings unreadable');
      await expect(host.listBases()).rejects.toThrow('settings unreadable');
    });
  });

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
