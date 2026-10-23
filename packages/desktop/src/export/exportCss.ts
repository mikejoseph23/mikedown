/**
 * Core's stylesheet as one self-contained string for exports: `styles.css`
 * (tokens, the component files and KaTeX) read as text by vite (`?inline`),
 * with every font/image url turned into a `data:` URI so the file renders
 * offline. Built once, on the first export.
 */
import coreCss from '@mikedown/core/styles.css?inline';
import { inlineCssUrls } from './cssInline';

let cached: Promise<string> | null = null;

export function exportStylesheet(): Promise<string> {
  cached ??= inlineCssUrls(coreCss, async (url) => {
    const res = await fetch(new URL(url, document.baseURI));
    if (!res.ok) {return null;}
    return { mime: (res.headers.get('content-type') ?? '').split(';')[0], bytes: new Uint8Array(await res.arrayBuffer()) };
  }).catch((err: unknown) => {
    cached = null;
    throw err;
  });
  return cached;
}
