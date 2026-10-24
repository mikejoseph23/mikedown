// @ts-nocheck: the release helpers are plain ESM JavaScript (deploy/lib).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  bumpVersion, checkCorePin, makeLatestJson, readCargoLockVersion, readCargoVersion, readJsonVersion,
  setCargoLockVersion, setCargoVersion, setJsonVersion, versionReport,
} from '../../deploy/lib/release-lib.js';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('version bumps', () => {
  it('patch, minor, major and explicit', () => {
    expect(bumpVersion('0.1.0', 'patch')).toBe('0.1.1');
    expect(bumpVersion('0.1.9', 'minor')).toBe('0.2.0');
    expect(bumpVersion('1.4.2', 'major')).toBe('2.0.0');
    expect(bumpVersion('0.1.0', '3.0.0')).toBe('3.0.0');
    expect(bumpVersion('0.2.0-rc.1', 'patch')).toBe('0.2.0');
    expect(() => bumpVersion('0.1.0', 'huge')).toThrow();
  });
});

describe('sync-version rewriting', () => {
  const real = {
    packageJson: fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'),
    tauriConf: fs.readFileSync(path.join(pkgDir, 'src-tauri', 'tauri.conf.json'), 'utf8'),
    cargoToml: fs.readFileSync(path.join(pkgDir, 'src-tauri', 'Cargo.toml'), 'utf8'),
    cargoLock: fs.readFileSync(path.join(pkgDir, 'src-tauri', 'Cargo.lock'), 'utf8'),
  };

  it('the repo is in sync now', () => {
    expect(versionReport(real).mismatches).toEqual([]);
  });

  it('rewrites only the version lines, formatting kept', () => {
    const pkg = setJsonVersion(real.packageJson, '9.8.7');
    expect(readJsonVersion(pkg)).toBe('9.8.7');
    // Dependency versions are untouched.
    expect(JSON.parse(pkg).dependencies).toEqual(JSON.parse(real.packageJson).dependencies);
    expect(pkg.split('\n').length).toBe(real.packageJson.split('\n').length);

    const conf = setJsonVersion(real.tauriConf, '9.8.7');
    expect(JSON.parse(conf).version).toBe('9.8.7');
    expect(JSON.parse(conf).plugins).toEqual(JSON.parse(real.tauriConf).plugins);

    const toml = setCargoVersion(real.cargoToml, '9.8.7');
    expect(readCargoVersion(toml)).toBe('9.8.7');
    // Dependency tables keep their versions ("2", "0.10", ...).
    expect(toml.replace('version = "9.8.7"', '')).toBe(real.cargoToml.replace(/version = "[^"]*"/, ''));

    const lock = setCargoLockVersion(real.cargoLock, 'mikedown-desktop', '9.8.7');
    expect(readCargoLockVersion(lock, 'mikedown-desktop')).toBe('9.8.7');
    expect(lock.length).toBe(real.cargoLock.length + ('9.8.7'.length - readCargoLockVersion(real.cargoLock, 'mikedown-desktop').length));

    const report = versionReport({ packageJson: pkg, tauriConf: conf, cargoToml: toml, cargoLock: lock }, '9.8.7');
    expect(report.mismatches).toEqual([]);
  });

  it('reads and sets versions in CRLF files (Windows checkouts)', () => {
    const crlf = Object.fromEntries(Object.entries(real).map(([k, v]) => [k, v.replace(/\r?\n/g, '\r\n')]));
    expect(versionReport(crlf).mismatches).toEqual([]);
    const lock = setCargoLockVersion(crlf.cargoLock, 'mikedown-desktop', '9.8.7');
    expect(readCargoLockVersion(lock, 'mikedown-desktop')).toBe('9.8.7');
  });

  it('reports which file drifted', () => {
    const r = versionReport({ ...real, tauriConf: setJsonVersion(real.tauriConf, '5.5.5') });
    expect(r.mismatches).toEqual([expect.stringContaining('tauri.conf.json has 5.5.5')]);
  });

  it('the CLI bumps a copy of the package in sync', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mikedown-sync-'));
    fs.mkdirSync(path.join(tmp, 'deploy', 'lib'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src-tauri'));
    fs.copyFileSync(path.join(pkgDir, 'deploy', 'sync-version.js'), path.join(tmp, 'deploy', 'sync-version.js'));
    fs.copyFileSync(path.join(pkgDir, 'deploy', 'lib', 'release-lib.js'), path.join(tmp, 'deploy', 'lib', 'release-lib.js'));
    fs.writeFileSync(path.join(tmp, 'package.json'), real.packageJson);
    for (const f of ['tauri.conf.json', 'Cargo.toml', 'Cargo.lock']) {
      fs.copyFileSync(path.join(pkgDir, 'src-tauri', f), path.join(tmp, 'src-tauri', f));
    }
    const script = path.join(tmp, 'deploy', 'sync-version.js');
    const out = execFileSync(process.execPath, [script, 'minor'], { encoding: 'utf8' }).trim();
    const expected = bumpVersion(readJsonVersion(real.packageJson), 'minor');
    expect(out).toBe(expected);
    expect(execFileSync(process.execPath, [script, '--check'], { encoding: 'utf8' }).trim()).toBe(expected);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('latest.json', () => {
  const base = {
    version: '0.2.0',
    notes: 'Bug fixes.',
    pubDate: '2026-10-23T12:00:00.000Z',
    baseUrl: 'https://www.iadev.net/mikedown',
    mac: { file: 'MikeDown-0.2.0-macos-universal.app.tar.gz', signature: 'c2lnLW1hYw==\n' },
    windows: { file: 'MikeDown-0.2.0-windows-x64-setup.exe', signature: 'c2lnLXdpbg==' },
  };

  it('is in Tauri static format with both darwin keys on the universal bundle', () => {
    const m = makeLatestJson(base);
    expect(m).toEqual({
      version: '0.2.0',
      notes: 'Bug fixes.',
      pub_date: '2026-10-23T12:00:00Z',
      platforms: {
        'darwin-aarch64': { signature: 'c2lnLW1hYw==', url: 'https://www.iadev.net/mikedown/MikeDown-0.2.0-macos-universal.app.tar.gz' },
        'darwin-x86_64': { signature: 'c2lnLW1hYw==', url: 'https://www.iadev.net/mikedown/MikeDown-0.2.0-macos-universal.app.tar.gz' },
        'windows-x86_64': { signature: 'c2lnLXdpbg==', url: 'https://www.iadev.net/mikedown/MikeDown-0.2.0-windows-x64-setup.exe' },
      },
    });
  });

  it('adds the website downloads block', () => {
    const m = makeLatestJson({ ...base, downloads: { mac: { file: 'MikeDown-0.2.0-macos-universal.dmg', size: 10, minimumOs: 'macOS 12 Monterey' }, windows: null } });
    expect(m.downloads).toEqual({ mac: { url: 'https://www.iadev.net/mikedown/MikeDown-0.2.0-macos-universal.dmg', size: 10, minimumOs: 'macOS 12 Monterey' } });
  });

  it('a Mac-only release leaves Windows out', () => {
    expect(Object.keys(makeLatestJson({ ...base, windows: null }).platforms)).toEqual(['darwin-aarch64', 'darwin-x86_64']);
  });

  it('refuses unversioned files, missing signatures, http and no platforms', () => {
    expect(() => makeLatestJson({ ...base, mac: { file: 'MikeDown.app.tar.gz', signature: 'x' } })).toThrow(/version/);
    expect(() => makeLatestJson({ ...base, mac: { ...base.mac, signature: ' ' } })).toThrow(/signature/);
    expect(() => makeLatestJson({ ...base, baseUrl: 'http://iadev.net/mikedown/' })).toThrow(/https/);
    expect(() => makeLatestJson({ ...base, mac: null, windows: null })).toThrow(/no platforms/);
    expect(() => makeLatestJson({ ...base, version: 'v1' })).toThrow(/bad version/);
  });
});

describe('core pin', () => {
  it('passes when pinned, equal and published', () => {
    expect(checkCorePin({ pinned: '0.2.0', coreVersion: '0.2.0', published: true, allowUnpublished: false })).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('passes a published pin that differs from the workspace, with a warning', () => {
    const r = checkCorePin({ pinned: '0.1.0', coreVersion: '0.2.0-rc.0', published: true, allowUnpublished: false });
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toMatch(/0\.1\.0.*0\.2\.0-rc\.0.*registry copy/);
  });

  it('fails on a range', () => {
    expect(checkCorePin({ pinned: '^0.2.0', coreVersion: '0.2.0', published: true, allowUnpublished: false }).ok).toBe(false);
  });

  it('unpublished needs --allow-unpublished-core, then warns', () => {
    const no = checkCorePin({ pinned: '0.2.0', coreVersion: '0.2.0', published: false, allowUnpublished: false });
    expect(no.ok).toBe(false);
    expect(no.errors[0]).toMatch(/--allow-unpublished-core/);
    const yes = checkCorePin({ pinned: '0.2.0', coreVersion: '0.2.0', published: false, allowUnpublished: true });
    expect(yes.ok).toBe(true);
    expect(yes.warnings[0]).toMatch(/workspace copy/);
  });

  it('unpublished and differing from the workspace fails even with the flag', () => {
    const r = checkCorePin({ pinned: '0.3.0', coreVersion: '0.2.0', published: false, allowUnpublished: true });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/0\.3\.0.*not on npm.*0\.2\.0/);
  });
});
