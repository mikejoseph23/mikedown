// Sets packages/core to the root package version. Run by `npm run vsix` after the patch bump.
const fs = require('fs');
const path = require('path');

const root = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const corePath = path.join(__dirname, '..', 'packages', 'core', 'package.json');
const raw = fs.readFileSync(corePath, 'utf8');
const core = JSON.parse(raw);

if (core.version !== root.version) {
  core.version = root.version;
  fs.writeFileSync(corePath, JSON.stringify(core, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
}
console.log(`@mikedown/core version: ${core.version}`);
