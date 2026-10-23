/**
 * `uploadImage` / `pickImage` / `resizeImage` for the desktop host, over the
 * Rust fs commands and core's shared image-paste helpers (the same folder,
 * filename-pattern, hash-dedupe and path-style rules as the VS Code
 * extension). Edge case 14: an unsaved document prompts for Save As first;
 * cancelling rejects so the paste is dropped.
 */
import type {
  ImageInsertResult,
  ImageResizeRequest,
  ImageResizeResult,
  ImageUploadRequest,
  MikeDownHost,
} from '@mikedown/core';
import {
  createImagePasteHelpers,
  extensionFromMime,
  resolveAltText,
  type ImagePasteHelpers,
  type ImagePasteSettings,
  type PathOps,
} from '@mikedown/core/shared/imagePaste';
import { sha1Hex } from '@mikedown/core/shared/sha1';
import type { FsApi } from '../documents/fsApi';
import type { DesktopSettings } from '../settings/desktopSettings';

export interface ImagePipelineDeps {
  path: PathOps;
  fs: Pick<FsApi, 'listDir' | 'readBytes' | 'writeBytes' | 'mkdir' | 'allowAsset'>;
  getDocument(): { path: string | null; workspaceRoot?: string };
  getSettings(): DesktopSettings;
  /** Edge case 14: offer Save As; resolves the new path, or null when cancelled. */
  ensureSaved(): Promise<string | null>;
  pickFile(defaultDir: string): Promise<string | null>;
  promptAlt(): Promise<string | undefined>;
  notifyError(message: string): void;
  notify(message: string): void;
  now?: () => Date;
}

export type ImagePipeline = Required<Pick<MikeDownHost, 'uploadImage' | 'pickImage' | 'resizeImage'>>;

/** What `resolveImageTarget` needs; `existingNames` is the target folder's listing. */
export interface ImageTargetInput {
  helpers: ImagePasteHelpers;
  path: PathOps;
  settings: ImagePasteSettings;
  docPath: string;
  workspaceRoot?: string;
  /** Extension without the dot. */
  ext: string;
  data: Uint8Array;
  timestamp: Date;
  existingNames: ReadonlySet<string>;
  /** SHA-1 of the file already at the pattern's first candidate path, when it exists. */
  existingHashOfInitial?: string;
}

export interface ImageTarget {
  targetFolder: string;
  absPath: string;
  reused: boolean;
  /** What goes into the markdown. */
  insertPath: string;
  filenameNoExt: string;
}

/** Pure: folder, collision-free filename (or hash-dedupe reuse) and the link path. */
export function resolveImageTarget(input: ImageTargetInput): ImageTarget {
  const { helpers, path, settings, docPath, workspaceRoot } = input;
  const targetFolder = helpers.resolveTargetFolder(settings, docPath, workspaceRoot);
  const docName = path.basename(docPath, path.extname(docPath));
  const ctx = { docName, extension: input.ext, data: input.data, timestamp: input.timestamp };
  const resolution = helpers.resolveFilename(
    settings.filenamePattern,
    targetFolder,
    ctx,
    (p) => input.existingNames.has(path.basename(p)),
    () => input.existingHashOfInitial ?? '',
  );
  const insertPath = helpers.formatInsertPath(resolution.absPath, docPath, workspaceRoot, settings.pathStyle);
  return {
    targetFolder,
    absPath: resolution.absPath,
    reused: resolution.reused,
    insertPath,
    filenameNoExt: path.basename(resolution.absPath, path.extname(resolution.absPath)),
  };
}

/** `?v=…` cache-bust the resize popover appends, and any fragment. */
export function stripQuery(src: string): string {
  const cut = src.search(/[?#]/);
  return cut >= 0 ? src.slice(0, cut) : src;
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export function createImagePipeline(deps: ImagePipelineDeps): ImagePipeline {
  const { path, fs } = deps;
  const helpers = createImagePasteHelpers({ path });
  const now = deps.now ?? (() => new Date());

  async function documentPathOrPrompt(): Promise<string> {
    const current = deps.getDocument().path;
    if (current) {return current;}
    const saved = await deps.ensureSaved();
    if (!saved) {throw new Error('document not saved');}
    return saved;
  }

  async function namesIn(folder: string): Promise<Set<string>> {
    try {
      return new Set((await fs.listDir(folder)).map((e) => e.name));
    } catch {
      return new Set();
    }
  }

  /** Write `data` into the document's image folder per settings; returns the markdown path. */
  async function placeImage(data: Uint8Array, ext: string, docPath: string): Promise<ImageTarget> {
    const settings = deps.getSettings().imagePaste;
    const workspaceRoot = deps.getDocument().workspaceRoot;
    const targetFolder = helpers.resolveTargetFolder(settings, docPath, workspaceRoot);
    const existingNames = await namesIn(targetFolder);

    // Hash-dedupe only looks at the pattern's first candidate, so one read
    // is enough (the helpers are synchronous; see M1 notes).
    let existingHashOfInitial: string | undefined;
    if (settings.filenamePattern.includes('${hash}')) {
      const docName = path.basename(docPath, path.extname(docPath));
      const base = helpers.expandFilenamePattern(settings.filenamePattern, { docName, extension: ext, data, timestamp: now() });
      const initial = `${base}.${ext}`;
      if (existingNames.has(initial)) {
        try { existingHashOfInitial = sha1Hex(await fs.readBytes(path.join(targetFolder, initial))); } catch { /* treat as different */ }
      }
    }

    const target = resolveImageTarget({
      helpers, path, settings, docPath, workspaceRoot, ext, data, timestamp: now(), existingNames, existingHashOfInitial,
    });
    if (!target.reused) {
      await fs.mkdir(target.targetFolder);
      await fs.writeBytes(target.absPath, data);
    }
    return target;
  }

  async function altFor(filenameNoExt: string): Promise<string> {
    const strategy = deps.getSettings().imagePaste.altText;
    if (strategy === 'prompt') {
      return resolveAltText('prompt', filenameNoExt, await deps.promptAlt());
    }
    return resolveAltText(strategy, filenameNoExt, undefined);
  }

  return {
    async uploadImage(file: ImageUploadRequest): Promise<ImageInsertResult> {
      const settings = deps.getSettings().imagePaste;
      if (!settings.enabled) {throw new Error('imagePaste.enabled is false');}
      const docPath = await documentPathOrPrompt();
      const ext = extensionFromMime(file.mime);
      if (!ext) {
        deps.notifyError(`Unsupported image type: ${file.mime || 'unknown'}`);
        throw new Error(`unsupported MIME type: ${file.mime}`);
      }
      if (file.bytes.length === 0) {throw new Error('empty image data');}
      const sizeMB = file.bytes.length / (1024 * 1024);
      if (sizeMB > settings.maxSizeMB) {
        const msg = `Pasted image is ${sizeMB.toFixed(1)} MB, over the ${settings.maxSizeMB} MB limit (Settings → Images).`;
        deps.notifyError(msg);
        throw new Error(msg);
      }
      let target: ImageTarget;
      try {
        target = await placeImage(file.bytes, ext, docPath);
      } catch (err) {
        const msg = `Could not save the image: ${(err as Error).message ?? String(err)}`;
        deps.notifyError(msg);
        throw new Error(msg);
      }
      const alt = await altFor(target.filenameNoExt);
      return { src: target.insertPath, alt };
    },

    async pickImage(): Promise<ImageInsertResult | null> {
      const docPath = await documentPathOrPrompt();
      const docDir = path.dirname(docPath);
      const picked = await deps.pickFile(docDir);
      if (!picked) {return null;}
      const settings = deps.getSettings().imagePaste;
      const workspaceRoot = deps.getDocument().workspaceRoot;
      let finalAbs = picked;
      const roots = [docDir, ...(workspaceRoot ? [workspaceRoot] : [])];
      if (helpers.isOutsideResourceRoots(picked, roots)) {
        // Outside the document's folder: copy it in so the link stays portable.
        const ext = path.extname(picked).replace(/^\./, '').toLowerCase() || 'png';
        try {
          const data = await fs.readBytes(picked);
          finalAbs = (await placeImage(data, ext, docPath)).absPath;
        } catch (err) {
          const msg = `Could not copy the image: ${(err as Error).message ?? String(err)}`;
          deps.notifyError(msg);
          throw new Error(msg);
        }
      } else {
        await fs.allowAsset(finalAbs).catch(() => { /* already in scope */ });
      }
      const insertPath = helpers.formatInsertPath(finalAbs, docPath, workspaceRoot, settings.pathStyle);
      const alt = await altFor(path.basename(finalAbs, path.extname(finalAbs)));
      return { src: insertPath, alt };
    },

    async resizeImage(req: ImageResizeRequest): Promise<ImageResizeResult> {
      const docPath = deps.getDocument().path;
      if (!docPath) {throw new Error('document is not a saved file');}
      const src = stripQuery(req.currentSrc.trim());
      if (!src || EXTERNAL.test(src)) {
        throw new Error('external URLs and data URIs cannot be resized in place');
      }
      const abs = path.isAbsolute(src) ? path.normalize(src) : path.resolve(path.dirname(docPath), src);
      const overwrite = deps.getSettings().imageResize.overwrite;
      const percent = Math.max(1, Math.min(200, Math.round(req.percent)));
      let target = abs;
      if (!overwrite) {
        const siblings = await namesIn(path.dirname(abs));
        target = helpers.resizeSiblingPath(abs, percent, (p) => siblings.has(path.basename(p)));
      }
      await fs.writeBytes(target, req.bytes);
      const kb = (req.bytes.length / 1024).toFixed(1);
      deps.notify(`Resized to ${percent}% (${kb} KB)`);
      const workspaceRoot = deps.getDocument().workspaceRoot;
      return { src: helpers.formatInsertPath(target, docPath, workspaceRoot, 'relative'), overwritten: overwrite };
    },
  };
}
