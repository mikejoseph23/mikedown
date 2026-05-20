import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import Link from '@tiptap/extension-link';
import { Callout } from '../../src/webview/callout-node';

function makeEditor(content = '') {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Markdown.configure({ html: false, tightLists: true, breaks: true }),
      Link.configure({ openOnClick: false }),
      Callout,
    ],
    content,
    element: document.createElement('div'),
  });
}

function roundTrip(md: string): string {
  const editor = makeEditor(md);
  const out = (editor.storage as any).markdown.getMarkdown() as string;
  editor.destroy();
  return out;
}

function getHTML(md: string): string {
  const editor = makeEditor(md);
  const html = editor.getHTML();
  editor.destroy();
  return html;
}

describe('Callout — GitHub-style alert blocks', () => {
  for (const kind of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const) {
    it(`round-trips a [!${kind}] callout with single-line body`, () => {
      const md = `> [!${kind}]\n> hello world\n`;
      const out = roundTrip(md);
      expect(out).toContain(`> [!${kind}]`);
      expect(out).toContain('> hello world');
      // The marker line must not survive as visible content inside the body
      expect(out).not.toMatch(new RegExp(`> hello world\\s*\\[!${kind}\\]`));
    });

    it(`renders [!${kind}] as a callout blockquote in the editor DOM`, () => {
      const html = getHTML(`> [!${kind}]\n> body\n`);
      expect(html).toMatch(new RegExp(`<blockquote[^>]*data-callout="${kind.toLowerCase()}"`));
      expect(html).toMatch(new RegExp(`mikedown-callout--${kind.toLowerCase()}`));
      // Marker text must not leak into the editor DOM as content
      expect(html).not.toContain(`[!${kind}]`);
    });
  }

  it('round-trips a multi-line callout body', () => {
    const md = '> [!WARNING]\n> line one\n> line two\n';
    const out = roundTrip(md);
    expect(out).toMatch(/> \[!WARNING\]\n> line one\nline two|> \[!WARNING\]\n> line one[\s\S]*line two/);
    expect(out).toContain('line one');
    expect(out).toContain('line two');
  });

  it('normalizes lowercase [!note] to uppercase on serialize', () => {
    const md = '> [!note]\n> body\n';
    const out = roundTrip(md);
    expect(out).toContain('> [!NOTE]');
    expect(out).not.toContain('[!note]');
  });

  it('falls back to a plain blockquote for unknown kinds like [!FOOBAR]', () => {
    const md = '> [!FOOBAR]\n> body line\n';
    const out = roundTrip(md);
    // Content must survive — neither the marker nor the body should be lost.
    // The bracket characters may be backslash-escaped by the default
    // blockquote serializer (`\[!FOOBAR\]`); both forms render identically.
    expect(out.replace(/\\/g, '')).toContain('[!FOOBAR]');
    expect(out).toContain('body line');
    // Must NOT be promoted to a callout
    const html = getHTML(md);
    expect(html).not.toMatch(/data-callout=/);
  });

  it('leaves plain blockquotes untouched', () => {
    const md = '> just a quote\n';
    const out = roundTrip(md);
    expect(out.trim()).toBe('> just a quote');
    const html = getHTML(md);
    expect(html).not.toMatch(/data-callout=/);
    expect(html).toMatch(/<blockquote(?![^>]*data-callout)/);
  });

  it('handles an empty callout body (marker line only)', () => {
    const md = '> [!NOTE]\n';
    const out = roundTrip(md);
    expect(out).toContain('> [!NOTE]');
    // The HTML should still be a callout, not a plain blockquote
    const html = getHTML(md);
    expect(html).toMatch(/data-callout="note"/);
  });
});
