import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const page = (p) => resolve(root, p, 'index.html');

// Multi-page site served from https://www.iadev.net/mikedown/. The desktop
// download page at /mikedown/ (mikedown-desktop/) is NOT part of this build; the
// desktop release script renders it. developers/angular/index.html here is only a
// placeholder: build:angular overwrites it with the Angular CLI build.
export default defineConfig({
  root,
  base: '/mikedown/',
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
