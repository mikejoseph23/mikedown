/**
 * The text a ghost request sends (D3): the last 2400 chars before the caret
 * verbatim, a headings note for anything earlier, a capped suffix, nothing
 * from frontmatter.
 */
import { describe, expect, it } from 'vitest';
import { GHOST_AFTER_CHARS, GHOST_BEFORE_CHARS, GHOST_OUTLINE_MAX_CHARS, ghostContext } from '../src/ai';

/** Sections of filler prose, each under its own heading. */
function longDoc(sections: number, perSection = 1200): string {
  const out: string[] = [];
  for (let i = 1; i <= sections; i++) {
    out.push(`## Section ${i}\n\n${('Sentence number ' + i + ' goes here. ').repeat(Math.ceil(perSection / 30)).slice(0, perSection)}`);
  }
  return out.join('\n\n');
}

describe('ghostContext', () => {
  it('a short document is sent whole before the caret', () => {
    const md = '# Title\n\nHello world';
    expect(ghostContext(md, md.length, 8192)).toEqual({ before: md, after: '' });
  });

  it('splits at the caret and sends the text after it', () => {
    const md = 'First half. Second half.';
    const c = ghostContext(md, 'First half.'.length, 8192);
    expect(c.before).toBe('First half.');
    expect(c.after).toBe(' Second half.');
  });

  it('caps the suffix at 600 chars', () => {
    const md = 'Start' + 'x'.repeat(2000);
    const c = ghostContext(md, 5, 8192);
    expect(c.after).toHaveLength(GHOST_AFTER_CHARS);
    expect(GHOST_AFTER_CHARS).toBe(600);
  });

  it('a whitespace-only suffix is returned empty', () => {
    const md = 'Hello\n\n   \n';
    expect(ghostContext(md, 5, 8192).after).toBe('');
  });

  it('a long document gets a headings note plus the last 2400 chars', () => {
    const md = longDoc(60);
    const c = ghostContext(md, md.length, 4096);
    expect(c.before).toContain('Part of the document is left out');
    expect(c.before).toMatch(/- Section \d+/);
    // Nothing from the top of the document is sent as text.
    expect(c.before).not.toContain('Sentence number 1 goes here');
    expect(c.before.endsWith(md.slice(-GHOST_BEFORE_CHARS))).toBe(true);
    const note = c.before.slice(0, c.before.length - GHOST_BEFORE_CHARS);
    expect(note.length).toBeLessThanOrEqual(GHOST_OUTLINE_MAX_CHARS + 200);
  });

  it('a huge context window makes no difference to a long document', () => {
    const md = longDoc(60);
    const small = ghostContext(md, md.length, 8192);
    const huge = ghostContext(md, md.length, 1_000_000);
    expect(huge).toEqual(small);
    expect(huge.before).toContain('Part of the document is left out');
    expect(huge.before.length).toBeLessThan(GHOST_BEFORE_CHARS + GHOST_OUTLINE_MAX_CHARS + 200);
    expect(huge.before.endsWith(md.slice(-GHOST_BEFORE_CHARS))).toBe(true);
  });

  it('keeps the last 2400 chars before the caret verbatim, mid-document too', () => {
    const md = longDoc(60);
    const caret = Math.floor(md.length * 0.8);
    const c = ghostContext(md, caret, 4096);
    expect(GHOST_BEFORE_CHARS).toBe(2400);
    expect(c.before.endsWith(md.slice(caret - GHOST_BEFORE_CHARS, caret))).toBe(true);
    expect(c.after).toBe(md.slice(caret, caret + GHOST_AFTER_CHARS));
  });

  it('a short document is sent whole, with no note, however large the window', () => {
    const md = longDoc(2, 900);
    expect(md.length).toBeLessThan(GHOST_BEFORE_CHARS);
    for (const window of [1024, 8192, 1_000_000]) {
      const c = ghostContext(md, md.length, window);
      expect(c.before).toBe(md);
      expect(c.before).not.toContain('left out');
    }
  });

  it('a prefix of exactly the tail length has no note', () => {
    const md = 'a'.repeat(GHOST_BEFORE_CHARS);
    expect(ghostContext(md, md.length, 1_000_000).before).toBe(md);
  });

  it('a small window shrinks the verbatim tail', () => {
    const md = longDoc(60);
    // (1024 - 48 output - 400 reserve) tokens at 3.5 chars each is about 2000 chars.
    const c1 = ghostContext(md, md.length, 1024);
    expect(c1.before.endsWith(md.slice(-2016))).toBe(true);
    expect(c1.before.endsWith(md.slice(-2100))).toBe(false);
    const c2 = ghostContext(md, md.length, 600);
    expect(c2.before.endsWith(md.slice(-532))).toBe(true);
    expect(c2.before.endsWith(md.slice(-600))).toBe(false);
  });

  it('the tail never shrinks below 200 chars', () => {
    const md = longDoc(60);
    const c = ghostContext(md, md.length, 100);
    expect(c.before.endsWith(md.slice(-200))).toBe(true);
    expect(c.before.endsWith(md.slice(-300))).toBe(false);
  });

  it('frontmatter is never part of before', () => {
    const fm = '---\ntitle: Secret title\ntags: [a, b]\n---\n';
    const short = `${fm}\nBody text here.`;
    const c = ghostContext(short, short.length, 8192);
    expect(c.before).not.toContain('Secret title');
    expect(c.before).toContain('Body text here.');
    // Also when the body is long enough to need the headings note.
    const long = fm + longDoc(60);
    const d = ghostContext(long, long.length, 1_000_000);
    expect(d.before).not.toContain('Secret title');
    expect(d.before).not.toContain('tags:');
    expect(d.before.endsWith(long.slice(-GHOST_BEFORE_CHARS))).toBe(true);
  });

  it('a caret inside the frontmatter yields nothing', () => {
    const md = '---\ntitle: A title\ntags: [a]\n---\n\nBody text here.';
    expect(ghostContext(md, 10, 8192)).toEqual({ before: '', after: '' });
  });

  it('a caret right after the frontmatter is a normal context', () => {
    const md = '---\ntitle: A\n---\n\nBody text here.';
    const c = ghostContext(md, md.length, 8192);
    expect(c.before.trim()).toBe('Body text here.');
  });

  it('survives a bad caret and a bad window', () => {
    const md = 'Some text';
    expect(ghostContext(md, Number.NaN, 8192).before).toBe('');
    expect(ghostContext(md, 999, 8192).before).toBe(md);
    expect(ghostContext(md, -5, 8192).before).toBe('');
    expect(ghostContext(md, md.length, 0).before).toBe(md);
  });
});
