import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import vue from '@vitejs/plugin-vue';
import mikedownShell from './shared/vite-plugin.js';
import { applyDeveloperMarkers, stripKatexImport } from './developers/common/samples.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const page = (p) => resolve(root, p, 'index.html');

function developerPages() {
  return {
    name: 'mikedown-developer-pages',
    enforce: 'pre',
    transformIndexHtml: {
      order: 'pre',
      handler: (html, ctx) => applyDeveloperMarkers(html, dirname(ctx.filename)),
    },
    transform(code, id) {
      if (/[\\/]core[\\/]dist[\\/]styles\.css(\?|$)/.test(id)) {
        return { code: stripKatexImport(code), map: null };
      }
      return null;
    },
  };
}

// Multi-page site served from https://www.iadev.net/mikedown/. The desktop
// download page at /mikedown/ (mikedown-desktop/) is NOT part of this build; the
// desktop release script renders it.
// The developer pages import the wrappers from the workspace (their dist/
// folders: `build` runs build:packages first). developerPages() fills their
// code-sample markers and keeps KaTeX's fonts out of the output
// (developers/common/samples.js). developers/angular/index.html here is only a
// placeholder: build:angular overwrites it with the Angular CLI build.
// The shell plugin fills each page's header and footer markers (shared/partials.js)
// and, in dev and preview, serves the desktop page at /mikedown/ for the nav.
export default defineConfig({
  root,
  base: '/mikedown/',
  plugins: [developerPages(), mikedownShell(), vue()],
  esbuild: { jsx: 'automatic' },
  server: { port: 5180, strictPort: true },
  preview: { port: 5180, strictPort: true },
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    assetsDir: 'site-assets',
    rollupOptions: {
      input: {
        vscode: page('vscode'),
        developers: page('developers'),
        'developers-web-component': page('developers/web-component'),
        'developers-react': page('developers/react'),
        'developers-vue': page('developers/vue'),
        'developers-angular': page('developers/angular'),
      },
    },
  },
});
