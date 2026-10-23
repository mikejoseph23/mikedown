/**
 * `TauriHost implements MikeDownHost`: the desktop app's side of the core
 * host contract, one instance per editor instance (one per pane, M4). The
 * document a pane shows changes with its active tab, so the host reads it
 * through `deps.doc()` every time. Text and dirty state are the document
 * model's business: it binds to the editor's `change` event itself
 * (`DocumentModel.attach`), so `onChange` here only tells the app something
 * happened. The host feeds the status footer (`onStats`), routes links
 * (edge case 13), keeps Settings-modal changes for the session (M5 persists
 * them) and runs the image pipeline.
 *
 * The knowledge-base methods (`getLinkSuggestions`, `getFileHeadings`,
 * `resolveWikilinks`, `createWikilink`, `checkLinks`) exist only while the
 * window has a folder open (M3, `setKnowledgeBase`); core looks them up when
 * it needs them, so a lone-file window simply has none. Methods later
 * milestones implement (`getTags`, `getDiffBaseline`, `exportHtml`,
 * `printDocument`) are deliberately absent so core keeps their UI hidden.
 */
import type {
  LinkCheckRequest,
  LinkOpenBehavior,
  LinkSuggestion,
  MikeDownEditorHandle,
  MikeDownHost,
  MikeDownSettingsPatch,
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
import type { MdIndex } from '../tree/mdIndex';

/** What a folder window lends the host for the knowledge-base methods. */
export interface KnowledgeBase {
  index: MdIndex;
  /** `[[target]]` Cmd/Ctrl+click made (or found) this file: open it. */
  openCreated(path: string, created: boolean): void;
}

/** Sources the webview loads as they are (core's imageSrcPolicy uses the same set). */
const PASS_THROUGH = /^(?:https?|data|blob):/i;

export interface TauriHostDeps {
  /** The document this host's editor shows right now (null for an empty pane). */
  doc(): Pick<DocumentModel, 'path' | 'text'> | null;
  path: PathOps;
  fs: Pick<FsApi, 'assetUrl'>;
  settings: DesktopSettingsStore;
  images: ImagePipeline;
  app: {
    /** The editor's content changed (the document model already took it). */
    onModelChanged(): void;
    onStats(stats: MikeDownStats): void;
    /** Open a local file in this window: a tab in the pane this host belongs to. */
    openPath(path: string, opts?: { anchor?: string | null }): Promise<boolean>;
    notify(message: string, opts?: { error?: boolean }): void;
  };
}

export class TauriHost implements MikeDownHost {
  private handle: MikeDownEditorHandle | null = null;

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

  constructor(private readonly deps: TauriHostDeps) {
    this.uploadImage = (file) => deps.images.uploadImage(file);
    this.pickImage = () => deps.images.pickImage();
    this.resizeImage = (req) => deps.images.resizeImage(req);
  }

  /**
   * Turn the knowledge-base methods on (a folder opened) or off (null: a
   * lone-file window). Call `handle.refreshLinks()` afterwards so core asks.
   */
  setKnowledgeBase(kb: KnowledgeBase | null): void {
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
  }

  onChange(_markdown: string, _meta: { pristine: boolean }): void {
    this.deps.app.onModelChanged();
  }

  onStats(stats: MikeDownStats): void {
    this.deps.app.onStats(stats);
  }

  openLink(href: string, _behavior?: LinkOpenBehavior): void {
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
      case 'local':
        void this.deps.app.openPath(route.path, { anchor: route.anchor });
        return;
      case 'unresolvable':
        this.deps.app.notify(`Cannot open link: ${route.reason}`, { error: true });
        return;
    }
  }

  saveSettings(patch: MikeDownSettingsPatch, opts?: { source?: 'slashMenu'; silent?: boolean }): void {
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
