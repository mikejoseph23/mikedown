import { describe, it, expect } from 'vitest';
import * as path from 'path';

// Replicate the githubAnchorId function from editor-main.ts
function githubAnchorId(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

// Replicate decodePathPart from markdownEditorProvider.ts — the openLink and
// checkLinks handlers feed the result into vscode.Uri.joinPath / path.resolve,
// which treat the input as a literal path. Percent-encoded link destinations
// (the more conservative of CommonMark's two valid forms) must be decoded first
// so the resolved path matches the literal filename on disk.
function decodePathPart(input: string): string {
  try { return decodeURI(input); } catch { return input; }
}

describe('GitHub Anchor ID Generation', () => {
  it('converts to lowercase', () => {
    expect(githubAnchorId('Hello World')).toBe('hello-world');
  });

  it('removes special characters', () => {
    expect(githubAnchorId('Hello! World?')).toBe('hello-world');
  });

  it('collapses multiple spaces to single hyphen', () => {
    expect(githubAnchorId('Hello   World')).toBe('hello-world');
  });

  it('handles numbered headings', () => {
    expect(githubAnchorId('1. Getting Started')).toBe('1-getting-started');
  });

  it('handles unicode text', () => {
    const result = githubAnchorId('Hello 世界');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles heading with existing hyphens', () => {
    expect(githubAnchorId('API Reference Guide')).toBe('api-reference-guide');
  });

  it('handles empty string', () => {
    expect(githubAnchorId('')).toBe('');
  });
});

describe('Relative link path decoding', () => {
  // Mirrors the resolution done by the openLink / checkLinks handlers in
  // markdownEditorProvider.ts. The href arrives verbatim from the markdown
  // source; the host must percent-decode it before touching the filesystem.
  function resolveHref(currentDir: string, href: string): string {
    const [filePart] = href.split('#');
    return path.resolve(currentDir, decodePathPart(filePart));
  }

  const currentDir = '/repo/docs/notes/deep';

  it('decodes %20 spaces in encoded path destinations', () => {
    const href = '../../sibling/My%20File.md';
    expect(resolveHref(currentDir, href)).toBe('/repo/docs/sibling/My File.md');
  });

  it('decodes parentheses and spaces together (the reported repro)', () => {
    const href =
      '../../../../MjcApp/MjcApi/MjcApi.Data/_SQL%20Files/Mutuels/' +
      '2026-05-20%20-%20M6%20HILL%20deal%20defaults%20Alt2%20FH%2036pct%20takeout%20%28DEV%20DRAFT%29.sql';
    expect(resolveHref('/a/b/c/d/e', href)).toBe(
      '/a/MjcApp/MjcApi/MjcApi.Data/_SQL Files/Mutuels/' +
      '2026-05-20 - M6 HILL deal defaults Alt2 FH 36pct takeout (DEV DRAFT).sql'
    );
  });

  it('strips a #anchor before resolving the file part', () => {
    const href = '../sibling/Other%20File.md#some-heading';
    expect(resolveHref(currentDir, href)).toBe('/repo/docs/notes/sibling/Other File.md');
  });

  it('passes a plain unencoded path through unchanged', () => {
    const href = '../sibling.md';
    expect(resolveHref(currentDir, href)).toBe('/repo/docs/notes/sibling.md');
  });

  it('falls back to the raw input when the percent-sequence is malformed', () => {
    // decodeURI throws on `%ZZ`; the catch must return the original string so
    // the resolver still produces some path (which will just 404 cleanly).
    const href = './broken%ZZ.md';
    expect(resolveHref(currentDir, href)).toBe('/repo/docs/notes/deep/broken%ZZ.md');
  });

  it('preserves `/` separators rather than decoding them away', () => {
    // decodeURI (vs decodeURIComponent) leaves reserved characters alone, so
    // the path structure survives even if someone over-encodes a slash.
    const href = 'a%2Fb/c.md';
    expect(resolveHref(currentDir, href)).toBe('/repo/docs/notes/deep/a%2Fb/c.md');
  });
});

describe('Anchor ID Deduplication', () => {
  it('generates unique IDs for duplicate headings', () => {
    const headings = ['Introduction', 'Introduction', 'Introduction'];
    const seen = new Map<string, number>();
    const ids: string[] = [];
    for (const h of headings) {
      const base = githubAnchorId(h);
      const count = seen.get(base) || 0;
      ids.push(count === 0 ? base : `${base}-${count}`);
      seen.set(base, count + 1);
    }
    expect(ids[0]).toBe('introduction');
    expect(ids[1]).toBe('introduction-1');
    expect(ids[2]).toBe('introduction-2');
  });
});
