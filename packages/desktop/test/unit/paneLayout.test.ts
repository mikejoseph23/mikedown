/**
 * The pane layout tree: tabs open after the active one, closing picks the
 * neighbour, an emptied pane leaves its split, splits nest or extend, tabs
 * move within and across panes, and view states stick to tabs.
 */
import { describe, expect, it } from 'vitest';
import {
  activateTab,
  activeTab,
  closeTab,
  closeTabs,
  createPane,
  cycleTab,
  findPane,
  moveTab,
  moveTabToPane,
  openDocIds,
  openTab,
  panes,
  removePane,
  renameDoc,
  resizeSplit,
  setTabViewState,
  splitPane,
  tabsShowing,
  type LayoutNode,
  type SplitNode,
} from '../../src/panes/paneLayout';

function ids(node: LayoutNode, paneId: string): string[] {
  return findPane(node, paneId)!.tabs.map((t) => t.docId);
}

describe('tabs in one pane', () => {
  it('opens after the active tab and activates an existing tab instead of duplicating', () => {
    let l: LayoutNode = createPane('p1');
    l = openTab(l, 'p1', 'a');
    l = openTab(l, 'p1', 'b');
    l = openTab(l, 'p1', 'c');
    expect(ids(l, 'p1')).toEqual(['a', 'b', 'c']);
    l = activateTab(l, 'p1', 0);
    l = openTab(l, 'p1', 'd');
    expect(ids(l, 'p1')).toEqual(['a', 'd', 'b', 'c']);
    expect(activeTab(findPane(l, 'p1')!)?.docId).toBe('d');
    l = openTab(l, 'p1', 'c');
    expect(ids(l, 'p1')).toEqual(['a', 'd', 'b', 'c']);
    expect(findPane(l, 'p1')!.active).toBe(3);
  });

  it('closing the active tab moves to the left neighbour, or right from the first', () => {
    let l: LayoutNode = createPane('p1');
    for (const d of ['a', 'b', 'c']) {l = openTab(l, 'p1', d);}
    l = closeTab(l, 'p1', 2);
    expect(ids(l, 'p1')).toEqual(['a', 'b']);
    expect(findPane(l, 'p1')!.active).toBe(1);
    l = activateTab(l, 'p1', 0);
    l = closeTab(l, 'p1', 0);
    expect(ids(l, 'p1')).toEqual(['b']);
    expect(findPane(l, 'p1')!.active).toBe(0);
    l = closeTab(l, 'p1', 0);
    expect(ids(l, 'p1')).toEqual([]);
    expect(findPane(l, 'p1')!.active).toBe(-1);
    // The only pane stays, empty.
    expect(panes(l)).toHaveLength(1);
  });

  it('closing a tab before the active one keeps the active document', () => {
    let l: LayoutNode = createPane('p1');
    for (const d of ['a', 'b', 'c']) {l = openTab(l, 'p1', d);}
    l = closeTab(l, 'p1', 0);
    expect(activeTab(findPane(l, 'p1')!)?.docId).toBe('c');
  });

  it('cycles with wrap-around', () => {
    let l: LayoutNode = createPane('p1');
    for (const d of ['a', 'b', 'c']) {l = openTab(l, 'p1', d);}
    l = cycleTab(l, 'p1', 1);
    expect(activeTab(findPane(l, 'p1')!)?.docId).toBe('a');
    l = cycleTab(l, 'p1', -1);
    expect(activeTab(findPane(l, 'p1')!)?.docId).toBe('c');
  });

  it('reorders tabs and keeps the active document active', () => {
    let l: LayoutNode = createPane('p1');
    for (const d of ['a', 'b', 'c']) {l = openTab(l, 'p1', d);}
    l = moveTab(l, 'p1', 0, 3);
    expect(ids(l, 'p1')).toEqual(['b', 'c', 'a']);
    expect(activeTab(findPane(l, 'p1')!)?.docId).toBe('c');
    l = moveTab(l, 'p1', 2, 0);
    expect(ids(l, 'p1')).toEqual(['a', 'b', 'c']);
  });

  it('closeTabs closes by predicate (close others, close saved)', () => {
    let l: LayoutNode = createPane('p1');
    for (const d of ['a', 'b', 'c', 'd']) {l = openTab(l, 'p1', d);}
    l = closeTabs(l, 'p1', (t) => t.docId !== 'b');
    expect(ids(l, 'p1')).toEqual(['b']);
  });
});

describe('splits', () => {
  it('split right makes a row with the same document in the new pane', () => {
    let l: LayoutNode = createPane('p1');
    l = openTab(l, 'p1', 'a');
    l = setTabViewState(l, 'p1', 'a', { cursor: 5 });
    l = splitPane(l, 'p1', 'row', 'p2');
    expect(l.kind).toBe('split');
    const split = l as SplitNode;
    expect(split.direction).toBe('row');
    expect(split.sizes).toEqual([0.5, 0.5]);
    expect(panes(l).map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(ids(l, 'p2')).toEqual(['a']);
    expect(findPane(l, 'p2')!.tabs[0].viewState).toEqual({ cursor: 5 });
    expect(tabsShowing(l, 'a')).toEqual([{ paneId: 'p1', index: 0 }, { paneId: 'p2', index: 0 }]);
  });

  it('a split in the same direction extends the row; a different one nests', () => {
    let l: LayoutNode = createPane('p1');
    l = splitPane(l, 'p1', 'row', 'p2');
    l = splitPane(l, 'p2', 'row', 'p3');
    expect((l as SplitNode).children).toHaveLength(3);
    expect((l as SplitNode).sizes.map((s) => Math.round(s * 100))).toEqual([50, 25, 25]);
    l = splitPane(l, 'p3', 'column', 'p4');
    const row = l as SplitNode;
    expect(row.children[2].kind).toBe('split');
    expect((row.children[2] as SplitNode).direction).toBe('column');
    expect(panes(l).map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('closing the last tab of a pane removes the pane and gives its share to the sibling', () => {
    let l: LayoutNode = createPane('p1');
    l = openTab(l, 'p1', 'a');
    l = splitPane(l, 'p1', 'row', 'p2');
    l = closeTab(l, 'p2', 0);
    expect(l.kind).toBe('pane');
    expect((l as { id: string }).id).toBe('p1');
    // Three panes: removing the middle one normalises the sizes.
    let m: LayoutNode = createPane('q1');
    m = splitPane(m, 'q1', 'row', 'q2');
    m = splitPane(m, 'q2', 'row', 'q3');
    m = removePane(m, 'q2');
    expect(panes(m).map((p) => p.id)).toEqual(['q1', 'q3']);
    const sizes = (m as SplitNode).sizes;
    expect(sizes[0] + sizes[1]).toBeCloseTo(1);
  });

  it('moves a tab to another pane and drops the emptied source pane', () => {
    let l: LayoutNode = createPane('p1');
    l = openTab(l, 'p1', 'a');
    l = openTab(l, 'p1', 'b');
    l = splitPane(l, 'p1', 'row', 'p2');
    // p2 shows b. Move a from p1 to p2.
    l = moveTabToPane(l, 'p1', 0, 'p2', 0);
    expect(ids(l, 'p1')).toEqual(['b']);
    expect(ids(l, 'p2')).toEqual(['a', 'b']);
    expect(activeTab(findPane(l, 'p2')!)?.docId).toBe('a');
    // Moving the last tab out collapses the source pane.
    l = moveTabToPane(l, 'p1', 0, 'p2');
    expect(l.kind).toBe('pane');
    expect(ids(l, 'p2')).toEqual(['a', 'b']);
  });

  it('resizes a split and renames documents everywhere', () => {
    let l: LayoutNode = createPane('p1');
    l = openTab(l, 'p1', 'untitled:1');
    l = splitPane(l, 'p1', 'column', 'p2');
    l = resizeSplit(l, l as SplitNode, [0.3, 0.7]);
    expect((l as SplitNode).sizes).toEqual([0.3, 0.7]);
    l = renameDoc(l, 'untitled:1', 'file:/n/a.md');
    expect(openDocIds(l)).toEqual(['file:/n/a.md']);
  });
});
