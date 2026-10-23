import { describe, expect, it } from 'vitest';
import { createPathOps } from '../../src/host/pathOps';
import {
  isHiddenEntry,
  isInside,
  isMikedownTemp,
  naturalCompare,
  rebasePath,
  sortEntries,
  typeAheadIndex,
  uniqueName,
  validateName,
  validateTarget,
  versionsPathFor,
  visibleEntries,
  withMarkdownExtension,
} from '../../src/tree/treeLogic';

const posix = createPathOps('posix');
const win = createPathOps('win32');

describe('natural sort', () => {
  it('orders numbers by value and ignores case', () => {
    const names = ['file10.md', 'File2.md', 'file1.md', 'b.md', 'A.md', 'Chapter 10', 'chapter 9'];
    expect([...names].sort(naturalCompare)).toEqual(['A.md', 'b.md', 'chapter 9', 'Chapter 10', 'file1.md', 'File2.md', 'file10.md']);
  });

  it('breaks value ties the same way as the Rust side (plain order)', () => {
    expect(['file02.md', 'File2.md'].sort(naturalCompare)).toEqual(['File2.md', 'file02.md']);
    expect(naturalCompare('same', 'same')).toBe(0);
    expect(naturalCompare('a', 'ab')).toBeLessThan(0);
  });

  it('puts folders first', () => {
    const sorted = sortEntries([
      { name: 'z.md', isDir: false },
      { name: 'notes', isDir: true },
      { name: 'a.md', isDir: false },
      { name: 'Archive', isDir: true },
    ]);
    expect(sorted.map((e) => e.name)).toEqual(['Archive', 'notes', 'a.md', 'z.md']);
  });
});

describe('hidden entries', () => {
  it('hides dotfolders, node_modules and OS clutter, not dotfiles', () => {
    expect(isHiddenEntry({ name: '.git', isDir: true })).toBe(true);
    expect(isHiddenEntry({ name: '.mikedown', isDir: true })).toBe(true);
    expect(isHiddenEntry({ name: 'node_modules', isDir: true })).toBe(true);
    expect(isHiddenEntry({ name: '.DS_Store', isDir: false })).toBe(true);
    expect(isHiddenEntry({ name: 'Thumbs.db', isDir: false })).toBe(true);
    expect(isHiddenEntry({ name: '.gitignore', isDir: false })).toBe(false);
    expect(isHiddenEntry({ name: 'node_modules', isDir: false })).toBe(false);
  });

  it('never shows MikeDown temp files, even with show hidden', () => {
    const entries = [
      { name: '.doc.md.mikedown-12-34.tmp', isDir: false },
      { name: 'doc.md', isDir: false },
      { name: '.git', isDir: true },
    ];
    expect(isMikedownTemp(entries[0].name)).toBe(true);
    expect(visibleEntries(entries, false).map((e) => e.name)).toEqual(['doc.md']);
    expect(visibleEntries(entries, true).map((e) => e.name)).toEqual(['.git', 'doc.md']);
  });
});

describe('name validation', () => {
  it('refuses empty names, dot names and slashes everywhere', () => {
    expect(validateName('', false)).toMatch(/empty/);
    expect(validateName('   ', false)).toMatch(/empty/);
    expect(validateName('..', false)).toMatch(/not a valid/);
    expect(validateName('a/b', false)).toMatch(/slash/);
    expect(validateName('notes.md', false)).toBeNull();
    expect(validateName('a\\b', false)).toBeNull();
  });

  it('applies Windows reserved names, characters and trailing dot/space', () => {
    for (const bad of ['CON', 'con.md', 'Nul.txt', 'COM1', 'lpt9.md', 'aux .md', 'a:b.md', 'q?.md', 'x*.md', 'p|.md', '<a>', 'a"b', 'trail.', 'trail ', 'a\\b', 'tab\there']) {
      expect(validateName(bad, true), bad).not.toBeNull();
    }
    expect(validateName('CON.md', true)).toMatch(/reserves for devices/);
    for (const ok of ['console.md', 'COM10.md', 'Connie.md', 'notes (1).md']) {
      expect(validateName(ok, true), ok).toBeNull();
    }
    // Fine off Windows.
    expect(validateName('CON.md', false)).toBeNull();
    expect(validateName('a:b.md', false)).toBeNull();
  });

  it('checks the 259-character path limit on Windows only', () => {
    const dir = `C:\\${'d'.repeat(240)}`;
    expect(validateTarget(`${dir}\\${'n'.repeat(10)}`, 'n'.repeat(10), true)).toBeNull();
    const long = `${dir}\\${'n'.repeat(30)}`;
    expect(validateTarget(long, 'n'.repeat(30), true)).toMatch(/at most 259/);
    expect(validateTarget(long, 'n'.repeat(30), false)).toBeNull();
    // A flat 270-character path is refused the same way.
    const flat = `C:\\${'p'.repeat(267)}`;
    expect(flat).toHaveLength(270);
    expect(validateTarget(flat, 'p'.repeat(267), true)).toMatch(/at most 259/);
  });
});

describe('New File naming (edge case 29)', () => {
  it('appends .md when the typed name has no extension', () => {
    expect(withMarkdownExtension('Meeting notes')).toBe('Meeting notes.md');
    expect(withMarkdownExtension('  Plan ')).toBe('Plan.md');
    expect(withMarkdownExtension('todo.txt')).toBe('todo.txt');
    expect(withMarkdownExtension('.env')).toBe('.env.md');
    expect(withMarkdownExtension('v1.2 draft')).toBe('v1.2 draft');
  });

  it('picks the first free name, case-insensitively', () => {
    expect(uniqueName('Untitled.md', ['a.md'])).toBe('Untitled.md');
    expect(uniqueName('Untitled.md', ['untitled.md', 'Untitled 2.md'])).toBe('Untitled 3.md');
    expect(uniqueName('New Folder', ['New Folder'])).toBe('New Folder 2');
    expect(uniqueName('pic.png', ['pic.png'], 'copy')).toBe('pic copy.png');
    expect(uniqueName('pic.png', ['pic.png', 'pic copy.png'], 'copy')).toBe('pic copy 2.png');
  });
});

describe('paths', () => {
  it('isInside handles posix and case-insensitive Windows paths', () => {
    expect(isInside('/a/b', '/a/b/c.md', posix)).toBe(true);
    expect(isInside('/a/b', '/a/b', posix)).toBe(true);
    expect(isInside('/a/b', '/a/bc/d.md', posix)).toBe(false);
    expect(isInside('/a/b', '/a', posix)).toBe(false);
    expect(isInside('C:\\Notes', 'c:\\notes\\x.md', win)).toBe(true);
    expect(isInside('C:\\Notes', 'D:\\Notes\\x.md', win)).toBe(false);
    expect(isInside('/a', '/a/..hidden', posix)).toBe(true);
  });

  it('maps a file or folder to its .mikedown/versions mirror (edge case 3)', () => {
    expect(versionsPathFor('/n', '/n/sub/a.md', posix)).toBe('/n/.mikedown/versions/sub/a.md');
    expect(versionsPathFor('/n', '/n/sub', posix)).toBe('/n/.mikedown/versions/sub');
    expect(versionsPathFor('/n', '/elsewhere/a.md', posix)).toBeNull();
    expect(versionsPathFor('/n', '/n', posix)).toBeNull();
    expect(versionsPathFor('/n', '/n/.mikedown/versions/a.md', posix)).toBeNull();
    expect(versionsPathFor('C:\\n', 'C:\\n\\a.md', win)).toBe('C:\\n\\.mikedown\\versions\\a.md');
  });

  it('rebases an open file through a rename of itself or a parent folder', () => {
    expect(rebasePath('/n/a.md', '/n/a.md', '/n/b.md', posix)).toBe('/n/b.md');
    expect(rebasePath('/n/sub/a.md', '/n/sub', '/n/Sub2', posix)).toBe('/n/Sub2/a.md');
    expect(rebasePath('/n/other.md', '/n/sub', '/n/Sub2', posix)).toBeNull();
  });
});

describe('type-ahead', () => {
  const names = ['Alpha.md', 'archive', 'Beta.md', 'bravo.md', 'Charlie.md'];
  it('jumps to the next name with the typed prefix, wrapping', () => {
    expect(typeAheadIndex(names, 'b', 0)).toBe(2);
    expect(typeAheadIndex(names, 'b', 2)).toBe(3);
    expect(typeAheadIndex(names, 'b', 3)).toBe(2);
    expect(typeAheadIndex(names, 'br', 2)).toBe(3);
    expect(typeAheadIndex(names, 'ch', 0)).toBe(4);
    expect(typeAheadIndex(names, 'z', 0)).toBe(-1);
    expect(typeAheadIndex([], 'a', 0)).toBe(-1);
  });

  it('a repeated letter cycles through that letter', () => {
    expect(typeAheadIndex(names, 'aa', 0)).toBe(1);
    expect(typeAheadIndex(names, 'aa', 1)).toBe(0);
  });
});
