// Link checks over the built site (website/dist) and the desktop page source.
// No network: external links are checked by their shape, not fetched.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module without types
import { renderLinuxPage } from '../../packages/desktop/deploy/lib/publish-checks.js';

const site = resolve(__dirname, '..');
const dist = join(site, 'dist');
const desktopDir = join(site, 'mikedown-desktop');
const built = existsSync(join(dist, 'developers/index.html'));
const BASE = '/mikedown/';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p, out);
    } else {
      out.push(p);
    }
  }
  return out;
}

// Workspace packages that are published to npm.
const packagesDir = resolve(site, '../packages');
const publicPackages = new Set(
  readdirSync(packagesDir)
    .map((d) => join(packagesDir, d, 'package.json'))
    .filter((p) => existsSync(p))
    .map((p) => JSON.parse(readFileSync(p, 'utf8')))
    .filter((j) => !j.private && typeof j.name === 'string')
    .map((j) => j.name as string),
);

type Page = { url: string; file: string; html: string };

// URL path (under /mikedown/) -> page. The desktop page is rendered by the Desktop
// release script, so its source (Linux blocks removed, as the dev server does) stands in.
function pages(): Page[] {
  const list: Page[] = walk(dist)
    .filter((f) => f.endsWith('.html'))
    .map((file) => ({
      url: BASE + relative(dist, dirname(file)).split('\\').join('/') + '/',
      file,
      html: readFileSync(file, 'utf8'),
    }));
  const desktop = join(desktopDir, 'index.html');
  list.push({ url: BASE, file: desktop, html: renderLinuxPage(readFileSync(desktop, 'utf8'), null) as string });
  return list;
}

function refs(html: string): { attr: string; value: string }[] {
  const out: { attr: string; value: string }[] = [];
  const re = /\s(href|src)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out.push({ attr: m[1], value: m[2].replace(/&amp;/g, '&') });
  }
  return out;
}

function ids(html: string): Set<string> {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
}

/** Where a site path (starting with /mikedown/) lives on disk, or null. */
function locate(sitePath: string): string | null {
  const rel = sitePath.slice(BASE.length);
  if (rel === '' || rel === 'index.html') {
    return join(desktopDir, 'index.html');
  }
  for (const root of [dist, desktopDir]) {
    const p = join(root, rel);
    if (existsSync(p)) {
      return statSync(p).isDirectory() ? (existsSync(join(p, 'index.html')) ? join(p, 'index.html') : null) : p;
    }
  }
  return null;
}

describe.skipIf(!built)('built site links', () => {
  const all = pages();

  it('finds the expected pages', () => {
    expect(all.map((p) => p.url).sort()).toEqual(
      [
        BASE,
        BASE + 'developers/',
        BASE + 'developers/angular/',
        BASE + 'developers/react/',
        BASE + 'developers/vue/',
        BASE + 'developers/web-component/',
        BASE + 'vscode/',
      ].sort(),
    );
  });

  for (const page of all) {
    describe(page.url, () => {
      const links = refs(page.html);

      it('internal links and assets resolve', () => {
        const problems: string[] = [];
        for (const { value } of links) {
          if (/^(https?:|mailto:|data:|tel:|javascript:|vscode:)/.test(value) || value === '') {
            continue;
          }
          const [pathPart, hash] = value.split('#');
          let target: string | null;
          let targetHtml: string | null = null;
          if (pathPart === '') {
            target = page.file;
          } else {
            const sitePath = pathPart.startsWith('/')
              ? pathPart
              : new URL(pathPart, `http://x${page.url}`).pathname;
            if (!sitePath.startsWith(BASE)) {
              problems.push(`${value}: outside ${BASE}`);
              continue;
            }
            target = locate(sitePath);
          }
          if (!target) {
            problems.push(`${value}: no such file`);
            continue;
          }
          if (hash && target.endsWith('.html')) {
            targetHtml = target === page.file ? page.html : readFileSync(target, 'utf8');
            if (!ids(targetHtml).has(hash)) {
              problems.push(`${value}: no element with id "${hash}"`);
            }
          }
        }
        expect(problems).toEqual([]);
      });

      it('npm links name a package in this workspace', () => {
        const bad = links
          .map((l) => l.value)
          .filter((v) => /^https?:\/\/(www\.)?npmjs\.com\//.test(v))
          .filter((v) => {
            const m = v.match(/^https:\/\/www\.npmjs\.com\/package\/(@[^/]+\/[^/?#]+|[^/?#]+)$/);
            return !m || !publicPackages.has(decodeURIComponent(m[1]));
          });
        expect(bad).toEqual([]);
      });

      it('Marketplace and GitHub links use the right publisher and owner', () => {
        const bad: string[] = [];
        for (const { value } of links) {
          if (/marketplace\.visualstudio\.com/.test(value)) {
            if (!/[?&]itemName=interapp\.mikedown-editor(&|$)/.test(value)) {
              bad.push(value);
            }
          }
          if (/^vscode:extension\//.test(value) && value !== 'vscode:extension/interapp.mikedown-editor') {
            bad.push(value);
          }
          const gh = value.match(/^https:\/\/github\.com\/([^/]+)/);
          if (gh && gh[1] !== 'mikejoseph23') {
            bad.push(value);
          }
        }
        expect(bad).toEqual([]);
      });
    });
  }

  it('built CSS only references files that exist', () => {
    const problems: string[] = [];
    for (const css of walk(dist).filter((f) => f.endsWith('.css'))) {
      for (const m of readFileSync(css, 'utf8').matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
        const u = m[1];
        if (/^(data:|https?:|#)/.test(u)) {
          continue;
        }
        const target = u.startsWith('/')
          ? locate(u.split(/[?#]/)[0])
          : resolve(dirname(css), u.split(/[?#]/)[0]);
        if (!target || !existsSync(target)) {
          problems.push(`${relative(dist, css)}: ${u}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
