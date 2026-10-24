/**
 * Wires registry + panes + controller + image pipeline + TauriHost the way
 * `src/main.ts` does, over the real `fsApi` / `windowApi` / dialogs, so a
 * mocked IPC layer (helpers/ipc.ts) sees exactly the `invoke` calls the app
 * would make. The pane manager renders into a detached element; editors come
 * from `handleOrFactory` (a fake handle, or a real core editor).
 */
import type { MikeDownEditorHandle, MikeDownViewState } from '@mikedown/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createDocumentController, type DocumentController, type DocumentControllerDeps } from '../../../src/app/documentController';
import { createBackupScheduler, type BackupScheduler } from '../../../src/documents/backups';
import { createDocumentRegistry, type DocumentModel, type DocumentRegistry } from '../../../src/documents/documentModel';
import { appDataApi, fsApi, windowApi } from '../../../src/documents/fsApi';
import { createImagePipeline } from '../../../src/host/imagePipeline';
import { createPathOps, type PathPlatform } from '../../../src/host/pathOps';
import { TauriHost } from '../../../src/host/tauriHost';
import { createPaneManager, type PaneManager } from '../../../src/panes/paneManager';
import { createDesktopSettingsStore, type DesktopSettingsStore } from '../../../src/settings/desktopSettings';
import { createDialogs, IMAGE_FILTERS } from '../../../src/ui/dialogs';

export interface TestApp {
  /** The first pane's editor handle. */
  handle: MikeDownEditorHandle;
  /** The first pane's host. */
  host: TauriHost;
  /** The focused pane's document (null before anything opened). */
  readonly model: DocumentModel;
  registry: DocumentRegistry;
  panes: PaneManager;
  controller: DocumentController;
  backups: BackupScheduler;
  settings: DesktopSettingsStore;
  /** Every notice text set on a document (null when cleared), in order. */
  notices: Array<string | null>;
  toasts: string[];
  /** Hosts by pane id (one per pane). */
  hosts: Map<string, TauriHost>;
  root: HTMLElement;
  /** Stop timers (backups) and tear the panes down between tests. */
  dispose(): void;
}

export type FakeHandle = MikeDownEditorHandle & {
  saved: string[];
  /** Fire a `change` event as the editor would after typing. */
  emitChange(markdown: string, meta?: { pristine: boolean }): void;
  viewState: MikeDownViewState;
};

/** A handle that keeps the markdown as a string (no editor). */
export function fakeHandle(): FakeHandle {
  let md = '';
  const saved: string[] = [];
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const noop = (): void => {};
  const handle = {
    saved,
    viewState: { sourceMode: false, cursor: 0, scrollTop: 0 } as MikeDownViewState,
    setMarkdown: (m: string, opts?: { pristine?: boolean }) => {
      md = m;
      if (opts?.pristine === false) {
        // A host-driven edit echoes through `change`, as core does.
        listeners.get('change')?.forEach((fn) => fn(m, { pristine: false }));
      }
    },
    getMarkdown: () => md,
    markSaved: (c?: string) => { saved.push(c ?? md); },
    emitChange: (m: string, meta = { pristine: false }) => {
      md = m;
      listeners.get('change')?.forEach((fn) => fn(m, meta));
    },
    focus: noop,
    setReadOnly: noop,
    setTheme: noop,
    command: noop,
    updateSettings: noop,
    getHtml: () => '',
    scrollToAnchor: noop,
    revealLink: noop,
    setImageStatus: noop,
    setTags: noop,
    setLinkSuggestions: noop,
    setBacklinks: noop,
    setDocMeta: noop,
    setSidebarState: noop,
    setSidebarFooterLink: noop,
    setDiffAvailable: noop,
    isModalOpen: () => false,
    getViewState: () => ({ ...handle.viewState }),
    setViewState: (s: Partial<MikeDownViewState>) => { handle.viewState = { ...handle.viewState, ...s }; },
    insertLink: noop,
    insertImage: noop,
    refreshLinks: noop,
    on: (event: string, fn: (...args: unknown[]) => void) => {
      let set = listeners.get(event);
      if (!set) { set = new Set(); listeners.set(event, set); }
      set.add(fn);
      return () => { set?.delete(fn); };
    },
    destroy: noop,
  };
  return handle as unknown as FakeHandle;
}

export interface TestAppOptions {
  platform?: PathPlatform;
  now?: Date;
  /** Where the panes render (default: a fresh element appended to the body). */
  root?: HTMLElement;
  downloadNoticeMs?: number;
  /** Extra controller dependencies (M6: compareWithDisk). */
  controller?: Partial<DocumentControllerDeps>;
}

/**
 * `handle` may be a factory so a real core editor can be built with this
 * app's host (core needs the host at construction). The factory runs once
 * per pane; a plain handle is used for the first pane and fakes for the rest.
 */
export function createTestApp(
  handleOrFactory: MikeDownEditorHandle | ((host: TauriHost, container: HTMLElement, paneId: string) => MikeDownEditorHandle),
  opts: TestAppOptions = {},
): TestApp {
  const path = createPathOps(opts.platform ?? 'posix');
  const settings = createDesktopSettingsStore();
  const dialogs = createDialogs(document.body);
  const notices: Array<string | null> = [];
  const toasts: string[] = [];
  const toast = dialogs.toast;
  dialogs.toast = (m, o) => { toasts.push(m); toast(m, o); };
  const root = opts.root ?? document.createElement('div');
  if (!root.isConnected) {document.body.appendChild(root);}

  const registry = createDocumentRegistry({ fs: fsApi });
  const backups = createBackupScheduler({ api: appDataApi, folder: () => null, debounceMs: 20 });
  let controllerRef: DocumentController | null = null;
  let panesRef: PaneManager | null = null;
  const hosts = new Map<string, TauriHost>();
  let first: { handle: MikeDownEditorHandle; host: TauriHost } | null = null;

  const images = createImagePipeline({
    path,
    fs: fsApi,
    getDocument: () => ({ path: panesRef?.activeDoc()?.path ?? null }),
    getSettings: () => settings.get(),
    ensureSaved: () => controllerRef?.ensureSaved() ?? Promise.resolve(null),
    pickFile: (defaultDir) => dialogs.openFile({ defaultPath: defaultDir, filters: IMAGE_FILTERS, title: 'Insert Image' }),
    promptAlt: () => Promise.resolve(undefined),
    notifyError: (m) => dialogs.toast(m, { error: true }),
    notify: (m) => dialogs.toast(m),
    now: () => opts.now ?? new Date(2026, 9, 23, 14, 5, 9),
  });

  const panes = createPaneManager({
    root,
    registry,
    isMac: true,
    createEditor: (container, paneId) => {
      const host = new TauriHost({
        doc: () => panesRef?.activeDoc(paneId) ?? null,
        path,
        fs: fsApi,
        settings,
        images,
        app: {
          onModelChanged: () => controllerRef?.refresh(),
          onStats: () => {},
          openPath: (p, o) => controllerRef?.openPath(p, { ...o, paneId }) ?? Promise.resolve(false),
          notify: (m, o) => dialogs.toast(m, o),
        },
      });
      let handle: MikeDownEditorHandle;
      if (typeof handleOrFactory === 'function') {handle = handleOrFactory(host, container, paneId);}
      else if (!first) {handle = handleOrFactory;}
      else {handle = fakeHandle();}
      host.attach(handle);
      hosts.set(paneId, host);
      if (!first) {first = { handle, host };}
      return handle;
    },
    assetUrl: (p) => fsApi.assetUrl(p),
    requestClose: (paneId, index) => { void controllerRef?.closeTab(paneId, index); },
    requestCloseOthers: (paneId, index) => { void controllerRef?.closeOthers(paneId, index); },
    requestCloseSaved: (paneId) => controllerRef?.closeSaved(paneId),
    requestCloseAll: (paneId) => { void controllerRef?.closeAll(paneId); },
    tabContextEntries: () => [],
    showContextMenu: () => {},
    retry: (doc) => controllerRef?.retry(doc),
    onLayoutChanged: () => {},
    onFocusChanged: () => { controllerRef?.refresh(); },
  });
  panesRef = panes;

  registry.onChange((doc, event) => {
    if (event === 'state') {notices.push(doc.notice?.text ?? null);}
    if (event === 'text' || event === 'dirty') {backups.touch(doc); controllerRef?.refresh();}
  });

  const win = getCurrentWindow();
  const controller = createDocumentController({
    registry,
    panes,
    fs: fsApi,
    win: windowApi,
    backups,
    setTitle: (t) => win.setTitle(t),
    setStats: () => {},
    dialogs,
    path,
    isMac: true,
    downloadNoticeMs: opts.downloadNoticeMs,
    ...opts.controller,
  });
  controllerRef = controller;

  return {
    handle: first!.handle,
    host: first!.host,
    get model() {
      const doc = panes.activeDoc();
      if (!doc) {throw new Error('no document is open');}
      return doc;
    },
    registry,
    panes,
    controller,
    backups,
    settings,
    notices,
    toasts,
    hosts,
    root,
    dispose() {
      backups.dispose();
      for (const ed of panes.editors()) {try { ed.handle.destroy(); } catch { /* already gone */ }}
      root.remove();
    },
  };
}

/** Let fire-and-forget `void invoke(...)` calls settle. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {await new Promise((r) => setTimeout(r, 0));}
}
