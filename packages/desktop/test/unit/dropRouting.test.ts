import { describe, expect, it } from 'vitest';
import { createPathOps } from '../../src/host/pathOps';
import {
  dropRefusal,
  dropTargetDir,
  imageMimeFor,
  linkLabel,
  relativeLinkHref,
  routeEditorDrop,
  treeDropOperation,
} from '../../src/tree/dropRouting';

const posix = createPathOps('posix');
const win = createPathOps('win32');

describe('tree drops (edge case 20)', () => {
  it('moves inside the tree, copies from outside, Option/Alt inverts', () => {
    expect(treeDropOperation('tree', false)).toBe('move');
    expect(treeDropOperation('tree', true)).toBe('copy');
    expect(treeDropOperation('external', false)).toBe('copy');
    expect(treeDropOperation('external', true)).toBe('move');
  });

  it('lands in the folder row, a file row’s folder, or the root', () => {
    expect(dropTargetDir({ path: '/n/sub', isDir: true }, '/n', posix)).toBe('/n/sub');
    expect(dropTargetDir({ path: '/n/sub/a.md', isDir: false }, '/n', posix)).toBe('/n/sub');
    expect(dropTargetDir(null, '/n', posix)).toBe('/n');
  });

  it('refuses a folder into itself and skips a move into its own folder', () => {
    expect(dropRefusal('/n/sub', '/n/sub/inner', 'move', posix)).toBe('self');
    expect(dropRefusal('/n/sub', '/n/sub', 'copy', posix)).toBe('self');
    expect(dropRefusal('/n/a.md', '/n', 'move', posix)).toBe('same');
    expect(dropRefusal('/n/a.md', '/n', 'copy', posix)).toBeNull();
    expect(dropRefusal('/n/a.md', '/n/sub', 'move', posix)).toBeNull();
    expect(dropRefusal('C:\\n\\Sub', 'c:\\n\\sub\\x', 'move', win)).toBe('self');
  });
});

describe('editor drops (edge case 20)', () => {
  it('routes images, markdown, other text, and everything else', () => {
    expect(routeEditorDrop({ path: '/x/shot.PNG', isDir: false }).kind).toBe('image');
    expect(routeEditorDrop({ path: '/x/note.md', isDir: false }).kind).toBe('link');
    expect(routeEditorDrop({ path: '/x/note.markdown', isDir: false }).kind).toBe('link');
    expect(routeEditorDrop({ path: '/x/data.json', isDir: false }).kind).toBe('open');
    expect(routeEditorDrop({ path: '/x/README', isDir: false }).kind).toBe('open');
    expect(routeEditorDrop({ path: '/x/report.pdf', isDir: false }).kind).toBe('unsupported');
    expect(routeEditorDrop({ path: '/x/folder.md', isDir: true }).kind).toBe('unsupported');
  });

  it('writes a relative, percent-encoded link with ./ in front', () => {
    expect(relativeLinkHref('/n/a.md', '/n/b.md', posix)).toBe('./b.md');
    expect(relativeLinkHref('/n/a.md', '/n/sub/My Note.md', posix)).toBe('./sub/My%20Note.md');
    expect(relativeLinkHref('/n/sub/a.md', '/n/b.md', posix)).toBe('../b.md');
    expect(relativeLinkHref('C:\\n\\a.md', 'C:\\n\\sub\\b.md', win)).toBe('./sub/b.md');
  });

  it('labels the link with the file name and knows image types', () => {
    expect(linkLabel('/n/My Note.md', posix)).toBe('My Note');
    expect(linkLabel('/n/x.markdown', posix)).toBe('x');
    expect(imageMimeFor('/a/b.JPG')).toBe('image/jpeg');
    expect(imageMimeFor('/a/b.svg')).toBe('image/svg+xml');
    expect(imageMimeFor('/a/b.heic')).toBe('');
  });
});
