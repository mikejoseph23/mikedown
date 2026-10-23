/**
 * The pane layout as data (M4): a binary tree of splits whose leaves are
 * panes, each with an ordered list of tabs and an active tab. Every
 * operation returns a new tree, so the DOM side (`paneManager.ts`) diffs
 * against what it rendered and the session file serialises the tree as is.
 *
 * Tabs refer to documents by id; the same document may be open in several
 * panes (one tab per pane). A pane whose last tab closes goes away, unless it
 * is the only pane, which stays empty.
 */

export interface TabRef<S = unknown> {
  docId: string;
  /** Per-tab editor view state, saved when the tab deactivates (session restore). */
  viewState?: S;
}

export interface PaneNode<S = unknown> {
  kind: 'pane';
  id: string;
  tabs: TabRef<S>[];
  /** Index into `tabs`; -1 for an empty pane. */
  active: number;
}

export interface SplitNode<S = unknown> {
  kind: 'split';
  /** `row` puts children side by side (split right), `column` stacks them (split down). */
  direction: 'row' | 'column';
  children: LayoutNode<S>[];
  /** Flex weights, one per child, summing to roughly 1. */
  sizes: number[];
}

export type LayoutNode<S = unknown> = PaneNode<S> | SplitNode<S>;

let nextPaneId = 1;

export function newPaneId(): string {
  return `pane-${nextPaneId++}`;
}

/** Keep generated ids ahead of ids restored from a session. */
export function notePaneId(id: string): void {
  const m = /^pane-(\d+)$/.exec(id);
  if (m) {nextPaneId = Math.max(nextPaneId, Number(m[1]) + 1);}
}

export function createPane<S>(id = newPaneId()): PaneNode<S> {
  return { kind: 'pane', id, tabs: [], active: -1 };
}

/** Depth-first, left to right: the visual order (top-left first). */
export function panes<S>(node: LayoutNode<S>): PaneNode<S>[] {
  if (node.kind === 'pane') {return [node];}
  return node.children.flatMap(panes);
}

export function findPane<S>(node: LayoutNode<S>, id: string): PaneNode<S> | null {
  return panes(node).find((p) => p.id === id) ?? null;
}

export function activeTab<S>(pane: PaneNode<S>): TabRef<S> | null {
  return pane.active >= 0 ? pane.tabs[pane.active] ?? null : null;
}

/** Replace the pane with `id` wherever it sits. */
export function replacePane<S>(node: LayoutNode<S>, id: string, next: LayoutNode<S>): LayoutNode<S> {
  if (node.kind === 'pane') {return node.id === id ? next : node;}
  return { ...node, children: node.children.map((c) => replacePane(c, id, next)) };
}

export function updatePane<S>(node: LayoutNode<S>, id: string, fn: (pane: PaneNode<S>) => PaneNode<S>): LayoutNode<S> {
  const pane = findPane(node, id);
  return pane ? replacePane(node, id, fn(pane)) : node;
}

/** Open (or activate) `docId` in a pane. A tab after the active one, as editors do. */
export function openTab<S>(node: LayoutNode<S>, paneId: string, docId: string): LayoutNode<S> {
  return updatePane(node, paneId, (pane) => {
    const i = pane.tabs.findIndex((t) => t.docId === docId);
    if (i >= 0) {return { ...pane, active: i };}
    const at = pane.active >= 0 ? pane.active + 1 : pane.tabs.length;
    const tabs = [...pane.tabs];
    tabs.splice(at, 0, { docId });
    return { ...pane, tabs, active: at };
  });
}

export function activateTab<S>(node: LayoutNode<S>, paneId: string, index: number): LayoutNode<S> {
  return updatePane(node, paneId, (pane) => {
    if (index < 0 || index >= pane.tabs.length) {return pane;}
    return { ...pane, active: index };
  });
}

/** The tab `delta` steps from the active one, wrapping. */
export function cycleTab<S>(node: LayoutNode<S>, paneId: string, delta: number): LayoutNode<S> {
  return updatePane(node, paneId, (pane) => {
    const n = pane.tabs.length;
    if (n < 2 || pane.active < 0) {return pane;}
    return { ...pane, active: (((pane.active + delta) % n) + n) % n };
  });
}

/**
 * Close one tab. The active tab moves to the neighbour on the left (as
 * VS Code), or to the right when the first tab closes. A pane left with no
 * tabs is removed from its split; the last pane stays, empty.
 */
export function closeTab<S>(node: LayoutNode<S>, paneId: string, index: number): LayoutNode<S> {
  const pane = findPane(node, paneId);
  if (!pane || index < 0 || index >= pane.tabs.length) {return node;}
  const tabs = pane.tabs.filter((_, i) => i !== index);
  let active = pane.active;
  if (index < active) {active -= 1;}
  else if (index === active) {active = Math.min(index, tabs.length - 1);}
  if (tabs.length === 0) {active = -1;}
  const updated: PaneNode<S> = { ...pane, tabs, active };
  if (tabs.length === 0 && panes(node).length > 1) {return removePane(node, paneId);}
  return replacePane(node, paneId, updated);
}

export function closeTabs<S>(node: LayoutNode<S>, paneId: string, which: (tab: TabRef<S>, i: number) => boolean): LayoutNode<S> {
  const pane = findPane(node, paneId);
  if (!pane) {return node;}
  let next = node;
  for (let i = pane.tabs.length - 1; i >= 0; i--) {
    if (which(pane.tabs[i], i)) {next = closeTab(next, paneId, i);}
  }
  return next;
}

/** Remove a pane from the tree; its sibling takes its place (and its share). */
export function removePane<S>(node: LayoutNode<S>, paneId: string): LayoutNode<S> {
  if (node.kind === 'pane') {return node;}
  const i = node.children.findIndex((c) => c.kind === 'pane' && c.id === paneId);
  if (i >= 0) {
    const children = node.children.filter((_, j) => j !== i);
    const sizes = node.sizes.filter((_, j) => j !== i);
    if (children.length === 1) {return children[0];}
    const total = sizes.reduce((a, b) => a + b, 0) || 1;
    return { ...node, children, sizes: sizes.map((s) => s / total) };
  }
  return { ...node, children: node.children.map((c) => removePane(c, paneId)) };
}

/**
 * Split a pane: a new pane to its right (`row`) or below it (`column`),
 * showing the same active document so the user can scroll the two apart. A
 * split in the same direction as the parent adds a sibling instead of
 * nesting, so three side-by-side panes share one row.
 */
export function splitPane<S>(node: LayoutNode<S>, paneId: string, direction: 'row' | 'column', newId = newPaneId()): LayoutNode<S> {
  const pane = findPane(node, paneId);
  if (!pane) {return node;}
  const tab = activeTab(pane);
  const fresh: PaneNode<S> = { kind: 'pane', id: newId, tabs: tab ? [{ docId: tab.docId, viewState: tab.viewState }] : [], active: tab ? 0 : -1 };
  return insertAfter(node, paneId, fresh, direction);
}

function insertAfter<S>(node: LayoutNode<S>, paneId: string, fresh: PaneNode<S>, direction: 'row' | 'column'): LayoutNode<S> {
  if (node.kind === 'pane') {
    if (node.id !== paneId) {return node;}
    return { kind: 'split', direction, children: [node, fresh], sizes: [0.5, 0.5] };
  }
  const i = node.children.findIndex((c) => c.kind === 'pane' && c.id === paneId);
  if (i >= 0 && node.direction === direction) {
    const children = [...node.children];
    const sizes = [...node.sizes];
    const share = sizes[i] / 2;
    sizes[i] = share;
    children.splice(i + 1, 0, fresh);
    sizes.splice(i + 1, 0, share);
    return { ...node, children, sizes };
  }
  return { ...node, children: node.children.map((c) => insertAfter(c, paneId, fresh, direction)) };
}

/** Move a tab within a pane (drag reorder). */
export function moveTab<S>(node: LayoutNode<S>, paneId: string, from: number, to: number): LayoutNode<S> {
  return updatePane(node, paneId, (pane) => {
    if (from === to || from < 0 || from >= pane.tabs.length || to < 0 || to > pane.tabs.length) {return pane;}
    const tabs = [...pane.tabs];
    const [tab] = tabs.splice(from, 1);
    const dest = to > from ? to - 1 : to;
    tabs.splice(dest, 0, tab);
    const activeDoc = activeTab(pane)?.docId;
    const active = activeDoc ? tabs.findIndex((t) => t.docId === activeDoc) : -1;
    return { ...pane, tabs, active };
  });
}

/** Move a tab into another pane (drag across panes). The source pane may vanish. */
export function moveTabToPane<S>(node: LayoutNode<S>, fromPane: string, index: number, toPane: string, at?: number): LayoutNode<S> {
  const src = findPane(node, fromPane);
  const tab = src?.tabs[index];
  if (!src || !tab || fromPane === toPane) {return node;}
  let next = updatePane(node, toPane, (pane) => {
    if (pane.tabs.some((t) => t.docId === tab.docId)) {
      return { ...pane, active: pane.tabs.findIndex((t) => t.docId === tab.docId) };
    }
    const tabs = [...pane.tabs];
    const dest = at === undefined ? tabs.length : Math.max(0, Math.min(at, tabs.length));
    tabs.splice(dest, 0, { ...tab });
    return { ...pane, tabs, active: dest };
  });
  next = closeTab(next, fromPane, index);
  return next;
}

/** Record the editor view state of a tab (on deactivate, before a session save). */
export function setTabViewState<S>(node: LayoutNode<S>, paneId: string, docId: string, viewState: S): LayoutNode<S> {
  return updatePane(node, paneId, (pane) => ({
    ...pane,
    tabs: pane.tabs.map((t) => (t.docId === docId ? { ...t, viewState } : t)),
  }));
}

/** Every pane/tab index that shows `docId`. */
export function tabsShowing<S>(node: LayoutNode<S>, docId: string): Array<{ paneId: string; index: number }> {
  const out: Array<{ paneId: string; index: number }> = [];
  for (const pane of panes(node)) {
    pane.tabs.forEach((t, index) => { if (t.docId === docId) {out.push({ paneId: pane.id, index });} });
  }
  return out;
}

/** Replace a document id everywhere (a document re-keyed after Save As / rename). */
export function renameDoc<S>(node: LayoutNode<S>, from: string, to: string): LayoutNode<S> {
  if (node.kind === 'pane') {
    return { ...node, tabs: node.tabs.map((t) => (t.docId === from ? { ...t, docId: to } : t)) };
  }
  return { ...node, children: node.children.map((c) => renameDoc(c, from, to)) };
}

/** Distinct document ids across all panes. */
export function openDocIds<S>(node: LayoutNode<S>): string[] {
  const ids = new Set<string>();
  for (const pane of panes(node)) {for (const t of pane.tabs) {ids.add(t.docId);}}
  return [...ids];
}

/** Change the size weights of a split's children (divider drag). */
export function resizeSplit<S>(node: LayoutNode<S>, split: SplitNode<S>, sizes: number[]): LayoutNode<S> {
  if (node === split) {return { ...split, sizes };}
  if (node.kind === 'pane') {return node;}
  return { ...node, children: node.children.map((c) => resizeSplit(c, split, sizes)) };
}
