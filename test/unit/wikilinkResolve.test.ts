import { describe, it, expect } from 'vitest';
import { rankWikilinkCandidates, pickBestWikilinkTarget } from '../../src/wikilinkResolve';

describe('pickBestWikilinkTarget', () => {
  it('prefers a candidate in the same folder as fromDir', () => {
    const fromDir = '/vault/repoA/notes';
    const candidates = ['/vault/repoB/Note.md', '/vault/repoA/notes/Note.md', '/vault/repoA/Note.md'];
    expect(pickBestWikilinkTarget(candidates, fromDir)).toBe('/vault/repoA/notes/Note.md');
  });

  it('picks the nearest-in-tree candidate when none share the folder', () => {
    const fromDir = '/vault/repoA/notes';
    const candidates = ['/vault/repoA/deep/x/y/Note.md', '/vault/repoA/Note.md'];
    expect(pickBestWikilinkTarget(candidates, fromDir)).toBe('/vault/repoA/Note.md');
  });

  it('returns the sole candidate for a single-element list', () => {
    const fromDir = '/vault/repoA/notes';
    expect(pickBestWikilinkTarget(['/vault/repoZ/Only.md'], fromDir)).toBe('/vault/repoZ/Only.md');
  });

  it('returns null for an empty list', () => {
    expect(pickBestWikilinkTarget([], '/vault/repoA/notes')).toBe(null);
  });

  it('is stable regardless of input order (deterministic tiebreak)', () => {
    const fromDir = '/vault/repoA/notes';
    // Two equidistant candidates (both one hop up from fromDir's parent chain).
    const a = '/vault/repoA/sub1/Note.md';
    const b = '/vault/repoA/sub2/Note.md';
    const order1 = pickBestWikilinkTarget([a, b], fromDir);
    const order2 = pickBestWikilinkTarget([b, a], fromDir);
    expect(order1).toBe(order2);
  });
});

describe('rankWikilinkCandidates', () => {
  it('produces the same ranking across repeated calls', () => {
    const fromDir = '/vault/repoA/notes';
    const candidates = [
      '/vault/repoB/Note.md',
      '/vault/repoA/notes/Note.md',
      '/vault/repoA/Note.md',
      '/vault/repoA/deep/x/y/Note.md',
    ];
    const first = rankWikilinkCandidates(candidates, fromDir);
    const second = rankWikilinkCandidates(candidates, fromDir);
    expect(second).toEqual(first);
  });

  it('produces the same ranking regardless of input order', () => {
    const fromDir = '/vault/repoA/notes';
    const candidates = [
      '/vault/repoB/Note.md',
      '/vault/repoA/notes/Note.md',
      '/vault/repoA/Note.md',
      '/vault/repoA/deep/x/y/Note.md',
    ];
    const shuffled = [candidates[2], candidates[0], candidates[3], candidates[1]];
    expect(rankWikilinkCandidates(shuffled, fromDir)).toEqual(
      rankWikilinkCandidates(candidates, fromDir)
    );
  });

  it('returns a new array and does not mutate the input', () => {
    const fromDir = '/vault/repoA/notes';
    const candidates = ['/vault/repoB/Note.md', '/vault/repoA/notes/Note.md', '/vault/repoA/Note.md'];
    const snapshot = [...candidates];
    const ranked = rankWikilinkCandidates(candidates, fromDir);
    expect(ranked).not.toBe(candidates);
    expect(candidates).toEqual(snapshot);
  });

  it('does not throw on a frozen input array', () => {
    const fromDir = '/vault/repoA/notes';
    const frozen = Object.freeze(['/vault/repoB/Note.md', '/vault/repoA/notes/Note.md']);
    expect(() => rankWikilinkCandidates(frozen as string[], fromDir)).not.toThrow();
    expect(rankWikilinkCandidates(frozen as string[], fromDir)[0]).toBe('/vault/repoA/notes/Note.md');
  });
});
