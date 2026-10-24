/**
 * Pure helpers behind the release scripts (sync-version.js,
 * make-latest-json.js, check-core-pin.js). No I/O here, so
 * `test/unit/deploy.test.ts` covers them directly.
 */

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function isSemver(v) {
  return typeof v === 'string' && SEMVER.test(v);
}

/** `patch` / `minor` / `major`, or an explicit x.y.z. Prereleases bump to their release. */
export function bumpVersion(current, kind) {
  if (isSemver(kind)) {return kind;}
  const m = SEMVER.exec(current);
  if (!m) {throw new Error(`not a semver version: ${current}`);}
  let [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const pre = m[4];
  switch (kind) {
    case 'patch': if (!pre) {pat += 1;} break;
    case 'minor': min += 1; pat = 0; break;
    case 'major': maj += 1; min = 0; pat = 0; break;
    default: throw new Error(`unknown bump "${kind}" (patch, minor, major or x.y.z)`);
  }
  return `${maj}.${min}.${pat}`;
}

/** The first top-level `"version": "…"` in a JSON file, formatting kept. */
export function readJsonVersion(text) {
  const v = JSON.parse(text).version;
  if (typeof v !== 'string') {throw new Error('no top-level "version"');}
  return v;
}

export function setJsonVersion(text, version) {
  const current = readJsonVersion(text);
  // The top-level key is the first "version" at two-space indent in these files.
  const re = /^(\s{2}"version":\s*")([^"]*)(")/m;
  if (!re.test(text)) {throw new Error('could not find the top-level "version" line');}
  const out = text.replace(re, `$1${version}$3`);
  if (readJsonVersion(out) !== version) {throw new Error(`rewrote the wrong "version" (was ${current})`);}
  return out;
}

/** `version = "…"` inside the `[package]` table of Cargo.toml. */
export function readCargoVersion(toml) {
  const pkg = packageTable(toml);
  const m = /^version\s*=\s*"([^"]*)"/m.exec(pkg.body);
  if (!m) {throw new Error('no version in [package]');}
  return m[1];
}

export function setCargoVersion(toml, version) {
  const pkg = packageTable(toml);
  const body = pkg.body.replace(/^(version\s*=\s*")([^"]*)(")/m, `$1${version}$3`);
  return toml.slice(0, pkg.start) + body + toml.slice(pkg.end);
}

function packageTable(toml) {
  const head = /^\[package\]\s*$/m.exec(toml);
  if (!head) {throw new Error('no [package] table');}
  const start = head.index + head[0].length;
  const next = /^\[/m.exec(toml.slice(start));
  const end = next ? start + next.index : toml.length;
  return { start, end, body: toml.slice(start, end) };
}

/** The `[[package]] name = "<crate>"` entry in Cargo.lock. */
export function setCargoLockVersion(lock, crate, version) {
  const re = new RegExp(`(\\[\\[package\\]\\]\\nname = "${crate}"\\nversion = ")([^"]*)(")`);
  if (!re.test(lock)) {throw new Error(`no ${crate} entry in Cargo.lock`);}
  return lock.replace(re, `$1${version}$3`);
}

export function readCargoLockVersion(lock, crate) {
  const m = new RegExp(`\\[\\[package\\]\\]\\nname = "${crate}"\\nversion = "([^"]*)"`).exec(lock);
  return m ? m[1] : null;
}

/** Every version the release keeps in sync; `mismatches` lists the ones that differ from `expected`. */
export function versionReport(files, expected) {
  const found = {
    'package.json': readJsonVersion(files.packageJson),
    'tauri.conf.json': readJsonVersion(files.tauriConf),
    'Cargo.toml': readCargoVersion(files.cargoToml),
    'Cargo.lock': readCargoLockVersion(files.cargoLock, 'mikedown-desktop'),
  };
  const want = expected ?? found['package.json'];
  const mismatches = Object.entries(found).filter(([, v]) => v !== want).map(([k, v]) => `${k} has ${v}, expected ${want}`);
  return { version: want, found, mismatches };
}

// ── latest.json (Tauri updater "static" format) ──────────────────────────────

export const UPDATER_PLATFORMS = {
  mac: ['darwin-aarch64', 'darwin-x86_64'],
  windows: ['windows-x86_64'],
};

/**
 * Build the updater manifest. `mac` is the universal `.app.tar.gz` (both
 * darwin keys point at it); `windows` is the signed NSIS `.exe`. The
 * `downloads` block is for the website's buttons (the `.dmg` and the `.exe`);
 * the updater ignores fields it does not know.
 */
export function makeLatestJson({ version, notes, pubDate, baseUrl, mac, windows, downloads }) {
  if (!isSemver(version)) {throw new Error(`bad version: ${version}`);}
  if (!/^https:\/\//.test(baseUrl)) {throw new Error('baseUrl must be https');}
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = (file) => {
    if (!file.includes(version)) {throw new Error(`artifact name must carry the version (${version}): ${file}`);}
    return base + encodeURIComponent(file);
  };
  const platforms = {};
  const add = (keys, art) => {
    if (!art) {return;}
    const signature = String(art.signature ?? '').trim();
    if (!signature) {throw new Error(`missing signature for ${art.file}`);}
    for (const key of keys) {platforms[key] = { signature, url: url(art.file) };}
  };
  add(UPDATER_PLATFORMS.mac, mac);
  add(UPDATER_PLATFORMS.windows, windows);
  if (Object.keys(platforms).length === 0) {throw new Error('no platforms');}
  const manifest = {
    version,
    notes: notes ?? '',
    pub_date: new Date(pubDate).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    platforms,
  };
  if (downloads) {
    manifest.downloads = {};
    for (const [k, d] of Object.entries(downloads)) {
      if (d) {manifest.downloads[k] = { url: url(d.file), size: d.size, minimumOs: d.minimumOs };}
    }
  }
  return manifest;
}

// ── Core pinning ─────────────────────────────────────────────────────────────

/**
 * Release builds consume `@mikedown/core` as a published package. The pin in
 * packages/desktop/package.json must equal packages/core's version, and the
 * version must be on npm unless the build explicitly allows the workspace copy.
 */
export function checkCorePin({ pinned, coreVersion, published, allowUnpublished }) {
  const errors = [];
  if (!pinned) {errors.push('packages/desktop/package.json has no @mikedown/core dependency');}
  else if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pinned)) {
    errors.push(`@mikedown/core must be pinned to an exact version for a release, found "${pinned}"`);
  } else if (pinned !== coreVersion) {
    errors.push(`@mikedown/core is pinned to ${pinned} but packages/core/package.json is ${coreVersion}`);
  }
  const warnings = [];
  if (errors.length === 0 && !published) {
    if (allowUnpublished) {
      warnings.push(`@mikedown/core ${pinned} is not on npm; building against the workspace copy (packages/core/dist) because --allow-unpublished-core was given`);
    } else {
      errors.push(`@mikedown/core ${pinned} is not published on npm. Publish it first (npm run release:core), or pass --allow-unpublished-core to build against packages/core/dist`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
