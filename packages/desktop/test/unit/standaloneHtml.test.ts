import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inlineCssUrls, keepWoff2Only } from '../../src/export/cssInline';
import {
  buildStandaloneHtml,
  extractTitle,
  prepareImages,
  remoteUrls,
  suggestedExportName,
  type ImageHooks,
} from '../../src/export/standaloneHtml';

const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const hooks: ImageHooks = {
  async load(raw) {
    if (raw.includes('missing')) {return null;}
    return { mime: raw.endsWith('.svg') ? 'image/svg+xml' : 'image/png', bytes: PNG };
  },
};

const BODY = `<h1>Hello &amp; welcome</h1><p><img src="asset://localhost/x/a.png" data-mikedown-src="images/a.png" alt="a"></p>
<p><img src="asset://localhost/x/b.png" data-mikedown-src="images/a.png"><img src="https://example.com/r.png"><img src="data:image/png;base64,AAAA"><img src="asset://x" data-mikedown-src="missing.png"></p>
<h2>Second</h2><h2>Second</h2><a href="#second" target="_blank" rel="noopener">jump</a>`;

describe('extractTitle', () => {
  it('uses the first H1, entities decoded, tags stripped', () => {
    expect(extractTitle('<h1>Hello <em>&amp;</em> world</h1><h1>Other</h1>', 'a.md')).toBe('Hello & world');
  });
  it('falls back to the file name, then Untitled', () => {
    expect(extractTitle('<p>none</p>', '/notes/My Notes.md')).toBe('My Notes');
    expect(extractTitle('<h1> </h1>', 'C:\\docs\\plan.markdown')).toBe('plan');
    expect(extractTitle('<p>none</p>', null)).toBe('Untitled');
  });
});

describe('prepareImages', () => {
  it('inlines local images as data: URIs, once per source, and drops the raw-src attribute', async () => {
    const r = await prepareImages(BODY, hooks, 'inline', 'x_files');
    expect(r.html).toContain('src="data:image/png;base64,iVBORwECAw=="');
    expect(r.html.match(/base64,iVBORwECAw==/g)).toHaveLength(2);
    expect(r.html).not.toContain('asset://localhost');
    expect(r.html).not.toContain('data-mikedown-src="images');
    expect(r.sidecar).toEqual([]);
    expect(r.remoteImages).toBe(1);
    expect(r.missingImages).toBe(1);
  });

  it('clears the broken-image flag the editor set before the bytes were available', async () => {
    const html = '<img src="asset://x/a.png" data-mikedown-src="a.png" class="broken-image wide" title="Image not found: asset://x/a.png">';
    const r = await prepareImages(html, hooks, 'inline', 'f');
    expect(r.html).toContain('class="wide"');
    expect(r.html).not.toContain('broken-image');
    expect(r.html).not.toContain('Image not found');
  });

  it('sidecar mode copies each distinct file once and references it relatively', async () => {
    const r = await prepareImages(BODY, hooks, 'sidecar', 'my notes_files');
    expect(r.sidecar.map((f) => f.relPath)).toEqual(['my notes_files/a.png']);
    expect(r.html.match(/src="my%20notes_files\/a\.png"/g)).toHaveLength(2);
    expect(r.html).not.toContain('base64,iVBOR');
  });

  it('keeps colliding file names apart in the sidecar folder', async () => {
    const html = '<img data-mikedown-src="one/a.png" src="x"><img data-mikedown-src="two/a.png" src="y">';
    const r = await prepareImages(html, hooks, 'sidecar', 'f');
    expect(r.sidecar.map((f) => f.relPath)).toEqual(['f/a.png', 'f/a-2.png']);
  });
});

describe('buildStandaloneHtml', () => {
  it('wraps the body with the stylesheet inlined and the title from the H1', async () => {
    const prepared = await prepareImages(BODY, hooks, 'inline', 'f');
    const doc = buildStandaloneHtml({ bodyHtml: prepared.html, fileName: '/n/doc.md', css: '.ProseMirror{color:red}' });
    expect(doc).toContain('<title>Hello &amp; welcome</title>');
    expect(doc).toContain('.ProseMirror{color:red}');
    expect(doc).toContain('class="mikedown-root mikedown-export" data-mikedown-theme="light"');
    expect(doc).toContain('break-inside: avoid');
    expect(doc).not.toMatch(/<link\b/i);
  });

  it('adds heading ids (duplicates suffixed) and unsticks same-page links', () => {
    const doc = buildStandaloneHtml({ bodyHtml: BODY, fileName: null, css: '' });
    expect(doc).toContain('<h2 id="second">Second</h2>');
    expect(doc).toContain('<h2 id="second-1">Second</h2>');
    expect(doc).toContain('<a href="#second">jump</a>');
  });

  it('removes editing-only attributes', () => {
    const doc = buildStandaloneHtml({
      bodyHtml: '<p contenteditable="false" draggable="true">x</p><img class="ProseMirror-separator" alt="">',
      fileName: null,
      css: '',
    });
    expect(doc).not.toContain('contenteditable');
    expect(doc).not.toContain('draggable');
    expect(doc).not.toContain('ProseMirror-separator');
  });

  it('works offline: no remote resource is left once images and css urls are inlined', async () => {
    const css = await inlineCssUrls(
      '@font-face{font-family:K;src:url(fonts/K.woff2) format("woff2"),url(fonts/K.woff) format("woff")}',
      async () => ({ mime: 'font/woff2', bytes: new Uint8Array([1, 2]) }),
    );
    const html = '<p><img src="asset://x" data-mikedown-src="a.png"></p><a href="https://example.com">link</a>';
    const prepared = await prepareImages(html, hooks, 'inline', 'f');
    const doc = buildStandaloneHtml({ bodyHtml: prepared.html, fileName: null, css });
    expect(remoteUrls(doc)).toEqual([]);
    expect(doc).toContain('https://example.com'); // plain links stay
  });

  it('core stylesheet carries no VS Code theme variables into an export', () => {
    const coreCss = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../core/dist/styles.css'), 'utf8');
    const doc = buildStandaloneHtml({ bodyHtml: BODY, fileName: null, css: coreCss });
    expect(doc).not.toContain('--vscode-');
    expect(doc).toContain('--mikedown-');
  });

  it('remoteUrls spots a remote image and a remote css url', () => {
    expect(remoteUrls('<img src="https://a/b.png"><style>a{background:url(https://c/d.png)}</style>')).toEqual([
      'https://a/b.png',
      'https://c/d.png',
    ]);
  });
});

describe('inlineCssUrls', () => {
  it('keeps only the woff2 source and turns it into a data URI', async () => {
    const css = '@font-face{src:url(fonts/K.woff2) format("woff2"),url(fonts/K.woff) format("woff"),url(fonts/K.ttf) format("truetype");font-weight:400}';
    expect(keepWoff2Only(css)).toBe('@font-face{src:url(fonts/K.woff2) format("woff2");font-weight:400}');
    const seen: string[] = [];
    const out = await inlineCssUrls(css, async (u) => { seen.push(u); return { mime: 'font/woff2', bytes: new Uint8Array([104, 105]) }; });
    expect(seen).toEqual(['fonts/K.woff2']);
    expect(out).toContain('url(data:font/woff2;base64,aGk=)');
    expect(out).not.toContain('K.woff"');
  });

  it('leaves data: urls and unloadable urls alone', async () => {
    const out = await inlineCssUrls('a{background:url(data:image/png;base64,AA)}b{background:url(gone.png)}', async () => null);
    expect(out).toBe('a{background:url(data:image/png;base64,AA)}b{background:url(gone.png)}');
  });
});

describe('suggestedExportName', () => {
  it('swaps the extension and handles untitled documents', () => {
    expect(suggestedExportName('/n/plan.md', 'html')).toBe('plan.html');
    expect(suggestedExportName('C:\\n\\plan.markdown', 'pdf')).toBe('plan.pdf');
    expect(suggestedExportName(null, 'html')).toBe('Untitled.html');
  });
});
