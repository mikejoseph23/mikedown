import type { NgZone } from '@angular/core';
import type { Router } from '@angular/router';
import type {
  ImageInsertResult,
  ImageUploadRequest,
  LinkOpenBehavior,
  MikeDownHost,
  MikeDownSettings,
  MikeDownSettingsPatch,
} from '@mikedown/core';
import { firstValueFrom, type Observable } from 'rxjs';

/** Uploads pasted or dropped image bytes and returns where the editor should load the image from. */
export type MikeDownImageUpload = (file: ImageUploadRequest) => Observable<ImageInsertResult>;

/** Maps an image `src` the core cannot load as is (a relative or absolute path) to a URL, or null for the placeholder. */
export type MikeDownImageSrcResolver = (src: string) => string | null;

/** localStorage key for the editor's own Settings modal choices (font, width, theme...). Per user, per browser. */
export const MIKEDOWN_SETTINGS_KEY = 'mikedown.settings';

/** What the host needs from the component. Callbacks are read on every call, so inputs can change after creation. */
export interface AngularMikeDownHostBindings {
  zone: NgZone;
  router: Router | null;
  imageUpload(): MikeDownImageUpload | undefined;
  imageSrcResolver(): MikeDownImageSrcResolver | undefined;
  imageBaseUrl(): string | undefined;
}

const QUALIFIED_URL = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The Angular side of `MikeDownHost`: links, settings persistence and images. Value changes are handled by the core's
 * `bindMikeDownValue`, so there is no `onChange` here. The core calls these from outside the Angular zone (the
 * component creates the editor in `runOutsideAngular`), so anything that touches Angular state re-enters the zone.
 *
 * `uploadImage` and `resolveImageSrc` exist on the instance only when the component has an `imageUpload` callback or
 * an image base URL/resolver, because the core turns a feature off by checking whether the method is there.
 */
export class AngularMikeDownHost implements Partial<MikeDownHost> {
  uploadImage?: (file: ImageUploadRequest) => Promise<ImageInsertResult>;
  resolveImageSrc?: (src: string) => string | null;

  constructor(private readonly bindings: AngularMikeDownHostBindings) {
    if (bindings.imageUpload()) {
      this.uploadImage = (file) => {
        const upload = this.bindings.imageUpload();
        if (!upload) {
          return Promise.reject(new Error('MikeDown: imageUpload was removed'));
        }
        // The upload usually goes through HttpClient, so run it in the zone for interceptors and change detection.
        return this.bindings.zone.run(() => firstValueFrom(upload(file)));
      };
    }
    if (bindings.imageSrcResolver() || bindings.imageBaseUrl()) {
      this.resolveImageSrc = (src) => this.resolve(src);
    }
  }

  /** http(s), mailto and other qualified URLs open in a new tab; relative paths go through the Angular router. */
  openLink(href: string, behavior?: LinkOpenBehavior): void {
    if (!href || href.startsWith('#')) {
      return;
    }
    if (QUALIFIED_URL.test(href) || href.startsWith('//')) {
      if (/^javascript:/i.test(href)) {
        return;
      }
      if (behavior === 'navigateCurrentTab' && /^https?:/i.test(href)) {
        window.location.assign(href);
      } else {
        window.open(href, '_blank', 'noopener');
      }
      return;
    }
    const router = this.bindings.router;
    if (router) {
      this.bindings.zone.run(() => void router.navigateByUrl(href));
    } else {
      window.location.assign(href);
    }
  }

  saveSettings(patch: MikeDownSettingsPatch): void {
    const current = AngularMikeDownHost.loadSettings();
    try {
      localStorage.setItem(MIKEDOWN_SETTINGS_KEY, JSON.stringify({ ...current, ...patch }));
    } catch {
      // Private mode or a full quota: the change still applies for this session.
    }
  }

  /** The core has no loadSettings hook; the component merges this into `options.settings` at creation. */
  static loadSettings(): Partial<MikeDownSettings> {
    try {
      const raw = localStorage.getItem(MIKEDOWN_SETTINGS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Partial<MikeDownSettings>) : {};
    } catch {
      return {};
    }
  }

  private resolve(src: string): string | null {
    const resolver = this.bindings.imageSrcResolver();
    if (resolver) {
      return resolver(src);
    }
    const base = this.bindings.imageBaseUrl();
    if (!base) {
      return null;
    }
    // Root-relative paths keep their own root; everything else is relative to the base.
    const path = src.replace(/^\.\//, '');
    if (path.startsWith('/')) {
      return new URL(path, new URL(base, window.location.href)).toString();
    }
    return base.replace(/\/?$/, '/') + path;
  }
}
