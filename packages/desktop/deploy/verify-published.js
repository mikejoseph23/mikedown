#!/usr/bin/env node
/**
 * After a publish: is what the internet sees what the release meant?
 * (verify-published.sh is the entry point; this is the work.)
 *
 *   node deploy/verify-published.js --version 0.2.0 [--platforms mac,windows|mac|windows]
 *     [--base-url https://www.iadev.net/mikedown/]     the URL prefix manifests carry
 *     [--www https://www.iadev.net/mikedown/]          where to fetch from (www form)
 *     [--apex https://iadev.net/mikedown/]             where to fetch from (apex form)
 *     [--pubkey <base64>]                              default: src-tauri/tauri.conf.json
 *
 * For every manifest (latest-darwin-aarch64.json, latest-darwin-x86_64.json,
 * latest-windows-x86_64.json, latest.json):
 *   - fetch it four ways: www and apex, each with a cache buster (the origin)
 *     and without one (what an updater gets from Cloudflare's edge), following
 *     redirects; all four must be byte-identical, so a stale edge copy or a
 *     www/apex split fails here instead of in the field;
 *   - shape: Tauri static format, the right single platform key for a
 *     per-target file, https URLs under --base-url carrying the version;
 *   - version: the shipped platforms' files and (full release) latest.json
 *     must announce --version; a split release requires latest.json to still
 *     be there and valid at its older version; an unshipped platform's file
 *     may be absent (placeholder rule) but must be valid if present;
 *   - each artifact: HEAD answers 200 with a Content-Length equal to the
 *     manifest's size, then GET it and check size, sha256 and the minisign
 *     signature against the pubkey, including the signed version.
 * Exit 0 only when everything passes; every failure is listed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_MANIFESTS, checkManifestShape, parsePlatforms } from './lib/release-lib.js';
import { checkArtifactBytes, fileForUrl, manifestExpectations } from './lib/publish-checks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
if (!args.version) {
  console.error('usage: verify-published.js --version x.y.z [--platforms mac,windows] [--base-url U] [--www U] [--apex U] [--pubkey B64]');
  process.exit(2);
}
const slash = (u) => (u.endsWith('/') ? u : `${u}/`);
const version = args.version;
const platforms = parsePlatforms(args.platforms);
const baseUrl = slash(args['base-url'] ?? 'https://www.iadev.net/mikedown/');
const www = slash(args.www ?? baseUrl);
const apex = slash(args.apex ?? 'https://iadev.net/mikedown/');
const pubkey = args.pubkey
  ?? JSON.parse(fs.readFileSync(path.join(here, '..', 'src-tauri', 'tauri.conf.json'), 'utf8')).plugins.updater.pubkey;
const timeoutMs = Number(process.env.MIKEDOWN_VERIFY_TIMEOUT_MS ?? 60000);

const problems = [];
const ok = (s) => console.log(`  ok    ${s}`);
const bad = (s) => { problems.push(s); console.log(`  FAIL  ${s}`); };

async function get(url, { method = 'GET', bust = false } = {}) {
  const u = bust ? `${url}${url.includes('?') ? '&' : '?'}cb=${Date.now()}${Math.random().toString(36).slice(2, 8)}` : url;
  const res = await fetch(u, {
    method, redirect: 'follow', cache: 'no-store',
    headers: { 'User-Agent': 'mikedown-verify-published' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, body, finalUrl: res.url };
}

/** Fetch a manifest four ways; returns { status, body } of the www cache-busted copy (the origin). */
async function fetchManifest(name) {
  const variants = [
    ['www, cache-busted', www + name, true],
    ['www, as clients fetch it', www + name, false],
    ['apex, cache-busted', apex + name, true],
    ['apex, as clients fetch it', apex + name, false],
  ];
  const got = [];
  for (const [label, url, bust] of variants) {
    try {
      got.push({ label, ...(await get(url, { bust })) });
    } catch (e) {
      got.push({ label, status: 0, body: Buffer.alloc(0), error: e.message });
    }
  }
  const origin = got[0];
  for (const g of got.slice(1)) {
    if (g.error) {bad(`${name} (${g.label}): ${g.error}`); continue;}
    if (g.status !== origin.status) {bad(`${name}: ${g.label} answered ${g.status}, www cache-busted answered ${origin.status}`); continue;}
    if (origin.status === 200 && !g.body.equals(origin.body)) {
      bad(`${name}: ${g.label} differs from the origin copy (stale edge cache: purge both www and apex, then re-run)`);
    }
  }
  if (origin.error) {bad(`${name}: ${origin.error}`);}
  return origin;
}

const artifactCache = new Map();
async function checkArtifact(where, entry, signedVersion) {
  const file = fileForUrl(entry.url, baseUrl);
  if (!file) {bad(`${where}: ${entry.url} is outside ${baseUrl}`); return;}
  const url = www + encodeURIComponent(file);
  let head;
  try { head = await get(url, { method: 'HEAD' }); } catch (e) { bad(`${where}: HEAD ${url}: ${e.message}`); return; }
  if (head.status !== 200) {bad(`${where}: HEAD ${url} answered ${head.status}`); return;}
  const len = Number(head.headers.get('content-length'));
  if (entry.size !== undefined && len !== entry.size) {bad(`${where}: HEAD Content-Length ${head.headers.get('content-length')}, manifest says ${entry.size}`);}
  if (!artifactCache.has(url)) {
    try {
      const r = await get(url);
      artifactCache.set(url, r.status === 200 ? r.body : new Error(`GET answered ${r.status}`));
    } catch (e) { artifactCache.set(url, e); }
  }
  const data = artifactCache.get(url);
  if (data instanceof Error) {bad(`${where}: ${url}: ${data.message}`); return;}
  const p = checkArtifactBytes({ where, entry, data, pubkey, version: signedVersion });
  if (p.length) {p.forEach(bad);} else {ok(`${where}: ${file} 200, ${data.length} bytes${entry.signature ? ', signature and signed version OK' : ''}${entry.sha256 ? ', sha256 OK' : ''}`);}
}

console.log(`Verifying MikeDown ${version} (${platforms.mac && platforms.windows ? 'full release' : platforms.mac ? 'mac only' : 'windows only'})`);
console.log(`  www  ${www}\n  apex ${apex}\n`);
const expect = manifestExpectations({ platforms, stage: false });
for (const name of ALL_MANIFESTS) {
  const rule = expect[name];
  console.log(`${name} (${rule === 'version' ? `must be ${version}` : rule === 'any' ? 'must stay published' : 'optional'})`);
  const origin = await fetchManifest(name);
  if (origin.status === 404 && rule === 'optional') {ok(`${name}: not published (placeholder rule; falls through to latest.json)`); continue;}
  if (origin.status !== 200) {bad(`${name}: www cache-busted answered ${origin.status}`); continue;}
  let m;
  try { m = JSON.parse(origin.body.toString('utf8')); } catch (e) { bad(`${name}: not JSON (${e.message})`); continue; }
  const shape = checkManifestShape(name, m, { expectVersion: rule === 'version' ? version : undefined, baseUrl });
  if (shape.length) {shape.forEach(bad);} else {ok(`${name}: version ${m.version}, ${Object.keys(m.platforms).join(', ')}`);}
  for (const [key, entry] of Object.entries(m.platforms ?? {})) {
    if (entry?.url) {await checkArtifact(`${name} ${key}`, entry, m.version);}
  }
  for (const [k, d] of Object.entries(m.downloads ?? {})) {
    if (d?.url) {await checkArtifact(`${name} downloads.${k}`, { url: d.url, size: d.size, sha256: d.sha256 }, m.version);}
  }
}

console.log('');
if (problems.length) {
  console.log(`FAILED: ${problems.length} problem(s). The release is not safe to call published.`);
  process.exit(1);
}
console.log(`PASSED: every manifest agrees across www/apex and edge/origin, and every artifact is served with the right size, hash and signature.`);
