// Vite plugin for the MikeDown site shell.
//
// - Fills the <!--shell:header page="..."--> and <!--shell:footer--> markers
//   in every page (see partials.js).
// - In `vite` and `vite preview`, serves the desktop download page at
//   /mikedown/ with its screenshots, so the Desktop nav link works locally.
//   It is rendered with no Linux build; the download buttons keep their
//   fallback hrefs because the updater manifests are not served here. The real
//   page is staged by the desktop release (render-page.js) and by
//   pack-for-lymedeploy.sh --site, never by this build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyShellMarkers, SITE_BASE } from './partials.js';
import { renderLinuxPage } from '../../packages/desktop/deploy/lib/publish-checks.js';

const desktopDir = fileURLToPath(new URL('../mikedown-desktop/', import.meta.url));

function desktopPage(req, res, next) {
  const url = (req.url ?? '').split('?')[0];
  if (url === SITE_BASE || url === `${SITE_BASE}index.html`) {
    const html = renderLinuxPage(fs.readFileSync(path.join(desktopDir, 'index.html'), 'utf8'), null);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
    return;
  }
  const shot = url.startsWith(SITE_BASE) ? url.slice(SITE_BASE.length) : '';
  if (/^[A-Za-z0-9._-]+\.png$/.test(shot) && fs.existsSync(path.join(desktopDir, shot))) {
    res.setHeader('Content-Type', 'image/png');
    fs.createReadStream(path.join(desktopDir, shot)).pipe(res);
    return;
  }
  next();
}

export default function mikedownShell() {
  return {
    name: 'mikedown-shell',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => applyShellMarkers(html),
    },
    configureServer(server) {
      server.middlewares.use(desktopPage);
    },
    configurePreviewServer(server) {
      server.middlewares.use(desktopPage);
    },
  };
}
