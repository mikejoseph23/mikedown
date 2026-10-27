/**
 * Table of contents: `<!-- toc -->` … `<!-- tocstop -->` regions (toc.ts,
 * toc-node.ts) — generation, duplicate anchors, lossless round-trip, and the
 * sync that rewrites a TOC only when the headings changed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle, type MikeDownHost } from '../src/index';
import { buildTocEntries, parseTocBody, renderTocBody, renderTocList, tocBodyMatches } from '../src/toc';
import { syncTableOfContents } from '../src/toc-node';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

afterEach(async () => {
  await new Promise(r => setTimeout(r, 20));
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
});

function mount(markdown: string) {
  const changes: string[] = [];
  const host: MikeDownHost = Object.assign(new NoopHost(), {
    onChange: (md: string) => { changes.push(md); },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host, initialMarkdown: markdown });
  mounted.push({ handle, el });
  return { handle, changes };
}

const h = (level: number, text: string, listed = true) => ({ level, text, listed });

describe('buildTocEntries', () => {
  it('nests by heading level and uses GitHub anchors', () => {
    const entries = buildTocEntries([h(1, 'Intro'), h(2, 'Memory & Hardware'), h(3, 'Setup'), h(2, 'Usage')]);
    expect(renderTocList(entries)).toBe(
      '- [Intro](#intro)\n  - [Memory & Hardware](#memory--hardware)\n    - [Setup](#setup)\n  - [Usage](#usage)',
    );
  });

  it('suffixes duplicate anchors in document order, counting unlisted headings', () => {
    const entries = buildTocEntries([h(2, 'Setup'), h(2, 'Setup', false), h(2, 'Setup')]);
    expect(entries.map(e => e.anchor)).toEqual(['setup', 'setup-2']);
  });

  it('nests a skipped level one step and skips empty headings', () => {
    const entries = buildTocEntries([h(2, 'A'), h(4, 'B'), h(2, '  '), h(3, 'C')]);
    expect(entries.map(e => [e.depth, e.text])).toEqual([[0, 'A'], [1, 'B'], [1, 'C']]);
  });

  it('keeps heading numbers in the text and anchor', () => {
    const [e] = buildTocEntries([h(2, '1.2 Setup')]);
    expect(e).toEqual({ depth: 0, text: '1.2 Setup', anchor: '12-setup' });
  });

  it('escapes brackets in link text and parses them back', () => {
    const entries = buildTocEntries([h(2, 'Use [x] here')]);
    const body = renderTocBody(entries);
    expect(body).toBe('\n- [Use \\[x\\] here](#use-x-here)\n\n');
    expect(parseTocBody(body)).toEqual(entries);
  });
});

describe('tocBodyMatches', () => {
  const entries = buildTocEntries([h(1, 'A'), h(2, 'B')]);

  it('ignores bullet and indent style from other tools', () => {
    expect(tocBodyMatches('* [A](#a)\n    * [B](#b)\n', entries)).toBe(true);
  });

  it('notices a changed, added or removed entry', () => {
    expect(tocBodyMatches('- [A](#a)\n  - [C](#c)\n', entries)).toBe(false);
    expect(tocBodyMatches('- [A](#a)\n', entries)).toBe(false);
    expect(tocBodyMatches('- [A](#a)\n- [B](#b)\n', entries)).toBe(false);
  });
});

const DOC = '# Title\n\n<!-- toc -->\n\n- [Title](#title)\n  - [Setup](#setup)\n  - [Setup](#setup-1)\n\n<!-- tocstop -->\n\n## Setup\n\nOne.\n\n## Setup\n\nTwo.\n';

describe('round-trip', () => {
  it('parses the region as one TOC node and serializes it unchanged', () => {
    const { handle } = mount(DOC);
    const json = JSON.stringify(handle.tiptap.getJSON());
    expect(json).toContain('"tableOfContents"');
    expect(json).not.toContain('tocstop -->"}'); // not left as paragraph text
    expect(handle.tiptap.storage.markdown.getMarkdown() + '\n').toBe(DOC);
  });

  it('keeps foreign markers and list style byte for byte', () => {
    const md = '<!-- TOC -->\n* [A](#a)\n<!-- /TOC -->\n\n# A\n';
    const { handle } = mount(md);
    expect(handle.tiptap.storage.markdown.getMarkdown() + '\n').toBe(md);
  });

  it('leaves markers around non-list content as text', () => {
    const { handle } = mount('<!-- toc -->\n\nSome prose.\n\n<!-- tocstop -->\n');
    expect(JSON.stringify(handle.tiptap.getJSON())).not.toContain('tableOfContents');
  });

  it('renders the entries as links', () => {
    const { handle } = mount(DOC);
    const links = [...handle.tiptap.view.dom.querySelectorAll('nav.mikedown-toc a')].map(a => a.getAttribute('href'));
    expect(links).toEqual(['#title', '#setup', '#setup-1']);
  });
});

describe('sync', () => {
  it('is a no-op when the TOC already matches', () => {
    const { handle } = mount(DOC);
    expect(syncTableOfContents(handle.tiptap.state)).toBeNull();
  });

  it('is a no-op for a matching TOC written in another style', () => {
    const { handle } = mount('<!-- toc -->\n* [A](#a)\n    * [B](#b)\n<!-- tocstop -->\n\n# A\n\n## B\n');
    expect(syncTableOfContents(handle.tiptap.state)).toBeNull();
  });

  it('does not touch a stale TOC on load', async () => {
    const stale = '<!-- toc -->\n\n- [Old](#old)\n\n<!-- tocstop -->\n\n# New\n';
    const { handle, changes } = mount(stale);
    await new Promise(r => setTimeout(r, 400));
    expect(changes).toEqual([]);
    expect(handle.tiptap.storage.markdown.getMarkdown() + '\n').toBe(stale);
  });

  it('follows a heading edit, outside the undo history', async () => {
    const { handle, changes } = mount(DOC);
    const { tiptap } = handle;
    // Put the cursor at the end of the first "Setup" heading and rename it.
    let end = -1;
    tiptap.state.doc.descendants((node, pos) => {
      if (end < 0 && node.type.name === 'heading' && node.textContent === 'Setup') {end = pos + node.nodeSize - 1;}
    });
    tiptap.chain().focus().setTextSelection(end).insertContent(' guide').run();
    await new Promise(r => setTimeout(r, 400));
    const md = changes[changes.length - 1];
    expect(md).toContain('<!-- toc -->\n\n- [Title](#title)\n  - [Setup guide](#setup-guide)\n  - [Setup](#setup)\n\n<!-- tocstop -->');
    // One undo reverts the rename; the TOC then follows it back.
    tiptap.commands.undo();
    await new Promise(r => setTimeout(r, 400));
    expect(tiptap.storage.markdown.getMarkdown() + '\n').toBe(DOC);
  });

  it('inserts a TOC for the current headings', () => {
    const { handle } = mount('Intro\n\n# A\n\n## B\n');
    handle.tiptap.chain().focus('start').insertTableOfContents().run();
    expect(handle.tiptap.storage.markdown.getMarkdown()).toContain('<!-- toc -->\n\n- [A](#a)\n  - [B](#b)\n\n<!-- tocstop -->');
  });
});
