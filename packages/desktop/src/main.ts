/**
 * MikeDown Desktop boot: one window, its panes and tabs, optionally one
 * folder.
 *
 * Restores the window's session (edge case 28) and any hot-exit backups
 * (edge cases 7–8), mounts one core editor per pane with `TauriHost`, opens
 * the files the OS or the command line handed over (`frontend_ready` drains
 * what arrived before the page was up; later files come as
 * `mikedown:open-files` events), binds the app-level shortcuts from
 * `menu/shortcuts.ts` (and the native menu's events), and guards the close
 * button and quit against unsaved changes. M3 added the folder sidebar
 * (tree, watcher, folder `.md` index for the knowledge-base host methods)
 * and drag-and-drop from the OS; M4 the document registry, panes, tabs,
 * hot exit, sessions and several windows.
 */
import '@mikedown/core/tokens.css';
import '@mikedown/core/styles.css';
import './styles/app.css';
import './styles/sidebar.css';
import './styles/panes.css';

import { createMikeDownEditor, type MikeDownEditorHandle, type MikeDownViewState } from '@mikedown/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createDocumentController } from './app/documentController';
import { createBackupScheduler, planRestore } from './documents/backups';
import { checkExternalChanges, createDocumentRegistry, planOpen, type DocumentModel } from './documents/documentModel';
import { appDataApi, fsApi, launchApi, treeApi, watchApi, windowApi, windowsApi } from './documents/fsApi';
import { createSessionWriter, layoutFromSession, parseSession, serializeSession, type SessionData, type SessionTab } from './documents/session';
import { createImagePipeline } from './host/imagePipeline';
import { createPathOps, detectPathPlatform } from './host/pathOps';
import { TauriHost } from './host/tauriHost';
import { commandForKey, SHORTCUTS, formatAccelerator, type AppCommand } from './menu/shortcuts';
import { createPaneManager } from './panes/paneManager';
import { createDesktopSettingsStore, DESKTOP_CORE_SETTING_DEFAULTS } from './settings/desktopSettings';
import { SMOKE_FIXTURE } from './smoke/fixture';
import { runSmoke, smokeEnabled } from './smoke/harness';
import { imageMimeFor, linkLabel, relativeLinkHref, routeEditorDrop } from './tree/dropRouting';
import { createFolderWorkspace } from './tree/folderWorkspace';
import { isInside } from './tree/treeLogic';
import { createChrome } from './ui/chrome';
import { showContextMenu } from './ui/contextMenu';
import { createDialogs, IMAGE_FILTERS } from './ui/dialogs';
import { createSidebar } from './ui/sidebar';
import { createExporter } from './export/exporter';
import { exportStylesheet } from './export/exportCss';

const app = document.getElementById('app');
const container = document.getElementById('editor');
if (!app || !container) {throw new Error('MikeDown: #app / #editor missing from index.html');}

const isMac = /mac|darwin/i.test(navigator.platform) || /Macintosh/.test(navigator.userAgent);
const platform = detectPathPlatform();
const path = createPathOps(platform);
const settings = createDesktopSettingsStore();
const dialogs = createDialogs(document.body);
const tauriWindow = getCurrentWindow();
const windowLabel = tauriWindow.label || 'main';
const isMainWindow = windowLabel === 'main';
/** Session writes start once boot has restored the previous session. */
let booted = false;
let reportTimer: ReturnType<typeof setTimeout> | undefined;

// Layout: [sidebar | main column (panes)] / [status]. The placeholder
// #editor from index.html becomes the panes container.
const body = document.createElement('div');
body.className = 'mdapp-body';
const mainCol = document.createElement('div');
mainCol.className = 'mdapp-main';
app.insertBefore(body, container);
container.remove();

const label = (command: AppCommand): string => {
  const row = SHORTCUTS.find((s) => s.command === command);
  return row ? `${row.label.replace(/…$/, '')} (${formatAccelerator(row.accelerator, isMac)})` : command;
};

// Late-bound: the sidebar's callbacks reach the workspace and controller.
let workspaceRef: ReturnType<typeof createFolderWorkspace> | null = null;
let controllerRef: ReturnType<typeof createDocumentController> | null = null;
let exporterRef: ReturnType<typeof createExporter> | null = null;

const sidebar = createSidebar({
  newFile: () => { void workspaceRef?.newFile(); },
  newFolder: () => { void workspaceRef?.newFolder(); },
  toggleHidden: () => { void workspaceRef?.toggleHidden(); },
  openFolder: () => { void openFolderViaDialog(); },
  openContainingFolder: () => controllerRef?.openContainingFolder(),
  visibilityChanged: (visible) => {
    chrome.setSidebarVisible(visible);
    if (!visible && sidebar.el.contains(document.activeElement)) {panes.focusActiveEditor();}
    scheduleSession();
  },
}, { newFileLabel: 'New File', newFolderLabel: 'New Folder', toggleLabel: label('toggleSidebar') });
body.append(sidebar.el, mainCol);

const chrome = createChrome(app, { isMac });

// Lone-file window (edge case 4): the sidebar starts collapsed, with an
// empty state offering Open Folder when shown.
sidebar.setFolder(null);
sidebar.setVisible(false);
chrome.setSidebarVisible(false);

// ── Documents, backups, panes ───────────────────────────────────────────────

const registry = createDocumentRegistry({ fs: fsApi });

const backups = createBackupScheduler({
  api: appDataApi,
  folder: () => workspaceRef?.root() ?? null,
});

const images = createImagePipeline({
  path,
  fs: fsApi,
  getDocument: () => ({ path: panes.activeDoc()?.path ?? null, workspaceRoot: workspaceRef?.root() ?? undefined }),
  getSettings: () => settings.get(),
  ensureSaved: () => controllerRef?.ensureSaved() ?? Promise.resolve(null),
  pickFile: (defaultDir) => dialogs.openFile({ defaultPath: defaultDir, filters: IMAGE_FILTERS, title: 'Insert Image' }),
  promptAlt: () => dialogs.prompt('Alt text for the image (leave empty for none)', { placeholder: 'Describe the image for screen readers', okLabel: 'Insert' }),
  notifyError: (message) => dialogs.toast(message, { error: true, ms: 6000 }),
  notify: (message) => dialogs.toast(message),
});

const hosts = new Map<string, TauriHost>();

function createEditor(editorEl: HTMLElement, paneId: string): MikeDownEditorHandle {
  const host = new TauriHost({
    doc: () => panes.activeDoc(paneId),
    path,
    fs: fsApi,
    settings,
    images,
    app: {
      onModelChanged: () => { controllerRef?.refresh(); },
      onStats: (stats) => controllerRef?.onStats(paneId, stats),
      openPath: (p, opts) => controllerRef?.openPath(p, { ...opts, paneId }) ?? Promise.resolve(false),
      notify: (message, opts) => dialogs.toast(message, opts),
      exportHtml: (html) => { void exporterRef?.exportHtml(html); },
      printDocument: (html) => { void exporterRef?.print(html); },
    },
  });
  const kb = workspaceRef?.knowledgeBase() ?? null;
  if (kb) {host.setKnowledgeBase(kb);}
  const handle = createMikeDownEditor(editorEl, {
    host,
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
  hosts.set(paneId, host);
  handle.on('change', () => scheduleSession());
  return handle;
}

const panes = createPaneManager({
  root: mainCol,
  registry,
  isMac,
  createEditor,
  assetUrl: (p) => fsApi.assetUrl(p),
  requestClose: (paneId, index) => { void controller.closeTab(paneId, index); },
  requestCloseOthers: (paneId, index) => { void controller.closeOthers(paneId, index); },
  requestCloseSaved: (paneId) => controller.closeSaved(paneId),
  requestCloseAll: (paneId) => { void controller.closeAll(paneId); },
  tabContextEntries: (doc) => {
    const p = doc.path;
    const root = workspace.root();
    return [
      { label: isMac ? 'Reveal in Finder' : 'Show in Explorer', disabled: !p, run: () => { if (p) {void treeApi.revealPath(p);} } },
      { label: 'Copy Path', disabled: !p, run: () => { if (p) {void copyText(p).then(() => dialogs.toast('Path copied.'));} } },
      null,
      {
        label: 'Open Containing Folder',
        disabled: !p || (!!root && isInside(root, p, path)),
        run: () => { if (p && openFolderRef) {void openFolderRef(path.dirname(p));} },
      },
      { label: 'Open Folder…', run: () => { void openFolderViaDialog(); } },
    ];
  },
  showContextMenu: (x, y, entries, menuLabel) => showContextMenu(x, y, entries, { label: menuLabel }),
  retry: (doc) => controller.retry(doc),
  onLayoutChanged: () => { scheduleSession(); reportWindowState(); },
  onFocusChanged: (paneId) => {
    controllerRef?.refresh();
    const ed = panes.editor(paneId);
    if (ed?.stats) {chrome.setStats(ed.stats);}
    syncFolderButton();
  },
  leading: chrome.sidebarToggle,
  trailing: () => chrome.folderButton(),
  emptyStripDoubleClick: () => { controllerRef?.newDocument(); },
});

// The panes container keeps the `#editor` id index.html had, so `#editor
// .ProseMirror` still finds the editors (specs, Web Inspector habits).
panes.el.id = 'editor';

// Stats arrive per pane; keep the last ones so a focus change can show them.
const paneStats = new Map<string, Parameters<typeof chrome.setStats>[0]>();

async function createFileWithText(p: string, content: string): Promise<void> {
  await treeApi.createFile(p);
  await fsApi.writeText(p, content, { eol: 'lf', bom: false });
}

exporterRef = createExporter({
  path,
  fs: fsApi,
  dialogs,
  doc: () => panes.activeDoc(),
  html: () => panes.activeHandle()?.getHtml() ?? null,
  stylesheet: exportStylesheet,
});

const controller = createDocumentController({
  registry,
  panes,
  fs: fsApi,
  win: windowApi,
  backups,
  setTitle: (title) => tauriWindow.setTitle(title),
  setStats: (stats) => chrome.setStats(stats),
  dialogs,
  path,
  isMac,
  openFolder: (dir) => { void openFolder(dir); },
  onActiveDocument: (doc) => {
    workspaceRef?.syncActive(doc?.path ?? null);
    syncFolderButton();
    scheduleSession();
  },
  onDocumentsChanged: () => { reportWindowState(); scheduleSession(); },
  createFile: createFileWithText,
});
controllerRef = controller;
const baseOnStats = controller.onStats;
controller.onStats = (paneId, stats) => {
  paneStats.set(paneId, stats);
  baseOnStats(paneId, stats);
};

// Dirty tracking → backups, tab dots, title.
registry.onChange((doc, event) => {
  if (event === 'text' || event === 'dirty') {
    backups.touch(doc);
    controller.refresh();
  }
  if (event === 'closed') {
    void backups.clear(doc);
  }
});

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
    path: () => panes.activeDoc()?.path ?? null,
    open: (p) => controller.openPath(p),
    pathMoved: (from, to) => controller.pathMoved(from, to),
    pathDeleted: (p) => controller.pathDeleted(p),
  },
  setKnowledgeBase: (kb) => { for (const host of hosts.values()) {host.setKnowledgeBase(kb);} },
  refreshLinks: () => { for (const ed of panes.editors()) {ed.handle.refreshLinks();} },
  focusEditor: () => panes.focusActiveEditor(),
  copyText,
});
workspaceRef = workspace;
sidebar.setTreeEl(workspace.tree.el);
workspace.tree.el.addEventListener('click', () => scheduleSession());
workspace.tree.el.addEventListener('keydown', () => scheduleSession());

/** Open Containing Folder stays useful only while the file is outside the open folder. */
function syncFolderButton(): void {
  const root = workspace.root();
  const docPath = panes.activeDoc()?.path ?? null;
  const inside = !!(root && docPath && isInside(root, docPath, path));
  chrome.setFolderButtonVisible(!!docPath && !inside);
  sidebar.setCanOpenContaining(!!docPath);
}

/** Tell Rust which folder and files this window has (file routing, edge case 6). */
function reportWindowState(): void {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => {
    const files = registry.all().map((d) => d.path).filter((p): p is string => !!p);
    void windowsApi.reportState(workspace.root(), files).catch(() => { /* not under Tauri */ });
  }, 50);
}

/**
 * Edge cases 4 and 5: the window switches to `dir`. Documents inside the new
 * folder stay open; the others close, asking about unsaved changes first.
 */
async function openFolder(dir: string): Promise<boolean> {
  const t0 = performance.now();
  const outside = registry.all().filter((d) => d.path && !isInside(dir, d.path, path));
  if (outside.length) {
    if (!(await controller.confirmCloseAll('close', outside))) {return false;}
    const ids = new Set(outside.map((d) => d.id));
    for (const pane of paneList()) {panes.closeTabs(pane, (d) => ids.has(d.id));}
  }
  try {
    await workspace.open(dir);
  } catch (err) {
    await dialogs.error(`Could not open the folder ${dir}.\n\n${String(err)}`);
    return false;
  }
  sidebar.setVisible(true);
  workspace.syncActive(panes.activeDoc()?.path ?? null);
  syncFolderButton();
  reportWindowState();
  scheduleSession();
  if (!panes.activeDoc()) {workspace.tree.focus();}
  if (timingEnabled) {
    // Rows are in the DOM (layout forced by offsetHeight). Not rAF: frames
    // do not run while the window is hidden or the screen is locked.
    const height = workspace.tree.el.offsetHeight;
    reportTiming('folder-open', { dir, ms: Math.round(performance.now() - t0), rows: workspace.tree.el.childElementCount, height });
  }
  return true;
}
const openFolderRef = openFolder;

function paneList(): string[] {
  const out: string[] = [];
  const walk = (n: ReturnType<typeof panes.layout>): void => {
    if (n.kind === 'pane') {out.push(n.id);}
    else {n.children.forEach(walk);}
  };
  walk(panes.layout());
  return out;
}

async function openFolderViaDialog(): Promise<boolean> {
  const current = panes.activeDoc()?.path;
  const picked = await dialogs.openFolder({
    defaultPath: workspace.root() ?? (current ? path.dirname(current) : undefined),
    title: 'Open Folder',
  });
  return picked ? openFolder(picked) : false;
}

chrome.onOpenContainingFolder(() => controller.openContainingFolder());
chrome.onToggleSidebar(() => sidebar.toggle());
controller.refresh();
syncFolderButton();

// ── Session (edge case 28) ─────────────────────────────────────────────────

function sessionSnapshot(): SessionData {
  return serializeSession({
    folder: workspace.root(),
    sidebarVisible: sidebar.isVisible(),
    expandedDirs: workspace.tree.expandedDirs(),
    layout: panes.layout(),
    focusedPane: panes.focusedPaneId(),
    doc: (id) => registry.byId(id),
    liveViewState: (paneId) => panes.viewState(paneId),
  });
}

const session = createSessionWriter({
  api: appDataApi,
  label: windowLabel,
  snapshot: () => (booted && !smokeEnabled() ? sessionSnapshot() : null),
});
function scheduleSession(): void {
  if (booted) {session.schedule();}
}
// Cursor moves and scrolling count too, lightly.
document.addEventListener('selectionchange', () => scheduleSession());
mainCol.addEventListener('scroll', () => scheduleSession(), { capture: true, passive: true });

/** Open every tab a session names, skipping files that are gone. */
async function restoreSession(data: SessionData, backupsByUntitled: Map<string, string>): Promise<void> {
  if (data.folder) {
    let ok = false;
    try { ok = (await fsApi.stat(data.folder)).isDir; } catch { /* gone */ }
    if (ok) {await openFolder(data.folder);}
  }
  const docIds = new Map<SessionTab, string>();
  const paths = new Set<string>();
  const walk = (n: SessionData['layout']): void => {
    if (n.kind === 'pane') {for (const t of n.tabs) {if (t.path) {paths.add(t.path);}}}
    else {n.children.forEach(walk);}
  };
  walk(data.layout);
  for (const p of paths) {
    let exists = false;
    try { exists = (await fsApi.stat(p)).isFile; } catch { /* unreadable */ }
    if (!exists) {continue;}
    if (registry.get(p)) {continue;}
    const kind = planOpen(p, { encoding: 'utf8', readOnly: false, size: 0 }).kind;
    if (kind === 'image') {
      try { await fsApi.allowAsset(p); registry.image(p); } catch { /* skip */ }
      continue;
    }
    if (kind === 'other') {continue;}
    try {
      const info = await fsApi.readText(p);
      registry.open(p, info, planOpen(p, info));
    } catch { /* skip the tab */ }
  }
  const { layout, focusedPane } = layoutFromSession(data, (tab) => {
    if (tab.path) {return registry.get(tab.path)?.id ?? null;}
    if (tab.untitledId) {
      const text = backupsByUntitled.get(tab.untitledId);
      if (text === undefined) {return null;}
      const doc = registry.byId(tab.untitledId) ?? registry.untitled({ id: tab.untitledId, text });
      backups.noteWritten(doc);
      backupsByUntitled.delete(tab.untitledId);
      docIds.set(tab, doc.id);
      return doc.id;
    }
    return null;
  });
  panes.setLayout(layout, focusedPane);
  if (!data.sidebarVisible) {sidebar.setVisible(false);}
  for (const dir of data.expandedDirs) {
    if (workspace.root() && isInside(workspace.root()!, dir, path)) {
      await workspace.tree.reveal(dir, { focus: false }).catch(() => { /* gone */ });
    }
  }
  workspace.tree.setActive(panes.activeDoc()?.path ?? null);
}

/** Hot exit (edge cases 7–8): leftovers become dirty tabs, no dialog. */
async function restoreBackups(): Promise<Map<string, string>> {
  const byUntitled = new Map<string, string>();
  if (!isMainWindow) {return byUntitled;}
  let entries;
  try {
    entries = await appDataApi.backupList();
  } catch (err) {
    console.warn('MikeDown: backups unavailable', err);
    return byUntitled;
  }
  for (const step of planRestore(entries)) {
    if (step.kind === 'untitled') {byUntitled.set(step.id, step.text);}
  }
  return byUntitled;
}

async function applyFileBackups(entries: Awaited<ReturnType<typeof appDataApi.backupList>>): Promise<void> {
  for (const step of planRestore(entries)) {
    if (step.kind !== 'file') {continue;}
    let doc = registry.get(step.path);
    if (!doc) {
      try {
        const info = await fsApi.readText(step.path);
        doc = registry.open(step.path, info, planOpen(step.path, info));
      } catch {
        // The file is gone: keep the text as an unsaved document.
        doc = registry.untitled({ text: step.text });
        doc.replaceText(step.text);
        panes.open(doc, { focus: false });
        continue;
      }
    }
    if (doc.kind === 'image') {continue;}
    doc.replaceText(step.text);
    if (!doc.dirty) {
      // The disk already has this text (saved after the backup): nothing to restore.
      void backups.clear(doc);
      continue;
    }
    backups.noteWritten(doc);
    if (!paneList().some((id) => panes.tabIndex(id, doc!) >= 0)) {panes.open(doc, { focus: false });}
    panes.refreshDoc(doc);
  }
}

// ── Timing probes (VITE_MIKEDOWN_TIMING=1 dev builds only) ─────────────────
const timingEnabled = import.meta.env.VITE_MIKEDOWN_TIMING === '1';
function reportTiming(name: string, data: Record<string, unknown>): void {
  void import('@tauri-apps/api/core').then(({ invoke }) =>
    invoke('smoke_report', { name: `timing-${name}`, report: JSON.stringify({ ...data, epochMs: Date.now() }) }));
}
if (timingEnabled) {
  void watchApi.onChange((c) => reportTiming('fs-changed', { kind: c.kind, path: c.path }));
  const seen = new Set<string>();
  new MutationObserver(() => {
    for (const row of workspace.tree.el.querySelectorAll<HTMLElement>('.mdapp-tree__row')) {
      const p = row.dataset.path ?? '';
      if (seen.has(p)) {continue;}
      seen.add(p);
      if (/probe-/.test(p)) {reportTiming('row-shown', { path: p });}
    }
  }).observe(workspace.tree.el, { childList: true });
}

// ── Drag and drop from the OS (edge case 20) ────────────────────────────────
// Tauri delivers OS file drops as window events with paths; the webview never
// sees them as DOM drops. Positions are physical pixels.

function logical(pos: { x: number; y: number }): { x: number; y: number } {
  const scale = window.devicePixelRatio || 1;
  return { x: pos.x / scale, y: pos.y / scale };
}

async function dropOnEditor(paths: string[], paneId: string): Promise<void> {
  panes.setFocused(paneId);
  for (const p of paths) {
    let isDir = false;
    try { isDir = (await fsApi.stat(p)).isDir; } catch { /* treat as a file */ }
    const action = routeEditorDrop({ path: p, isDir });
    const name = path.basename(p);
    const doc = panes.activeDoc(paneId);
    const handle = panes.editor(paneId)?.handle;
    switch (action.kind) {
      case 'image': {
        if (!handle) {break;}
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
        if (!doc?.path || !handle) {
          dialogs.toast('Save the document first so the link has somewhere to start from.');
          break;
        }
        handle.insertLink(relativeLinkHref(doc.path, p, path), linkLabel(p, path));
        break;
      }
      case 'open':
        await controller.openPath(p, { paneId });
        break;
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
      const paneEl = over?.closest('.mdapp-pane') as HTMLElement | null;
      if (paneEl?.dataset.paneId) {await dropOnEditor(p.paths, paneEl.dataset.paneId);}
      else if (over && mainCol.contains(over)) {await dropOnEditor(p.paths, panes.focusedPaneId());}
    })();
  }).catch((err: unknown) => console.warn('MikeDown: drag and drop unavailable', err));
}

// ── App-level shortcuts (hostOwnsShortcuts): one table shared with the menu.
const actions: Record<AppCommand, () => void> = {
  newDocument: () => { controller.newDocument(); },
  save: () => { void controller.save(); },
  saveAs: () => { void controller.saveAs(); },
  saveAll: () => { void controller.saveAll(); },
  open: () => { void controller.openViaDialog(); },
  toggleSource: () => controller.toggleSource(),
  openSettings: () => panes.activeHandle()?.command('openSettings'),
  openContainingFolder: () => controller.openContainingFolder(),
  openFolder: () => { void openFolderViaDialog(); },
  toggleSidebar: () => sidebar.toggle(),
  focusSidebar: () => {
    sidebar.setVisible(true);
    if (workspace.root()) {workspace.tree.focus();}
    else {(sidebar.el.querySelector('[data-action="open-folder"]') as HTMLButtonElement | null)?.focus();}
  },
  closeTab: () => {
    const pane = panes.focusedPane();
    if (pane.active >= 0) {void controller.closeTab(pane.id, pane.active);}
  },
  nextTab: () => panes.cycle(1),
  prevTab: () => panes.cycle(-1),
  splitRight: () => panes.split('row'),
  splitDown: () => panes.split('column'),
  print: () => { void exporterRef?.print(); },
  newWindow: () => { void windowsApi.newWindow().catch((err: unknown) => dialogs.toast(`Could not open a window: ${String(err)}`, { error: true })); },
};
const menuOnly: Record<string, () => void> = {
  closeWindow: () => { void tauriWindow.close(); },
  exportHtml: () => { void exporterRef?.exportHtml(); },
  exportPdf: () => { void exporterRef?.print(); },
};
window.addEventListener('keydown', (e) => {
  const inEditor = !!(e.target as HTMLElement | null)?.closest?.('.mikedown-root');
  const command = commandForKey(e, isMac, SHORTCUTS, { inEditor });
  if (!command) {return;}
  e.preventDefault();
  actions[command]();
});
if (!smokeEnabled()) {
  void windowsApi.onMenu((command) => {
    if (command in actions) {actions[command as AppCommand]();}
    else if (command in menuOnly) {menuOnly[command]();}
  }).catch(() => { /* not under Tauri */ });
}

// ── Close and quit (edge case 7) ───────────────────────────────────────────

let closing = false;
void tauriWindow.onCloseRequested(async (event) => {
  if (closing) {return;}
  const ok = await controller.confirmCloseAll('close');
  if (!ok) {
    event.preventDefault();
    return;
  }
  closing = true;
  await session.flush();
  // A window closed by hand while others stay open does not come back on
  // the next launch; the last window's session does (that is a quit).
  try {
    if ((await windowsApi.windowCount()) > 1) {await appDataApi.sessionRemove(windowLabel);}
  } catch { /* not under Tauri */ }
});

if (!smokeEnabled()) {
  void windowsApi.onQuitRequested(async () => {
    const ok = await controller.confirmCloseAll('quit');
    if (ok) {
      closing = true;
      await session.flush();
    }
    await windowsApi.quitReply(ok).catch(() => { /* not under Tauri */ });
  }).catch(() => { /* not under Tauri */ });
}

// Cross-window edits of the same file (edge case 6): compare mtimes when the
// window gains focus; M6 turns the mark into UI.
if (!smokeEnabled()) {
  void tauriWindow.onFocusChanged(({ payload: focused }) => {
    if (focused) {void checkExternalChanges(registry.all(), (p) => fsApi.stat(p)).then((docs) => { for (const d of docs) {panes.refreshDoc(d);} });}
  }).catch(() => { /* not under Tauri */ });
}

// Files from the OS: command line / file association at launch, then macOS
// open-file events and second launches while running.
async function openLaunchFiles(paths: string[]): Promise<void> {
  for (const p of paths.filter((x) => x.length > 0)) {
    // A folder (dropped on the Dock icon, passed on the command line) opens as the window's folder.
    let isDir = false;
    try { isDir = (await fsApi.stat(p)).isDir; } catch { /* fall through to a file open, which reports the problem */ }
    if (isDir) {await openFolder(p);}
    else {await controller.openPath(p);}
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  if (smokeEnabled()) {
    const doc = registry.untitled({ text: SMOKE_FIXTURE });
    doc.dirty = false;
    doc.savedText = SMOKE_FIXTURE;
    panes.open(doc);
    booted = true;
    const handle = panes.activeHandle();
    if (handle) {void runSmoke(handle, SMOKE_FIXTURE);}
    return;
  }

  let entries: Awaited<ReturnType<typeof appDataApi.backupList>> = [];
  let byUntitled = new Map<string, string>();
  try {
    byUntitled = await restoreBackups();
    if (isMainWindow) {entries = await appDataApi.backupList();}
  } catch { /* no app data */ }

  let data: SessionData | null = null;
  try {
    data = parseSession(await appDataApi.sessionRead(windowLabel));
  } catch { /* no session */ }
  if (data) {
    try {
      await restoreSession(data, byUntitled);
    } catch (err) {
      console.warn('MikeDown: session restore failed', err);
    }
  }
  // Backups for files (dirty text over the saved file) and untitled ones no
  // session tab claimed.
  try {
    await applyFileBackups(entries);
    for (const [id, text] of byUntitled) {
      const doc = registry.untitled({ id, text });
      backups.noteWritten(doc);
      panes.open(doc, { focus: false });
    }
  } catch (err) {
    console.warn('MikeDown: backup restore failed', err);
  }

  // Other windows from the last run (the main window re-creates them).
  if (isMainWindow) {
    try {
      for (const entry of await appDataApi.sessionList()) {
        if (entry.label === 'main' || entry.label === windowLabel) {continue;}
        const other = parseSession(entry.data);
        if (!other) {continue;}
        let worth = !!other.folder;
        if (!worth) {
          const walk = (n: SessionData['layout']): void => {
            if (n.kind === 'pane') {worth = worth || n.tabs.some((t) => !!t.path || !!t.untitledId);}
            else {n.children.forEach(walk);}
          };
          walk(other.layout);
        }
        if (worth) {await windowsApi.newWindow({ label: entry.label });}
        else {await appDataApi.sessionRemove(entry.label);}
      }
    } catch { /* not under Tauri */ }
  }

  booted = true;
  reportWindowState();
  if (panes.activeDoc()) {panes.focusActiveEditor();}
  scheduleSession();

  void launchApi.onOpenFiles((paths) => { void openLaunchFiles(paths); });
  try {
    await openLaunchFiles(await launchApi.frontendReady());
  } catch (err) {
    console.warn('MikeDown: launch queue unavailable', err);
  }
  if (!panes.activeDoc() && paneList().length === 1 && !workspace.root()) {
    // Nothing to show and no folder to browse: an empty Untitled document,
    // as a fresh editor window has. A folder window starts on its tree.
    controller.newDocument();
  }
}

void boot();

// Dev / smoke builds expose the handle for Web Inspector poking and run the
// WebKit / WebView2 checks that fill docs/webview-notes.md. The e2e specs
// read the same hooks.
if (import.meta.env.DEV || smokeEnabled()) {
  const w = window as unknown as Record<string, unknown>;
  Object.defineProperty(w, 'mikedown', { get: () => panes.activeHandle(), configurable: true });
  Object.defineProperty(w, 'mikedownModel', { get: () => panes.activeDoc(), configurable: true });
  w.mikedownWorkspace = workspace;
  w.mikedownApp = {
    panes,
    registry,
    controller,
    layout: () => panes.layout(),
    session: () => sessionSnapshot(),
    docs: () => registry.all().map((d: DocumentModel) => ({ id: d.id, path: d.path, dirty: d.dirty, text: d.text, state: d.state })),
    viewState: (paneId: string): MikeDownViewState | undefined => panes.viewState(paneId),
  };
}
