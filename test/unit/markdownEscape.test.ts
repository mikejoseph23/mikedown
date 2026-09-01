import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import {
  escapeMarkdownText,
  escapeMarkdownRun,
  needsAmpersandEscape,
  needsLessThanEscape,
} from '../../src/webview/markdownEscape';
import { MarkdownText, MarkdownHardBreak } from '../../src/webview/markdownText';

// ---------------------------------------------------------------------------
// Pure escaper
// ---------------------------------------------------------------------------

describe('escapeMarkdownText', () => {
  it('leaves angle brackets alone when they cannot start HTML or an autolink', () => {
    expect(escapeMarkdownText('jobs/<job>/<slug>')).toBe('jobs/<job>/<slug>');
    expect(escapeMarkdownText('a < b and c > d')).toBe('a < b and c > d');
    expect(escapeMarkdownText('<3')).toBe('<3');
    expect(escapeMarkdownText('x<y>z')).toBe('x<y>z');
  });

  it('never emits HTML entities', () => {
    expect(escapeMarkdownText('a <b> c')).not.toContain('&lt;');
    expect(escapeMarkdownText('a <b> c')).not.toContain('&gt;');
  });

  it('escapes `<` that would be read as a URI or email autolink', () => {
    expect(escapeMarkdownText('<https://example.com>')).toBe('\\<https://example.com>');
    expect(escapeMarkdownText('<foo@bar.com>')).toBe('\\<foo@bar.com>');
    expect(needsLessThanEscape('<mailto:a@b.co>', 0, false)).toBe(true);
  });

  it('escapes `<` that opens raw HTML only in html mode', () => {
    expect(escapeMarkdownText('<div>', { html: false })).toBe('<div>');
    expect(escapeMarkdownText('<div>', { html: true })).toBe('\\<div>');
    expect(escapeMarkdownText('</div>', { html: true })).toBe('\\</div>');
    expect(escapeMarkdownText('<!-- hi -->', { html: true })).toBe('\\<!-- hi -->');
    // Not a tag name — safe either way.
    expect(escapeMarkdownText('<3 and <=', { html: true })).toBe('<3 and <=');
  });

  it('escapes `&` only when it starts a character reference', () => {
    expect(escapeMarkdownText('AT&T')).toBe('AT&T');
    expect(escapeMarkdownText('a & b')).toBe('a & b');
    expect(escapeMarkdownText('&amp;')).toBe('\\&amp;');
    expect(escapeMarkdownText('&#60;')).toBe('\\&#60;');
    expect(escapeMarkdownText('&#x3C;')).toBe('\\&#x3C;');
    expect(needsAmpersandEscape('&notanentity', 0)).toBe(false);
  });

  it('keeps prosemirror-markdown\u2019s escape set for emphasis and link syntax', () => {
    expect(escapeMarkdownText('5 * 3')).toBe('5 \\* 3');
    expect(escapeMarkdownText('a `b` c')).toBe('a \\`b\\` c');
    expect(escapeMarkdownText('[x]')).toBe('\\[x\\]');
    expect(escapeMarkdownText('~x~')).toBe('\\~x\\~');
    expect(escapeMarkdownText('C:\\path')).toBe('C:\\\\path');
  });

  it('leaves intra-word underscores unescaped', () => {
    expect(escapeMarkdownText('snake_case_word')).toBe('snake_case_word');
    expect(escapeMarkdownText('_leading')).toBe('\\_leading');
    expect(escapeMarkdownText('trailing_')).toBe('trailing\\_');
  });

  it('escapes block markers only at the start of a line', () => {
    expect(escapeMarkdownText('- item', { startOfLine: true })).toBe('\\- item');
    expect(escapeMarkdownText('> quote', { startOfLine: true })).toBe('\\> quote');
    expect(escapeMarkdownText('# head', { startOfLine: true })).toBe('\\# head');
    expect(escapeMarkdownText('1. one', { startOfLine: true })).toBe('1\\. one');
    expect(escapeMarkdownText('- item', { startOfLine: false })).toBe('- item');
  });

  it('escapes pipes only inside table cells', () => {
    expect(escapeMarkdownText('a | b')).toBe('a | b');
    expect(escapeMarkdownText('a | b', { inTable: true })).toBe('a \\| b');
  });

  it('treats every line after the first as a line start', () => {
    expect(escapeMarkdownRun('ok\n- item')).toBe('ok\n\\- item');
    expect(escapeMarkdownRun('- a\n- b', { startOfLine: true })).toBe('\\- a\n\\- b');
  });
});

// ---------------------------------------------------------------------------
// Serializer wiring — the same extension set the webview builds (issue #5)
// ---------------------------------------------------------------------------

function createEditor(content: string) {
  return new Editor({
    extensions: [
      StarterKit.configure({ text: false, hardBreak: false } as any),
      MarkdownText,
      MarkdownHardBreak,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Markdown.configure({
        html: false,
        tightLists: true,
        breaks: true,
        bulletListMarker: '-',
        linkify: false,
      }),
    ],
    content,
    element: document.createElement('div'),
  });
}

function serialize(md: string): string {
  const editor = createEditor(md);
  const out = editor.storage.markdown.getMarkdown() as string;
  editor.destroy();
  return out;
}

function docOf(md: string): string {
  const editor = createEditor(md);
  const out = JSON.stringify(editor.getJSON());
  editor.destroy();
  return out;
}

describe('markdown serialization (issue #5)', () => {
  it('does not turn angle brackets into HTML entities', () => {
    const md = 'npx tsx scripts/copy.ts jobs/<job>/<slug>\n';
    const out = serialize(md);
    expect(out).not.toContain('&lt;');
    expect(out).not.toContain('&gt;');
    expect(out).toContain('jobs/<job>/<slug>');
  });

  it('keeps angle brackets inside a blockquote', () => {
    const out = serialize('> deploy to <env> now\n');
    expect(out).toBe('> deploy to <env> now');
  });

  it('does not append a backslash to soft-wrapped lines', () => {
    expect(serialize('line one\nline two\n')).toBe('line one\nline two');
    expect(serialize('> line one\n> line two\n')).toBe('> line one\n> line two');
  });

  it('keeps a hard break that is followed by a block marker', () => {
    // Previously serialized as `hello\` + a real list — the break was lost and a
    // literal backslash was left behind.
    const md = 'hello\n\\- item\n';
    expect(serialize(md)).toBe('hello\n\\- item');
    expect(docOf(serialize(md))).toBe(docOf(md));
  });

  it('leaves inline code and fenced code untouched', () => {
    expect(serialize('Use `jobs/<job>/<slug>__*` here.\n')).toBe('Use `jobs/<job>/<slug>__*` here.');
    expect(serialize('```\njobs/<job>/<slug>__*\n```\n')).toBe('```\njobs/<job>/<slug>__*\n```');
  });

  it('still escapes autolinks so they round-trip as text', () => {
    const editor = createEditor('');
    editor.commands.setContent(
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '<https://example.com>' }] }] },
      { emitUpdate: false } as any
    );
    const out = editor.storage.markdown.getMarkdown() as string;
    editor.destroy();
    expect(out).toBe('\\<https://example.com>');
    expect(docOf(out)).toBe(
      JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '<https://example.com>' }] }],
      })
    );
  });

  it('escapes a pipe inside a table cell', () => {
    const md = '| a | b |\n| --- | --- |\n| x \\| y | z |\n';
    const out = serialize(md);
    expect(out).toContain('x \\| y');
    expect(docOf(out)).toBe(docOf(md));
  });

  it('round-trips the document from issue #5 unchanged on a second pass', () => {
    const md = '> npx tsx scripts/copy.ts jobs/<job>/<slug>\n> for d in folder/job-x; do\n';
    const once = serialize(md);
    expect(once).toBe('> npx tsx scripts/copy.ts jobs/<job>/<slug>\n> for d in folder/job-x; do');
    expect(serialize(once + '\n')).toBe(once);
  });

  it('is stable across a second serialization for a mixed corpus', () => {
    const corpus = [
      'plain <job> text',
      'a < b and c > d',
      'AT&T and &amp; and &copy;',
      'snake_case and 5 * 3 = 15',
      'C:\\Users\\me\\file.txt',
      '# Heading with <tag>',
      '- list <item>\n- another',
      '1. one <x>\n2. two',
      '> quote <y>',
      '**bold <b>** and *em <i>*',
      '[link](https://example.com) and `code <c>`',
      '| h1 | h2 |\n| --- | --- |\n| <a> | b |',
      '```js\nconst a = b < c;\n```',
      'line one\nline two\nline three',
      '~~strike <s>~~',
    ];
    for (const md of corpus) {
      const once = serialize(md + '\n');
      const twice = serialize(once + '\n');
      expect(twice, `unstable: ${JSON.stringify(md)}`).toBe(once);
      expect(docOf(once), `doc drift: ${JSON.stringify(md)}`).toBe(docOf(md + '\n'));
    }
  });
});

describe('hard breaks (issue #5)', () => {
  it('keeps consecutive hard breaks inside one paragraph', () => {
    const md = 'a\n\\\nb\n';
    expect(docOf(md)).toContain('hardBreak');
    expect(serialize(md)).toBe('a\n\\\nb');
    expect(docOf(serialize(md))).toBe(docOf(md));
  });

  it('drops hard breaks that trail the end of a block', () => {
    const editor = createEditor('');
    editor.commands.setContent(
      {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }] },
        ],
      },
      { emitUpdate: false } as any
    );
    const out = editor.storage.markdown.getMarkdown() as string;
    editor.destroy();
    expect(out).toBe('a');
  });

  it('uses <br> for a hard break inside a table cell', () => {
    const editor = createEditor('| h |\n| --- |\n| a |\n');
    editor.commands.setContent(
      {
        type: 'doc',
        content: [
          {
            type: 'table',
            content: [
              { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'h' }] }] }] },
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableCell',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
      { emitUpdate: false } as any
    );
    const out = editor.storage.markdown.getMarkdown() as string;
    editor.destroy();
    expect(out).toContain('a<br>b');
  });
});
