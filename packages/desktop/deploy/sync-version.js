#!/usr/bin/env node
/**
 * Keep the desktop app's version in sync across package.json,
 * src-tauri/tauri.conf.json, src-tauri/Cargo.toml and Cargo.lock.
 *
 *   node deploy/sync-version.js --check          exit 1 if any differ
 *   node deploy/sync-version.js patch|minor|major bump from package.json
 *   node deploy/sync-version.js 1.2.3            set explicitly
 *
 * Prints the resulting version on the last line of stdout.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bumpVersion, readJsonVersion, setCargoLockVersion, setCargoVersion, setJsonVersion, versionReport,
} from './lib/release-lib.js';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = {
  packageJson: path.join(pkgDir, 'package.json'),
  tauriConf: path.join(pkgDir, 'src-tauri', 'tauri.conf.json'),
  cargoToml: path.join(pkgDir, 'src-tauri', 'Cargo.toml'),
  cargoLock: path.join(pkgDir, 'src-tauri', 'Cargo.lock'),
};
const read = () => Object.fromEntries(Object.entries(files).map(([k, f]) => [k, fs.readFileSync(f, 'utf8')]));

const arg = process.argv[2];
if (!arg || arg === '-h' || arg === '--help') {
  console.log('usage: sync-version.js --check | patch | minor | major | x.y.z');
  process.exit(arg ? 0 : 2);
}

const texts = read();
if (arg === '--check') {
  const r = versionReport(texts);
  if (r.mismatches.length) {
    for (const m of r.mismatches) {console.error(`version mismatch: ${m}`);}
    process.exit(1);
  }
  console.log(r.version);
  process.exit(0);
}

const next = bumpVersion(readJsonVersion(texts.packageJson), arg);
fs.writeFileSync(files.packageJson, setJsonVersion(texts.packageJson, next));
fs.writeFileSync(files.tauriConf, setJsonVersion(texts.tauriConf, next));
fs.writeFileSync(files.cargoToml, setCargoVersion(texts.cargoToml, next));
fs.writeFileSync(files.cargoLock, setCargoLockVersion(texts.cargoLock, 'mikedown-desktop', next));
const after = versionReport(read(), next);
if (after.mismatches.length) {
  for (const m of after.mismatches) {console.error(`version mismatch after sync: ${m}`);}
  process.exit(1);
}
console.log(next);
