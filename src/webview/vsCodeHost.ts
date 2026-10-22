/**
 * VsCodeHost — the MikeDownHost implementation for the VS Code webview.
 *
 * Each host method posts the message shape the extension host
 * (markdownEditorProvider.ts) has always received. Request/response pairs
 * keep their `requestId` (or reply-type) correlation here, so the editor core
 * only ever sees Promises.
 */

import type {
  DiffBaseline,
  ImageInsertResult,
  ImageResizeRequest,
  ImageResizeResult,
  ImageUploadRequest,
  LinkCheckRequest,
  LinkOpenBehavior,
  LinkSuggestion,
  MikeDownHost,
  MikeDownSidebarPrefs,
  MikeDownStats,
  TagCount,
  WikilinkResolution,
} from '../../packages/core/src/host';
import type { MikeDownSettingsPatch } from '../../packages/core/src/types';

export interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

type Resolver<T> = { resolve: (value: T) => void; reject: (err: Error) => void };

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked so a large image doesn't blow the call stack through apply().
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize) as unknown as number[];
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function nextRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class VsCodeHost implements MikeDownHost {
  private readonly pastes = new Map<string, Resolver<ImageInsertResult>>();
  private readonly picks = new Map<string, Resolver<ImageInsertResult | null>>();
  private readonly resizes = new Map<string, Resolver<ImageResizeResult>>();
  private linkSuggestionWaiters: Array<Resolver<LinkSuggestion[]>> = [];
  private readonly fileHeadingWaiters = new Map<string, Array<Resolver<LinkSuggestion[]>>>();
  private wikilinkWaiters: Array<Resolver<WikilinkResolution[]>> = [];
  private readonly wikilinkCreateWaiters = new Map<string, Resolver<WikilinkResolution[]>>();
  private checkLinkWaiters: Array<Resolver<string[]>> = [];
  private tagWaiters: Array<Resolver<TagCount[]>> = [];
  private diffWaiters: Array<Resolver<DiffBaseline>> = [];

  constructor(private readonly vscode: VsCodeApi) {}

  post(msg: unknown): void {
    this.vscode.postMessage(msg);
  }

  // ── Document ──────────────────────────────────────────────────────────────

  onChange(markdown: string, meta: { pristine: boolean }): void {
    this.post({ type: 'edit', content: markdown, pristine: meta.pristine });
  }

  onStats(stats: MikeDownStats): void {
    this.post({ type: 'stats', ...stats });
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  openLink(href: string, behavior?: LinkOpenBehavior, reveal?: { href?: string; occurrence?: number }): void {
    const msg: Record<string, unknown> = { type: 'openLink', href };
    if (behavior) {msg.behavior = behavior;}
    if (reveal) {
      msg.revealHref = reveal.href;
      msg.revealOccurrence = reveal.occurrence;
    }
    this.post(msg);
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  saveSettings(patch: MikeDownSettingsPatch, opts?: { source?: 'slashMenu'; silent?: boolean }): void {
    const msg: Record<string, unknown> = { type: 'saveSettings', settings: patch };
    if (opts?.silent) {msg.silent = true;}
    if (opts?.source) {msg.source = opts.source;}
    this.post(msg);
  }

  toggleTheme(): void {
    this.post({ type: 'toggleTheme' });
  }

  openKeybindings(): void {
    this.post({ type: 'openKeybindings' });
  }

  // ── Images ────────────────────────────────────────────────────────────────

  uploadImage(file: ImageUploadRequest): Promise<ImageInsertResult> {
    const requestId = nextRequestId('imgpaste');
    return new Promise((resolve, reject) => {
      this.pastes.set(requestId, { resolve, reject });
      this.post({ type: 'savePastedImage', requestId, mime: file.mime, dataBase64: bytesToBase64(file.bytes) });
    });
  }

  pickImage(): Promise<ImageInsertResult | null> {
    const requestId = nextRequestId('imgpick');
    return new Promise((resolve, reject) => {
      this.picks.set(requestId, { resolve, reject });
      this.post({ type: 'pickImage', requestId });
    });
  }

  resizeImage(req: ImageResizeRequest): Promise<ImageResizeResult> {
    const requestId = nextRequestId('imgresize');
    return new Promise((resolve, reject) => {
      this.resizes.set(requestId, { resolve, reject });
      this.post({
        type: 'resizeImage',
        requestId,
        currentSrc: req.currentSrc,
        mime: req.mime,
        dataBase64: bytesToBase64(req.bytes),
        percent: req.percent,
      });
    });
  }

  // ── Knowledge-base features ───────────────────────────────────────────────

  getLinkSuggestions(): Promise<LinkSuggestion[]> {
    return new Promise((resolve, reject) => {
      this.linkSuggestionWaiters.push({ resolve, reject });
      this.post({ type: 'getLinkSuggestions' });
    });
  }

  getFileHeadings(path: string): Promise<LinkSuggestion[]> {
    return new Promise((resolve, reject) => {
      const list = this.fileHeadingWaiters.get(path) ?? [];
      list.push({ resolve, reject });
      this.fileHeadingWaiters.set(path, list);
      this.post({ type: 'getFileHeadings', filePath: path });
    });
  }

  resolveWikilinks(targets: string[]): Promise<WikilinkResolution[]> {
    return new Promise((resolve, reject) => {
      this.wikilinkWaiters.push({ resolve, reject });
      this.post({ type: 'resolveWikilinks', targets });
    });
  }

  createWikilink(target: string): Promise<WikilinkResolution[]> {
    return new Promise((resolve, reject) => {
      // The host replies only when it actually created the file; a newer
      // click on the same target replaces the older waiter.
      this.wikilinkCreateWaiters.set(target, { resolve, reject });
      this.post({ type: 'createWikilink', target });
    });
  }

  checkLinks(links: LinkCheckRequest[]): Promise<string[]> {
    return new Promise((resolve, reject) => {
      this.checkLinkWaiters.push({ resolve, reject });
      this.post({ type: 'checkLinks', links });
    });
  }

  getTags(): Promise<TagCount[]> {
    return new Promise((resolve, reject) => {
      this.tagWaiters.push({ resolve, reject });
      this.post({ type: 'getTags' });
    });
  }

  openTag(tag: string): void {
    this.post({ type: 'openTag', tag });
  }

  getDiffBaseline(): Promise<DiffBaseline> {
    return new Promise((resolve, reject) => {
      this.diffWaiters.push({ resolve, reject });
      this.post({ type: 'requestDiff' });
    });
  }

  onHeadingRenamed(oldSlug: string, newSlug: string): void {
    this.post({ type: 'headingRenamed', oldSlug, newSlug });
  }

  onHeadingRenameAmbiguous(baseName: string): void {
    this.post({ type: 'headingRenameAmbiguous', baseName });
  }

  // ── Output ────────────────────────────────────────────────────────────────

  exportHtml(html: string): void {
    this.post({ type: 'exportHtml', html });
  }

  printDocument(html: string): void {
    this.post({ type: 'printDocument', html });
  }

  viewInBrowser(html: string): void {
    this.post({ type: 'viewInBrowser', html });
  }

  // ── Sidebar ───────────────────────────────────────────────────────────────

  readonly sidebarPrefs: MikeDownSidebarPrefs = {
    requestState: () => this.post({ type: 'sidebarRequestState' }),
    setPref: (pref) => this.post({ type: 'sidebarSetPref', pref }),
    applyDefaults: () => this.post({ type: 'sidebarApplyDefaults' }),
    sectionCollapsed: (section, collapsed) => this.post({ type: 'sidebarSectionCollapsed', section, collapsed }),
  };

  // ── Replies from the extension host ───────────────────────────────────────

  /**
   * Route a reply message to the Promise waiting for it. Returns true when the
   * message was a reply and was consumed; false means the caller should treat
   * it as a push.
   */
  handleReply(message: any): boolean {
    switch (message?.type) {
      case 'pastedImageResult': {
        const waiter = this.pastes.get(message.requestId);
        if (!waiter) {return true;}
        this.pastes.delete(message.requestId);
        if (message.success) {
          waiter.resolve({ src: message.webviewUri ?? message.insertPath ?? '', alt: message.alt ?? '' });
        } else {
          waiter.reject(new Error(message.error ?? ''));
        }
        return true;
      }
      case 'pickedImageResult': {
        const waiter = this.picks.get(message.requestId);
        if (!waiter) {return true;}
        this.picks.delete(message.requestId);
        if (message.error) {
          waiter.reject(new Error(message.error));
        } else if (message.cancelled) {
          waiter.resolve(null);
        } else {
          waiter.resolve({ src: message.webviewUri ?? message.insertPath ?? '', alt: message.alt ?? '' });
        }
        return true;
      }
      case 'resizeImageResult': {
        const waiter = this.resizes.get(message.requestId);
        if (!waiter) {return true;}
        this.resizes.delete(message.requestId);
        if (message.success) {
          waiter.resolve({ src: message.webviewUri, overwritten: !!message.overwritten });
        } else {
          waiter.reject(new Error(message.error || 'unknown error'));
        }
        return true;
      }
      case 'linkSuggestions': {
        // Replies carry no correlation id: every outstanding request gets
        // the same (latest) list. An unsolicited list is a push.
        if (this.linkSuggestionWaiters.length === 0) {return false;}
        const waiters = this.linkSuggestionWaiters;
        this.linkSuggestionWaiters = [];
        waiters.forEach(w => w.resolve(message.suggestions || []));
        return true;
      }
      case 'fileHeadings': {
        const waiters = this.fileHeadingWaiters.get(message.filePath);
        if (!waiters) {return true;}
        this.fileHeadingWaiters.delete(message.filePath);
        waiters.forEach(w => w.resolve(message.anchors || []));
        return true;
      }
      case 'wikilinksResolved': {
        const results: WikilinkResolution[] = message.results || [];
        // A single result for a target we asked to create is the create
        // reply; anything else answers the oldest resolve request.
        if (results.length === 1) {
          const create = this.wikilinkCreateWaiters.get(results[0].target);
          if (create) {
            this.wikilinkCreateWaiters.delete(results[0].target);
            create.resolve(results);
            return true;
          }
        }
        const waiter = this.wikilinkWaiters.shift();
        if (waiter) {
          waiter.resolve(results);
        } else {
          const anyCreate = this.wikilinkCreateWaiters.entries().next();
          if (!anyCreate.done) {
            this.wikilinkCreateWaiters.delete(anyCreate.value[0]);
            anyCreate.value[1].resolve(results);
          }
        }
        return true;
      }
      case 'brokenLinks': {
        const waiter = this.checkLinkWaiters.shift();
        waiter?.resolve(message.hrefs || []);
        return true;
      }
      case 'tags': {
        // Pushed on ready and on index changes, and also the reply to
        // getTags. Waiters get it; the caller still applies it as a push.
        const waiters = this.tagWaiters;
        this.tagWaiters = [];
        waiters.forEach(w => w.resolve(message.tags || []));
        return waiters.length > 0;
      }
      case 'diffData': {
        const waiter = this.diffWaiters.shift();
        waiter?.resolve({ headContent: message.headContent ?? null, hasChanges: !!message.hasChanges });
        return true;
      }
      default:
        return false;
    }
  }
}
