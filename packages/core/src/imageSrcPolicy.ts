import type { MikeDownHost } from './host';

const FULLY_QUALIFIED = /^(https?|data|blob):/i;

/**
 * Decide the `src` to render for an image node's stored `src`.
 * Fully qualified sources render as they are; anything else goes through
 * `host.resolveImageSrc`. Returns null when the image should show the
 * missing-image placeholder.
 */
export function resolveImageRenderSrc(src: string, host: Pick<MikeDownHost, 'resolveImageSrc'>): string | null {
  if (!src) {return null;}
  if (FULLY_QUALIFIED.test(src)) {return src;}
  return host.resolveImageSrc?.(src) ?? null;
}
