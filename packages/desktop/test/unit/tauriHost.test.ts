/**
 * TauriHost over a mocked Tauri IPC layer: every host method is driven
 * through the real fsApi / windowApi / dialog plugin wiring (helpers/app.ts)
 * and the resulting `invoke` traffic is pinned in a snapshot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveImageRenderSrc } from '../../../core/src/imageSrcPolicy';
import type { ReadInfo } from '../../src/documents/documentModel';
import { createTestApp, fakeHandle, flush, type TestApp } from './helpers/app';
import { buttonLabel, installIpc, uninstallIpc, type IpcCall } from './helpers/ipc';

const DOC = '/Users/mike/notes/todo.md';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

interface Answers {
  /** Button the user clicks in `plugin:dialog|message`. */
  message: 'ok' | 'cancel';
  /** Path `plugin:dialog|save` returns (null = cancelled). */
  save: string | null;
  /** Path `plugin:dialog|open` returns (null = cancelled). */
  open: string | null;
  files: Record<string, string>;
}

let answers: Answers;
let calls: IpcCall[];
let handle: ReturnType<typeof fakeHandle>;
let app: TestApp;

function readInfo(text: string): ReadInfo {
  return { text, encoding: 'utf8', eol: 'lf', mtimeMs: 1000, readOnly: false, size: text.length };
}

function handler(cmd: string, args: any): unknown {
  switch (cmd) {
    case 'read_text': {
      const text = answers.files[args.path];
      if (text === undefined) {throw new Error(`ENOENT ${args.path}`);}
      return readInfo(text);
    }
    case 'write_text':
      answers.files[args.path] = args.text;
      return { mtimeMs: 2000, size: args.text.length };
    case 'write_bytes':
      return { mtimeMs: 2000, size: (args as Uint8Array).length };
    case 'read_bytes':
      return PNG.buffer.slice(0);
    case 'list_dir':
      return [];
    case 'stat': {
      const text = answers.files[args.path];
      return text === undefined
        ? { exists: false, isFile: false, isDir: false, mtimeMs: 0, size: 0, readOnly: false }
        : { exists: true, isFile: true, isDir: false, mtimeMs: 1000, size: text.length, readOnly: false };
    }
    case 'plugin:dialog|message':
      return buttonLabel(args, answers.message);
    case 'plugin:dialog|save':
      return answers.save;
    case 'plugin:dialog|open':
      return answers.open;
    default:
      // mkdir, allow_asset, set_document_edited, set_represented_file,
      // plugin:window|set_title, plugin:shell|open
      return null;
  }
}

async function openDoc(path = DOC, text = '# Todo\n'): Promise<void> {
  answers.files[path] = text;
  expect(await app.controller.openPath(path)).toBe(true);
  await flush();
  calls.length = 0;
}

beforeEach(() => {
  answers = { message: 'ok', save: null, open: null, files: {} };
  document.body.innerHTML = '';
  calls = installIpc(handler);
  handle = fakeHandle();
  app = createTestApp(handle);
  // The window starts on an empty Untitled document, as the app does.
  app.controller.newDocument();
  calls.length = 0;
});

afterEach(() => {
  app.dispose();
  uninstallIpc();
  vi.restoreAllMocks();
});

describe('TauriHost invoke traffic', () => {
  it('opening a file reads it and updates the native window', async () => {
    answers.files[DOC] = '# Todo\n';
    await app.controller.openPath(DOC);
    await flush();
    expect(calls).toMatchSnapshot();
    expect(handle.getMarkdown()).toBe('# Todo\n');
  });

  it('an editor change marks dirty, and the pristine text clears it', async () => {
    await openDoc();
    handle.emitChange('# Todo\n\nmore\n', { pristine: false });
    await flush();
    expect(app.model.dirty).toBe(true);
    expect(app.model.text).toBe('# Todo\n\nmore\n');
    handle.emitChange('# Todo\n', { pristine: true });
    await flush();
    expect(app.model.dirty).toBe(false);
    expect(calls.filter((c) => c.cmd !== 'backup_write' && c.cmd !== 'backup_remove')).toMatchSnapshot();
  });

  it('repeated dirty changes set the macOS edited dot once', async () => {
    await openDoc();
    handle.emitChange('x', { pristine: false });
    handle.emitChange('x', { pristine: false });
    await flush();
    expect(calls.filter((c) => c.cmd === 'set_document_edited')).toEqual([{ cmd: 'set_document_edited', args: { edited: true } }]);
  });

  it('openLink: external goes to the shell plugin, a local link reads the file, an anchor stays in the editor', async () => {
    await openDoc();
    const scroll = vi.spyOn(handle, 'scrollToAnchor');
    app.host.openLink('https://example.com/a?b=1');
    app.host.openLink('#section-two');
    answers.files['/Users/mike/notes/other.md'] = '# Other\n';
    app.host.openLink('other.md#intro');
    await flush();
    expect(scroll).toHaveBeenCalledWith('section-two');
    expect(scroll).toHaveBeenCalledWith('intro');
    expect(calls).toMatchSnapshot();
    expect(app.model.path).toBe('/Users/mike/notes/other.md');
  });

  it('saveSettings stays in memory (no IPC until M5)', async () => {
    app.host.saveSettings({ imagePasteFolder: 'assets' } as never, { silent: true });
    await flush();
    expect(calls).toEqual([]);
  });

  it('save writes the document with its own line ending and BOM options', async () => {
    await openDoc();
    handle.emitChange('# Todo\n\nedited\n', { pristine: false });
    expect(await app.controller.save()).toBe(true);
    await flush();
    expect(calls.filter((c) => c.cmd !== 'backup_write' && c.cmd !== 'backup_remove')).toMatchSnapshot();
    expect(app.model.dirty).toBe(false);
    expect(handle.saved).toEqual(['# Todo\n\nedited\n']);
  });

  it('uploadImage on a saved document writes into images/ beside it', async () => {
    await openDoc();
    const res = await app.host.uploadImage({ bytes: PNG, mime: 'image/png', name: 'paste.png', source: 'paste' } as never);
    expect(res).toEqual({ src: 'images/todo-20261023-140509.png', alt: '' });
    expect(calls).toMatchSnapshot();
  });

  it('uploadImage on an unsaved document rejects when the Save-first dialog is cancelled', async () => {
    answers.message = 'cancel';
    await expect(
      app.host.uploadImage({ bytes: PNG, mime: 'image/png', name: 'paste.png', source: 'paste' } as never),
    ).rejects.toThrow('document not saved');
    expect(calls.map((c) => c.cmd)).toEqual(['plugin:dialog|message']);
    expect(calls[0].args).toMatchObject({
      message: 'Save the document first so the image has a home.',
      buttons: { OkCancelCustom: ['Save As…', 'Cancel'] },
    });
    expect(app.model.path).toBeNull();
  });

  it('uploadImage on an unsaved document rejects when Save As itself is cancelled', async () => {
    answers.message = 'ok';
    answers.save = null;
    await expect(
      app.host.uploadImage({ bytes: PNG, mime: 'image/png', name: 'paste.png', source: 'paste' } as never),
    ).rejects.toThrow('document not saved');
    expect(calls.map((c) => c.cmd)).toEqual(['plugin:dialog|message', 'plugin:dialog|save']);
    expect(calls.some((c) => c.cmd === 'write_bytes' || c.cmd === 'write_text')).toBe(false);
  });

  it('uploadImage on an unsaved document saves it first, then writes the image', async () => {
    answers.save = '/Users/mike/new/Untitled';
    const res = await app.host.uploadImage({ bytes: PNG, mime: 'image/png', name: 'paste.png', source: 'paste' } as never);
    expect(app.model.path).toBe('/Users/mike/new/Untitled.md');
    expect(res.src).toBe('images/Untitled-20261023-140509.png');
    await flush();
    expect(calls).toMatchSnapshot();
  });

  it('pickImage inside the document folder only widens the asset scope', async () => {
    await openDoc();
    answers.open = '/Users/mike/notes/pics/a.png';
    expect(await app.host.pickImage()).toEqual({ src: 'pics/a.png', alt: '' });
    expect(calls).toMatchSnapshot();
  });

  it('pickImage outside the document folder copies the file in', async () => {
    await openDoc();
    answers.open = '/Users/mike/Downloads/shot.png';
    expect(await app.host.pickImage()).toEqual({ src: 'images/todo-20261023-140509.png', alt: '' });
    expect(calls).toMatchSnapshot();
  });

  it('pickImage cancelled inserts nothing', async () => {
    await openDoc();
    expect(await app.host.pickImage()).toBeNull();
    expect(calls.map((c) => c.cmd)).toEqual(['plugin:dialog|open']);
  });

  it('resizeImage overwrites in place by default', async () => {
    await openDoc();
    const res = await app.host.resizeImage({ currentSrc: 'images/a.png?v=1', percent: 50, bytes: PNG, mime: 'image/png' } as never);
    expect(res).toEqual({ src: 'images/a.png', overwritten: true });
    expect(calls).toMatchSnapshot();
  });

  it('resizeImage writes a sibling when overwrite is off', async () => {
    await openDoc();
    app.settings.apply({ 'imageResize.overwrite': false });
    const res = await app.host.resizeImage({ currentSrc: 'images/a.png?v=1', percent: 50, bytes: PNG, mime: 'image/png' } as never);
    expect(res.overwritten).toBe(false);
    expect(res.src).not.toBe('images/a.png');
    expect(calls).toMatchSnapshot();
  });
});

describe('TauriHost.resolveImageSrc', () => {
  it('maps relative and absolute paths to asset URLs and keeps the cache-bust query', async () => {
    await openDoc();
    expect(app.host.resolveImageSrc('images/a b.png')).toBe('asset://localhost/' + encodeURIComponent('/Users/mike/notes/images/a b.png'));
    expect(app.host.resolveImageSrc('../pics/x.png?v=3')).toBe('asset://localhost/' + encodeURIComponent('/Users/mike/pics/x.png') + '?v=3');
    expect(app.host.resolveImageSrc('/tmp/abs.png')).toBe('asset://localhost/' + encodeURIComponent('/tmp/abs.png'));
  });

  it('passes http(s), data: and blob: URLs through untouched', async () => {
    await openDoc();
    for (const src of ['http://example.com/a.png', 'https://example.com/a.png?x=1', 'data:image/png;base64,iVBORw0KGgo=', 'blob:http://localhost/abc']) {
      expect(app.host.resolveImageSrc(src)).toBe(src);
      expect(resolveImageRenderSrc(src, app.host)).toBe(src);
    }
  });

  it('returns null for a relative path in an unsaved document', () => {
    expect(app.host.resolveImageSrc('images/a.png')).toBeNull();
    expect(app.host.resolveImageSrc('https://example.com/a.png')).toBe('https://example.com/a.png');
  });

  it('uses the Windows asset host on Windows', async () => {
    uninstallIpc();
    document.body.innerHTML = '';
    calls = installIpc(handler, 'windows');
    handle = fakeHandle();
    app = createTestApp(handle, { platform: 'win32' });
    answers.files['C:\\Users\\mike\\notes\\todo.md'] = '# T\n';
    await app.controller.openPath('C:\\Users\\mike\\notes\\todo.md');
    expect(app.host.resolveImageSrc('images/a.png')).toBe(
      'http://asset.localhost/' + encodeURIComponent('C:\\Users\\mike\\notes\\images\\a.png'),
    );
  });
});
