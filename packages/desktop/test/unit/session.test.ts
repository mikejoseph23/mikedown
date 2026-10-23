/**
 * Session serialisation (edge case 28): the layout round-trips with paths,
 * untitled ids and view states; missing files drop out and empty panes
 * collapse on restore; the writer debounces.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionWriter, layoutFromSession, parseSession, serializeSession, sessionPaths, type SessionData } from '../../src/documents/session';
import { createPane, openTab, setTabViewState, splitPane, type LayoutNode } from '../../src/panes/paneLayout';
import type { MikeDownViewState } from '@mikedown/core';

type L = LayoutNode<MikeDownViewState>;

const docs = new Map<string, { id: string; path: string | null }>([
  ['file:/n/a.md', { id: 'file:/n/a.md', path: '/n/a.md' }],
  ['file:/n/b.md', { id: 'file:/n/b.md', path: '/n/b.md' }],
  ['untitled:u1', { id: 'untitled:u1', path: null }],
]);

function sample(): L {
  let l: L = createPane('pane-1');
  l = openTab(l, 'pane-1', 'file:/n/a.md');
  l = openTab(l, 'pane-1', 'untitled:u1');
  l = setTabViewState(l, 'pane-1', 'file:/n/a.md', { sourceMode: false, cursor: 12, scrollTop: 300 });
  l = splitPane(l, 'pane-1', 'row', 'pane-2');
  l = openTab(l, 'pane-2', 'file:/n/b.md');
  return l;
}

describe('serializeSession', () => {
  it('writes paths, untitled ids, view states and the live state of active tabs', () => {
    const data = serializeSession({
      folder: '/n',
      sidebarVisible: true,
      expandedDirs: ['/n/sub'],
      layout: sample(),
      focusedPane: 'pane-2',
      doc: (id) => docs.get(id),
      liveViewState: (paneId) => (paneId === 'pane-2' ? { sourceMode: true, cursor: 3, scrollTop: 0 } : undefined),
    });
    expect(data.version).toBe(1);
    expect(data.folder).toBe('/n');
    expect(data.expandedDirs).toEqual(['/n/sub']);
    expect(data.focusedPane).toBe('pane-2');
    expect(data.layout).toEqual({
      kind: 'split',
      direction: 'row',
      sizes: [0.5, 0.5],
      children: [
        { kind: 'pane', id: 'pane-1', active: 1, tabs: [
          { path: '/n/a.md', viewState: { sourceMode: false, cursor: 12, scrollTop: 300 } },
          { untitledId: 'untitled:u1' },
        ] },
        { kind: 'pane', id: 'pane-2', active: 1, tabs: [
          { untitledId: 'untitled:u1' },
          { path: '/n/b.md', viewState: { sourceMode: true, cursor: 3, scrollTop: 0 } },
        ] },
      ],
    });
    expect(sessionPaths(data).sort()).toEqual(['/n/a.md', '/n/b.md']);
  });

  it('skips tabs whose document is gone and keeps the active index sane', () => {
    const data = serializeSession({
      folder: null,
      sidebarVisible: false,
      expandedDirs: [],
      layout: sample(),
      focusedPane: 'pane-1',
      doc: (id) => (id === 'file:/n/a.md' ? undefined : docs.get(id)),
      liveViewState: () => undefined,
    });
    const pane1 = (data.layout as { children: Array<{ tabs: unknown[]; active: number }> }).children[0];
    expect(pane1.tabs).toEqual([{ untitledId: 'untitled:u1' }]);
    expect(pane1.active).toBe(0);
  });
});

describe('parseSession', () => {
  it('accepts its own output and rejects other shapes', () => {
    const data = serializeSession({ folder: null, sidebarVisible: true, expandedDirs: [], layout: sample(), focusedPane: 'pane-1', doc: (id) => docs.get(id), liveViewState: () => undefined });
    expect(parseSession(JSON.parse(JSON.stringify(data)))).toEqual(data);
    expect(parseSession(null)).toBeNull();
    expect(parseSession({ version: 99, layout: { kind: 'pane', id: 'x', tabs: [] } })).toBeNull();
    expect(parseSession({ version: 1 })).toBeNull();
    expect(parseSession({ version: 1, layout: { kind: 'split', direction: 'diagonal', children: [] } })).toBeNull();
    expect(parseSession({ version: 1, layout: { kind: 'pane', id: 'p', tabs: [] }, sidebarVisible: 'yes', expandedDirs: 'no' })).toMatchObject({ sidebarVisible: true, expandedDirs: [], folder: null, focusedPane: '' });
  });
});

describe('layoutFromSession', () => {
  const data: SessionData = {
    version: 1,
    folder: '/n',
    sidebarVisible: true,
    expandedDirs: [],
    focusedPane: 'pane-2',
    layout: {
      kind: 'split',
      direction: 'row',
      sizes: [0.6, 0.4],
      children: [
        { kind: 'pane', id: 'pane-1', active: 1, tabs: [{ path: '/n/a.md', viewState: { sourceMode: false, cursor: 1, scrollTop: 2 } }, { path: '/n/gone.md' }, { untitledId: 'untitled:u1' }] },
        { kind: 'pane', id: 'pane-2', active: 0, tabs: [{ path: '/n/gone.md' }] },
      ],
    },
  };

  it('resolves tabs, drops the missing ones, collapses emptied panes and falls back for the focus', () => {
    const { layout, focusedPane } = layoutFromSession(data, (tab) => {
      if (tab.path === '/n/a.md') {return 'file:/n/a.md';}
      if (tab.untitledId === 'untitled:u1') {return 'untitled:u1';}
      return null;
    });
    expect(layout).toEqual({
      kind: 'pane',
      id: 'pane-1',
      active: 1,
      tabs: [{ docId: 'file:/n/a.md', viewState: { sourceMode: false, cursor: 1, scrollTop: 2 } }, { docId: 'untitled:u1' }],
    });
    expect(focusedPane).toBe('pane-1');
  });

  it('keeps both panes and their sizes when both survive', () => {
    const { layout, focusedPane } = layoutFromSession(data, (tab) => (tab.path ? `file:${tab.path}` : tab.untitledId ?? null));
    expect(layout.kind).toBe('split');
    expect((layout as { sizes: number[] }).sizes).toEqual([0.6, 0.4]);
    expect(focusedPane).toBe('pane-2');
  });

  it('a session where nothing resolves yields one empty pane', () => {
    const { layout } = layoutFromSession(data, () => null);
    expect(layout).toEqual({ kind: 'pane', id: 'pane-1', tabs: [], active: -1 });
  });

  it('a duplicate document in one pane is listed once', () => {
    const { layout } = layoutFromSession(
      { ...data, layout: { kind: 'pane', id: 'p', active: 1, tabs: [{ path: '/n/a.md' }, { path: '/n/a.md' }] } },
      () => 'file:/n/a.md',
    );
    expect((layout as { tabs: unknown[] }).tabs).toHaveLength(1);
  });
});

describe('session writer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces writes and flushes on demand', async () => {
    const written: unknown[] = [];
    let n = 0;
    const writer = createSessionWriter({
      api: { sessionWrite: async (label, data) => { written.push({ label, data }); } },
      label: 'main',
      snapshot: () => ({ version: 1, folder: null, sidebarVisible: true, expandedDirs: [], layout: { kind: 'pane', id: 'p', tabs: [], active: -1 }, focusedPane: 'p', n: ++n }) as unknown as SessionData,
      debounceMs: 1000,
    });
    writer.schedule();
    writer.schedule();
    await vi.advanceTimersByTimeAsync(900);
    expect(written).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(written).toHaveLength(1);
    expect((written[0] as { label: string }).label).toBe('main');
    writer.schedule();
    await writer.flush();
    expect(written).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(written).toHaveLength(2);
    writer.dispose();
    writer.schedule();
    await vi.advanceTimersByTimeAsync(2000);
    expect(written).toHaveLength(2);
  });
});
