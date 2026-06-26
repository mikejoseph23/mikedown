// Shared GitHub-style anchor slug generation.
//
// IMPORTANT: this module must be importable by BOTH webpack bundles — the
// extension host (node target, tsconfig.json) and the webview (web target,
// tsconfig.webview.json). Keep it dependency-free: no `vscode`, no `node:*`,
// no DOM. (Same rule as imageDisplayPath.ts.) The "Heading Rename → Fix Links"
// feature relies on host and webview computing byte-identical slugs.

/**
 * Convert heading text to a GitHub-style anchor id (the "base" slug, before any
 * duplicate-disambiguation suffix).
 *
 * Match GitHub exactly: strip punctuation, then turn each whitespace char into a
 * hyphen. Do NOT collapse consecutive hyphens or trim trailing ones — GitHub
 * keeps them (e.g. "Memory & Hardware" → "memory--hardware", "UD-" → "ud-").
 */
export function githubAnchorId(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // remove punctuation (keep word chars, whitespace, hyphens)
    .replace(/\s/g, '-'); // each whitespace char → hyphen (preserve consecutive)
}

/**
 * Given heading texts in document order, return the deduplicated anchor id for
 * the heading at `index`, using GitHub's encounter-order suffixing
 * (`setup`, `setup-1`, `setup-2`, …). The first occurrence keeps the base slug.
 */
export function dedupedAnchorIdAt(headingTexts: string[], index: number): string {
  const seen = new Map<string, number>();
  for (let i = 0; i < headingTexts.length; i++) {
    const base = githubAnchorId(headingTexts[i]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (i === index) return count === 0 ? base : `${base}-${count}`;
  }
  return '';
}
