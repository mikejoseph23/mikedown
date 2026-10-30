// @ts-nocheck: the release helpers are plain ESM JavaScript (deploy/lib).
//
// The site-only package gate: a site release shares the /mikedown folder with
// desktop releases, so it must never carry a manifest, an artifact or web.config.
import { describe, expect, it } from 'vitest';
import { checkSitePackage } from '../../deploy/lib/site-checks.js';

const b = (s = 'x') => Buffer.from(s);
const good = () => ({
  'index.html': b('<html><img src="shot.png"></html>'),
  'shot.png': b(),
  'favicon.ico': b(),
  'apple-touch-icon.png': b(),
  'vscode/index.html': b(),
  'developers/index.html': b(),
  'developers/angular/index.html': b(),
  'developers/angular/main-ABC.js': b(),
  'compare/index.html': b(),
  'site-assets/pic.jpg': b(),
});

describe('checkSitePackage', () => {
  it('accepts a normal site package', () => {
    const r = checkSitePackage({ files: good() });
    expect(r.problems).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it.each([
    ['latest.json', /manifests belong/],
    ['developers/latest-windows-x86_64.json', /manifests belong/],
    ['MikeDown-0.3.0-macos-universal.dmg', /artifacts belong/],
    ['MikeDown-0.3.0-linux-x86_64.AppImage', /artifacts belong/],
    ['web.config', /web\.config is protected/],
    ['vscode/web.config', /web\.config is protected/],
    ['SHA256SUMS.txt', /SHA256SUMS/],
    ['extra.html', /top level/],
    ['downloads/x.html', /not a site folder/],
  ])('rejects %s', (name, re) => {
    const files = good();
    files[name] = b();
    expect(checkSitePackage({ files }).problems.join('\n')).toMatch(re);
  });

  it('requires the site entry pages', () => {
    const files = good();
    delete files['vscode/index.html'];
    expect(checkSitePackage({ files }).problems).toEqual(['vscode/index.html is missing']);
  });

  it('accepts the compare folder and requires its page', () => {
    const files = good();
    files['compare/compare.css'] = b();
    expect(checkSitePackage({ files }).problems).toEqual([]);
    delete files['compare/index.html'];
    expect(checkSitePackage({ files }).problems).toEqual(['compare/index.html is missing']);
  });

  it('still rejects a stray top-level folder next to compare/', () => {
    const files = good();
    files['comparison/index.html'] = b();
    expect(checkSitePackage({ files }).problems.join('\n')).toMatch(/top-level folder 'comparison' is not a site folder/);
  });

  it('requires the images the desktop page shows and rejects unrendered Linux placeholders', () => {
    const files = good();
    files['index.html'] = b('<img src="other.png"> @@LINUX_URL@@');
    const text = checkSitePackage({ files }).problems.join('\n');
    expect(text).toMatch(/other\.png/);
    expect(text).toMatch(/placeholders/);
  });

  it('warns about extensions not known to be served', () => {
    const files = good();
    files['site-assets/f.woff2'] = b();
    files['site-assets/m.webmanifest'] = b();
    expect(checkSitePackage({ files }).warnings.map((w) => w.split(':')[0])).toEqual(['.webmanifest', '.woff2']);
  });
});
