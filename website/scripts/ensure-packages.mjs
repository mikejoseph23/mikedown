// `npm run dev` helper: the developer pages import the wrappers' dist/ builds,
// so build the ones that are missing (a fresh clone). Rebuild after changing a
// package's source with `npm run build:packages -w website`.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packages = ['core', 'react', 'vue', 'web-component'];
const root = fileURLToPath(new URL('../../', import.meta.url));
const missing = packages.filter((p) => !existsSync(`${root}packages/${p}/dist/index.js`));
if (missing.length > 0) {
  console.log(`Building ${missing.join(', ')} for the developer pages`);
  const r = spawnSync('node', ['scripts/build-npm.mjs', '--only', ['core', ...missing].join(',')], { cwd: root, stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
