#!/usr/bin/env node
/**
 * Staging scenarios for the updater harness (updater-staging-test.sh / .ps1).
 *
 * Lays out one folder per scenario under <serve>/ so a plain static server
 * (python http.server) can play every case, 404s included:
 *
 *   pertarget   latest-<key>.json = NEXT (good); latest.json = a decoy (9.9.9) that must NOT be used
 *   fallback    no per-target file (404), latest.json = NEXT (good)
 *   legacy      latest.json = NEXT (good), nothing else: what a 0.1.x client sees
 *   tampered    manifest + signature are NEXT's, but the payload has a flipped byte
 *   wrongkey    manifest signed by a throwaway key (the app trusts only the shipped one)
 *   downgrade   manifest version below the running version
 *   same        manifest version equal to the running version
 *   replay      manifest says NEXT, but payload and signature are N's (signed for version N)
 *   unsigned, badsig   (only when MikeDown-<NEXT>-unsigned|badsig<suffix>(.sig) exist) update-key-signed
 *               payloads that the Authenticode / codesign check must still refuse
 *
 * Inputs it expects in <serve>/ (the shell/PowerShell script made them):
 *   MikeDown-<NEXT><suffix>(.sig)      good payload and its updater signature (real key, signed version NEXT)
 *   MikeDown-<N><suffix>(.sig)         the running version's payload and signature (real key, version N)
 *   MikeDown-<NEXT><suffix>.wrongkey.sig   NEXT's payload signed with a throwaway key
 * It creates MikeDown-<NEXT>-tampered<suffix> and MikeDown-<NEXT>-replay<suffix>.
 *
 * Manifests are built with deploy/lib/release-lib.js (the release pipeline's
 * own builders) against a placeholder https base, then re-pointed at --base.
 *
 *   node deploy/staging-scenarios.js --serve DIR --n 0.1.0 --next 0.1.1 \
 *     --base http://127.0.0.1:18765 --keys darwin-aarch64,darwin-x86_64 \
 *     --suffix -staging.app.tar.gz --platform mac|windows
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makeLatestJson, makeTargetManifests, targetManifestName, LEGACY_MANIFEST } from './lib/release-lib.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
for (const k of ['serve', 'n', 'next', 'base', 'keys', 'suffix', 'platform']) {
  if (!args[k]) {
    console.error(`staging-scenarios: --${k} is required`);
    process.exit(2);
  }
}
const { serve, n, next, platform } = args;
const base = args.base.replace(/\/$/, '');
const keys = args.keys.split(',');
const suffix = args.suffix;
const PLACEHOLDER = 'https://staging.invalid/';
const pubDate = '2026-10-24T00:00:00Z';

const sigOf = (f) => fs.readFileSync(path.join(serve, `${f}.sig`), 'utf8').trim();
const art = (file, signature) => {
  const data = fs.readFileSync(path.join(serve, file));
  return { file, signature, sha256: crypto.createHash('sha256').update(data).digest('hex'), size: data.length };
};

const goodFile = `MikeDown-${next}${suffix}`;
const oldFile = `MikeDown-${n}${suffix}`;
const tamperedFile = `MikeDown-${next}-tampered${suffix}`;
const replayFile = `MikeDown-${next}-replay${suffix}`;

const good = art(goodFile, sigOf(goodFile));
const wrong = art(goodFile, fs.readFileSync(path.join(serve, `${goodFile}.wrongkey.sig`), 'utf8').trim());

const bytes = fs.readFileSync(path.join(serve, goodFile));
const flipped = Buffer.from(bytes);
flipped[Math.floor(flipped.length / 2)] ^= 0xff;
fs.writeFileSync(path.join(serve, tamperedFile), flipped);
const tampered = art(tamperedFile, good.signature);

fs.copyFileSync(path.join(serve, oldFile), path.join(serve, replayFile));
const replay = art(replayFile, sigOf(oldFile));

/** Per-target manifests (release-lib) for one payload at one version, re-pointed at the local server. */
function perTarget(version, payload, dir, shown = version) {
  const input = { version, notes: 'Staging test build.', pubDate, baseUrl: PLACEHOLDER, downloads: null };
  const files = makeTargetManifests({ ...input, [platform]: payload });
  for (const [name, manifest] of Object.entries(files)) {
    if (!keys.some((k) => targetManifestName(k) === name)) {continue;}
    put(dir, name, { ...manifest, version: shown });
  }
}
function legacy(version, payload, dir, shown = version) {
  const input = { version, notes: 'Staging test build.', pubDate, baseUrl: PLACEHOLDER, downloads: null };
  const m = makeLatestJson({ ...input, [platform]: payload });
  // Only this OS's keys: the combined file the staging server plays for it.
  m.platforms = Object.fromEntries(Object.entries(m.platforms).filter(([k]) => keys.includes(k)));
  put(dir, LEGACY_MANIFEST, { ...m, version: shown });
}
function put(dir, name, manifest) {
  fs.mkdirSync(path.join(serve, dir), { recursive: true });
  const text = `${JSON.stringify(manifest, null, 2)}\n`.split(PLACEHOLDER).join(`${base}/`);
  fs.writeFileSync(path.join(serve, dir, name), text);
}

for (const d of ['pertarget', 'fallback', 'legacy', 'tampered', 'wrongkey', 'downgrade', 'same', 'replay']) {
  fs.rmSync(path.join(serve, d), { recursive: true, force: true });
}

perTarget(next, good, 'pertarget');
// The decoy proves the per-target file wins: if the client used latest.json it would see 9.9.9.
legacy(next, good, 'pertarget', '9.9.9');
legacy(next, good, 'fallback');
legacy(next, good, 'legacy');
perTarget(next, tampered, 'tampered');
perTarget(next, wrong, 'wrongkey');
perTarget(next, good, 'downgrade', '0.0.1');
perTarget(n, art(oldFile, sigOf(oldFile)), 'same');
perTarget(next, replay, 'replay');
// Optional (Windows): payloads the update key signed but the OS signature check must refuse.
//   unsigned  an installer with no Authenticode signature at all
//   badsig    the genuine signed installer with a byte changed after signing
for (const [dir, label] of [['unsigned', 'unsigned'], ['badsig', 'badsig']]) {
  const file = `MikeDown-${next}-${label}${suffix}`;
  fs.rmSync(path.join(serve, dir), { recursive: true, force: true });
  if (fs.existsSync(path.join(serve, file)) && fs.existsSync(path.join(serve, `${file}.sig`))) {
    perTarget(next, art(file, sigOf(file)), dir);
  }
}
console.log(`staging-scenarios: wrote pertarget fallback legacy tampered wrongkey downgrade same replay under ${serve}`);
