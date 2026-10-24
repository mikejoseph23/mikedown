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
import './styles/settings.css';
import './styles/search.css';
import './styles/versions.css';
import './styles/welcome.css';

import { createMikeDownEditor, type MikeDownEditorHandle, type MikeDownViewState } from '@mikedown/core';
import { getVersion } from '@tauri-apps/api/app';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createDocumentController } from './app/documentController';
import { createBackupScheduler, planRestore } from './documents/backups';
import { createDocumentRegistry, planOpen, type DocumentModel } from './documents/documentModel';
import { appDataApi, fsApi, launchApi, searchApi, treeApi, watchApi, windowApi, windowsApi } from './documents/fsApi';
import { createSessionWriter, layoutFromSession, parseSession, serializeSession, type SessionData, type SessionTab } from './documents/session';
import { createImagePipeline } from './host/imagePipeline';
import { createPathOps, detectPathPlatform } from './host/pathOps';
import { TauriHost } from './host/tauriHost';
import {
  COMMANDS, SHORTCUTS, ISSUES_URL, WEBSITE_URL, chordKey, enablement, formatAccelerator, isEnabled, rowFor, rowForKey, rowsFor,
  type AppCommand, type CommandId, type MenuContext, type ShortcutRow,
} from './menu/shortcuts';
import { buildMenuSpec, recentMenuItems, RECENT_FILE_PREFIX, RECENT_FOLDER_PREFIX, type MenuNode } from './menu/menuSpec';
import { createRecentsStore, recentsApi, baseName, tildify, type RecentKind } from './app/recents';
import { createWelcome } from './ui/welcome';
import { showShortcutsSheet } from './ui/shortcutsSheet';
import { menuApi } from './menu/menuApi';
import { createPaneManager } from './panes/paneManager';
import { createAppActions } from './settings/appActions';
import { createAppTabSection } from './settings/appTab';
import { createSettingsBanner } from './settings/banner';
import { settingsApi } from './settings/settingsApi';
import { createSettingsManager } from './settings/store';
import { createSearchController } from './search/searchLogic';
import { createSearchPanel } from './search/searchPanel';
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
import { createVersioning, type VersionSnapshot } from './documents/versioning';
import { versionsApi } from './documents/fsApi';
import { showDiff } from './ui/diffView';
import { createVersionsPanel, restoreIntoDocument } from './ui/versions';

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
let toggleSearchRef: (() => void) | null = null;
let searchPanelRef: ReturnType<typeof createSearchPanel> | null = null;
let toggleVersionsRef: (() => void) | null = null;
let refreshVersionsRef: (() => void) | null = null;
let showVersionsRef: (() => void) | null = null;
let syncWelcomeRef: (() => void) | null = null;
let noteRecent: (kind: RecentKind, path: string) => void = () => { /* bound below */ };

const sidebar = createSidebar({
  newFile: () => { void workspaceRef?.newFile(); },
  newFolder: () => { void workspaceRef?.newFolder(); },
  toggleHidden: () => { void Promise.resolve(workspaceRef?.toggleHidden()).then(() => searchPanelRef?.refresh()); },
  showSearch: () => toggleSearchRef?.(),
  showVersions: () => toggleVersionsRef?.(),
  openFolder: () => { void openFolderViaDialog(); },
  openContainingFolder: () => controllerRef?.openContainingFolder(),
  visibilityChanged: (visible) => {
    chrome.setSidebarVisible(visible);
    if (!visible && sidebar.el.contains(document.activeElement)) {panes.focusActiveEditor();}
    scheduleSession();
  },
}, { newFileLabel: 'New File', newFolderLabel: 'New Folder', toggleLabel: label('toggleSidebar'), searchLabel: label('searchFolder'), versionsLabel: label('showVersions') });
body.append(sidebar.el, mainCol);

const chrome = createChrome(app, { isMac });

// Lone-file window (edge case 4): the sidebar starts collapsed, with an
// empty state offering Open Folder when shown.
sidebar.setFolder(null);
sidebar.setVisible(false);
chrome.setSidebarVisible(false);

// ── Documents, backups, panes ───────────────────────────────────────────────

// M6: every explicit save of a file inside the open folder snapshots it.
const versioning = createVersioning({
  api: versionsApi,
  path,
  settings: () => settings.get().versioning,
  root: () => workspaceRef?.root() ?? null,
  readText: (p) => fsApi.readText(p),
});

const registry = createDocumentRegistry({
  fs: fsApi,
  onSaved: (doc, write) => { if (doc.path) {void versioning.onSaved(doc.path, write.size);} },
});

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

// ── Settings (M5): global file + optional folder override, App tab ──────────

const settingsBanner = createSettingsBanner(app);
const settingsMgr = createSettingsManager({
  api: settingsApi,
  path,
  store: settings,
  folder: () => workspaceRef?.root() ?? null,
  windowLabel,
  applyCore: (patch) => { for (const ed of panes.editors()) {ed.handle.updateSettings(patch);} },
  desktopChanged: (prev, next) => {
    if (prev['tree.showHidden'] !== next['tree.showHidden']) {
      sidebar.setShowHidden(next['tree.showHidden'] === true);
      void workspaceRef?.tree.refreshAll();
    }
    if (prev['versioning.enabled'] !== next['versioning.enabled']) {refreshVersionsRef?.();}
  },
  banner: settingsBanner,
  notify: (message, opts) => dialogs.toast(message, opts),
  openFile: (p) => fsApi.openInDefaultApp(p),
});
settings.onTreeChange((patch) => { void settingsMgr.save(patch, { silent: true, force: true }); });
const appActions = createAppActions({
  dialogs,
  isMac,
  appVersion: getVersion,
  checkUpdate: async () => {
    const { check } = await import('@tauri-apps/plugin-updater');
    return check();
  },
  openDefaultAppsSettings: () => settingsApi.openDefaultAppsSettings(),
  markAssociationsOffered: () => { void settingsMgr.save({ fileAssociationsOffered: true }, { silent: true, force: true }); },
});

const hosts = new Map<string, TauriHost>();

function createEditor(editorEl: HTMLElement, paneId: string): MikeDownEditorHandle {
  const host = new TauriHost({
    doc: () => panes.activeDoc(paneId),
    path,
    fs: fsApi,
    settings,
    persistSettings: (patch, opts) => settingsMgr.save(patch, opts),
    images,
    app: {
      onModelChanged: () => { controllerRef?.refresh(); },
      onStats: (stats) => controllerRef?.onStats(paneId, stats),
      openPath: (p, opts) => controllerRef?.openPath(p, { ...opts, paneId }) ?? Promise.resolve(false),
      notify: (message, opts) => dialogs.toast(message, opts),
      exportHtml: (html) => { void exporterRef?.exportHtml(html); },
      printDocument: (html) => { void exporterRef?.print(html); },
    },
    diffBaseline: (p) => versioning.newestText(p),
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
    settings: { ...settingsMgr.coreSettings() },
    extraSettingsSections: [createAppTabSection({
      settings: () => settings.get(),
      folder: () => workspaceRef?.root() ?? null,
      editorRoot: () => editorEl.querySelector<HTMLElement>('.mikedown-root'),
      version: () => appActions.version(),
      checkForUpdates: () => { void appActions.checkForUpdates(); },
      setDefaultApp: () => { void appActions.setDefaultApp(); },
    })],
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
      null,
      { label: 'Show Versions', disabled: !p || !root, run: () => { panes.open(doc); showVersionsRef?.(); } },
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
    refreshVersionsRef?.();
    syncFolderButton();
    scheduleSession();
    if (doc?.path) {noteRecent('file', doc.path);}
    syncWelcomeRef?.();
  },
  onDocumentsChanged: () => { reportWindowState(); scheduleSession(); syncWelcomeRef?.(); },
  createFile: createFileWithText,
  compareWithDisk: async ({ doc, diskText }) => {
    const name = doc.path ? path.basename(doc.path) : 'Untitled';
    const choice = await showDiff({
      title: `${name}: changed on disk`,
      leftLabel: 'On disk',
      rightLabel: 'Your unsaved version',
      left: diskText,
      right: doc.text,
      actions: [
        { id: 'revert', label: 'Revert to Disk' },
        { id: 'overwrite', label: 'Overwrite with Mine', primary: true },
      ],
    });
    return choice === 'overwrite' || choice === 'revert' ? choice : null;
  },
  folder: () => workspaceRef?.root() ?? null,
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
  moveVersions: (from, to) => versioning.moved(from, to),
});
workspaceRef = workspace;
// M6: an open file changed on disk (another app or window): reload or flag.
void watchApi.onChange((change) => controller.external.handleFsChange(change)).catch(() => { /* not under Tauri */ });
sidebar.setTreeEl(workspace.tree.el);
workspace.tree.el.addEventListener('click', () => scheduleSession());
workspace.tree.el.addEventListener('keydown', () => scheduleSession());

// ── Folder search (M7): the panel replaces the tree in the sidebar ──────────
const searchController = createSearchController({
  api: searchApi,
  root: () => workspace.root(),
  showHidden: () => settings.get().tree.showHidden,
});
const searchPanel = createSearchPanel({
  controller: searchController,
  root: () => workspace.root(),
  openMatch: (m) => {
    void controller.openPath(m.path, { reveal: { line: m.line, column: m.column, length: m.matchEnd - m.matchStart } });
  },
  close: () => closeSearch(),
});
searchPanelRef = searchPanel;
sidebar.setSearchEl(searchPanel.el);

function showSearch(): void {
  if (!workspace.root()) {
    dialogs.toast('Open a folder to search it.');
    return;
  }
  sidebar.setVisible(true);
  sidebar.setView('search');
  searchPanel.focus();
}

function closeSearch(): void {
  sidebar.setView('tree');
  if (panes.activeDoc()) {panes.focusActiveEditor();} else {workspace.tree.focus();}
}
toggleSearchRef = () => { if (sidebar.view() === 'search') {closeSearch();} else {showSearch();} };

// ── Versions (M6): the version browser replaces the tree in the sidebar ─────
async function compareVersions(older: VersionSnapshot, newer: VersionSnapshot | 'current'): Promise<void> {
  const doc = panes.activeDoc();
  if (!doc?.path) {return;}
  const name = path.basename(doc.path);
  const stamp = (s: VersionSnapshot): string => new Date(s.timeMs).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
  try {
    const left = await versioning.read(older);
    const right = newer === 'current' ? doc.text : await versioning.read(newer);
    const choice = await showDiff({
      title: name,
      leftLabel: `Version of ${stamp(older)}`,
      rightLabel: newer === 'current' ? (doc.dirty ? 'Current (unsaved)' : 'Current') : `Version of ${stamp(newer)}`,
      left,
      right,
      actions: [{ id: 'restore', label: `Restore ${stamp(newer === 'current' ? older : newer)}` }],
    });
    if (choice === 'restore') {await restoreVersion(newer === 'current' ? older : newer);}
  } catch (err) {
    dialogs.toast(`Could not read that version: ${String(err)}`, { error: true, ms: 6000 });
  }
}

/** Edge case 2: the buffer takes the snapshot's text and turns dirty; nothing is written. */
async function restoreVersion(snapshot: VersionSnapshot): Promise<void> {
  const doc = panes.activeDoc();
  if (!doc) {return;}
  const result = await restoreIntoDocument(doc, () => versioning.read(snapshot), async () => (await dialogs.confirm('Replace your unsaved changes with this version?', {
    okLabel: 'Restore',
    cancelLabel: 'Cancel',
    detail: 'The restored text is not saved until you save the file.',
  })).ok);
  if (result === 'cancelled') {return;}
  panes.refreshDoc(doc);
  controller.refresh();
  dialogs.toast(result === 'unchanged' ? 'The document already has that text.' : doc.dirty ? 'Version restored. Save to keep it.' : 'Version restored; it matches the saved file.');
}

const versionsPanel = createVersionsPanel({
  versioning,
  activeDoc: () => panes.activeDoc(),
  root: () => workspace.root(),
  enabled: () => settings.get().versioning.enabled,
  compare: (older, newer) => { void compareVersions(older, newer); },
  restore: (s) => { void restoreVersion(s).catch((err: unknown) => dialogs.toast(`Could not restore: ${String(err)}`, { error: true })); },
  close: () => closeVersions(),
});
sidebar.setVersionsEl(versionsPanel.el);

function showVersions(): void {
  sidebar.setVisible(true);
  sidebar.setView('versions');
  void versionsPanel.refresh().then(() => versionsPanel.focus());
}

function closeVersions(): void {
  sidebar.setView('tree');
  if (panes.activeDoc()) {panes.focusActiveEditor();} else if (workspace.root()) {workspace.tree.focus();}
}
toggleVersionsRef = () => { if (sidebar.view() === 'versions') {closeVersions();} else {showVersions();} };
const refreshVersions = (): void => { if (sidebar.view() === 'versions' && sidebar.isVisible()) {void versionsPanel.refresh();} };
versioning.onChange((file) => {
  if (panes.activeDoc()?.path === file) {refreshVersions();}
  // Core's change highlighting compares against the newest snapshot.
  for (const ed of panes.editors()) {ed.handle.setDiffAvailable(true);}
});
registry.onChange((doc, event) => { if (event === 'path' && doc === panes.activeDoc()) {refreshVersions();} });
refreshVersionsRef = refreshVersions;
showVersionsRef = showVersions;

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
    searchPanel.reset();
  } catch (err) {
    await dialogs.error(`Could not open the folder ${dir}.\n\n${String(err)}`);
    return false;
  }
  // The folder's own settings file (if any) now applies.
  await settingsMgr.load().catch((err: unknown) => console.warn('MikeDown: folder settings unavailable', err));
  sidebar.setVisible(true);
  workspace.syncActive(panes.activeDoc()?.path ?? null);
  syncFolderButton();
  reportWindowState();
  scheduleSession();
  noteRecent('folder', dir);
  syncWelcome();
  controller.refresh();
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

// ── Welcome screen and recents (M8, edge case 18) ─────────────────────────

const recents = createRecentsStore({ api: recentsApi, caseInsensitive: isMac || platform === 'win32' });
let homeDir: string | null = null;

const welcome = createWelcome({
  isMac,
  openFolder: () => { void openFolderViaDialog(); },
  openFile: () => { void controller.openViaDialog(); },
  newFile: () => { controller.newDocument(); },
  openRecent: (kind, p) => { void openRecent(kind, p); },
  removeRecent: (kind, p) => { void recents.remove(kind, p).catch((err: unknown) => console.warn('MikeDown: recents', err)); },
  home: () => homeDir,
});
mainCol.appendChild(welcome.el);

function renderWelcome(): void {
  welcome.render(recents.view());
}

/** A window with no folder and no open document shows the welcome screen. */
function syncWelcome(): void {
  const show = booted && !smokeEnabled() && !workspace.root() && registry.all().length === 0;
  if (show !== welcome.isVisible()) {
    welcome.setVisible(show);
    panes.el.style.display = show ? 'none' : '';
    if (show) {
      renderWelcome();
      // Fresh "missing" flags for entries that went away since the last look.
      void recents.load().catch(() => { /* not under Tauri */ });
      const active = document.activeElement;
      if (!active || active === document.body || mainCol.contains(active)) {welcome.focus();}
    }
  }
  controller.refresh();
  scheduleMenuSync();
}
syncWelcomeRef = syncWelcome;

noteRecent = (kind, p) => {
  if (smokeEnabled()) {return;}
  const list = kind === 'folder' ? recents.data().folders : recents.data().files;
  if (list[0]?.path === p && !recents.missing().has(p)) {return;}
  void recents.add(kind, p).catch(() => { /* not under Tauri */ });
};

async function openRecent(kind: RecentKind, p: string): Promise<void> {
  try { await recentsApi.allow(p); } catch { /* not listed or not under Tauri */ }
  let ok = false;
  try {
    const st = await fsApi.stat(p);
    ok = kind === 'folder' ? st.isDir : st.isFile;
  } catch { /* gone or unreadable */ }
  if (!ok) {
    dialogs.toast(`${baseName(p)} is no longer at ${tildify(p, homeDir)}.`, { error: true, ms: 6000 });
    await recents.load().catch(() => { /* not under Tauri */ });
    return;
  }
  if (kind === 'folder') {await openFolder(p);}
  else {await controller.openPath(p);}
}

/** First launch (edge case 29): the bundled cheat sheet as a lone file, and the default-app offer once. */
async function firstRun(): Promise<boolean> {
  if (!isMainWindow || recents.firstRunDone()) {return false;}
  await recents.markFirstRunDone().catch(() => { /* not under Tauri */ });
  let welcomePath: string | null = null;
  try { welcomePath = await recentsApi.welcomeFile(); } catch { /* not under Tauri */ }
  if (!welcomePath || !(await controller.openPath(welcomePath))) {return false;}
  if (!settings.get().fileAssociationsOffered) {void offerDefaultApp();}
  return true;
}

async function offerDefaultApp(): Promise<void> {
  const choice = await dialogs.choose('Open .md files with MikeDown?', {
    detail: isMac
      ? 'MikeDown can be the app that opens markdown files when you double-click them. macOS asks you to confirm that in Finder; MikeDown shows the steps.'
      : 'MikeDown can be the app that opens markdown files when you double-click them. Windows asks you to confirm that in Settings > Default apps.',
    buttons: ['Not Now', 'Set as Default…'],
    defaultIndex: 1,
    cancelIndex: 0,
  });
  // Asked once either way; Settings > App keeps the button for later.
  if (choice === 1) {await appActions.setDefaultApp();}
  else {void settingsMgr.save({ fileAssociationsOffered: true }, { silent: true, force: true });}
}

void import('@tauri-apps/api/path')
  .then((m) => m.homeDir())
  .then((h) => { homeDir = h || null; renderWelcome(); syncRecentMenu(); })
  .catch(() => { /* not under Tauri */ });

// ── Native menu and shortcuts (M8, edge case 23): one table, `menu/shortcuts.ts` ──

function menuContext(): MenuContext {
  const doc = panes.activeDoc();
  const editor = !!doc && (doc.kind === 'markdown' || doc.kind === 'text') && !!panes.activeHandle();
  const active = document.activeElement as HTMLElement | null;
  return {
    hasDocument: !!doc,
    editor,
    sourceMode: editor && controller.isSourceMode(),
    dirty: !!doc?.dirty,
    hasPath: !!doc?.path,
    insideFolder: !!(doc?.path && workspace.root() && isInside(workspace.root()!, doc.path, path)),
    anyDirty: registry.all().some((d) => d.dirty),
    folder: !!workspace.root(),
    editorFocus: !!active?.closest?.('.mikedown-root'),
  };
}

const rowEnabled = (row: ShortcutRow): boolean => isEnabled(row.when, menuContext());

let menuTimer: ReturnType<typeof setTimeout> | undefined;
let lastEnablement = '';
/** Push the `when` state to the native menu (the focused window owns the shared bar). */
function scheduleMenuSync(): void {
  clearTimeout(menuTimer);
  menuTimer = setTimeout(() => {
    if (!booted || smokeEnabled() || !document.hasFocus()) {return;}
    const state = enablement(menuContext(), isMac);
    const json = JSON.stringify(state);
    if (json === lastEnablement) {return;}
    lastEnablement = json;
    void menuApi.update(state).catch(() => { /* not under Tauri */ });
  }, 60);
}

function recentLabel(p: string): string {
  const where = tildify(path.dirname(p), homeDir);
  return `${baseName(p)} — ${where}`;
}

let lastRecentMenu = '';
function syncRecentMenu(): void {
  if (smokeEnabled()) {return;}
  const missing = recents.missing();
  const toEntry = (e: { path: string }) => ({ path: e.path, label: recentLabel(e.path), missing: missing.has(e.path) });
  const items: MenuNode[] = recentMenuItems(recents.data().folders.map(toEntry), recents.data().files.map(toEntry), isMac);
  const json = JSON.stringify(items);
  if (json === lastRecentMenu) {return;}
  lastRecentMenu = json;
  void menuApi.setRecents(items).catch(() => { /* not under Tauri */ });
}

const editorCommand = (row: ShortcutRow | undefined): void => {
  const handle = panes.activeHandle();
  if (!row?.core || !handle) {return;}
  const active = document.activeElement as HTMLElement | null;
  // Undo / Redo from the menu while typing in a field outside the editor
  // (tree rename, find bar, dialogs) belong to that field.
  if ((row.core === 'undo' || row.core === 'redo') && active && !active.closest('.mikedown-root')
    && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
    document.execCommand(row.core);
    return;
  }
  handle.command(row.core);
};

async function toggleSpellcheck(): Promise<void> {
  const on = settingsMgr.coreSettings().spellCheckEnabled !== false;
  for (const ed of panes.editors()) {ed.handle.updateSettings({ spellCheckEnabled: !on });}
  await settingsMgr.save({ spellCheckEnabled: !on }, { silent: true });
  dialogs.toast(on ? 'Spell check is off.' : 'Spell check is on.');
}

async function openUrl(url: string): Promise<void> {
  // `shell.open` as in TauriHost.openLink; tauri-plugin-opener is the
  // follow-up for both call sites.
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } catch (err) {
    dialogs.toast(`Could not open ${url}: ${String(err)}`, { error: true });
  }
}

async function showAbout(): Promise<void> {
  let version = '';
  try { version = await appActions.version(); } catch { /* not under Tauri */ }
  await dialogs.info(`MikeDown${version ? ` ${version}` : ''}\n\nA WYSIWYG markdown editor.\n${WEBSITE_URL}`, 'About MikeDown');
}

const actions: Record<AppCommand, () => void> = {
  newDocument: () => { controller.newDocument(); },
  save: () => { void controller.save(); },
  saveAs: () => { void controller.saveAs(); },
  saveAll: () => { void controller.saveAll(); },
  open: () => { void controller.openViaDialog(); },
  toggleSource: () => controller.toggleSource(),
  openSettings: () => {
    const handle = panes.activeHandle();
    if (handle) {handle.command('openSettings');}
    else {dialogs.toast('Open or create a document to change settings.');}
  },
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
  searchFolder: showSearch,
  showVersions: () => toggleVersionsRef?.(),
  newWindow: () => { void windowsApi.newWindow().catch((err: unknown) => dialogs.toast(`Could not open a window: ${String(err)}`, { error: true })); },
  closeWindow: () => { void tauriWindow.close(); },
  exportHtml: () => { void exporterRef?.exportHtml(); },
  exportPdf: () => { void exporterRef?.print(); },
  reveal: () => {
    const p = panes.activeDoc()?.path;
    if (p) {void treeApi.revealPath(p);}
  },
  toggleHidden: () => { void Promise.resolve(workspace.toggleHidden()).then(() => searchPanel.refresh()); },
  clearRecents: () => { void recents.clear().catch(() => { /* not under Tauri */ }); },
  toggleSpellcheck: () => { void toggleSpellcheck(); },
  spellingSettings: () => {
    const handle = panes.activeHandle();
    if (handle) {handle.command('openSettings', { tab: 'spelling' });}
    else {dialogs.toast('Open or create a document to change settings.');}
  },
  welcome: () => {
    void recentsApi.welcomeFile()
      .then((p) => (p ? controller.openPath(p) : false))
      .catch((err: unknown) => dialogs.toast(`Could not open the welcome guide: ${String(err)}`, { error: true }));
  },
  keyboardShortcuts: () => showShortcutsSheet(isMac),
  checkUpdates: () => { void appActions.checkForUpdates(); },
  website: () => { void openUrl(WEBSITE_URL); },
  reportIssue: () => { void openUrl(ISSUES_URL); },
  about: () => { void showAbout(); },
  quit: () => { void windowsApi.requestQuit().catch(() => { /* not under Tauri */ }); },
};

/** Run a table command (keyboard or menu). */
function runCommand(command: CommandId, row?: ShortcutRow): void {
  const r = row ?? rowFor(command, isMac) ?? COMMANDS.find((c) => c.command === command);
  if (r?.core) {editorCommand(r);}
  else if (command in actions) {actions[command as AppCommand]();}
  scheduleMenuSync();
}

// The page sees a chord before the native menu does (WKWebView), or both see
// it (WebView2 may also fire the menu accelerator). Chords the page already
// handled are remembered for a moment so the menu event that repeats one is
// dropped.
const DEDUPE_MS = 400;
let handledChord: { chord: string; at: number } | null = null;
const chordOf = (e: KeyboardEvent): string =>
  [e.metaKey && 'meta', e.ctrlKey && 'ctrl', e.altKey && 'alt', e.shiftKey && 'shift', (e.key || '').toLowerCase()].filter(Boolean).join('+');
const allChords = rowsFor(isMac).filter((r) => r.accelerator).map((r) => ({ row: r, chord: chordKey(r.accelerator!, isMac) }));

window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) {return;}
  const inEditor = !!(e.target as HTMLElement | null)?.closest?.('.mikedown-root');
  const row = rowForKey(e, isMac, SHORTCUTS, { inEditor, enabled: rowEnabled });
  if (!row) {return;}
  handledChord = { chord: chordKey(row.accelerator!, isMac), at: Date.now() };
  if (!row.passThrough) {
    e.preventDefault();
    e.stopPropagation();
  }
  runCommand(row.command, row);
}, true);
// Chords core handled itself (Bold, Undo, Find) end up default-prevented.
window.addEventListener('keydown', (e) => {
  if (!e.defaultPrevented) {return;}
  const chord = chordOf(e);
  const hit = allChords.find((c) => c.chord === chord);
  if (hit) {handledChord = { chord: hit.chord, at: Date.now() };}
  scheduleMenuSync();
});

function onMenuCommand(id: string): void {
  if (id.startsWith(RECENT_FOLDER_PREFIX)) { void openRecent('folder', id.slice(RECENT_FOLDER_PREFIX.length)); return; }
  if (id.startsWith(RECENT_FILE_PREFIX)) { void openRecent('file', id.slice(RECENT_FILE_PREFIX.length)); return; }
  const row = rowFor(id as CommandId, isMac);
  if (!row && !(id in actions)) {return;}
  if (row?.accelerator && handledChord && Date.now() - handledChord.at < DEDUPE_MS && handledChord.chord === chordKey(row.accelerator, isMac)) {
    handledChord = null;
    return;
  }
  if (row && !rowEnabled(row)) {return;}
  runCommand(id as CommandId, row);
}

if (!smokeEnabled()) {
  void windowsApi.onMenu(onMenuCommand).catch(() => { /* not under Tauri */ });
  void menuApi.set(buildMenuSpec(isMac))
    .then(() => { lastEnablement = ''; lastRecentMenu = ''; scheduleMenuSync(); syncRecentMenu(); })
    .catch(() => { /* not under Tauri */ });
  // The shared menu bar follows the focused window.
  window.addEventListener('focus', () => {
    lastEnablement = '';
    scheduleMenuSync();
    void recents.load().then(() => { lastRecentMenu = ''; syncRecentMenu(); }).catch(() => { /* not under Tauri */ });
  });
  document.addEventListener('focusin', () => scheduleMenuSync());
  registry.onChange(() => scheduleMenuSync());
}
recents.onChange(() => { renderWelcome(); syncRecentMenu(); });

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

// Cross-window edits of the same file (edge case 6) and edits in other apps:
// compare mtimes when the window gains focus (M6: reload clean, flag dirty).
if (!smokeEnabled()) {
  void tauriWindow.onFocusChanged(({ payload: focused }) => {
    if (focused) {void controller.external.checkAll();}
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

  // Settings first, so documents open with the saved fonts and preferences.
  try {
    await settingsMgr.load();
    void settingsMgr.listen().catch(() => { /* not under Tauri */ });
  } catch (err) {
    console.warn('MikeDown: settings unavailable, using defaults', err);
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
  // Nothing to show and no folder to browse: the first launch opens the
  // bundled welcome guide; otherwise the welcome screen with the recents
  // (M8). A folder window starts on its tree.
  try {
    await recents.load();
    if (isMainWindow) {await recents.launchCheck();}
  } catch { /* not under Tauri */ }
  if (!panes.activeDoc() && paneList().length === 1 && !workspace.root()) {
    await firstRun();
  }
  syncWelcome();
  syncRecentMenu();
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
