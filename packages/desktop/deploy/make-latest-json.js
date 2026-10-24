#!/usr/bin/env node
/**
 * Write the updater manifests (Tauri's static format) for one release.
 *
 *   node deploy/make-latest-json.js --version 0.2.0 --dir deploy/dist/0.2.0 \
 *     [--platforms mac,windows | mac | windows] [--out-dir DIR] \
 *     [--base-url https://www.iadev.net/mikedown/] [--notes-file notes.md] \
 *     [--pub-date 2026-10-23T12:00:00Z] [--pubkey <base64>]
 *
 * Reads the versioned artifacts release.sh stages in --dir:
 *   MikeDown-<v>-macos-universal.app.tar.gz(.sig)   updater payload, both darwin keys
 *   MikeDown-<v>-macos-universal.dmg                website download
 *   MikeDown-<v>-windows-x64-setup.exe(.sig)        updater payload and website download
 *
 * Writes into --out-dir (default --dir):
 *   latest-darwin-aarch64.json, latest-darwin-x86_64.json   when mac ships
 *   latest-windows-x86_64.json                              when windows ships
 *   latest.json                                             only when BOTH ship
 * and deletes any of those names the release must not publish, so a stale
 * file from an earlier run can never be uploaded (split-release rule, see
 * lib/release-lib.js).
 *
 * Every .sig is verified first, against the pubkey in src-tauri/tauri.conf.json
 * (or --pubkey), and must carry the signed version (`version:<v>` in its
 * trusted comment). Nothing is written if one fails.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_MANIFESTS, parsePlatforms, planManifests } from './lib/release-lib.js';
import { verifySignature } from './lib/minisign.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const fail = (msg) => { console.error(`make-latest-json: ${msg}`); process.exit(1); };
const { version, dir } = args;
if (!version || !dir) {
  console.error('usage: make-latest-json.js --version x.y.z --dir <staging dir> [--platforms mac,windows] [--out-dir D] [--base-url URL] [--notes-file F] [--pub-date ISO] [--pubkey B64]');
  process.exit(2);
}
let want;
try { want = parsePlatforms(args.platforms); } catch (e) { fail(e.message); }
const outDir = args['out-dir'] ?? dir;
const baseUrl = args['base-url'] ?? 'https://www.iadev.net/mikedown/';
const notes = args['notes-file'] ? fs.readFileSync(args['notes-file'], 'utf8').trim() : '';
const pubDate = args['pub-date'] ?? new Date().toISOString();
const pubkey = args.pubkey
  ?? JSON.parse(fs.readFileSync(path.join(here, '..', 'src-tauri', 'tauri.conf.json'), 'utf8')).plugins.updater.pubkey;

const names = {
  macTar: `MikeDown-${version}-macos-universal.app.tar.gz`,
  dmg: `MikeDown-${version}-macos-universal.dmg`,
  win: `MikeDown-${version}-windows-x64-setup.exe`,
};
const p = (f) => path.join(dir, f);
const has = (f) => fs.existsSync(p(f));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Read, hash and verify one updater payload; dies on any problem. */
function artifact(file) {
  if (!has(file)) {fail(`${file} is missing from ${dir}`);}
  if (!has(`${file}.sig`)) {fail(`${file}.sig is missing from ${dir} (sign it with tauri signer sign --app-version ${version})`);}
  const data = fs.readFileSync(p(file));
  const signature = fs.readFileSync(p(`${file}.sig`), 'utf8').trim();
  try {
    const ok = verifySignature({ data, signature, pubkey, version });
    console.log(`  ${file}: signature OK (key ${ok.keyId}, signed version ${ok.signedVersion})`);
  } catch (e) {
    fail(`${file}.sig refused: ${e.message}`);
  }
  return { file, signature, sha256: sha256(data), size: data.length };
}

function download(file, minimumOs) {
  if (!has(file)) {fail(`${file} is missing from ${dir}`);}
  const data = fs.readFileSync(p(file));
  return { file, size: data.length, sha256: sha256(data), minimumOs };
}

const mac = want.mac ? artifact(names.macTar) : null;
const windows = want.windows ? artifact(names.win) : null;
const downloads = {
  mac: want.mac ? download(names.dmg, 'macOS 12 Monterey') : null,
  windows: windows ? { file: windows.file, size: windows.size, sha256: windows.sha256, minimumOs: 'Windows 10 version 1809' } : null,
};

let plan;
try { plan = planManifests({ version, notes, pubDate, baseUrl, mac, windows, downloads }); } catch (e) { fail(e.message); }

fs.mkdirSync(outDir, { recursive: true });
for (const name of ALL_MANIFESTS) {
  const target = path.join(outDir, name);
  if (!(name in plan.files) && fs.existsSync(target)) {
    fs.rmSync(target);
    console.log(`  removed stale ${name} (this release must not publish it)`);
  }
}
for (const [name, manifest] of Object.entries(plan.files)) {
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`  wrote ${name}: ${Object.keys(manifest.platforms).join(', ')}`);
}
console.log(plan.full
  ? `Full release ${version}: per-target manifests and latest.json.`
  : `Split release ${version} (${want.mac ? 'mac' : 'windows'} only): latest.json is NOT written and must stay as published.`);
