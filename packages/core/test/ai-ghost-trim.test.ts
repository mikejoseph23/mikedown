/**
 * Cleaning up a streaming ghost suggestion (ai/ghostTrim.ts, decisions D5, D6).
 */
import { describe, expect, it } from 'vitest';
import { ghostAcceptWord, ghostPrefixMatch, trimGhostSuggestion, trimGhostSuggestionDetailed } from '../src/ai';

const END = { atBlockEnd: true, before: 'It was a quiet evening in the' };

describe('trimGhostSuggestionDetailed', () => {
  it('passes a plain continuation through unstopped', () => {
    expect(trimGhostSuggestionDetailed(' village, and nothing', END)).toEqual({ text: ' village, and nothing', stopped: false });
  });

  it('stops at a blank line', () => {
    const r = trimGhostSuggestionDetailed(' village.\n\nA new paragraph', END);
    expect(r).toEqual({ text: ' village.', stopped: true });
  });

  it('a blank line made of spaces also stops it', () => {
    expect(trimGhostSuggestionDetailed(' village.\n  \nNext', END).text).toBe(' village.');
  });

  it('a single newline is allowed at the end of a block', () => {
    const r = trimGhostSuggestionDetailed(' village.\nStill going', END);
    expect(r.text).toBe(' village.\nStill going');
    expect(r.stopped).toBe(false);
  });

  it('stops at the first newline when the caret is mid-block', () => {
    const r = trimGhostSuggestionDetailed(' village.\nStill going', { atBlockEnd: false, before: END.before });
    expect(r).toEqual({ text: ' village.', stopped: true });
  });

  it('cuts after the first sentence that ends past 120 chars', () => {
    const first = ' ' + 'word '.repeat(26).trim() + '.'; // ends past 120
    const raw = `${first} Another sentence follows here.`;
    expect(first.length).toBeGreaterThan(120);
    const r = trimGhostSuggestionDetailed(raw, END);
    expect(r.text).toBe(first);
    expect(r.stopped).toBe(true);
  });

  it('keeps going past an early sentence end while under 120 chars', () => {
    const raw = ' Short one. ' + 'more words here '.repeat(8);
    const r = trimGhostSuggestionDetailed(raw, END);
    expect(r.text.startsWith(' Short one. more')).toBe(true);
  });

  it('a number streaming in is not a sentence end', () => {
    const raw = ' ' + 'a'.repeat(125) + ' 3.14';
    const r = trimGhostSuggestionDetailed(raw, END);
    expect(r.stopped).toBe(false);
    expect(r.text.endsWith('3.14')).toBe(true);
  });

  it('drops trailing whitespace', () => {
    expect(trimGhostSuggestion(' village   \t', END)).toBe(' village');
  });

  it('drops a leading space when the text before already ends in whitespace', () => {
    expect(trimGhostSuggestion(' village', { atBlockEnd: true, before: 'in the ' })).toBe('village');
    expect(trimGhostSuggestion(' village', { atBlockEnd: true, before: 'in the' })).toBe(' village');
  });

  it('strips a stray code fence', () => {
    expect(trimGhostSuggestion('```\nvillage life\n```', END)).toBe('village life');
  });

  it('discards a suggestion that repeats the last 20 chars before the caret', () => {
    const before = 'The quick brown fox jumps over';
    const r = trimGhostSuggestionDetailed(before.slice(-20) + ' the lazy dog', { atBlockEnd: true, before });
    expect(r).toEqual({ text: '', stopped: true });
  });

  it('discards a repeat that starts after leading spaces', () => {
    const before = 'The quick brown fox jumps over';
    expect(trimGhostSuggestion('  brown fox jumps over the lazy dog', { atBlockEnd: true, before })).toBe('');
    // Only the end of the tail repeated: not the whole stretch, so it stays.
    expect(trimGhostSuggestion(' jumps over the lazy dog', { atBlockEnd: true, before })).toBe(' jumps over the lazy dog');
  });

  it('a short coincidental overlap is not a repeat', () => {
    expect(trimGhostSuggestion(' to the', { atBlockEnd: true, before: 'going to' })).toBe(' to the');
  });

  it('an empty or whitespace-only answer shows nothing', () => {
    expect(trimGhostSuggestion('', END)).toBe('');
    expect(trimGhostSuggestion('  \n ', END)).toBe('');
  });

  it('is stable for partial strings as tokens stream in', () => {
    const full = ' village, and the lamps were lit.\n\nNext';
    let last = '';
    for (let i = 1; i <= full.length; i++) {
      const t = trimGhostSuggestion(full.slice(0, i), END);
      expect(t.startsWith(last.trimEnd())).toBe(true);
      last = t;
    }
    expect(last).toBe(' village, and the lamps were lit.');
  });
});

describe('ghostAcceptWord', () => {
  it('takes the leading space, the word and the one space after it', () => {
    expect(ghostAcceptWord(' hello world')).toBe(' hello ');
    expect(ghostAcceptWord('hello world')).toBe('hello ');
  });

  it('takes the whole text when there is no second word', () => {
    expect(ghostAcceptWord('hello')).toBe('hello');
    expect(ghostAcceptWord(' hello')).toBe(' hello');
  });

  it('leaves punctuation attached to its word', () => {
    expect(ghostAcceptWord('done, then more')).toBe('done, ');
  });
});

describe('ghostPrefixMatch', () => {
  it('returns the rest when the typed text is the start of the suggestion', () => {
    expect(ghostPrefixMatch(' village', ' ')).toBe('village');
    expect(ghostPrefixMatch('village', 'v')).toBe('illage');
  });

  it('returns an empty rest when the whole suggestion was typed', () => {
    expect(ghostPrefixMatch('ab', 'ab')).toBe('');
  });

  it('returns null on a mismatch, case-sensitively', () => {
    expect(ghostPrefixMatch('village', 'x')).toBeNull();
    expect(ghostPrefixMatch('village', 'V')).toBeNull();
  });

  it('typing nothing changes nothing', () => {
    expect(ghostPrefixMatch('village', '')).toBe('village');
  });
});
