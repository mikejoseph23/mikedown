/**
 * `getViewState` / `setViewState`: a host that shows several documents in one
 * editor (tabs) saves where the user was and puts them back there, in rich
 * text and in source mode.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

function mount(markdown = '# Hi\n\nOne two three.\n\nFour five six.\n') {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host: new NoopHost(), initialMarkdown: markdown });
  mounted.push({ handle, el });
  return { el, handle };
}

afterEach(async () => {
  await new Promise(r => setTimeout(r, 30));
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
});

describe('view state', () => {
  it('reports rich text by default with the caret and scroll offset', () => {
    const { handle } = mount();
    const state = handle.getViewState();
    expect(state.sourceMode).toBe(false);
    expect(state.cursor).toBeGreaterThanOrEqual(0);
    expect(state.scrollTop).toBe(0);
  });

  it('restores the caret in rich text, clamped to the document', () => {
    const { handle } = mount();
    handle.setViewState({ cursor: 8 });
    expect(handle.getViewState().cursor).toBe(8);
    handle.setViewState({ cursor: 999_999 });
    expect(handle.getViewState().cursor).toBeLessThanOrEqual(handle.tiptap.state.doc.content.size);
    expect(handle.getViewState().cursor).toBeGreaterThan(8);
  });

  it('switches to source mode and places the caret there as a character offset', () => {
    const { handle, el } = mount();
    handle.setViewState({ sourceMode: true, cursor: 7 });
    const state = handle.getViewState();
    expect(state.sourceMode).toBe(true);
    expect(state.cursor).toBe(7);
    expect(el.querySelector('.cm-editor')).not.toBeNull();
    // Clamped to the source length, and the markdown is unchanged by the trip.
    handle.setViewState({ cursor: 10_000 });
    expect(handle.getViewState().cursor).toBe(handle.getMarkdown().length);
    expect(handle.getMarkdown()).toBe('# Hi\n\nOne two three.\n\nFour five six.\n');
  });

  it('switches back to rich text when asked, leaving the markdown alone', () => {
    const { handle } = mount();
    handle.setViewState({ sourceMode: true });
    handle.setViewState({ sourceMode: false, cursor: 3 });
    expect(handle.getViewState()).toMatchObject({ sourceMode: false, cursor: 3 });
    // The rich view re-serialises (trailing newline aside), the text is intact.
    expect(handle.getMarkdown().trimEnd()).toBe('# Hi\n\nOne two three.\n\nFour five six.');
  });

  it('sets the scroller offset of the showing view', () => {
    const { handle, el } = mount();
    const scroller = el.querySelector<HTMLElement>('.mikedown-editor-container')!;
    Object.defineProperty(scroller, 'scrollHeight', { value: 5000, configurable: true });
    handle.setViewState({ scrollTop: 120 });
    expect(scroller.scrollTop).toBe(120);
    expect(handle.getViewState().scrollTop).toBe(120);
  });

  it('a partial state keeps the fields it does not mention', () => {
    const { handle } = mount();
    handle.setViewState({ cursor: 5 });
    handle.setViewState({});
    expect(handle.getViewState().cursor).toBe(5);
    expect(handle.getViewState().sourceMode).toBe(false);
  });
});

describe('lazy load in source mode', () => {
  it('setMarkdown in source mode fills CodeMirror only and rebuilds the rich view on the way back', () => {
    const { handle, el } = mount('# Old\n');
    handle.setViewState({ sourceMode: true });
    const pmBefore = handle.tiptap.state.doc;
    handle.setMarkdown('# New\n\nFresh text.\n', { pristine: true });
    // CodeMirror has the new text, the rich view was left alone (no parse).
    expect(handle.getMarkdown()).toBe('# New\n\nFresh text.\n');
    expect(handle.tiptap.state.doc).toBe(pmBefore);
    expect(el.querySelector('.cm-content')?.textContent).toContain('Fresh text.');
    // Back to rich text: the document is rebuilt from the source.
    handle.setViewState({ sourceMode: false });
    expect(handle.tiptap.state.doc.textContent).toContain('Fresh text.');
    expect(el.querySelector('.ProseMirror h1')?.textContent).toBe('New');
  });

  it('a lazily loaded, unedited document reports pristine after the switch back', () => {
    const changes: Array<{ md: string; pristine: boolean }> = [];
    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = createMikeDownEditor(el, {
      host: { onChange: (md, meta) => changes.push({ md, pristine: meta.pristine }) },
      initialMarkdown: '',
    });
    mounted.push({ handle, el });
    handle.setViewState({ sourceMode: true });
    handle.setMarkdown('# Doc\n\nBody.\n', { pristine: true });
    expect(changes).toEqual([]);
    handle.setViewState({ sourceMode: false });
    expect(changes).toEqual([]);
    // Type and undo: back to the saved text, reported with the exact original.
    handle.tiptap.commands.insertContentAt(handle.tiptap.state.doc.content.size - 1, ' More');
    expect(changes.at(-1)?.pristine).toBe(false);
    handle.command('undo');
    expect(changes.at(-1)).toEqual({ md: '# Doc\n\nBody.\n', pristine: true });
  });

  it('source edits made before the switch back are kept and reported dirty', () => {
    const changes: Array<{ md: string; pristine: boolean }> = [];
    const el = document.createElement('div');
    document.body.appendChild(el);
    const handle = createMikeDownEditor(el, {
      host: { onChange: (md, meta) => changes.push({ md, pristine: meta.pristine }) },
      initialMarkdown: '',
    });
    mounted.push({ handle, el });
    handle.setViewState({ sourceMode: true });
    handle.setMarkdown('# Doc\n', { pristine: true });
    // Edit through CodeMirror's view, found from its DOM.
    const view = EditorView.findFromDOM(el.querySelector<HTMLElement>('.cm-editor')!);
    expect(view).toBeTruthy();
    view!.dispatch({ changes: { from: view!.state.doc.length, insert: 'Edited in source.\n' } });
    expect(changes.at(-1)).toEqual({ md: '# Doc\nEdited in source.\n', pristine: false });
    handle.setViewState({ sourceMode: false });
    expect(handle.tiptap.state.doc.textContent).toContain('Edited in source.');
    expect(handle.getMarkdown()).toContain('Edited in source.');
  });
});
