/**
 * The inline suggestion plugin (ai-ghost-plugin.ts) in a real editor: the
 * widget, the keys, undo, and the places a suggestion must not appear. Keys go
 * through real `KeyboardEvent`s on the editor DOM, because the plugin takes
 * them in `handleDOMEvents.keydown`. A real controller sits behind it; its
 * requests are answered by hand (ghost-test-utils.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { headingDomText } from '../src/outlineSidebar';
import { aiGhostKey } from '../src/ai-ghost-plugin';
import { caretAfterText, caretInTrailingBlock, ghostSpans, ghostText, pluginRig, press, typeKey, typeText, unmountAll } from './ghost-test-utils';

afterEach(() => {
  vi.useRealTimers();
  unmountAll();
});

const docText = (r: { view: { state: { doc: { textContent: string } } } }) => r.view.state.doc.textContent;

describe('the widget', () => {
  it('appears right after the caret when a transaction carries the text', () => {
    const r = pluginRig('Hello world');
    r.set(' again');
    expect(ghostSpans(r.view)).toHaveLength(1);
    const span = ghostSpans(r.view)[0];
    expect(span.textContent).toBe(' again');
    expect(span.getAttribute('aria-hidden')).toBe('true');
    expect(span.getAttribute('spellcheck')).toBe('false');
    // Inside the paragraph, after its text, and nothing follows it.
    expect(span.parentElement?.tagName).toBe('P');
    expect(span.previousSibling?.textContent).toBe('Hello world');
    expect(span.nextSibling?.textContent ?? '').toBe('');
    expect(aiGhostKey.getState(r.view.state)).toMatchObject({ text: ' again', pos: r.view.state.selection.head });
  });

  it('is not in the document, the markdown or the text while it shows', () => {
    const r = pluginRig('Hello world');
    r.set(' again');
    expect(ghostText(r.view)).toBe(' again');
    expect(r.handle.getMarkdown()).not.toContain('again');
    expect(r.handle.getMarkdown().trim()).toBe('Hello world');
    expect(r.editor.getText()).toBe('Hello world');
    expect(docText(r)).toBe('Hello world');
  });

  it('clears when null comes in, and does not redraw for the same text', () => {
    const r = pluginRig('Hello world');
    r.set(' again');
    const first = ghostSpans(r.view)[0];
    r.set(' again');
    expect(ghostSpans(r.view)[0]).toBe(first);
    r.set(null);
    expect(ghostSpans(r.view)).toHaveLength(0);
    expect(aiGhostKey.getState(r.view.state)?.text).toBeNull();
  });

  it('clears when the document changes', () => {
    const r = pluginRig('Hello world');
    r.set(' again');
    typeKey(r.view, '!');
    expect(ghostSpans(r.view)).toHaveLength(0);
    expect(docText(r)).toBe('Hello world!');
  });

  it('clears when the caret moves', () => {
    const r = pluginRig('Hello world');
    r.set(' again');
    r.editor.commands.setTextSelection(3);
    expect(ghostSpans(r.view)).toHaveLength(0);
  });

  it('is not shown for a selection that is not a caret', () => {
    const r = pluginRig('Hello world');
    r.editor.commands.setTextSelection({ from: 1, to: 4 });
    r.set(' again');
    expect(ghostSpans(r.view)).toHaveLength(0);
  });

  it('takes the marks the text will have on accept', () => {
    const r = pluginRig('A **bold**');
    r.set(' text');
    expect(ghostSpans(r.view)[0].closest('strong')).not.toBeNull();
  });
});

describe('Tab', () => {
  it('inserts the suggestion, and one undo removes exactly it', () => {
    const r = pluginRig('Hello world');
    r.show(' again and more');
    const event = press(r.view, 'Tab');
    expect(event.defaultPrevented).toBe(true);
    expect(docText(r)).toBe('Hello world again and more');
    expect(ghostSpans(r.view)).toHaveLength(0);
    r.editor.commands.undo();
    expect(docText(r)).toBe('Hello world');
    expect(r.handle.getMarkdown().trim()).toBe('Hello world');
  });

  it('puts the caret after the inserted text', () => {
    const r = pluginRig('Hello world');
    r.set(' again');
    press(r.view, 'Tab');
    expect(r.view.state.selection.empty).toBe(true);
    expect(r.view.state.selection.head).toBe(r.view.state.doc.content.size - 1);
  });

  it('keeps typing after Tab a separate undo step', () => {
    const r = pluginRig('Hello');
    r.show(' world');
    press(r.view, 'Tab');
    typeText(r.view, '!?');
    expect(docText(r)).toBe('Hello world!?');
    r.editor.commands.undo();
    expect(docText(r)).toBe('Hello world');
    r.editor.commands.undo();
    expect(docText(r)).toBe('Hello');
  });

  it('inserts only the first line of a suggestion with a single newline', () => {
    const r = pluginRig('Hello');
    r.show(' first line\nsecond line');
    expect(ghostText(r.view)).toBe(' first line');
    press(r.view, 'Tab');
    expect(docText(r)).toBe('Hello first line');
    expect(r.view.state.doc.childCount).toBe(1);
  });

  it('indents a list item when nothing is suggested', () => {
    const r = pluginRig('- one\n- two');
    const before = JSON.stringify(r.view.state.doc.toJSON());
    const event = press(r.view, 'Tab');
    expect(event.defaultPrevented).toBe(true);
    const list = r.view.state.doc.child(0);
    // "two" is now nested under "one".
    expect(list.childCount).toBe(1);
    expect(list.child(0).childCount).toBe(2);
    expect(JSON.stringify(r.view.state.doc.toJSON())).not.toBe(before);
  });

  it('inserts the suggestion in a list item instead of indenting it', () => {
    const r = pluginRig('- one\n- two');
    r.show(' more');
    press(r.view, 'Tab');
    const list = r.view.state.doc.child(0);
    expect(list.childCount).toBe(2);
    expect(list.child(1).textContent).toBe('two more');
  });
});

describe('Mod-ArrowRight', () => {
  it('inserts one word and leaves the rest showing', () => {
    const r = pluginRig('Hello');
    r.show(' brave new world');
    const event = press(r.view, 'ArrowRight', { ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(docText(r)).toBe('Hello brave ');
    expect(ghostText(r.view)).toBe('new world');
    press(r.view, 'ArrowRight', { metaKey: true });
    expect(docText(r)).toBe('Hello brave new ');
    expect(ghostText(r.view)).toBe('world');
  });

  it('is left alone with nothing showing', () => {
    const r = pluginRig('Hello');
    expect(press(r.view, 'ArrowRight', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(docText(r)).toBe('Hello');
  });
});

describe('Escape', () => {
  it('clears the suggestion and the request, and takes the key', () => {
    const r = pluginRig('Hello');
    r.show(' world');
    expect(ghostText(r.view)).toBe(' world');
    expect(press(r.view, 'Escape').defaultPrevented).toBe(true);
    expect(ghostSpans(r.view)).toHaveLength(0);
    expect(docText(r)).toBe('Hello');
    // Dismissed means gone: Tab now has nothing to insert.
    press(r.view, 'Tab');
    expect(docText(r)).toBe('Hello');
  });

  it('is left alone with nothing showing', () => {
    const r = pluginRig('Hello');
    expect(press(r.view, 'Escape').defaultPrevented).toBe(false);
  });
});

describe('typing while a suggestion shows', () => {
  it('a matching character keeps the rest', () => {
    const r = pluginRig('Hello');
    r.show(' world');
    const event = press(r.view, ' ');
    expect(event.defaultPrevented).toBe(true);
    expect(docText(r)).toBe('Hello ');
    expect(ghostText(r.view)).toBe('world');
    typeKey(r.view, 'w');
    expect(docText(r)).toBe('Hello w');
    expect(ghostText(r.view)).toBe('orld');
  });

  it('a different character clears it and types normally', () => {
    const r = pluginRig('Hello');
    r.show(' world');
    typeKey(r.view, '!');
    expect(docText(r)).toBe('Hello!');
    expect(ghostSpans(r.view)).toHaveLength(0);
  });

  it('typing the whole suggestion leaves nothing showing', () => {
    const r = pluginRig('Hello');
    r.show(' hi');
    typeText(r.view, ' hi');
    expect(docText(r)).toBe('Hello hi');
    expect(ghostSpans(r.view)).toHaveLength(0);
  });

  it('a modifier chord is not a typed character', () => {
    const r = pluginRig('Hello');
    r.show(' world');
    expect(press(r.view, ' ', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(docText(r)).toBe('Hello');
  });
});

describe('where a suggestion may appear', () => {
  it('is asked for in a paragraph, a heading, a list item and a quote', () => {
    for (const [markdown, where] of [
      ['Plain paragraph', 'Plain'], ['# A heading', 'heading'], ['- an item', 'item'], ['> a quote', 'quote'], ['- [ ] a task', 'task'],
    ] as const) {
      const r = pluginRig(markdown);
      caretAfterText(r.view, where);
      r.show(' more');
      expect(ghostText(r.view), markdown).toBe(' more');
      unmountAll();
    }
  });

  it('is not asked for in a table cell', () => {
    const r = pluginRig('| a | b |\n| --- | --- |\n| c | d |\n');
    caretAfterText(r.view, 'c');
    expect(r.view.state.selection.$head.parent.type.name).toMatch(/paragraph/);
    expect(() => r.show(' more')).toThrow(/sent nothing/);
    expect(r.calls).toHaveLength(0);
  });

  it('is not asked for in a code block', () => {
    const r = pluginRig('```js\nconst a = 1\n```\n');
    caretAfterText(r.view, 'const');
    expect(r.view.state.selection.$head.parent.type.name).toBe('codeBlock');
    expect(() => r.show(' more')).toThrow(/sent nothing/);
    expect(r.calls).toHaveLength(0);
  });

  it('is not asked for inside inline code', () => {
    const r = pluginRig('Run `npm test`');
    caretAfterText(r.view, 'npm');
    expect(() => r.show(' more')).toThrow(/sent nothing/);
  });

  it('is not asked for with text after the caret, but trailing spaces are fine', () => {
    const r = pluginRig('Hello world');
    r.editor.commands.setTextSelection(6);
    expect(() => r.show(' more')).toThrow(/sent nothing/);
  });

  it('is not asked for in an empty block unless asked by hand (the menu entry)', () => {
    const r = pluginRig('# Title');
    caretInTrailingBlock(r.view);
    expect(r.view.state.selection.$head.parent.content.size).toBe(0);
    r.show(' more'); // manual: allowed
    expect(ghostText(r.view)).toBe(' more');
  });

  it('is not asked for while a popup is open or when disabled', () => {
    let open = true;
    const r = pluginRig('Hello', {}, { popupOpen: () => open, enabled: () => true });
    expect(() => r.show(' more')).toThrow(/sent nothing/);
    open = false;
    r.show(' more');
    expect(ghostText(r.view)).toBe(' more');
    unmountAll();

    let on = false;
    const d = pluginRig('Hello', {}, { enabled: () => on });
    expect(() => d.show(' more')).toThrow(/sent nothing/);
    on = true;
    d.show(' more');
    expect(ghostText(d.view)).toBe(' more');
  });

  it('a popup that opens after a suggestion is up dismisses it and takes the key', () => {
    let open = false;
    const r = pluginRig('Hello', {}, { popupOpen: () => open });
    r.show(' world');
    open = true;
    expect(press(r.view, 'Tab').defaultPrevented).toBe(false);
    expect(ghostSpans(r.view)).toHaveLength(0);
    expect(docText(r)).toBe('Hello');
  });
});

describe('when requests start', () => {
  const idle = 400;

  function focused(markdown: string) {
    vi.useFakeTimers();
    const r = pluginRig(markdown);
    r.view.focus();
    return r;
  }

  it('a keystroke starts the idle timer and a request goes out after the delay', () => {
    const r = focused('Hello');
    expect(r.view.hasFocus()).toBe(true);
    typeKey(r.view, ' ');
    expect(r.calls).toHaveLength(0);
    vi.advanceTimersByTime(idle - 1);
    expect(r.calls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].req.feature).toBe('ghostText');
  });

  it('the request carries the text before the caret, with no widget text in it', () => {
    const r = focused('Hello');
    typeText(r.view, ' wor');
    vi.advanceTimersByTime(idle);
    const prompt = JSON.stringify(r.calls[0].req.messages);
    expect(prompt).toContain('Hello wor');
  });

  it('another keystroke restarts the timer and aborts a request in flight', () => {
    const r = focused('Hello');
    typeKey(r.view, ' ');
    vi.advanceTimersByTime(idle);
    expect(r.calls).toHaveLength(1);
    const first = r.calls[0];
    typeKey(r.view, 'x');
    expect(first.signal.aborted).toBe(true);
    vi.advanceTimersByTime(idle);
    expect(r.calls).toHaveLength(2);
  });

  it('an edit with no keystroke before it starts nothing', () => {
    const r = focused('Hello');
    // A host or a command, not typing: no keydown ahead of it.
    r.view.dispatch(r.view.state.tr.insertText(' there'));
    vi.advanceTimersByTime(5000);
    expect(r.calls).toHaveLength(0);
  });

  it('a late edit is not a keystroke even after an earlier key', () => {
    const r = focused('Hello');
    press(r.view, 'a');
    vi.advanceTimersByTime(1500);
    r.view.dispatch(r.view.state.tr.insertText(' there'));
    vi.advanceTimersByTime(5000);
    expect(r.calls).toHaveLength(0);
  });

  it('undo triggers no request', () => {
    const r = focused('Hello');
    typeKey(r.view, ' ');
    vi.advanceTimersByTime(idle);
    r.calls[0].reject(new Error('stop'));
    typeKey(r.view, 'x');
    r.editor.commands.undo();
    vi.advanceTimersByTime(5000);
    expect(r.calls).toHaveLength(1);
  });

  it('a document replaced by the host triggers no request', () => {
    const r = focused('Hello');
    r.handle.setMarkdown('Something else entirely');
    caretAfterText(r.view, 'entirely');
    vi.advanceTimersByTime(5000);
    expect(r.calls).toHaveLength(0);
  });

  it('a paste triggers no request', () => {
    const r = focused('Hello');
    press(r.view, 'v', { ctrlKey: true });
    r.view.dispatch(r.view.state.tr.insertText(' pasted').setMeta('paste', true));
    vi.advanceTimersByTime(5000);
    expect(r.calls).toHaveLength(0);
  });

  it('moving the caret cancels the timer and starts none', () => {
    const r = focused('Hello world');
    typeKey(r.view, '!');
    caretAfterText(r.view, 'Hello');
    r.editor.commands.setTextSelection(3);
    vi.advanceTimersByTime(5000);
    expect(r.calls).toHaveLength(0);
  });

  it('typing in a table cell or code block starts nothing', () => {
    const t = focused('| a | b |\n| --- | --- |\n| c | d |\n');
    caretAfterText(t.view, 'c');
    typeKey(t.view, 'x');
    vi.advanceTimersByTime(5000);
    expect(t.calls).toHaveLength(0);
    unmountAll();

    const c = focused('```\ncode\n```\n');
    caretAfterText(c.view, 'code');
    typeKey(c.view, 'x');
    vi.advanceTimersByTime(5000);
    expect(c.calls).toHaveLength(0);
  });

  it('blur dismisses a suggestion and aborts the request', () => {
    const r = focused('Hello');
    typeKey(r.view, ' ');
    vi.advanceTimersByTime(idle);
    r.calls[0].token('world');
    expect(ghostText(r.view)).toBe('world');
    r.view.dom.dispatchEvent(new FocusEvent('blur'));
    expect(ghostSpans(r.view)).toHaveLength(0);
    expect(r.calls[0].signal.aborted).toBe(true);
  });

  it('starting an IME composition dismisses a suggestion', () => {
    const r = focused('Hello');
    r.show(' world');
    r.view.dom.dispatchEvent(new CompositionEvent('compositionstart'));
    expect(ghostSpans(r.view)).toHaveLength(0);
  });
});

describe('what the document reads back', () => {
  it('a heading keeps its anchor text while a widget shows in it', () => {
    const r = pluginRig('# The Title\n\nBody');
    caretAfterText(r.view, 'The Title');
    r.set(' and more');
    const h = r.view.dom.querySelector<HTMLElement>('h1')!;
    expect(h.textContent).toContain('and more');
    expect(headingDomText(h)).toBe('The Title');
    // The live DOM is untouched by the read.
    expect(ghostSpans(r.view)).toHaveLength(1);
  });
});
