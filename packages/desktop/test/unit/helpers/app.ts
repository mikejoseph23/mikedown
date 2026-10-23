/**
 * Wires model + controller + image pipeline + TauriHost the way `src/main.ts`
 * does, over the real `fsApi` / `windowApi` / dialogs, so a mocked IPC layer
 * (helpers/ipc.ts) sees exactly the `invoke` calls the app would make. Chrome
 * and the image viewer are recording stubs (pure UI, no IPC).
 */
import type { MikeDownEditorHandle } from '@mikedown/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createDocumentController, type DocumentController } from '../../../src/app/documentController';
import { createUntitled, type DocumentModel } from '../../../src/documents/documentModel';
import { fsApi, windowApi } from '../../../src/documents/fsApi';
import { createImagePipeline } from '../../../src/host/imagePipeline';
import { createPathOps, type PathPlatform } from '../../../src/host/pathOps';
import { TauriHost } from '../../../src/host/tauriHost';
import { createDesktopSettingsStore, type DesktopSettingsStore } from '../../../src/settings/desktopSettings';
import type { Chrome } from '../../../src/ui/chrome';
import { createDialogs, IMAGE_FILTERS } from '../../../src/ui/dialogs';

export interface TestApp {
  handle: MikeDownEditorHandle;
  model: DocumentModel;
  host: TauriHost;
  controller: DocumentController;
  settings: DesktopSettingsStore;
  notices: Array<string | null>;
  toasts: string[];
}

/** A handle that keeps the markdown as a string (no editor). */
export function fakeHandle(): MikeDownEditorHandle & { saved: string[] } {
  let md = '';
  const saved: string[] = [];
  const noop = (): void => {};
  return {
    saved,
    setMarkdown: (m: string) => { md = m; },
    getMarkdown: () => md,
    markSaved: (c?: string) => { saved.push(c ?? md); },
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
    insertLink: noop,
    insertImage: noop,
    refreshLinks: noop,
    on: () => noop,
    destroy: noop,
  } as unknown as MikeDownEditorHandle & { saved: string[] };
}

/**
 * `handle` may be a factory so a real core editor can be built with this
 * app's host (core needs the host at construction).
 */
export function createTestApp(handleOrFactory: MikeDownEditorHandle | ((host: TauriHost) => MikeDownEditorHandle), opts: { platform?: PathPlatform; now?: Date; editorRoot?: HTMLElement } = {}): TestApp {
  const path = createPathOps(opts.platform ?? 'posix');
  const model = createUntitled();
  const settings = createDesktopSettingsStore();
  const dialogs = createDialogs(document.body);
  const notices: Array<string | null> = [];
  const toasts: string[] = [];
  const toast = dialogs.toast;
  dialogs.toast = (m, o) => { toasts.push(m); toast(m, o); };
  const chrome: Chrome = {
    setTab: () => {},
    setStats: () => {},
    setNotice: (t) => { notices.push(t); },
    onOpenContainingFolder: () => {},
    onToggleSidebar: () => {},
    setSidebarVisible: () => {},
    setFolderButtonVisible: () => {},
    onTabContextMenu: () => {},
  };
  const imageViewer = { show: () => {}, hide: () => {}, isVisible: () => false };
  let controllerRef: DocumentController | null = null;
  const images = createImagePipeline({
    path,
    fs: fsApi,
    getDocument: () => ({ path: model.path }),
    getSettings: () => settings.get(),
    ensureSaved: () => controllerRef?.ensureSaved() ?? Promise.resolve(null),
    pickFile: (defaultDir) => dialogs.openFile({ defaultPath: defaultDir, filters: IMAGE_FILTERS, title: 'Insert Image' }),
    promptAlt: () => Promise.resolve(undefined),
    notifyError: (m) => dialogs.toast(m, { error: true }),
    notify: (m) => dialogs.toast(m),
    now: () => opts.now ?? new Date(2026, 9, 23, 14, 5, 9),
  });
  const host = new TauriHost({
    model,
    path,
    fs: fsApi,
    settings,
    images,
    app: {
      onModelChanged: () => controllerRef?.refresh(),
      onStats: () => {},
      openPath: (p, o) => controllerRef?.openPath(p, o) ?? Promise.resolve(false),
      notify: (m, o) => dialogs.toast(m, o),
    },
  });
  const handle = typeof handleOrFactory === 'function' ? handleOrFactory(host) : handleOrFactory;
  host.attach(handle);
  const win = getCurrentWindow();
  const controller = createDocumentController({
    handle,
    model,
    fs: fsApi,
    win: windowApi,
    setTitle: (t) => win.setTitle(t),
    chrome,
    dialogs,
    imageViewer,
    path,
    isMac: true,
    editorRoot: opts.editorRoot ?? document.createElement('div'),
  });
  controllerRef = controller;
  return { handle, model, host, controller, settings, notices, toasts };
}

/** Let fire-and-forget `void invoke(...)` calls settle. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {await new Promise((r) => setTimeout(r, 0));}
}
