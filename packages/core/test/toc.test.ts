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

function mount(markdown: string, settings?: Parameters<typeof createMikeDownEditor>[1]['settings']) {
  const changes: string[] = [];
  const host: MikeDownHost = Object.assign(new NoopHost(), {
    onChange: (md: string, meta: { pristine: boolean }) => { changes.push(meta.pristine ? `pristine:${md}` : md); },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host, initialMarkdown: markdown, settings });
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

  it('leaves an up-to-date TOC alone on open: no edit, nothing dirty', async () => {
    const { handle, changes } = mount(DOC);
    await new Promise(r => setTimeout(r, 400));
    expect(changes).toEqual([]);
    expect(handle.tiptap.storage.markdown.getMarkdown() + '\n').toBe(DOC);
  });

  it('refreshes a stale TOC once on open, outside the undo history', async () => {
    const stale = '<!-- toc -->\n\n- [Old](#old)\n\n<!-- tocstop -->\n\n# New\n';
    const fresh = '<!-- toc -->\n\n- [New](#new)\n\n<!-- tocstop -->\n\n# New\n';
    const { handle, changes } = mount(stale);
    await new Promise(r => setTimeout(r, 400));
    expect(changes).toEqual([fresh]); // not sent as pristine, so the file is dirtied
    expect(handle.tiptap.can().undo()).toBe(false);
  });

  it('refreshes after the host replaces the content', async () => {
    const { handle, changes } = mount(DOC);
    handle.setMarkdown('<!-- toc -->\n- [A](#a)\n<!-- tocstop -->\n\n# B\n', { pristine: true });
    await new Promise(r => setTimeout(r, 400));
    expect(changes).toEqual(['<!-- toc -->\n\n- [B](#b)\n\n<!-- tocstop -->\n\n# B\n']);
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

describe('placeholder style', () => {
  const tocNodes = (handle: MikeDownEditorHandle) =>
    JSON.stringify(handle.tiptap.getJSON()).match(/"tableOfContents"/g)?.length ?? 0;

  for (const line of ['[toc]', '[[toc]]', '[TOC]', '[[TOC]]']) {
    it(`parses ${line} as a live TOC and saves it unchanged`, async () => {
      const md = `${line}\n\n# A\n\n## B\n`;
      const { handle, changes } = mount(md);
      expect(tocNodes(handle)).toBe(1);
      const links = [...handle.tiptap.view.dom.querySelectorAll('nav.mikedown-toc a')].map(a => a.getAttribute('href'));
      expect(links).toEqual(['#a', '#b']);
      expect(handle.tiptap.storage.markdown.getMarkdown() + '\n').toBe(md);
      await new Promise(r => setTimeout(r, 400));
      expect(changes).toEqual([]);
    });
  }

  it('keeps [[toc]] out of the wikilink node', () => {
    const { handle } = mount('[[toc]]\n\n# A\n');
    expect(JSON.stringify(handle.tiptap.getJSON())).not.toContain('wikilink');
  });

  it('leaves [toc] inside a sentence, or with text on the next line, as text', () => {
    const md = 'See [toc] here.\n\n[toc]\nmore text\n\n# A\n';
    const { handle } = mount(md);
    expect(tocNodes(handle)).toBe(0);
    expect(handle.tiptap.getText()).toContain('See [toc] here.');
    expect(handle.tiptap.getText()).toContain('[toc]\nmore text');
  });

  it('follows heading edits without reporting an edit of its own', async () => {
    const { handle, changes } = mount('[toc]\n\n# A\n');
    const { tiptap } = handle;
    let end = -1;
    tiptap.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {end = pos + node.nodeSize - 1;}
    });
    tiptap.chain().focus().setTextSelection(end).insertContent(' guide').run();
    await new Promise(r => setTimeout(r, 400));
    const links = [...tiptap.view.dom.querySelectorAll('nav.mikedown-toc a')].map(a => a.getAttribute('href'));
    expect(links).toEqual(['#a-guide']);
    expect(changes).toEqual(['[toc]\n\n# A guide\n']);
  });
});

describe('insert respects mikedown.tocStyle', () => {
  it('inserts a marker list by default', () => {
    const { handle } = mount('Intro\n\n# A\n');
    handle.tiptap.chain().focus('start').insertTableOfContents().run();
    expect(handle.tiptap.storage.markdown.getMarkdown()).toContain('<!-- toc -->\n\n- [A](#a)\n\n<!-- tocstop -->');
  });

  it('inserts [toc] with the placeholder style, set at start or later', () => {
    const { handle } = mount('Intro\n\n# A\n', { tocStyle: 'placeholder' });
    handle.tiptap.chain().focus('start').insertTableOfContents().run();
    expect(handle.tiptap.storage.markdown.getMarkdown()).toMatch(/^\[toc\]\n\nIntro|^Intro\n\n\[toc\]/);
    expect(handle.tiptap.view.dom.querySelector('nav.mikedown-toc a')?.getAttribute('href')).toBe('#a');

    const other = mount('Intro\n\n# A\n').handle;
    other.updateSettings({ tocStyle: 'placeholder' });
    other.tiptap.chain().focus('start').insertTableOfContents().run();
    expect(other.tiptap.storage.markdown.getMarkdown()).toContain('[toc]');
    expect(other.tiptap.storage.markdown.getMarkdown()).not.toContain('<!-- toc -->');
  });
});

describe('[toc] + Enter', () => {
  /** Type like a user: each char goes through `handleTextInput` so input rules fire. */
  function type(handle: MikeDownEditorHandle, text: string) {
    const { view } = handle.tiptap;
    for (const ch of text) {
      const { from, to } = view.state.selection;
      const handled = view.someProp('handleTextInput', (f: any) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)));
      if (!handled) {view.dispatch(view.state.tr.insertText(ch, from, to));}
    }
  }
  const enter = (handle: MikeDownEditorHandle) =>
    handle.tiptap.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const blocks = (handle: MikeDownEditorHandle) => handle.tiptap.getJSON().content!.map(n => n.type);

  function start(settings?: { tocStyle: 'list' | 'placeholder' }) {
    const m = mount('# A\n\nlast\n', settings);
    m.handle.tiptap.commands.focus('end');
    enter(m.handle);
    return m;
  }

  for (const text of ['[toc]', '[[toc]]', '[TOC]']) {
    it(`turns ${text} into a TOC, cursor in a paragraph after it`, () => {
      const { handle } = start();
      type(handle, text);
      enter(handle);
      expect(blocks(handle)).toEqual(['heading', 'paragraph', 'tableOfContents', 'paragraph']);
      expect(handle.tiptap.state.selection.$from.parent.type.name).toBe('paragraph');
      expect(handle.tiptap.state.selection.$from.index(0)).toBe(3);
      expect(handle.tiptap.storage.markdown.getMarkdown()).toContain('<!-- toc -->\n\n- [A](#a)\n\n<!-- tocstop -->');
      expect(JSON.stringify(handle.tiptap.getJSON())).not.toContain('wikilink');
    });
  }

  it('leaves [toc] mid-sentence, [toc](x) and inline code as text', () => {
    for (const text of ['see [toc]', '[toc](x)']) {
      const { handle } = start();
      type(handle, text);
      enter(handle);
      expect(blocks(handle)).not.toContain('tableOfContents');
    }
    // Only the whole-paragraph case escapes the wikilink rule.
    const wiki = start().handle;
    type(wiki, 'see [[toc]]');
    expect(JSON.stringify(wiki.tiptap.getJSON())).toContain('wikilink');
    const { handle } = start();
    handle.tiptap.chain().insertContent({ type: 'text', text: '[toc]', marks: [{ type: 'code' }] }).run();
    enter(handle);
    expect(blocks(handle)).not.toContain('tableOfContents');
  });

  it('uses the placeholder style when set', () => {
    const { handle } = start({ tocStyle: 'placeholder' });
    type(handle, '[toc]');
    enter(handle);
    expect(blocks(handle)).toContain('tableOfContents');
    expect(handle.tiptap.storage.markdown.getMarkdown()).toBe('# A\n\nlast\n\n[toc]');
  });

  it('one undo brings the typed text back', () => {
    const { handle } = start();
    type(handle, '[toc]');
    enter(handle);
    handle.tiptap.commands.undo();
    expect(blocks(handle)).toEqual(['heading', 'paragraph', 'paragraph']);
    expect(handle.tiptap.getText()).toContain('[toc]');
  });
});
