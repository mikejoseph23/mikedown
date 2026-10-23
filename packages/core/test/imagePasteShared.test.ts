// @vitest-environment node
// Platform-neutral image-paste helpers with injected POSIX and Windows path
// implementations. The default (pure) SHA-1 is exercised here; the extension
// injects Node crypto (see test/unit/imagePaste.test.ts).
import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createImagePasteHelpers,
  type ImagePasteSettings,
} from '../src/shared/imagePaste';
import { sha1Hex } from '../src/shared/sha1';

const config: ImagePasteSettings = {
  enabled: true,
  folder: 'images',
  folderRelativeTo: 'document',
  filenamePattern: '${docName}-${timestamp}',
  pathStyle: 'relative',
  altText: 'empty',
  maxSizeMB: 10,
  cleanupUnreferenced: true,
};
const data = new Uint8Array([1, 2, 3, 4]);
const ctx = { docName: 'note', extension: 'png', data, timestamp: new Date(2026, 4, 6, 14, 30, 22) };

describe('pure sha1Hex', () => {
  it('matches node:crypto across block boundaries', () => {
    for (const n of [0, 1, 4, 55, 56, 63, 64, 65, 119, 1000]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 0xff);
      expect(sha1Hex(bytes)).toBe(createHash('sha1').update(bytes).digest('hex'));
    }
  });

  it('is the default hash for the ${hash} token', () => {
    const h = createImagePasteHelpers({ path: posix });
    expect(h.expandFilenamePattern('${hash}', ctx)).toBe('12dada1f');
  });
});

describe('POSIX PathOps', () => {
  const h = createImagePasteHelpers({ path: posix });
  const doc = '/Users/me/notes/my-note.md';
  const ws = '/Users/me';

  it('resolves folders, filenames and insert paths', () => {
    expect(h.resolveTargetFolder(config, doc, ws)).toBe('/Users/me/notes/images');
    expect(h.resolveTargetFolder({ ...config, folderRelativeTo: 'workspace' }, doc, ws)).toBe('/Users/me/images');
    expect(h.resolveTargetFolder({ ...config, folder: 'assets/${docName}' }, doc, ws)).toBe('/Users/me/notes/assets/my-note');
    const taken = new Set(['/imgs/note.png']);
    expect(h.resolveFilename('${docName}', '/imgs', ctx, (p) => taken.has(p)).absPath).toBe('/imgs/note-1.png');
    expect(h.formatInsertPath('/Users/me/notes/images/a.png', doc, ws, 'relative')).toBe('images/a.png');
    expect(h.formatInsertPath('/Users/me/notes/images/a.png', doc, ws, 'workspace-absolute')).toBe('/notes/images/a.png');
  });

  it('handles containment, resize siblings and local refs', () => {
    expect(h.isInsideManagedFolder('/Users/me/notes/images/a.png', config, doc, ws)).toBe(true);
    expect(h.isInsideManagedFolder('/Users/me/notes/imagesX/a.png', config, doc, ws)).toBe(false);
    expect(h.isPathInside('/a/b', '/a/b/c.png')).toBe(true);
    expect(h.isOutsideResourceRoots('/elsewhere/c.png', ['/a/b'])).toBe(true);
    expect(h.resizeSiblingPath('/imgs/foo.png', 50, () => false)).toBe('/imgs/foo-50pct.png');
    expect(h.resolveLocalImagePaths(['images/a.png', '/x.png'], '/Users/me/notes', ws))
      .toEqual(['/Users/me/notes/images/a.png', '/Users/me/x.png']);
  });
});

describe('Windows PathOps', () => {
  const h = createImagePasteHelpers({ path: win32 });
  const doc = 'C:\\Users\\me\\notes\\my-note.md';
  const ws = 'C:\\Users\\me';

  it('resolves folders, filenames and POSIX insert paths', () => {
    expect(h.resolveTargetFolder(config, doc, ws)).toBe('C:\\Users\\me\\notes\\images');
    expect(h.resolveTargetFolder({ ...config, folderRelativeTo: 'workspace' }, doc, ws)).toBe('C:\\Users\\me\\images');
    expect(h.resolveTargetFolder({ ...config, folder: 'D:\\pics' }, doc, ws)).toBe('D:\\pics');
    expect(h.resolveFilename('${docName}', 'C:\\imgs', ctx, () => false).absPath).toBe('C:\\imgs\\note.png');
    expect(h.formatInsertPath('C:\\Users\\me\\notes\\images\\a.png', doc, ws, 'relative')).toBe('images/a.png');
    expect(h.formatInsertPath('C:\\Users\\me\\notes\\images\\a.png', doc, ws, 'workspace-absolute')).toBe('/notes/images/a.png');
  });

  it('handles containment, cross-drive paths and resize siblings', () => {
    expect(h.isInsideManagedFolder('C:\\Users\\me\\notes\\images\\a.png', config, doc, ws)).toBe(true);
    expect(h.isInsideManagedFolder('C:\\Users\\me\\notes\\imagesX\\a.png', config, doc, ws)).toBe(false);
    expect(h.isPathInside('C:\\Users\\me', 'C:\\Users\\me\\notes\\a.png')).toBe(true);
    expect(h.isPathInside('C:\\Users\\me', 'D:\\Users\\me\\a.png')).toBe(false);
    expect(h.isOutsideResourceRoots('D:\\Desktop\\a.png', [ws])).toBe(true);
    expect(h.resizeSiblingPath('C:\\imgs\\foo.png', 50, () => false)).toBe('C:\\imgs\\foo-50pct.png');
    expect(h.resolveLocalImagePaths(['images/a.png'], 'C:\\Users\\me\\notes', ws))
      .toEqual(['C:\\Users\\me\\notes\\images\\a.png']);
  });
});

describe('path-free helpers on the factory', () => {
  const h = createImagePasteHelpers({ path: posix });
  it('exposes the pure helpers too', () => {
    expect(h.extensionFromMime('image/png')).toBe('png');
    expect(h.sanitizeForFilename('My Note: v2*')).toBe('My-Note-v2');
    expect(h.extractLocalImageRefs('![a](images/a.png?v=1) ![b](https://x/b.png)')).toEqual(['images/a.png']);
    expect(h.looksLikeAutoPastedImage('my-note-20260506-143022-1.png', '${docName}-${timestamp}', 'my-note')).toBe(true);
    expect(h.resolveAltText('filename', 'x', undefined)).toBe('x');
  });
});
