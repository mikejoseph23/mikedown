// @ts-nocheck: the release helpers are plain ESM JavaScript (deploy/lib).
//
// Per-target manifests, the split-release rule, minisign verification, the
// staging gate, verify-published.js against a local server, and the download
// page's manifest fallback. desktop-auto-update-plan.md, U3.
import { execFile, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ALL_MANIFESTS, checkManifestShape, makeLatestJson, makeTargetManifests, manifestPlatform, parsePlatforms,
  planManifests, targetManifestName,
} from '../../deploy/lib/release-lib.js';
import { parseSignature, signedVersion, verifySignature } from '../../deploy/lib/minisign.js';
import { checkStagedUpload, manifestExpectations } from '../../deploy/lib/publish-checks.js';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const deployDir = path.join(pkgDir, 'deploy');
const repoRoot = path.resolve(pkgDir, '..', '..');
const run = promisify(execFile);
const BASE = 'https://www.iadev.net/mikedown/';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** A throwaway minisign key in Tauri's encodings (pubkey and .sig are base64 of the minisign text files). */
function testKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  const keyId = crypto.randomBytes(8);
  const pubText = `untrusted comment: minisign public key: ${Buffer.from(keyId).reverse().toString('hex').toUpperCase()}\n${Buffer.concat([Buffer.from('Ed'), keyId, raw]).toString('base64')}\n`;
  const sign = (data, trusted, { prehash = true } = {}) => {
    const msg = prehash ? crypto.createHash('blake2b512').update(data).digest() : data;
    const sig = crypto.sign(null, msg, privateKey);
    const global = crypto.sign(null, Buffer.concat([sig, Buffer.from(trusted)]), privateKey);
    const text = `untrusted comment: signature from tauri secret key\n${Buffer.concat([Buffer.from(prehash ? 'ED' : 'Ed'), keyId, sig]).toString('base64')}\ntrusted comment: ${trusted}\n${global.toString('base64')}\n`;
    return Buffer.from(text).toString('base64');
  };
  const signFor = (data, file, version) => sign(data, `timestamp:1792811318\tfile:${file}\tversion:${version}`);
  return { pubkey: Buffer.from(pubText).toString('base64'), sign, signFor };
}

const NAMES = (v) => ({
  macTar: `MikeDown-${v}-macos-universal.app.tar.gz`,
  dmg: `MikeDown-${v}-macos-universal.dmg`,
  win: `MikeDown-${v}-windows-x64-setup.exe`,
});

/** Build artifacts + .sig files for `version` into `dir`, like build-mac.sh / remote-build-windows.sh leave them. */
function writeArtifacts(dir, version, key, { mac = true, windows = true, signVersion = version } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const n = NAMES(version);
  const put = (file, bytes, signed) => {
    fs.writeFileSync(path.join(dir, file), bytes);
    if (signed) {fs.writeFileSync(path.join(dir, `${file}.sig`), key.signFor(bytes, file, signVersion));}
  };
  if (mac) {
    put(n.macTar, crypto.randomBytes(3000), true);
    put(n.dmg, crypto.randomBytes(4000), false);
  }
  if (windows) {put(n.win, crypto.randomBytes(2000), true);}
  return n;
}

function makeManifests(dir, version, key, platforms, extra = []) {
  return execFileSync(process.execPath, [
    path.join(deployDir, 'make-latest-json.js'), '--version', version, '--dir', dir, '--platforms', platforms,
    '--pubkey', key.pubkey, '--pub-date', '2026-10-24T00:00:00Z', ...extra,
  ], { encoding: 'utf8' });
}

/** The upload folder release.sh stages (no .sig files). */
function stageUpload(dir, upload, version, platforms) {
  fs.rmSync(upload, { recursive: true, force: true });
  fs.mkdirSync(upload, { recursive: true });
  const n = NAMES(version);
  const want = parsePlatforms(platforms);
  const files = [...(want.mac ? [n.macTar, n.dmg] : []), ...(want.windows ? [n.win] : []), ...ALL_MANIFESTS];
  for (const f of files) {if (fs.existsSync(path.join(dir, f))) {fs.copyFileSync(path.join(dir, f), path.join(upload, f));}}
  fs.copyFileSync(path.join(repoRoot, 'website', 'mikedown-desktop', 'index.html'), path.join(upload, 'index.html'));
  fs.copyFileSync(path.join(deployDir, 'site', 'web.config'), path.join(upload, 'web.config'));
}

const readFolder = (dir) => Object.fromEntries(fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f))]));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mikedown-u3-'));

// ── minisign ─────────────────────────────────────────────────────────────────

describe('minisign verification (what tauri-plugin-updater checks)', () => {
  const key = testKey();
  const data = Buffer.from('MikeDown 0.2.0 payload');
  const good = key.signFor(data, 'x.tar.gz', '0.2.0');

  it('accepts a good prehashed signature and reads the signed version', () => {
    expect(verifySignature({ data, signature: good, pubkey: key.pubkey, version: '0.2.0' }).signedVersion).toBe('0.2.0');
    expect(signedVersion(parseSignature(good).trustedComment)).toBe('0.2.0');
  });

  it('accepts a legacy (not prehashed) signature', () => {
    const legacy = key.sign(data, 'timestamp:1\tfile:x\tversion:0.2.0', { prehash: false });
    expect(() => verifySignature({ data, signature: legacy, pubkey: key.pubkey, version: '0.2.0' })).not.toThrow();
  });

  it('refuses a signature for another version (replay under a higher version)', () => {
    expect(() => verifySignature({ data, signature: good, pubkey: key.pubkey, version: '0.3.0' })).toThrow(/for version 0\.2\.0, not 0\.3\.0/);
  });

  it('refuses a signature that carries no signed version', () => {
    const old = key.sign(data, 'timestamp:1600000000\tfile:x.tar.gz');
    expect(() => verifySignature({ data, signature: old, pubkey: key.pubkey, version: '0.2.0' })).toThrow(/no signed version/);
    // a field that merely ends in version: does not count
    expect(signedVersion('timestamp:1\tfile:app-version:2.zip')).toBeNull();
  });

  it('refuses tampered bytes, another key and an edited trusted comment', () => {
    const bad = Buffer.from(data); bad[0] ^= 1;
    expect(() => verifySignature({ data: bad, signature: good, pubkey: key.pubkey })).toThrow(/does not match the file/);
    expect(() => verifySignature({ data, signature: good, pubkey: testKey().pubkey })).toThrow(/signed with key/);
    const text = Buffer.from(good, 'base64').toString('utf8').replace('version:0.2.0', 'version:0.3.0');
    expect(() => verifySignature({ data, signature: Buffer.from(text).toString('base64'), pubkey: key.pubkey })).toThrow(/trusted comment signature/);
  });

  it('parses the app\'s real pubkey (key id C5386105C2C03AF7)', async () => {
    const { parsePublicKey } = await import('../../deploy/lib/minisign.js');
    const conf = JSON.parse(fs.readFileSync(path.join(pkgDir, 'src-tauri', 'tauri.conf.json'), 'utf8'));
    expect(parsePublicKey(conf.plugins.updater.pubkey).keyId).toBe('C5386105C2C03AF7');
  });
});

// ── manifests and the split-release rule ─────────────────────────────────────

describe('per-target manifests', () => {
  const art = (file, s) => ({ file, signature: s, sha256: 'a'.repeat(64), size: 10 });
  const base = {
    version: '0.2.0', notes: 'Fixes.', pubDate: '2026-10-24T00:00:00.000Z', baseUrl: BASE,
    mac: art('MikeDown-0.2.0-macos-universal.app.tar.gz', 'c2lnLW1hYw=='),
    windows: art('MikeDown-0.2.0-windows-x64-setup.exe', 'c2lnLXdpbg=='),
    downloads: {
      mac: { file: 'MikeDown-0.2.0-macos-universal.dmg', size: 20, sha256: 'b'.repeat(64), minimumOs: 'macOS 12 Monterey' },
      windows: { file: 'MikeDown-0.2.0-windows-x64-setup.exe', size: 10, sha256: 'a'.repeat(64), minimumOs: 'Windows 10 version 1809' },
    },
  };

  it('names match the plugin\'s latest-{{target}}-{{arch}}.json expansion', () => {
    expect(ALL_MANIFESTS).toEqual(['latest-darwin-aarch64.json', 'latest-darwin-x86_64.json', 'latest-windows-x86_64.json', 'latest.json']);
    expect(targetManifestName('darwin-aarch64')).toBe('latest-darwin-aarch64.json');
    expect(manifestPlatform('latest-windows-x86_64.json')).toBe('windows');
    expect(manifestPlatform('latest.json')).toBeNull();
  });

  it('one platforms entry each, with sha256 and size, and only that platform\'s download', () => {
    const files = makeTargetManifests(base);
    expect(Object.keys(files)).toEqual(['latest-darwin-aarch64.json', 'latest-darwin-x86_64.json', 'latest-windows-x86_64.json']);
    expect(files['latest-darwin-x86_64.json']).toEqual({
      version: '0.2.0', notes: 'Fixes.', pub_date: '2026-10-24T00:00:00Z',
      platforms: { 'darwin-x86_64': { signature: 'c2lnLW1hYw==', url: `${BASE}MikeDown-0.2.0-macos-universal.app.tar.gz`, sha256: 'a'.repeat(64), size: 10 } },
      downloads: { mac: { url: `${BASE}MikeDown-0.2.0-macos-universal.dmg`, size: 20, minimumOs: 'macOS 12 Monterey', sha256: 'b'.repeat(64) } },
    });
    expect(Object.keys(files['latest-windows-x86_64.json'].platforms)).toEqual(['windows-x86_64']);
    expect(Object.keys(files['latest-windows-x86_64.json'].downloads)).toEqual(['windows']);
    for (const [name, m] of Object.entries(files)) {expect(checkManifestShape(name, m, { expectVersion: '0.2.0', baseUrl: BASE })).toEqual([]);}
  });

  it('requires sha256 and size per target', () => {
    expect(() => makeTargetManifests({ ...base, mac: { ...base.mac, sha256: undefined } })).toThrow(/sha256/);
    expect(() => makeTargetManifests({ ...base, windows: { ...base.windows, size: 0 } })).toThrow(/size/);
  });

  it('full release: per-target files plus the combined latest.json', () => {
    const plan = planManifests(base);
    expect(plan.full).toBe(true);
    expect(Object.keys(plan.files)).toEqual(ALL_MANIFESTS);
    expect(plan.files['latest.json']).toEqual(makeLatestJson(base));
    expect(Object.keys(plan.files['latest.json'].platforms)).toEqual(['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64']);
    expect(plan.skipped).toEqual([]);
  });

  it('split release: Mac-only never writes latest.json or the Windows file', () => {
    const plan = planManifests({ ...base, windows: null, downloads: { ...base.downloads, windows: null } });
    expect(plan.full).toBe(false);
    expect(Object.keys(plan.files)).toEqual(['latest-darwin-aarch64.json', 'latest-darwin-x86_64.json']);
    expect(plan.skipped).toEqual(['latest-windows-x86_64.json', 'latest.json']);
  });

  it('split release: Windows-only never writes latest.json or the darwin files', () => {
    const plan = planManifests({ ...base, mac: null, downloads: { ...base.downloads, mac: null } });
    expect(Object.keys(plan.files)).toEqual(['latest-windows-x86_64.json']);
    expect(plan.skipped).toEqual(['latest-darwin-aarch64.json', 'latest-darwin-x86_64.json', 'latest.json']);
  });

  it('the shape check catches what would break an updater', () => {
    const m = makeTargetManifests(base)['latest-darwin-aarch64.json'];
    expect(checkManifestShape('latest-darwin-x86_64.json', m)).toEqual([expect.stringContaining('must be exactly ["darwin-x86_64"]')]);
    expect(checkManifestShape('latest-darwin-aarch64.json', m, { expectVersion: '0.3.0' })).toEqual([expect.stringContaining('expected 0.3.0')]);
    expect(checkManifestShape('latest-darwin-aarch64.json', { ...m, url: 'https://x', signature: 's' })[0]).toMatch(/dynamic format/);
    expect(checkManifestShape('latest-darwin-aarch64.json', m, { baseUrl: 'https://iadev.net/other/' })[0]).toMatch(/outside/);
    const noHash = { ...m, platforms: { 'darwin-aarch64': { ...m.platforms['darwin-aarch64'], sha256: undefined } } };
    expect(checkManifestShape('latest-darwin-aarch64.json', noHash)).toEqual([expect.stringContaining('no sha256')]);
  });

  it('what a staged folder and a published site must hold, per release type', () => {
    expect(manifestExpectations({ platforms: { mac: true, windows: true }, stage: true })).toEqual(
      { 'latest-darwin-aarch64.json': 'version', 'latest-darwin-x86_64.json': 'version', 'latest-windows-x86_64.json': 'version', 'latest.json': 'version' });
    expect(manifestExpectations({ platforms: { mac: true, windows: false }, stage: true })).toEqual(
      { 'latest-darwin-aarch64.json': 'version', 'latest-darwin-x86_64.json': 'version', 'latest-windows-x86_64.json': 'absent', 'latest.json': 'absent' });
    // published: the legacy file must still be there after a split release
    expect(manifestExpectations({ platforms: { mac: false, windows: true }, stage: false })).toEqual(
      { 'latest-darwin-aarch64.json': 'optional', 'latest-darwin-x86_64.json': 'optional', 'latest-windows-x86_64.json': 'version', 'latest.json': 'any' });
    expect(() => parsePlatforms('linux')).toThrow();
  });
});

// ── make-latest-json.js and the staging gate ─────────────────────────────────

describe('make-latest-json.js + check-upload', () => {
  const key = testKey();

  it('full release: verifies signatures, writes all four, and the staged folder passes', () => {
    const dir = tmp();
    writeArtifacts(dir, '0.2.0', key);
    const out = makeManifests(dir, '0.2.0', key, 'mac,windows');
    expect(out).toMatch(/signature OK/);
    for (const f of ALL_MANIFESTS) {expect(fs.existsSync(path.join(dir, f))).toBe(true);}
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'latest-windows-x86_64.json'), 'utf8'));
    expect(m.platforms['windows-x86_64'].sha256).toBe(sha(fs.readFileSync(path.join(dir, NAMES('0.2.0').win))));
    const upload = path.join(dir, 'upload');
    stageUpload(dir, upload, '0.2.0', 'mac,windows');
    expect(checkStagedUpload({ version: '0.2.0', platforms: { mac: true, windows: true }, files: readFolder(upload), pubkey: key.pubkey, baseUrl: BASE })).toEqual([]);
  });

  it('Mac-only: removes a stale latest.json and Windows file from an earlier run', () => {
    const dir = tmp();
    writeArtifacts(dir, '0.2.1', key);
    makeManifests(dir, '0.2.1', key, 'mac,windows');
    const out = makeManifests(dir, '0.2.1', key, 'mac');
    expect(out).toMatch(/removed stale latest\.json/);
    expect(fs.existsSync(path.join(dir, 'latest.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'latest-windows-x86_64.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'latest-darwin-aarch64.json'))).toBe(true);
  });

  it('refuses a signature for the wrong version, or from another key, and writes nothing', () => {
    const dir = tmp();
    writeArtifacts(dir, '0.2.0', key, { signVersion: '0.1.9' });
    expect(() => makeManifests(dir, '0.2.0', key, 'mac,windows')).toThrow();
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.json'))).toEqual([]);
    const dir2 = tmp();
    writeArtifacts(dir2, '0.2.0', key);
    expect(() => makeManifests(dir2, '0.2.0', testKey(), 'mac,windows')).toThrow();
  });

  it('a missing artifact for a platform that ships is an error, not a quiet split release', () => {
    const dir = tmp();
    writeArtifacts(dir, '0.2.0', key, { windows: false });
    expect(() => makeManifests(dir, '0.2.0', key, 'mac,windows')).toThrow();
    expect(() => makeManifests(dir, '0.2.0', key, 'mac')).not.toThrow();
  });

  it('the gate refuses the folders that would hurt customers', () => {
    const dir = tmp();
    writeArtifacts(dir, '0.2.0', key);
    makeManifests(dir, '0.2.0', key, 'mac,windows');
    const upload = path.join(dir, 'upload');
    stageUpload(dir, upload, '0.2.0', 'mac,windows');
    const files = readFolder(upload);
    const check = (f, platforms = { mac: true, windows: true }, dirs = []) =>
      checkStagedUpload({ version: '0.2.0', platforms, files: f, dirs, pubkey: key.pubkey, baseUrl: BASE });
    // a full folder offered as Mac-only would overwrite the published latest.json
    expect(check(files, { mac: true, windows: false }).join('\n')).toMatch(/latest\.json must not be staged/);
    // artifact swapped after the manifest was written
    const swapped = { ...files, [NAMES('0.2.0').win]: crypto.randomBytes(2000) };
    expect(check(swapped).join('\n')).toMatch(/sha256 .* manifest says/);
    expect(check(swapped).join('\n')).toMatch(/signature refused/);
    // missing artifact
    const missing = { ...files }; delete missing[NAMES('0.2.0').dmg];
    expect(check(missing).join('\n')).toMatch(/downloads\.mac points at .* not in the folder/);
    // the LymeScribe/LymeDisplay web.config traps
    expect(check({ ...files, 'web.config': Buffer.from('<configuration><!-- x --></configuration>') }).join('\n')).toMatch(/XML comment/);
    expect(check({ ...files, 'web.config': Buffer.from('<configuration><remove fileExtension=".json" /></configuration>') }).join('\n')).toMatch(/<remove>/);
    // strays
    expect(check({ ...files, 'MikeDown-0.2.0-windows-x64-setup.exe.sig': Buffer.from('x') }).join('\n')).toMatch(/\.sig files are not published/);
    expect(check({ ...files, 'notes.txt': Buffer.from('x') }).join('\n')).toMatch(/unversioned/);
    expect(check(files, undefined, ['engines']).join('\n')).toMatch(/subfolders/);
  });

  it('the committed web.config is comment-free and maps no MIME types', () => {
    const wc = fs.readFileSync(path.join(deployDir, 'site', 'web.config'), 'utf8');
    expect(wc).not.toMatch(/<!--/);
    expect(wc).not.toMatch(/mimeMap|<remove/);
    for (const m of ALL_MANIFESTS) {expect(wc).toContain(`<location path="${m}">`);}
  });

  it('the LymeDeploy project publishes manifests last (legacy last of all) and purges apex + www', () => {
    const y = fs.readFileSync(path.join(deployDir, 'lymedeploy', 'deploy.yaml'), 'utf8');
    const last = /publishLast:\n((?:\s+- .+\n)+)/.exec(y)[1].trim().split('\n').map((l) => l.replace(/^\s*- /, '').trim());
    expect(last).toEqual(ALL_MANIFESTS);
    expect(y).toMatch(/protectedFiles:\n\s+- web\.config/);
    expect(y).toMatch(/targetPath: '#\{PublishRoot\}'/);
    const body = /body: '(.+)'/.exec(y)[1];
    for (const m of ALL_MANIFESTS) {
      expect(body).toContain(`https://www.iadev.net/mikedown/${m}`);
      expect(body).toContain(`https://iadev.net/mikedown/${m}`);
    }
    // the purge step ships disabled until CloudflareToken exists
    expect(/name: Purge Cloudflare[\s\S]*?enabled: (\w+)/.exec(y)[1]).toBe('false');
  });
});

// ── verify-published.js against a local "site" ───────────────────────────────

describe('verify-published.js', () => {
  const key = testKey();
  let server; let port; let root; let staleLatest = null; let lengthLie = null;

  beforeAll(async () => {
    root = tmp();
    // What is "live": a full 0.2.0, then a Windows-only 0.2.1 on top of it.
    writeArtifacts(path.join(root, 'b'), '0.2.0', key);
    makeManifests(path.join(root, 'b'), '0.2.0', key, 'mac,windows');
    stageUpload(path.join(root, 'b'), path.join(root, 'site'), '0.2.0', 'mac,windows');
    server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname.startsWith('/apex/')) { // Cloudflare's apex -> www redirect
        res.writeHead(301, { Location: `/www/${u.pathname.slice(6)}${u.search}` }); res.end(); return;
      }
      const name = decodeURIComponent(u.pathname.replace(/^\/www\//, ''));
      const f = path.join(root, 'site', name);
      if (!fs.existsSync(f)) { res.writeHead(404); res.end('not found'); return; }
      let body = fs.readFileSync(f);
      if (name === 'latest.json' && staleLatest && !u.searchParams.has('cb')) {body = staleLatest;} // edge copy
      res.writeHead(200, { 'Content-Length': lengthLie && name === lengthLie && req.method === 'HEAD' ? body.length + 1 : body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  const verify = async (version, platforms = 'mac,windows') => {
    try {
      const { stdout } = await run(process.execPath, [
        path.join(deployDir, 'verify-published.js'), '--version', version, '--platforms', platforms,
        '--www', `http://127.0.0.1:${port}/www/`, '--apex', `http://127.0.0.1:${port}/apex/`, '--pubkey', key.pubkey,
      ]);
      return { code: 0, out: stdout };
    } catch (e) {
      return { code: e.code, out: `${e.stdout}${e.stderr}` };
    }
  };

  it('passes a correct full release, checking every manifest, artifact and signature', async () => {
    const r = await verify('0.2.0');
    expect(r.out).toMatch(/PASSED/);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/latest\.json windows-x86_64: .* signature and signed version OK, sha256 OK/);
  });

  it('fails when the wrong version is live', async () => {
    const r = await verify('0.2.1');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/version is 0\.2\.0, expected 0\.2\.1/);
  });

  it('fails when the edge serves a stale manifest (purge not done)', async () => {
    staleLatest = Buffer.from('{"version":"0.1.0"}');
    const r = await verify('0.2.0');
    staleLatest = null;
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/latest\.json: www, as clients fetch it differs from the origin copy/);
  });

  it('fails when an artifact is not what the manifest promised, or HEAD lies about its length', async () => {
    const f = path.join(root, 'site', NAMES('0.2.0').macTar);
    const keep = fs.readFileSync(f);
    fs.writeFileSync(f, crypto.randomBytes(keep.length));
    const r = await verify('0.2.0');
    fs.writeFileSync(f, keep);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/signature refused/);
    lengthLie = NAMES('0.2.0').win;
    const r2 = await verify('0.2.0');
    lengthLie = null;
    expect(r2.out).toMatch(/HEAD Content-Length .* manifest says/);
  });

  it('a Windows-only release on top passes with latest.json left at 0.2.0, and fails if latest.json is gone', async () => {
    const b = path.join(root, 'b1');
    writeArtifacts(b, '0.2.1', key, { mac: false });
    makeManifests(b, '0.2.1', key, 'windows');
    for (const f of [NAMES('0.2.1').win, 'latest-windows-x86_64.json']) {fs.copyFileSync(path.join(b, f), path.join(root, 'site', f));}
    const r = await verify('0.2.1', 'windows');
    expect(r.out).toMatch(/PASSED/);
    expect(r.out).toMatch(/latest\.json: version 0\.2\.0/);
    const legacy = path.join(root, 'site', 'latest.json');
    const keep = fs.readFileSync(legacy);
    fs.rmSync(legacy);
    const r2 = await verify('0.2.1', 'windows');
    fs.writeFileSync(legacy, keep);
    expect(r2.code).toBe(1);
    expect(r2.out).toMatch(/latest\.json: www cache-busted answered 404/);
  });
});

// ── the download page ────────────────────────────────────────────────────────

describe('download page reads the per-target manifests', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'website', 'mikedown-desktop', 'index.html'), 'utf8');
  const manifest = (version, platform, file) => ({
    version, notes: `Notes for ${version}`, pub_date: '2026-10-24T00:00:00Z', platforms: {},
    downloads: { [platform]: { url: `${BASE}${file}`, size: 6 * 1048576, minimumOs: platform === 'mac' ? 'macOS 12 Monterey' : 'Windows 10 version 1809' } },
  });
  const legacy = {
    version: '0.1.0', notes: 'Old', pub_date: '2026-10-01T00:00:00Z', platforms: {},
    downloads: {
      mac: { url: `${BASE}MikeDown-0.1.0-macos-universal.dmg`, size: 1, minimumOs: 'macOS 12 Monterey' },
      windows: { url: `${BASE}MikeDown-0.1.0-windows-x64-setup.exe`, size: 1, minimumOs: 'Windows 10 version 1809' },
    },
  };

  async function render(served) {
    const dom = new JSDOM(html, {
      runScripts: 'dangerously', url: 'https://www.iadev.net/mikedown/',
      beforeParse(window) {
        window.fetch = (u) => {
          const name = String(u).split('?')[0];
          const body = served[name];
          return Promise.resolve({ ok: Boolean(body), json: () => Promise.resolve(body) });
        };
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    const d = dom.window.document;
    return {
      mac: d.querySelector('[data-dl="mac"]').getAttribute('href'),
      win: d.querySelector('[data-dl="windows"]').getAttribute('href'),
      version: d.querySelector('[data-version]').textContent,
      notes: d.querySelector('[data-notes]').textContent,
    };
  }

  it('uses each platform\'s own manifest', async () => {
    const r = await render({
      'latest-darwin-aarch64.json': manifest('0.2.1', 'mac', 'MikeDown-0.2.1-macos-universal.dmg'),
      'latest-windows-x86_64.json': manifest('0.2.0', 'windows', 'MikeDown-0.2.0-windows-x64-setup.exe'),
      'latest.json': legacy,
    });
    expect(r.mac).toBe(`${BASE}MikeDown-0.2.1-macos-universal.dmg`);
    expect(r.win).toBe(`${BASE}MikeDown-0.2.0-windows-x64-setup.exe`);
    expect(r.version).toMatch(/Mac version 0\.2\.1.*Windows version 0\.2\.0/);
    expect(r.notes).toMatch(/Notes for 0\.2\.1/);
  });

  it('falls back to latest.json for a platform without a per-target file', async () => {
    const r = await render({ 'latest-darwin-aarch64.json': manifest('0.2.1', 'mac', 'MikeDown-0.2.1-macos-universal.dmg'), 'latest.json': legacy });
    expect(r.mac).toBe(`${BASE}MikeDown-0.2.1-macos-universal.dmg`);
    expect(r.win).toBe(`${BASE}MikeDown-0.1.0-windows-x64-setup.exe`);
    const only = await render({ 'latest.json': legacy });
    expect(only.mac).toBe(`${BASE}MikeDown-0.1.0-macos-universal.dmg`);
    expect(only.version).toMatch(/^Version 0\.1\.0/);
  });

  it('keeps the fallback links when nothing loads', async () => {
    const r = await render({});
    expect(r.mac).toBe('#download');
    expect(r.win).toBe('#download');
  });
});
