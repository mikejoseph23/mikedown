/**
 * Pure rules behind the folder tree: ordering, hidden entries, name
 * validation, New File naming, collision-free copy names, the
 * `.mikedown/versions/` mirror path and type-ahead. The Rust side applies the
 * same ordering, filtering and validation (`src-tauri/src/commands/fs.rs`);
 * these copies keep the tree correct for entries it learns about itself and
 * give inline rename instant feedback before anything reaches the disk.
 */
import type { PathOps } from '@mikedown/core/shared/imagePaste';

export interface TreeEntry {
  name: string;
  isDir: boolean;
}

/** Natural, case-insensitive order: `file2` before `file10`. Mirrors `natural_cmp` in fs.rs. */
export function naturalCompare(a: string, b: string): number {
  const ac = Array.from(a);
  const bc = Array.from(b);
  let i = 0;
  let j = 0;
  const isDigit = (c: string): boolean => c >= '0' && c <= '9';
  while (i < ac.length && j < bc.length) {
    if (isDigit(ac[i]) && isDigit(bc[j])) {
      const si = i;
      while (i < ac.length && isDigit(ac[i])) {i++;}
      const sj = j;
      while (j < bc.length && isDigit(bc[j])) {j++;}
      const ta = ac.slice(si, i).join('').replace(/^0+/, '');
      const tb = bc.slice(sj, j).join('').replace(/^0+/, '');
      if (ta.length !== tb.length) {return ta.length - tb.length;}
      if (ta !== tb) {return ta < tb ? -1 : 1;}
      continue;
    }
    const la = ac[i].toLowerCase();
    const lb = bc[j].toLowerCase();
    if (la !== lb) {return la < lb ? -1 : 1;}
    i++;
    j++;
  }
  const rest = (ac.length - i) - (bc.length - j);
  if (rest !== 0) {return rest;}
  return a === b ? 0 : a < b ? -1 : 1;
}

/** Folders first, then natural order. Returns a new array. */
export function sortEntries<T extends TreeEntry>(entries: readonly T[]): T[] {
  return [...entries].sort((x, y) => (x.isDir === y.isDir ? naturalCompare(x.name, y.name) : x.isDir ? -1 : 1));
}

const CLUTTER_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/** Hidden unless "show hidden": dotfolders, `node_modules`, OS clutter files. Dotfiles stay visible. */
export function isHiddenEntry(entry: TreeEntry): boolean {
  if (entry.isDir) {return entry.name.startsWith('.') || entry.name === 'node_modules';}
  return CLUTTER_FILES.has(entry.name);
}

/** MikeDown's own temp files (`.name.mikedown-….tmp`), never shown. */
export function isMikedownTemp(name: string): boolean {
  return name.startsWith('.') && name.endsWith('.tmp') && name.includes('.mikedown-');
}

export function visibleEntries<T extends TreeEntry>(entries: readonly T[], showHidden: boolean): T[] {
  return sortEntries(entries.filter((e) => !isMikedownTemp(e.name) && (showHidden || !isHiddenEntry(e))));
}

const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/** MAX_PATH minus the terminating NUL (edge case 25: no long paths in v1). */
export const WINDOWS_MAX_PATH = 259;

/**
 * Plain-language reason a name is refused, or null. Mirrors `validate_name`
 * in fs.rs; `windows` adds reserved device names, forbidden characters and
 * the trailing dot/space rule.
 */
export function validateName(name: string, windows: boolean): string | null {
  if (name.trim() === '') {return 'The name cannot be empty.';}
  if (name === '.' || name === '..') {return `“${name}” is not a valid name.`;}
  if (name.includes('/') || name.includes('\0') || (windows && name.includes('\\'))) {return `“${name}” cannot contain a slash.`;}
  if (windows) {
    const bad = Array.from(name).find((c) => '<>:"|?*'.includes(c) || c.charCodeAt(0) < 0x20);
    if (bad !== undefined) {
      const shown = bad.charCodeAt(0) < 0x20 ? 'a control character' : `“${bad}”`;
      return `“${name}” cannot contain ${shown} on Windows.`;
    }
    if (name.endsWith('.') || name.endsWith(' ')) {return `“${name}” cannot end with a dot or a space on Windows.`;}
    const stem = name.split('.')[0].trimEnd().toUpperCase();
    if (WINDOWS_RESERVED.has(stem)) {
      return `“${name}” uses a name Windows reserves for devices (CON, PRN, AUX, NUL, COM1–COM9, LPT1–LPT9). Choose another name.`;
    }
  }
  return null;
}

/** Name check plus Windows' full-path length limit. */
export function validateTarget(fullPath: string, name: string, windows: boolean): string | null {
  const nameError = validateName(name, windows);
  if (nameError) {return nameError;}
  if (windows && fullPath.length > WINDOWS_MAX_PATH) {
    return `The full path would be ${fullPath.length} characters long; Windows allows at most ${WINDOWS_MAX_PATH}. Use a shorter name or a folder nearer the top of the drive.`;
  }
  return null;
}

/** New File (edge case 29): a name typed without an extension gets `.md`. */
export function withMarkdownExtension(name: string): string {
  const trimmed = name.trim();
  const base = trimmed.split(/[\\/]/).pop() ?? trimmed;
  return base.lastIndexOf('.') > 0 ? trimmed : `${trimmed}.md`;
}

/** First free name among `taken` (case-insensitive): `Untitled.md`, `Untitled 2.md`, … */
export function uniqueName(name: string, taken: Iterable<string>, style: 'number' | 'copy' = 'number'): string {
  const lower = new Set(Array.from(taken, (t) => t.toLowerCase()));
  if (!lower.has(name.toLowerCase())) {return name;}
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; n < 10_000; n++) {
    const suffix = style === 'copy' ? (n === 2 ? ' copy' : ` copy ${n - 1}`) : ` ${n}`;
    const candidate = `${stem}${suffix}${ext}`;
    if (!lower.has(candidate.toLowerCase())) {return candidate;}
  }
  return `${stem} ${Date.now()}${ext}`;
}

/** True when `child` is `parent` or inside it. Case-insensitive on Windows. */
export function isInside(parent: string, child: string, path: PathOps): boolean {
  const rel = path.relative(parent, child);
  if (rel === '') {return true;}
  return rel.split(/[\\/]/)[0] !== '..' && !path.isAbsolute(rel);
}

/**
 * `.mikedown/versions/<relative path>/` for a file or folder inside `root`
 * (edge case 1), or null for anything outside it. Rename, move and delete
 * carry it along (edge case 3).
 */
export function versionsPathFor(root: string, target: string, path: PathOps): string | null {
  if (!isInside(root, target, path)) {return null;}
  const rel = path.relative(root, target);
  if (rel === '' || rel.split(/[\\/]/)[0] === '.mikedown') {return null;}
  return path.join(root, '.mikedown', 'versions', rel);
}

/** Rewrite `p` when it is `from` or lives under it (an open file inside a renamed folder). */
export function rebasePath(p: string, from: string, to: string, path: PathOps): string | null {
  if (!isInside(from, p, path)) {return null;}
  const rel = path.relative(from, p);
  return rel === '' ? to : path.join(to, rel);
}

/**
 * Type-ahead: the index of the next visible row (after `from`, wrapping)
 * whose name starts with `query` (case-insensitive), or -1.
 */
export function typeAheadIndex(names: readonly string[], query: string, from: number): number {
  if (!query || names.length === 0) {return -1;}
  const q = query.toLowerCase();
  // Pressing the same letter again cycles through the names starting with
  // it; a longer query refines the match from the current row.
  const repeated = Array.from(q).every((c) => c === q[0]);
  const prefix = repeated ? q[0] : q;
  const start = repeated ? from + 1 : Math.max(from, 0);
  for (let k = 0; k < names.length; k++) {
    const i = (start + k) % names.length;
    if (names[i].toLowerCase().startsWith(prefix)) {return i;}
  }
  return -1;
}
