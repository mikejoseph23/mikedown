import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { Highlight } from '../../src/webview/highlight';

function makeEditor(content = '') {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Markdown.configure({ html: false, tightLists: true, breaks: true }),
      Highlight,
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

describe('Highlight — ==text== mark', () => {
  it('parses `==text==` into a highlight mark', () => {
    const html = getHTML('Here is ==highlighted== text.\n');
    expect(html).toContain('<mark>highlighted</mark>');
  });

  it('round-trips `==text==` unchanged', () => {
    const out = roundTrip('Here is ==highlighted== text.\n');
    expect(out).toContain('==highlighted==');
    expect(out).not.toContain('<mark>');
  });

  it('round-trips highlight inside a paragraph with other marks', () => {
    const out = roundTrip('A **bold** and ==marked== span.\n');
    expect(out).toContain('**bold**');
    expect(out).toContain('==marked==');
  });

  it('toggleHighlight wraps selected text', () => {
    const editor = makeEditor('hello world');
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.commands.toggleHighlight();
    const md = (editor.storage as any).markdown.getMarkdown() as string;
    editor.destroy();
    expect(md).toContain('==hello==');
  });

  it('leaves a single = inside text untouched', () => {
    const out = roundTrip('plain a = b text\n');
    expect(out).toContain('a = b');
    expect(out).not.toContain('==');
  });

  it('does not match `== ==` with no content', () => {
    const html = getHTML('foo ==  == bar\n');
    expect(html).not.toContain('<mark>');
  });
});
