import { describe, it, expect } from 'vitest';
import { headingNumberingCss, parseHeadingNumbering } from '../../src/headingNumbering';

describe('parseHeadingNumbering', () => {
  it('accepts the two numbering modes', () => {
    expect(parseHeadingNumbering('fromH1')).toBe('fromH1');
    expect(parseHeadingNumbering('fromH2')).toBe('fromH2');
  });

  it('falls back to off for anything else', () => {
    expect(parseHeadingNumbering('off')).toBe('off');
    expect(parseHeadingNumbering('h3')).toBe('off');
    expect(parseHeadingNumbering(undefined)).toBe('off');
    expect(parseHeadingNumbering(true)).toBe('off');
  });
});

describe('headingNumberingCss', () => {
  it('emits nothing when off', () => {
    expect(headingNumberingCss('off', 'body')).toBe('');
  });

  it('numbers every level from H1', () => {
    const css = headingNumberingCss('fromH1', 'body');
    expect(css).toContain('body > h1::before { content: counter(mikedown-h1);');
    expect(css).toContain(
      'body > h3::before { content: counter(mikedown-h1) "." counter(mikedown-h2) "." counter(mikedown-h3);'
    );
    expect(css).toContain('body > h6 { counter-increment: mikedown-h6; }');
  });

  it('resets every deeper counter so a skipped level starts clean', () => {
    const css = headingNumberingCss('fromH1', 'body');
    expect(css).toContain(
      'body > h1 { counter-increment: mikedown-h1; counter-reset: mikedown-h2 mikedown-h3 mikedown-h4 mikedown-h5 mikedown-h6; }'
    );
  });

  it('leaves H1 unnumbered and starts at H2 in fromH2 mode', () => {
    const css = headingNumberingCss('fromH2', '.ProseMirror');
    expect(css).not.toContain('> h1');
    expect(css).not.toContain('mikedown-h1');
    expect(css).toContain('.ProseMirror > h2::before { content: counter(mikedown-h2);');
    expect(css).toContain(
      '.ProseMirror > h3::before { content: counter(mikedown-h2) "." counter(mikedown-h3);'
    );
  });

  it('creates only the top counter on the scope itself', () => {
    // A scope-level instance of a deeper counter breaks sibling resets in Chromium.
    expect(headingNumberingCss('fromH1', 'body').split('\n')[0]).toBe('body { counter-reset: mikedown-h1; }');
    expect(headingNumberingCss('fromH2', 'body').split('\n')[0]).toBe('body { counter-reset: mikedown-h2; }');
  });

  it('only numbers direct children of the scope', () => {
    const css = headingNumberingCss('fromH1', '.ProseMirror');
    for (const line of css.split('\n').slice(1)) {
      expect(line.startsWith('.ProseMirror > h')).toBe(true);
    }
  });
});
