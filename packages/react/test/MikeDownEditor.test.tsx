import { StrictMode, createRef, useState } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MikeDownAiHost, MikeDownEditorHandle } from '@mikedown/core';
import { MikeDownEditor } from '../src';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout; ProseMirror asks for rects when scrolling the caret into view.
beforeEach(() => {
  vi.useFakeTimers();
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Element.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const rootOf = (c: HTMLElement) => c.querySelector('.mikedown-root') as HTMLElement | null;
const themeOf = (c: HTMLElement) => rootOf(c)?.getAttribute('data-mikedown-theme');
const editable = (c: HTMLElement) => c.querySelector('[contenteditable]') as HTMLElement | null;

// The ref is a forwarding proxy; spy on the real handle that onReady receives.
let realHandle: MikeDownEditorHandle | null = null;
const onReady = (h: MikeDownEditorHandle) => {
  realHandle = h;
};
const real = () => realHandle!;

function type(handle: MikeDownEditorHandle, text: string): void {
  act(() => {
    handle.tiptap.commands.focus('end');
    handle.tiptap.commands.insertContent(text);
  });
}

describe('mounting', () => {
  it('renders a wrapper with className and style and creates one editor', () => {
    const { container } = render(<MikeDownEditor defaultValue="Hello" className="box" style={{ height: 200 }} />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toBe('box');
    expect(wrapper.style.height).toBe('200px');
    expect(container.querySelectorAll('.mikedown-root')).toHaveLength(1);
    expect(container.textContent).toContain('Hello');
  });

  it('forwards id, aria-label and aria-labelledby to the editable surface', () => {
    const { container } = render(<MikeDownEditor id="notes" aria-label="Meeting notes" aria-labelledby="lbl" />);
    const el = editable(container)!;
    expect(el.id).toBe('notes');
    expect(el.getAttribute('aria-labelledby')).toBe('lbl');
  });

  it('uses aria-label when no labelledby is given', () => {
    const { container } = render(<MikeDownEditor aria-label="Meeting notes" />);
    expect(editable(container)!.getAttribute('aria-label')).toBe('Meeting notes');
  });

  it('calls onReady with a working handle', () => {
    const onReady = vi.fn();
    render(<MikeDownEditor defaultValue="# Hi" onReady={onReady} />);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0][0].getMarkdown()).toContain('# Hi');
  });
});

describe('uncontrolled', () => {
  it('loads defaultValue and reports typed changes after the debounce', () => {
    const onChange = vi.fn();
    const ref = createRef<MikeDownEditorHandle>();
    render(<MikeDownEditor ref={ref} defaultValue="Hello" onChange={onChange} />);
    type(ref.current!, ' world');
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toContain('world');
  });

  it('ignores later defaultValue changes', () => {
    const { container, rerender } = render(<MikeDownEditor defaultValue="First" />);
    rerender(<MikeDownEditor defaultValue="Second" />);
    expect(container.textContent).toContain('First');
    expect(container.textContent).not.toContain('Second');
  });
});

describe('controlled', () => {
  function Harness({ onSeen }: { onSeen: (v: string) => void }) {
    const [md, setMd] = useState('Start');
    return (
      <>
        <MikeDownEditor
          value={md}
          onChange={(v) => {
            onSeen(v);
            setMd(v);
          }}
        />
        <button onClick={() => setMd('From outside')}>set</button>
      </>
    );
  }

  it('loads an external value change', () => {
    const { container, getByText } = render(<Harness onSeen={() => undefined} />);
    expect(container.textContent).toContain('Start');
    act(() => {
      getByText('set').click();
    });
    expect(container.textContent).toContain('From outside');
  });

  it('echoing its own change back does not reload the document', () => {
    const ref = createRef<MikeDownEditorHandle>();
    const seen = vi.fn();
    function Echo() {
      const [md, setMd] = useState('Start');
      return (
        <MikeDownEditor
          ref={ref}
          onReady={onReady}
          value={md}
          onChange={(v) => {
            seen(v);
            setMd(v);
          }}
        />
      );
    }
    render(<Echo />);
    const setMarkdown = vi.spyOn(real(), 'setMarkdown');
    type(ref.current!, ' more');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(setMarkdown).not.toHaveBeenCalled();
  });

  it('a parent re-render with the same value never resets the document', () => {
    const ref = createRef<MikeDownEditorHandle>();
    const { rerender } = render(<MikeDownEditor ref={ref} value="Same" onReady={onReady} />);
    const setMarkdown = vi.spyOn(real(), 'setMarkdown');
    type(ref.current!, ' typed');
    rerender(<MikeDownEditor ref={ref} value="Same" onReady={onReady} className="x" />);
    rerender(<MikeDownEditor ref={ref} value="Same" onChange={() => undefined} />);
    expect(setMarkdown).not.toHaveBeenCalled();
    expect(ref.current!.getMarkdown()).toContain('typed');
  });

  it('a new onChange identity does not recreate the editor, and the latest one is called', () => {
    const ref = createRef<MikeDownEditorHandle>();
    const first = vi.fn();
    const second = vi.fn();
    const { container, rerender } = render(<MikeDownEditor ref={ref} defaultValue="A" onChange={first} />);
    const root = rootOf(container);
    rerender(<MikeDownEditor ref={ref} defaultValue="A" onChange={second} />);
    expect(rootOf(container)).toBe(root);
    type(ref.current!, 'B');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('host methods read through a ref: a new host object does not recreate the editor', () => {
    const calls: string[] = [];
    const hostA = { onStats: () => calls.push('a') };
    const hostB = { onStats: () => calls.push('b') };
    const { container, rerender } = render(<MikeDownEditor defaultValue="A" host={hostA} />);
    const root = rootOf(container);
    rerender(<MikeDownEditor defaultValue="A" host={hostB} />);
    expect(rootOf(container)).toBe(root);
  });
});

describe('host.ai', () => {
  it('is handed to the core untouched, next to the function host methods', () => {
    const ai = { complete: vi.fn() } as unknown as MikeDownAiHost;
    const ref = createRef<MikeDownEditorHandle>();
    render(<MikeDownEditor ref={ref} defaultValue="A" host={{ ai, onStats: () => undefined }} />);
    act(() => ref.current!.command('openAiSettings'));
    expect(document.querySelector('.settings-panel--ai')).not.toBeNull();
    document.getElementById('mikedown-settings-overlay')?.remove();
  });

  it('is absent when the host has none', () => {
    const ref = createRef<MikeDownEditorHandle>();
    render(<MikeDownEditor ref={ref} defaultValue="A" host={{ onStats: () => undefined }} />);
    act(() => ref.current!.command('openAiSettings'));
    expect(document.querySelector('.settings-panel--ai')).toBeNull();
  });
});

describe('ref handle', () => {
  it('exposes the editor handle', () => {
    const ref = createRef<MikeDownEditorHandle>();
    render(<MikeDownEditor ref={ref} defaultValue="Hello" />);
    expect(ref.current!.getMarkdown()).toContain('Hello');
    act(() => ref.current!.setMarkdown('Replaced'));
    expect(ref.current!.getMarkdown()).toContain('Replaced');
    expect(ref.current!.tiptap).toBeTruthy();
  });

  it('is inert after unmount instead of throwing', () => {
    const ref = createRef<MikeDownEditorHandle>();
    const { unmount } = render(<MikeDownEditor ref={ref} defaultValue="Hello" />);
    const handle = ref.current!;
    unmount();
    expect(() => handle.focus()).not.toThrow();
    expect(handle.getMarkdown()).toBe('');
  });
});

describe('StrictMode', () => {
  it('leaves exactly one live editor after the double mount', () => {
    const { container } = render(
      <StrictMode>
        <MikeDownEditor defaultValue="Hello" />
      </StrictMode>,
    );
    expect(container.querySelectorAll('.mikedown-root')).toHaveLength(1);
    expect(container.textContent).toContain('Hello');
  });

  it('keeps the value, ref and callbacks working', () => {
    const onChange = vi.fn();
    const ref = createRef<MikeDownEditorHandle>();
    render(
      <StrictMode>
        <MikeDownEditor ref={ref} value="Hello" onChange={onChange} />
      </StrictMode>,
    );
    type(ref.current!, '!');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toContain('Hello!');
  });

  it('onReady runs for each mount and the last handle is live', () => {
    const handles: MikeDownEditorHandle[] = [];
    render(
      <StrictMode>
        <MikeDownEditor defaultValue="x" onReady={(h) => handles.push(h)} />
      </StrictMode>,
    );
    expect(handles.length).toBe(2);
    expect(handles[handles.length - 1].getMarkdown()).toContain('x');
  });
});

describe('prop updates', () => {
  it('theme changes are applied without recreating the editor', () => {
    const { container, rerender } = render(<MikeDownEditor theme="light" />);
    const root = rootOf(container);
    expect(themeOf(container)).toBe('light');
    rerender(<MikeDownEditor theme="dark" />);
    expect(rootOf(container)).toBe(root);
    expect(themeOf(container)).toBe('dark');
  });

  it('readOnly toggles editability', () => {
    const { container, rerender } = render(<MikeDownEditor readOnly defaultValue="Hi" />);
    expect(editable(container)?.getAttribute('contenteditable')).not.toBe('true');
    rerender(<MikeDownEditor readOnly={false} defaultValue="Hi" />);
    expect(editable(container)?.getAttribute('contenteditable')).toBe('true');
  });

  it('disabled makes the editor read-only even when readOnly is false', () => {
    const { container, rerender } = render(<MikeDownEditor defaultValue="Hi" />);
    expect(editable(container)?.getAttribute('contenteditable')).toBe('true');
    rerender(<MikeDownEditor defaultValue="Hi" disabled />);
    expect(editable(container)?.getAttribute('contenteditable')).not.toBe('true');
  });

  it('settings changes by content call updateSettings once', () => {
    const ref = createRef<MikeDownEditorHandle>();
    const { rerender } = render(<MikeDownEditor ref={ref} onReady={onReady} settings={{ fontSize: 14 }} />);
    const spy = vi.spyOn(real(), 'updateSettings');
    rerender(<MikeDownEditor ref={ref} onReady={onReady} settings={{ fontSize: 14 }} />);
    expect(spy).not.toHaveBeenCalled();
    rerender(<MikeDownEditor ref={ref} settings={{ fontSize: 18 }} />);
    expect(spy).toHaveBeenCalledWith({ fontSize: 18 });
  });
});

describe('unmount', () => {
  it('removes the editor DOM and flushes a pending change', () => {
    const onChange = vi.fn();
    const ref = createRef<MikeDownEditorHandle>();
    const { container, unmount } = render(<MikeDownEditor ref={ref} defaultValue="A" onChange={onChange} />);
    type(ref.current!, 'B');
    expect(onChange).not.toHaveBeenCalled();
    unmount();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.mikedown-root')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('removes window and document listeners it added', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<MikeDownEditor defaultValue="A" />);
    unmount();
    const added = add.mock.calls.map((c) => c[0] as string);
    const removed = remove.mock.calls.map((c) => c[0] as string);
    for (const type of new Set(added)) {expect(removed).toContain(type);}
  });
});
