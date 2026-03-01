import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { readFileSync } from 'fs';
import { join } from 'path';

function createEditor(content = '') {
  const editor = new Editor({
    extensions: [
      StarterKit,
      Markdown.configure({ html: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content,
    element: document.createElement('div'),
  });
  return editor;
}

describe('Edge Cases — Document Content', () => {
  it('handles empty document without throwing', () => {
    expect(() => {
      const e = createEditor('');
      e.destroy();
    }).not.toThrow();
  });

  it('handles frontmatter-only document', () => {
    // Frontmatter is extracted before TipTap sees content
    const frontmatterOnly = '---\ntitle: Test\n---\n';
    const body = frontmatterOnly.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
    // body is empty string — pass empty string so editor creates an empty doc
    const e = createEditor(body || '');
    expect(e.getText().trim()).toBe('');
    e.destroy();
  });

  it('handles deeply nested lists (5 levels)', () => {
    const md = readFileSync(join(__dirname, '../fixtures/edge-cases/deeply-nested.md'), 'utf8');
    expect(() => {
      const e = createEditor(md);
      const out = e.storage.markdown.getMarkdown();
      expect(typeof out).toBe('string');
      e.destroy();
    }).not.toThrow();
  });

  it('handles unicode characters', () => {
    const md = readFileSync(join(__dirname, '../fixtures/edge-cases/unicode.md'), 'utf8');
    expect(() => {
      const e = createEditor(md);
      const out = e.getText();
      expect(out).toContain('日本語');
      e.destroy();
    }).not.toThrow();
  });

  it('handles emoji characters', () => {
    const e = createEditor('# Emoji Test\n\nHello 🎉 World 🚀\n');
    const text = e.getText();
    expect(text).toContain('🎉');
    e.destroy();
  });

  it('handles CRLF line endings', () => {
    const crlfContent = '# CRLF Test\r\n\r\nThis file has Windows line endings.\r\n';
    const normalized = crlfContent.replace(/\r\n/g, '\n');
    expect(() => {
      const e = createEditor(normalized);
      e.destroy();
    }).not.toThrow();
  });

  it('handles mixed line endings by normalizing', () => {
    const mixed = '# Test\r\nLine with CRLF\nLine with LF\r\nAnother CRLF\n';
    const normalized = mixed.replace(/\r\n/g, '\n');
    expect(() => {
      const e = createEditor(normalized);
      e.destroy();
    }).not.toThrow();
  });

  it('handles long single paragraph (1000+ words)', () => {
    const words = Array.from({ length: 1000 }, (_, i) => `word${i}`).join(' ');
    const md = `# Title\n\n${words}\n`;
    expect(() => {
      const e = createEditor(md);
      const out = e.storage.markdown.getMarkdown();
      expect(out.length).toBeGreaterThan(1000);
      e.destroy();
    }).not.toThrow();
  });

  it('handles table with 20 columns', () => {
    const cols = Array.from({ length: 20 }, (_, i) => `Col${i + 1}`);
    const header = `| ${cols.join(' | ')} |`;
    const divider = `| ${cols.map(() => '---').join(' | ')} |`;
    const row = `| ${cols.map((_, i) => `Cell${i + 1}`).join(' | ')} |`;
    const tablemd = `${header}\n${divider}\n${row}\n`;
    expect(() => {
      const e = createEditor(tablemd);
      e.destroy();
    }).not.toThrow();
  });

  it('handles table with 100 rows', () => {
    const header = '| Col1 | Col2 |\n|------|------|\n';
    const rows = Array.from({ length: 100 }, (_, i) => `| Row${i + 1} | Data${i + 1} |`).join('\n');
    const tablemd = header + rows + '\n';
    expect(() => {
      const e = createEditor(tablemd);
      e.destroy();
    }).not.toThrow();
  });

  it('handles deeply nested inline formatting', () => {
    const md = '**bold _italic ~~strike~~_ bold**\n';
    expect(() => {
      const e = createEditor(md);
      const text = e.getText();
      expect(text).toContain('bold');
      e.destroy();
    }).not.toThrow();
  });

  it('handles reference-style links gracefully', () => {
    // tiptap-markdown may not support reference links — they should degrade to plain text
    const md = '[link text][ref]\n\n[ref]: https://example.com\n';
    expect(() => {
      const e = createEditor(md);
      e.destroy();
    }).not.toThrow();
  });
});
