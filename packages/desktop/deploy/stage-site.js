#!/usr/bin/env node
/**
 * Stage a site-only upload folder for pack-for-lymedeploy.sh --site.
 *
 *   node deploy/stage-site.js --dist website/dist --page-src website/mikedown-desktop \
 *     --desktop-version 0.3.0 --out <folder> [--linux <AppImage>] [--base-url URL]
 *
 * Copies the built site (website/dist: vscode/, developers/, compare/, blog/, site-assets/),
 * renders the desktop download page for the PUBLISHED desktop version (same
 * render-page.js step release.sh runs, so the output is byte-identical to the
 * live page plus whatever changed in the source) with its screenshots, then
 * gates the folder with checkSitePackage. Never copies manifests, artifacts,
 * SHA256SUMS.txt or web.config.
 */
import fs from 'node:fs';
import path from 'node:path';
import { renderLinuxPage, linuxArtifactName } from './lib/publish-checks.js';
import { checkSitePackage } from './lib/site-checks.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
if (!args.dist || !args['page-src'] || !args['desktop-version'] || !args.out) {
  console.error('usage: stage-site.js --dist <dir> --page-src <dir> --desktop-version x.y.z --out <dir> [--linux <AppImage>] [--base-url URL]');
  process.exit(2);
}
const base = (args['base-url'] ?? 'https://www.iadev.net/mikedown/').replace(/\/?$/, '/');
const version = args['desktop-version'];

fs.rmSync(args.out, { recursive: true, force: true });
fs.mkdirSync(args.out, { recursive: true });
fs.cpSync(args.dist, args.out, { recursive: true, filter: (src) => path.basename(src) !== '.DS_Store' });

// The desktop page: the Vite build never produces it (the dist root has no index.html).
if (fs.existsSync(path.join(args.out, 'index.html'))) {
  console.error('ERROR: the Vite build output has a root index.html; the desktop page owns /mikedown/.');
  process.exit(1);
}
const linux = args.linux ? { url: base + linuxArtifactName(version), size: fs.statSync(args.linux).size } : null;
fs.writeFileSync(path.join(args.out, 'index.html'), renderLinuxPage(fs.readFileSync(path.join(args['page-src'], 'index.html'), 'utf8'), linux));
for (const f of fs.readdirSync(args['page-src'])) {
  if (f.endsWith('.png')) {fs.copyFileSync(path.join(args['page-src'], f), path.join(args.out, f));}
}

const files = {};
const walk = (dir) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {walk(full);}
    else if (ent.isFile()) {files[path.relative(args.out, full).split(path.sep).join('/')] = fs.readFileSync(full);}
  }
};
walk(args.out);
const { problems, warnings } = checkSitePackage({ files });
for (const w of warnings) {console.warn(`  warning: ${w}`);}
if (problems.length) {
  console.error(`Site folder ${args.out} is NOT safe to publish:`);
  for (const p of problems) {console.error(`  - ${p}`);}
  process.exit(1);
}
console.log(`Site folder OK: ${Object.keys(files).length} files (desktop page rendered for ${version}${linux ? ' with Linux' : ', no Linux'}).`);
