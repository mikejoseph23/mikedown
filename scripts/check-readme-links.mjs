#!/usr/bin/env node
// Checks that every absolute URL in the root and package READMEs returns 200.
//
//   node scripts/check-readme-links.mjs
//
// Needs the network, so it is not part of CI. npm package URLs for packages that
// are not on the registry yet (the wrappers, before M15) are reported as
// "unpublished" and do not fail the run. Exits 1 on any other failure.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [join(root, 'README.md')];
for (const d of readdirSync(join(root, 'packages'))) {
  const f = join(root, 'packages', d, 'README.md');
  if (existsSync(f)) {
    files.push(f);
  }
}

const urlRe = /https?:\/\/[^\s<>"')\]]+/g;
const urls = new Map(); // url -> Set(file)
for (const f of files) {
  for (const m of readFileSync(f, 'utf8').matchAll(urlRe)) {
    const u = m[0].replace(/[.,;:`]+$/, '');
    // Placeholders and example hosts are not links to check.
    if (/localhost|127\.0\.0\.1|example\.(com|org)|\$\{|<|\{/.test(u)) {
      continue;
    }
    if (!urls.has(u)) {
      urls.set(u, new Set());
    }
    urls.get(u).add(relative(root, f));
  }
}

async function status(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        headers: { 'user-agent': 'mikedown-readme-link-check' },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 200 || method === 'GET') {
        return res.status;
      }
    } catch (err) {
      if (method === 'GET') {
        return `error: ${err.cause?.code ?? err.message}`;
      }
    }
  }
}

const failures = [];
const unpublished = [];
const notDeployed = [];
let cdn;
let ok = 0;
const list = [...urls.keys()];
const results = await Promise.all(list.map(async (u) => [u, await status(u)]));
for (const [u, s] of results) {
  if (s === 200) {
    ok++;
  } else if (/^https:\/\/www\.npmjs\.com\/package\/@mikedown\//.test(u)) {
    // npmjs.com often answers 403 to scripts, so judge by the registry instead.
    const name = decodeURIComponent(u.split('/package/')[1]);
    const reg = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, { method: 'HEAD' }).catch(() => null);
    if (reg && reg.status === 200) {
      ok++;
    } else if (reg && reg.status === 404) {
      unpublished.push(u);
    } else {
      failures.push(`${u}  ${s}  (${[...urls.get(u)].join(', ')})`);
    }
  } else if (s === 404 && /^https:\/\/www\.iadev\.net\/mikedown\/(vscode|developers)\//.test(u)) {
    // Built by this plan (website/); live after the site deploy.
    notDeployed.push(u);
  } else if (s === 404 && (cdn = u.match(/^https:\/\/(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(@mikedown\/[^@/]+)@([^/]+)\//))) {
    // A CDN URL for a version that is not on npm yet.
    const doc = await fetch(`https://registry.npmjs.org/${cdn[1].replace('/', '%2F')}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!doc || !doc.versions?.[cdn[2]]) {
      unpublished.push(`${u} (version ${cdn[2]} not on npm)`);
    } else {
      failures.push(`${u}  ${s}  (${[...urls.get(u)].join(', ')})`);
    }
  } else {
    failures.push(`${u}  ${s}  (${[...urls.get(u)].join(', ')})`);
  }
}

console.log(`${list.length} URLs in ${files.length} READMEs: ${ok} ok, ${unpublished.length} unpublished npm/CDN, ${notDeployed.length} site pages not deployed, ${failures.length} failed`);
for (const u of unpublished) {
  console.log(`  unpublished (expected): ${u}`);
}
for (const u of notDeployed) {
  console.log(`  not deployed yet (expected): ${u}`);
}
for (const f of failures) {
  console.log(`  FAIL ${f}`);
}
process.exit(failures.length ? 1 : 0);
