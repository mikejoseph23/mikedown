import { describe, expect, it } from 'vitest';
import {
  applyRead,
  classifyPath,
  createUntitled,
  dirName,
  extensionOf,
  fileName,
  folderName,
  LARGE_FILE_BYTES,
  planOpen,
  windowTitle,
  writeOptionsFor,
} from '../../src/documents/documentModel';

describe('classifyPath', () => {
  it('routes markdown, text, images and the rest', () => {
    expect(classifyPath('/a/notes.md')).toBe('markdown');
    expect(classifyPath('/a/NOTES.MARKDOWN')).toBe('markdown');
    expect(classifyPath('/a/todo.txt')).toBe('text');
    expect(classifyPath('/a/config.json')).toBe('text');
    expect(classifyPath('/a/deploy.yaml')).toBe('text');
    expect(classifyPath('/a/README')).toBe('text');
    expect(classifyPath('/a/shot.png')).toBe('image');
    expect(classifyPath('C:\\a\\photo.JPG')).toBe('image');
    expect(classifyPath('/a/report.pdf')).toBe('other');
    expect(classifyPath('/a/deck.pptx')).toBe('other');
    expect(extensionOf('/a/.hidden')).toBe('');
  });
});

describe('planOpen', () => {
  const utf8 = { encoding: 'utf8' as const, readOnly: false, size: 10 };

  it('opens markdown as rich text, writable', () => {
    expect(planOpen('/a/b.md', utf8)).toEqual({
      kind: 'markdown', sourceMode: false, readOnly: false, readOnlyReason: null, notice: null,
    });
  });

  it('forces source mode for plain text files', () => {
    const plan = planOpen('/a/b.txt', utf8);
    expect(plan.kind).toBe('text');
    expect(plan.sourceMode).toBe(true);
    expect(plan.readOnly).toBe(false);
  });

  it('read-only on disk keeps the reason for the Save As prompt (edge 10)', () => {
    const plan = planOpen('/a/b.md', { ...utf8, readOnly: true });
    expect(plan.readOnly).toBe(true);
    expect(plan.readOnlyReason).toMatch(/read-only/);
    expect(plan.sourceMode).toBe(false);
  });

  it('non-UTF-8 opens read-only in source mode with a notice (edge 11)', () => {
    const plan = planOpen('/a/b.md', { ...utf8, encoding: 'unknown' });
    expect(plan.readOnly).toBe(true);
    expect(plan.sourceMode).toBe(true);
    expect(plan.notice).toMatch(/not UTF-8/);
    expect(plan.readOnlyReason).toMatch(/Save As/);
  });

  it('large markdown opens in source mode (edge 12)', () => {
    const plan = planOpen('/a/b.md', { ...utf8, size: LARGE_FILE_BYTES + 1 });
    expect(plan.sourceMode).toBe(true);
    expect(plan.readOnly).toBe(false);
    expect(plan.notice).toMatch(/Large file/);
  });
});

describe('model bookkeeping', () => {
  it('applyRead copies encoding, eol and bom so a save writes the same bytes', () => {
    const model = createUntitled();
    const plan = planOpen('/a/b.md', { encoding: 'utf8-bom', readOnly: false, size: 5 });
    applyRead(model, '/a/b.md', { text: 'x\n', encoding: 'utf8-bom', eol: 'crlf', mtimeMs: 123, readOnly: false, size: 5 }, plan);
    expect(model.path).toBe('/a/b.md');
    expect(model.dirty).toBe(false);
    expect(model.bom).toBe(true);
    expect(model.eol).toBe('crlf');
    expect(model.mtimeMs).toBe(123);
    expect(writeOptionsFor(model)).toEqual({ eol: 'crlf', bom: true });
  });

  it('a new document is LF without a BOM', () => {
    expect(writeOptionsFor(createUntitled())).toEqual({ eol: 'lf', bom: false });
  });
});

describe('names and titles (edge 29)', () => {
  it('derives file and folder names on both platforms', () => {
    expect(fileName({ path: '/Users/mike/notes/todo.md' })).toBe('todo.md');
    expect(fileName({ path: 'C:\\Users\\mike\\notes\\todo.md' })).toBe('todo.md');
    expect(fileName({ path: null })).toBe('Untitled');
    expect(dirName('/Users/mike/notes/todo.md')).toBe('/Users/mike/notes');
    expect(dirName('/todo.md')).toBe('/');
    expect(folderName('/Users/mike/notes/todo.md')).toBe('notes');
    expect(folderName('C:\\Users\\mike\\notes\\todo.md')).toBe('notes');
    expect(folderName('/todo.md')).toBe('');
  });

  it('formats "filename — foldername"', () => {
    expect(windowTitle({ path: '/Users/mike/notes/todo.md', dirty: false }, 'mac')).toBe('todo.md — notes');
    expect(windowTitle({ path: '/todo.md', dirty: false }, 'mac')).toBe('todo.md');
    expect(windowTitle({ path: null, dirty: false }, 'mac')).toBe('Untitled');
  });

  it('marks dirty in the title only where the OS has no dot', () => {
    expect(windowTitle({ path: '/n/todo.md', dirty: true }, 'mac')).toBe('todo.md — n');
    expect(windowTitle({ path: '/n/todo.md', dirty: true }, 'other')).toBe('• todo.md — n');
    expect(windowTitle({ path: null, dirty: true }, 'other')).toBe('• Untitled');
  });
});
