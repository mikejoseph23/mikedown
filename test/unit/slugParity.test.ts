import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { githubAnchorId, dedupedAnchorIdAt } from '../../src/anchoring';

// The Heading Rename → Fix Links feature relies on host and webview computing
// byte-identical anchor slugs. They now share src/anchoring.ts; these tests lock
// that behaviour and guard against anyone re-introducing a divergent copy.

const ROOT = path.resolve(__dirname, '../..');

describe('githubAnchorId — GitHub slug parity', () => {
  const cases: Array<[string, string]> = [
    ['Hello World', 'hello-world'],
    ['Setup', 'setup'],
    ['Memory & Hardware', 'memory--hardware'], // punctuation stripped, spaces → hyphens
    ['UD-', 'ud-'], // trailing hyphen kept
    ['  Trimmed  ', 'trimmed'],
    ['Code: example()', 'code-example'],
    ['Already-hyphenated', 'already-hyphenated'],
    ['Tabs\tand spaces', 'tabs-and-spaces'],
    ['Über Café', 'ber-caf'], // non-ASCII word chars dropped by [^\w\s-]
  ];

  for (const [input, expected] of cases) {
    it(`slugifies ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(githubAnchorId(input)).toBe(expected);
    });
  }
});

describe('dedupedAnchorIdAt — encounter-order suffixes', () => {
  const headings = ['Setup', 'Usage', 'Setup', 'Setup'];

  it('keeps the base slug for the first occurrence', () => {
    expect(dedupedAnchorIdAt(headings, 0)).toBe('setup');
  });

  it('suffixes later duplicates 1-indexed', () => {
    expect(dedupedAnchorIdAt(headings, 2)).toBe('setup-1');
    expect(dedupedAnchorIdAt(headings, 3)).toBe('setup-2');
  });

  it('leaves unique headings unsuffixed', () => {
    expect(dedupedAnchorIdAt(headings, 1)).toBe('usage');
  });
});

describe('no divergent githubAnchorId copies remain', () => {
  // After consolidation, only src/anchoring.ts should DEFINE githubAnchorId.
  // Other files must import it. This prevents host/webview slug drift.
  const filesThatUseSlugs = [
    'src/outlineProvider.ts',
    'src/markdownEditorProvider.ts',
    'src/webview/editor-main.ts',
  ];

  for (const rel of filesThatUseSlugs) {
    it(`${rel} imports githubAnchorId rather than redefining it`, () => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      expect(src).not.toMatch(/function\s+githubAnchorId\b/);
      expect(src).toMatch(/import\s*\{[^}]*\bgithubAnchorId\b[^}]*\}\s*from\s*['"][^'"]*anchoring['"]/);
    });
  }
});
