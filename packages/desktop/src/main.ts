/**
 * MikeDown Desktop boot: one window, one document, optionally one folder.
 *
 * Mounts core with `TauriHost`, opens the file the OS or the command line
 * handed over (`frontend_ready` drains what arrived before the page was up;
 * later files come as `mikedown:open-files` events), binds the app-level
 * shortcuts from `menu/shortcuts.ts`, and guards the close button against
 * unsaved changes. M3 adds the folder sidebar (tree, watcher, folder `.md`
 * index for the knowledge-base host methods) and drag-and-drop from the OS.
 * M4 adds the document registry, tabs and hot exit.
 */
import '@mikedown/core/tokens.css';
import '@mikedown/core/styles.css';
import './styles/app.css';
import './styles/sidebar.css';

import { createMikeDownEditor, type MikeDownEditorHandle } from '@mikedown/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createDocumentController } from './app/documentController';
import { createUntitled } from './documents/documentModel';
import { fsApi, launchApi, treeApi, watchApi, windowApi } from './documents/fsApi';
import { createImagePipeline } from './host/imagePipeline';
import { createPathOps, detectPathPlatform } from './host/pathOps';
import { TauriHost } from './host/tauriHost';
import { commandForKey, SHORTCUTS, formatAccelerator, type AppCommand } from './menu/shortcuts';
import { createDesktopSettingsStore, DESKTOP_CORE_SETTING_DEFAULTS } from './settings/desktopSettings';
import { SMOKE_FIXTURE } from './smoke/fixture';
import { runSmoke, smokeEnabled } from './smoke/harness';
import { imageMimeFor, linkLabel, relativeLinkHref, routeEditorDrop } from './tree/dropRouting';
import { createFolderWorkspace } from './tree/folderWorkspace';
import { isInside } from './tree/treeLogic';
import { createChrome } from './ui/chrome';
import { showContextMenu } from './ui/contextMenu';
import { createDialogs, IMAGE_FILTERS } from './ui/dialogs';
import { createImageViewer } from './ui/imageViewer';
import { createSidebar } from './ui/sidebar';

const app = document.getElementById('app');
const container = document.getElementById('editor');
if (!app || !container) {throw new Error('MikeDown: #app / #editor missing from index.html');}

const isMac = /mac|darwin/i.test(navigator.platform) || /Macintosh/.test(navigator.userAgent);
const platform = detectPathPlatform();
const path = createPathOps(platform);
const model = createUntitled();
const settings = createDesktopSettingsStore();
const dialogs = createDialogs(document.body);

// Layout: [tab strip] / [sidebar | main column (notice, viewer, editor)] / [status].
const body = document.createElement('div');
body.className = 'mdapp-body';
const mainCol = document.createElement('div');
mainCol.className = 'mdapp-main';
app.insertBefore(body, container);
mainCol.appendChild(container);

const label = (command: AppCommand): string => {
  const row = SHORTCUTS.find((s) => s.command === command);
  return row ? `${row.label.replace(/…$/, '')} (${formatAccelerator(row.accelerator, isMac)})` : command;
};

// Late-bound: the sidebar's callbacks reach the workspace and controller.
let workspaceRef: ReturnType<typeof createFolderWorkspace> | null = null;
let controllerRef: ReturnType<typeof createDocumentController> | null = null;

const sidebar = createSidebar({
  newFile: () => { void workspaceRef?.newFile(); },
  newFolder: () => { void workspaceRef?.newFolder(); },
  toggleHidden: () => { void workspaceRef?.toggleHidden(); },
  openFolder: () => { void openFolderViaDialog(); },
  openContainingFolder: () => controllerRef?.openContainingFolder(),
  visibilityChanged: (visible) => {
    chrome.setSidebarVisible(visible);
    if (!visible && sidebar.el.contains(document.activeElement)) {handle.focus();}
  },
}, { newFileLabel: 'New File', newFolderLabel: 'New Folder', toggleLabel: label('toggleSidebar') });
body.append(sidebar.el, mainCol);

const chrome = createChrome(app, container, { isMac });
const imageViewer = createImageViewer(mainCol, container);

// Lone-file window (edge case 4): the sidebar starts collapsed, with an
// empty state offering Open Folder when shown.
sidebar.setFolder(null);
sidebar.setVisible(false);
chrome.setSidebarVisible(false);

const images = createImagePipeline({
  path,
  fs: fsApi,
  getDocument: () => ({ path: model.path, workspaceRoot: workspaceRef?.root() ?? undefined }),
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
  // The folder tree is the app's own sidebar; core's outline sidebar stays
  // off. Source mode stays available so text files can be forced into it.
  features: { sidebar: false, supportCard: false, sourceMode: true },
  hostOwnsShortcuts: true,
  // Desktop default is ON (edge case 22); served by vite.config.ts in dev and
  // copied next to index.html in release builds. `spellcheck="false"` on
  // <body> keeps the OS webview's own checker out of the way.
  spellcheckDictionaryUrl: new URL('dictionaries', document.baseURI).toString(),
  settings: { ...DESKTOP_CORE_SETTING_DEFAULTS },
});
host.attach(handle);

async function createFileWithText(p: string, content: string): Promise<void> {
  await treeApi.createFile(p);
  await fsApi.writeText(p, content, { eol: 'lf', bom: false });
}

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
  openFolder: (dir) => { void openFolder(dir); },
  onDocumentPath: (p) => {
    workspaceRef?.syncActive(p);
    syncFolderButton();
  },
  createFile: createFileWithText,
});
controllerRef = controller;

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

const workspace = createFolderWorkspace({
  path,
  isMac,
  windows: platform === 'win32',
  fs: fsApi,
  tree: treeApi,
  watch: watchApi,
  dialogs,
  settings,
  sidebar,
  doc: {
    path: () => model.path,
    open: (p) => controller.openPath(p),
    pathMoved: (from, to) => controller.pathMoved(from, to),
    pathDeleted: (p) => controller.pathDeleted(p),
  },
  setKnowledgeBase: (kb) => host.setKnowledgeBase(kb),
  refreshLinks: () => handle.refreshLinks(),
  focusEditor: () => handle.focus(),
  copyText,
});
workspaceRef = workspace;
sidebar.setTreeEl(workspace.tree.el);

/** Open Containing Folder stays useful only while the file is outside the open folder. */
function syncFolderButton(): void {
  const root = workspace.root();
  const inside = !!(root && model.path && isInside(root, model.path, path));
  chrome.setFolderButtonVisible(!inside);
  sidebar.setCanOpenContaining(!!model.path);
}

/**
 * Edge cases 4 and 5: the window switches to `dir`. The open document stays
 * when it lives inside the new folder; otherwise it closes (asking first when
 * it has unsaved changes).
 */
async function openFolder(dir: string): Promise<boolean> {
  const active = model.path;
  const keep = !!active && isInside(dir, active, path);
  if (!keep && (model.path || model.dirty)) {
    if (!(await controller.confirmDiscard())) {return false;}
    controller.closeDocument();
  }
  try {
    await workspace.open(dir);
  } catch (err) {
    await dialogs.error(`Could not open the folder ${dir}.\n\n${String(err)}`);
    return false;
  }
  sidebar.setVisible(true);
  workspace.syncActive(keep ? active : null);
  syncFolderButton();
  if (!keep) {workspace.tree.focus();}
  return true;
}

async function openFolderViaDialog(): Promise<boolean> {
  const picked = await dialogs.openFolder({
    defaultPath: workspace.root() ?? (model.path ? path.dirname(model.path) : undefined),
    title: 'Open Folder',
  });
  return picked ? openFolder(picked) : false;
}

chrome.onOpenContainingFolder(() => controller.openContainingFolder());
chrome.onToggleSidebar(() => sidebar.toggle());
chrome.onTabContextMenu((x, y) => {
  const p = model.path;
  const root = workspace.root();
  showContextMenu(x, y, [
    { label: isMac ? 'Reveal in Finder' : 'Show in Explorer', disabled: !p, run: () => { if (p) {void treeApi.revealPath(p);} } },
    { label: 'Copy Path', disabled: !p, run: () => { if (p) {void copyText(p).then(() => dialogs.toast('Path copied.'));} } },
    null,
    {
      label: 'Open Containing Folder',
      disabled: !p || (!!root && isInside(root, p, path)),
      run: () => controller.openContainingFolder(),
    },
    { label: 'Open Folder…', run: () => { void openFolderViaDialog(); } },
  ], { label: 'Document' });
});
controller.refresh();
syncFolderButton();

// ── Drag and drop from the OS (edge case 20) ────────────────────────────────
// Tauri delivers OS file drops as window events with paths; the webview never
// sees them as DOM drops. Positions are physical pixels.

function logical(pos: { x: number; y: number }): { x: number; y: number } {
  const scale = window.devicePixelRatio || 1;
  return { x: pos.x / scale, y: pos.y / scale };
}

async function dropOnEditor(paths: string[]): Promise<void> {
  for (const p of paths) {
    let isDir = false;
    try { isDir = (await fsApi.stat(p)).isDir; } catch { /* treat as a file */ }
    const action = routeEditorDrop({ path: p, isDir });
    const name = path.basename(p);
    switch (action.kind) {
      case 'image': {
        try {
          const bytes = await fsApi.readBytes(p);
          const result = await images.uploadImage({ mime: imageMimeFor(p), bytes, name });
          handle.insertImage(result);
        } catch (err) {
          // The pipeline already explained (unsaved document, size limit, …).
          console.warn('MikeDown: image drop failed', err);
        }
        break;
      }
      case 'link': {
        if (!model.path) {
          dialogs.toast('Save the document first so the link has somewhere to start from.');
          break;
        }
        handle.insertLink(relativeLinkHref(model.path, p, path), linkLabel(p, path));
        break;
      }
      case 'open':
        // One document per window until M4's tabs: the drop replaces it.
        await controller.openPath(p);
        return;
      case 'unsupported':
        dialogs.toast(isDir ? `Drop “${name}” onto the folder sidebar to copy it into the folder.` : `MikeDown cannot insert “${name}” into a document.`);
        break;
    }
  }
}

if (!smokeEnabled()) {
  void getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload;
    if (p.type === 'enter' || p.type === 'over') {
      const { x, y } = logical(p.position);
      workspace.hoverFromOutside(x, y);
      return;
    }
    if (p.type === 'leave') {
      workspace.hoverFromOutside(0, null);
      return;
    }
    const { x, y } = logical(p.position);
    void (async () => {
      if (await workspace.dropFromOutside(p.paths, x, y)) {return;}
      const over = document.elementFromPoint(x, y);
      if (over && mainCol.contains(over)) {await dropOnEditor(p.paths);}
    })();
  }).catch((err: unknown) => console.warn('MikeDown: drag and drop unavailable', err));
}

// ── App-level shortcuts (hostOwnsShortcuts): one table shared with M8's menu.
const actions: Record<AppCommand, () => void> = {
  save: () => { void controller.save(); },
  saveAs: () => { void controller.saveAs(); },
  open: () => { void controller.openViaDialog(); },
  toggleSource: () => controller.toggleSource(),
  openSettings: () => handle.command('openSettings'),
  openContainingFolder: () => controller.openContainingFolder(),
  openFolder: () => { void openFolderViaDialog(); },
  toggleSidebar: () => sidebar.toggle(),
  focusSidebar: () => {
    sidebar.setVisible(true);
    if (workspace.root()) {workspace.tree.focus();}
    else {(sidebar.el.querySelector('[data-action="open-folder"]') as HTMLButtonElement | null)?.focus();}
  },
};
window.addEventListener('keydown', (e) => {
  const inEditor = container.contains(e.target as Node);
  const command = commandForKey(e, isMac, SHORTCUTS, { inEditor });
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
  if (!first) {return;}
  // A folder (dropped on the Dock icon, passed on the command line) opens as the window's folder.
  try {
    if ((await fsApi.stat(first)).isDir) {
      await openFolder(first);
      return;
    }
  } catch { /* fall through to a file open, which reports the problem */ }
  await controller.openPath(first);
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
  (window as unknown as { mikedownWorkspace: typeof workspace }).mikedownWorkspace = workspace;
}
if (smokeEnabled()) {
  void runSmoke(handle, SMOKE_FIXTURE);
}
