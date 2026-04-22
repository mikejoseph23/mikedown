import { describe, it, expect, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo, redo } from '@codemirror/commands';
import {
  cmFindReplaceExtension,
  cmUpdateSearch,
  cmFindNext,
  cmFindPrev,
  cmClearSearch,
  cmReplaceCurrent,
  cmReplaceAll,
} from '../../src/webview/findreplace';

let view: EditorView;

function createCmView(doc: string): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const state = EditorState.create({
    doc,
    extensions: [history(), ...cmFindReplaceExtension],
  });
  view = new EditorView({ state, parent });
  return view;
}

function getDecorationClasses(): string[] {
  const spans = view.dom.querySelectorAll('.search-match, .search-match-active');
  return Array.from(spans).map(s => s.className);
}

afterEach(() => {
  view?.destroy();
  document.body.innerHTML = '';
});

describe('CodeMirror Find & Replace', () => {
  it('finds matches and applies decorations', () => {
    createCmView('Hello world, hello everyone');
    const matches = cmUpdateSearch(view, { query: 'hello', matchCase: false, wholeWord: false, useRegex: false });
    expect(matches.length).toBe(2);
    const classes = getDecorationClasses();
    expect(classes.length).toBe(2);
    expect(classes).toContain('search-match-active');
    expect(classes).toContain('search-match');
  });

  it('respects matchCase option', () => {
    createCmView('Hello hello HELLO');
    const matches = cmUpdateSearch(view, { query: 'hello', matchCase: true, wholeWord: false, useRegex: false });
    expect(matches.length).toBe(1);
  });

  it('respects wholeWord option', () => {
    createCmView('cat category catalog cat');
    const matches = cmUpdateSearch(view, { query: 'cat', matchCase: false, wholeWord: true, useRegex: false });
    expect(matches.length).toBe(2);
  });

  it('supports regex', () => {
    createCmView('foo1 foo22 bar foo333');
    const matches = cmUpdateSearch(view, { query: 'foo\\d+', matchCase: false, wholeWord: false, useRegex: true });
    expect(matches.length).toBe(3);
  });

  it('returns no matches for invalid regex', () => {
    createCmView('anything');
    const matches = cmUpdateSearch(view, { query: '[unclosed', matchCase: false, wholeWord: false, useRegex: true });
    expect(matches.length).toBe(0);
  });

  it('cmFindNext advances the active match and wraps', () => {
    createCmView('alpha beta alpha beta alpha');
    cmUpdateSearch(view, { query: 'alpha' });
    // Active is initially match 0
    cmFindNext(view);
    // Active should now be match 1
    let actives = view.dom.querySelectorAll('.search-match-active');
    expect(actives.length).toBe(1);
    cmFindNext(view);
    cmFindNext(view); // wraps back to 0
    actives = view.dom.querySelectorAll('.search-match-active');
    expect(actives.length).toBe(1);
  });

  it('cmFindPrev wraps backward from first match', () => {
    createCmView('alpha beta alpha');
    cmUpdateSearch(view, { query: 'alpha' });
    cmFindPrev(view); // should wrap to last
    const actives = view.dom.querySelectorAll('.search-match-active');
    expect(actives.length).toBe(1);
  });

  it('cmClearSearch removes decorations', () => {
    createCmView('Hello world');
    cmUpdateSearch(view, { query: 'Hello' });
    expect(getDecorationClasses().length).toBeGreaterThan(0);
    cmClearSearch(view);
    expect(getDecorationClasses().length).toBe(0);
  });

  it('cmReplaceCurrent replaces only the active match', () => {
    createCmView('foo bar foo bar foo');
    cmUpdateSearch(view, { query: 'foo' });
    cmReplaceCurrent(view, 'XX');
    expect(view.state.doc.toString()).toBe('XX bar foo bar foo');
  });

  it('cmReplaceAll replaces every match', () => {
    createCmView('foo bar foo bar foo');
    cmUpdateSearch(view, { query: 'foo' });
    const n = cmReplaceAll(view, 'XX');
    expect(n).toBe(3);
    expect(view.state.doc.toString()).toBe('XX bar XX bar XX');
  });

  it('cmReplaceAll with overlap-free regex updates all matches in one dispatch', () => {
    createCmView('a1 a22 a333');
    cmUpdateSearch(view, { query: 'a\\d+', matchCase: false, wholeWord: false, useRegex: true });
    const n = cmReplaceAll(view, 'Z');
    expect(n).toBe(3);
    expect(view.state.doc.toString()).toBe('Z Z Z');
  });

  it('empty query produces no matches and no decorations', () => {
    createCmView('some content');
    const matches = cmUpdateSearch(view, { query: '' });
    expect(matches.length).toBe(0);
    expect(getDecorationClasses().length).toBe(0);
  });

  it('undo reverses a replace (CM history intact)', () => {
    createCmView('foo bar foo');
    cmUpdateSearch(view, { query: 'foo' });
    cmReplaceAll(view, 'XX');
    expect(view.state.doc.toString()).toBe('XX bar XX');
    undo({ state: view.state, dispatch: view.dispatch });
    expect(view.state.doc.toString()).toBe('foo bar foo');
    redo({ state: view.state, dispatch: view.dispatch });
    expect(view.state.doc.toString()).toBe('XX bar XX');
  });
});
