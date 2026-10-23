import { describe, expect, it, vi } from 'vitest';
import { createImagePasteHelpers } from '@mikedown/core/shared/imagePaste';
import { sha1Hex } from '@mikedown/core/shared/sha1';
import { createImagePipeline, resolveImageTarget, stripQuery, type ImagePipelineDeps } from '../../src/host/imagePipeline';
import { createPathOps } from '../../src/host/pathOps';
import { DEFAULT_DESKTOP_SETTINGS, type DesktopSettings } from '../../src/settings/desktopSettings';

const path = createPathOps('posix');
const helpers = createImagePasteHelpers({ path });
const DOC = '/Users/mike/notes/todo.md';
const TS = new Date(2026, 9, 23, 14, 5, 9);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function settings(over: Partial<DesktopSettings['imagePaste']> = {}, resize: Partial<DesktopSettings['imageResize']> = {}): DesktopSettings {
  return {
    imagePaste: { ...DEFAULT_DESKTOP_SETTINGS.imagePaste, ...over },
    imageResize: { ...DEFAULT_DESKTOP_SETTINGS.imageResize, ...resize },
  };
}

describe('resolveImageTarget (pure)', () => {
  it('writes next to the document per the default pattern with a relative link', () => {
    const t = resolveImageTarget({
      helpers, path, settings: settings().imagePaste, docPath: DOC, ext: 'png', data: PNG, timestamp: TS, existingNames: new Set(),
    });
    expect(t.targetFolder).toBe('/Users/mike/notes/images');
    expect(t.absPath).toBe('/Users/mike/notes/images/todo-20261023-140509.png');
    expect(t.insertPath).toBe('images/todo-20261023-140509.png');
    expect(t.reused).toBe(false);
    expect(t.filenameNoExt).toBe('todo-20261023-140509');
  });

  it('suffixes on collision', () => {
    const t = resolveImageTarget({
      helpers, path, settings: settings().imagePaste, docPath: DOC, ext: 'png', data: PNG, timestamp: TS,
      existingNames: new Set(['todo-20261023-140509.png', 'todo-20261023-140509-1.png']),
    });
    expect(t.insertPath).toBe('images/todo-20261023-140509-2.png');
  });

  it('reuses an identical file when the pattern has ${hash}', () => {
    const s = settings({ filenamePattern: '${docName}-${hash}' }).imagePaste;
    const name = `todo-${sha1Hex(PNG).slice(0, 8)}.png`;
    const t = resolveImageTarget({
      helpers, path, settings: s, docPath: DOC, ext: 'png', data: PNG, timestamp: TS,
      existingNames: new Set([name]), existingHashOfInitial: sha1Hex(PNG),
    });
    expect(t.reused).toBe(true);
    expect(t.insertPath).toBe(`images/${name}`);
    const different = resolveImageTarget({
      helpers, path, settings: s, docPath: DOC, ext: 'png', data: PNG, timestamp: TS,
      existingNames: new Set([name]), existingHashOfInitial: 'deadbeef',
    });
    expect(different.reused).toBe(false);
    expect(different.insertPath).toBe(`images/${name.replace('.png', '-1.png')}`);
  });

  it('honours folder, ${docName} folders and an absolute folder', () => {
    expect(resolveImageTarget({
      helpers, path, settings: settings({ folder: 'assets/${docName}' }).imagePaste, docPath: DOC, ext: 'jpg', data: PNG, timestamp: TS, existingNames: new Set(),
    }).insertPath).toBe('assets/todo/todo-20261023-140509.jpg');
    expect(resolveImageTarget({
      helpers, path, settings: settings({ folder: '/Users/mike/pics' }).imagePaste, docPath: DOC, ext: 'png', data: PNG, timestamp: TS, existingNames: new Set(),
    }).insertPath).toBe('../pics/todo-20261023-140509.png');
  });

  it('falls back to the document folder when folderRelativeTo is workspace but there is none (lone file)', () => {
    const t = resolveImageTarget({
      helpers, path, settings: settings({ folderRelativeTo: 'workspace', pathStyle: 'workspace-absolute' }).imagePaste,
      docPath: DOC, ext: 'png', data: PNG, timestamp: TS, existingNames: new Set(),
    });
    expect(t.targetFolder).toBe('/Users/mike/notes/images');
    expect(t.insertPath).toBe('images/todo-20261023-140509.png');
  });

  it('stripQuery drops the resize cache-bust', () => {
    expect(stripQuery('images/a.png?v=123')).toBe('images/a.png');
    expect(stripQuery('images/a.png#frag')).toBe('images/a.png');
    expect(stripQuery('images/a.png')).toBe('images/a.png');
  });
});

/** In-memory fs for the pipeline: a map of absolute path → bytes. */
function fakeFs(files: Record<string, Uint8Array> = {}) {
  const store = new Map(Object.entries(files));
  const dirs = new Set<string>();
  const writes: Array<{ path: string; bytes: Uint8Array }> = [];
  return {
    store,
    writes,
    dirs,
    listDir: vi.fn(async (dir: string) => {
      const prefix = dir.endsWith('/') ? dir : dir + '/';
      return [...store.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map((p) => ({ name: p.slice(prefix.length), isDir: false }));
    }),
    readBytes: vi.fn(async (p: string) => {
      const b = store.get(p);
      if (!b) {throw new Error(`${p}: not found`);}
      return b;
    }),
    writeBytes: vi.fn(async (p: string, bytes: Uint8Array) => {
      store.set(p, bytes);
      writes.push({ path: p, bytes });
      return { mtimeMs: 1, size: bytes.length };
    }),
    mkdir: vi.fn(async (p: string) => { dirs.add(p); }),
    allowAsset: vi.fn(async () => {}),
  };
}

function deps(over: Partial<ImagePipelineDeps> & { fs?: ReturnType<typeof fakeFs> } = {}) {
  const fs = over.fs ?? fakeFs();
  const doc = { path: DOC as string | null };
  const d: ImagePipelineDeps = {
    path,
    fs,
    getDocument: () => ({ path: doc.path }),
    getSettings: () => settings(),
    ensureSaved: vi.fn(async () => null),
    pickFile: vi.fn(async () => null),
    promptAlt: vi.fn(async () => 'typed alt'),
    notifyError: vi.fn(),
    notify: vi.fn(),
    now: () => TS,
    ...over,
  };
  return { d, fs, doc };
}

describe('createImagePipeline.uploadImage', () => {
  it('writes the file and returns the relative link (acceptance: paste into a saved file)', async () => {
    const { d, fs } = deps();
    const pipeline = createImagePipeline(d);
    const result = await pipeline.uploadImage({ mime: 'image/png', bytes: PNG });
    expect(result).toEqual({ src: 'images/todo-20261023-140509.png', alt: '' });
    expect(fs.mkdir).toHaveBeenCalledWith('/Users/mike/notes/images');
    expect(fs.writes).toEqual([{ path: '/Users/mike/notes/images/todo-20261023-140509.png', bytes: PNG }]);
  });

  it('edge 14: an Untitled document prompts for Save As, and cancel drops the paste', async () => {
    const ensureSaved = vi.fn(async () => null);
    const { d, fs, doc } = deps({ ensureSaved });
    doc.path = null;
    const pipeline = createImagePipeline(d);
    await expect(pipeline.uploadImage({ mime: 'image/png', bytes: PNG })).rejects.toThrow('document not saved');
    expect(ensureSaved).toHaveBeenCalledTimes(1);
    expect(fs.writes).toEqual([]);
  });

  it('edge 14: after Save As the paste continues next to the new file', async () => {
    const { d, fs, doc } = deps({
      ensureSaved: vi.fn(async () => { doc.path = '/Users/mike/new/fresh.md'; return doc.path; }),
    });
    doc.path = null;
    const pipeline = createImagePipeline(d);
    const result = await pipeline.uploadImage({ mime: 'image/png', bytes: PNG });
    expect(result.src).toBe('images/fresh-20261023-140509.png');
    expect(fs.writes[0].path).toBe('/Users/mike/new/images/fresh-20261023-140509.png');
  });

  it('refuses when image paste is off, an unknown type, empty or too big', async () => {
    const { d, fs } = deps({ getSettings: () => settings({ enabled: false }) });
    await expect(createImagePipeline(d).uploadImage({ mime: 'image/png', bytes: PNG })).rejects.toThrow('imagePaste.enabled is false');
    const { d: d2 } = deps();
    await expect(createImagePipeline(d2).uploadImage({ mime: 'application/pdf', bytes: PNG })).rejects.toThrow(/unsupported/);
    await expect(createImagePipeline(d2).uploadImage({ mime: 'image/png', bytes: new Uint8Array() })).rejects.toThrow(/empty/);
    const { d: d3 } = deps({ getSettings: () => settings({ maxSizeMB: 0.000001 }) });
    await expect(createImagePipeline(d3).uploadImage({ mime: 'image/png', bytes: PNG })).rejects.toThrow(/over the/);
    expect(d3.notifyError).toHaveBeenCalled();
    expect(fs.writes).toEqual([]);
  });

  it('dedupes by hash when the pattern asks for it', async () => {
    const name = `todo-${sha1Hex(PNG).slice(0, 8)}.png`;
    const fs = fakeFs({ [`/Users/mike/notes/images/${name}`]: PNG });
    const { d } = deps({ fs, getSettings: () => settings({ filenamePattern: '${docName}-${hash}' }) });
    const result = await createImagePipeline(d).uploadImage({ mime: 'image/png', bytes: PNG });
    expect(result.src).toBe(`images/${name}`);
    expect(fs.writes).toEqual([]);
    expect(fs.readBytes).toHaveBeenCalledWith(`/Users/mike/notes/images/${name}`);
  });

  it('uses the alt-text strategy', async () => {
    const { d } = deps({ getSettings: () => settings({ altText: 'filename' }) });
    expect((await createImagePipeline(d).uploadImage({ mime: 'image/jpeg', bytes: PNG })).alt).toBe('todo-20261023-140509');
    const { d: d2 } = deps({ getSettings: () => settings({ altText: 'prompt' }) });
    expect((await createImagePipeline(d2).uploadImage({ mime: 'image/jpeg', bytes: PNG })).alt).toBe('typed alt');
  });
});

describe('createImagePipeline.pickImage', () => {
  it('references a file inside the document folder in place', async () => {
    const { d, fs } = deps({ pickFile: vi.fn(async () => '/Users/mike/notes/pics/logo.png') });
    const result = await createImagePipeline(d).pickImage();
    expect(result).toEqual({ src: 'pics/logo.png', alt: '' });
    expect(fs.writes).toEqual([]);
    expect(fs.allowAsset).toHaveBeenCalledWith('/Users/mike/notes/pics/logo.png');
  });

  it('copies a file from elsewhere into the image folder', async () => {
    const fs = fakeFs({ '/Users/mike/Desktop/shot.jpeg': PNG });
    const { d } = deps({ fs, pickFile: vi.fn(async () => '/Users/mike/Desktop/shot.jpeg') });
    const result = await createImagePipeline(d).pickImage();
    expect(result?.src).toBe('images/todo-20261023-140509.jpeg');
    expect(fs.writes[0].path).toBe('/Users/mike/notes/images/todo-20261023-140509.jpeg');
  });

  it('resolves null when the picker is cancelled', async () => {
    const { d } = deps();
    expect(await createImagePipeline(d).pickImage()).toBeNull();
  });
});

describe('createImagePipeline.resizeImage', () => {
  const small = new Uint8Array([1, 2]);

  it('overwrites in place by default and returns the same relative src', async () => {
    const fs = fakeFs({ '/Users/mike/notes/images/a.png': PNG });
    const { d } = deps({ fs });
    const result = await createImagePipeline(d).resizeImage({ currentSrc: 'images/a.png?v=1', mime: 'image/png', bytes: small, percent: 50 });
    expect(result).toEqual({ src: 'images/a.png', overwritten: true });
    expect(fs.store.get('/Users/mike/notes/images/a.png')).toBe(small);
  });

  it('writes a -50pct sibling when overwrite is off', async () => {
    const fs = fakeFs({ '/Users/mike/notes/images/a.png': PNG, '/Users/mike/notes/images/a-50pct.png': PNG });
    const { d } = deps({ fs, getSettings: () => settings({}, { overwrite: false }) });
    const result = await createImagePipeline(d).resizeImage({ currentSrc: 'images/a.png', mime: 'image/png', bytes: small, percent: 50 });
    expect(result).toEqual({ src: 'images/a-50pct-1.png', overwritten: false });
  });

  it('refuses external sources and unsaved documents', async () => {
    const { d, doc } = deps();
    await expect(createImagePipeline(d).resizeImage({ currentSrc: 'https://x/y.png', mime: 'image/png', bytes: small, percent: 50 })).rejects.toThrow(/external/);
    doc.path = null;
    await expect(createImagePipeline(d).resizeImage({ currentSrc: 'images/a.png', mime: 'image/png', bytes: small, percent: 50 })).rejects.toThrow(/not a saved file/);
  });
});
