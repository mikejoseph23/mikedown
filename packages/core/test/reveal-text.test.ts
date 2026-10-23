/**
 * `revealText`: a host (folder search) shows a match by source line/column.
 * Pure locating helpers first, then the editor in rich text and source mode.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
import { locateInSource } from '../src/revealText';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

function mount(markdown: string) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host: new NoopHost(), initialMarkdown: markdown });
  mounted.push({ handle, el });
  return handle;
}

afterEach(async () => {
  await new Promise(r => setTimeout(r, 30));
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
});

const DOC = '# Title\n\nalpha beta\n\nbeta gamma **beta**\n';

describe('locateInSource', () => {
  it('reads the matched text and counts identical earlier occurrences', () => {
    const first = locateInSource(DOC, 3, 7, 4);
    expect(first).toMatchObject({ text: 'beta', occurrence: 0 });
    const second = locateInSource(DOC, 5, 1, 4);
    expect(second).toMatchObject({ text: 'beta', occurrence: 1 });
    const third = locateInSource(DOC, 5, 14, 4);
    expect(third).toMatchObject({ text: 'beta', occurrence: 2 });
  });

  it('clamps positions outside the document', () => {
    const t = locateInSource(DOC, 99, 99, 3);
    expect(t.text).toBe('');
    expect(t.fraction).toBe(1);
  });
});

describe('revealText', () => {
  it('selects the matching occurrence in rich text', () => {
    const handle = mount(DOC);
    handle.revealText(5, 1, 4);
    const { from, to } = handle.tiptap.state.selection;
    expect(handle.tiptap.state.doc.textBetween(from, to)).toBe('beta');
    // The second "beta" of the document (first one is on the alpha line).
    const before = handle.tiptap.state.doc.textBetween(0, from, '\n');
    expect(before).toContain('alpha beta');
  });

  it('selects the exact range in source mode', () => {
    const handle = mount(DOC);
    handle.setViewState({ sourceMode: true });
    handle.revealText(3, 7, 4);
    const view = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe('beta');
    expect(from).toBe(DOC.indexOf('beta'));
  });

  it('does not throw for text that is not rendered', () => {
    const handle = mount('---\ntitle: x\n---\n\nBody\n');
    expect(() => handle.revealText(2, 1, 5)).not.toThrow();
    expect(() => handle.revealText(1, 1)).not.toThrow();
  });
});

describe('Cmd+Shift+F in source mode', () => {
  function press(el: Element, init: KeyboardEventInit): KeyboardEvent {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(e);
    return e;
  }

  it('is left to a host that owns shortcuts, and still opens find otherwise', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const owned = createMikeDownEditor(host, { host: new NoopHost(), initialMarkdown: 'x', hostOwnsShortcuts: true });
    mounted.push({ handle: owned, el: host });
    owned.setViewState({ sourceMode: true });
    const cm = host.querySelector('.cm-content')!;
    expect(press(cm, { key: 'F', metaKey: true, shiftKey: true }).defaultPrevented).toBe(false);

    const plain = mount('x');
    plain.setViewState({ sourceMode: true });
    const cm2 = document.querySelectorAll('.cm-content')[1] ?? document.querySelector('.cm-content')!;
    expect(press(cm2, { key: 'F', metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
  });
});
