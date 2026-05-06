import { describe, it, expect } from 'vitest';
import { unresolveSrcForDisplay, resolveSrcForEditor, type ImagePathPrefix } from '../../src/imageDisplayPath';

const docDirPrefix = 'https://abc.vscode-cdn.net/Users/me/proj/notes';
const workspacePrefix = 'https://abc.vscode-cdn.net/Users/me/proj';
const docDirFs = '/Users/me/proj/notes';

const prefixes: ImagePathPrefix[] = [
  { prefix: docDirPrefix, fsPath: '/Users/me/proj/notes' },
  { prefix: workspacePrefix, fsPath: '/Users/me/proj' },
];

describe('unresolveSrcForDisplay', () => {
  it('strips the docDir prefix to produce a doc-relative path', () => {
    const src = `${docDirPrefix}/images/foo.png`;
    expect(unresolveSrcForDisplay(src, prefixes, docDirFs)).toBe('images/foo.png');
  });

  it('returns ../-prefixed relative path for workspace folder match outside docDir', () => {
    const src = `${workspacePrefix}/assets/shared.png`;
    expect(unresolveSrcForDisplay(src, prefixes, docDirFs)).toBe('../assets/shared.png');
  });

  it('decodes percent-encoded segments', () => {
    const src = `${docDirPrefix}/images/my%20pic.png`;
    expect(unresolveSrcForDisplay(src, prefixes, docDirFs)).toBe('images/my pic.png');
  });

  it('leaves http(s) URLs unchanged', () => {
    expect(
      unresolveSrcForDisplay('https://example.com/foo.png', prefixes, docDirFs)
    ).toBe('https://example.com/foo.png');
  });

  it('leaves data: URIs unchanged', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo=';
    expect(unresolveSrcForDisplay(src, prefixes, docDirFs)).toBe(src);
  });

  it('returns the original src when no prefix matches', () => {
    expect(
      unresolveSrcForDisplay('vscode-resource:/some/other/path.png', prefixes, docDirFs)
    ).toBe('vscode-resource:/some/other/path.png');
  });

  it('returns the original src when prefix list is empty', () => {
    expect(
      unresolveSrcForDisplay(`${docDirPrefix}/images/foo.png`, [], docDirFs)
    ).toBe(`${docDirPrefix}/images/foo.png`);
  });

  it('prefers longer (more-specific) prefix when both match', () => {
    // docDir is nested inside the workspace folder; longest-first ordering
    // should pick docDir so the result is doc-relative, not workspace-relative.
    const src = `${docDirPrefix}/images/foo.png`;
    expect(unresolveSrcForDisplay(src, prefixes, docDirFs)).toBe('images/foo.png');
  });

  it('handles src that exactly equals a prefix (degenerate case) by returning unchanged', () => {
    expect(
      unresolveSrcForDisplay(docDirPrefix, prefixes, docDirFs)
    ).toBe(docDirPrefix);
  });
});

describe('resolveSrcForEditor', () => {
  it('resolves a doc-relative path back to the docDir webview prefix', () => {
    expect(resolveSrcForEditor('images/foo.png', prefixes, docDirFs))
      .toBe(`${docDirPrefix}/images/foo.png`);
  });

  it('resolves a ../-relative path against a workspace-folder prefix', () => {
    expect(resolveSrcForEditor('../assets/shared.png', prefixes, docDirFs))
      .toBe(`${workspacePrefix}/assets/shared.png`);
  });

  it('encodes spaces and other reserved characters per segment', () => {
    expect(resolveSrcForEditor('images/my pic.png', prefixes, docDirFs))
      .toBe(`${docDirPrefix}/images/my%20pic.png`);
  });

  it('resolves an absolute fs path that lives under a known prefix', () => {
    expect(resolveSrcForEditor('/Users/me/proj/notes/images/foo.png', prefixes, docDirFs))
      .toBe(`${docDirPrefix}/images/foo.png`);
  });

  it('passes data: URIs through unchanged', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo=';
    expect(resolveSrcForEditor(src, prefixes, docDirFs)).toBe(src);
  });

  it('passes http(s) URLs through unchanged', () => {
    expect(resolveSrcForEditor('https://example.com/foo.png', prefixes, docDirFs))
      .toBe('https://example.com/foo.png');
  });

  it('passes an already-resolved webview URI through unchanged', () => {
    const src = `${docDirPrefix}/images/foo.png`;
    expect(resolveSrcForEditor(src, prefixes, docDirFs)).toBe(src);
  });

  it('returns the original src when nothing matches (e.g. path outside any prefix)', () => {
    expect(resolveSrcForEditor('/elsewhere/foo.png', prefixes, docDirFs))
      .toBe('/elsewhere/foo.png');
  });

  it('round-trips with unresolveSrcForDisplay for a doc-relative path', () => {
    const original = `${docDirPrefix}/images/my%20pic.png`;
    const display = unresolveSrcForDisplay(original, prefixes, docDirFs);
    expect(display).toBe('images/my pic.png');
    expect(resolveSrcForEditor(display, prefixes, docDirFs)).toBe(original);
  });
});
