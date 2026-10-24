/**
 * Minisign verification for Tauri updater signatures, with no dependencies
 * (node:crypto has Ed25519 and BLAKE2b-512), so the release scripts can check
 * a signature exactly the way tauri-plugin-updater does before anything is
 * published.
 *
 * Formats, as Tauri writes them:
 *   - pubkey (tauri.conf.json plugins.updater.pubkey): base64 of the minisign
 *     public key file, "untrusted comment: …\n<base64: 'Ed' | keyId(8) | key(32)>".
 *   - signature (the .sig file and the manifest's `signature`): base64 of the
 *     minisign signature file:
 *       untrusted comment: …
 *       <base64: 'ED' | keyId(8) | sig(64)>      'ED' = BLAKE2b-512 prehashed
 *       trusted comment: timestamp:…\tfile:…\tversion:x.y.z
 *       <base64: global sig(64) over sig || trusted comment>
 *
 * The plugin (2.14, `verify_signature`) checks the signature, then the global
 * signature, and only then reads `version:` from the trusted comment and
 * compares it with the manifest's version (`requireSignedVersion`).
 */
import crypto from 'node:crypto';

const b64 = (s, what) => {
  const t = String(s ?? '').trim();
  if (!/^[A-Za-z0-9+/=\s]+$/.test(t)) {throw new Error(`${what} is not base64`);}
  return Buffer.from(t, 'base64');
};

/** Display form of a key id, as minisign and tauri.conf.json's comment print it. */
const keyIdHex = (bytes) => Buffer.from(bytes).reverse().toString('hex').toUpperCase();

const lines = (text) => text.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');

/** `pubkey` is the base64 string from tauri.conf.json. */
export function parsePublicKey(pubkey) {
  const text = b64(pubkey, 'public key').toString('utf8');
  const raw = lines(text).find((l, i) => i > 0 && l.trim() !== '');
  if (!raw) {throw new Error('public key has no key line');}
  const bin = b64(raw, 'public key line');
  if (bin.length !== 42 || bin.subarray(0, 2).toString('latin1') !== 'Ed') {
    throw new Error('not a minisign Ed25519 public key');
  }
  const keyId = bin.subarray(2, 10);
  const key = crypto.createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: bin.subarray(10).toString('base64url') },
    format: 'jwk',
  });
  return { keyId: keyIdHex(keyId), keyIdBytes: keyId, key };
}

/** `signature` is the base64 .sig content (what goes in the manifest). */
export function parseSignature(signature) {
  const text = b64(signature, 'signature').toString('utf8');
  const l = lines(text);
  if (l.length < 4 || !l[0].startsWith('untrusted comment:') || !l[2].startsWith('trusted comment: ')) {
    throw new Error('not a minisign signature (expected 4 lines: untrusted comment, signature, trusted comment, global signature)');
  }
  const sigBin = b64(l[1], 'signature line');
  if (sigBin.length !== 74) {throw new Error('signature line has the wrong length');}
  const algorithm = sigBin.subarray(0, 2).toString('latin1');
  if (algorithm !== 'ED' && algorithm !== 'Ed') {throw new Error(`unknown signature algorithm "${algorithm}"`);}
  const trustedComment = l[2].slice('trusted comment: '.length);
  const globalSig = b64(l[3], 'global signature line');
  if (globalSig.length !== 64) {throw new Error('global signature has the wrong length');}
  return {
    algorithm,
    prehashed: algorithm === 'ED',
    keyIdBytes: sigBin.subarray(2, 10),
    keyId: keyIdHex(sigBin.subarray(2, 10)),
    sig: sigBin.subarray(10),
    trustedComment,
    globalSig,
  };
}

/** The `version:` field of a trusted comment (tab-separated key:value pairs), or null. */
export function signedVersion(trustedComment) {
  for (const field of String(trustedComment).split('\t')) {
    if (field.startsWith('version:')) {return field.slice('version:'.length);}
  }
  return null;
}

/**
 * Verify `data` (Buffer) against a Tauri signature and public key. Throws with
 * a specific message on any failure; returns what was verified. When
 * `version` is given, the signature must carry that exact version (the plugin
 * compares as semver after stripping a leading `v`; release versions here are
 * plain x.y.z, so an exact match is the same test).
 */
export function verifySignature({ data, signature, pubkey, version }) {
  const pk = parsePublicKey(pubkey);
  const s = parseSignature(signature);
  if (!pk.keyIdBytes.equals(s.keyIdBytes)) {
    throw new Error(`signed with key ${s.keyId}, but the app trusts key ${pk.keyId}`);
  }
  const message = s.prehashed ? crypto.createHash('blake2b512').update(data).digest() : data;
  if (!crypto.verify(null, message, pk.key, s.sig)) {
    throw new Error('signature does not match the file (tampered, truncated or a different file)');
  }
  const global = Buffer.concat([s.sig, Buffer.from(s.trustedComment, 'utf8')]);
  if (!crypto.verify(null, global, pk.key, s.globalSig)) {
    throw new Error('trusted comment signature is invalid');
  }
  const signed = signedVersion(s.trustedComment);
  if (version !== undefined) {
    if (signed === null) {
      throw new Error('signature carries no signed version (sign with `tauri signer sign --app-version`); requireSignedVersion would refuse it');
    }
    if (signed.replace(/^v/, '') !== String(version).replace(/^v/, '')) {
      throw new Error(`signature is for version ${signed}, not ${version}`);
    }
  }
  return { keyId: pk.keyId, trustedComment: s.trustedComment, signedVersion: signed };
}
