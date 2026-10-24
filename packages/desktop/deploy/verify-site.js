#!/usr/bin/env node
/**
 * Post-publish check for a site-only release. Read-only: it only fetches.
 *
 *   node deploy/verify-site.js --dir <staged site folder> --desktop-version 0.3.0 [--base-url URL]
 *
 * For every staged file: GET <base-url><path> (cache-busted) must answer 200 with
 * identical bytes. Then latest.json must still announce the desktop version
 * (a site release must never move it).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
if (!args.dir || !args['desktop-version']) {
  console.error('usage: verify-site.js --dir <staged site folder> --desktop-version x.y.z [--base-url URL]');
  process.exit(2);
}
const base = (args['base-url'] ?? 'https://www.iadev.net/mikedown/').replace(/\/?$/, '/');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const problems = [];
const staged = [];
const walk = (dir) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {walk(full);} else if (ent.isFile()) {staged.push(path.relative(args.dir, full).split(path.sep).join('/'));}
  }
};
walk(args.dir);
for (const rel of staged) {
  const res = await fetch(`${base}${rel}?cb=${Date.now()}`, { cache: 'no-store' });
  if (res.status !== 200) {problems.push(`${rel}: HTTP ${res.status}`); continue;}
  const got = Buffer.from(await res.arrayBuffer());
  if (sha(got) !== sha(fs.readFileSync(path.join(args.dir, rel)))) {problems.push(`${rel}: served bytes differ from the staged file (stale edge cache?)`);}
}
const latest = await fetch(`${base}latest.json?cb=${Date.now()}`, { cache: 'no-store' });
const served = latest.status === 200 ? (await latest.json()).version : `HTTP ${latest.status}`;
if (served !== args['desktop-version']) {problems.push(`latest.json announces ${served}, expected ${args['desktop-version']} (a site release must not move it)`);}
if (problems.length) {
  console.error('Site verification FAILED:');
  for (const p of problems) {console.error(`  - ${p}`);}
  process.exit(1);
}
console.log(`Site verified: ${staged.length} files served identically; latest.json still ${served}.`);
