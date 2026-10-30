// Header and footer markup for every MikeDown site page, plus the helpers that
// put them in place. Pure string functions, no I/O.
//
// Vite pages (vscode/, developers/...): write the markers below in the HTML and
// link the stylesheet; shared/vite-plugin.js fills the markers at dev and build.
//
//   <link rel="stylesheet" href="/shared/shell.css">
//   <!--shell:header page="vscode"-->      page: desktop | vscode | developers | compare
//   <main id="main">...</main>
//   <!--shell:footer-->
//
// The Angular demo: add the same markers to its src/index.html and
// "../shared/shell.css" to its angular.json styles; scripts/build-angular.mjs
// runs applyShellMarkers on the built index.html.
//
// The desktop page (mikedown-desktop/index.html) is not built by Vite, so it
// carries rendered copies between begin/end markers; scripts/sync-desktop-shell.js
// rewrites them from here and from shell.css.

export const SITE_BASE = '/mikedown/';
export const GITHUB_URL = 'https://github.com/mikejoseph23/mikedown';
export const MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor';

const PAGES = [
  { id: 'desktop', label: 'Desktop', href: SITE_BASE },
  { id: 'vscode', label: 'VS Code', href: `${SITE_BASE}vscode/` },
  { id: 'developers', label: 'Developers', href: `${SITE_BASE}developers/` },
];
// Pages that use the shell but have no main-nav entry (linked from the footer).
const UNLISTED = ['compare'];

// The MikeDown mark (the extension icon's M and down arrow), drawn in currentColor.
const MARK = '<svg width="24" height="24" viewBox="0 0 128 128" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="20,86 20,30 64,66 108,30 108,86" stroke-width="13"/><polyline points="49,99 64,114 79,99" stroke-width="10"/></g></svg>';
const GITHUB_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/></svg>';

export function renderHeader(page) {
  if (!PAGES.some((p) => p.id === page) && !UNLISTED.includes(page)) {
    throw new Error(`renderHeader: unknown page "${page}" (expected ${[...PAGES.map((p) => p.id), ...UNLISTED].join(', ')})`);
  }
  const links = PAGES.map((p) => `<a href="${p.href}"${p.id === page ? ' aria-current="page"' : ''}>${p.label}</a>`).join('\n        ');
  return `<a class="site-skip" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="site-container site-header__inner">
      <a class="site-brand" href="${SITE_BASE}">${MARK}<span>MikeDown</span></a>
      <nav class="site-nav" aria-label="Main">
        ${links}
        <a href="${GITHUB_URL}">${GITHUB_ICON}GitHub</a>
      </nav>
    </div>
  </header>`;
}

export function renderFooter() {
  return `<footer class="site-footer">
    <div class="site-container">
      <p>MikeDown is made by Interapp Development, Inc.</p>
      <nav aria-label="Footer">
        <a href="${SITE_BASE}">MikeDown Desktop</a>
        <a href="${SITE_BASE}vscode/">MikeDown for VS Code</a>
        <a href="${SITE_BASE}developers/">For developers</a>
        <a href="${SITE_BASE}compare/">Compare</a>
        <a href="${GITHUB_URL}">Source on GitHub</a>
        <a href="${SITE_BASE}#privacy">Privacy</a>
      </nav>
    </div>
  </footer>`;
}

const HEADER_MARKER = /<!--\s*shell:header\s+page="([a-z]+)"\s*-->/g;
const FOOTER_MARKER = /<!--\s*shell:footer\s*-->/g;

/** Fill <!--shell:header page="..."--> and <!--shell:footer--> markers. */
export function applyShellMarkers(html) {
  return html
    .replace(HEADER_MARKER, (_, page) => renderHeader(page))
    .replace(FOOTER_MARKER, () => renderFooter());
}

function replaceBetween(html, begin, end, body, what) {
  const start = html.indexOf(begin);
  const stop = html.indexOf(end);
  if (start < 0 || stop < start || html.indexOf(begin, start + 1) >= 0) {
    throw new Error(`desktop page: expected exactly one ${begin} ... ${end} block (${what})`);
  }
  return html.slice(0, start + begin.length) + body + html.slice(stop);
}

/**
 * The desktop page with its shell blocks rewritten: shell.css between
 * shell:css markers, the header and the footer between theirs.
 */
export function syncDesktopShell(html, css) {
  let out = replaceBetween(html, '/* shell:css:begin */', '/* shell:css:end */', `\n${css.trim()}\n    `, 'stylesheet');
  out = replaceBetween(out, '<!--shell:header:begin-->', '<!--shell:header:end-->', `\n  ${renderHeader('desktop')}\n  `, 'header');
  out = replaceBetween(out, '<!--shell:footer:begin-->', '<!--shell:footer:end-->', `\n  ${renderFooter()}\n  `, 'footer');
  return out;
}
