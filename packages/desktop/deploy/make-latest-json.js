#!/usr/bin/env node
/**
 * Write the updater manifest (Tauri's static latest.json format).
 *
 *   node deploy/make-latest-json.js --version 0.2.0 --dir deploy/dist/0.2.0 \
 *     [--base-url https://www.iadev.net/mikedown/] [--notes-file notes.md] \
 *     [--pub-date 2026-10-23T12:00:00Z] [--out latest.json]
 *
 * Looks in --dir for the versioned artifacts release.sh stages:
 *   MikeDown-<v>-macos-universal.app.tar.gz(.sig)   updater payload, both darwin keys
 *   MikeDown-<v>-macos-universal.dmg                website download
 *   MikeDown-<v>-windows-x64-setup.exe(.sig)        updater payload and website download
 * A platform whose files are missing is left out (a Mac-only release keeps
 * the previous Windows entry only if you merge by hand; see deploy/README.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeLatestJson } from './lib/release-lib.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const version = args.version;
const dir = args.dir;
if (!version || !dir) {
  console.error('usage: make-latest-json.js --version x.y.z --dir <staging dir> [--base-url URL] [--notes-file F] [--pub-date ISO] [--out F]');
  process.exit(2);
}
const baseUrl = args['base-url'] ?? 'https://www.iadev.net/mikedown/';
const notes = args['notes-file'] ? fs.readFileSync(args['notes-file'], 'utf8').trim() : '';
const pubDate = args['pub-date'] ?? new Date().toISOString();

const names = {
  macTar: `MikeDown-${version}-macos-universal.app.tar.gz`,
  dmg: `MikeDown-${version}-macos-universal.dmg`,
  win: `MikeDown-${version}-windows-x64-setup.exe`,
};
const has = (f) => fs.existsSync(path.join(dir, f));
const sig = (f) => fs.readFileSync(path.join(dir, `${f}.sig`), 'utf8').trim();
const size = (f) => fs.statSync(path.join(dir, f)).size;

const mac = has(names.macTar) && has(`${names.macTar}.sig`) ? { file: names.macTar, signature: sig(names.macTar) } : null;
const windows = has(names.win) && has(`${names.win}.sig`) ? { file: names.win, signature: sig(names.win) } : null;
const manifest = makeLatestJson({
  version, notes, pubDate, baseUrl, mac, windows,
  downloads: {
    mac: has(names.dmg) ? { file: names.dmg, size: size(names.dmg), minimumOs: 'macOS 12 Monterey' } : null,
    windows: windows ? { file: names.win, size: size(names.win), minimumOs: 'Windows 10 version 1809' } : null,
  },
});
const out = args.out ?? path.join(dir, 'latest.json');
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${out}: ${Object.keys(manifest.platforms).join(', ')}`);
