#!/usr/bin/env node
/**
 * Build the CDN bundle and its third-party notices:
 *
 *   dist/mikedown-editor.standalone.js   the entry: core, every bundled peer
 *                                        and core's CSS as ES modules; defines
 *                                        <mikedown-editor> on load
 *   dist/mikedown-editor.chunk-*.js      what the entry imports (the code it
 *                                        shares with the AI chunk)
 *   dist/mikedown-editor.ai-ui-*.js      the AI UI, loaded by the editor only
 *                                        when an element has an `ai` host
 *   THIRD_PARTY_NOTICES.md               name, version, license and license
 *                                        text of every package in that bundle
 *
 * Needs @mikedown/core built first (`npm run build -w packages/core`;
 * `npm run test:packages` builds core before this package).
 *
 * `import('katex')` and `import('mermaid')` are rewritten to jsDelivr URLs
 * pinned to the versions installed next to core, so a no-build page loads
 * them only when a document uses math or a diagram. A static import of either
 * fails the build.
 *
 * The page still needs one `<script type="module">`: the browser fetches the
 * chunks next to the entry by relative URL, from a CDN or a copy of dist/.
 */
import { build, transform } from 'esbuild';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(pkgDir, '..', '..');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const DIST = join(pkgDir, 'dist');
const OUT = join(DIST, 'mikedown-editor.standalone.js');
const NOTICES = join(pkgDir, 'THIRD_PARTY_NOTICES.md');

/** Directory of an installed package, looked up from `fromDir` the way Node does. */
function findPackageDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', ...name.split('/'));
    if (existsSync(join(candidate, 'package.json'))) {return candidate;}
    const up = dirname(dir);
    if (up === dir) {throw new Error(`build-standalone: cannot find ${name} from ${fromDir}`);}
    dir = up;
  }
}

const coreDir = findPackageDir('@mikedown/core', pkgDir);
const coreStyles = join(coreDir, 'dist', 'styles.css');
if (!existsSync(join(coreDir, 'dist', 'index.js')) || !existsSync(coreStyles)) {
  throw new Error('build-standalone: @mikedown/core is not built. Run `npm run build -w packages/core` first.');
}
const versionOf = (name) => JSON.parse(readFileSync(join(findPackageDir(name, coreDir), 'package.json'), 'utf8')).version;
const katexVersion = versionOf('katex');
const mermaidVersion = versionOf('mermaid');

const CDN = {
  katex: `https://cdn.jsdelivr.net/npm/katex@${katexVersion}/+esm`,
  katexCss: `https://cdn.jsdelivr.net/npm/katex@${katexVersion}/dist/katex.min.css`,
  mermaid: `https://cdn.jsdelivr.net/npm/mermaid@${mermaidVersion}/dist/mermaid.esm.min.mjs`,
};

/** Core's stylesheet minus the KaTeX @import (the bundle adds a <link> instead). */
const cssPlugin = {
  name: 'mikedown-core-styles',
  setup(b) {
    b.onResolve({ filter: /^mikedown:core-styles$/ }, () => ({ path: coreStyles, namespace: 'mikedown-css' }));
    b.onLoad({ filter: /.*/, namespace: 'mikedown-css' }, async () => {
      const raw = readFileSync(coreStyles, 'utf8');
      const withoutKatex = raw.replace(/^@import\s+['"]katex\/dist\/katex\.min\.css['"];\s*$/m, '');
      if (/@import\b/.test(withoutKatex.replace(/\/\*[\s\S]*?\*\//g, ""))) {throw new Error('build-standalone: unexpected @import left in core styles.css');}
      const { code } = await transform(withoutKatex, { loader: 'css', minify: true });
      return { contents: code.trim(), loader: 'text', watchFiles: [coreStyles] };
    });
  },
};

/** Bare dynamic imports of katex and mermaid become pinned CDN URLs. */
const cdnPlugin = {
  name: 'mikedown-cdn-imports',
  setup(b) {
    b.onResolve({ filter: /^(katex|mermaid)$/ }, (args) => {
      if (args.kind !== 'dynamic-import') {
        return { errors: [{ text: `${args.path} must only be imported dynamically (found a ${args.kind} in ${args.importer})` }] };
      }
      return { path: CDN[args.path], external: true };
    });
  },
};

// A previous build's chunks (their names carry a hash).
for (const f of existsSync(DIST) ? readdirSync(DIST) : []) {
  if (/^mikedown-editor\..+\.js$/.test(f)) {rmSync(join(DIST, f));}
}

const result = await build({
  absWorkingDir: pkgDir,
  entryPoints: { standalone: join(pkgDir, 'src', 'standalone.ts') },
  outdir: DIST,
  // standalone → mikedown-editor.standalone.js; core's lazy AI chunk →
  // mikedown-editor.ai-ui-<hash>.js; shared code → mikedown-editor.chunk-<hash>.js.
  entryNames: 'mikedown-editor.[name]',
  chunkNames: 'mikedown-editor.[name]-[hash]',
  splitting: true,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  // tiptap-markdown's UMD build breaks in a browser bundle; prefer ES entries.
  mainFields: ['module', 'browser', 'main'],
  conditions: ['import', 'module', 'browser', 'default'],
  define: { __KATEX_CSS_URL__: JSON.stringify(CDN.katexCss), 'process.env.NODE_ENV': '"production"' },
  banner: {
    js: `/*! ${pkg.name} ${pkg.version} standalone | MIT | bundles third-party code, see THIRD_PARTY_NOTICES.md */`,
  },
  tsconfig: join(pkgDir, 'tsconfig.json'),
  plugins: [cssPlugin, cdnPlugin],
  metafile: true,
  logLevel: 'warning',
});

// ── Third-party notices ─────────────────────────────────────────────────────

/** Package root (nearest package.json with a name) of a bundled input path. */
function packageRootOf(file) {
  let dir = dirname(resolve(pkgDir, file));
  while (dir.startsWith(repoRoot)) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const json = JSON.parse(readFileSync(manifest, 'utf8'));
      if (json.name && json.version) {return { dir, json };}
    }
    const up = dirname(dir);
    if (up === dir) {break;}
    dir = up;
  }
  return null;
}

const bundled = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  if (input.startsWith('mikedown-css:')) {continue;}
  const found = packageRootOf(input);
  if (!found || found.json.name.startsWith('@mikedown/')) {continue;}
  bundled.set(`${found.json.name}@${found.json.version}`, found);
}

function licenseText(dir) {
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i.test(f) && statSync(join(dir, f)).isFile());
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null;
}

const licenseOf = (json) =>
  typeof json.license === 'string' ? json.license : json.license?.type ?? (Array.isArray(json.licenses) ? json.licenses.map((l) => l.type).join(' OR ') : 'UNKNOWN');

const entries = [...bundled.values()].sort((a, b) => a.json.name.localeCompare(b.json.name));
const counts = {};
for (const { json } of entries) {counts[licenseOf(json)] = (counts[licenseOf(json)] ?? 0) + 1;}

const lines = [
  '# Third-party notices',
  '',
  `\`dist/mikedown-editor.standalone.js\` and its chunks (\`dist/mikedown-editor.*.js\`) in ${pkg.name} bundle the packages below. Their licenses are reproduced here as they require.`,
  '',
  `Generated by \`scripts/build-standalone.mjs\` from the bundle's inputs: ${entries.length} packages (${Object.entries(counts)
    .map(([l, n]) => `${n} ${l}`)
    .join(', ')}).`,
  '',
  `Not bundled: KaTeX ${katexVersion} (MIT) and Mermaid ${mermaidVersion} (MIT) are loaded from jsDelivr at run time, only when a document uses math or a diagram. MikeDown itself (\`@mikedown/core\`, \`@mikedown/web-component\`) is MIT, see \`LICENSE.md\`.`,
  '',
];
for (const { dir, json } of entries) {
  const repo = typeof json.repository === 'string' ? json.repository : json.repository?.url;
  lines.push(`## ${json.name} ${json.version}`, '');
  lines.push(`License: ${licenseOf(json)}${repo ? `  \nRepository: ${repo.replace(/^git\+/, '')}` : ''}`, '');
  const text = licenseText(dir);
  if (text) {
    lines.push('```text', text.replace(/```/g, '\\`\\`\\`'), '```', '');
  } else {
    lines.push(`The package ships no license file; its \`package.json\` declares ${licenseOf(json)}.`, '');
  }
}
writeFileSync(NOTICES, `${lines.join('\n').trimEnd()}\n`);

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
// What a page loads up front (the entry and its static imports), and the AI chunk.
const outputs = Object.keys(result.metafile.outputs).filter((f) => f.endsWith('.js')).map((f) => resolve(pkgDir, f));
const aiChunks = outputs.filter((f) => /mikedown-editor\.ai-ui-[^/\\]+\.js$/.test(f));
if (aiChunks.length !== 1) {throw new Error(`build-standalone: expected one AI chunk, found ${aiChunks.length}`);}
const size = (files) => files.reduce((acc, f) => {
  const buf = readFileSync(f);
  return { raw: acc.raw + buf.length, gz: acc.gz + gzipSync(buf).length };
}, { raw: 0, gz: 0 });
const upFront = size(outputs.filter((f) => !aiChunks.includes(f)));
const ai = size(aiChunks);
console.log(
  `build-standalone: ${relative(pkgDir, OUT).split(sep).join('/')} and its chunks ${kb(upFront.raw)} raw, ${kb(upFront.gz)} gzipped; ` +
    `AI chunk ${kb(ai.raw)} raw, ${kb(ai.gz)} gzipped; ` +
    `${entries.length} packages in THIRD_PARTY_NOTICES.md; katex ${katexVersion}, mermaid ${mermaidVersion} from jsDelivr`,
);
