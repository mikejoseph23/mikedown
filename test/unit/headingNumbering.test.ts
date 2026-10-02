import { describe, it, expect } from 'vitest';
import {
  applyPrefixEdit,
  isNumbered,
  numberPrefix,
  parseHeadingNumbering,
  renumberEdits,
  sectionNumbers,
  stripEdits,
  type HeadingInfo,
} from '../../src/headingNumbering';

const h = (level: number, text: string): HeadingInfo => ({ level, text });

/** Apply the edits and return the resulting heading texts. */
function run(headings: HeadingInfo[], edits: ReturnType<typeof renumberEdits>): string[] {
  const texts = headings.map((x) => x.text);
  for (const e of edits) {texts[e.index] = applyPrefixEdit(texts[e.index], e);}
  return texts;
}

describe('parseHeadingNumbering', () => {
  it('accepts the known modes and falls back to off', () => {
    expect(parseHeadingNumbering('fromH1')).toBe('fromH1');
    expect(parseHeadingNumbering('fromH2')).toBe('fromH2');
    expect(parseHeadingNumbering('h3')).toBe('off');
    expect(parseHeadingNumbering(undefined)).toBe('off');
  });
});

describe('numberPrefix', () => {
  it('matches section numbers with an optional trailing dot', () => {
    expect(numberPrefix('1 Intro')).toBe('1 ');
    expect(numberPrefix('1.2.3 Setup')).toBe('1.2.3 ');
    expect(numberPrefix('3. Usage')).toBe('3. ');
  });
  it('ignores text that only starts with digits', () => {
    expect(numberPrefix('1st place')).toBe('');
    expect(numberPrefix('1.5x speed')).toBe('');
    expect(numberPrefix('Intro')).toBe('');
  });
});

describe('sectionNumbers', () => {
  it('numbers nested levels and resets deeper counters', () => {
    const doc = [h(1, 'A'), h(2, 'B'), h(2, 'C'), h(3, 'D'), h(1, 'E'), h(2, 'F')];
    expect(sectionNumbers(doc, 'fromH1')).toEqual(['1', '1.1', '1.2', '1.2.1', '2', '2.1']);
  });
  it('fromH2 leaves H1 unnumbered', () => {
    expect(sectionNumbers([h(1, 'Title'), h(2, 'A'), h(3, 'B'), h(2, 'C')], 'fromH2')).toEqual([null, '1', '1.1', '2']);
  });
  it('counts a skipped level as 0', () => {
    expect(sectionNumbers([h(1, 'A'), h(3, 'B')], 'fromH1')).toEqual(['1', '1.0.1']);
  });
  it('starts at the shallowest level in use', () => {
    expect(sectionNumbers([h(2, 'A'), h(3, 'B'), h(2, 'C')], 'fromH1')).toEqual(['1', '1.1', '2']);
  });
  it('skips empty headings', () => {
    expect(sectionNumbers([h(2, 'A'), h(2, ' '), h(2, 'B')], 'fromH1')).toEqual(['1', null, '2']);
  });
});

describe('isNumbered', () => {
  it('is true for a numbered document, even with a stale number', () => {
    expect(isNumbered([h(2, '1 A'), h(2, '3 B'), h(2, 'C')], 'fromH1')).toBe(true);
  });
  it('stays true after a new heading is added at the top', () => {
    expect(isNumbered([h(2, 'New'), h(2, '1 A'), h(2, '2 B')], 'fromH1')).toBe(true);
  });
  it('is false for a plain document', () => {
    expect(isNumbered([h(2, 'A'), h(2, 'B')], 'fromH1')).toBe(false);
  });
  it('is false when the first heading merely starts with a year', () => {
    expect(isNumbered([h(2, '2024 Review'), h(2, 'Plans')], 'fromH1')).toBe(false);
  });
  it('is false when the setting is off', () => {
    expect(isNumbered([h(2, '1 A')], 'off')).toBe(false);
  });
});

describe('renumberEdits', () => {
  it('numbers a plain document', () => {
    const doc = [h(1, 'Title'), h(2, 'Intro'), h(3, 'Setup'), h(2, 'Usage')];
    expect(run(doc, renumberEdits(doc, 'fromH2', -1, true))).toEqual(['Title', '1 Intro', '1.1 Setup', '2 Usage']);
  });
  it('fixes stale numbers after a section moves', () => {
    const doc = [h(2, '2 Usage'), h(3, '2.1 Flags'), h(2, '1 Intro')];
    expect(run(doc, renumberEdits(doc, 'fromH1'))).toEqual(['1 Usage', '1.1 Flags', '2 Intro']);
  });
  it('leaves correct headings and the skipped heading alone', () => {
    const doc = [h(2, '1 A'), h(2, 'New'), h(2, '2 B')];
    const edits = renumberEdits(doc, 'fromH1', 1);
    expect(edits.map((e) => e.index)).toEqual([2]);
    expect(run(doc, edits)).toEqual(['1 A', 'New', '3 B']);
  });
  it('replaces a hand-typed dotted number when numbering fresh', () => {
    const doc = [h(2, '1. Intro'), h(2, 'Usage')];
    expect(run(doc, renumberEdits(doc, 'fromH1', -1, true))).toEqual(['1 Intro', '2 Usage']);
  });
  it('keeps a year in the title when numbering fresh', () => {
    const doc = [h(2, '2024 Review'), h(2, 'Plans')];
    expect(run(doc, renumberEdits(doc, 'fromH1', -1, true))).toEqual(['1 2024 Review', '2 Plans']);
  });
});

describe('stripEdits', () => {
  it('removes numbers from numbered levels only', () => {
    const doc = [h(1, '1 Title'), h(2, '1 Intro'), h(3, '1.1 Setup')];
    expect(run(doc, stripEdits(doc, 'fromH2'))).toEqual(['1 Title', 'Intro', 'Setup']);
  });
});
