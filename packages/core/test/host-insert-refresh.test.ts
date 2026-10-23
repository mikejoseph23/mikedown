/**
 * Host-driven insertion (`handle.insertLink` / `insertImage`, used by the
 * desktop app for files dropped onto the editor) and link refresh
 * (`handle.refreshLinks`, used when files around the document change or the
 * host gains its knowledge-base methods after construction).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle, type MikeDownHost, type WikilinkResolution } from '../src/index';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

function mount(host: MikeDownHost = new NoopHost(), initialMarkdown = '') {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host, initialMarkdown });
  mounted.push({ handle, el });
  return { el, handle };
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

afterEach(() => {
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  vi.restoreAllMocks();
});

describe('handle.insertLink / insertImage', () => {
  it('inserts a link at the cursor in rich text', () => {
    const { handle } = mount(new NoopHost(), 'Before\n');
    handle.tiptap.commands.focus('end');
    handle.insertLink('./Other%20Note.md', 'Other Note');
    expect(handle.getMarkdown()).toContain('[Other Note](./Other%20Note.md)');
  });

  it('defaults the link text to the href', () => {
    const { handle } = mount(new NoopHost(), 'x\n');
    handle.tiptap.commands.focus('end');
    handle.insertLink('notes/a.md');
    expect(handle.getMarkdown()).toContain('[notes/a.md](notes/a.md)');
  });

  it('inserts an image at the cursor in rich text', () => {
    const { handle } = mount(new NoopHost(), 'Para\n');
    handle.tiptap.commands.focus('end');
    handle.insertImage({ src: 'images/shot.png', alt: 'Shot' });
    expect(handle.getMarkdown()).toContain('![Shot](images/shot.png)');
  });

  it('inserts markdown text in source mode', async () => {
    const { handle } = mount(new NoopHost(), 'Start\n');
    handle.command('toggleSource');
    handle.insertLink('./My Note.md', 'My [Note]');
    handle.insertImage({ src: 'images/a b.png' });
    const md = handle.getMarkdown();
    expect(md).toContain('[My \\[Note\\]](<./My Note.md>)');
    expect(md).toContain('![](<images/a b.png>)');
    await wait(20); // let the source toggle's scroll-restore timer run before teardown
  });
});

describe('wikilink resolution cache', () => {
  function wikiHost(resolve: (targets: string[]) => WikilinkResolution[]) {
    const calls: string[][] = [];
    const host: MikeDownHost = {
      onChange: () => {},
      resolveWikilinks: async (targets) => {
        calls.push([...targets]);
        return resolve(targets);
      },
    };
    return { host, calls };
  }

  it('asks again after a new document is loaded (hrefs are relative to the document)', async () => {
    const { host, calls } = wikiHost((t) => t.map((target) => ({ target, href: `./${target}.md`, count: 1 })));
    const { handle } = mount(host, 'See [[Note]]\n');
    await wait(320);
    expect(calls).toEqual([['Note']]);
    handle.setMarkdown('Again [[Note]]\n');
    await wait(320);
    expect(calls).toEqual([['Note'], ['Note']]);
  });

  it('refreshLinks re-resolves, so a file created since lights the link up', async () => {
    let exists = false;
    const { host, calls } = wikiHost((t) => t.map((target) => ({ target, href: exists ? `./${target}.md` : null, count: exists ? 1 : 0 })));
    const { handle, el } = mount(host, 'See [[Fresh]]\n');
    await wait(320);
    expect(el.querySelector('a[data-wikilink]')?.getAttribute('href') ?? null).toBeNull();
    exists = true;
    handle.refreshLinks();
    await wait(320);
    expect(calls.length).toBe(2);
    expect(el.querySelector('a[data-wikilink]')?.getAttribute('href')).toBe('./Fresh.md');
  });

  it('a host that gains getLinkSuggestions after construction is asked on refreshLinks', () => {
    const host: MikeDownHost = { onChange: () => {} };
    const { handle } = mount(host, 'x\n');
    const getLinkSuggestions = vi.fn(async () => [{ label: 'Note.md', href: './Note.md', type: 'file' as const }]);
    host.getLinkSuggestions = getLinkSuggestions;
    handle.refreshLinks();
    expect(getLinkSuggestions).toHaveBeenCalledTimes(1);
  });
});
