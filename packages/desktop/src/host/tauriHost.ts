/**
 * `TauriHost implements MikeDownHost`: the desktop app's side of the core
 * host contract, one instance per editor instance (one per pane, M4). The
 * document a pane shows changes with its active tab, so the host reads it
 * through `deps.doc()` every time. Text and dirty state are the document
 * model's business: it binds to the editor's `change` event itself
 * (`DocumentModel.attach`), so `onChange` here only tells the app something
 * happened. The host feeds the status footer (`onStats`), routes links
 * (edge case 13), hands Settings-modal changes to the settings manager (M5) and runs the image pipeline.
 *
 * The knowledge-base methods (`getLinkSuggestions`, `getFileHeadings`,
 * `resolveWikilinks`, `createWikilink`, `checkLinks`) exist only while the
 * window has a folder open (M3, `setKnowledgeBase`); core looks them up when
 * it needs them, so a lone-file window simply has none. `getTags` is
 * deliberately absent so core keeps its UI hidden. `getDiffBaseline` (M6)
 * exists when the app passes `diffBaseline`: the newest version snapshot is
 * the "committed" text core highlights changes against. `exportHtml` and `printDocument` (M9) are
 * present: core shows its Print / Export as PDF toolbar entry, which is wanted.
 *
 * Core's document sidebar (Outline / Backlinks / Properties) gets its
 * persisted pin and section state through `sidebarPrefs` (the app's settings
 * file, `outline.*`) and its backlinks from `refreshBacklinks` /
 * `syncBacklinks`, which the app calls when the pane's document or the
 * folder's files change. A lone-file window never sends backlinks, so the
 * section stays hidden.
 */
import type {
  BacklinkItem,
  DiffBaseline,
  LinkCheckRequest,
  LinkOpenBehavior,
  LinkSuggestion,
  MikeDownEditorHandle,
  MikeDownHost,
  MikeDownSettingsPatch,
  MikeDownSidebarPrefs,
  MikeDownStats,
  WikilinkResolution,
} from '@mikedown/core';
import type { PathOps } from '@mikedown/core/shared/imagePaste';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import type { DocumentModel } from '../documents/documentModel';
import type { FsApi } from '../documents/fsApi';
import type { DesktopSettingsStore } from '../settings/desktopSettings';
import type { ImagePipeline } from './imagePipeline';
import { routeLink } from './linkRouting';
import { stripQuery } from './imagePipeline';
import type { BacklinkIndex } from '../tree/backlinks';
import type { MdIndex } from '../tree/mdIndex';
import type { OutlineSettings } from '../settings/desktopSettings';

/** What a folder window lends the host for the knowledge-base methods. */
export interface KnowledgeBase {
  index: MdIndex;
  /** Backlinks for the sidebar. Absent: the section stays hidden. */
  backlinks?: BacklinkIndex;
  /** `[[target]]` Cmd/Ctrl+click made (or found) this file: open it. */
  openCreated(path: string, created: boolean): void;
}

/** Sources the webview loads as they are (core's imageSrcPolicy uses the same set). */
const PASS_THROUGH = /^(?:https?|data|blob):/i;

export interface TauriHostDeps {
  /** The document this host's editor shows right now (null for an empty pane). */
  doc(): (Pick<DocumentModel, 'path' | 'text'> & Partial<Pick<DocumentModel, 'mtimeMs'>>) | null;
  path: PathOps;
  fs: Pick<FsApi, 'assetUrl'>;
  settings: DesktopSettingsStore;
  /** Persist a Settings-modal patch (M5); absent keeps changes for the session. */
  persistSettings?(patch: MikeDownSettingsPatch, opts?: { silent?: boolean }): Promise<void> | void;
  images: ImagePipeline;
  app: {
    /** The editor's content changed (the document model already took it). */
    onModelChanged(): void;
    onStats(stats: MikeDownStats): void;
    /** Open a local file in this window: a tab in the pane this host belongs to. */
    openPath(path: string, opts?: { anchor?: string | null }): Promise<boolean>;
    notify(message: string, opts?: { error?: boolean }): void;
    /** M9: export the rendered HTML as a standalone file / hand it to the print window. */
    exportHtml?(html: string): void;
    printDocument?(html: string): void;
  };
  /** M6: text of the newest version snapshot of a file, or null (none, or no folder). */
  diffBaseline?(path: string): Promise<string | null>;
  /** Persisted sidebar state (pin, collapsed sections). Absent: core keeps it in memory. */
  outline?: {
    get(): OutlineSettings;
    set(patch: Partial<OutlineSettings>): void;
  };
}

export class TauriHost implements MikeDownHost {
  private handle: MikeDownEditorHandle | null = null;
  private kb: KnowledgeBase | null = null;
  /** Core asked for the sidebar state before `attach` (it asks while the editor is built). */
  private sidebarStatePending = false;
  /** Path the sidebar's backlinks were last computed for (undefined: never). */
  private backlinksFor: string | null | undefined = undefined;
  private backlinksRun = 0;
  readonly sidebarPrefs?: MikeDownSidebarPrefs;

  readonly uploadImage: MikeDownHost['uploadImage'];
  readonly pickImage: MikeDownHost['pickImage'];
  readonly resizeImage: MikeDownHost['resizeImage'];

  // Present only while a folder is open (see setKnowledgeBase). `declare`
  // keeps them off the instance until then, so `!!host.getLinkSuggestions`
  // is false in a lone-file window.
  declare getLinkSuggestions?: () => Promise<LinkSuggestion[]>;
  declare getFileHeadings?: (path: string) => Promise<LinkSuggestion[]>;
  declare resolveWikilinks?: (targets: string[]) => Promise<WikilinkResolution[]>;
  declare createWikilink?: (target: string) => Promise<WikilinkResolution[] | void>;
  declare checkLinks?: (links: LinkCheckRequest[]) => Promise<string[]>;
  declare getDiffBaseline?: () => Promise<DiffBaseline>;

  constructor(private readonly deps: TauriHostDeps) {
    this.uploadImage = (file) => deps.images.uploadImage(file);
    this.pickImage = () => deps.images.pickImage();
    this.resizeImage = (req) => deps.images.resizeImage(req);
    const baseline = deps.diffBaseline;
    if (baseline) {
      this.getDiffBaseline = async () => {
        const doc = deps.doc();
        if (!doc?.path) {return { headContent: null, hasChanges: false };}
        const head = await baseline(doc.path).catch(() => null);
        return { headContent: head, hasChanges: head !== null && head !== doc.text };
      };
    }
    const outline = deps.outline;
    if (outline) {
      this.sidebarPrefs = {
        requestState: () => this.applySidebarState(),
        setPref: (pref) => outline.set({ visibility: pref }),
        applyDefaults: () => this.applySidebarState(),
        sectionCollapsed: (section, collapsed) => {
          outline.set({ sectionPrefs: { ...outline.get().sectionPrefs, [section]: collapsed } });
        },
      };
    }
  }

  /** Push the persisted sidebar state (pin, sections) to the editor; also core's own request. */
  applySidebarState(): void {
    const outline = this.deps.outline;
    if (!outline) {return;}
    if (!this.handle) {
      this.sidebarStatePending = true;
      return;
    }
    const { visibility, sectionPrefs } = outline.get();
    this.handle.setSidebarState({ pref: visibility, sectionPrefs: { ...sectionPrefs } });
  }

  /**
   * Recompute the sidebar backlinks (and the footer's modified time) for the
   * document this pane shows. Called when files in the folder changed or a
   * document was saved; `syncBacklinks` only when the pane's document did.
   * Without a folder there are no backlinks to send.
   */
  async refreshBacklinks(): Promise<void> {
    const run = ++this.backlinksRun;
    const doc = this.deps.doc();
    const docPath = doc?.path ?? null;
    this.backlinksFor = docPath;
    // The sidebar footer's "Modified …" line.
    this.handle?.setDocMeta({ mtimeMs: doc?.mtimeMs ?? null });
    const backlinks = this.kb?.backlinks;
    if (!this.handle || !backlinks) {return;}
    let items: BacklinkItem[] = [];
    if (docPath) {
      try {
        items = await backlinks.backlinksFor(docPath);
      } catch (err) {
        console.warn('MikeDown: backlinks unavailable', err);
      }
    }
    // A newer run (or another document) took over meanwhile.
    if (run !== this.backlinksRun) {return;}
    this.handle.setBacklinks(items);
  }

  /** Refresh the backlinks only when the pane now shows a different document. */
  syncBacklinks(): void {
    const docPath = this.deps.doc()?.path ?? null;
    if (docPath !== this.backlinksFor) {void this.refreshBacklinks();}
  }

  /**
   * Turn the knowledge-base methods on (a folder opened) or off (null: a
   * lone-file window). Call `handle.refreshLinks()` afterwards so core asks.
   */
  setKnowledgeBase(kb: KnowledgeBase | null): void {
    const hadBacklinks = !!this.kb?.backlinks;
    this.kb = kb;
    if (kb?.backlinks) {void this.refreshBacklinks();}
    // The folder closed: empty the section rather than keep the old folder's links.
    else if (hadBacklinks) {this.handle?.setBacklinks([]);}
    if (!kb) {
      delete this.getLinkSuggestions;
      delete this.getFileHeadings;
      delete this.resolveWikilinks;
      delete this.createWikilink;
      delete this.checkLinks;
      return;
    }
    const docPath = (): string | null => this.deps.doc()?.path ?? null;
    const docText = (): string => this.deps.doc()?.text ?? '';
    const { index } = kb;
    this.getLinkSuggestions = () => index.linkSuggestions(docPath(), docText());
    this.getFileHeadings = (p) => index.fileHeadings(docPath(), p);
    this.resolveWikilinks = (targets) => index.resolveWikilinks(docPath(), targets);
    this.checkLinks = (links) => index.checkLinks(docPath(), docText(), links);
    this.createWikilink = async (target) => {
      try {
        const res = await index.createWikilink(docPath(), target);
        kb.openCreated(res.path, res.created);
        return [res.resolution];
      } catch (err) {
        this.deps.app.notify(err instanceof Error ? err.message : String(err), { error: true });
        return undefined;
      }
    };
  }

  /** The editor handle exists only after `createMikeDownEditor` returns. */
  attach(handle: MikeDownEditorHandle): void {
    this.handle = handle;
    if (this.sidebarStatePending) {
      this.sidebarStatePending = false;
      this.applySidebarState();
    }
    if (this.kb?.backlinks) {void this.refreshBacklinks();}
  }

  onChange(_markdown: string, _meta: { pristine: boolean }): void {
    this.deps.app.onModelChanged();
  }

  onStats(stats: MikeDownStats): void {
    this.deps.app.onStats(stats);
  }

  /** `reveal` (a sidebar backlink): scroll the opened file to the link back to this one. */
  openLink(href: string, _behavior?: LinkOpenBehavior, reveal?: { href?: string; occurrence?: number }): void {
    const route = routeLink(href, this.deps.doc()?.path ?? null, this.deps.path);
    switch (route.kind) {
      case 'external':
        void shellOpen(route.url).catch((err: unknown) => {
          this.deps.app.notify(`Could not open ${route.url}: ${String(err)}`, { error: true });
        });
        return;
      case 'anchor':
        this.handle?.scrollToAnchor(route.slug);
        return;
      case 'local': {
        const opened = this.deps.app.openPath(route.path, { anchor: route.anchor });
        const revealHref = reveal?.href;
        if (revealHref) {
          void opened.then((ok) => { if (ok) {this.handle?.revealLink(revealHref, reveal?.occurrence);} });
        }
        return;
      }
      case 'unresolvable':
        this.deps.app.notify(`Cannot open link: ${route.reason}`, { error: true });
        return;
    }
  }

  exportHtml(html: string): void {
    this.deps.app.exportHtml?.(html);
  }

  printDocument(html: string): void {
    this.deps.app.printDocument?.(html);
  }

  saveSettings(patch: MikeDownSettingsPatch, opts?: { source?: 'slashMenu'; silent?: boolean }): void {
    if (this.deps.persistSettings) {
      // The settings manager diffs against the store, writes the file, then
      // reloads the store and every editor; applying here first would hide
      // the change from its diff.
      void Promise.resolve(this.deps.persistSettings(patch, { silent: opts?.silent })).catch((err: unknown) => {
        this.deps.app.notify(`Could not save settings: ${String(err)}`, { error: true });
      });
      return;
    }
    this.deps.settings.apply(patch);
    if (!opts?.silent) {
      this.deps.app.notify('Settings applied for this session (saving to disk arrives in a later update).');
    }
  }

  /**
   * Relative or absolute image paths render through the asset protocol;
   * fully qualified URLs (http(s), data:, blob:) pass through untouched.
   */
  resolveImageSrc(src: string): string | null {
    if (PASS_THROUGH.test(src)) {return src;}
    const docPath = this.deps.doc()?.path ?? null;
    const clean = stripQuery(src);
    if (!clean) {return null;}
    const { path } = this.deps;
    let abs: string;
    if (path.isAbsolute(clean)) {
      abs = path.normalize(clean);
    } else if (docPath) {
      abs = path.resolve(path.dirname(docPath), clean);
    } else {
      return null;
    }
    const url = this.deps.fs.assetUrl(abs);
    const query = src.slice(clean.length);
    return query ? url + query : url;
  }
}
