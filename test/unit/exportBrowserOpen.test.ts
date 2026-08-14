import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// openRenderedInBrowser branches on vscode.env.remoteName and, on the remote
// path, delegates to src/exportServer. Both are mocked here so we can drive
// each branch (local / remote success / remote failure fallback) without a
// real VS Code host or real network listener.

const writeFile = vi.fn().mockResolvedValue(undefined);
const openExternal = vi.fn().mockResolvedValue(true);
const asExternalUri = vi.fn(async (uri: any) => uri);
const showSaveDialog = vi.fn();
const showInformationMessage = vi.fn();
const showWarningMessage = vi.fn();

let remoteName: string | undefined;

vi.mock('vscode', () => ({
  Uri: {
    file: (p: string) => ({ fsPath: p, toString: () => `file://${p}` }),
    parse: (s: string) => ({ fsPath: s, toString: () => s }),
  },
  env: {
    get remoteName() {
      return remoteName;
    },
    asExternalUri: (uri: any) => asExternalUri(uri),
    openExternal: (uri: any) => openExternal(uri),
  },
  workspace: {
    fs: { writeFile: (...args: any[]) => writeFile(...args) },
    workspaceFolders: undefined,
  },
  window: {
    showSaveDialog: (...args: any[]) => showSaveDialog(...args),
    showInformationMessage: (...args: any[]) => showInformationMessage(...args),
    showWarningMessage: (...args: any[]) => showWarningMessage(...args),
  },
}));

const serveExport = vi.fn();
const rewriteUrlsForServer = vi.fn((html: string) => html);

vi.mock('../../src/exportServer', () => ({
  serveExport: (...args: any[]) => serveExport(...args),
  rewriteUrlsForServer: (...args: any[]) => rewriteUrlsForServer(...args),
}));

import { openRenderedInBrowser } from '../../src/export';

describe('openRenderedInBrowser', () => {
  beforeEach(() => {
    remoteName = undefined;
    vi.clearAllMocks();
    openExternal.mockResolvedValue(true);
    asExternalUri.mockImplementation(async (uri: any) => uri);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('local session: writes a temp file and opens it directly, never touching the export server', async () => {
    await openRenderedInBrowser('<p>hi</p>', '/docs/notes.md', {});

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(serveExport).not.toHaveBeenCalled();
    expect(asExternalUri).not.toHaveBeenCalled();

    const [uriArg] = openExternal.mock.calls[0];
    expect(uriArg.fsPath).toMatch(/mikedown-preview-notes-\d+\.html$/);
  });

  it('local session with autoPrint: uses the mikedown-print- prefix', async () => {
    await openRenderedInBrowser('<p>hi</p>', '/docs/notes.md', { autoPrint: true });
    const [uriArg] = openExternal.mock.calls[0];
    expect(uriArg.fsPath).toMatch(/mikedown-print-notes-\d+\.html$/);
  });

  it('remote session: serves the export over the loopback server and opens the forwarded URI', async () => {
    remoteName = 'dev-container';
    serveExport.mockResolvedValue({ fsPath: 'http://127.0.0.1:1234/e/tok', toString: () => 'http://127.0.0.1:1234/e/tok' });

    await openRenderedInBrowser('<p>hi</p>', '/docs/notes.md', {});

    expect(serveExport).toHaveBeenCalledTimes(1);
    expect(asExternalUri).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(writeFile).not.toHaveBeenCalled();
    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it('remote session, server failure: falls back to a save dialog instead of throwing', async () => {
    remoteName = 'ssh-remote';
    serveExport.mockRejectedValue(new Error('listen EADDRNOTAVAIL'));
    showSaveDialog.mockResolvedValue({ fsPath: '/local/notes.html' });

    await expect(
      openRenderedInBrowser('<p>hi</p>', '/docs/notes.md', {})
    ).resolves.toBeUndefined();

    expect(showSaveDialog).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(showInformationMessage).toHaveBeenCalledTimes(1);
    expect(showWarningMessage).not.toHaveBeenCalled();
  });

  it('remote session, openExternal declines: falls back to a save dialog', async () => {
    remoteName = 'codespaces';
    serveExport.mockResolvedValue({ fsPath: 'http://127.0.0.1:1234/e/tok', toString: () => 'http://127.0.0.1:1234/e/tok' });
    openExternal.mockResolvedValue(false);
    showSaveDialog.mockResolvedValue({ fsPath: '/local/notes.html' });

    await openRenderedInBrowser('<p>hi</p>', '/docs/notes.md', {});

    expect(showSaveDialog).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it('remote session, fallback save dialog cancelled: warns instead of throwing', async () => {
    remoteName = 'ssh-remote';
    serveExport.mockRejectedValue(new Error('no route'));
    showSaveDialog.mockResolvedValue(undefined);

    await expect(
      openRenderedInBrowser('<p>hi</p>', '/docs/notes.md', {})
    ).resolves.toBeUndefined();

    expect(writeFile).not.toHaveBeenCalled();
    expect(showWarningMessage).toHaveBeenCalledTimes(1);
  });
});
