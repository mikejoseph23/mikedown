#!/usr/bin/env node
/**
 * Static file server for the Windows staging harness (no python on the box).
 * Binds 127.0.0.1 only. Logs one line per request in the same shape as
 * python's http.server, which the harness greps:
 *
 *   127.0.0.1 - - [date] "GET /fallback/latest.json HTTP/1.1" 200 -
 *
 *   node deploy/staging-serve.js --dir <folder> --port 18765 [--log <file>]
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
if (!args.dir || !args.port) {
  console.error('usage: staging-serve.js --dir <folder> --port <n> [--log <file>]');
  process.exit(2);
}
const root = path.resolve(args.dir);
const log = args.log ? fs.createWriteStream(args.log, { flags: 'a' }) : process.stdout;

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const file = path.resolve(root, `.${url}`);
    let status = 200;
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      status = 404;
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    } else {
      res.writeHead(200, { 'Content-Type': url.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'Content-Length': fs.statSync(file).size });
      fs.createReadStream(file).pipe(res);
    }
    log.write(`127.0.0.1 - - [${new Date().toISOString()}] "${req.method} ${url} HTTP/1.1" ${status} -\n`);
  })
  .listen(Number(args.port), '127.0.0.1', () => console.log(`serving ${root} on 127.0.0.1:${args.port}`));
