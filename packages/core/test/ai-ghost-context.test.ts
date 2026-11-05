/**
 * The text a ghost request sends: before the caret cut by the context budget
 * with the last 2400 chars verbatim, a capped suffix, nothing in frontmatter.
 */
import { describe, expect, it } from 'vitest';
import { GHOST_AFTER_CHARS, GHOST_BEFORE_CHARS, ghostContext } from '../src/ai';

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

  it('a long document is cut by the budget, with an outline of what was left out', () => {
    const md = longDoc(60);
    const c = ghostContext(md, md.length, 4096);
    expect(c.before.length).toBeLessThan(md.length);
    expect(c.before).toContain('Part of the document is left out');
    // Headings of the omitted middle are listed so the model knows where it is.
    expect(c.before).toMatch(/- Section \d+/);
    // The first section survives, the budget being spent from the top.
    expect(c.before.startsWith('## Section 1')).toBe(true);
  });

  it('keeps the last 2400 chars before the caret verbatim', () => {
    const md = longDoc(60);
    const c = ghostContext(md, md.length, 4096);
    expect(GHOST_BEFORE_CHARS).toBe(2400);
    expect(c.before.endsWith(md.slice(-GHOST_BEFORE_CHARS))).toBe(true);
  });

  it('keeps the verbatim tail when the caret is mid-document', () => {
    const md = longDoc(60);
    const caret = Math.floor(md.length * 0.8);
    const c = ghostContext(md, caret, 4096);
    expect(c.before.endsWith(md.slice(caret - GHOST_BEFORE_CHARS, caret))).toBe(true);
    expect(c.after).toBe(md.slice(caret, caret + GHOST_AFTER_CHARS));
  });

  it('a document that fits the window is not cut', () => {
    const md = longDoc(10);
    const c = ghostContext(md, md.length, 200_000);
    expect(c.before).toBe(md);
  });

  it('a caret inside the frontmatter yields nothing', () => {
    const md = '---\ntitle: A title\ntags: [a]\n---\n\nBody text here.';
    expect(ghostContext(md, 10, 8192)).toEqual({ before: '', after: '' });
  });

  it('a caret right after the frontmatter is a normal context', () => {
    const md = '---\ntitle: A\n---\n\nBody text here.';
    const c = ghostContext(md, md.length, 8192);
    expect(c.before).toBe(md);
  });

  it('survives a bad caret and a bad window', () => {
    const md = 'Some text';
    expect(ghostContext(md, Number.NaN, 8192).before).toBe('');
    expect(ghostContext(md, 999, 8192).before).toBe(md);
    expect(ghostContext(md, -5, 8192).before).toBe('');
    expect(ghostContext(md, md.length, 0).before).toBe(md);
  });
});
