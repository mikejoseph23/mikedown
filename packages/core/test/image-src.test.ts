/**
 * Image source policy: fully qualified sources render as they are, other
 * sources go through host.resolveImageSrc, and unresolved ones show the
 * missing-image placeholder. The stored src (and so the markdown) never changes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle, type MikeDownHost } from '../src/index';
import { resolveImageRenderSrc } from '../src/imageSrcPolicy';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

function mount(host: MikeDownHost, markdown: string) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host, initialMarkdown: markdown });
  mounted.push({ handle, el });
  return { el, handle };
}

afterEach(() => {
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
});

class ResolvingHost extends NoopHost {
  resolveImageSrc(src: string): string | null {
    return src.startsWith('img/') ? `https://cdn.test/${src}` : null;
  }
}

describe('resolveImageRenderSrc', () => {
  it('passes fully qualified sources through without asking the host', () => {
    const host = { resolveImageSrc: () => { throw new Error('should not be called'); } };
    for (const src of ['http://a/b.png', 'https://a/b.png', 'data:image/png;base64,AAAA', 'blob:http://x/1', 'HTTPS://A/B.PNG']) {
      expect(resolveImageRenderSrc(src, host)).toBe(src);
    }
  });

  it('returns null for a relative path with no host resolver', () => {
    expect(resolveImageRenderSrc('./pic.png', new NoopHost())).toBeNull();
  });

  it('returns the host result, or null when the host declines', () => {
    const host = new ResolvingHost();
    expect(resolveImageRenderSrc('img/a.png', host)).toBe('https://cdn.test/img/a.png');
    expect(resolveImageRenderSrc('other/a.png', host)).toBeNull();
  });
});

describe('image rendering', () => {
  it('renders a fully qualified src as is', () => {
    const { el } = mount(new NoopHost(), '![x](https://example.com/a.png)\n');
    const img = el.querySelector<HTMLImageElement>('.ProseMirror img')!;
    expect(img.getAttribute('src')).toBe('https://example.com/a.png');
    expect(img.classList.contains('broken-image')).toBe(false);
  });

  it('shows the placeholder with the raw path when no host resolver exists', () => {
    const { el, handle } = mount(new NoopHost(), '![x](./pic.png)\n');
    const img = el.querySelector<HTMLImageElement>('.ProseMirror img')!;
    expect(img.hasAttribute('src')).toBe(false);
    expect(img.classList.contains('broken-image')).toBe(true);
    expect(img.title).toContain('./pic.png');
    expect(handle.getMarkdown()).toContain('![x](./pic.png)');
  });

  it('renders the host resolved src while the markdown keeps the raw path', () => {
    const { el, handle } = mount(new ResolvingHost(), '![x](img/a.png)\n');
    const img = el.querySelector<HTMLImageElement>('.ProseMirror img')!;
    expect(img.getAttribute('src')).toBe('https://cdn.test/img/a.png');
    expect(img.classList.contains('broken-image')).toBe(false);
    expect(handle.getMarkdown()).toContain('![x](img/a.png)');
  });

  it('shows the placeholder when the host resolver returns null', () => {
    const { el, handle } = mount(new ResolvingHost(), '![x](nope/a.png)\n');
    const img = el.querySelector<HTMLImageElement>('.ProseMirror img')!;
    expect(img.classList.contains('broken-image')).toBe(true);
    expect(handle.getMarkdown()).toContain('![x](nope/a.png)');
  });
});
