#!/usr/bin/env node
/**
 * Tiny CLI over lib/minisign.js for the harness scripts:
 *   node deploy/lib/verify-cli.js <tauri.conf.json> <file> <file.sig> <version>
 * Exit 0 when the signature verifies against the shipped pubkey and carries
 * that signed version; prints why and exits 1 otherwise.
 */
import fs from 'node:fs';
import { verifySignature } from './minisign.js';

const [conf, file, sig, version] = process.argv.slice(2);
try {
  const pubkey = JSON.parse(fs.readFileSync(conf, 'utf8')).plugins.updater.pubkey;
  const r = verifySignature({ data: fs.readFileSync(file), signature: fs.readFileSync(sig, 'utf8').trim(), pubkey, version });
  console.log(`  ${file}: signature OK (key ${r.keyId}, signed version ${r.signedVersion})`);
} catch (e) {
  console.error(`verify-cli: ${e.message}`);
  process.exit(1);
}
