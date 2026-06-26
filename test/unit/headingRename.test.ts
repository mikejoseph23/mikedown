import { describe, it, expect } from 'vitest';
import { detectHeadingRename, isRenameAmbiguous } from '../../src/webview/headingRename';

describe('detectHeadingRename', () => {
  it('emits a rename when the slug changes', () => {
    expect(detectHeadingRename('Setup', 'Installation')).toEqual({
      oldSlug: 'setup',
      newSlug: 'installation',
    });
  });

  it('returns null when the slug is unchanged', () => {
    expect(detectHeadingRename('Setup', 'Setup')).toBeNull();
  });

  it('returns null for punctuation-only edits that collapse to the same slug', () => {
    // "Setup" and "Setup." both slugify to "setup".
    expect(detectHeadingRename('Setup', 'Setup.')).toBeNull();
  });

  it('still emits when whitespace changes the slug (GitHub keeps each space)', () => {
    expect(detectHeadingRename('Set up', 'Setup')).toEqual({
      oldSlug: 'set-up',
      newSlug: 'setup',
    });
  });

  it('returns null when the baseline has no slug (brand-new heading)', () => {
    expect(detectHeadingRename('', 'New Heading')).toBeNull();
    expect(detectHeadingRename('   ', 'New Heading')).toBeNull();
  });

  it('returns null when the current text is emptied (deletion, not a rename)', () => {
    expect(detectHeadingRename('Old Heading', '')).toBeNull();
    expect(detectHeadingRename('Old Heading', '   ')).toBeNull();
  });

  it('chains across successive renames (re-baselining)', () => {
    // event 1: Setup -> Configuration
    const first = detectHeadingRename('Setup', 'Configuration');
    expect(first).toEqual({ oldSlug: 'setup', newSlug: 'configuration' });
    // event 2: baseline is now the settled text, rename again
    const second = detectHeadingRename('Configuration', 'Config Guide');
    expect(second).toEqual({ oldSlug: 'configuration', newSlug: 'config-guide' });
  });

  it('typing character-by-character collapses to a single boundary comparison', () => {
    // Intermediate keystrokes never reach the detector — only baseline vs
    // settled text is compared. Simulate the final comparison only.
    const baseline = 'Intro';
    const settled = 'Introduction';
    expect(detectHeadingRename(baseline, settled)).toEqual({
      oldSlug: 'intro',
      newSlug: 'introduction',
    });
  });
});

describe('isRenameAmbiguous (duplicate-slug guard)', () => {
  it('is not ambiguous for a unique heading rename', () => {
    // Doc after renaming the only "Setup" to "Installation".
    const headings = ['Installation', 'Usage', 'License'];
    expect(isRenameAmbiguous(headings, 'setup', 'installation')).toBe(false);
  });

  it('is ambiguous when another heading still carries the old base slug', () => {
    // Two "Setup" headings existed; one renamed to "Installation", one remains.
    const headings = ['Installation', 'Setup', 'Usage'];
    expect(isRenameAmbiguous(headings, 'setup', 'installation')).toBe(true);
  });

  it('is ambiguous when the new name collides with an existing heading', () => {
    // Renamed a heading to "Usage" but another "Usage" already exists.
    const headings = ['Usage', 'Usage', 'License'];
    expect(isRenameAmbiguous(headings, 'setup', 'usage')).toBe(true);
  });

  it('is not ambiguous when the renamed heading is the sole new-slug holder', () => {
    const headings = ['Configuration', 'Usage'];
    expect(isRenameAmbiguous(headings, 'setup', 'configuration')).toBe(false);
  });
});
