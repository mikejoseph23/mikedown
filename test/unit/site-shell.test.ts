import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyShellMarkers, renderFooter, renderHeader, syncDesktopShell } from '../../website/shared/partials.js';
import { renderLinuxPage } from '../../packages/desktop/deploy/lib/publish-checks.js';

const website = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'website');
const read = (p: string) => readFileSync(join(website, p), 'utf8');

describe('site shell partials', () => {
  it('marks only the current page in the header', () => {
    const html = renderHeader('vscode');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('<a href="/mikedown/vscode/" aria-current="page">VS Code</a>');
    expect(html).toContain('href="/mikedown/developers/"');
    expect(html).toContain('href="https://github.com/mikejoseph23/mikedown"');
  });

  it('rejects an unknown page', () => {
    expect(() => renderHeader('blog')).toThrow(/unknown page/);
  });

  it('fills header and footer markers', () => {
    const out = applyShellMarkers('<body><!--shell:header page="developers"--><main id="main"></main><!--shell:footer--></body>');
    expect(out).toContain('class="site-header"');
    expect(out).toContain('<a href="/mikedown/developers/" aria-current="page">Developers</a>');
    expect(out).toContain(renderFooter());
    expect(out).not.toContain('shell:');
  });

  it('keeps shell.css inlinable into the flat desktop folder', () => {
    const css = read('shared/shell.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/url\(|@import/);
  });
});

describe('desktop download page', () => {
  const page = read('mikedown-desktop/index.html');

  it('carries an up-to-date copy of the shell', () => {
    expect(syncDesktopShell(page, read('shared/shell.css'))).toBe(page);
  });

  it('keeps the release placeholders and download buttons', () => {
    expect(page).toContain('@@LINUX_URL@@');
    expect(page).toContain('@@LINUX_MB@@');
    expect(page).toContain('data-dl="mac"');
    expect(page).toContain('data-dl="windows"');
    expect(page).toContain('aria-current="page">Desktop</a>');
  });

  it('links the VS Code page, the Marketplace and the developers page', () => {
    expect(page).toContain('href="/mikedown/vscode/"');
    expect(page).toContain('href="/mikedown/developers/"');
    expect(page).toContain('https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor');
  });

  it('renders without Linux and shows only local images it ships', () => {
    const html: string = renderLinuxPage(page, null);
    expect(html).not.toMatch(/@@LINUX_|<!--linux:begin-->/);
    for (const [, src] of html.matchAll(/\bsrc="([^"]+)"/g)) {
      expect(existsSync(join(website, 'mikedown-desktop', src))).toBe(true);
    }
  });
});

describe('VS Code page', () => {
  const page = read('vscode/index.html');

  it('uses the shell and its own copies of the screenshots', () => {
    expect(page).toContain('<!--shell:header page="vscode"-->');
    expect(page).toContain('<!--shell:footer-->');
    expect(page).not.toContain('../assets/');
    for (const [, src] of page.matchAll(/\b(?:src|srcset)="\.\/([^"]+\.jpg)"/g)) {
      expect(existsSync(join(website, 'vscode', src))).toBe(true);
    }
  });

  it('offers the Marketplace and the VS Code deep link, and no stale links', () => {
    expect(page).toContain('href="https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor"');
    expect(page).toContain('href="vscode:extension/interapp.mikedown-editor"');
    expect(page).not.toMatch(/github\.com\/michaeljoseph\b/);
    expect(page).not.toMatch(/\bbeta\b/i);
  });
});
