#!/usr/bin/env node
/**
 * Gate on a staged upload folder: is it exactly what should go live?
 *
 *   node deploy/check-upload.js --dir deploy/dist/0.2.0/upload --version 0.2.0 \
 *     [--platforms mac,windows | mac | windows] [--base-url URL] [--pubkey B64]
 *
 * Fails (exit 1, one line per problem) unless: the folder is flat; index.html
 * and a comment-free web.config are there; the shipped platforms' per-target
 * manifests announce this version; latest.json is there for a full release
 * and NOT there for a split one; every URL in every manifest names a file in
 * the folder whose size, sha256 and minisign signature (against the
 * tauri.conf.json pubkey, with the signed version) match; every image
 * index.html shows is there; and nothing else is in the folder. release.sh runs it after staging, pack-for-lymedeploy.sh
 * before packing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlatforms } from './lib/release-lib.js';
import { checkStagedUpload } from './lib/publish-checks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
if (!args.dir || !args.version) {
  console.error('usage: check-upload.js --dir <upload dir> --version x.y.z [--platforms mac,windows] [--base-url URL] [--pubkey B64]');
  process.exit(2);
}
const platforms = parsePlatforms(args.platforms);
const pubkey = args.pubkey
  ?? JSON.parse(fs.readFileSync(path.join(here, '..', 'src-tauri', 'tauri.conf.json'), 'utf8')).plugins.updater.pubkey;
const files = {};
const dirs = [];
for (const ent of fs.readdirSync(args.dir, { withFileTypes: true })) {
  if (ent.name === '.DS_Store') {continue;}
  if (ent.isDirectory()) {dirs.push(ent.name);}
  else if (ent.isFile()) {files[ent.name] = fs.readFileSync(path.join(args.dir, ent.name));}
}
const problems = checkStagedUpload({
  version: args.version, platforms, files, dirs, pubkey,
  baseUrl: args['base-url'] ?? 'https://www.iadev.net/mikedown/',
});
if (problems.length) {
  console.error(`Staged folder ${args.dir} is NOT safe to publish:`);
  for (const p of problems) {console.error(`  - ${p}`);}
  process.exit(1);
}
console.log(`Staged folder OK: ${Object.keys(files).length} files, every manifest URL present, sizes, hashes and signatures match (${args.version}, ${platforms.mac && platforms.windows ? 'full' : platforms.mac ? 'mac-only' : 'windows-only'}).`);
