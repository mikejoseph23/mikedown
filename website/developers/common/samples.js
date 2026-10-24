// Build-time helpers for the developer pages (Node only, no DOM).
//
// - <!--sample:Demo.tsx-->  is replaced with a highlighted code block of that
//   file, read from the page's own folder. The demo on the page imports the
//   same file, so the code shown is the code that runs.
// - <code data-highlight="tsx">...</code>  inline snippets (HTML-escaped in the
//   page) are highlighted in place.
// - <!--stage:@mikedown/react-->  is the live demo frame (theme and read-only
//   controls, column labels, and an empty #demo-root the demo mounts into).
//   Add root="app-root" to mount an element of that name inside it (Angular).
// - %WEB_COMPONENT_VERSION%  is the web component's version (CDN snippets).
// - <!--katex:css-->  becomes a <link> to KaTeX's stylesheet on jsDelivr,
//   pinned to the installed katex version. Core's styles.css @imports KaTeX's
//   CSS, which would put its .woff2/.woff/.ttf fonts in the site output; the
//   site keeps to the file types the deploy packer accepts, so the @import is
//   stripped (stripKatexImport) and the fonts come from the CDN instead.
//
// Used by website/vite.config.mjs and website/scripts/build-angular.mjs.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, extname, join } from 'node:path';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import xml from 'highlight.js/lib/languages/xml';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);

const require = createRequire(import.meta.url);
export const KATEX_VERSION = require('katex/package.json').version;
export const KATEX_CSS_URL = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`;

const LANG_BY_EXT = { '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.mjs': 'javascript', '.vue': 'xml', '.html': 'xml', '.json': 'json', '.css': 'css', '.sh': 'bash' };
const LANG_ALIASES = { ts: 'typescript', tsx: 'typescript', js: 'javascript', html: 'xml', vue: 'xml', sh: 'bash', shell: 'bash' };

function unescapeHtml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

export function highlight(code, lang) {
  const language = LANG_ALIASES[lang] ?? lang;
  return hljs.highlight(code, { language, ignoreIllegals: true }).value;
}

function slug(file) {
  return 'code-' + file.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

/** A titled, copyable code block for a source file. */
export function renderSample(dir, file) {
  const source = readFileSync(join(dir, file), 'utf8').replace(/\s+$/, '') + '\n';
  const lang = LANG_BY_EXT[extname(file)] ?? 'plaintext';
  const id = slug(file);
  return `<figure class="code">
      <figcaption class="code__bar"><span class="code__file">${basename(file)}</span><button class="copy-button" type="button" data-copy-target="#${id}" aria-label="Copy ${basename(file)}">Copy</button></figcaption>
      <pre class="code__body" tabindex="0" aria-label="${basename(file)} source"><code id="${id}" class="hljs">${highlight(source, lang)}</code></pre>
    </figure>`;
}

/** The live demo frame. The controls are wired by common/stage.js. */
export function renderStage(pkg, rootElement) {
  const loading = '<p class="stage__loading">Loading the editor...</p>';
  const body = rootElement ? `<${rootElement}>${loading}</${rootElement}>` : loading;
  const themes = ['auto', 'light', 'dark']
    .map((t) => `<label><input type="radio" name="stage-theme" value="${t}"${t === 'auto' ? ' checked' : ''}><span>${t[0].toUpperCase()}${t.slice(1)}</span></label>`)
    .join('');
  return `<section class="stage" data-stage aria-labelledby="stage-title">
        <div class="stage__bar">
          <h2 class="stage__title" id="stage-title"><span class="stage__dot" aria-hidden="true"></span>Live editor <code>${pkg}</code></h2>
          <div class="stage__controls">
            <fieldset class="segmented">
              <legend>Theme</legend>
              <span class="segmented__options">${themes}</span>
            </fieldset>
            <label class="switch"><input type="checkbox" role="switch" data-stage-readonly><span class="switch__track" aria-hidden="true"></span><span class="switch__label">Read-only</span></label>
          </div>
        </div>
        <div class="stage__cols" aria-hidden="true"><span>Editor</span><span>Markdown value <span class="stage__live" data-stage-live>Synced</span></span></div>
        <div class="stage__body" id="demo-root">${body}</div>
      </section>`;
}

const STAGE_MARKER = /<!--\s*stage:(@[a-z/-]+)(?:\s+root="([a-z-]+)")?\s*-->/g;
const SAMPLE_MARKER = /<!--\s*sample:([A-Za-z0-9._/-]+)\s*-->/g;
const INLINE_CODE = /<code([^>]*?) data-highlight="([a-z]+)"([^>]*)>([\s\S]*?)<\/code>/g;
const VERSION_MARKER = /%WEB_COMPONENT_VERSION%/g;
const WEB_COMPONENT_VERSION = require('../../../packages/web-component/package.json').version;
const KATEX_MARKER = /<!--\s*katex:css\s*-->/g;

/** Fill the sample, inline-highlight and KaTeX markers in a page. `dir` is the folder sample paths are relative to. */
export function applyDeveloperMarkers(html, dir) {
  return html
    .replace(STAGE_MARKER, (_, pkg, rootElement) => renderStage(pkg, rootElement))
    .replace(SAMPLE_MARKER, (_, file) => renderSample(dir, file))
    .replace(VERSION_MARKER, WEB_COMPONENT_VERSION)
    .replace(INLINE_CODE, (_, before, lang, after, body) => `<code class="hljs"${before}${after}>${highlight(unescapeHtml(body), lang)}</code>`)
    .replace(KATEX_MARKER, () => `<link rel="stylesheet" href="${KATEX_CSS_URL}" crossorigin="anonymous">`);
}

/** Core's styles.css without its KaTeX @import (see the header comment). */
export function stripKatexImport(cssText) {
  return cssText.replace(/@import\s+['"]katex\/dist\/katex(?:\.min)?\.css['"]\s*;?/g, '/* KaTeX CSS: linked from jsDelivr by the page */');
}
