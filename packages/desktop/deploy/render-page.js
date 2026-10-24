#!/usr/bin/env node
/**
 * Stage the download page: fill (or drop) its Linux blocks.
 *
 *   node deploy/render-page.js --in website/mikedown-desktop/index.html --out <upload>/index.html \
 *     --version 0.3.0 [--linux <AppImage file>] [--base-url URL]
 *
 * With --linux the page links BASE_URL/MikeDown-<v>-linux-x86_64.AppImage and
 * shows its size; without it the Linux blocks are removed.
 */
import fs from 'node:fs';
import { linuxArtifactName, renderLinuxPage } from './lib/publish-checks.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
if (!args.in || !args.out || !args.version) {
  console.error('usage: render-page.js --in <html> --out <html> --version x.y.z [--linux <AppImage>] [--base-url URL]');
  process.exit(2);
}
const base = (args['base-url'] ?? 'https://www.iadev.net/mikedown/').replace(/\/?$/, '/');
const linux = args.linux ? { url: base + linuxArtifactName(args.version), size: fs.statSync(args.linux).size } : null;
fs.writeFileSync(args.out, renderLinuxPage(fs.readFileSync(args.in, 'utf8'), linux));
console.log(linux ? `Page: Linux download ${linux.url} (${linux.size} bytes)` : 'Page: no Linux build in this release, Linux blocks removed');
