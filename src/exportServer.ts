import * as http from 'http';
import * as path from 'path';
import * as vscode from 'vscode';
import { randomBytes } from 'crypto';

/**
 * A tiny loopback HTTP server used only when the extension host is running
 * remotely (Dev Containers / WSL / SSH / Codespaces).
 *
 * Remotely, `vscode.env.openExternal(vscode.Uri.file(...))` hands the local OS
 * a `vscode-remote://` URI it has no handler for ("Get an app to open this
 * 'vscode-remote' link"), so "View in Browser" and "Print / Export as PDF"
 * both dead-end. Serving the rendered HTML over 127.0.0.1 and passing that
 * URL through `vscode.env.asExternalUri()` makes VS Code forward the port,
 * so the *local* browser can load the page normally.
 *
 * Lifecycle: one server per session, started on demand, bound to port 0 (the
 * OS picks a free port, so there is nothing to collide with), and closed after
 * an idle period. Nothing is written to disk on this path.
 */

const IDLE_SHUTDOWN_MS = 15 * 60 * 1000;
export const MAX_ENTRIES = 20;

interface ExportEntry {
  html: string;
  /** Directory the source document lives in — the root assets resolve against. */
  baseDir: string;
}

let server: http.Server | undefined;
let serverPort: number | undefined;
let starting: Promise<number> | undefined;
let idleTimer: NodeJS.Timeout | undefined;
const entries = new Map<string, ExportEntry>();

/** Paths under `/a/<token>/<encoded>` are asset requests; `/e/<token>` is the page. */
export function encodeAssetPath(p: string): string {
  return Buffer.from(p, 'utf8').toString('base64url');
}

export function decodeAssetPath(encoded: string): string {
  return Buffer.from(encoded, 'base64url').toString('utf8');
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.html': 'text/html; charset=utf-8',
};

/**
 * Only files inside the document's own folder (or an open workspace folder)
 * may be served. The listener is loopback-only and every URL carries an
 * unguessable token, but this keeps a stray relative path from turning into
 * an arbitrary-file read.
 */
export function isAllowedAsset(target: string, baseDir: string): boolean {
  const roots = [baseDir, ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)];
  return roots.some((root) => {
    const rel = path.relative(root, target);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

function touchIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    disposeExportServer();
  }, IDLE_SHUTDOWN_MS);
  // Don't hold the extension host's event loop open on our account.
  idleTimer.unref?.();
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  touchIdleTimer();
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[0] === 'e' && parts[1]) {
    const entry = entries.get(parts[1]);
    if (!entry) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Export expired');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(entry.html);
    return;
  }

  if (parts[0] === 'a' && parts[1] && parts[2]) {
    const entry = entries.get(parts[1]);
    if (!entry) {
      res.writeHead(404).end();
      return;
    }
    let target: string;
    try {
      target = decodeAssetPath(parts[2]);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (!isAllowedAsset(target, entry.baseDir)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(target));
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(Buffer.from(bytes));
    } catch {
      res.writeHead(404).end();
    }
    return;
  }

  res.writeHead(404).end();
}

async function ensureServer(): Promise<number> {
  if (server && serverPort !== undefined) return serverPort;
  if (starting) return starting;

  starting = new Promise<number>((resolve, reject) => {
    const s = http.createServer((req, res) => {
      handleRequest(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    s.on('error', (err) => {
      server = undefined;
      serverPort = undefined;
      starting = undefined;
      reject(err);
    });
    // Port 0 → the OS assigns a free port, so collisions can't happen.
    s.listen(0, '127.0.0.1', () => {
      const address = s.address();
      if (!address || typeof address === 'string') {
        s.close();
        starting = undefined;
        reject(new Error('Export server did not report a port'));
        return;
      }
      server = s;
      serverPort = address.port;
      starting = undefined;
      touchIdleTimer();
      resolve(address.port);
    });
  });

  return starting;
}

/**
 * Rewrite relative `src`/`href` values so assets load from this server rather
 * than from a `file://` path that only exists on the remote machine.
 * Absolute URLs, `#anchor` links, and data: URIs are left alone — anchors in
 * particular must keep working (exported TOC links).
 */
export function rewriteUrlsForServer(html: string, baseDir: string, token: string): string {
  const isAbsolute = (v: string): boolean =>
    /^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//') || v.startsWith('#') || v.startsWith('data:');
  return html.replace(
    /(\s(?:src|href)=)(["'])([^"']*)\2/gi,
    (match: string, attr: string, quote: string, value: string) => {
      if (!value || isAbsolute(value)) return match;
      const [rawPath, hash] = value.split('#');
      if (!rawPath) return match;
      const resolved = path.resolve(baseDir, decodeURIComponent(rawPath));
      const served = `/a/${token}/${encodeAssetPath(resolved)}${hash ? `#${hash}` : ''}`;
      return `${attr}${quote}${served}${quote}`;
    }
  );
}

/**
 * Register a rendered export and return the loopback URL that serves it.
 * The caller is expected to run the result through `vscode.env.asExternalUri`.
 */
export async function serveExport(
  buildHtml: (token: string) => string,
  baseDir: string
): Promise<vscode.Uri> {
  const port = await ensureServer();
  const token = randomBytes(16).toString('hex');
  entries.set(token, { html: buildHtml(token), baseDir });

  // Keep the map bounded — oldest first (Map preserves insertion order).
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }

  return vscode.Uri.parse(`http://127.0.0.1:${port}/e/${token}`);
}

/** Close the listener and drop every pending export. Safe to call repeatedly. */
export function disposeExportServer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
  entries.clear();
  const s = server;
  server = undefined;
  serverPort = undefined;
  if (s) s.close();
}
