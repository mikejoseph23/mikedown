import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { Emoji } from '../../src/webview/emoji';

function makeEditor(content = '') {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Markdown.configure({ html: false, tightLists: true, breaks: true }),
      Emoji,
    ],
    content,
    element: document.createElement('div'),
  });
}

function getHTML(md: string): string {
  const editor = makeEditor(md);
  const html = editor.getHTML();
  editor.destroy();
  return html;
}

function roundTrip(md: string): string {
  const editor = makeEditor(md);
  const out = (editor.storage as any).markdown.getMarkdown() as string;
  editor.destroy();
  return out;
}

describe('Emoji — :shortcode: parsing', () => {
  it('parses `:smile:` to a 😄 span', () => {
    const html = getHTML('Hello :smile: world\n');
    expect(html).toContain('data-emoji-shortcode="smile"');
    expect(html).toContain('😄');
  });

  it('round-trips `:smile:` back to source form', () => {
    const out = roundTrip('Hello :smile: world\n');
    expect(out).toContain(':smile:');
  });

  it('leaves unknown shortcodes alone as plain text', () => {
    const html = getHTML('A :notarealemoji: should pass through\n');
    expect(html).not.toContain('data-emoji-shortcode="notarealemoji"');
    expect(html).toContain(':notarealemoji:');
  });

  it('supports multiple shortcodes in one paragraph', () => {
    const html = getHTML('Mood :sob: -> :sunglasses: -> :tada:\n');
    expect(html).toContain('data-emoji-shortcode="sob"');
    expect(html).toContain('data-emoji-shortcode="sunglasses"');
    expect(html).toContain('data-emoji-shortcode="tada"');
  });

  it('renders the canonical Unicode character for the shortcode', () => {
    // Sanity check that markdown-it-emoji's data map is consistent — :tada: must
    // come through as 🎉 so the picker / autocomplete UIs render correctly.
    const html = getHTML(':tada:\n');
    expect(html).toContain('🎉');
  });
});
