/**
 * MikeDown Desktop boot (M2): one window, one document.
 *
 * Mounts core with `TauriHost`, opens the file the OS or the command line
 * handed over (`frontend_ready` drains what arrived before the page was up;
 * later files come as `mikedown:open-files` events), binds the app-level
 * shortcuts from `menu/shortcuts.ts`, and guards the close button against
 * unsaved changes. M4 adds the document registry, tabs and hot exit.
 */
import '@mikedown/core/tokens.css';
import '@mikedown/core/styles.css';
import './styles/app.css';

import { createMikeDownEditor, type MikeDownEditorHandle } from '@mikedown/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createDocumentController } from './app/documentController';
import { createUntitled } from './documents/documentModel';
import { fsApi, launchApi, windowApi } from './documents/fsApi';
import { createImagePipeline } from './host/imagePipeline';
import { createPathOps, detectPathPlatform } from './host/pathOps';
import { TauriHost } from './host/tauriHost';
import { commandForKey, type AppCommand } from './menu/shortcuts';
import { createDesktopSettingsStore } from './settings/desktopSettings';
import { SMOKE_FIXTURE } from './smoke/fixture';
import { runSmoke, smokeEnabled } from './smoke/harness';
import { createChrome } from './ui/chrome';
import { createDialogs, IMAGE_FILTERS } from './ui/dialogs';
import { createImageViewer } from './ui/imageViewer';

const app = document.getElementById('app');
const container = document.getElementById('editor');
if (!app || !container) {throw new Error('MikeDown: #app / #editor missing from index.html');}

const isMac = /mac|darwin/i.test(navigator.platform) || /Macintosh/.test(navigator.userAgent);
const path = createPathOps(detectPathPlatform());
const model = createUntitled();
const settings = createDesktopSettingsStore();
const dialogs = createDialogs(document.body);
const chrome = createChrome(app, container, { isMac });
const imageViewer = createImageViewer(app, container);

// The controller needs the handle and the host needs the controller; the
// host reaches the controller through these late-bound callbacks.
let controllerRef: ReturnType<typeof createDocumentController> | null = null;

const images = createImagePipeline({
  path,
  fs: fsApi,
  getDocument: () => ({ path: model.path }),
  getSettings: () => settings.get(),
  ensureSaved: () => controllerRef?.ensureSaved() ?? Promise.resolve(null),
  pickFile: (defaultDir) => dialogs.openFile({ defaultPath: defaultDir, filters: IMAGE_FILTERS, title: 'Insert Image' }),
  promptAlt: () => dialogs.prompt('Alt text for the image (leave empty for none)', { placeholder: 'Describe the image for screen readers', okLabel: 'Insert' }),
  notifyError: (message) => dialogs.toast(message, { error: true, ms: 6000 }),
  notify: (message) => dialogs.toast(message),
});

const host = new TauriHost({
  model,
  path,
  fs: fsApi,
  settings,
  images,
  app: {
    onModelChanged: () => controllerRef?.refresh(),
    onStats: (stats) => controllerRef?.onStats(stats),
    openPath: (p, opts) => controllerRef?.openPath(p, opts) ?? Promise.resolve(false),
    notify: (message, opts) => dialogs.toast(message, opts),
  },
});

const handle: MikeDownEditorHandle = createMikeDownEditor(container, {
  host,
  initialMarkdown: smokeEnabled() ? SMOKE_FIXTURE : '',
  theme: 'auto',
  // Lone-file layout (edge case 4): no sidebar. Source mode stays available
  // so text files can be forced into it.
  features: { sidebar: false, supportCard: false, sourceMode: true },
  hostOwnsShortcuts: true,
  // Desktop default is ON (edge case 22); served by vite.config.ts in dev and
  // copied next to index.html in release builds. `spellcheck="false"` on
  // <body> keeps the OS webview's own checker out of the way.
  spellcheckDictionaryUrl: new URL('dictionaries', document.baseURI).toString(),
  settings: { spellCheckEnabled: true },
});
host.attach(handle);

const tauriWindow = getCurrentWindow();
const controller = createDocumentController({
  handle,
  model,
  fs: fsApi,
  win: windowApi,
  setTitle: (title) => tauriWindow.setTitle(title),
  chrome,
  dialogs,
  imageViewer,
  path,
  isMac,
  editorRoot: container,
});
controllerRef = controller;
chrome.onOpenContainingFolder(() => controller.openContainingFolder());
controller.refresh();

// App-level shortcuts (hostOwnsShortcuts): one table shared with M8's menu.
const actions: Record<AppCommand, () => void> = {
  save: () => { void controller.save(); },
  saveAs: () => { void controller.saveAs(); },
  open: () => { void controller.openViaDialog(); },
  toggleSource: () => controller.toggleSource(),
  openSettings: () => handle.command('openSettings'),
  openContainingFolder: () => controller.openContainingFolder(),
};
window.addEventListener('keydown', (e) => {
  const command = commandForKey(e, isMac);
  if (!command) {return;}
  e.preventDefault();
  actions[command]();
});

// Close button with unsaved changes: ask before the window goes (hot exit
// and the Save All dialog are M4).
void tauriWindow.onCloseRequested(async (event) => {
  if (!model.dirty) {return;}
  const ok = await controller.confirmDiscard();
  if (!ok) {event.preventDefault();}
});

// Files from the OS: command line / file association at launch, then macOS
// open-file events and second launches while running.
async function openLaunchFiles(paths: string[]): Promise<void> {
  // One window, one document until M4: the first path wins.
  const first = paths.find((p) => p.length > 0);
  if (first) {await controller.openPath(first);}
}
if (!smokeEnabled()) {
  void launchApi.onOpenFiles((paths) => { void openLaunchFiles(paths); });
  void launchApi.frontendReady().then(openLaunchFiles).catch((err: unknown) => {
    console.warn('MikeDown: launch queue unavailable', err);
  });
}

handle.focus();

// Dev / smoke builds expose the handle for Web Inspector poking and run the
// WebKit / WebView2 checks that fill docs/webview-notes.md.
if (import.meta.env.DEV || smokeEnabled()) {
  (window as unknown as { mikedown: MikeDownEditorHandle; mikedownModel: typeof model }).mikedown = handle;
  (window as unknown as { mikedownModel: typeof model }).mikedownModel = model;
}
if (smokeEnabled()) {
  void runSmoke(handle, SMOKE_FIXTURE);
}
