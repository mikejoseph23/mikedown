/**
 * Make a stylesheet self-contained: every `url(...)` that is not already a
 * `data:` URI becomes one (KaTeX fonts, mostly). Pure apart from the injected
 * `load`, so it is unit-tested. Font `src:` lists keep only their woff2 entry
 * (the woff/ttf fallbacks would triple the size and no supported webview
 * needs them).
 */

export interface CssAssetLoader {
  /** Bytes and mime for a url found in the stylesheet; null to leave it alone. */
  (url: string): Promise<{ mime: string; bytes: Uint8Array } | null>;
}

const MIME_BY_EXT: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export function mimeForUrl(url: string): string {
  const ext = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url)?.[1]?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));}
  return btoa(bin);
}

/** Drop non-woff2 sources from `src: url(a) format("woff2"), url(b) format("woff"), …` lists. */
export function keepWoff2Only(css: string): string {
  return css.replace(/src\s*:\s*([^;}]+)/gi, (whole: string, list: string) => {
    if (!/format\(\s*["']?woff2["']?\s*\)/i.test(list) || !/,/.test(list)) {return whole;}
    const parts = list.split(/,(?![^(]*\))/).map((s) => s.trim());
    const woff2 = parts.filter((p) => /format\(\s*["']?woff2["']?\s*\)/i.test(p));
    return woff2.length ? `src:${woff2.join(',')}` : whole;
  });
}

export async function inlineCssUrls(css: string, load: CssAssetLoader): Promise<string> {
  const text = keepWoff2Only(css);
  const urls = new Set<string>();
  for (const m of text.matchAll(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi)) {
    if (!/^(?:data:|#)/i.test(m[2])) {urls.add(m[2]);}
  }
  const replacement = new Map<string, string>();
  for (const url of urls) {
    const got = await load(url).catch(() => null);
    if (got) {replacement.set(url, `data:${got.mime || mimeForUrl(url)};base64,${toBase64(got.bytes)}`);}
  }
  return text.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi, (whole: string, _q: string, url: string) => {
    const data = replacement.get(url);
    return data ? `url(${data})` : whole;
  });
}
