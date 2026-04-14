import { describe, it, expect, beforeAll } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { readFileSync } from 'fs';
import { join } from 'path';

// Helper: create a minimal TipTap editor for testing
function createTestEditor(content = '') {
  return new Editor({
    extensions: [
      StarterKit,
      Markdown.configure({ html: false, tightLists: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Link.configure({ isAllowedUri: () => true }),
      Image,
    ],
    content,
    element: document.createElement('div'),
  });
}

function roundTrip(md: string): string {
  const editor = createTestEditor(md);
  const result = editor.storage.markdown.getMarkdown();
  editor.destroy();
  return result;
}

describe('Markdown Round-Trip', () => {
  it('preserves headings H1-H6', () => {
    for (let i = 1; i <= 6; i++) {
      const md = `${'#'.repeat(i)} Heading ${i}\n`;
      const out = roundTrip(md);
      expect(out).toContain(`${'#'.repeat(i)} Heading ${i}`);
    }
  });

  it('preserves bold text', () => {
    const md = '**bold text**\n';
    expect(roundTrip(md)).toContain('bold text');
  });

  it('preserves italic text', () => {
    const md = '*italic text*\n';
    expect(roundTrip(md)).toContain('italic text');
  });

  it('preserves strikethrough', () => {
    const md = '~~strikethrough~~\n';
    expect(roundTrip(md)).toContain('strikethrough');
  });

  it('preserves inline code', () => {
    const md = '`inline code`\n';
    expect(roundTrip(md)).toContain('inline code');
  });

  it('preserves links', () => {
    const md = '[Link](https://example.com)\n';
    const out = roundTrip(md);
    expect(out).toContain('https://example.com');
  });

  it('preserves relative-path links (e.g. Planning/README.md)', () => {
    // Regression: TipTap Link's default isAllowedUri regex treats `.-:` as a
    // character range, so hrefs like "Planning/README.md" were being dropped
    // and links rendered as plain text.
    const md = [
      '- [Planning](Planning/README.md)',
      '- [Meeting](meetings/2026-04-10%20-%20Initial%20Call/README.md)',
      '',
    ].join('\n');
    const out = roundTrip(md);
    expect(out).toContain('[Planning](Planning/README.md)');
    expect(out).toContain('meetings/2026-04-10%20-%20Initial%20Call/README.md');
  });

  it('preserves unordered lists', () => {
    const md = '- Item 1\n- Item 2\n- Item 3\n';
    const out = roundTrip(md);
    expect(out).toContain('Item 1');
    expect(out).toContain('Item 2');
  });

  it('preserves ordered lists', () => {
    const md = '1. First\n2. Second\n3. Third\n';
    const out = roundTrip(md);
    expect(out).toContain('First');
    expect(out).toContain('Second');
  });

  it('preserves blockquotes', () => {
    const md = '> This is a quote\n';
    const out = roundTrip(md);
    expect(out).toContain('This is a quote');
  });

  it('preserves fenced code blocks with language', () => {
    const md = '```javascript\nconst x = 1;\n```\n';
    const out = roundTrip(md);
    expect(out).toContain('const x = 1;');
  });

  it('handles empty document', () => {
    const out = roundTrip('');
    expect(typeof out).toBe('string');
  });

  it('handles document with only whitespace', () => {
    expect(() => roundTrip('   \n\n\n')).not.toThrow();
  });

  it('preserves tables', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |\n';
    const out = roundTrip(md);
    expect(out).toContain('|');
  });

  it('handles full sample fixture', () => {
    const fixture = readFileSync(join(__dirname, '../fixtures/sample.md'), 'utf8');
    expect(() => roundTrip(fixture)).not.toThrow();
  });
});
