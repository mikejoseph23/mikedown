// Each demo page's bundle loads in jsdom without throwing and mounts one editor.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dist = resolve(__dirname, '../dist');
const built = existsSync(resolve(dist, 'developers/index.html'));

// Editors can render into a shadow root (web component), so look there too.
function countEditors(root: ParentNode): number {
  let n = root.querySelectorAll('.ProseMirror').length;
  root.querySelectorAll('*').forEach(el => {
    if (el.shadowRoot) {
      n += countEditors(el.shadowRoot);
    }
  });
  return n;
}

async function waitFor(fn: () => boolean, ms = 20000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) {
      throw new Error(
        'timed out waiting for the editor to mount: ' +
          document.querySelector('#demo-root')?.innerHTML.slice(0, 600)
      );
    }
    await new Promise(r => setTimeout(r, 50));
  }
}

export function mountSuite(page: string) {
  describe.skipIf(!built)(`${page} demo page mounts one editor`, () => {
    afterEach(() => {
      document.documentElement.innerHTML = '<head></head><body></body>';
      vi.resetModules();
    });

    it('boots', async () => {
      const html = readFileSync(resolve(dist, `developers/${page}/index.html`), 'utf8');
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const scripts = [...doc.querySelectorAll('script[src]')].map(s => ({
        src: s.getAttribute('src')!,
        module: s.getAttribute('type') === 'module'
      }));
      doc.querySelectorAll('script').forEach(s => s.remove());
      document.documentElement.innerHTML = doc.documentElement.innerHTML;
      // jsdom has no layout; these are all the editor needs to boot.
      const w = window as any;
      w.matchMedia ??= () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {}
      });
      w.ResizeObserver ??= class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };

      // jsdom loads no subresources and fires no load events for <link>, which Vite's
      // dynamic-import preloader waits for; fetch would hit localhost:3000. Stub both.
      vi.stubGlobal('fetch', async () => new Response('', { status: 200 }));
      new MutationObserver(records => {
        for (const r of records) {
          r.addedNodes.forEach(n => {
            if (n instanceof HTMLLinkElement) {
              setTimeout(() => n.dispatchEvent(new Event('load')));
            }
          });
        }
      }).observe(document.documentElement, { childList: true, subtree: true });

      const errors: unknown[] = [];
      const onError = (e: ErrorEvent) => errors.push(e.error ?? e.message);
      window.addEventListener('error', onError);

      for (const { src, module } of scripts) {
        const file = src.startsWith('/mikedown/')
          ? resolve(dist, src.slice('/mikedown/'.length))
          : resolve(dist, 'developers', page, src);
        expect(existsSync(file), src).toBe(true);
        if (module) {
          await import(/* @vite-ignore */ file);
        } else {
          // Classic scripts (the Angular page loads stage.js this way).
          // eslint-disable-next-line no-new-func
          new Function(readFileSync(file, 'utf8'))();
        }
      }

      await waitFor(() => countEditors(document) > 0);
      // Give a double mount (StrictMode, re-render) time to show itself.
      await new Promise(r => setTimeout(r, 500));
      window.removeEventListener('error', onError);
      expect(errors).toEqual([]);
      expect(countEditors(document)).toBe(1);
    });
  });
}
