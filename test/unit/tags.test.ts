import { describe, it, expect } from 'vitest';
import { findInlineTags, normalizeTag, isValidTag } from '../../src/tagSyntax';
import { extractTags } from '../../src/tagExtract';

describe('inline tag syntax', () => {
  const tagsIn = (s: string) => findInlineTags(s).map(m => m.tag);

  it('matches simple and nested tags', () => {
    expect(tagsIn('a #foo b #project/active c')).toEqual(['foo', 'project/active']);
  });

  it('requires a letter (rejects pure-number tags)', () => {
    expect(tagsIn('issue #1234 and #v2')).toEqual(['v2']);
  });

  it('allows hyphen and underscore', () => {
    expect(tagsIn('#my-tag #to_do')).toEqual(['my-tag', 'to_do']);
  });

  it('ignores `#` preceded by a word char, `#`, `&`, or `/`', () => {
    expect(tagsIn('foo#bar ##heading url/#frag &#39;')).toEqual([]);
  });

  it('does not treat ATX headings (`# Heading`) as tags', () => {
    expect(tagsIn('# Heading')).toEqual([]);
  });

  it('reports the offset of the `#`', () => {
    const [m] = findInlineTags('hi #tag');
    expect(m.index).toBe(3);
    expect(m.length).toBe(4);
  });

  it('normalizeTag strips leading # and lowercases', () => {
    expect(normalizeTag('#Foo')).toBe('foo');
    expect(normalizeTag('  Bar/Baz ')).toBe('bar/baz');
    expect(normalizeTag('#123')).toBeNull();
    expect(isValidTag('123')).toBe(false);
  });
});

describe('extractTags (frontmatter + body)', () => {
  it('reads frontmatter array tags', () => {
    const doc = ['---', 'title: x', 'tags: [Alpha, beta]', '---', 'body'].join('\n');
    expect([...extractTags(doc)].sort()).toEqual(['alpha', 'beta']);
  });

  it('reads frontmatter block-style tags and merges with inline', () => {
    const doc = ['---', 'tags:', '  - one', '  - two', '---', 'inline #three here'].join('\n');
    expect([...extractTags(doc)].sort()).toEqual(['one', 'three', 'two']);
  });

  it('ignores tags inside fenced and inline code', () => {
    const doc = ['real #keep', '```', '#nope', '```', 'and `#alsonope` done'].join('\n');
    expect([...extractTags(doc)]).toEqual(['keep']);
  });

  it('ignores `#anchor` inside markdown link targets', () => {
    const doc = 'see [docs](./other.md#section) and #realtag';
    expect([...extractTags(doc)]).toEqual(['realtag']);
  });

  it('dedupes case-insensitively across sources', () => {
    const doc = ['---', 'tags: [Foo]', '---', 'body #foo #FOO'].join('\n');
    expect([...extractTags(doc)]).toEqual(['foo']);
  });
});
