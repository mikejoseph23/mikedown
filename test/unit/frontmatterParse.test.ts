import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../../src/webview/frontmatterParse';

describe('parseFrontmatter', () => {
  it('returns [] for empty input', () => {
    expect(parseFrontmatter('')).toEqual([]);
  });

  it('parses scalar key/value pairs', () => {
    const yaml = `title: Hello\nauthor: Mike\ndate: 2026-05-20`;
    expect(parseFrontmatter(yaml)).toEqual([
      { key: 'title', value: 'Hello' },
      { key: 'author', value: 'Mike' },
      { key: 'date', value: '2026-05-20' },
    ]);
  });

  it('strips surrounding quotes from values', () => {
    const yaml = `title: "Quoted"\nlabel: 'single'`;
    expect(parseFrontmatter(yaml)).toEqual([
      { key: 'title', value: 'Quoted' },
      { key: 'label', value: 'single' },
    ]);
  });

  it('parses flow-style arrays', () => {
    const yaml = `tags: [foo, bar, baz]`;
    expect(parseFrontmatter(yaml)).toEqual([
      { key: 'tags', value: ['foo', 'bar', 'baz'] },
    ]);
  });

  it('parses block-style arrays', () => {
    const yaml = `tags:\n  - foo\n  - bar`;
    expect(parseFrontmatter(yaml)).toEqual([
      { key: 'tags', value: ['foo', 'bar'] },
    ]);
  });

  it('ignores comments and blank lines', () => {
    const yaml = `# A comment\n\ntitle: Hello\n# another\nauthor: Mike\n`;
    expect(parseFrontmatter(yaml)).toEqual([
      { key: 'title', value: 'Hello' },
      { key: 'author', value: 'Mike' },
    ]);
  });

  it('preserves the literal date string (no clever formatting)', () => {
    const yaml = `date: 2026-05-20T08:30:00`;
    expect(parseFrontmatter(yaml)).toEqual([
      { key: 'date', value: '2026-05-20T08:30:00' },
    ]);
  });

  it('skips indented nested map values (top-level only)', () => {
    const yaml = `parent:\n    nested: value\nsibling: top`;
    const result = parseFrontmatter(yaml);
    const keys = result.map(r => r.key);
    expect(keys).toContain('sibling');
    expect(keys).toContain('parent');
  });
});
