/**
 * TauriHost's knowledge-base methods against a real core editor (jsdom):
 * absent in a lone-file window, present once a folder lends its index, and
 * `[[Note Name]]` resolving to the matching file with Cmd/Ctrl+click opening
 * it (M3 acceptance).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, type MikeDownEditorHandle } from '@mikedown/core';
import { stubLayoutMeasurement } from '../../../../test/harness/webviewHarness';
import { createUntitled } from '../../src/documents/documentModel';
import { createPathOps } from '../../src/host/pathOps';
import { TauriHost } from '../../src/host/tauriHost';
import type { ImagePipeline } from '../../src/host/imagePipeline';
import { createDesktopSettingsStore } from '../../src/settings/desktopSettings';
import { createMdIndex } from '../../src/tree/mdIndex';

stubLayoutMeasurement();

const path = createPathOps('posix');
const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

afterEach(() => {
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
});

function setup(markdown: string) {
  const model = createUntitled();
  model.path = '/n/daily/today.md';
  const opened: Array<{ path: string; anchor: string | null | undefined }> = [];
  const host = new TauriHost({
    model,
    path,
    fs: { assetUrl: (p) => `asset://${p}` },
    settings: createDesktopSettingsStore(),
    images: {} as ImagePipeline,
    app: {
      onModelChanged: () => {},
      onStats: () => {},
      openPath: async (p, opts) => { opened.push({ path: p, anchor: opts?.anchor }); return true; },
      notify: () => {},
    },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, {
    host,
    initialMarkdown: markdown,
    features: { sidebar: false, supportCard: false },
    hostOwnsShortcuts: true,
    settings: { wikilinkCreateOnClick: true },
  });
  host.attach(handle);
  model.text = markdown;
  mounted.push({ handle, el });
  const files = ['/n/daily/today.md', '/n/notes/Note Name.md', '/n/archive/Note Name.md', '/n/daily/Other.md'];
  const index = createMdIndex('/n', {
    path,
    listMarkdown: async () => files,
    readText: async () => ({ text: '' }),
    exists: async (p) => files.includes(p),
    createFile: async (p) => { files.push(p); },
  });
  return { host, handle, el, opened, index, model };
}

describe('knowledge-base host methods', () => {
  it('are absent in a lone-file window and present once a folder is open', () => {
    const { host, index } = setup('x\n');
    for (const m of ['getLinkSuggestions', 'getFileHeadings', 'resolveWikilinks', 'createWikilink', 'checkLinks'] as const) {
      expect(host[m], m).toBeUndefined();
      expect(m in host, m).toBe(false);
    }
    host.setKnowledgeBase({ index, openCreated: () => {} });
    expect(typeof host.resolveWikilinks).toBe('function');
    expect(typeof host.getLinkSuggestions).toBe('function');
    host.setKnowledgeBase(null);
    expect('resolveWikilinks' in host).toBe(false);
  });

  it('[[Note Name]] resolves to the nearest matching file and Cmd/Ctrl+click opens it', async () => {
    const { host, handle, el, opened, index } = setup('See [[Note Name]] and [[Missing]].\n');
    host.setKnowledgeBase({ index, openCreated: () => {} });
    handle.refreshLinks();
    await wait(350);
    const links = el.querySelectorAll<HTMLAnchorElement>('a[data-wikilink]');
    expect(links).toHaveLength(2);
    // Two files share the name: both are one hop away, the shorter path wins.
    expect(links[0].getAttribute('href')).toBe('../notes/Note%20Name.md');
    expect(links[1].getAttribute('href')).toBeNull();
    links[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, metaKey: true }));
    await wait(0);
    expect(opened).toEqual([{ path: '/n/notes/Note Name.md', anchor: null }]);
  });

  it('Cmd/Ctrl+click on an unresolved wikilink creates the note next to the document', async () => {
    const { host, handle, el, index } = setup('Start [[Fresh Idea]]\n');
    const created: string[] = [];
    host.setKnowledgeBase({ index, openCreated: (p) => created.push(p) });
    handle.refreshLinks();
    await wait(350);
    const link = el.querySelector<HTMLAnchorElement>('a[data-wikilink]')!;
    link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, metaKey: true }));
    await wait(20);
    expect(created).toEqual(['/n/daily/Fresh Idea.md']);
    expect(el.querySelector('a[data-wikilink]')?.getAttribute('href')).toBe('./Fresh%20Idea.md');
  });

  it('broken relative links are reported to core', async () => {
    const { host, model, index } = setup('x\n');
    host.setKnowledgeBase({ index, openCreated: () => {} });
    model.text = '# Here\n';
    const broken = await host.checkLinks!([
      { href: './Other.md', type: 'file' },
      { href: './Nope.md', type: 'file' },
      { href: '#here', type: 'anchor' },
    ]);
    expect(broken).toEqual(['./Nope.md']);
    vi.restoreAllMocks();
  });
});
