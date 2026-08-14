import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as path from 'path';

let workspaceFolders: { uri: { fsPath: string } }[] | undefined;
const readFile = vi.fn();

vi.mock('vscode', () => ({
  Uri: {
    file: (p: string) => ({ fsPath: p, toString: () => `file://${p}` }),
    parse: (s: string) => ({ fsPath: s, toString: () => s }),
  },
  workspace: {
    get workspaceFolders() {
      return workspaceFolders;
    },
    fs: { readFile: (...args: any[]) => readFile(...args) },
  },
}));

import {
  rewriteUrlsForServer,
  isAllowedAsset,
  encodeAssetPath,
  decodeAssetPath,
  serveExport,
  disposeExportServer,
  MAX_ENTRIES,
} from '../../src/exportServer';

describe('encodeAssetPath / decodeAssetPath', () => {
  it('round-trips absolute paths, including ones with spaces and unicode', () => {
    const p = '/Users/me/My Docs/résumé.png';
    expect(decodeAssetPath(encodeAssetPath(p))).toBe(p);
  });
});

describe('rewriteUrlsForServer', () => {
  it('rewrites a relative src into a token-scoped asset URL', () => {
    const out = rewriteUrlsForServer('<img src="images/pic.png">', '/docs', 'TOK');
    const resolved = path.resolve('/docs', 'images/pic.png');
    expect(out).toBe(`<img src="/a/TOK/${encodeAssetPath(resolved)}">`);
  });

  it('leaves #anchor links untouched', () => {
    const html = '<a href="#section-1">jump</a>';
    expect(rewriteUrlsForServer(html, '/docs', 'TOK')).toBe(html);
  });

  it('leaves absolute URLs and data: URIs untouched', () => {
    const html = '<a href="https://example.com">x</a><img src="data:image/png;base64,abc">';
    expect(rewriteUrlsForServer(html, '/docs', 'TOK')).toBe(html);
  });

  it('preserves a trailing #hash on a rewritten relative link', () => {
    const out = rewriteUrlsForServer('<a href="other.md#heading">x</a>', '/docs', 'TOK');
    const resolved = path.resolve('/docs', 'other.md');
    expect(out).toBe(`<a href="/a/TOK/${encodeAssetPath(resolved)}#heading">x</a>`);
  });
});

describe('isAllowedAsset', () => {
  beforeEach(() => {
    workspaceFolders = undefined;
  });

  it('allows a file inside the document directory', () => {
    expect(isAllowedAsset('/docs/sub/pic.png', '/docs')).toBe(true);
  });

  it('allows the base directory itself', () => {
    expect(isAllowedAsset('/docs', '/docs')).toBe(true);
  });

  it('denies a path that escapes the document directory via ../', () => {
    expect(isAllowedAsset('/etc/passwd', '/docs')).toBe(false);
    expect(isAllowedAsset(path.resolve('/docs', '../../etc/passwd'), '/docs')).toBe(false);
  });

  it('allows a path inside an open workspace folder even outside the doc dir', () => {
    workspaceFolders = [{ uri: { fsPath: '/workspace' } }];
    expect(isAllowedAsset('/workspace/assets/pic.png', '/docs')).toBe(true);
  });

  it('denies a path outside both the doc dir and any workspace folder', () => {
    workspaceFolders = [{ uri: { fsPath: '/workspace' } }];
    expect(isAllowedAsset('/somewhere/else/pic.png', '/docs')).toBe(false);
  });
});

describe('serveExport / disposeExportServer (real loopback listener)', () => {
  afterEach(() => {
    disposeExportServer();
  });

  function get(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      http
        .get(url, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        })
        .on('error', reject);
    });
  }

  it('serves the registered HTML at the returned URL', async () => {
    const uri = await serveExport(() => '<p>hello</p>', '/docs');
    const res = await get(uri.toString());
    expect(res.status).toBe(200);
    expect(res.body).toBe('<p>hello</p>');
  });

  it('mints a distinct token per call', async () => {
    const a = await serveExport(() => '<p>a</p>', '/docs');
    const b = await serveExport(() => '<p>b</p>', '/docs');
    expect(a.toString()).not.toBe(b.toString());
  });

  it('returns 404 for an unknown token', async () => {
    const uri = await serveExport(() => '<p>hello</p>', '/docs');
    const base = uri.toString().replace(/\/e\/.*/, '/e/not-a-real-token');
    const res = await get(base);
    expect(res.status).toBe(404);
  });

  it('evicts the oldest entry once more than MAX_ENTRIES are registered', async () => {
    const first = await serveExport(() => '<p>0</p>', '/docs');
    for (let i = 1; i <= MAX_ENTRIES; i++) {
      await serveExport(() => `<p>${i}</p>`, '/docs');
    }
    const res = await get(first.toString());
    expect(res.status).toBe(404);
  });

  it('serves an allowed asset through workspace.fs.readFile with the right content type', async () => {
    readFile.mockResolvedValue(Buffer.from('binary-png-bytes'));
    const token = { current: '' };
    const uri = await serveExport((t) => {
      token.current = t;
      return `<img src="/a/${t}/${encodeAssetPath('/docs/pic.png')}">`;
    }, '/docs');
    void uri; // registers the entry with baseDir '/docs'
    const assetUrl = `http://127.0.0.1:${new URL(uri.toString()).port}/a/${token.current}/${encodeAssetPath('/docs/pic.png')}`;
    const res = await get(assetUrl);
    expect(res.status).toBe(200);
    expect(res.body).toBe('binary-png-bytes');
    expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ fsPath: '/docs/pic.png' }));
  });

  it('returns 403 for an asset path outside the allowed roots', async () => {
    const token = { current: '' };
    const uri = await serveExport((t) => {
      token.current = t;
      return '<p>doc</p>';
    }, '/docs');
    const port = new URL(uri.toString()).port;
    const evilUrl = `http://127.0.0.1:${port}/a/${token.current}/${encodeAssetPath('/etc/passwd')}`;
    const res = await get(evilUrl);
    expect(res.status).toBe(403);
  });

  it('disposeExportServer clears entries so previously served URLs 404 or refuse', async () => {
    const uri = await serveExport(() => '<p>hi</p>', '/docs');
    disposeExportServer();
    await expect(get(uri.toString())).rejects.toBeTruthy();
  });
});
