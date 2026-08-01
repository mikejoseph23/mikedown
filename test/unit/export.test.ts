import { describe, it, expect } from 'vitest';
import { slugifyHeading, addHeadingIds, fixInternalLinks, buildFullHtml } from '../../src/export';

describe('slugifyHeading', () => {
  it('matches GitHub slugs for numbered headings with punctuation', () => {
    expect(slugifyHeading('1. Meeting at a Glance')).toBe('1-meeting-at-a-glance');
    expect(slugifyHeading("3. Aaron's Background and Skill Set")).toBe(
      '3-aarons-background-and-skill-set'
    );
    expect(slugifyHeading('6. The Website — Core Business Discussion')).toBe(
      '6-the-website--core-business-discussion'
    );
  });

  it('lowercases and hyphenates', () => {
    expect(slugifyHeading('Table of Contents')).toBe('table-of-contents');
  });
});

describe('addHeadingIds', () => {
  it('adds slug ids to headings', () => {
    expect(addHeadingIds('<h2>Table of Contents</h2>')).toBe(
      '<h2 id="table-of-contents">Table of Contents</h2>'
    );
  });

  it('ignores inline markup when slugifying but preserves it in output', () => {
    expect(addHeadingIds('<h3>Action <em>Items</em></h3>')).toBe(
      '<h3 id="action-items">Action <em>Items</em></h3>'
    );
  });

  it('decodes entities before slugifying', () => {
    expect(addHeadingIds('<h2>Q &amp; A</h2>')).toBe('<h2 id="q--a">Q &amp; A</h2>');
  });

  it('suffixes duplicate slugs', () => {
    const out = addHeadingIds('<h2>Notes</h2><h2>Notes</h2><h2>Notes</h2>');
    expect(out).toBe(
      '<h2 id="notes">Notes</h2><h2 id="notes-1">Notes</h2><h2 id="notes-2">Notes</h2>'
    );
  });

  it('leaves existing ids alone', () => {
    const html = '<h1 id="custom">Title</h1>';
    expect(addHeadingIds(html)).toBe(html);
  });

  it('preserves other heading attributes', () => {
    expect(addHeadingIds('<h2 class="x">Title</h2>')).toBe('<h2 class="x" id="title">Title</h2>');
  });
});

describe('fixInternalLinks', () => {
  it('strips target and rel from anchor links', () => {
    const html =
      '<a target="_blank" rel="noopener noreferrer nofollow" href="#table-of-contents">↑ Back to top</a>';
    expect(fixInternalLinks(html)).toBe('<a href="#table-of-contents">↑ Back to top</a>');
  });

  it('leaves external links untouched', () => {
    const html = '<a target="_blank" rel="noopener" href="https://example.com">x</a>';
    expect(fixInternalLinks(html)).toBe(html);
  });
});

describe('buildFullHtml', () => {
  it('produces anchors that resolve to heading ids', () => {
    const out = buildFullHtml(
      '<h2>Table of Contents</h2><p><a target="_blank" rel="nofollow" href="#table-of-contents">top</a></p>',
      'doc'
    );
    expect(out).toContain('<h2 id="table-of-contents">Table of Contents</h2>');
    expect(out).toContain('<a href="#table-of-contents">top</a>');
  });
});
