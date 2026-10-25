// Consumer smoke test: packs @mikedown/core and each wrapper, scaffolds a throwaway app per
// target, installs the tarballs and builds, exactly as a user of the published packages would.
//
//   npm run test:consumers                         every target
//   npm run test:consumers -- --only wc-vite,vue-vite
//   npm run test:consumers -- --list               print target names
//   npm run test:consumers -- --fresh              delete the cached apps first
//   npm run test:consumers -- --from-registry      install the published @mikedown/*@<core version> from npm instead of tarballs
//
// Scaffolded apps (and their node_modules) are cached in $MIKEDOWN_SMOKE_DIR
// (default: <os tmpdir>/mikedown-consumer-smoke), so re-runs skip `ng new` and the big
// installs; only the tarballs are swapped. Nothing is written inside the repo.
// Needs network (npm registry) on the first run of each target.
import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { ROOT, buildPackage, discoverPackages } from './lib/npm-packages.mjs';

const WORK = process.env.MIKEDOWN_SMOKE_DIR || join(tmpdir(), 'mikedown-consumer-smoke');
const TARBALLS = join(WORK, 'tarballs');
const APPS = join(WORK, 'apps');

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const valueOf = (n) => {
  const i = argv.indexOf(n);
  return i === -1 ? null : argv[i + 1];
};

const FROM_REGISTRY = flag('--from-registry');
const REGISTRY_VERSION = FROM_REGISTRY ? JSON.parse(readFileSync(join(ROOT, 'packages/core/package.json'), 'utf8')).version : null;

// ---------------------------------------------------------------- helpers

function sh(cmd, args, { cwd, label, env } = {}) {
  const t = Date.now();
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env, CI: '1', NEXT_TELEMETRY_DISABLED: '1', NG_CLI_ANALYTICS: 'false' },
    maxBuffer: 256 * 1024 * 1024,
  });
  const secs = (Date.now() - t) / 1000;
  return { ok: r.status === 0, stdout: r.stdout || '', out: `${r.stdout || ''}${r.stderr || ''}`, secs, label: label || `${cmd} ${args.join(' ')}` };
}

function must(r) {
  if (!r.ok) {
    const tail = r.out.trim().split('\n').slice(-40).join('\n');
    throw new Error(`${r.label} failed\n${tail}`);
  }
  return r;
}

function log(msg) {
  console.log(msg);
}

function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content.endsWith('\n') ? content : `${content}\n`);
  }
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

/** Raw and gzipped bytes of the JS and CSS under dir (source maps and dictionaries excluded). */
function bundleSize(dir) {
  let raw = 0;
  let gz = 0;
  for (const f of walk(dir)) {
    if (!/\.(m?js|css)$/.test(f)) continue;
    if (/dictionaries/.test(relative(dir, f))) continue;
    const buf = readFileSync(f);
    raw += buf.length;
    gz += gzipSync(buf).length;
  }
  return { raw, gz };
}

const kb = (n) => `${(n / 1024).toFixed(0)} kB`;

// ---------------------------------------------------------------- tarballs

/** Pack core and the wrappers once per run. Names carry a content hash so a changed tarball is a new file. */
function packAll(names) {
  mkdirSync(TARBALLS, { recursive: true });
  for (const f of readdirSync(TARBALLS)) rmSync(join(TARBALLS, f));
  const pkgs = discoverPackages().filter((p) => names.includes(p.folder));
  const out = {};
  for (const pkg of pkgs) {
    log(`pack ${pkg.name}`);
    let packDir = pkg.dirPath;
    if (pkg.nonWorkspace) {
      buildPackage(pkg);
      packDir = pkg.publishDir;
    }
    const r = must(sh('npm', ['pack', '--pack-destination', TARBALLS], { cwd: packDir, label: `npm pack ${pkg.name}` }));
    const file = r.stdout.trim().split('\n').pop().trim();
    const src = join(TARBALLS, file);
    const hash = createHash('sha1').update(readFileSync(src)).digest('hex').slice(0, 8);
    const named = join(TARBALLS, file.replace(/\.tgz$/, `-${hash}.tgz`));
    cpSync(src, named);
    rmSync(src);
    out[pkg.folder] = { path: named, version: pkg.version };
  }
  return out;
}

// ---------------------------------------------------------------- targets

const VITE_CONFIG_PLAIN = 'export default {};';
const TSCONFIG_BUNDLER = (extra = {}) =>
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        strict: true, noEmit: true, skipLibCheck: false, isolatedModules: true, types: ['vite/client'], ...extra,
      },
      include: ['src'],
    },
    null,
    2,
  );

const pkgJson = (name, scripts, deps = {}, devDeps = {}) =>
  JSON.stringify({ name, version: '0.0.0', private: true, type: 'module', scripts, dependencies: deps, devDependencies: devDeps }, null, 2);

const MARKDOWN = '# Hello\\n\\nSmoke **test**.';

/** Each target: wrappers to pack, files to (re)write, third-party deps, build command and output folder. */
const TARGETS = {
  'wc-vite': {
    note: 'vanilla Vite, @mikedown/web-component/define',
    packs: ['core', 'web-component'],
    files: () => ({
      'package.json': pkgJson('wc-vite', { build: 'tsc && vite build' }, {}, { vite: 'latest', typescript: 'latest' }),
      'vite.config.js': VITE_CONFIG_PLAIN,
      'tsconfig.json': TSCONFIG_BUNDLER(),
      'index.html': '<!doctype html><html><body><mikedown-editor id="e" name="body"></mikedown-editor><script type="module" src="/src/main.ts"></script></body></html>',
      'src/main.ts': `import '@mikedown/core/styles.css';
import '@mikedown/web-component/define';
import { MikeDownElement } from '@mikedown/web-component';
const el = document.getElementById('e') as MikeDownElement;
el.value = '${MARKDOWN}';
`,
    }),
    build: ['npm', ['run', 'build']],
    out: 'dist',
  },
  'wc-cdn': {
    note: 'static HTML + the standalone bundle from the tarball (loaded in jsdom)',
    packs: ['core', 'web-component'],
    files: () => ({
      'package.json': pkgJson('wc-cdn', {}, {}, {}),
      'index.html': '<!doctype html><html><body><mikedown-editor name="body" value="# Hello"></mikedown-editor><script type="module" src="./node_modules/@mikedown/web-component/dist/mikedown-editor.standalone.js"></script></body></html>',
    }),
    custom: async (dir) => {
      const bundle = join(dir, 'node_modules/@mikedown/web-component/dist/mikedown-editor.standalone.js');
      if (!existsSync(bundle)) throw new Error('standalone bundle missing from the installed tarball');
      must(sh('node', ['--check', bundle], { label: 'node --check standalone bundle' }));
      const { JSDOM } = await import(pathToFileURL(join(ROOT, 'node_modules/jsdom/lib/api.js')).href);
      const dom = new JSDOM(readFileSync(join(dir, 'index.html'), 'utf8'), { pretendToBeVisual: true });
      const w = dom.window;
      for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'MutationObserver', 'getComputedStyle', 'DOMParser', 'Event', 'CustomEvent', 'ElementInternals']) {
        if (w[k] !== undefined) Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true });
      }
      Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true, writable: true });
      await import(pathToFileURL(bundle).href);
      if (!w.customElements.get('mikedown-editor')) throw new Error('standalone bundle did not define <mikedown-editor> in jsdom');
      const el = w.document.querySelector('mikedown-editor');
      if (!el) throw new Error('no <mikedown-editor> element in the page');
      const buf = readFileSync(bundle);
      return { raw: buf.length, gz: gzipSync(buf).length };
    },
  },
  'react-vite': {
    note: 'Vite + React 18',
    packs: ['core', 'react'],
    files: () => ({
      'package.json': pkgJson('react-vite', { build: 'tsc && vite build' }, { react: '18', 'react-dom': '18' }, { vite: 'latest', '@vitejs/plugin-react': 'latest', typescript: 'latest', '@types/react': '18', '@types/react-dom': '18' }),
      'vite.config.ts': "import react from '@vitejs/plugin-react';\nexport default { plugins: [react()] };",
      'tsconfig.json': TSCONFIG_BUNDLER({ jsx: 'react-jsx' }),
      'index.html': '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
      'src/main.tsx': `import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MikeDownEditor } from '@mikedown/react';
import '@mikedown/core/styles.css';
function App() {
  const [md, setMd] = useState('${MARKDOWN}');
  return <MikeDownEditor value={md} onChange={setMd} aria-label="Notes" style={{ height: 400 }} />;
}
createRoot(document.getElementById('root')!).render(<App />);
`,
    }),
    build: ['npm', ['run', 'build']],
    out: 'dist',
  },
  'react-next': {
    note: 'Next.js app router + React 19 (next build prerenders on the server)',
    packs: ['core', 'react'],
    files: () => ({
      'package.json': pkgJson('react-next', { build: 'next build' }, { next: 'latest', react: '19', 'react-dom': '19' }, { typescript: 'latest', '@types/react': '19', '@types/react-dom': '19', '@types/node': '22' }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', lib: ['dom', 'dom.iterable', 'esnext'], strict: true, noEmit: true, module: 'esnext', moduleResolution: 'bundler', jsx: 'preserve', incremental: true, skipLibCheck: false, esModuleInterop: true, isolatedModules: true, plugins: [{ name: 'next' }] }, include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'], exclude: ['node_modules'] }, null, 2),
      'next.config.mjs': 'export default {};',
      'app/layout.tsx': `import '@mikedown/core/styles.css';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
`,
      'app/editor.tsx': `'use client';
import { useState } from 'react';
import { MikeDownEditor } from '@mikedown/react';
export function Editor() {
  const [md, setMd] = useState('${MARKDOWN}');
  return <MikeDownEditor value={md} onChange={setMd} aria-label="Notes" style={{ height: 400 }} />;
}
`,
      'app/page.tsx': `import { Editor } from './editor';
export default function Page() {
  return <main><h1>Smoke</h1><Editor /></main>;
}
`,
    }),
    // Next (Turbopack) fails on core's lazy import('mermaid') when mermaid is not installed; Vite 7/8 builds fine.
    deps: { mermaid: true },
    build: ['npm', ['run', 'build']],
    out: '.next/static',
    cleanBefore: ['.next'],
  },
  'vue-vite': {
    note: 'Vite + Vue 3',
    packs: ['core', 'vue'],
    files: () => ({
      'package.json': pkgJson('vue-vite', { build: 'vue-tsc --noEmit && vite build' }, { vue: 'latest' }, { vite: 'latest', '@vitejs/plugin-vue': 'latest', typescript: '~5.8', 'vue-tsc': 'latest' }),
      'vite.config.ts': "import vue from '@vitejs/plugin-vue';\nexport default { plugins: [vue()] };",
      'tsconfig.json': TSCONFIG_BUNDLER({ jsx: 'preserve' }),
      'index.html': '<!doctype html><html><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>',
      'src/env.d.ts': `declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const c: DefineComponent<{}, {}, any>;
  export default c;
}`,
      'src/main.ts': "import { createApp } from 'vue';\nimport App from './App.vue';\nimport '@mikedown/core/styles.css';\ncreateApp(App).mount('#app');",
      'src/App.vue': `<script setup lang="ts">
import { ref } from 'vue';
import { MikeDownEditor } from '@mikedown/vue';
const md = ref('${MARKDOWN}');
</script>
<template>
  <label id="notes-label">Notes</label>
  <MikeDownEditor v-model="md" aria-labelledby="notes-label" />
</template>
`,
    }),
    build: ['npm', ['run', 'build']],
    out: 'dist',
  },
  'angular-17': angularTarget('17'),
  'angular-19': angularTarget('19'),
  'angular-latest': angularTarget('latest'),
  'angular-19-no-mermaid': { ...angularTarget('19'), note: 'Angular 19 without mermaid installed, externalDependencies: ["mermaid"]', mermaid: 'external', extra: true },
};

function angularTarget(version) {
  return {
    note: `Angular CLI ${version} app, @mikedown/angular`,
    packs: ['core', 'angular'],
    angular: version,
    mermaid: 'install',
    build: ['npx', ['ng', 'build']],
  };
}

// ---------------------------------------------------------------- angular scaffolding

function patchAngular(dir, name, target) {
  const ngPath = join(dir, 'angular.json');
  const ng = JSON.parse(readFileSync(ngPath, 'utf8'));
  const project = Object.values(ng.projects)[0];
  const buildOpts = project.architect.build.options;
  buildOpts.styles = ['node_modules/@mikedown/core/dist/styles.css', ...(buildOpts.styles || [])];
  buildOpts.assets = [
    ...(buildOpts.assets || []),
    { glob: '**/*', input: 'node_modules/@mikedown/core/dist/dictionaries', output: 'assets/mikedown-dictionaries' },
  ];
  if (target.mermaid === 'external') buildOpts.externalDependencies = ['mermaid'];
  else delete buildOpts.externalDependencies;
  const prod = project.architect.build.configurations?.production;
  if (prod && process.env.SMOKE_KEEP_BUDGETS !== '1') prod.budgets = []; // see the summary: default budgets reject the editor
  writeFileSync(ngPath, JSON.stringify(ng, null, 2));

  const appDir = join(dir, 'src/app');
  const compFile = existsSync(join(appDir, 'app.component.ts')) ? 'app.component.ts' : 'app.ts';
  const old = readFileSync(join(appDir, compFile), 'utf8');
  const cls = /export class (\w+)/.exec(old)[1];
  const selector = /selector:\s*'([^']+)'/.exec(old)[1];
  writeFileSync(
    join(appDir, compFile),
    `import { Component } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MikeDownEditorComponent } from '@mikedown/angular';

@Component({
  selector: '${selector}',
  standalone: true,
  imports: [ReactiveFormsModule, MikeDownEditorComponent],
  template: \`
    <form [formGroup]="form">
      <label for="notes">Notes</label>
      <mikedown-editor formControlName="notes" inputId="notes" minHeight="320px" spellcheckDictionaryUrl="/assets/mikedown-dictionaries" />
    </form>
  \`,
})
export class ${cls} {
  form = new FormGroup({
    notes: new FormControl('# Hello', { nonNullable: true, validators: [Validators.required] }),
  });
}
`,
  );
}

// ---------------------------------------------------------------- run one target

function readVersion(dir, pkg) {
  try {
    return JSON.parse(readFileSync(join(dir, 'node_modules', pkg, 'package.json'), 'utf8')).version;
  } catch {
    return '?';
  }
}

async function runTarget(name, target, tarballs) {
  const dir = join(APPS, name);
  const result = { name, ok: false, secs: 0, size: null, versions: '', notes: [] };
  const t0 = Date.now();
  try {
    // Scaffold once (cached).
    if (target.angular) {
      if (!existsSync(join(dir, 'angular.json'))) {
        log(`  ng new (Angular CLI ${target.angular}) ...`);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(APPS, { recursive: true });
        const ngNew = sh('npx', ['--yes', `@angular/cli@${target.angular}`, 'new', name, '--skip-git', '--skip-install', '--defaults', '--style=css', '--routing=false', '--ssr=false'], { cwd: APPS, label: 'ng new' });
        if (!ngNew.ok && /requires a minimum Node\.js version/.test(ngNew.out)) {
          result.skipped = true;
          result.notes.push(`skipped: ${/minimum Node\.js version of [^\n]*/.exec(ngNew.out)[0]} (running ${process.version})`);
          result.secs = (Date.now() - t0) / 1000;
          return result;
        }
        must(ngNew);
        must(sh('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, label: 'npm install (angular base)' }));
      }
    } else {
      mkdirSync(dir, { recursive: true });
      writeFiles(dir, target.files());
    }

    // Swap in the freshly packed tarballs.
    rmSync(join(dir, 'node_modules/@mikedown'), { recursive: true, force: true });
    for (const c of target.cleanBefore || []) rmSync(join(dir, c), { recursive: true, force: true });
    const spec = target.packs.map((p) => (FROM_REGISTRY ? `@mikedown/${p}@${REGISTRY_VERSION}` : `file:${tarballs[p].path}`));
    const extra = [];
    if (target.deps?.mermaid || target.mermaid === 'install') extra.push('mermaid');
    log('  installing tarballs ...');
    const inst = must(sh('npm', ['install', '--no-audit', '--no-fund', ...spec, ...extra], { cwd: dir, label: 'npm install tarballs' }));
    result.notes.push(`install ${inst.secs.toFixed(0)}s`);
    if (target.angular) patchAngular(dir, name, target);

    result.versions = ['@angular/core', 'vite', 'next', 'react', 'vue']
      .map((p) => [p, readVersion(dir, p)])
      .filter(([, v]) => v !== '?')
      .map(([p, v]) => `${p.replace('@angular/core', 'angular')}@${v}`)
      .join(' ');

    // Build.
    log('  building ...');
    let sizeDir;
    const tb = Date.now();
    if (target.custom) {
      const size = await target.custom(dir);
      result.size = size;
      result.buildSecs = (Date.now() - tb) / 1000;
    } else {
      rmSync(join(dir, target.out || 'dist'), { recursive: true, force: true });
      const [cmd, args] = target.build;
      const prefixed = target.angular ? ['--no-install', ...args] : args;
      const b = must(sh(cmd, cmd === 'npx' ? prefixed : args, { cwd: dir, label: `${cmd} ${args.join(' ')}` }));
      result.buildSecs = b.secs;
      sizeDir = target.angular ? join(dir, 'dist', name, 'browser') : join(dir, target.out);
      result.size = bundleSize(sizeDir);
      if (/Could not resolve "mermaid"/.test(b.out)) result.notes.push('mermaid unresolved (warning)');
    }
    result.ok = true;
  } catch (e) {
    result.error = String(e.message || e);
  }
  result.secs = (Date.now() - t0) / 1000;
  return result;
}

// ---------------------------------------------------------------- main

const names = Object.keys(TARGETS);
if (flag('--list')) {
  for (const n of names) console.log(`${n.padEnd(24)} ${TARGETS[n].note}`);
  process.exit(0);
}
if (flag('--fresh')) rmSync(APPS, { recursive: true, force: true });

const onlyArg = valueOf('--only');
let selected = onlyArg ? onlyArg.split(',').map((s) => s.trim()) : names;
for (const n of selected) {
  if (!TARGETS[n]) {
    console.error(`consumer-smoke: unknown target "${n}". Have: ${names.join(', ')}`);
    process.exit(1);
  }
}

log(`work dir: ${WORK}`);
const needed = [...new Set(selected.flatMap((n) => TARGETS[n].packs))];
const tarballs = FROM_REGISTRY ? {} : packAll(needed);
if (FROM_REGISTRY) log(`registry mode: @mikedown/*@${REGISTRY_VERSION}`);

const results = [];
for (const n of selected) {
  log(`\n== ${n}: ${TARGETS[n].note}`);
  const r = await runTarget(n, TARGETS[n], tarballs);
  log(r.skipped ? `  SKIPPED ${r.notes.join('; ')}` : r.ok ? `  ok (${r.secs.toFixed(0)}s)` : `  FAILED\n${r.error}`);
  results.push(r);
}

log('\n| target | result | build | total | js+css raw | gzip | versions | notes |');
log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of results) {
  log(`| ${r.name} | ${r.skipped ? 'skipped' : r.ok ? 'ok' : 'FAIL'} | ${r.buildSecs ? `${r.buildSecs.toFixed(1)}s` : '-'} | ${r.secs.toFixed(0)}s | ${r.size ? kb(r.size.raw) : '-'} | ${r.size ? kb(r.size.gz) : '-'} | ${r.versions} | ${r.notes.join('; ')} |`);
}
const failed = results.filter((r) => !r.ok && !r.skipped);
if (failed.length) {
  console.error(`\n${failed.length} target(s) failed: ${failed.map((r) => r.name).join(', ')}`);
  process.exit(1);
}
