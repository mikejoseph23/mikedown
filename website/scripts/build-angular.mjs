// Builds the Angular demo into dist/developers/angular (run after `vite build`,
// which empties dist). Vite cannot build Angular, so this is a separate step.
// Afterwards the site shell's header and footer markers in the built
// index.html are filled, as Vite does for the other pages (shared/partials.js).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyShellMarkers } from '../shared/partials.js';

const app = fileURLToPath(new URL('../developers-angular/', import.meta.url));
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: app, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
};
if (!existsSync(app + 'node_modules')) {
  run('npm', ['ci']);
}
run('npx', ['ng', 'build', '--base-href', '/mikedown/developers/angular/']);

const built = fileURLToPath(new URL('../dist/developers/angular/index.html', import.meta.url));
if (existsSync(built)) {
  const html = readFileSync(built, 'utf8');
  const shelled = applyShellMarkers(html);
  if (shelled !== html) {
    writeFileSync(built, shelled);
  }
}
