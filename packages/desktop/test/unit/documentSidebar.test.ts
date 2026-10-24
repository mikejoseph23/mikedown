/**
 * Core's document sidebar in the desktop app: outgoing-link extraction and
 * the folder backlink index (markdown links and wikilinks, cache and
 * invalidation), and TauriHost's wiring to a real core editor (persisted pin
 * and sections through `sidebarPrefs`, backlinks only with a folder, the
 * backlink click opening its file and revealing the link).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, type MikeDownEditorHandle } from '@mikedown/core';
import { stubLayoutMeasurement } from '../../../../test/harness/webviewHarness';
import { createUntitled } from '../../src/documents/documentModel';
import { createPathOps } from '../../src/host/pathOps';
import { TauriHost, type KnowledgeBase } from '../../src/host/tauriHost';
import type { ImagePipeline } from '../../src/host/imagePipeline';
import { createDesktopSettingsStore, type OutlineSettings } from '../../src/settings/desktopSettings';
import { createBacklinkIndex, extractOutgoingLinks } from '../../src/tree/backlinks';
import { createMdIndex } from '../../src/tree/mdIndex';

stubLayoutMeasurement();

const posix = createPathOps('posix');
const win = createPathOps('win32');
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('extractOutgoingLinks', () => {
  it('finds markdown links and wikilinks with their line, skipping external links, anchors and fenced code', () => {
    const md = [
      '# Title',
      'See [one](a.md) and [two](<sub/My Note.md> "title") and [three](b%20c.md#part).',
      '[web](https://x.org/a.md) [mail](mailto:a@b.c) [top](#title) ![img](pic.png)',
      'A [[Wiki Note]] and [[Other#Heading|alias]].',
      '```',
      '[code](a.md) [[Nope]]',
      '```',
      '~~~md',
      '[tilde](a.md)',
      '~~~',
      'After [four](./a.md?x=1).',
    ].join('\n');
    expect(extractOutgoingLinks(md).map(({ kind, line, target, linkHref }) => ({ kind, line, target, linkHref }))).toEqual([
      { kind: 'markdown', line: 2, target: 'a.md', linkHref: 'a.md' },
      { kind: 'markdown', line: 2, target: 'sub/My Note.md', linkHref: 'sub/My Note.md' },
      { kind: 'markdown', line: 2, target: 'b c.md', linkHref: 'b%20c.md#part' },
      { kind: 'markdown', line: 3, target: 'pic.png', linkHref: 'pic.png' },
      { kind: 'wikilink', line: 4, target: 'Wiki Note', linkHref: '[[Wiki Note]]' },
      { kind: 'wikilink', line: 4, target: 'Other', linkHref: '[[Other#Heading|alias]]' },
      { kind: 'markdown', line: 11, target: './a.md', linkHref: './a.md?x=1' },
    ]);
    expect(extractOutgoingLinks('x [y](a.md)\r\n')[0].lineText).toBe('x [y](a.md)');
  });
});

describe('backlink index', () => {
  function world(files: Record<string, string>, opts: { ttlMs?: number; path?: ReturnType<typeof createPathOps>; root?: string } = {}) {
    const reads: string[] = [];
    let clock = 0;
    const index = { root: opts.root ?? '/n', files: async () => Object.keys(files) };
    const backlinks = createBacklinkIndex({
      path: opts.path ?? posix,
      index,
      readText: async (p) => {
        reads.push(p);
        if (!(p in files)) {throw new Error('ENOENT');}
        return { text: files[p] };
      },
      now: () => clock,
      ttlMs: opts.ttlMs,
    });
    return { backlinks, reads, files, tick: (ms: number) => { clock += ms; } };
  }

  it('lists markdown links and wikilinks to the document, with occurrence per source and href', async () => {
    const { backlinks } = world({
      '/n/target.md': '# Target\n[self](target.md)\n',
      '/n/a.md': 'One [t](target.md).\nTwo [t](target.md) and [x](other.md).\n',
      '/n/sub/b.md': 'Up [t](../target.md#intro) and [[Target]].\n',
      '/n/sub/target.md': 'A different target.\n',
      '/n/sub/c.md': '[[target]] resolves to the nearer sub/target.md.\n',
      '/n/d.md': '[abs](/n/target.md)\n',
    });
    const items = await backlinks.backlinksFor('/n/target.md');
    expect(items).toEqual([
      { uri: './a.md', displayPath: 'a.md', line: 1, lineText: 'One [t](target.md).', linkHref: 'target.md', occurrence: 0 },
      { uri: './a.md', displayPath: 'a.md', line: 2, lineText: 'Two [t](target.md) and [x](other.md).', linkHref: 'target.md', occurrence: 1 },
      { uri: './sub/b.md', displayPath: 'sub/b.md', line: 1, lineText: 'Up [t](../target.md#intro) and [[Target]].', linkHref: '../target.md#intro', occurrence: 0 },
      { uri: './d.md', displayPath: 'd.md', line: 1, lineText: '[abs](/n/target.md)', linkHref: '/n/target.md', occurrence: 0 },
    ]);
    // sub/b.md's [[Target]] and sub/c.md's [[target]] both pick the nearer sub/target.md.
    expect((await backlinks.backlinksFor('/n/sub/target.md')).map((i) => i.displayPath)).toEqual(['sub/b.md', 'sub/c.md']);
  });

  it('reads each file once, again after invalidate or the TTL', async () => {
    const w = world({ '/n/t.md': '', '/n/a.md': '[t](t.md)\n', '/n/b.md': 'nothing\n' }, { ttlMs: 1000 });
    await w.backlinks.backlinksFor('/n/t.md');
    await w.backlinks.backlinksFor('/n/t.md');
    expect(w.reads.sort()).toEqual(['/n/a.md', '/n/b.md']);

    w.files['/n/b.md'] = 'now [t](t.md)\n';
    w.backlinks.invalidate('/n/b.md');
    w.reads.length = 0;
    expect((await w.backlinks.backlinksFor('/n/t.md')).map((i) => i.displayPath)).toEqual(['a.md', 'b.md']);
    expect(w.reads).toEqual(['/n/b.md']);

    w.tick(1001);
    w.reads.length = 0;
    await w.backlinks.backlinksFor('/n/t.md');
    expect(w.reads.sort()).toEqual(['/n/a.md', '/n/b.md']);

    w.backlinks.invalidate();
    w.reads.length = 0;
    await w.backlinks.backlinksFor('/n/t.md');
    expect(w.reads).toHaveLength(2);
  });

  it('Windows paths compare case-insensitively', async () => {
    const { backlinks } = world({ 'C:\\n\\T.md': '', 'C:\\n\\a.md': '[t](t.md)\n' }, { path: win, root: 'C:\\n' });
    const items = await backlinks.backlinksFor('C:\\n\\T.md');
    expect(items.map((i) => [i.displayPath, i.uri])).toEqual([['a.md', './a.md']]);
  });
});

// ── TauriHost + a real core editor ────────────────────────────────────────

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];
afterEach(() => {
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
});

function setup(opts: { outline?: OutlineSettings; docPath?: string | null; markdown?: string } = {}) {
  const model = createUntitled();
  model.path = opts.docPath === undefined ? '/n/notes/target.md' : opts.docPath;
  model.mtimeMs = 1_700_000_000_000;
  const markdown = opts.markdown ?? '# Target\n\n## Part\n';
  model.text = markdown;
  let outline: OutlineSettings = opts.outline ?? { visibility: 'never', sectionPrefs: {} };
  const outlineSet = vi.fn((patch: Partial<OutlineSettings>) => { outline = { ...outline, ...patch }; });
  const opened: string[] = [];
  const host = new TauriHost({
    doc: () => model,
    path: posix,
    fs: { assetUrl: (p) => `asset://${p}` },
    settings: createDesktopSettingsStore(),
    images: {} as ImagePipeline,
    app: {
      onModelChanged: () => {},
      onStats: () => {},
      openPath: async (p) => { opened.push(p); return true; },
      notify: () => {},
    },
    outline: { get: () => outline, set: outlineSet },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, {
    host,
    initialMarkdown: markdown,
    features: { sidebar: true, supportCard: false },
    hostOwnsShortcuts: true,
  });
  host.attach(handle);
  mounted.push({ handle, el });
  const sidebar = el.querySelector<HTMLElement>('.mikedown-outline-sidebar')!;
  return { host, handle, el, sidebar, model, outlineSet, opened, outline: () => outline };
}

function knowledgeBase(files: Record<string, string>): KnowledgeBase {
  const index = createMdIndex('/n', {
    path: posix,
    listMarkdown: async () => Object.keys(files),
    readText: async (p) => ({ text: files[p] ?? '' }),
    exists: async (p) => p in files,
    createFile: async () => {},
  });
  return { index, backlinks: createBacklinkIndex({ path: posix, index, readText: async (p) => ({ text: files[p] ?? '' }) }), openCreated: () => {} };
}

describe('TauriHost: document sidebar', () => {
  it('answers core\'s state request (made before attach) with the persisted pin and sections', () => {
    const { sidebar, el } = setup({ outline: { visibility: 'always', sectionPrefs: { properties: true } } });
    expect(sidebar.hidden).toBe(false);
    expect(el.querySelector('.properties-section')?.classList.contains('collapsed')).toBe(true);
    expect([...el.querySelectorAll('.outline-item')].map((n) => n.textContent)).toEqual(['Target', 'Part']);
  });

  it('the pin and section toggles persist through the outline store', () => {
    const { sidebar, el, outlineSet, outline } = setup();
    expect(sidebar.hidden).toBe(true);
    el.querySelector<HTMLButtonElement>('.mikedown-outline-toggle')!.click();
    expect(sidebar.hidden).toBe(false);
    // A plain show/hide is per session; only the pin persists.
    expect(outlineSet).not.toHaveBeenCalled();
    el.querySelector<HTMLButtonElement>('.outline-pin')!.click();
    expect(outline().visibility).toBe('always');
    el.querySelector<HTMLElement>('.outline-section .sidebar-section-header')!.click();
    el.querySelector<HTMLElement>('.properties-section .sidebar-section-header')!.click();
    expect(outline().sectionPrefs).toEqual({ outline: true, properties: false });
  });

  it('applySidebarState re-applies the store (the boot load after the first pane)', () => {
    const { host, sidebar, outlineSet } = setup();
    outlineSet({ visibility: 'always' });
    host.applySidebarState();
    expect(sidebar.hidden).toBe(false);
  });

  it('no folder: no backlinks section; a folder fills it; closing the folder empties it', async () => {
    const { host, el } = setup();
    const section = el.querySelector<HTMLElement>('.backlinks-section')!;
    await host.refreshBacklinks();
    expect(section.hidden).toBe(true);

    host.setKnowledgeBase(knowledgeBase({
      '/n/notes/target.md': '',
      '/n/a.md': 'See [t](notes/target.md).\n',
      '/n/b.md': 'And [[target]].\n',
      '/n/c.md': 'Unrelated.\n',
    }));
    await vi.waitFor(() => expect([...el.querySelectorAll('.backlinks-item')].map((n) => n.textContent)).toEqual(['a.md', 'b.md']));
    expect(section.hidden).toBe(false);

    host.setKnowledgeBase(null);
    expect(el.querySelectorAll('.backlinks-item')).toHaveLength(0);
    expect(el.querySelector('.backlinks-list')?.textContent).toContain('No backlinks');
  });

  it('syncBacklinks recomputes only when the pane shows another document', async () => {
    const { host, model } = setup();
    const kb = knowledgeBase({ '/n/notes/target.md': '', '/n/a.md': '[t](notes/target.md)\n' });
    const spy = vi.spyOn(kb.backlinks!, 'backlinksFor');
    host.setKnowledgeBase(kb);
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
    host.syncBacklinks();
    expect(spy).toHaveBeenCalledTimes(1);
    model.path = '/n/a.md';
    host.syncBacklinks();
    await flush();
    expect(spy).toHaveBeenLastCalledWith('/n/a.md');
  });

  it('an untitled document gets an empty list; the footer shows the file\'s modified time', async () => {
    const { host, el, model } = setup({ docPath: null });
    host.setKnowledgeBase(knowledgeBase({ '/n/a.md': '[t](x.md)\n' }));
    await flush();
    expect(el.querySelector('.backlinks-list')?.textContent).toContain('No backlinks');
    model.path = '/n/x.md';
    await host.refreshBacklinks();
    expect(el.querySelector('.sidebar-footer')?.textContent).not.toContain('Modified —');
  });

  it('a backlink click opens the source in this pane and reveals the link back', async () => {
    const { host, handle, el, opened } = setup();
    host.setKnowledgeBase(knowledgeBase({ '/n/notes/target.md': '', '/n/a.md': 'See [t](notes/target.md).\n' }));
    await vi.waitFor(() => expect(el.querySelector('.backlinks-item')).not.toBeNull());
    const reveal = vi.spyOn(handle, 'revealLink');
    el.querySelector<HTMLElement>('.mikedown-outline-toggle')!.click();
    el.querySelector<HTMLElement>('.backlinks-item')!.click();
    await flush();
    expect(opened).toEqual(['/n/a.md']);
    expect(reveal).toHaveBeenCalledWith('notes/target.md', 0);
  });
});
