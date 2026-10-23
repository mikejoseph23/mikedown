/**
 * Session restore (edge case 28): one JSON file per window under
 * `<app-data>/sessions/<window label>.json` with the folder, the pane
 * layout (tabs by path, active tab, per-tab view state), the focused pane,
 * the sidebar state and the expanded directories. Written about a second
 * after anything in it changes, read back on launch.
 *
 * Untitled tabs are listed by id so a hot-exit backup can put them back
 * (`backups.ts`); without a backup they are dropped on restore, having had no
 * text worth keeping. Lone-file windows restore only when the file still
 * exists; a folder window restores even if some tabs are gone (those tabs
 * are skipped).
 */
import type { MikeDownViewState } from '@mikedown/core';
import type { LayoutNode, PaneNode, TabRef } from '../panes/paneLayout';
import { notePaneId } from '../panes/paneLayout';
import type { DocumentModel } from './documentModel';
import type { AppDataApi } from './fsApi';

export const SESSION_VERSION = 1;
export const SESSION_DEBOUNCE_MS = 1000;

export interface SessionTab {
  path?: string;
  untitledId?: string;
  viewState?: MikeDownViewState;
}

export interface SessionPane {
  kind: 'pane';
  id: string;
  tabs: SessionTab[];
  active: number;
}

export interface SessionSplit {
  kind: 'split';
  direction: 'row' | 'column';
  children: SessionNode[];
  sizes: number[];
}

export type SessionNode = SessionPane | SessionSplit;

export interface SessionData {
  version: number;
  folder: string | null;
  sidebarVisible: boolean;
  expandedDirs: string[];
  layout: SessionNode;
  focusedPane: string;
}

export interface SessionInput {
  folder: string | null;
  sidebarVisible: boolean;
  expandedDirs: string[];
  layout: LayoutNode<MikeDownViewState>;
  focusedPane: string;
  /** Resolve a tab's document (its path or untitled id). */
  doc(docId: string): Pick<DocumentModel, 'id' | 'path'> | undefined;
  /** The live view state of a pane's active tab (the stored one is stale while it shows). */
  liveViewState(paneId: string): MikeDownViewState | undefined;
}

function serializeNode(node: LayoutNode<MikeDownViewState>, input: SessionInput): SessionNode {
  if (node.kind === 'split') {
    return { kind: 'split', direction: node.direction, children: node.children.map((c) => serializeNode(c, input)), sizes: node.sizes };
  }
  const live = input.liveViewState(node.id);
  const tabs: SessionTab[] = [];
  let active = node.active;
  node.tabs.forEach((t, i) => {
    const doc = input.doc(t.docId);
    if (!doc) {
      if (i < active) {active -= 1;}
      return;
    }
    const viewState = i === node.active && live ? live : t.viewState;
    const tab: SessionTab = {};
    if (doc.path) {tab.path = doc.path;}
    else {tab.untitledId = doc.id;}
    if (viewState) {tab.viewState = viewState;}
    tabs.push(tab);
  });
  if (tabs.length === 0) {active = -1;}
  else {active = Math.max(0, Math.min(active, tabs.length - 1));}
  return { kind: 'pane', id: node.id, tabs, active };
}

export function serializeSession(input: SessionInput): SessionData {
  return {
    version: SESSION_VERSION,
    folder: input.folder,
    sidebarVisible: input.sidebarVisible,
    expandedDirs: input.expandedDirs,
    layout: serializeNode(input.layout, input),
    focusedPane: input.focusedPane,
  };
}

/** Accept only what looks like a session this version wrote. */
export function parseSession(raw: unknown): SessionData | null {
  if (!raw || typeof raw !== 'object') {return null;}
  const s = raw as Partial<SessionData>;
  if (s.version !== SESSION_VERSION || !s.layout || typeof s.layout !== 'object') {return null;}
  if (!validNode(s.layout)) {return null;}
  return {
    version: SESSION_VERSION,
    folder: typeof s.folder === 'string' ? s.folder : null,
    sidebarVisible: s.sidebarVisible !== false,
    expandedDirs: Array.isArray(s.expandedDirs) ? s.expandedDirs.filter((d): d is string => typeof d === 'string') : [],
    layout: s.layout,
    focusedPane: typeof s.focusedPane === 'string' ? s.focusedPane : '',
  };
}

function validNode(node: unknown): node is SessionNode {
  if (!node || typeof node !== 'object') {return false;}
  const n = node as SessionNode;
  if (n.kind === 'pane') {return typeof n.id === 'string' && Array.isArray(n.tabs);}
  if (n.kind === 'split') {
    return (n.direction === 'row' || n.direction === 'column') && Array.isArray(n.children) && n.children.length >= 1 && n.children.every(validNode);
  }
  return false;
}

/** Every file path a session refers to (to check existence before restoring). */
export function sessionPaths(data: SessionData): string[] {
  const out = new Set<string>();
  const walk = (n: SessionNode): void => {
    if (n.kind === 'pane') {for (const t of n.tabs) {if (t.path) {out.add(t.path);}}}
    else {n.children.forEach(walk);}
  };
  walk(data.layout);
  return [...out];
}

/**
 * Turn a session back into a layout. `resolve` maps a tab to a document id
 * (opening the file, or finding the backup for an untitled id) or null to
 * skip it. Panes that end up empty collapse out of their splits; the result
 * always has at least one pane.
 */
export function layoutFromSession(
  data: SessionData,
  resolve: (tab: SessionTab) => string | null,
): { layout: LayoutNode<MikeDownViewState>; focusedPane: string } {
  const build = (n: SessionNode): LayoutNode<MikeDownViewState> | null => {
    if (n.kind === 'pane') {
      notePaneId(n.id);
      const tabs: TabRef<MikeDownViewState>[] = [];
      let active = n.active;
      n.tabs.forEach((t, i) => {
        const docId = resolve(t);
        if (!docId) {
          if (i < n.active) {active -= 1;}
          return;
        }
        if (tabs.some((x) => x.docId === docId)) {
          if (i < n.active) {active -= 1;}
          return;
        }
        tabs.push(t.viewState ? { docId, viewState: t.viewState } : { docId });
      });
      if (tabs.length === 0) {return null;}
      const pane: PaneNode<MikeDownViewState> = { kind: 'pane', id: n.id, tabs, active: Math.max(0, Math.min(active, tabs.length - 1)) };
      return pane;
    }
    const kept: Array<{ node: LayoutNode<MikeDownViewState>; size: number }> = [];
    n.children.forEach((c, i) => {
      const built = build(c);
      if (built) {kept.push({ node: built, size: n.sizes?.[i] ?? 1 });}
    });
    if (kept.length === 0) {return null;}
    if (kept.length === 1) {return kept[0].node;}
    const total = kept.reduce((a, k) => a + k.size, 0) || 1;
    return { kind: 'split', direction: n.direction, children: kept.map((k) => k.node), sizes: kept.map((k) => k.size / total) };
  };
  const layout = build(data.layout) ?? { kind: 'pane', id: firstPaneId(data.layout), tabs: [], active: -1 };
  const ids = collectPaneIds(layout);
  const focusedPane = ids.includes(data.focusedPane) ? data.focusedPane : ids[0];
  return { layout, focusedPane };
}

function firstPaneId(n: SessionNode): string {
  if (n.kind === 'pane') {notePaneId(n.id); return n.id;}
  return firstPaneId(n.children[0]);
}

function collectPaneIds(n: LayoutNode<MikeDownViewState>): string[] {
  return n.kind === 'pane' ? [n.id] : n.children.flatMap(collectPaneIds);
}

/** Debounced writer for one window's session file. */
export interface SessionWriter {
  schedule(): void;
  /** Write now (before close). */
  flush(): Promise<void>;
  dispose(): void;
}

export function createSessionWriter(deps: {
  api: Pick<AppDataApi, 'sessionWrite'>;
  label: string;
  snapshot(): SessionData | null;
  debounceMs?: number;
}): SessionWriter {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  async function write(): Promise<void> {
    timer = undefined;
    const data = deps.snapshot();
    if (!data || disposed) {return;}
    try {
      await deps.api.sessionWrite(deps.label, data);
    } catch (err) {
      console.warn('MikeDown: session save failed', err);
    }
  }
  return {
    schedule() {
      if (disposed) {return;}
      clearTimeout(timer);
      timer = setTimeout(() => { void write(); }, deps.debounceMs ?? SESSION_DEBOUNCE_MS);
    },
    async flush() {
      clearTimeout(timer);
      await write();
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
    },
  };
}
