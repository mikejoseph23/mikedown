import { describe, expect, it } from 'vitest';
import nodePath from 'node:path';
import { createPathOps, detectPathPlatform, toPosixSlashes } from '../../src/host/pathOps';

describe('createPathOps(posix)', () => {
  const p = createPathOps('posix');

  it('matches node:path on the operations the image helpers use', () => {
    const doc = '/Users/mike/notes/todo.md';
    expect(p.dirname(doc)).toBe(nodePath.posix.dirname(doc));
    expect(p.basename(doc)).toBe(nodePath.posix.basename(doc));
    expect(p.basename(doc, '.md')).toBe(nodePath.posix.basename(doc, '.md'));
    expect(p.extname(doc)).toBe('.md');
    expect(p.extname('/x/archive.tar.gz')).toBe('.gz');
    expect(p.extname('/x/.gitignore')).toBe('');
    expect(p.extname('/x/README')).toBe('');
    expect(p.join('/Users/mike/notes', 'images', 'a.png')).toBe('/Users/mike/notes/images/a.png');
    expect(p.join('/a/b/', '../c')).toBe(nodePath.posix.join('/a/b/', '../c'));
    expect(p.resolve('/Users/mike/notes', 'images')).toBe('/Users/mike/notes/images');
    expect(p.resolve('/Users/mike/notes', '../shared/img.png')).toBe('/Users/mike/shared/img.png');
    expect(p.resolve('/a', '/b/c')).toBe('/b/c');
    expect(p.relative('/Users/mike/notes', '/Users/mike/notes/images/a.png')).toBe('images/a.png');
    expect(p.relative('/Users/mike/notes', '/Users/mike/shared/a.png')).toBe('../shared/a.png');
    expect(p.relative('/a/b', '/a/b')).toBe('');
    expect(p.isAbsolute('/x')).toBe(true);
    expect(p.isAbsolute('x/y')).toBe(false);
    expect(p.normalize('/a//b/./c/../d')).toBe('/a/b/d');
    expect(p.normalize('a/../../b')).toBe('../b');
    expect(p.sep).toBe('/');
  });

  it('treats a root file sensibly', () => {
    expect(p.dirname('/file.md')).toBe('/');
    expect(p.dirname('file.md')).toBe('.');
    expect(p.dirname('/')).toBe('/');
  });
});

describe('createPathOps(win32)', () => {
  const p = createPathOps('win32');

  it('handles drive letters and both separators', () => {
    const doc = 'C:\\Users\\mike\\notes\\todo.md';
    expect(p.dirname(doc)).toBe('C:\\Users\\mike\\notes');
    expect(p.basename(doc, '.md')).toBe('todo');
    expect(p.extname(doc)).toBe('.md');
    expect(p.join('C:\\Users\\mike\\notes', 'images', 'a.png')).toBe('C:\\Users\\mike\\notes\\images\\a.png');
    expect(p.resolve('C:\\Users\\mike\\notes', 'images/a.png')).toBe('C:\\Users\\mike\\notes\\images\\a.png');
    expect(p.resolve('C:\\Users\\mike\\notes', '..\\shared\\a.png')).toBe('C:\\Users\\mike\\shared\\a.png');
    expect(p.relative('C:\\Users\\mike\\notes', 'C:\\Users\\mike\\notes\\images\\a.png')).toBe('images\\a.png');
    expect(p.relative('c:\\users\\MIKE\\notes', 'C:\\Users\\mike\\shared\\a.png')).toBe('..\\shared\\a.png');
    expect(p.isAbsolute('C:\\x')).toBe(true);
    expect(p.isAbsolute('C:/x')).toBe(true);
    expect(p.isAbsolute('\\\\server\\share\\x')).toBe(true);
    expect(p.isAbsolute('x\\y')).toBe(false);
    expect(p.normalize('C:/a//b/./c/../d')).toBe('C:\\a\\b\\d');
    expect(p.sep).toBe('\\');
  });

  it('gives an absolute path when drives differ', () => {
    expect(p.relative('C:\\a', 'D:\\b\\c.png')).toBe('D:\\b\\c.png');
  });

  it('keeps UNC roots', () => {
    expect(p.dirname('\\\\nas\\docs\\notes\\a.md')).toBe('\\\\nas\\docs\\notes');
    expect(p.relative('\\\\nas\\docs\\notes', '\\\\nas\\docs\\notes\\img\\a.png')).toBe('img\\a.png');
  });
});

describe('platform helpers', () => {
  it('detects windows from the user agent', () => {
    expect(detectPathPlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe('win32');
    expect(detectPathPlatform({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe('posix');
  });

  it('converts separators for markdown links', () => {
    expect(toPosixSlashes('images\\a.png')).toBe('images/a.png');
  });
});
