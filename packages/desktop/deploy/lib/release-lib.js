/**
 * Pure helpers behind the release scripts (sync-version.js,
 * make-latest-json.js, check-core-pin.js, check-upload.js,
 * verify-published.js). No I/O here, so `test/unit/deploy.test.ts` and
 * `test/unit/release-pipeline.test.ts` cover them directly.
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
  const re = new RegExp(`(\\[\\[package\\]\\]\\r?\\nname = "${crate}"\\r?\\nversion = ")([^"]*)(")`);
  if (!re.test(lock)) {throw new Error(`no ${crate} entry in Cargo.lock`);}
  return lock.replace(re, `$1${version}$3`);
}

export function readCargoLockVersion(lock, crate) {
  const m = new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "${crate}"\\r?\\nversion = "([^"]*)"`).exec(lock);
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

// ── Updater manifests (Tauri updater "static" format) ────────────────────────
//
// Layout on https://www.iadev.net/mikedown/ (desktop-auto-update-plan.md,
// "Manifest and hosting layout"):
//
//   latest-darwin-aarch64.json   per target, one `platforms` entry each; what
//   latest-darwin-x86_64.json    0.2.0+ builds ask for first, through the
//   latest-windows-x86_64.json   plugin's `latest-{{target}}-{{arch}}.json`
//   latest.json                  legacy combined; the only URL 0.1.x knows
//
// Split-release rule: a Mac-only or Windows-only release writes only its own
// per-target files and never latest.json, so 0.1.x on the platform that did
// not ship sees no change (no TargetNotFound, no version it cannot install).
// latest.json moves only when both platforms ship the same version.
// Placeholder rule: a platform with no release has no file (404 falls through
// to latest.json), never an empty entry.

export const UPDATER_PLATFORMS = {
  mac: ['darwin-aarch64', 'darwin-x86_64'],
  windows: ['windows-x86_64'],
};

export const LEGACY_MANIFEST = 'latest.json';

/** `latest-<target>-<arch>.json`, the plugin's `{{target}}-{{arch}}` (darwin|windows, aarch64|x86_64). */
export const targetManifestName = (key) => `latest-${key}.json`;

/** Every manifest file name this pipeline can publish, legacy last. */
export const ALL_MANIFESTS = [
  ...Object.values(UPDATER_PLATFORMS).flat().map(targetManifestName),
  LEGACY_MANIFEST,
];

/** The platform (`mac` / `windows`) a manifest file belongs to, or null for latest.json. */
export function manifestPlatform(name) {
  for (const [platform, keys] of Object.entries(UPDATER_PLATFORMS)) {
    if (keys.some((k) => targetManifestName(k) === name)) {return platform;}
  }
  return null;
}

function manifestContext({ version, baseUrl, pubDate }) {
  if (!isSemver(version)) {throw new Error(`bad version: ${version}`);}
  if (!/^https:\/\//.test(baseUrl ?? '')) {throw new Error('baseUrl must be https');}
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = (file) => {
    if (!file.includes(version)) {throw new Error(`artifact name must carry the version (${version}): ${file}`);}
    return base + encodeURIComponent(file);
  };
  const date = new Date(pubDate);
  if (Number.isNaN(date.getTime())) {throw new Error(`bad pub date: ${pubDate}`);}
  return { url, pub_date: date.toISOString().replace(/\.\d{3}Z$/, 'Z') };
}

/** One `platforms` entry; `sha256` and `size` ride along when known (the plugin ignores them). */
function platformEntry(art, url, { requireHash }) {
  const signature = String(art.signature ?? '').trim();
  if (!signature) {throw new Error(`missing signature for ${art.file}`);}
  const entry = { signature, url: url(art.file) };
  if (requireHash || art.sha256 !== undefined || art.size !== undefined) {
    if (!/^[0-9a-f]{64}$/.test(String(art.sha256 ?? ''))) {throw new Error(`missing or bad sha256 for ${art.file}`);}
    if (!Number.isInteger(art.size) || art.size <= 0) {throw new Error(`missing or bad size for ${art.file}`);}
    entry.sha256 = art.sha256;
    entry.size = art.size;
  }
  return entry;
}

function downloadEntry(d, url) {
  const entry = { url: url(d.file), size: d.size, minimumOs: d.minimumOs };
  if (d.sha256) {entry.sha256 = d.sha256;}
  return entry;
}

/**
 * The legacy combined manifest. `mac` is the universal `.app.tar.gz` (both
 * darwin keys point at it); `windows` is the signed NSIS `.exe`. The
 * `downloads` block is for the website's buttons (the `.dmg` and the `.exe`);
 * the updater ignores fields it does not know.
 */
export function makeLatestJson({ version, notes, pubDate, baseUrl, mac, windows, downloads }) {
  const { url, pub_date } = manifestContext({ version, baseUrl, pubDate });
  const platforms = {};
  const add = (keys, art) => {
    if (!art) {return;}
    for (const key of keys) {platforms[key] = platformEntry(art, url, { requireHash: false });}
  };
  add(UPDATER_PLATFORMS.mac, mac);
  add(UPDATER_PLATFORMS.windows, windows);
  if (Object.keys(platforms).length === 0) {throw new Error('no platforms');}
  const manifest = { version, notes: notes ?? '', pub_date, platforms };
  if (downloads) {
    manifest.downloads = {};
    for (const [k, d] of Object.entries(downloads)) {
      if (d) {manifest.downloads[k] = downloadEntry(d, url);}
    }
  }
  return manifest;
}

/**
 * Per-target manifests: `{ 'latest-darwin-aarch64.json': {…}, … }`, one file
 * per updater key of each platform given, each with a single `platforms`
 * entry (with `sha256` and `size`) and that platform's website download.
 */
export function makeTargetManifests({ version, notes, pubDate, baseUrl, mac, windows, downloads }) {
  const { url, pub_date } = manifestContext({ version, baseUrl, pubDate });
  const out = {};
  for (const [platform, art] of Object.entries({ mac, windows })) {
    if (!art) {continue;}
    const entry = platformEntry(art, url, { requireHash: true });
    const download = downloads?.[platform];
    for (const key of UPDATER_PLATFORMS[platform]) {
      const m = { version, notes: notes ?? '', pub_date, platforms: { [key]: entry } };
      if (download) {m.downloads = { [platform]: downloadEntry(download, url) };}
      out[targetManifestName(key)] = m;
    }
  }
  if (Object.keys(out).length === 0) {throw new Error('no platforms');}
  return out;
}

/**
 * Every manifest a release writes, keyed by file name. `latest.json` only
 * when both platforms ship (the split-release rule). `full` says which
 * happened; `skipped` lists the manifest names this release must leave alone.
 */
export function planManifests(input) {
  const files = makeTargetManifests(input);
  const full = Boolean(input.mac && input.windows);
  if (full) {files[LEGACY_MANIFEST] = makeLatestJson(input);}
  const skipped = ALL_MANIFESTS.filter((n) => !(n in files));
  return { files, full, skipped };
}

/** `--platforms` / `--mac-only` / `--windows-only` → `{ mac, windows }` booleans. */
export function parsePlatforms(spec) {
  const parts = String(spec ?? 'mac,windows').split(',').map((s) => s.trim()).filter(Boolean);
  const bad = parts.filter((p) => !(p in UPDATER_PLATFORMS));
  if (bad.length || parts.length === 0) {throw new Error(`--platforms takes mac, windows or mac,windows (got "${spec}")`);}
  return { mac: parts.includes('mac'), windows: parts.includes('windows') };
}

/**
 * Structural checks on one published or staged manifest (no network, no
 * signature maths; the callers do those with the bytes). Returns a list of
 * problems, empty when fine.
 *
 *   name           file name (decides which `platforms` keys must be present)
 *   expectVersion  exact version required, or undefined for "any valid one"
 *   baseUrl        every URL must live under it
 */
export function checkManifestShape(name, m, { expectVersion, baseUrl } = {}) {
  const problems = [];
  const say = (s) => problems.push(`${name}: ${s}`);
  if (!m || typeof m !== 'object') {return [`${name}: not a JSON object`];}
  if (!isSemver(m.version)) {say(`bad or missing version ${JSON.stringify(m.version)}`);}
  if (expectVersion !== undefined && m.version !== expectVersion) {say(`version is ${m.version}, expected ${expectVersion}`);}
  if (typeof m.url === 'string' || typeof m.signature === 'string') {
    say('has a top-level url/signature (the plugin would read it as the dynamic format)');
  }
  const platforms = m.platforms && typeof m.platforms === 'object' ? m.platforms : null;
  if (!platforms) {return [...problems, `${name}: no platforms object`];}
  const platform = manifestPlatform(name);
  const keys = Object.keys(platforms);
  if (platform) {
    const expected = Object.values(UPDATER_PLATFORMS).flat().find((k) => targetManifestName(k) === name);
    if (keys.length !== 1 || keys[0] !== expected) {say(`platforms must be exactly ["${expected}"], found ${JSON.stringify(keys)}`);}
  } else {
    const known = Object.values(UPDATER_PLATFORMS).flat();
    for (const k of keys) {if (!known.includes(k)) {say(`unknown platform key ${k}`);}}
    if (keys.length === 0) {say('no platform entries');}
  }
  const base = baseUrl ? (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`) : null;
  const checkUrl = (where, u) => {
    if (typeof u !== 'string' || !/^https:\/\//.test(u)) {say(`${where} url is not https: ${u}`); return;}
    if (base && !u.startsWith(base)) {say(`${where} url is outside ${base}: ${u}`);}
    if (isSemver(m.version) && !decodeURIComponent(u.split('/').pop()).includes(m.version)) {
      say(`${where} url does not carry the version ${m.version}: ${u}`);
    }
  };
  for (const [k, e] of Object.entries(platforms)) {
    if (!e || typeof e !== 'object') {say(`${k} is not an object`); continue;}
    if (typeof e.signature !== 'string' || !e.signature.trim()) {say(`${k} has no signature`);}
    checkUrl(k, e.url);
    if (platform) {
      if (!/^[0-9a-f]{64}$/.test(String(e.sha256 ?? ''))) {say(`${k} has no sha256`);}
      if (!Number.isInteger(e.size) || e.size <= 0) {say(`${k} has no size`);}
    }
  }
  for (const [k, d] of Object.entries(m.downloads ?? {})) {
    checkUrl(`downloads.${k}`, d?.url);
    if (!Number.isInteger(d?.size) || d.size <= 0) {say(`downloads.${k} has no size`);}
  }
  return problems;
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
