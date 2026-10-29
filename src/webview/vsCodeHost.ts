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
import type {
  AiCompletionRequest,
  AiCompletionResult,
  AiConsentAbout,
  AiConsentRecord,
  AiConsentReply,
  AiEngineStatus,
  AiError,
  AiHardwareInfo,
  AiHostEngineProbe,
  AiLocalServerProbe,
  MikeDownAiHost,
} from '../../packages/core/src/ai/types';
import { makeAiError, toAiError } from '../../packages/core/src/ai/errors';
import { toWireCompletionRequest } from '../../packages/core/src/ai/wire';
import { resolveSrcForEditor, type ImagePathPrefix } from '../../packages/core/src/shared/imageDisplayPath';

export interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

type Resolver<T> = { resolve: (value: T) => void; reject: (err: Error) => void };

/** A pending `ai*` request. Rejections are plain `AiError` objects, per the `ai` host contract. */
type AiWaiter = {
  resolve: (value: any) => void;
  reject: (err: AiError) => void;
  onToken?: (delta: string) => void;
};

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
  private readonly aiWaiters = new Map<string, AiWaiter>();
  private aiEngineWaiters: Array<(engines: AiEngineStatus[]) => void> = [];
  private readonly aiEnginesListeners = new Set<(engines: AiEngineStatus[]) => void>();

  private imagePathMappings: ImagePathPrefix[] = [];
  private docDir = '';

  constructor(private readonly vscode: VsCodeApi) {}

  /** Webview URI prefixes and the document folder, from the `settings` broadcast. */
  setImagePaths(mappings: ImagePathPrefix[] | undefined, docDir: string | undefined): void {
    if (Array.isArray(mappings)) {this.imagePathMappings = mappings;}
    if (typeof docDir === 'string') {this.docDir = docDir;}
  }

  /** Map a relative or absolute path to the webview URI that serves it. */
  resolveImageSrc(src: string): string | null {
    const resolved = resolveSrcForEditor(src, this.imagePathMappings, this.docDir);
    return resolved !== src ? resolved : null;
  }

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

  // ── AI (tier 2: the extension host runs the engines) ──────────────────────

  /** A request whose reply is keyed by `requestId` (aiEngineStatus, aiConsent, aiError). */
  private aiRequest<T>(msg: Record<string, unknown>): Promise<T> {
    const requestId = nextRequestId('ai');
    return new Promise<T>((resolve, reject) => {
      this.aiWaiters.set(requestId, { resolve, reject });
      this.post({ ...msg, requestId });
    });
  }

  /**
   * Engine statuses the host pushes on its own (after a settings change, a
   * probe, a discovery). Not part of `MikeDownAiHost`; the editor can listen
   * here to refresh the AI tab without asking.
   */
  onAiEngines(listener: (engines: AiEngineStatus[]) => void): () => void {
    this.aiEnginesListeners.add(listener);
    return () => this.aiEnginesListeners.delete(listener);
  }

  readonly ai: MikeDownAiHost = {
    complete: (req: AiCompletionRequest, onToken: (delta: string) => void, signal: AbortSignal): Promise<AiCompletionResult> => {
      const requestId = req.requestId;
      if (signal.aborted) {return Promise.reject(makeAiError('cancelled'));}
      return new Promise<AiCompletionResult>((resolve, reject) => {
        const onAbort = (): void => {
          if (!this.aiWaiters.has(requestId)) {return;}
          this.aiWaiters.delete(requestId);
          this.post({ type: 'aiCancel', requestId });
          reject(makeAiError('cancelled'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        const done = (): void => signal.removeEventListener('abort', onAbort);
        this.aiWaiters.set(requestId, {
          resolve: (result: AiCompletionResult) => { done(); resolve(result); },
          reject: (err) => { done(); reject(err); },
          onToken,
        });
        try {
          this.post({ type: 'aiComplete', request: toWireCompletionRequest(req) });
        } catch (err) {
          this.aiWaiters.delete(requestId);
          done();
          reject(toAiError(err));
        }
      });
    },
    listEngines: (): Promise<AiEngineStatus[]> =>
      new Promise((resolve) => {
        this.aiEngineWaiters.push(resolve);
        this.post({ type: 'aiListEngines' });
      }),
    testEngine: (engineId: string) => this.aiRequest<AiEngineStatus>({ type: 'aiTestEngine', engineId }),
    discoverModels: (engineId: string) => this.aiRequest<AiEngineStatus>({ type: 'aiDiscoverModels', engineId }),
    setSecret: (engineId: string, apiKey: string | null) =>
      this.aiRequest<AiEngineStatus>({ type: 'aiSetSecret', engineId, apiKey }).then(() => undefined),
    requestCloudConsent: (engineId: string, about?: AiConsentAbout) =>
      this.aiRequest<AiConsentReply>({ type: 'aiRequestCloudConsent', engineId, ...(about?.feature ? { feature: about.feature } : {}), ...(about?.sends ? { sends: about.sends } : {}) }),
    listConsents: () => this.aiRequest<AiConsentRecord[]>({ type: 'aiListConsents' }),
    forgetConsent: (engineId: string) => this.aiRequest<AiConsentRecord[]>({ type: 'aiForgetConsent', engineId }).then(() => undefined),
    // The host caps each address; an abort here only stops waiting for the answer.
    detectLocalServers: (candidates: { presetId: string; baseUrl: string }[], signal: AbortSignal): Promise<AiLocalServerProbe[]> => {
      if (signal.aborted) {return Promise.reject(makeAiError('cancelled'));}
      const requestId = nextRequestId('ai');
      return new Promise<AiLocalServerProbe[]>((resolve, reject) => {
        const onAbort = (): void => {
          if (!this.aiWaiters.delete(requestId)) {return;}
          reject(makeAiError('cancelled'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        const done = (): void => signal.removeEventListener('abort', onAbort);
        this.aiWaiters.set(requestId, {
          resolve: (probes: AiLocalServerProbe[]) => { done(); resolve(probes); },
          reject: (err) => { done(); reject(err); },
        });
        this.post({ type: 'aiDetectLocalServers', requestId, candidates });
      });
    },
    // The setup wizard: VS Code's Copilot models (listed, never sent anything) and this machine's hardware.
    detectHostEngines: () => this.aiRequest<AiHostEngineProbe[]>({ type: 'aiDetectHostEngines' }),
    hardwareInfo: () => this.aiRequest<AiHardwareInfo | null>({ type: 'aiHardwareInfo' }),
  };

  private handleAiReply(message: any): boolean {
    switch (message?.type) {
      case 'aiToken':
        this.aiWaiters.get(message.requestId)?.onToken?.(String(message.delta ?? ''));
        return true;
      case 'aiDone': {
        const waiter = this.aiWaiters.get(message.requestId);
        this.aiWaiters.delete(message.requestId);
        waiter?.resolve(message.result);
        return true;
      }
      case 'aiError': {
        const waiter = this.aiWaiters.get(message.requestId);
        this.aiWaiters.delete(message.requestId);
        waiter?.reject(toAiError({ code: message.code, message: message.message ?? '' }));
        return true;
      }
      case 'aiEngineStatus': {
        const waiter = this.aiWaiters.get(message.requestId);
        this.aiWaiters.delete(message.requestId);
        waiter?.resolve(message.status);
        return true;
      }
      case 'aiEngineProbes':
      case 'aiHostEngines': {
        const waiter = this.aiWaiters.get(message.requestId);
        this.aiWaiters.delete(message.requestId);
        waiter?.resolve(Array.isArray(message.probes) ? message.probes : []);
        return true;
      }
      case 'aiHardware': {
        const waiter = this.aiWaiters.get(message.requestId);
        this.aiWaiters.delete(message.requestId);
        waiter?.resolve(message.info && typeof message.info === 'object' ? message.info : null);
        return true;
      }
      case 'aiConsent': {
        const waiter = this.aiWaiters.get(message.requestId);
        this.aiWaiters.delete(message.requestId);
        waiter?.resolve(message.granted === 'never' || message.granted === 'once' ? message.granted : !!message.granted);
        return true;
      }
      case 'aiConsents': {
        const waiter = this.aiWaiters.get(message.requestId);
        this.aiWaiters.delete(message.requestId);
        waiter?.resolve(Array.isArray(message.consents) ? message.consents : []);
        return true;
      }
      case 'aiEngines': {
        // The reply to listEngines and also a push: every waiter gets the
        // list, and so does every listener.
        const engines: AiEngineStatus[] = Array.isArray(message.engines) ? message.engines : [];
        const waiters = this.aiEngineWaiters;
        this.aiEngineWaiters = [];
        waiters.forEach(w => w(engines));
        this.aiEnginesListeners.forEach(l => l(engines));
        return true;
      }
      default:
        return false;
    }
  }

  // ── Replies from the extension host ───────────────────────────────────────

  /**
   * Route a reply message to the Promise waiting for it. Returns true when the
   * message was a reply and was consumed; false means the caller should treat
   * it as a push.
   */
  handleReply(message: any): boolean {
    if (this.handleAiReply(message)) {return true;}
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
