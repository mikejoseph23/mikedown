#!/usr/bin/env node
/**
 * Release gate for `@mikedown/core` (M10). A release build consumes core as a
 * published package, never the source alias:
 *
 *   - packages/desktop/package.json pins an exact `@mikedown/core` version,
 *   - a published pin (on npm, `npm view`) is fine even when the workspace
 *     core is ahead of it: the @mikedown/* family versions independently, and
 *     the release builds against the registry copy (a warning says so),
 *   - an unpublished pin must equal packages/core/package.json's version (the
 *     only copy a build could use) and needs `--allow-unpublished-core` to
 *     build against the workspace copy (packages/core/dist). Only for a core
 *     bump that is not on npm yet.
 *
 *   node deploy/check-core-pin.js [--allow-unpublished-core] [--offline]
 *
 * `--offline` skips the npm lookup and treats the version as unpublished.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCorePin } from './lib/release-lib.js';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const core = JSON.parse(fs.readFileSync(path.join(pkgDir, '..', 'core', 'package.json'), 'utf8'));
const pinned = desktop.dependencies?.['@mikedown/core'];
const allowUnpublished = process.argv.includes('--allow-unpublished-core');

let published = false;
if (!process.argv.includes('--offline') && pinned) {
  try {
    // Windows: npm is npm.cmd, which Node only runs through a shell.
    const win = process.platform === 'win32';
    const out = execFileSync(win ? 'npm.cmd' : 'npm', ['view', `@mikedown/core@${pinned}`, 'version', '--registry', 'https://registry.npmjs.org/'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000, shell: win,
    }).trim();
    published = out === pinned;
  } catch { published = false; }
}

const r = checkCorePin({ pinned, coreVersion: core.version, published, allowUnpublished });
for (const w of r.warnings) {console.warn(`warning: ${w}`);}
for (const e of r.errors) {console.error(`error: ${e}`);}
if (!r.ok) {process.exit(1);}
console.log(`@mikedown/core ${pinned} ${published ? '(published)' : '(workspace)'}`);
