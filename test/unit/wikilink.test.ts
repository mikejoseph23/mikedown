import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import Link from '@tiptap/extension-link';
import { Wikilink, parseWikilink, serializeWikilink } from '../../src/webview/wikilink-node';

function makeEditor(content = '') {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Markdown.configure({ html: false, tightLists: true, breaks: true }),
      Link.configure({ openOnClick: false }),
      Wikilink,
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

describe('Wikilink — Obsidian-style [[wikilinks]]', () => {
  describe('round-trip fidelity', () => {
    for (const src of ['[[Note]]', '[[Note|alias]]', '[[Note#Heading]]', '[[Note#Heading|alias]]']) {
      it(`round-trips ${src}`, () => {
        expect(roundTrip(src).trim()).toContain(src);
      });
    }

    it('round-trips a wikilink embedded in a sentence', () => {
      const md = 'See [[Note]] for details.';
      const out = roundTrip(md).trim();
      expect(out).toContain('[[Note]]');
      expect(out).toContain('See');
      expect(out).toContain('for details.');
    });

    it('round-trips two wikilinks on one line', () => {
      const md = '[[A]] and [[B]]';
      const out = roundTrip(md).trim();
      expect(out).toContain('[[A]]');
      expect(out).toContain('[[B]]');
    });
  });

  describe('HTML rendering', () => {
    it('renders alias as the visible label, not raw brackets', () => {
      const html = getHTML('[[Note|shown]]');
      expect(html).toContain('data-wikilink');
      expect(html).toContain('data-target="Note"');
      expect(html).toContain('shown');
      expect(html).not.toContain('[[');
    });

    it('renders the target as the label when no alias is present', () => {
      const html = getHTML('[[Note]]');
      expect(html).toContain('data-wikilink');
      expect(html).toContain('data-target="Note"');
      expect(html).toContain('>Note<');
      expect(html).not.toContain('[[');
    });

    it('parses the #anchor into data-anchor', () => {
      const html = getHTML('[[Note#Heading]]');
      expect(html).toContain('data-anchor="Heading"');
    });
  });

  describe('parseWikilink', () => {
    it('parses a bare target', () => {
      expect(parseWikilink('[[Note]]')).toEqual({ target: 'Note', anchor: null, alias: null });
    });

    it('parses target#anchor|alias', () => {
      expect(parseWikilink('[[Note#H|a]]')).toEqual({ target: 'Note', anchor: 'H', alias: 'a' });
    });

    it('returns null for non-wikilink input', () => {
      expect(parseWikilink('not a wikilink')).toBeNull();
    });
  });

  describe('serializeWikilink', () => {
    it('serializes all parts', () => {
      expect(serializeWikilink({ target: 'Note', anchor: 'H', alias: 'a' })).toBe('[[Note#H|a]]');
    });

    it('serializes a bare target', () => {
      expect(serializeWikilink({ target: 'Note' })).toBe('[[Note]]');
    });
  });

  describe('parse/serialize round-trip property', () => {
    for (const x of ['[[A]]', '[[A|b]]', '[[A#c]]', '[[A#c|d]]']) {
      it(`serializeWikilink(parseWikilink(${x})) === ${x}`, () => {
        expect(serializeWikilink(parseWikilink(x)!)).toBe(x);
      });
    }
  });
});
