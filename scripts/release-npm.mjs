// Release the public @mikedown/* npm packages (core first, then the rest).
//
//   npm run release:npm                          dry run of every public package (publishes nothing)
//   npm run release:npm -- --only core,react     only those packages (@mikedown/ prefix optional)
//   npm run release:npm -- --pack                also write tarballs to the share (or the fallback folder)
//   npm run release:npm -- --publish [--otp 123456]
//
// Default is a dry run: build, `npm pack --dry-run`, print the file list. Nothing
// is published and nothing is written. --publish publishes with `--access public`
// (`--tag rc` for prereleases). If `npm whoami` fails, --publish packs instead,
// like the old release-core.sh. A package whose version is already on npm is skipped.
// packages/angular (when present) is built with its own lockfile and published from dist.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, accessSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { ROOT, buildPackage, discoverPackages, run } from './lib/npm-packages.mjs';

const SHARE = '/Volumes/Storage/LymeStack/packages/npm';
const FALLBACK = join(ROOT, '.orchestrator', 'wrappers-npm-plan', 'artifacts');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) {
    console.error(`release-npm: ${name} needs a value`);
    process.exit(1);
  }
  return v;
};

const known = new Set(['--only', '--dry-run', '--publish', '--otp', '--pack']);
const valued = new Set(['--only', '--otp']);
for (let i = 0; i < argv.length; i++) {
  if (valued.has(argv[i])) {
    i++;
    continue;
  }
  if (!known.has(argv[i])) {
    console.error(`release-npm: unknown argument "${argv[i]}"`);
    process.exit(1);
  }
}

const publish = flag('--publish');
if (publish && flag('--dry-run')) {
  console.error('release-npm: --publish and --dry-run conflict');
  process.exit(1);
}
const otp = value('--otp');
const onlyArg = value('--only');
const only = onlyArg ? onlyArg.split(',').map((s) => s.trim().replace(/^@mikedown\//, '')) : null;

let packages = discoverPackages();
if (only) {
  const missing = only.filter((n) => !packages.some((p) => p.folder === n));
  if (missing.length) {
    console.error(`release-npm: no public package named: ${missing.join(', ')}. Have: ${packages.map((p) => p.folder).join(', ')}`);
    process.exit(1);
  }
  packages = packages.filter((p) => only.includes(p.folder));
}
if (!packages.length) {
  console.error('release-npm: no public packages found');
  process.exit(1);
}

const whoami = run('npm', ['whoami']);
const loggedIn = whoami.status === 0;
const user = loggedIn ? whoami.stdout.trim() : null;
const mode = publish ? (loggedIn ? 'publish' : 'pack') : flag('--pack') ? 'dry-run + pack' : 'dry run';
console.log(`Mode: ${mode}${loggedIn ? ` (npm user: ${user})` : ' (not logged in to npm)'}`);
if (publish && !loggedIn) console.log('Not logged in, so --publish will pack instead of publishing. Run `npm login` first to publish.');

/** true / false, or throws when the registry could not be queried. */
function onNpm(name, version) {
  const r = run('npm', ['view', `${name}@${version}`, 'version', '--json']);
  if (r.status === 0 && r.stdout.trim()) return true;
  if (/E404|404 Not Found|is not in this registry/.test(`${r.stderr}${r.stdout}`)) return false;
  throw new Error(`could not query npm for ${name}@${version}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
}

function fmt(n) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function printPack(pkg) {
  const r = run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: pkg.publishDir });
  if (r.status !== 0) throw new Error(`npm pack --dry-run failed for ${pkg.name}:\n${r.stderr}`);
  const info = JSON.parse(r.stdout)[0];
  console.log(`  Files in ${info.filename}:`);
  for (const f of info.files) console.log(`    ${fmt(f.size).padStart(10)}  ${f.path}`);
  console.log(`  ${info.entryCount} files, packed ${fmt(info.size)}, unpacked ${fmt(info.unpackedSize)}`);
}

function packToShare(pkg) {
  const tmp = mkdtempSync(join(tmpdir(), 'mikedown-pack-'));
  try {
    const r = run('npm', ['pack', '--pack-destination', tmp], { cwd: pkg.publishDir, stdio: ['ignore', 'pipe', 'inherit'] });
    if (r.status !== 0) throw new Error(`npm pack failed for ${pkg.name}`);
    const tgz = readdirSync(tmp).find((f) => f.endsWith('.tgz'));
    let dest = FALLBACK;
    try {
      accessSync(SHARE, constants.W_OK);
      dest = SHARE;
    } catch {
      console.log(`  Share ${SHARE} is not writable. Using ${FALLBACK}`);
    }
    mkdirSync(dest, { recursive: true });
    copyFileSync(join(tmp, tgz), join(dest, basename(tgz)));
    console.log(`  Packed ${tgz} to ${dest}/ (not published)`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const results = [];
for (const pkg of packages) {
  console.log(`\n== ${pkg.name} (folder packages/${pkg.folder}) ==`);
  let state;
  try {
    let already;
    try {
      already = onNpm(pkg.name, pkg.version);
    } catch (e) {
      if (publish && loggedIn) throw e;
      console.log(`  Warning: ${e.message}. Assuming it is not published.`);
      already = false;
    }
    if (already) {
      console.log(`  ${pkg.name}@${pkg.version} is already on npm. Skipping.`);
      results.push([pkg.name, pkg.version, 'skipped (already on npm)']);
      continue;
    }

    console.log('  Building');
    buildPackage(pkg);
    if (!existsSync(join(pkg.publishDir, 'package.json'))) {
      throw new Error(`${pkg.publishDir}/package.json is missing after the build`);
    }
    printPack(pkg);

    const prerelease = pkg.version.includes('-');
    const tagArgs = prerelease ? ['--tag', 'rc'] : [];
    if (publish && loggedIn) {
      const args = ['publish', '--access', 'public', ...tagArgs];
      if (otp) args.push('--otp', otp);
      console.log(`  npm ${args.join(' ')}  (in ${pkg.publishDir})`);
      const r = run('npm', args, { cwd: pkg.publishDir, stdio: 'inherit' });
      if (r.status !== 0) throw new Error(`npm publish failed for ${pkg.name}`);
      state = `published${prerelease ? ' (tag rc)' : ''}`;
    } else if (publish || flag('--pack')) {
      packToShare(pkg);
      state = 'packed';
    } else {
      state = 'dry run (nothing published)';
    }
    results.push([pkg.name, pkg.version, state]);
  } catch (e) {
    console.error(`\nrelease-npm: ${e.message}`);
    if (results.length) {
      console.error('Completed before the failure:');
      for (const [n, v, s] of results) console.error(`  ${n}@${v}: ${s}`);
    }
    process.exit(1);
  }
}

console.log('\nSummary');
for (const [n, v, s] of results) console.log(`  ${n}@${v}: ${s}`);
if (!publish) console.log('\nNothing was published. To publish: npm run release:npm -- --publish (after `npm login`).');
