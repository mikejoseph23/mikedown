/**
 * Where a clicked link goes (edge case 13). Pure so the decision table is
 * unit-testable; `TauriHost.openLink` acts on the result.
 */
import type { PathOps } from '@mikedown/core/shared/imagePaste';
import { classifyPath, type DocKind } from '../documents/documentModel';

export type LinkRoute =
  | { kind: 'external'; url: string }
  | { kind: 'anchor'; slug: string }
  | { kind: 'local'; path: string; fileKind: DocKind; anchor: string | null }
  | { kind: 'unresolvable'; href: string; reason: string };

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** Strip `#anchor` and `?query`, decode percent escapes. */
function splitTarget(href: string): { target: string; anchor: string | null } {
  const hash = href.indexOf('#');
  const anchor = hash >= 0 ? href.slice(hash + 1) : null;
  let target = hash >= 0 ? href.slice(0, hash) : href;
  const q = target.indexOf('?');
  if (q >= 0) {target = target.slice(0, q);}
  try { target = decodeURIComponent(target); } catch { /* keep raw */ }
  return { target, anchor: anchor === '' ? null : anchor };
}

function fromFileUrl(href: string): string | null {
  try {
    const u = new URL(href);
    if (u.protocol !== 'file:') {return null;}
    let p = decodeURIComponent(u.pathname);
    // file:///C:/x → C:/x on Windows-style paths.
    if (/^\/[a-zA-Z]:\//.test(p)) {p = p.slice(1);}
    return p;
  } catch {
    return null;
  }
}

export function routeLink(href: string, docPath: string | null, path: PathOps): LinkRoute {
  const trimmed = href.trim();
  if (!trimmed) {return { kind: 'unresolvable', href, reason: 'empty link' };}
  if (trimmed.startsWith('#')) {return { kind: 'anchor', slug: trimmed.slice(1) };}

  if (SCHEME.test(trimmed)) {
    const local = fromFileUrl(trimmed);
    if (local === null) {return { kind: 'external', url: trimmed };}
    const { anchor } = splitTarget(trimmed);
    return { kind: 'local', path: path.normalize(local), fileKind: classifyPath(local), anchor };
  }

  const { target, anchor } = splitTarget(trimmed);
  if (!target) {
    return anchor ? { kind: 'anchor', slug: anchor } : { kind: 'unresolvable', href, reason: 'empty link' };
  }
  let abs: string;
  if (path.isAbsolute(target)) {
    abs = path.normalize(target);
  } else if (docPath) {
    abs = path.resolve(path.dirname(docPath), target);
  } else {
    return { kind: 'unresolvable', href, reason: 'save the document before following relative links' };
  }
  return { kind: 'local', path: abs, fileKind: classifyPath(abs), anchor };
}
