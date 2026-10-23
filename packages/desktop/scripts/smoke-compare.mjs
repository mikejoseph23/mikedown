#!/usr/bin/env node
/**
 * Compare a webview smoke report (src/smoke/harness.ts, written by the Rust
 * `smoke_report` command into $MIKEDOWN_SMOKE_DIR) against the jsdom
 * reference round-trip pinned in test/unit/smoke.expected.md.
 *
 *   node scripts/smoke-compare.mjs /tmp/mikedown-smoke/webkit-or-webview2.json
 *
 * Prints the host/webview info, every check with its result, and a unified
 * diff of the round-trip markdown when it differs. Exit 1 on a failed check
 * or a markdown mismatch.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const expectedPath = path.resolve(here, '..', 'test', 'unit', 'smoke.expected.md');
const reportPath = process.argv[2];
if (!reportPath) {
  console.error('usage: smoke-compare.mjs <report.json>');
  process.exit(2);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const expected = fs.readFileSync(expectedPath, 'utf8');

console.log('host:', JSON.stringify(report.host));
console.log('env:', JSON.stringify({ ...report.env, userAgent: undefined }));
console.log('userAgent:', report.env.userAgent);
console.log('');

let failed = 0;
for (const c of report.checks) {
  const mark = c.ok === true ? 'PASS' : c.ok === false ? 'FAIL' : 'MANUAL';
  if (c.ok === false) {failed++;}
  console.log(`${mark.padEnd(6)} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
}

const actual = report.roundTrip.markdown;
console.log('');
if (actual === expected) {
  console.log('round-trip markdown: identical to jsdom reference');
} else {
  failed++;
  console.log('round-trip markdown: DIFFERS from jsdom reference');
  const a = expected.split('\n');
  const b = actual.split('\n');
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) {
      console.log(`  line ${i + 1}:`);
      console.log(`  - ${a[i] ?? '<eof>'}`);
      console.log(`  + ${b[i] ?? '<eof>'}`);
    }
  }
}

if (report.themeEvents?.length) {
  console.log('');
  console.log('theme events:');
  for (const t of report.themeEvents) {console.log(`  ${t.at} prefersDark=${t.prefersDark} rootTheme=${t.rootTheme} surface=${t.surface}`);}
}

process.exit(failed ? 1 : 0);
