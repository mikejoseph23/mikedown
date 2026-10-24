/**
 * M6 versioning policy (edge cases 1 and 3): snapshot names sort
 * chronologically, identical saves skip, pruning keeps the newest N, the size
 * cap and lone-file windows never snapshot (and never touch disk), and a
 * rename/move carries the mirror. The fake `VersionsApi` behaves like
 * `versions.rs` (byte compare against the newest snapshot, folder created on
 * the first write only).
 */
import { describe, expect, it, vi } from 'vitest';
import { createPathOps } from '../../src/host/pathOps';
import {
  createVersioning,
  maxBytesFor,
  nextSnapshotName,
  parseSnapshotName,
  pruneList,
  skipReason,
  snapshotName,
  type VersionsApi,
} from '../../src/documents/versioning';
import { DEFAULT_DESKTOP_SETTINGS, type VersioningSettings } from '../../src/settings/desktopSettings';

const posix = createPathOps('posix');
const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);

/** An in-memory disk with the Rust commands' semantics. */
function fakeDisk() {
  const files = new Map<string, string>();
  const calls: string[] = [];
  const api: VersionsApi = {
    list: async (dir) => {
      calls.push(`list ${dir}`);
      return [...files.keys()]
        .filter((p) => posix.dirname(p) === dir)
        .map((p) => ({ name: posix.basename(p), path: p, size: files.get(p)!.length }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    snapshot: async (file, dir, name, newest, maxBytes) => {
      calls.push(`snapshot ${file} -> ${dir}/${name}`);
      const bytes = files.get(file) ?? '';
      if (bytes.length > maxBytes) {return 'tooLarge';}
      if (newest && files.get(posix.join(dir, newest)) === bytes) {return 'identical';}
      if (files.has(posix.join(dir, name))) {throw new Error('exists');}
      files.set(posix.join(dir, name), bytes);
      return 'created';
    },
    prune: async (dir, names) => {
      calls.push(`prune ${names.join(',')}`);
      let n = 0;
      for (const name of names) {if (files.delete(posix.join(dir, name))) {n++;}}
      return n;
    },
    move: async (from, to) => {
      calls.push(`move ${from} -> ${to}`);
      for (const p of [...files.keys()]) {
        if (p === from || p.startsWith(`${from}/`)) {
          files.set(to + p.slice(from.length), files.get(p)!);
          files.delete(p);
        }
      }
    },
  };
  return { files, calls, api };
}

function setup(opts: { root?: string | null; settings?: Partial<VersioningSettings> } = {}) {
  const disk = fakeDisk();
  let now = T0;
  const settings = { ...DEFAULT_DESKTOP_SETTINGS.versioning, ...opts.settings };
  const root = opts.root === undefined ? '/n' : opts.root;
  const versioning = createVersioning({
    api: disk.api,
    path: posix,
    settings: () => settings,
    root: () => root,
    readText: async (p) => ({ text: disk.files.get(p) ?? '' }),
    now: () => now,
  });
  return {
    ...disk,
    versioning,
    settings,
    tick(ms = 1000) { now += ms; },
    save(file: string, text: string) {
      disk.files.set(file, text);
      return versioning.onSaved(file, text.length);
    },
    snapshots(file: string) {
      const dir = `/n/.mikedown/versions/${posix.relative('/n', file)}`;
      return [...disk.files.keys()].filter((p) => posix.dirname(p) === dir).map((p) => posix.basename(p)).sort();
    },
  };
}

describe('snapshot names', () => {
  it('formats and parses compact UTC timestamps', () => {
    expect(snapshotName(T0)).toBe('20261023T120000Z.md');
    expect(snapshotName(Date.UTC(2027, 0, 2, 3, 4, 5, 999))).toBe('20270102T030405Z.md');
    expect(parseSnapshotName('20261023T120000Z.md')).toBe(T0);
    expect(parseSnapshotName('20261323T120000Z.md')).toBeNull();
    expect(parseSnapshotName('notes.md')).toBeNull();
  });

  it('always names a new snapshot after the newest one', () => {
    expect(nextSnapshotName(T0, [])).toBe('20261023T120000Z.md');
    // Same second as the newest: one second later.
    expect(nextSnapshotName(T0 + 400, ['20261023T120000Z.md'])).toBe('20261023T120001Z.md');
    // The clock stepped back: still after the newest.
    expect(nextSnapshotName(T0 - 60_000, ['20261023T120000Z.md', 'junk.md'])).toBe('20261023T120001Z.md');
    expect(nextSnapshotName(T0 + 5000, ['20261023T120000Z.md'])).toBe('20261023T120005Z.md');
  });

  it('prunes the oldest beyond keep', () => {
    expect(pruneList(['a', 'b', 'c', 'd'], 2)).toEqual(['a', 'b']);
    expect(pruneList(['a'], 25)).toEqual([]);
    expect(pruneList(['a', 'b'], 0)).toEqual(['a']);
  });
});

describe('skipReason', () => {
  const s = DEFAULT_DESKTOP_SETTINGS.versioning;
  it('snapshots only files inside the open folder, under the cap, with versioning on', () => {
    expect(skipReason({ settings: s, root: '/n', file: '/n/a.md', size: 10 }, posix)).toBeNull();
    expect(skipReason({ settings: { ...s, enabled: false }, root: '/n', file: '/n/a.md' }, posix)).toBe('disabled');
    expect(skipReason({ settings: s, root: null, file: '/n/a.md' }, posix)).toBe('no-folder');
    expect(skipReason({ settings: s, root: '/n', file: null }, posix)).toBe('untitled');
    expect(skipReason({ settings: s, root: '/n', file: '/elsewhere/a.md' }, posix)).toBe('outside');
    expect(skipReason({ settings: s, root: '/n', file: '/n/.mikedown/settings.json' }, posix)).toBe('internal');
    expect(skipReason({ settings: s, root: '/n', file: '/n/big.md', size: 3 * 1024 * 1024 }, posix)).toBe('too-large');
    expect(skipReason({ settings: s, root: '/n', file: '/n/edge.md', size: maxBytesFor(2) }, posix)).toBeNull();
  });
});

describe('createVersioning', () => {
  it('acceptance: three saves with changes and one without leave exactly three snapshots, in order', async () => {
    const t = setup();
    expect(t.files.has('/n/.mikedown')).toBe(false);
    expect((await t.save('/n/sub/a.md', 'one')).status).toBe('created');
    t.tick();
    expect((await t.save('/n/sub/a.md', 'two')).status).toBe('created');
    t.tick();
    expect((await t.save('/n/sub/a.md', 'two')).status).toBe('identical');
    t.tick();
    expect((await t.save('/n/sub/a.md', 'three')).status).toBe('created');
    const names = t.snapshots('/n/sub/a.md');
    expect(names).toEqual(['20261023T120000Z.md', '20261023T120001Z.md', '20261023T120003Z.md']);
    expect([...names].sort()).toEqual(names);
    const listed = await t.versioning.list('/n/sub/a.md');
    expect(listed.map((v) => v.name)).toEqual([...names].reverse());
    expect(listed[0].timeMs).toBe(T0 + 3000);
    expect(await t.versioning.newestText('/n/sub/a.md')).toBe('three');
  });

  it('two saves in the same second get distinct, ordered names', async () => {
    const t = setup();
    await t.save('/n/a.md', 'one');
    await t.save('/n/a.md', 'two');
    expect(t.snapshots('/n/a.md')).toEqual(['20261023T120000Z.md', '20261023T120001Z.md']);
  });

  it('concurrent saves of one file are taken one at a time', async () => {
    const t = setup();
    t.files.set('/n/a.md', 'one');
    const a = t.versioning.onSaved('/n/a.md', 3);
    const b = t.versioning.onSaved('/n/a.md', 3);
    expect((await a).status).toBe('created');
    expect((await b).status).toBe('identical');
  });

  it('prunes to versioning.keep after each new snapshot', async () => {
    const t = setup({ settings: { keep: 3 } });
    for (let i = 1; i <= 5; i++) {
      await t.save('/n/a.md', `v${i}`);
      t.tick();
    }
    expect(t.snapshots('/n/a.md')).toEqual(['20261023T120002Z.md', '20261023T120003Z.md', '20261023T120004Z.md']);
    expect(await t.versioning.newestText('/n/a.md')).toBe('v5');
  });

  it('a file over the size cap saves without a snapshot or any disk call', async () => {
    const t = setup();
    const res = await t.versioning.onSaved('/n/big.md', 3 * 1024 * 1024);
    expect(res.status).toBe('too-large');
    expect(t.calls).toEqual([]);
    expect(t.files.size).toBe(0);
  });

  it('a lone-file window (no folder) never snapshots', async () => {
    const t = setup({ root: null });
    expect((await t.save('/somewhere/a.md', 'x')).status).toBe('no-folder');
    expect(t.calls).toEqual([]);
    expect(t.versioning.dirFor('/somewhere/a.md')).toBeNull();
    expect(await t.versioning.list('/somewhere/a.md')).toEqual([]);
  });

  it('versioning off, outside the folder and untitled skip without disk calls', async () => {
    const off = setup({ settings: { enabled: false } });
    expect((await off.save('/n/a.md', 'x')).status).toBe('disabled');
    expect(off.calls).toEqual([]);
    const t = setup();
    expect((await t.save('/other/a.md', 'x')).status).toBe('outside');
    expect(t.calls).toEqual([]);
  });

  it('a failing snapshot never throws into the save', async () => {
    const t = setup();
    t.api.snapshot = vi.fn(async () => { throw new Error('disk full'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await t.save('/n/a.md', 'x')).status).toBe('failed');
  });

  it('notifies listeners on new snapshots and moves', async () => {
    const t = setup();
    const seen: string[] = [];
    t.versioning.onChange((f) => seen.push(f));
    await t.save('/n/a.md', 'one');
    await t.save('/n/a.md', 'one');
    await t.versioning.moved('/n/a.md', '/n/b.md');
    expect(seen).toEqual(['/n/a.md', '/n/a.md', '/n/b.md']);
  });

  it('rename and move map the mirror folder (edge case 3)', async () => {
    const t = setup();
    await t.save('/n/sub/a.md', 'one');
    await t.versioning.moved('/n/sub/a.md', '/n/sub/renamed.md');
    expect(t.calls).toContain('move /n/.mikedown/versions/sub/a.md -> /n/.mikedown/versions/sub/renamed.md');
    // A folder rename moves the whole mirror subtree.
    await t.versioning.moved('/n/sub', '/n/Projects/sub');
    expect(t.calls).toContain('move /n/.mikedown/versions/sub -> /n/.mikedown/versions/Projects/sub');
    expect(t.snapshots('/n/Projects/sub/renamed.md')).toEqual(['20261023T120000Z.md']);
    // Into or out of the folder there is no mirror to move.
    t.calls.length = 0;
    await t.versioning.moved('/n/x.md', '/elsewhere/x.md');
    await t.versioning.moved('/n/.mikedown/settings.json', '/n/y.json');
    expect(t.calls).toEqual([]);
  });
});
