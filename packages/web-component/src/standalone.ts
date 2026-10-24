/**
 * CDN entry (dist/mikedown-editor.standalone.js): core, its peers and core's
 * stylesheet in one file, and <mikedown-editor> defined on load.
 *
 * - The stylesheet goes into one <style id="mikedown-styles"> per document,
 *   on the first connected element.
 * - KaTeX's CSS (fonts included) loads from jsDelivr as one <link>, only
 *   when an element connects with math enabled.
 * - `import('katex')` and `import('mermaid')` in core are rewritten at build
 *   time to pinned jsDelivr URLs, so nothing is fetched unless a document uses
 *   math or a diagram.
 */

// Replaced by scripts/build-standalone.mjs (virtual module and defines).
import coreCss from 'mikedown:core-styles';
import { setConnectHook } from './hooks';
import { defineMikeDownElement } from './index';

declare const __KATEX_CSS_URL__: string;

const STYLE_ID = 'mikedown-styles';
const KATEX_LINK_ID = 'mikedown-katex-css';

setConnectHook((element) => {
  const doc = element.ownerDocument;
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = coreCss;
    // First in <head>, so page stylesheets (token overrides) come later and win.
    doc.head.insertBefore(style, doc.head.firstChild);
  }
  if (element.features.math !== false && !doc.getElementById(KATEX_LINK_ID)) {
    const link = doc.createElement('link');
    link.id = KATEX_LINK_ID;
    link.rel = 'stylesheet';
    link.href = __KATEX_CSS_URL__;
    link.crossOrigin = 'anonymous';
    doc.head.appendChild(link);
  }
});

defineMikeDownElement();

export * from './index';
