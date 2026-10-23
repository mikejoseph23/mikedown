// Image-paste helpers shared by the VS Code extension host and the desktop
// app. Platform-neutral: no Node `path`/`crypto` imports. Path-dependent
// helpers come from `createImagePasteHelpers(env)`, where the host injects its
// path implementation (Node `path` in the extension) and optionally a SHA-1
// function (defaults to the pure `sha1Hex` in `./sha1`).
import { sha1Hex as pureSha1Hex } from './sha1';

export interface ImagePasteSettings {
  enabled: boolean;
  folder: string;
  folderRelativeTo: 'document' | 'workspace';
  filenamePattern: string;
  pathStyle: 'relative' | 'workspace-absolute';
  altText: 'empty' | 'filename' | 'prompt';
  maxSizeMB: number;
  cleanupUnreferenced: boolean;
}

/** The subset of Node's `path` module these helpers use. */
export interface PathOps {
  sep: string;
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
  dirname(p: string): string;
  basename(p: string, ext?: string): string;
  extname(p: string): string;
  relative(from: string, to: string): string;
  isAbsolute(p: string): boolean;
  normalize(p: string): string;
}

export interface ImagePasteEnv {
  path: PathOps;
  /** Full lowercase hex SHA-1 of the bytes. Defaults to the pure implementation. */
  sha1Hex?: (data: Uint8Array) => string;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/tiff': 'tiff',
  'image/avif': 'avif',
};

export function extensionFromMime(mime: string): string | null {
  return MIME_TO_EXT[mime.toLowerCase()] ?? null;
}

export interface FilenameContext {
  /** Markdown document base name without extension (e.g. "my-note"). */
  docName: string;
  /** Output extension without dot (e.g. "png"). */
  extension: string;
  /** Image bytes — used for the `${hash}` token. */
  data: Uint8Array;
  /** Timestamp used for `${date}`/`${time}`/`${timestamp}` tokens. */
  timestamp: Date;
  /** Auto-increment value for the `${index}` token. Defaults to 1. */
  index?: number;
}

/**
 * Strip characters that don't belong in a filename (Windows-strict set + control chars).
 * Collapses runs of whitespace/separators to a single dash.
 */
export function sanitizeForFilename(input: string): string {
  return input
    // eslint-disable-next-line no-control-regex -- intentional: strips ASCII control chars (\x00-\x1f) from filenames
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
}

export interface FilenameResolution {
  /** Final absolute path to the image on disk. */
  absPath: string;
  /** True when an existing identical file was reused (hash-dedupe hit). */
  reused: boolean;
}

/**
 * Pull all `![alt](src)` matches out of a markdown string and return their
 * `src` values. Skips external (http/https) and data URIs since those don't
 * map to local files we'd ever want to delete.
 */
export function extractLocalImageRefs(markdown: string): string[] {
  const out: string[] = [];
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const src = m[2].trim();
    if (!src) {continue;}
    if (/^(?:[a-z][a-z0-9+.-]*:|data:|\/\/)/i.test(src) && !src.startsWith('/')) {continue;}
    // Strip cache-bust query/fragment that the resize popover may have left in.
    const queryStart = src.search(/[?#]/);
    out.push(queryStart >= 0 ? src.slice(0, queryStart) : src);
  }
  return out;
}

/**
 * Heuristic: does `filename` look like a MikeDown-generated paste filename
 * (rather than a user-curated asset like `logo.png`)?
 *
 * Builds a regex from the configured `filenamePattern` by replacing tokens
 * with shape-anchors (`${timestamp}` → `\d{8}-\d{6}`, `${hash}` → 8 hex chars,
 * etc.). Allows an optional `-N` collision suffix and any image extension.
 *
 * Returns false on any pattern parse failure so we never accidentally widen
 * the cleanup set when the user has set a weird custom pattern.
 */
export function looksLikeAutoPastedImage(
  filename: string,
  pattern: string,
  docName: string
): boolean {
  if (!pattern) {return false;}
  const sanitizedDoc = sanitizeForFilename(docName) || 'image';
  const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let regex = '^';
  let i = 0;
  while (i < pattern.length) {
    const tail = pattern.slice(i);
    const tokenMatch = /^\$\{(\w+)\}/.exec(tail);
    if (tokenMatch) {
      const key = tokenMatch[1];
      switch (key) {
        case 'docName': regex += escapeRegex(sanitizedDoc); break;
        case 'date': regex += '\\d{8}'; break;
        case 'time': regex += '\\d{6}'; break;
        case 'timestamp': regex += '\\d{8}-\\d{6}'; break;
        case 'hash': regex += '[0-9a-f]{8}'; break;
        case 'index': regex += '\\d+'; break;
        // Unknown token — bail rather than match too broadly.
        default: return false;
      }
      i += tokenMatch[0].length;
    } else {
      regex += escapeRegex(pattern[i]);
      i += 1;
    }
  }
  regex += '(?:-\\d+)?\\.[a-zA-Z0-9]+$';
  try {
    return new RegExp(regex).test(filename);
  } catch {
    return false;
  }
}

/**
 * Decide what alt text to use, given the configured strategy and (optionally)
 * a user-provided value from the prompt UI.
 */
export function resolveAltText(
  strategy: 'empty' | 'filename' | 'prompt',
  filenameNoExt: string,
  promptedValue: string | undefined
): string {
  if (strategy === 'filename') {return filenameNoExt;}
  if (strategy === 'prompt') {return promptedValue ?? '';}
  return '';
}

/**
 * Build the path- and hash-dependent helpers for one host. The extension
 * passes Node's `path` and a `crypto` SHA-1; the desktop app passes its own
 * synchronous path implementation (the pure SHA-1 default works there).
 */
export function createImagePasteHelpers(env: ImagePasteEnv) {
  const path = env.path;
  const hashImpl = env.sha1Hex ?? pureSha1Hex;

  /**
   * Replace pattern tokens with concrete values. Unknown tokens pass through
   * untouched so user-typed text stays intact.
   *
   * Supported tokens:
   *   ${docName}    sanitized document base name
   *   ${date}       YYYYMMDD
   *   ${time}       HHmmss
   *   ${timestamp}  YYYYMMDD-HHmmss
   *   ${hash}       8-char SHA-1 of the image bytes
   *   ${index}      auto-increment value (default 1)
   */
  function expandFilenamePattern(pattern: string, ctx: FilenameContext): string {
    const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
    const t = ctx.timestamp;
    const date = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}`;
    const time = `${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`;
    const timestamp = `${date}-${time}`;

    // Lazy: only compute the hash if the pattern actually uses it.
    let hash = '';
    if (pattern.includes('${hash}')) {
      hash = sha1Hex(ctx.data).slice(0, 8);
    }

    const tokens: Record<string, string> = {
      docName: sanitizeForFilename(ctx.docName) || 'image',
      date,
      time,
      timestamp,
      hash,
      index: String(ctx.index ?? 1),
    };

    return pattern.replace(/\$\{(\w+)\}/g, (match: string, key: string) => {
      return Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : match;
    });
  }

  function sha1Hex(data: Uint8Array): string {
    return hashImpl(data);
  }

  /**
   * Resolve the absolute folder where pasted images should be written.
   * `workspaceRoot` may be undefined when the document is outside any workspace —
   * in that case `folderRelativeTo === 'workspace'` falls back to the document's
   * own directory.
   */
  function resolveTargetFolder(
    config: ImagePasteSettings,
    documentPath: string,
    workspaceRoot: string | undefined
  ): string {
    const folder = expandFolderPattern(config.folder, documentPath);
    if (path.isAbsolute(folder)) {
      return folder;
    }
    const base = config.folderRelativeTo === 'workspace' && workspaceRoot
      ? workspaceRoot
      : path.dirname(documentPath);
    return path.resolve(base, folder);
  }

  /**
   * Expand `${docName}` in the configured folder so each document can get its
   * own image folder (e.g. `assets/${docName}`). Only `${docName}` is supported:
   * time-based tokens would scatter one document's images across folders and
   * break orphan-cleanup scoping. Other tokens pass through untouched.
   */
  function expandFolderPattern(folder: string, documentPath: string): string {
    const docName = path.basename(documentPath, path.extname(documentPath));
    const safe = sanitizeForFilename(docName) || 'image';
    return folder.replace(/\$\{docName\}/g, safe);
  }

  /**
   * Compute the final on-disk path, handling collisions and hash-dedupe.
   *
   * Behavior:
   *   - If the resolved name (with extension) doesn't exist → use it verbatim.
   *   - If it exists AND `${hash}` is in the pattern AND content hashes match
   *     (per `readExistingHash`) → reuse the existing file (`reused: true`).
   *   - Otherwise → append `-1`, `-2`, … until a free slot is found.
   *
   * `readExistingHash` is injected so this function stays pure / testable; pass
   * a real fs-backed implementation from the production caller.
   */
  function resolveFilename(
    pattern: string,
    targetFolder: string,
    ctx: FilenameContext,
    fileExists: (absPath: string) => boolean,
    readExistingHash?: (absPath: string) => string
  ): FilenameResolution {
    const ext = ctx.extension;
    const baseName = expandFilenamePattern(pattern, ctx);
    const initialPath = path.join(targetFolder, `${baseName}.${ext}`);

    if (!fileExists(initialPath)) {
      return { absPath: initialPath, reused: false };
    }

    // Hash-dedupe: only triggered when the pattern explicitly opts in via ${hash}.
    // Without that opt-in we always create a new file (collision suffix path).
    if (pattern.includes('${hash}') && readExistingHash) {
      const incomingHash = sha1Hex(ctx.data);
      const existingHash = readExistingHash(initialPath);
      if (existingHash === incomingHash) {
        return { absPath: initialPath, reused: true };
      }
    }

    let i = 1;
    while (true) {
      const candidate = path.join(targetFolder, `${baseName}-${i}.${ext}`);
      if (!fileExists(candidate)) {
        return { absPath: candidate, reused: false };
      }
      i += 1;
    }
  }

  /**
   * Produce the path string to write into the markdown image link.
   *
   * `relative`            — POSIX-relative from the document's directory
   *                         (e.g. `images/foo.png`). Anchors with `./` only when
   *                         the path would otherwise look like a sibling file
   *                         starting with a letter — leaving plain `images/foo.png`
   *                         is the typical convention and what users expect.
   * `workspace-absolute`  — leading `/`, POSIX-relative from the workspace root.
   *                         Falls back to the document-relative form when the
   *                         document is outside any workspace.
   */
  function formatInsertPath(
    absImagePath: string,
    documentPath: string,
    workspaceRoot: string | undefined,
    pathStyle: 'relative' | 'workspace-absolute'
  ): string {
    const docDir = path.dirname(documentPath);
    if (pathStyle === 'workspace-absolute' && workspaceRoot) {
      return '/' + toPosix(path.relative(workspaceRoot, absImagePath));
    }
    return toPosix(path.relative(docDir, absImagePath));
  }

  function toPosix(p: string): string {
    return p.split(path.sep).join('/');
  }

  /**
   * Compute a sibling filename for a resized variant (e.g. `foo.png` + 50 →
   * `foo-50pct.png`). If that sibling already exists, append `-1`, `-2`, …
   * until a free slot is found.
   */
  function resizeSiblingPath(
    absPath: string,
    percent: number,
    fileExists: (absPath: string) => boolean
  ): string {
    const dir = path.dirname(absPath);
    const ext = path.extname(absPath);
    const base = path.basename(absPath, ext);
    const stem = `${base}-${Math.round(percent)}pct`;
    const initial = path.join(dir, `${stem}${ext}`);
    if (!fileExists(initial)) {return initial;}
    let i = 1;
    while (true) {
      const candidate = path.join(dir, `${stem}-${i}${ext}`);
      if (!fileExists(candidate)) {return candidate;}
      i += 1;
    }
  }

  /**
   * Resolve a list of image-link srcs (as parsed from markdown) to absolute fs
   * paths. `documentDir` is the directory of the markdown file the srcs came
   * from. `workspaceRoot` is required to resolve workspace-absolute paths
   * (those starting with `/`).
   */
  function resolveLocalImagePaths(
    srcs: string[],
    documentDir: string,
    workspaceRoot: string | undefined
  ): string[] {
    const out: string[] = [];
    for (const src of srcs) {
      if (path.isAbsolute(src)) {
        // A leading-slash path is workspace-absolute when we have a workspace,
        // otherwise it's a real absolute path on the host filesystem.
        if (src.startsWith('/') && workspaceRoot) {
          out.push(path.join(workspaceRoot, src));
        } else {
          out.push(src);
        }
        continue;
      }
      out.push(path.resolve(documentDir, src));
    }
    return out;
  }

  /**
   * True iff `absImagePath` lives inside the resolved imagePaste folder for
   * this document. Used by orphan-cleanup to scope deletion to MikeDown-managed
   * locations (we never touch images the user keeps elsewhere).
   */
  function isInsideManagedFolder(
    absImagePath: string,
    config: ImagePasteSettings,
    documentPath: string,
    workspaceRoot: string | undefined
  ): boolean {
    const folder = resolveTargetFolder(config, documentPath, workspaceRoot);
    // Use trailing-separator match so `/foo/imagesX/y.png` doesn't count as
    // being inside `/foo/images`.
    const folderWithSep = folder.endsWith(path.sep) ? folder : folder + path.sep;
    return absImagePath === folder || absImagePath.startsWith(folderWithSep);
  }

  /**
   * True iff `childPath` is `parentDir` itself or lives somewhere underneath it.
   * Uses `path.relative` so this is correct across separators; a relative
   * result that starts with `..` (or that is itself absolute, which
   * `path.relative` returns for cross-drive paths on Windows) means `childPath`
   * is outside `parentDir`.
   */
  function isPathInside(parentDir: string, childPath: string): boolean {
    const rel = path.relative(parentDir, childPath);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }

  /**
   * True iff `absPath` is outside every directory in `roots`. Used by the image
   * file picker (M4) to decide whether a picked file needs to be copied into
   * the image-paste target folder to be servable — VS Code's webview
   * `localResourceRoots` only covers the extension's own directories, the
   * document's folder, and workspace folders, so a file picked from elsewhere
   * (e.g. the user's Desktop) won't render unless it's copied in. Files already
   * inside one of `roots` are referenced in place.
   */
  function isOutsideResourceRoots(absPath: string, roots: string[]): boolean {
    return !roots.some(root => isPathInside(root, absPath));
  }

  return {
    expandFilenamePattern,
    resolveTargetFolder,
    expandFolderPattern,
    resolveFilename,
    formatInsertPath,
    resizeSiblingPath,
    resolveLocalImagePaths,
    isInsideManagedFolder,
    isPathInside,
    isOutsideResourceRoots,
    extensionFromMime,
    sanitizeForFilename,
    extractLocalImageRefs,
    looksLikeAutoPastedImage,
    resolveAltText,
  };
}

export type ImagePasteHelpers = ReturnType<typeof createImagePasteHelpers>;
