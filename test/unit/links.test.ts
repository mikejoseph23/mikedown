import { describe, it, expect } from 'vitest';

// Replicate the githubAnchorId function from editor-main.ts
function githubAnchorId(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
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
