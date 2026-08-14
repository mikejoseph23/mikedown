import { describe, it, expect } from 'vitest';
import { splitWordLists } from '../../src/settings';
import { buildDictionaryView, removeWordFromList, addWordToList } from '../../src/webview/spellcheck';

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

describe('buildDictionaryView', () => {
  const words = (v: ReturnType<typeof buildDictionaryView>) => v.entries.map(e => e.word);

  it('sorts case-insensitively without touching the backing arrays', () => {
    const user = ['zebra', 'Apple', 'mango'];
    const view = buildDictionaryView(user, [], '');
    expect(words(view)).toEqual(['Apple', 'mango', 'zebra']);
    expect(user).toEqual(['zebra', 'Apple', 'mango']); // saved order unchanged
  });

  it('merges both sources into one sorted list but keeps them labelled', () => {
    const view = buildDictionaryView(['beta'], ['alpha', 'gamma'], '');
    expect(view.entries).toEqual([
      { word: 'alpha', source: 'external' },
      { word: 'beta', source: 'user' },
      { word: 'gamma', source: 'external' },
    ]);
  });

  it('filters case-insensitively by substring and reports the unfiltered total', () => {
    const view = buildDictionaryView(['MikeDown', 'markdown', 'other'], ['downstream'], 'DOWN');
    expect(words(view)).toEqual(['downstream', 'markdown', 'MikeDown']);
    expect(view.total).toBe(4);
    expect(view.filter).toBe('DOWN');
  });

  it('treats a blank/whitespace filter as no filter', () => {
    const view = buildDictionaryView(['a', 'b'], [], '   ');
    expect(words(view)).toEqual(['a', 'b']);
    expect(view.filter).toBe('');
  });

  it('reports an empty match set distinctly from an empty dictionary', () => {
    const noMatch = buildDictionaryView(['alpha'], [], 'zzz');
    expect(noMatch.entries).toEqual([]);
    expect(noMatch.total).toBe(1);

    const empty = buildDictionaryView([], [], '');
    expect(empty.entries).toEqual([]);
    expect(empty.total).toBe(0);
  });
});

describe('removeWordFromList', () => {
  it('removes by value, not by rendered position', () => {
    // The rendered view is sorted, so index 0 there is 'Apple' while index 0
    // in the backing array is 'zebra'. Removing the first rendered chip must
    // drop 'Apple'.
    const user = ['zebra', 'Apple', 'mango'];
    const first = buildDictionaryView(user, [], '').entries[0].word;
    expect(removeWordFromList(user, first)).toEqual(['zebra', 'mango']);
  });

  it('removes the right word out of a filtered view', () => {
    const user = ['markdown', 'MikeDown', 'other'];
    const filtered = buildDictionaryView(user, [], 'mike').entries[0].word;
    expect(removeWordFromList(user, filtered)).toEqual(['markdown', 'other']);
  });

  it('matches case-insensitively and leaves the list alone when nothing matches', () => {
    expect(removeWordFromList(['MikeDown'], 'mikedown')).toEqual([]);
    expect(removeWordFromList(['a', 'b'], 'c')).toEqual(['a', 'b']);
  });
});

describe('addWordToList', () => {
  it('appends in insertion order rather than sorted order', () => {
    expect(addWordToList(['zebra'], 'apple')).toEqual(['zebra', 'apple']);
  });

  it('trims, and returns the same array reference for blanks and duplicates', () => {
    const list = ['MikeDown'];
    expect(addWordToList(list, '  new  ')).toEqual(['MikeDown', 'new']);
    expect(addWordToList(list, '   ')).toBe(list);
    expect(addWordToList(list, 'mikedown')).toBe(list);
  });
});
