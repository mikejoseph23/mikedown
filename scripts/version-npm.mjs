// Sets one version on every public @mikedown/* package (lockstep family) and
// points each wrapper's @mikedown/core peer (and devDependency) at ^<version>.
// Refuses a version lower than the current one.
//
//   node scripts/version-npm.mjs 0.2.0-rc.0 [--dry-run] [--no-lock]
import { readFileSync, writeFileSync } from 'node:fs';
import { CORE_NAME, compareSemver, discoverPackages, parseSemver, run } from './lib/npm-packages.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const noLock = args.includes('--no-lock');
const version = args.find((a) => !a.startsWith('--'));

function fail(msg) {
  console.error(`version-npm: ${msg}`);
  process.exit(1);
}

if (!version) fail('usage: version-npm.mjs <version> [--dry-run] [--no-lock]');
if (!parseSemver(version)) fail(`"${version}" is not a valid semver version`);

const packages = discoverPackages();
if (!packages.length) fail('no public packages found under packages/*');

const current = packages.map((p) => p.version).reduce((a, b) => (compareSemver(a, b) >= 0 ? a : b));
if (compareSemver(version, current) < 0) {
  fail(`${version} is lower than the current version ${current}. Versions only go up.`);
}

const range = `^${version}`;
for (const pkg of packages) {
  const raw = readFileSync(pkg.manifest, 'utf8');
  const json = JSON.parse(raw);
  const notes = [];
  if (json.version !== version) notes.push(`version ${json.version} -> ${version}`);
  json.version = version;
  if (json.name !== CORE_NAME) {
    for (const field of ['peerDependencies', 'devDependencies']) {
      if (json[field]?.[CORE_NAME] !== undefined && json[field][CORE_NAME] !== range) {
        notes.push(`${field}.${CORE_NAME} ${json[field][CORE_NAME]} -> ${range}`);
        json[field][CORE_NAME] = range;
      }
    }
  }
  console.log(`${json.name}: ${notes.length ? notes.join('; ') : 'already up to date'}`);
  if (!dryRun) writeFileSync(pkg.manifest, JSON.stringify(json, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
}

if (dryRun) {
  console.log('Dry run: nothing written.');
} else if (!noLock) {
  // Keep the root lockfile's workspace entries in step.
  const lock = run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {
    stdio: 'inherit',
  });
  if (lock.status !== 0) console.warn('version-npm: lockfile refresh failed; run `npm install` by hand.');
}
console.log(`Family version: ${version}`);
