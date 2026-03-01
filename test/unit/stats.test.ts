import { describe, it, expect } from 'vitest';

// Replicate word counting logic from StatusBarManager
function countWords(text: string): number {
  // Strip markdown syntax before counting
  const stripped = text
    .replace(/^#{1,6}\s+/gm, '')          // headings
    .replace(/\*\*|__|~~|`/g, '')          // bold/italic/code markers
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images (keep alt text)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // links (keep link text)
    .replace(/^[-*+]\s+/gm, '')            // list markers
    .replace(/^\d+\.\s+/gm, '')            // ordered list markers
    .replace(/^>\s*/gm, '')                // blockquotes
    .trim();
  if (!stripped) return 0;
  return stripped.split(/\s+/).filter(w => w.length > 0).length;
}

function countChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

function readingTime(wordCount: number): number {
  return Math.ceil(wordCount / 200); // 200 wpm
}

describe('Document Stats', () => {
  it('counts words in plain text', () => {
    expect(countWords('hello world foo')).toBe(3);
  });

  it('returns 0 for empty document', () => {
    expect(countWords('')).toBe(0);
  });

  it('handles whitespace-only document', () => {
    expect(countWords('   \n\n\t  ')).toBe(0);
  });

  it('counts characters excluding whitespace', () => {
    expect(countChars('hello world')).toBe(10);
  });

  it('calculates reading time', () => {
    expect(readingTime(200)).toBe(1);
    expect(readingTime(400)).toBe(2);
    expect(readingTime(1)).toBe(1); // rounds up
  });

  it('counts words in heading text', () => {
    const text = '# Hello World\n\nSome body text here.';
    const count = countWords(text);
    expect(count).toBeGreaterThan(0);
  });

  it('counts code block words', () => {
    const text = 'Before\n```\nconst x = 1;\n```\nAfter';
    const count = countWords(text);
    expect(count).toBeGreaterThan(0);
  });
});
