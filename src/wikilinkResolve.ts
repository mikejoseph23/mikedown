import * as path from 'path';

// Wikilink collision handling.
//
// `[[Note]]` is a name-based reference, so in a real vault several files can
// share a basename (many repos have a `README.md`, `index.md`, `notes.md`…).
// When that happens we can't pick arbitrarily — we rank the candidates by
// proximity to the document doing the linking, mirroring how Obsidian prefers
// the "nearest" note:
//
//   1. a file in the SAME folder as the current document wins outright
//   2. otherwise the file fewest directory hops away in the tree
//   3. deterministic tiebreak: shorter absolute path, then lexicographic
//
// `> 1` candidate ⇒ the reference is ambiguous; callers surface that as a hint
// so the user knows to rename/disambiguate.

/** Directory-tree distance between `fromDir` and a file, measured as the number
 *  of path segments in the relative path (each `..` counts as a hop). The
 *  trailing filename segment is a constant offset across candidates, so it does
 *  not affect ordering. */
function treeDistance(fromDir: string, filePath: string): number {
  const rel = path.relative(fromDir, filePath);
  if (!rel) return 0;
  return rel.split(path.sep).filter((s) => s.length > 0).length;
}

/** Rank basename-matching markdown files by proximity to `fromDir` (closest
 *  first). Pure and order-stable for a given input. */
export function rankWikilinkCandidates(fsPaths: string[], fromDir: string): string[] {
  const from = path.resolve(fromDir);
  return [...fsPaths].sort((a, b) => {
    const dirA = path.dirname(path.resolve(a));
    const dirB = path.dirname(path.resolve(b));

    // 1. Same folder as the current document wins.
    const sameA = dirA === from ? 0 : 1;
    const sameB = dirB === from ? 0 : 1;
    if (sameA !== sameB) return sameA - sameB;

    // 2. Fewest hops through the directory tree.
    const distA = treeDistance(from, path.resolve(a));
    const distB = treeDistance(from, path.resolve(b));
    if (distA !== distB) return distA - distB;

    // 3. Deterministic tiebreak.
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/** The single best basename match for `fromDir`, or null when none match. */
export function pickBestWikilinkTarget(fsPaths: string[], fromDir: string): string | null {
  if (fsPaths.length === 0) return null;
  return rankWikilinkCandidates(fsPaths, fromDir)[0];
}
