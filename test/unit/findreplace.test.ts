import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  FindReplaceExtension,
  updateSearch,
  findNext,
  findPrev,
  clearSearch,
} from '../../src/webview/findreplace';

let editor: Editor;

function createEditor(content: string) {
  editor = new Editor({
    extensions: [StarterKit, FindReplaceExtension],
    content,
    element: document.createElement('div'),
  });
}

afterEach(() => { editor?.destroy(); });

function getDecorationClasses(): string[] {
  // Inspect the rendered DOM for search-match spans.
  const dom = editor.view.dom as HTMLElement;
  const spans = dom.querySelectorAll('.search-match, .search-match-active');
  return Array.from(spans).map(s => s.className);
}

describe('Find & Replace', () => {
  it('finds matches and applies decorations (simple paragraph)', () => {
    createEditor('<p>Hello world, hello everyone</p>');
    const matches = updateSearch(editor, { query: 'hello' });
    expect(matches.length).toBe(2);
    const classes = getDecorationClasses();
    expect(classes.length).toBe(2);
    expect(classes).toContain('search-match-active');
    expect(classes).toContain('search-match');
  });

  it('finds matches across multiple blocks', () => {
    createEditor('<p>First paragraph with target</p><p>Second target line</p>');
    const matches = updateSearch(editor, { query: 'target' });
    expect(matches.length).toBe(2);
    const classes = getDecorationClasses();
    expect(classes.length).toBe(2);
  });

  it('findNext updates active decoration', () => {
    createEditor('<p>alpha beta alpha beta alpha</p>');
    const matches = updateSearch(editor, { query: 'alpha' });
    expect(matches.length).toBe(3);
    findNext(editor);
    // After findNext, the second match should be active.
    const dom = editor.view.dom as HTMLElement;
    const actives = dom.querySelectorAll('.search-match-active');
    expect(actives.length).toBe(1);
  });

  it('clearSearch removes decorations', () => {
    createEditor('<p>Hello world</p>');
    updateSearch(editor, { query: 'Hello' });
    expect(getDecorationClasses().length).toBeGreaterThan(0);
    clearSearch(editor);
    expect(getDecorationClasses().length).toBe(0);
  });

  it('finds matches in headings and lists', () => {
    createEditor('<h1>Target heading</h1><ul><li>target item one</li><li>target item two</li></ul>');
    const matches = updateSearch(editor, { query: 'target' });
    expect(matches.length).toBe(3);
    expect(getDecorationClasses().length).toBe(3);
  });

  it('finds matches across mixed blocks (regression: textOffset → PM pos mapping)', () => {
    createEditor('<p>alpha</p><blockquote><p>beta</p></blockquote><p>gamma alpha</p>');
    const matches = updateSearch(editor, { query: 'alpha' });
    expect(matches.length).toBe(2);
    expect(getDecorationClasses().length).toBe(2);
    // Ensure each match spans a non-empty range and the positions are distinct.
    expect(matches[0].from).toBeLessThan(matches[0].to);
    expect(matches[1].from).toBeLessThan(matches[1].to);
    expect(matches[0].from).not.toBe(matches[1].from);
  });
});
