// Builds the Angular demo into dist/developers/angular (run after `vite build`,
// which empties dist). Vite cannot build Angular, so this is a separate step.
//
// The demo links @mikedown/angular from packages/angular/dist and
// @mikedown/core from packages/core (file: links, preserveSymlinks in
// angular.json), so build:packages must have run first.
//
// Before the build, core's stylesheet is copied without its KaTeX @import
// (src/generated/, see developers/common/samples.js). Afterwards the built
// index.html gets the site shell's header and footer (shared/partials.js) and
// the developer-page markers (stage, code sample, KaTeX link), as Vite does
// for the other pages.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyShellMarkers } from '../shared/partials.js';
import { applyDeveloperMarkers, stripKatexImport } from '../developers/common/samples.js';

const app = fileURLToPath(new URL('../developers-angular/', import.meta.url));
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: app, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
};

const angularDist = fileURLToPath(new URL('../../packages/angular/dist/package.json', import.meta.url));
const coreCss = fileURLToPath(new URL('../../packages/core/dist/styles.css', import.meta.url));
if (!existsSync(angularDist) || !existsSync(coreCss)) {
  console.error('build-angular: packages/angular/dist or packages/core/dist is missing. Run `npm run build:packages -w website` first.');
  process.exit(1);
}

if (!existsSync(app + 'node_modules')) {
  run('npm', ['ci']);
}

mkdirSync(app + 'src/generated', { recursive: true });
writeFileSync(app + 'src/generated/mikedown-core.css', stripKatexImport(readFileSync(coreCss, 'utf8')));

run('npx', ['ng', 'build', '--base-href', '/mikedown/developers/angular/']);

const built = fileURLToPath(new URL('../dist/developers/angular/index.html', import.meta.url));
if (existsSync(built)) {
  const html = readFileSync(built, 'utf8');
  const filled = applyDeveloperMarkers(applyShellMarkers(html), app + 'src');
  if (filled !== html) {
    writeFileSync(built, filled);
  }
}
