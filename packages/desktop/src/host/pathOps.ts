/**
 * Synchronous path arithmetic for the webview. `@tauri-apps/api/path` is
 * async, but core's image-paste helpers (`createImagePasteHelpers`) take a
 * synchronous `PathOps`, so this is a small Node-`path`-compatible subset for
 * the two platforms the app ships on. Pure: no I/O, no cwd (every input the
 * app feeds it is absolute already; a fully relative `resolve` anchors at the
 * root rather than at a working directory).
 */
import type { PathOps } from '@mikedown/core/shared/imagePaste';

export type PathPlatform = 'posix' | 'win32';

const WIN_DRIVE = /^[a-zA-Z]:/;
const WIN_UNC = /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+/;

export function createPathOps(platform: PathPlatform): PathOps {
  const win = platform === 'win32';
  const sep = win ? '\\' : '/';
  const splitRe = win ? /[\\/]+/ : /\/+/;

  function isAbsolute(p: string): boolean {
    if (!win) {return p.startsWith('/');}
    return /^[a-zA-Z]:[\\/]/.test(p) || /^[\\/]{2}/.test(p);
  }

  /** `{ root, parts }` where root is '/' , 'C:\' , '\\server\share\' or ''. */
  function split(p: string): { root: string; parts: string[] } {
    let root = '';
    let rest = p;
    if (win) {
      const unc = WIN_UNC.exec(p);
      if (unc) {
        root = '\\\\' + unc[0].slice(2).replace(/[\\/]+/g, '\\') + '\\';
        rest = p.slice(unc[0].length);
      } else if (WIN_DRIVE.test(p)) {
        const drive = p.slice(0, 2);
        rest = p.slice(2);
        if (/^[\\/]/.test(rest)) {root = drive + '\\';} else {root = drive;}
      } else if (/^[\\/]/.test(p)) {
        root = '\\';
      }
    } else if (p.startsWith('/')) {
      root = '/';
    }
    const parts = rest.split(splitRe).filter((s) => s.length > 0);
    return { root, parts };
  }

  function normalizeParts(parts: string[], absolute: boolean): string[] {
    const out: string[] = [];
    for (const part of parts) {
      if (part === '.') {continue;}
      if (part === '..') {
        if (out.length > 0 && out[out.length - 1] !== '..') {out.pop();}
        else if (!absolute) {out.push('..');}
        continue;
      }
      out.push(part);
    }
    return out;
  }

  function normalize(p: string): string {
    if (p === '') {return '.';}
    const { root, parts } = split(p);
    const trailing = /[\\/]$/.test(p) ? sep : '';
    const normalized = normalizeParts(parts, root !== '');
    let result = root + normalized.join(sep);
    if (result === '') {return '.';}
    if (normalized.length > 0 && trailing) {result += trailing;}
    return result;
  }

  function join(...parts: string[]): string {
    const joined = parts.filter((s) => s.length > 0).join(sep);
    return joined === '' ? '.' : normalize(joined);
  }

  function resolve(...parts: string[]): string {
    let resolved = '';
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      if (!part) {continue;}
      resolved = resolved ? part + sep + resolved : part;
      if (isAbsolute(part)) {break;}
    }
    if (!isAbsolute(resolved)) {resolved = sep + resolved;}
    const { root, parts: segs } = split(resolved);
    return root + normalizeParts(segs, true).join(sep);
  }

  function dirname(p: string): string {
    const { root, parts } = split(p);
    if (parts.length === 0) {return root || '.';}
    const head = parts.slice(0, -1);
    if (head.length === 0) {return root || '.';}
    return root + head.join(sep);
  }

  function basename(p: string, ext?: string): string {
    const { parts } = split(p);
    const base = parts.length > 0 ? parts[parts.length - 1] : '';
    if (ext && base !== ext && base.endsWith(ext)) {return base.slice(0, base.length - ext.length);}
    return base;
  }

  function extname(p: string): string {
    const base = basename(p);
    const dot = base.lastIndexOf('.');
    if (dot <= 0) {return '';}
    return base.slice(dot);
  }

  function relative(from: string, to: string): string {
    const a = split(resolve(from));
    const b = split(resolve(to));
    const fold = (s: string): string => (win ? s.toLowerCase() : s);
    if (fold(a.root) !== fold(b.root)) {
      // Different drive or UNC share: there is no relative path.
      return resolve(to);
    }
    const ap = normalizeParts(a.parts, true);
    const bp = normalizeParts(b.parts, true);
    let i = 0;
    while (i < ap.length && i < bp.length && fold(ap[i]) === fold(bp[i])) {i++;}
    const up = ap.slice(i).map(() => '..');
    return [...up, ...bp.slice(i)].join(sep);
  }

  return { sep, join, resolve, dirname, basename, extname, relative, isAbsolute, normalize };
}

/** The platform the app is running on, from the user agent. */
export function detectPathPlatform(nav: { platform?: string; userAgent?: string } = navigator): PathPlatform {
  const p = `${nav.platform ?? ''} ${nav.userAgent ?? ''}`;
  return /win/i.test(p) && !/darwin|mac/i.test(p) ? 'win32' : 'posix';
}

/** Forward slashes for markdown links, whatever the platform. */
export function toPosixSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}
