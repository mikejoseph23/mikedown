// The blog (website/blog/): the index lists every post folder, each post has the
// metadata the index and the shell need, the prose keeps to the house style, and
// the local-AI post's hardware claims match the setup code they describe.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AI_LOCAL_MIN_MEMORY_GB,
  AI_LOCAL_MIN_UNIFIED_GB,
  AI_LOCAL_MIN_VRAM_GB,
  localSizeHint,
  recommendSetupPath,
} from '../../packages/core/src/ai/setup';
import { AI_DETECT_NONE } from '../../packages/core/src/ai-local-setup';

const blogDir = resolve(__dirname, '../blog');
const parse = (file: string) => new DOMParser().parseFromString(readFileSync(file, 'utf8'), 'text/html');
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const index = parse(join(blogDir, 'index.html'));
const postDirs = readdirSync(blogDir).filter((d) => statSync(join(blogDir, d)).isDirectory() && existsSync(join(blogDir, d, 'index.html')));
const posts = postDirs.map((slug) => ({ slug, doc: parse(join(blogDir, slug, 'index.html')) }));

describe('blog index', () => {
  it('lists every post folder once, newest first, with its title and date', () => {
    const cards = [...index.querySelectorAll('.posts > li[data-post]')];
    expect(cards.map((c) => c.getAttribute('data-post')).sort()).toEqual([...postDirs].sort());
    const dates = cards.map((c) => c.querySelector('time')?.getAttribute('datetime') ?? '');
    expect(dates).toEqual([...dates].sort().reverse());
    for (const card of cards) {
      const slug = card.getAttribute('data-post')!;
      const post = posts.find((p) => p.slug === slug)!.doc;
      expect(text(card.querySelector('h2'))).toBe(text(post.querySelector('.post h1')));
      expect(card.querySelector('time')?.getAttribute('datetime')).toBe(post.querySelector('.post__meta time')?.getAttribute('datetime'));
      expect(card.querySelector('h2 a')?.getAttribute('href')).toBe(`/mikedown/blog/${slug}/`);
    }
  });
});

describe.each(posts)('post $slug', ({ slug, doc }) => {
  it('has a title, a date, a canonical URL and a way back to the index', () => {
    const h1 = text(doc.querySelector('.post h1'));
    expect(h1).not.toBe('');
    expect(text(doc.querySelector('title'))).toBe(h1);
    expect(doc.querySelector('.post__meta time')?.getAttribute('datetime')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`https://www.iadev.net/mikedown/blog/${slug}/`);
    expect(doc.querySelector('.post__crumb')?.getAttribute('href')).toBe('/mikedown/blog/');
    expect(doc.querySelector('meta[property="og:type"]')?.getAttribute('content')).toBe('article');
  });

  it('uses the shell and the blog stylesheet', () => {
    const html = readFileSync(join(blogDir, slug, 'index.html'), 'utf8');
    expect(html).toContain('<!--shell:header page="blog"-->');
    expect(html).toContain('<!--shell:footer-->');
    expect(html).toContain('href="/blog/blog.css"');
  });

  it('keeps hyphens and dashes out of the prose as punctuation', () => {
    const prose = [...doc.querySelectorAll('.post p, .post li, .post dd, .post figcaption, .post h1, .post h2')].map(text);
    const bad = prose.filter((p) => /[—–]|\s-\s|\s-[^\s]|[^\s]-\s/.test(p));
    expect(bad).toEqual([]);
  });

  it('gives every image alt text and a size', () => {
    for (const img of doc.querySelectorAll('.post img')) {
      expect(img.getAttribute('alt')).toBeTruthy();
      expect(img.getAttribute('width')).toBeTruthy();
      expect(img.getAttribute('height')).toBeTruthy();
    }
  });
});

describe('the local-AI post matches the setup code', () => {
  const doc = posts.find((p) => p.slug === 'local-ai')!.doc;
  const body = text(doc.querySelector('.post__body'));
  const GB = 1024 ** 3;
  const apple = (gb: number) => ({ appleSilicon: true, totalMemoryBytes: gb * GB });

  it('states the three local-capable thresholds', () => {
    expect(body).toContain(`MacBook with ${AI_LOCAL_MIN_UNIFIED_GB} GB or more`);
    expect(body).toContain(`NVIDIA card with ${AI_LOCAL_MIN_VRAM_GB} GB of video memory or more`);
    expect(body).toContain(`${AI_LOCAL_MIN_MEMORY_GB} GB of plain RAM`);
  });

  it('quotes the model-size bands word for word', () => {
    const bands = [...doc.querySelectorAll('.bands dd')].map(text);
    expect(bands).toEqual([localSizeHint(apple(16)), localSizeHint(apple(32)), localSizeHint(apple(64))]);
    // The examples in the prose fall in the bands they claim.
    expect(localSizeHint(apple(16))).toMatch(/8B/);
    expect(localSizeHint(apple(36))).toMatch(/30B/);
  });

  it('quotes the wizard lines word for word', () => {
    const quotes = [...doc.querySelectorAll('.post__body blockquote')].map(text);
    const hw = recommendSetupPath({ running: [], hardware: apple(32) }).hardwareLine;
    expect(quotes).toEqual([AI_DETECT_NONE, hw]);
  });

  it('links to the Desktop AI section and the compare page', () => {
    const hrefs = [...doc.querySelectorAll('.post a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/mikedown/#ai');
    expect(hrefs).toContain('/mikedown/compare/');
  });
});
