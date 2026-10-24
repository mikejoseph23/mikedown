// Copy the shared shell (shared/shell.css, header, footer) into the desktop
// download page, which is staged by the desktop release and never built by Vite.
//
//   node website/scripts/sync-desktop-shell.js          rewrite the page
//   node website/scripts/sync-desktop-shell.js --check  exit 1 if it is stale
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { syncDesktopShell } from '../shared/partials.js';

const pagePath = fileURLToPath(new URL('../mikedown-desktop/index.html', import.meta.url));
const css = readFileSync(fileURLToPath(new URL('../shared/shell.css', import.meta.url)), 'utf8');
const page = readFileSync(pagePath, 'utf8');
const synced = syncDesktopShell(page, css);

if (process.argv.includes('--check')) {
  if (synced !== page) {
    console.error('website/mikedown-desktop/index.html has a stale copy of the site shell. Run: npm run sync:shell -w website');
    process.exit(1);
  }
  console.log('Desktop page shell is up to date.');
} else if (synced !== page) {
  writeFileSync(pagePath, synced);
  console.log('Desktop page shell updated.');
} else {
  console.log('Desktop page shell already up to date.');
}
