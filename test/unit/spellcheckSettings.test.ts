import { describe, it, expect } from 'vitest';
import { splitWordLists } from '../../src/settings';

describe('splitWordLists', () => {
  it('cleans MikeDown\'s own list: trims, dedupes case-insensitively, drops empties', () => {
    const { userWords } = splitWordLists([' Foo ', 'foo', 'bar', '', '  ', 'BAR'], []);
    expect(userWords).toEqual(['Foo', 'bar']);
  });

  it('ignores non-string and non-array input rather than throwing', () => {
    expect(splitWordLists(undefined, undefined)).toEqual({ userWords: [], externalWords: [] });
    expect(splitWordLists('not-an-array', 123)).toEqual({ userWords: [], externalWords: [] });
    expect(splitWordLists(['ok', 42, null, 'word'], [])).toEqual({
      userWords: ['ok', 'word'],
      externalWords: [],
    });
  });

  it('keeps cSpell words in a separate externalWords bucket', () => {
    const { userWords, externalWords } = splitWordLists(['mine'], ['cspellword']);
    expect(userWords).toEqual(['mine']);
    expect(externalWords).toEqual(['cspellword']);
  });

  it('drops cSpell words that duplicate an already-owned word (case-insensitive)', () => {
    const { userWords, externalWords } = splitWordLists(['MikeDown'], ['mikedown', 'other']);
    expect(userWords).toEqual(['MikeDown']);
    expect(externalWords).toEqual(['other']);
  });

  it('never lets a saved userWords list pick up cSpell words — the two lists stay disjoint', () => {
    const { userWords, externalWords } = splitWordLists(['a', 'b'], ['b', 'c', 'd']);
    const userSet = new Set(userWords.map(w => w.toLowerCase()));
    for (const word of externalWords) {
      expect(userSet.has(word.toLowerCase())).toBe(false);
    }
  });
});
