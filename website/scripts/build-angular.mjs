// Builds the Angular demo into dist/developers/angular (run after `vite build`,
// which empties dist). Vite cannot build Angular, so this is a separate step.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
