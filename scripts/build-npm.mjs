// Builds every public npm package (or --only <name,...>). Used by `npm run test:packages`.
import { buildPackage, discoverPackages } from './lib/npm-packages.mjs';

const idx = process.argv.indexOf('--only');
const only = idx > -1 ? process.argv[idx + 1].split(',').map((s) => s.replace(/^@mikedown\//, '')) : null;

for (const pkg of discoverPackages()) {
  if (only && !only.includes(pkg.folder)) continue;
  console.log(`Building ${pkg.name}`);
  buildPackage(pkg);
}
