import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
  expandFilenamePattern,
  resolveFilename,
  resolveTargetFolder,
  formatInsertPath,
  resolveAltText,
  extensionFromMime,
  sanitizeForFilename,
  resizeSiblingPath,
  extractLocalImageRefs,
  resolveLocalImagePaths,
  isInsideManagedFolder,
  looksLikeAutoPastedImage,
} from '../../src/imagePaste';
import type { ImagePasteSettings } from '../../src/settings';

const FIXED_DATE = new Date('2026-05-06T14:30:22Z');

const baseConfig: ImagePasteSettings = {
  enabled: true,
  folder: 'images',
  folderRelativeTo: 'document',
  filenamePattern: '${docName}-${timestamp}',
  pathStyle: 'relative',
  altText: 'empty',
  maxSizeMB: 10,
  cleanupUnreferenced: true,
};

const sampleData = new Uint8Array([1, 2, 3, 4]);

describe('extensionFromMime', () => {
  it('maps known image MIME types', () => {
    expect(extensionFromMime('image/png')).toBe('png');
    expect(extensionFromMime('image/jpeg')).toBe('jpg');
    expect(extensionFromMime('image/svg+xml')).toBe('svg');
    expect(extensionFromMime('IMAGE/WEBP')).toBe('webp');
  });

  it('returns null for unknown MIME types', () => {
    expect(extensionFromMime('application/pdf')).toBeNull();
    expect(extensionFromMime('')).toBeNull();
  });
});

describe('sanitizeForFilename', () => {
  it('drops reserved chars and turns whitespace runs into dashes', () => {
    expect(sanitizeForFilename('My Note: v2*')).toBe('My-Note-v2');
    expect(sanitizeForFilename('  weird/path\\name?  ')).toBe('weirdpathname');
  });

  it('returns empty for input that is all separators', () => {
    expect(sanitizeForFilename('---')).toBe('');
    expect(sanitizeForFilename('...')).toBe('');
  });
});

describe('expandFilenamePattern', () => {
  it('expands all known tokens', () => {
    const out = expandFilenamePattern('${docName}_${date}_${time}_${timestamp}', {
      docName: 'note',
      extension: 'png',
      data: sampleData,
      timestamp: new Date(2026, 4, 6, 14, 30, 22), // local time, May 6
    });
    expect(out).toBe('note_20260506_143022_20260506-143022');
  });

  it('does not compute hash when not used', () => {
    // No throw, no work done — verifying it just outputs the pattern.
    expect(expandFilenamePattern('plain-${docName}', {
      docName: 'note', extension: 'png', data: sampleData, timestamp: FIXED_DATE,
    })).toBe('plain-note');
  });

  it('expands hash to first 8 hex chars of SHA-1', () => {
    // SHA-1 of [1,2,3,4] is "12dada1fff4d4787ade3333147202c3b443e376f"
    const out = expandFilenamePattern('${hash}', {
      docName: 'x', extension: 'png', data: sampleData, timestamp: FIXED_DATE,
    });
    expect(out).toBe('12dada1f');
  });

  it('passes unknown tokens through untouched', () => {
    expect(expandFilenamePattern('${docName}-${unknownToken}', {
      docName: 'a', extension: 'png', data: sampleData, timestamp: FIXED_DATE,
    })).toBe('a-${unknownToken}');
  });

  it('falls back to "image" for empty docName', () => {
    expect(expandFilenamePattern('${docName}', {
      docName: '', extension: 'png', data: sampleData, timestamp: FIXED_DATE,
    })).toBe('image');
  });

  it('uses ${index} when present', () => {
    expect(expandFilenamePattern('img-${index}', {
      docName: 'a', extension: 'png', data: sampleData, timestamp: FIXED_DATE, index: 7,
    })).toBe('img-7');
  });
});

describe('resolveTargetFolder', () => {
  const docPath = '/Users/me/notes/my-note.md';
  const wsRoot = '/Users/me';

  it('resolves relative to the document folder by default', () => {
    expect(resolveTargetFolder(baseConfig, docPath, wsRoot))
      .toBe('/Users/me/notes/images');
  });

  it('resolves relative to the workspace root when configured', () => {
    expect(resolveTargetFolder({ ...baseConfig, folderRelativeTo: 'workspace' }, docPath, wsRoot))
      .toBe('/Users/me/images');
  });

  it('falls back to the document folder when workspace is undefined', () => {
    expect(resolveTargetFolder({ ...baseConfig, folderRelativeTo: 'workspace' }, docPath, undefined))
      .toBe('/Users/me/notes/images');
  });

  it('honors absolute folder paths regardless of folderRelativeTo', () => {
    const absConfig = { ...baseConfig, folder: '/var/cache/mikedown', folderRelativeTo: 'document' as const };
    expect(resolveTargetFolder(absConfig, docPath, wsRoot)).toBe('/var/cache/mikedown');
  });
});

describe('resolveFilename', () => {
  const ctx = {
    docName: 'note',
    extension: 'png',
    data: sampleData,
    timestamp: new Date(2026, 4, 6, 14, 30, 22),
  };

  it('uses the resolved name verbatim when nothing collides', () => {
    const result = resolveFilename('${docName}', '/tmp/imgs', ctx, () => false);
    expect(result.absPath).toBe(path.join('/tmp/imgs', 'note.png'));
    expect(result.reused).toBe(false);
  });

  it('appends -1, -2 ... when names collide and pattern lacks ${hash}', () => {
    const existing = new Set([
      path.join('/tmp/imgs', 'note.png'),
      path.join('/tmp/imgs', 'note-1.png'),
    ]);
    const result = resolveFilename('${docName}', '/tmp/imgs', ctx, p => existing.has(p));
    expect(result.absPath).toBe(path.join('/tmp/imgs', 'note-2.png'));
    expect(result.reused).toBe(false);
  });

  it('reuses an existing file when ${hash} is in the pattern and content matches', () => {
    const existing = new Set([path.join('/tmp/imgs', 'note-12dada1f.png')]);
    const result = resolveFilename(
      '${docName}-${hash}',
      '/tmp/imgs',
      ctx,
      p => existing.has(p),
      () => '12dada1fff4d4787ade3333147202c3b443e376f', // matches sha1(sampleData)
    );
    expect(result.absPath).toBe(path.join('/tmp/imgs', 'note-12dada1f.png'));
    expect(result.reused).toBe(true);
  });

  it('does NOT reuse when ${hash} is present but content differs', () => {
    const existing = new Set([path.join('/tmp/imgs', 'note-12dada1f.png')]);
    const result = resolveFilename(
      '${docName}-${hash}',
      '/tmp/imgs',
      ctx,
      p => existing.has(p),
      () => 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    );
    expect(result.absPath).toBe(path.join('/tmp/imgs', 'note-12dada1f-1.png'));
    expect(result.reused).toBe(false);
  });
});

describe('formatInsertPath', () => {
  const docPath = '/Users/me/notes/my-note.md';
  const wsRoot = '/Users/me';

  it('emits a POSIX path relative to the document folder', () => {
    expect(formatInsertPath('/Users/me/notes/images/foo.png', docPath, wsRoot, 'relative'))
      .toBe('images/foo.png');
  });

  it('emits a leading-slash workspace-relative path when configured', () => {
    expect(formatInsertPath('/Users/me/notes/images/foo.png', docPath, wsRoot, 'workspace-absolute'))
      .toBe('/notes/images/foo.png');
  });

  it('falls back to relative when workspace root is undefined', () => {
    expect(formatInsertPath('/Users/me/notes/images/foo.png', docPath, undefined, 'workspace-absolute'))
      .toBe('images/foo.png');
  });
});

describe('resizeSiblingPath', () => {
  it('appends -<pct>pct to the basename, preserving the extension', () => {
    expect(resizeSiblingPath('/imgs/foo.png', 50, () => false))
      .toBe(path.join('/imgs', 'foo-50pct.png'));
  });

  it('rounds non-integer percentages', () => {
    expect(resizeSiblingPath('/imgs/foo.png', 33.6, () => false))
      .toBe(path.join('/imgs', 'foo-34pct.png'));
  });

  it('appends -1, -2 ... when the sibling already exists', () => {
    const existing = new Set([
      path.join('/imgs', 'foo-50pct.png'),
      path.join('/imgs', 'foo-50pct-1.png'),
    ]);
    expect(resizeSiblingPath('/imgs/foo.png', 50, p => existing.has(p)))
      .toBe(path.join('/imgs', 'foo-50pct-2.png'));
  });

  it('preserves uncommon extensions like .webp', () => {
    expect(resizeSiblingPath('/imgs/diagram.webp', 25, () => false))
      .toBe(path.join('/imgs', 'diagram-25pct.webp'));
  });

  it('handles paths with multiple dots in the basename', () => {
    expect(resizeSiblingPath('/imgs/v1.2.foo.jpg', 75, () => false))
      .toBe(path.join('/imgs', 'v1.2.foo-75pct.jpg'));
  });
});

describe('extractLocalImageRefs', () => {
  it('returns srcs from inline image links, skipping external + data URIs', () => {
    const md = [
      '![ok](images/a.png)',
      '![scheme](https://example.com/b.png)',
      '![data](data:image/png;base64,xxxx)',
      '![rel](./sub/c.jpg)',
      '![abs](/notes/images/d.webp)',
    ].join('\n');
    expect(extractLocalImageRefs(md)).toEqual([
      'images/a.png',
      './sub/c.jpg',
      '/notes/images/d.webp',
    ]);
  });

  it('strips cache-bust queries', () => {
    expect(extractLocalImageRefs('![x](images/foo.png?v=12345)')).toEqual(['images/foo.png']);
    expect(extractLocalImageRefs('![x](images/foo.png#frag)')).toEqual(['images/foo.png']);
  });

  it('returns an empty array when there are no images', () => {
    expect(extractLocalImageRefs('# Heading\n\nNo images here.')).toEqual([]);
  });
});

describe('resolveLocalImagePaths', () => {
  const docDir = '/Users/me/notes/sub';
  const wsRoot = '/Users/me/notes';

  it('resolves relative srcs against the document directory', () => {
    expect(resolveLocalImagePaths(['images/a.png', './b.png', '../c.png'], docDir, wsRoot))
      .toEqual([
        path.join(docDir, 'images/a.png'),
        path.join(docDir, 'b.png'),
        path.join('/Users/me/notes', 'c.png'),
      ]);
  });

  it('treats leading-slash paths as workspace-absolute when a workspace exists', () => {
    expect(resolveLocalImagePaths(['/images/x.png'], docDir, wsRoot))
      .toEqual([path.join(wsRoot, '/images/x.png')]);
  });

  it('falls back to a real absolute path when no workspace is provided', () => {
    expect(resolveLocalImagePaths(['/Users/other/x.png'], docDir, undefined))
      .toEqual(['/Users/other/x.png']);
  });
});

describe('isInsideManagedFolder', () => {
  const docPath = '/Users/me/notes/my-note.md';
  const wsRoot = '/Users/me/notes';

  it('returns true for a file directly inside the configured folder', () => {
    expect(isInsideManagedFolder(
      path.join('/Users/me/notes', 'images', 'foo.png'),
      baseConfig,
      docPath,
      wsRoot,
    )).toBe(true);
  });

  it('returns false for a file outside the configured folder', () => {
    expect(isInsideManagedFolder(
      path.join('/Users/me/notes', 'attachments', 'foo.png'),
      baseConfig,
      docPath,
      wsRoot,
    )).toBe(false);
  });

  it('does not match sibling folders that share a prefix', () => {
    expect(isInsideManagedFolder(
      path.join('/Users/me/notes', 'imagesX', 'foo.png'),
      baseConfig,
      docPath,
      wsRoot,
    )).toBe(false);
  });

  it('honors workspace-relative folder placement', () => {
    const cfg = { ...baseConfig, folderRelativeTo: 'workspace' as const };
    expect(isInsideManagedFolder(
      path.join('/Users/me/notes', 'images', 'foo.png'),
      cfg,
      docPath,
      wsRoot,
    )).toBe(true);
  });
});

describe('looksLikeAutoPastedImage', () => {
  const pattern = '${docName}-${timestamp}';

  it('matches the default ${docName}-${timestamp} shape', () => {
    expect(looksLikeAutoPastedImage('my-note-20260506-143022.png', pattern, 'my-note')).toBe(true);
    expect(looksLikeAutoPastedImage('my-note-20260506-143022.jpg', pattern, 'my-note')).toBe(true);
    expect(looksLikeAutoPastedImage('my-note-20260506-143022.webp', pattern, 'my-note')).toBe(true);
  });

  it('allows the collision suffix -1, -2, …', () => {
    expect(looksLikeAutoPastedImage('my-note-20260506-143022-1.png', pattern, 'my-note')).toBe(true);
    expect(looksLikeAutoPastedImage('my-note-20260506-143022-42.png', pattern, 'my-note')).toBe(true);
  });

  it('rejects user-curated names like logo.png', () => {
    expect(looksLikeAutoPastedImage('logo.png', pattern, 'my-note')).toBe(false);
    expect(looksLikeAutoPastedImage('hero-banner.png', pattern, 'my-note')).toBe(false);
    expect(looksLikeAutoPastedImage('my-note.png', pattern, 'my-note')).toBe(false);
  });

  it('rejects pastes from a different doc when the pattern includes ${docName}', () => {
    // A file pasted while editing `other-note.md` won't match `my-note.md`'s
    // pattern shape — preferring under-deletion to over-deletion.
    expect(looksLikeAutoPastedImage('other-note-20260506-143022.png', pattern, 'my-note')).toBe(false);
  });

  it('matches ${hash}-only patterns', () => {
    expect(looksLikeAutoPastedImage('img-12dada1f.png', 'img-${hash}', 'whatever')).toBe(true);
    expect(looksLikeAutoPastedImage('img-not-hex-12.png', 'img-${hash}', 'whatever')).toBe(false);
  });

  it('matches ${index}-only patterns', () => {
    expect(looksLikeAutoPastedImage('shot-7.png', 'shot-${index}', 'whatever')).toBe(true);
    expect(looksLikeAutoPastedImage('shot-x.png', 'shot-${index}', 'whatever')).toBe(false);
  });

  it('returns false for unknown tokens (avoid widening cleanup)', () => {
    expect(looksLikeAutoPastedImage('anything.png', '${docName}-${random}', 'note')).toBe(false);
  });

  it('returns false for an empty pattern', () => {
    expect(looksLikeAutoPastedImage('foo.png', '', 'note')).toBe(false);
  });
});

describe('resolveAltText', () => {
  it('returns empty string by default', () => {
    expect(resolveAltText('empty', 'note', undefined)).toBe('');
  });

  it('returns the filename without extension when "filename"', () => {
    expect(resolveAltText('filename', 'note-20260506-143022', undefined))
      .toBe('note-20260506-143022');
  });

  it('returns the prompted value when "prompt"', () => {
    expect(resolveAltText('prompt', 'note', 'A diagram')).toBe('A diagram');
    expect(resolveAltText('prompt', 'note', '')).toBe('');
    expect(resolveAltText('prompt', 'note', undefined)).toBe('');
  });
});
