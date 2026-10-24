// Shared helpers for the npm family scripts (version-npm, release-npm, build-npm)
// and the package-shape test. Packages are found by globbing
// packages/*/package.json, not by `npm query .workspace`, because
// packages/angular is deliberately outside the root workspaces (own lockfile,
// published from packages/angular/dist).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CORE_NAME = '@mikedown/core';
/** Folders under packages/ that are not root workspaces. */
const NON_WORKSPACE = new Set(['angular']);

export function discoverPackages({ includePrivate = false } = {}) {
  const pkgsDir = join(ROOT, 'packages');
  const found = [];
  for (const folder of readdirSync(pkgsDir, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    const dirPath = join(pkgsDir, folder.name);
    const manifest = join(dirPath, 'package.json');
    if (!existsSync(manifest)) continue;
    const json = JSON.parse(readFileSync(manifest, 'utf8'));
    if (json.private && !includePrivate) continue;
    const nonWorkspace = NON_WORKSPACE.has(folder.name);
    found.push({
      folder: folder.name,
      dirPath,
      manifest,
      json,
      name: json.name,
      version: json.version,
      nonWorkspace,
      // ng-packagr writes dist/package.json, so angular publishes from dist.
      publishDir: nonWorkspace ? join(dirPath, 'dist') : dirPath,
    });
  }
  // Core first (wrappers peer on it), then the rest alphabetically.
  found.sort((a, b) => (a.name === CORE_NAME ? -1 : b.name === CORE_NAME ? 1 : a.name.localeCompare(b.name)));
  return found;
}

export function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
}

/** Build one package. Packages without a build script are skipped. */
export function buildPackage(pkg) {
  if (pkg.nonWorkspace) {
    if (!existsSync(join(pkg.dirPath, 'node_modules'))) {
      console.log(`  npm ci --prefix packages/${pkg.folder}`);
      const ci = run('npm', ['ci', '--prefix', pkg.dirPath], { stdio: 'inherit' });
      if (ci.status !== 0) throw new Error(`npm ci failed for ${pkg.name}`);
    }
    if (!pkg.json.scripts?.build) return;
    const b = run('npm', ['run', 'build', '--prefix', pkg.dirPath], { stdio: 'inherit' });
    if (b.status !== 0) throw new Error(`build failed for ${pkg.name}`);
    return;
  }
  if (!pkg.json.scripts?.build) return;
  const b = run('npm', ['run', 'build', '-w', `packages/${pkg.folder}`], { stdio: 'inherit' });
  if (b.status !== 0) throw new Error(`build failed for ${pkg.name}`);
}

// ---- semver (enough for x.y.z and x.y.z-pre.N) ----

export function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] };
}

export function compareSemver(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  for (const k of ['major', 'minor', 'patch']) {
    if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  }
  if (!x.pre.length && !y.pre.length) return 0;
  if (!x.pre.length) return 1; // a release outranks its prereleases
  if (!y.pre.length) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return +p < +q ? -1 : 1;
    if (pn) return -1;
    if (qn) return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}
