/**
 * `TauriHost implements MikeDownHost`: the desktop app's side of the core
 * host contract, one instance per editor instance. It keeps the document
 * model in sync (`onChange`), feeds the status footer (`onStats`), routes
 * links (edge case 13), keeps Settings-modal changes for the session (M5
 * persists them) and runs the image pipeline.
 *
 * Methods that M3, M6 and M9 implement (`getTags`, `getLinkSuggestions`,
 * `resolveWikilinks`, `getDiffBaseline`, `exportHtml`, `printDocument`) are
 * deliberately absent so core keeps their UI hidden.
 */
import type {
  LinkOpenBehavior,
  MikeDownEditorHandle,
  MikeDownHost,
  MikeDownSettingsPatch,
  MikeDownStats,
} from '@mikedown/core';
import type { PathOps } from '@mikedown/core/shared/imagePaste';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import type { DocumentModel } from '../documents/documentModel';
import type { FsApi } from '../documents/fsApi';
import type { DesktopSettingsStore } from '../settings/desktopSettings';
import type { ImagePipeline } from './imagePipeline';
import { routeLink } from './linkRouting';
import { stripQuery } from './imagePipeline';

/** Sources the webview loads as they are (core's imageSrcPolicy uses the same set). */
const PASS_THROUGH = /^(?:https?|data|blob):/i;

export interface TauriHostDeps {
  model: DocumentModel;
  path: PathOps;
  fs: Pick<FsApi, 'assetUrl'>;
  settings: DesktopSettingsStore;
  images: ImagePipeline;
  app: {
    /** The model's text or dirty flag changed (title, tab dot, close guard). */
    onModelChanged(): void;
    onStats(stats: MikeDownStats): void;
    /** Open a local file in this window (M4 turns this into a tab). */
    openPath(path: string, opts?: { anchor?: string | null }): Promise<boolean>;
    notify(message: string, opts?: { error?: boolean }): void;
  };
}

export class TauriHost implements MikeDownHost {
  private handle: MikeDownEditorHandle | null = null;

  readonly uploadImage: MikeDownHost['uploadImage'];
  readonly pickImage: MikeDownHost['pickImage'];
  readonly resizeImage: MikeDownHost['resizeImage'];

  constructor(private readonly deps: TauriHostDeps) {
    this.uploadImage = (file) => deps.images.uploadImage(file);
    this.pickImage = () => deps.images.pickImage();
    this.resizeImage = (req) => deps.images.resizeImage(req);
  }

  /** The editor handle exists only after `createMikeDownEditor` returns. */
  attach(handle: MikeDownEditorHandle): void {
    this.handle = handle;
  }

  onChange(markdown: string, meta: { pristine: boolean }): void {
    const { model } = this.deps;
    model.text = markdown;
    const dirty = !meta.pristine;
    if (dirty !== model.dirty) {
      model.dirty = dirty;
    }
    this.deps.app.onModelChanged();
  }

  onStats(stats: MikeDownStats): void {
    this.deps.app.onStats(stats);
  }

  openLink(href: string, _behavior?: LinkOpenBehavior): void {
    const route = routeLink(href, this.deps.model.path, this.deps.path);
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
    const docPath = this.deps.model.path;
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
