import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import Link from '@tiptap/extension-link';
import { HtmlAnchor } from '../../src/webview/htmlanchor';

function makeEditor(content = '') {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Markdown.configure({ html: false, tightLists: true }),
      Link.configure({ openOnClick: false }),
      HtmlAnchor,
    ],
    content,
    element: document.createElement('div'),
  });
}

function roundTrip(md: string): string {
  const editor = makeEditor(md);
  const out = editor.storage.markdown.getMarkdown();
  editor.destroy();
  return out;
}

function getHTML(md: string): string {
  const editor = makeEditor(md);
  const html = editor.getHTML();
  editor.destroy();
  return html;
}

describe('HtmlAnchor — inline HTML anchor targets', () => {
  it('round-trips <a id="top"></a> at the start of a doc', () => {
    const md = '<a id="top"></a>\n\n# Heading\n\n[Back to top](#top)\n';
    const out = roundTrip(md);
    expect(out).toContain('<a id="top"></a>');
    expect(out).toContain('# Heading');
    expect(out).toContain('[Back to top](#top)');
  });

  it('round-trips <a name="foo"></a>', () => {
    const md = 'intro text <a name="foo"></a> more text\n';
    const out = roundTrip(md);
    expect(out).toContain('<a name="foo"></a>');
  });

  it('renders the anchor into the editor DOM with its id', () => {
    const html = getHTML('<a id="top"></a>\n\n# Title\n');
    expect(html).toMatch(/<a[^>]*\bid="top"[^>]*>\s*<\/a>/i);
  });

  it('does not swallow normal links with href', () => {
    const md = '[click](https://example.com)\n';
    const out = roundTrip(md);
    expect(out).toContain('[click](https://example.com)');
  });

  it('ignores anchors with href (they remain real links)', () => {
    const html = getHTML('<a id="x" href="https://example.com">click</a>\n');
    // It should NOT be our atom node — the id-only anchor node wouldn't
    // contain text. So either the HTML is passed through literally or
    // parsed as a link. Either way, our node must reject it.
    expect(html).not.toMatch(/<a[^>]*\bid="x"[^>]*>\s*<\/a>/i);
  });

  it('supports multiple anchors in the same document', () => {
    const md = '<a id="a"></a>\n\n# One\n\n<a id="b"></a>\n\n# Two\n';
    const out = roundTrip(md);
    expect(out).toContain('<a id="a"></a>');
    expect(out).toContain('<a id="b"></a>');
  });
});
