// Shared word-count + reading-time helpers. Used by the host status bar
// (src/statusBar.ts) and the in-editor sidebar footer (src/webview/outlineSidebar.ts)
// so both surfaces show the same numbers without duplicating the regex set.

/**
 * Count "words" in markdown-flavored text after stripping syntax that should
 * not contribute to word count (markers, code fences, list bullets, etc.).
 *
 * Conservative on purpose — alt text inside links is kept (it's user-visible
 * prose), but fenced code blocks are dropped entirely.
 */
export function countWords(text: string): number {
  const stripped = text
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*|__|\*|_|~~|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/^---+$/gm, '')
    .trim();

  if (!stripped) return 0;
  return stripped.split(/\s+/).filter(w => w.length > 0).length;
}

const WPM = 225;

/** Minutes (rounded up, minimum 1) it would take to read `wordCount` words. */
export function readingMinutes(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / WPM));
}
