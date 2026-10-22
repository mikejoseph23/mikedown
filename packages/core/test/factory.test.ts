/**
 * createMikeDownEditor with the NoopHost, mounted in a bare <div>: content
 * round-trip, change notification, and clean teardown.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle, type MikeDownHost } from '../src/index';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const FIXTURES = join(__dirname, '..', '..', '..', 'test', 'fixtures');

const fixtureNames = [
  'sample.md',
  ...readdirSync(join(FIXTURES, 'edge-cases')).filter(f => f.endsWith('.md')).map(f => join('edge-cases', f)),
];

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

function mount(host: MikeDownHost = new NoopHost(), options: Record<string, unknown> = {}) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host, ...options });
  mounted.push({ handle, el });
  return { el, handle };
}

/**
 * The words of a document, ignoring markup the serializer may legitimately
 * normalize (emphasis markers, table padding, blank quote lines, an explicit
 * `plaintext` fence language, CRLF).
 */
const words = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).filter(w => w !== 'plaintext').join(' ');

afterEach(() => {
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  vi.restoreAllMocks();
});

describe('createMikeDownEditor with NoopHost', () => {
  it('mounts the editor chrome into a bare div', () => {
    const { el } = mount();
    expect(el.querySelector('.mikedown-toolbar')).not.toBeNull();
    expect(el.querySelector('.mikedown-editor-container .ProseMirror')).not.toBeNull();
  });

  describe.each(fixtureNames)('round-trips %s', (name) => {
    const source = readFileSync(join(FIXTURES, name), 'utf8');

    it('keeps the content through setMarkdown then getMarkdown', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { handle } = mount();
      handle.setMarkdown(source);
      const out = handle.getMarkdown();
      // Serialization may normalize markup, never content.
      expect(words(out)).toBe(words(source));
    });

    it('reaches a fixed point: loading the output yields the same output', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { handle } = mount();
      handle.setMarkdown(source);
      const once = handle.getMarkdown();
      handle.setMarkdown(once);
      expect(handle.getMarkdown()).toBe(once);
    });
  });

  it('does not call onChange for setMarkdown (a load is not an edit)', () => {
    const onChange = vi.fn();
    const { handle } = mount({ onChange });
    handle.setMarkdown('# Hello\n\nworld\n');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('calls onChange once per user edit with pristine: false', () => {
    const onChange = vi.fn();
    const { handle } = mount({ onChange });
    handle.setMarkdown('# Hello\n\nworld\n');
    const view = handle.tiptap.view;

    view.dispatch(view.state.tr.insertText('A', 1));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toContain('AHello');
    expect(onChange.mock.calls[0][1]).toEqual({ pristine: false });

    view.dispatch(view.state.tr.insertText('B', 1));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][1]).toEqual({ pristine: false });
  });

  it('reports pristine: true when undo returns to the loaded content', () => {
    const onChange = vi.fn();
    const { handle } = mount({ onChange });
    const original = '# Hello\n\nworld\n';
    handle.setMarkdown(original);
    const view = handle.tiptap.view;
    view.dispatch(view.state.tr.insertText('A', 1));
    handle.tiptap.commands.undo();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(last[0]).toBe(original);
    expect(last[1]).toEqual({ pristine: true });
  });

  describe('destroy()', () => {
    type Entry = { type: string; listener: unknown; capture: boolean };
    const key = (e: Entry) => `${e.type}|${e.capture}|${(e.listener as any)?.name ?? ''}`;

    function track(target: EventTarget) {
      const added: Entry[] = [];
      const removed: Entry[] = [];
      const capture = (o: unknown) => (typeof o === 'boolean' ? o : !!(o as AddEventListenerOptions | undefined)?.capture);
      const add = target.addEventListener.bind(target);
      const remove = target.removeEventListener.bind(target);
      vi.spyOn(target, 'addEventListener').mockImplementation((type: string, listener: any, options?: any) => {
        added.push({ type, listener, capture: capture(options) });
        add(type, listener, options);
      });
      vi.spyOn(target, 'removeEventListener').mockImplementation((type: string, listener: any, options?: any) => {
        removed.push({ type, listener, capture: capture(options) });
        remove(type, listener, options);
      });
      return { added, removed };
    }

    it('removes every window and document listener it added, and empties the container', () => {
      const win = track(window);
      const doc = track(document);

      const { el, handle } = mount(new NoopHost(), { features: { sidebar: true } });
      handle.setMarkdown('# Title\n\nSome *text* with a [link](https://example.com).\n');
      // Open and close a few overlays so lazily-added listeners are exercised.
      handle.command('openSettings' as any);
      handle.destroy();

      // Balance is checked per listener (type, function, capture) rather than by raw
      // counts: popups also remove listeners they never added through this spy.
      for (const [label, t] of [['window', win], ['document', doc]] as const) {
        expect(t.added.length, `${label} listeners were registered`).toBeGreaterThan(0);
        const outstanding = t.added.filter(a =>
          !t.removed.some(r => r.type === a.type && r.listener === a.listener && r.capture === a.capture));
        expect(outstanding.map(key), `${label} listeners left behind`).toEqual([]);
      }
      expect(el.childNodes.length).toBe(0);
    });

    it('leaves nothing of the editor behind in the document body', () => {
      const before = document.body.querySelectorAll('*').length;
      const { el, handle } = mount();
      handle.setMarkdown('# Title\n');
      handle.destroy();
      el.remove();
      expect(document.body.querySelectorAll('*').length).toBe(before);
    });

    it('stops notifying the host after destroy', () => {
      const onChange = vi.fn();
      const { handle } = mount({ onChange });
      handle.setMarkdown('hello\n');
      const view = handle.tiptap.view;
      handle.destroy();
      try { view.dispatch(view.state.tr.insertText('x', 1)); } catch { /* view is gone */ }
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
