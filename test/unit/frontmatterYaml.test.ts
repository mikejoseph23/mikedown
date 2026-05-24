import { describe, it, expect } from 'vitest';
import {
  parseFrontmatter,
  serializeFrontmatter,
  isSimpleFrontmatter,
  type ParsedEntry,
} from '../../src/frontmatterYaml';

describe('serializeFrontmatter', () => {
  it('returns empty string for no entries', () => {
    expect(serializeFrontmatter([])).toBe('');
  });

  it('emits scalar key/value lines', () => {
    const entries: ParsedEntry[] = [
      { key: 'title', value: 'Hello' },
      { key: 'author', value: 'Mike' },
    ];
    expect(serializeFrontmatter(entries)).toBe('title: Hello\nauthor: Mike');
  });

  it('emits an empty value as a bare colon', () => {
    expect(serializeFrontmatter([{ key: 'draft', value: '' }])).toBe('draft:');
  });

  it('emits arrays in flow style', () => {
    expect(
      serializeFrontmatter([{ key: 'tags', value: ['foo', 'bar', 'baz'] }])
    ).toBe('tags: [foo, bar, baz]');
  });

  it('quotes values that would otherwise re-parse as a number or boolean', () => {
    expect(serializeFrontmatter([
      { key: 'version', value: '1' },
      { key: 'enabled', value: 'true' },
    ])).toBe('version: "1"\nenabled: "true"');
  });

  it('quotes values containing YAML-special characters', () => {
    expect(serializeFrontmatter([
      { key: 'url', value: 'https://example.com/x?y=1' },
      { key: 'spec', value: 'a: b' },
    ])).toBe('url: "https://example.com/x?y=1"\nspec: "a: b"');
  });

  it('preserves entry order', () => {
    const entries: ParsedEntry[] = [
      { key: 'z', value: '1' },
      { key: 'a', value: '2' },
      { key: 'm', value: '3' },
    ];
    const yaml = serializeFrontmatter(entries);
    const parsedKeys = parseFrontmatter(yaml).map(e => e.key);
    expect(parsedKeys).toEqual(['z', 'a', 'm']);
  });
});

describe('isSimpleFrontmatter', () => {
  it('treats empty input as simple', () => {
    expect(isSimpleFrontmatter('')).toBe(true);
  });

  it('accepts plain scalars + flow arrays', () => {
    expect(isSimpleFrontmatter('title: x\ntags: [a, b]')).toBe(true);
  });

  it('accepts block-style arrays', () => {
    expect(isSimpleFrontmatter('tags:\n  - a\n  - b')).toBe(true);
  });

  it('rejects nested maps', () => {
    expect(isSimpleFrontmatter('parent:\n  nested: value')).toBe(false);
  });

  it('rejects indented continuation lines', () => {
    expect(isSimpleFrontmatter('desc:\n  multi line value')).toBe(false);
  });

  it('ignores comments and blank lines', () => {
    expect(isSimpleFrontmatter('# top comment\n\ntitle: x\n')).toBe(true);
  });
});

describe('round-trip parse(serialize(x)) === parse(x)', () => {
  const cases: Array<{ name: string; yaml: string }> = [
    { name: 'plain scalars', yaml: 'title: Hello\nauthor: Mike' },
    { name: 'flow array', yaml: 'tags: [foo, bar, baz]' },
    { name: 'block array', yaml: 'tags:\n  - foo\n  - bar' },
    { name: 'numeric-looking string', yaml: 'version: "1"' },
    { name: 'quoted url', yaml: 'url: "https://example.com"' },
    { name: 'empty value', yaml: 'draft:' },
    { name: 'date string', yaml: 'date: 2026-05-20' },
    { name: 'mixed', yaml: 'title: Hello\ntags: [a, b]\nstatus: shipped' },
  ];

  for (const { name, yaml } of cases) {
    it(`round-trips: ${name}`, () => {
      const parsed = parseFrontmatter(yaml);
      const reparsed = parseFrontmatter(serializeFrontmatter(parsed));
      expect(reparsed).toEqual(parsed);
    });
  }
});
