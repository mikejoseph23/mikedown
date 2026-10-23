/**
 * Vite config for MikeDown Desktop (the Tauri webview bundle).
 *
 * Core consumption follows the VS Code extension's rule (webpack.config.js):
 *
 *   - `vite` (dev server, `tauri dev`): `@mikedown/core` resolves to
 *     `../core/src`, `@mikedown/core/shared` to `../core/src/shared`,
 *     `@mikedown/core/tokens.css` to `../core/src/styles/tokens.css`, and
 *     `@mikedown/core/styles.css` to a virtual stylesheet that @imports the
 *     source CSS files in the same cascade order `scripts/build-css.mjs` uses.
 *     Core edits hot-reload; no core build needed.
 *   - `vite build` (release, `tauri build`): no aliases. `@mikedown/core` is
 *     the pinned workspace dependency and resolves through its package exports
 *     to `../core/dist` (run `npm run build:core` first; the config refuses to
 *     build without it).
 *
 *   `MIKEDOWN_CORE=source|dist` overrides the choice for either command.
 *
 * `dictionaries/` (Hunspell, for `spellcheckDictionaryUrl`) is served from
 * core's `dist/dictionaries` when built, else the repo root `dictionaries/`,
 * and copied into the release bundle next to index.html.
 */
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORDER as CORE_CSS_ORDER } from '../core/scripts/build-css.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const coreDir = path.resolve(here, '..', 'core');
const coreSrc = path.join(coreDir, 'src');
const coreDist = path.join(coreDir, 'dist');
const repoRoot = path.resolve(here, '..', '..');

const VIRTUAL_STYLES = '\0mikedown-core-source-styles.css';

/** Dev: resolve `@mikedown/core*` to core's sources. */
function coreFromSource(): Plugin {
  return {
    name: 'mikedown:core-from-source',
    enforce: 'pre',
    resolveId(id) {
      // `?inline` (the export module reads the sheet as text) keeps its query.
      if (id.split('?')[0] === '@mikedown/core/styles.css') {return VIRTUAL_STYLES + id.slice(id.indexOf('?') < 0 ? id.length : id.indexOf('?'));}
      if (id === '@mikedown/core/tokens.css') {return path.join(coreSrc, 'styles', 'tokens.css');}
      if (id === '@mikedown/core') {return path.join(coreSrc, 'index.ts');}
      if (id.startsWith('@mikedown/core/')) {
        // `@mikedown/core/shared/imagePaste` → `../core/src/shared/imagePaste.ts`
        const file = path.join(coreSrc, id.slice('@mikedown/core/'.length));
        return path.extname(file) ? file : `${file}.ts`;
      }
      return null;
    },
    load(id) {
      if (id.split('?')[0] !== VIRTUAL_STYLES) {return null;}
      const files = ['tokens.css', ...CORE_CSS_ORDER].map((f) => path.join(coreSrc, 'styles', f));
      return [
        '/* @mikedown/core styles from source (vite.config.ts, dev only) */',
        "@import 'katex/dist/katex.min.css';",
        ...files.map((f) => `@import '${f}';`),
      ].join('\n');
    },
  };
}

/** Serve `dictionaries/` in dev and copy it into the release bundle. */
function dictionaries(): Plugin {
  const source = fs.existsSync(path.join(coreDist, 'dictionaries'))
    ? path.join(coreDist, 'dictionaries')
    : path.join(repoRoot, 'dictionaries');
  let config: ResolvedConfig;
  return {
    name: 'mikedown:dictionaries',
    configResolved(c) { config = c; },
    configureServer(server) {
      server.middlewares.use('/dictionaries', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const file = path.normalize(path.join(source, rel));
        if (!file.startsWith(source) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {return next();}
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      if (config.command !== 'build') {return;}
      fs.cpSync(source, path.join(config.root, config.build.outDir, 'dictionaries'), { recursive: true });
    },
  };
}

export default defineConfig(({ command }) => {
  const useSource = process.env.MIKEDOWN_CORE
    ? process.env.MIKEDOWN_CORE === 'source'
    : command === 'serve';
  if (!useSource && !fs.existsSync(path.join(coreDist, 'index.js'))) {
    throw new Error('packages/core/dist is missing: run `npm run build:core` first (or set MIKEDOWN_CORE=source).');
  }
  const isWindows = process.env.TAURI_ENV_PLATFORM === 'windows';
  const debug = !!process.env.TAURI_ENV_DEBUG;

  return {
    plugins: [...(useSource ? [coreFromSource()] : []), dictionaries()],
    define: {
      __MIKEDOWN_CORE_FROM__: JSON.stringify(useSource ? 'source' : 'dist'),
    },
    resolve: {
      mainFields: ['module', 'browser', 'main'],
      // The webview bundle must never pull in Node polyfills.
      conditions: ['browser'],
    },
    // Tauri expects a fixed port; fail if it is taken.
    server: {
      port: 1420,
      strictPort: true,
      watch: { ignored: ['**/src-tauri/**'] },
    },
    clearScreen: false,
    envPrefix: ['VITE_', 'TAURI_ENV_*'],
    build: {
      // Windows uses the evergreen WebView2 (Chromium); macOS 12+ is Safari 15+.
      target: isWindows ? 'chrome105' : 'safari15',
      minify: debug ? false : 'esbuild',
      sourcemap: debug,
      outDir: 'dist',
      emptyOutDir: true,
      // print.html is the print window's page (M9).
      rollupOptions: { input: { main: path.join(here, 'index.html'), print: path.join(here, 'print.html') } },
    },
  };
});
