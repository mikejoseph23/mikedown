/**
 * bindMikeDownValue: the glue every framework wrapper repeats.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindMikeDownValue, selectorAttributes, type MikeDownBinding } from '../src/binding';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

let binding: MikeDownBinding | null = null;
let el: HTMLElement;

function mount(opts: Parameters<typeof bindMikeDownValue>[1] = {}, parent: HTMLElement = document.body): MikeDownBinding {
  el = document.createElement('div');
  parent.appendChild(el);
  binding = bindMikeDownValue(el, opts);
  return binding;
}

function type(b: MikeDownBinding, text: string): void {
  b.handle.tiptap.commands.focus('end');
  b.handle.tiptap.commands.insertContent(text);
}

function themeOf(): string | null {
  return el.querySelector('.mikedown-root')?.getAttribute('data-mikedown-theme') ?? null;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  binding?.destroy();
  binding = null;
  el?.remove();
  document.documentElement.removeAttribute('data-mode');
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('debounce and flush', () => {
  it('reports once after the debounce, with the latest text', () => {
    const onValue = vi.fn();
    const b = mount({ initialValue: 'Hello\n', debounceMs: 150, onValue });
    type(b, 'A');
    type(b, 'B');
    expect(onValue).not.toHaveBeenCalled();
    vi.advanceTimersByTime(149);
    expect(onValue).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onValue).toHaveBeenCalledTimes(1);
    expect(onValue.mock.calls[0][0]).toContain('AB');
  });

  it('flush() reports at once and only once', () => {
    const onValue = vi.fn();
    const b = mount({ initialValue: 'Hello\n', onValue });
    type(b, 'X');
    b.flush();
    expect(onValue).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(onValue).toHaveBeenCalledTimes(1);
    b.flush();
    expect(onValue).toHaveBeenCalledTimes(1);
  });

  it('reports at once on blur', () => {
    const onValue = vi.fn();
    const b = mount({ initialValue: 'Hello\n', onValue });
    type(b, 'Y');
    expect(onValue).not.toHaveBeenCalled();
    // The editor's blur event comes from TipTap; emit it the way TipTap does.
    b.handle.tiptap.emit('blur', { editor: b.handle.tiptap, event: new FocusEvent('blur'), transaction: b.handle.tiptap.state.tr });
    expect(onValue).toHaveBeenCalledTimes(1);
    expect(onValue.mock.calls[0][0]).toContain('Y');
  });

  it('debounceMs 0 reports every change at once', () => {
    const onValue = vi.fn();
    const b = mount({ initialValue: 'Hello\n', debounceMs: 0, onValue });
    type(b, 'Z');
    expect(onValue).toHaveBeenCalledTimes(1);
  });

  it('applies outputTransform to reported values', () => {
    const onValue = vi.fn();
    const b = mount({ initialValue: 'Hello\n', debounceMs: 0, onValue, outputTransform: (m) => m.toUpperCase() });
    type(b, 'q');
    expect(onValue.mock.calls[0][0]).toBe(onValue.mock.calls[0][0].toUpperCase());
    expect(onValue.mock.calls[0][0]).toContain('Q');
  });
});

describe('external writes', () => {
  it('loads the value pristine, without reporting it back', () => {
    const onValue = vi.fn();
    const b = mount({ initialValue: 'One\n', onValue });
    b.setValue('Two\n');
    vi.advanceTimersByTime(1000);
    expect(b.handle.getMarkdown()).toBe('Two\n');
    expect(onValue).not.toHaveBeenCalled();
  });

  it('skips a value equal to the current one', () => {
    const b = mount({ initialValue: 'Same\n' });
    const spy = vi.spyOn(b.handle, 'setMarkdown');
    b.setValue('Same\n');
    expect(spy).not.toHaveBeenCalled();
    b.setValue('Different\n');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('Different\n', { pristine: true });
  });

  it('skips the echo of a value it just reported', () => {
    const onValue = vi.fn();
    const b = mount({ initialValue: 'Hello\n', debounceMs: 0, onValue });
    type(b, '!');
    const reported = onValue.mock.calls[0][0] as string;
    const spy = vi.spyOn(b.handle, 'setMarkdown');
    b.setValue(reported);
    expect(spy).not.toHaveBeenCalled();
  });

  it('drops a pending keystroke report when an outside write arrives', () => {
    const onValue = vi.fn();
    const b = mount({ initialValue: 'Hello\n', onValue });
    type(b, 'X');
    b.setValue('Fresh\n');
    vi.advanceTimersByTime(1000);
    expect(onValue).not.toHaveBeenCalled();
    expect(b.handle.getMarkdown()).toBe('Fresh\n');
  });
});

describe('theme', () => {
  it('follows the dark selector as the page changes', async () => {
    document.documentElement.setAttribute('data-mode', 'light');
    mount({ theme: 'auto', darkSelector: 'html[data-mode=dark]' });
    expect(themeOf()).toBe('light');
    document.documentElement.setAttribute('data-mode', 'dark');
    await Promise.resolve();
    expect(themeOf()).toBe('dark');
    document.documentElement.setAttribute('data-mode', 'light');
    await Promise.resolve();
    expect(themeOf()).toBe('light');
  });

  it('matches an ancestor class with closest()', async () => {
    const host = document.createElement('section');
    document.body.appendChild(host);
    mount({ theme: 'auto', darkSelector: '.dark-theme' }, host);
    expect(themeOf()).toBe('light');
    host.classList.add('dark-theme');
    await Promise.resolve();
    expect(themeOf()).toBe('dark');
  });

  it('follows prefers-color-scheme without a selector', () => {
    let dark = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() { return query.includes('dark') && dark; },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }));
    mount({ theme: 'auto' });
    expect(themeOf()).toBe('light');
    dark = true;
    listeners.forEach((fn) => fn());
    expect(themeOf()).toBe('dark');
  });

  it('explicit themes ignore the page, and setTheme switches modes', async () => {
    document.documentElement.setAttribute('data-mode', 'dark');
    const b = mount({ theme: 'light', darkSelector: 'html[data-mode=dark]' });
    expect(themeOf()).toBe('light');
    b.setTheme('auto');
    expect(themeOf()).toBe('dark');
    b.setTheme('light');
    document.documentElement.setAttribute('data-mode', 'light');
    document.documentElement.setAttribute('data-mode', 'dark');
    await Promise.resolve();
    expect(themeOf()).toBe('light');
  });

  it('destroy removes the observer and the media listener', () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const b = mount({ theme: 'auto', darkSelector: '.dark-theme' });
    b.destroy();
    expect(disconnect).toHaveBeenCalled();
    binding = null;

    const removed = vi.fn();
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener: removed }));
    const b2 = mount({ theme: 'auto' });
    b2.destroy();
    binding = null;
    expect(removed).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('derives the attribute filter from the selector', () => {
    expect(selectorAttributes('.dark-theme')).toEqual(['class']);
    expect(selectorAttributes('html[data-mode=dark]')).toEqual(['data-mode']);
    expect(selectorAttributes('.a, [data-x]')?.sort()).toEqual(['class', 'data-x']);
    expect(selectorAttributes('html')).toBeUndefined();
  });
});

describe('accessibility', () => {
  it('applies id and ariaLabel to the editable surface, with no main landmark', () => {
    const b = mount({ id: 'notes', ariaLabel: 'Meeting notes' });
    const box = el.querySelector('.ProseMirror') as HTMLElement;
    expect(box.id).toBe('notes');
    expect(box.getAttribute('aria-label')).toBe('Meeting notes');
    expect(box.getAttribute('role')).toBe('textbox');
    expect(el.querySelector('[role="main"]')).toBeNull();
    b.focus();
  });

  it('uses label[for=id] as the name and focuses the editor on click', () => {
    const label = document.createElement('label');
    label.htmlFor = 'bio';
    label.textContent = 'Bio';
    document.body.appendChild(label);
    const b = mount({ id: 'bio' });
    const box = el.querySelector('.ProseMirror') as HTMLElement;
    expect(label.id).toBeTruthy();
    expect(box.getAttribute('aria-labelledby')).toBe(label.id);
    const focus = vi.spyOn(b.handle, 'focus');
    label.click();
    expect(focus).toHaveBeenCalled();
    b.destroy();
    binding = null;
    focus.mockClear();
    label.click();
    expect(focus).not.toHaveBeenCalled();
  });

  it('shows a custom placeholder', () => {
    mount({ placeholder: 'Say something' });
    const p = el.querySelector('.ProseMirror p');
    expect(p?.getAttribute('data-placeholder')).toBe('Say something');
  });
});
