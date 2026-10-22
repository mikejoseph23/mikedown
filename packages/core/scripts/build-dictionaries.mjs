#!/usr/bin/env node
/**
 * Copy the hunspell dictionaries (repo-root dictionaries/en and en-GB, each
 * with index.aff, index.dic and LICENSE) to packages/core/dist/dictionaries/.
 * Consumers copy that folder into their assets and pass its URL as the
 * `spellcheckDictionaryUrl` editor option.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.resolve(pkgDir, '..', '..', 'dictionaries');
const dest = path.join(pkgDir, 'dist', 'dictionaries');

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`build-dictionaries: ${path.relative(pkgDir, dest)} (${fs.readdirSync(dest).join(', ')})`);
