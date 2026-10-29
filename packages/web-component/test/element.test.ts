/**
 * <mikedown-editor>: attributes and properties, events, form value and reset,
 * validity, progressive enhancement from a child <textarea>, and lifecycle.
 *
 * jsdom has `attachInternals` (labels, ARIA) but no `setFormValue` or
 * `setValidity`, so by default the element runs its hidden-input fallback and
 * a real FormData sees the value. The "ElementInternals" block swaps in a fake
 * internals object to cover the browser path.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';
import type { MikeDownAiHost as MikeDownAi } from '@mikedown/core';
import { MikeDownElement, defineMikeDownElement, dedentScriptText } from '../src/index';

stubLayoutMeasurement();

beforeAll(() => {
  defineMikeDownElement();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function html(markup: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = markup;
  document.body.appendChild(host);
  return host;
}

function editor(attrs = ''): MikeDownElement {
  return html(`<mikedown-editor ${attrs}></mikedown-editor>`).querySelector('mikedown-editor') as MikeDownElement;
}

function type(el: MikeDownElement, text: string): void {
  el.handle!.tiptap.commands.focus('end');
  el.handle!.tiptap.commands.insertContent(text);
}

const surface = (el: MikeDownElement) => el.querySelector('.ProseMirror') as HTMLElement;
const flushMicrotasks = () => Promise.resolve();

describe('definition', () => {
  it('registers <mikedown-editor> once; a repeat call returns the same constructor', () => {
    expect(customElements.get('mikedown-editor')).toBe(MikeDownElement);
    expect(defineMikeDownElement()).toBe(MikeDownElement);
  });

  it('a second tag gets its own subclass', () => {
    const ctor = defineMikeDownElement('md-field');
    expect(ctor).not.toBe(MikeDownElement);
    expect(new ctor()).toBeInstanceOf(MikeDownElement);
    expect(defineMikeDownElement('md-field')).toBe(ctor);
  });

  it('is form-associated', () => {
    expect(MikeDownElement.formAssociated).toBe(true);
  });
});

describe('attributes and properties', () => {
  it('reflects string and boolean attributes both ways', () => {
    const el = editor();
    el.theme = 'dark';
    el.readOnly = true;
    el.required = true;
    el.placeholder = 'Write here';
    el.name = 'body';
    el.minHeight = '300px';
    el.darkSelector = '.dark';
    el.spellcheckDictionaryUrl = 'https://cdn.example/dictionaries';
    expect(el.getAttribute('theme')).toBe('dark');
    expect(el.hasAttribute('readonly')).toBe(true);
    expect(el.hasAttribute('required')).toBe(true);
    expect(el.getAttribute('placeholder')).toBe('Write here');
    expect(el.getAttribute('name')).toBe('body');
    expect(el.getAttribute('min-height')).toBe('300px');
    expect(el.getAttribute('dark-selector')).toBe('.dark');
    expect(el.getAttribute('spellcheck-dictionary-url')).toBe('https://cdn.example/dictionaries');

    el.setAttribute('theme', 'light');
    el.removeAttribute('readonly');
    el.toggleAttribute('disabled', true);
    expect(el.theme).toBe('light');
    expect(el.readOnly).toBe(false);
    expect(el.disabled).toBe(true);
    el.placeholder = '';
    expect(el.hasAttribute('placeholder')).toBe(false);
  });

  it('theme defaults to auto and ignores unknown values', () => {
    const el = editor('theme="sepia"');
    expect(el.theme).toBe('auto');
  });

  it('theme and readonly apply to the live editor', () => {
    const el = editor('theme="dark"');
    const root = el.querySelector('.mikedown-root')!;
    expect(root.getAttribute('data-mikedown-theme')).toBe('dark');
    el.theme = 'light';
    expect(root.getAttribute('data-mikedown-theme')).toBe('light');
    expect(el.handle!.tiptap.isEditable).toBe(true);
    el.readOnly = true;
    expect(el.handle!.tiptap.isEditable).toBe(false);
    el.readOnly = false;
    el.disabled = true;
    expect(el.handle!.tiptap.isEditable).toBe(false);
  });

  it('dark-selector follows an ancestor for theme auto', () => {
    const wrap = html('<section class="shell"><mikedown-editor dark-selector=".shell.dark"></mikedown-editor></section>');
    const el = wrap.querySelector('mikedown-editor') as MikeDownElement;
    const root = el.querySelector('.mikedown-root')!;
    expect(root.getAttribute('data-mikedown-theme')).toBe('light');
    wrap.querySelector('.shell')!.classList.add('dark');
    return flushMicrotasks().then(() => {
      expect(root.getAttribute('data-mikedown-theme')).toBe('dark');
    });
  });

  it('min-height sets --mikedown-min-height; a bare number means pixels', () => {
    const el = editor('min-height="320"');
    expect(el.style.getPropertyValue('--mikedown-min-height')).toBe('320px');
    el.minHeight = '12rem';
    expect(el.style.getPropertyValue('--mikedown-min-height')).toBe('12rem');
    el.minHeight = '';
    expect(el.style.getPropertyValue('--mikedown-min-height')).toBe('');
  });

  it('features: JSON attribute and object property, reflected; a change rebuilds and keeps the value', async () => {
    const el = editor(`value="Keep me" features='{"toolbar":false}'`);
    expect(el.features).toEqual({ toolbar: false });
    expect(el.querySelector('.mikedown-toolbar')).toBeNull();
    const first = el.handle;
    el.features = { toolbar: true, math: false };
    expect(JSON.parse(el.getAttribute('features')!)).toEqual({ toolbar: true, math: false });
    await flushMicrotasks();
    expect(el.handle).not.toBe(first);
    expect(el.querySelector('.mikedown-toolbar')).not.toBeNull();
    expect(el.querySelectorAll('.mikedown-root')).toHaveLength(1);
    expect(el.handle!.getMarkdown()).toContain('Keep me');
  });

  it('invalid features JSON warns and falls back to defaults', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = editor(`features="{nope"`);
    expect(el.features).toEqual({});
    expect(warn).toHaveBeenCalled();
    expect(el.querySelector('.mikedown-toolbar')).not.toBeNull();
  });

  it('settings apply live through handle.updateSettings', () => {
    const el = editor();
    const spy = vi.spyOn(el.handle!, 'updateSettings');
    el.settings = { fontSize: 18 };
    expect(spy).toHaveBeenCalledWith({ fontSize: 18 });
    expect(el.settings).toEqual({ fontSize: 18 });
  });

  it('settings and host set before connecting are used at creation', () => {
    const el = document.createElement('mikedown-editor') as MikeDownElement;
    const onChange = vi.fn();
    el.settings = { contentWidth: '640px' };
    el.host = { onChange };
    el.value = 'Start\n';
    document.body.appendChild(el);
    type(el, '!');
    expect(onChange).toHaveBeenCalled();
    expect(el.querySelector<HTMLElement>('.mikedown-root')!.style.getPropertyValue('--mikedown-content-width')).toBe('640px');
  });

  it('a new host rebuilds the editor and its methods are used', async () => {
    const el = editor();
    const first = el.handle;
    const onChange = vi.fn();
    el.host = { onChange };
    await flushMicrotasks();
    expect(el.handle).not.toBe(first);
    type(el, 'x');
    expect(onChange).toHaveBeenCalled();
  });

  it('accepts ai as a property, before connecting and later (which rebuilds), and also through host.ai', async () => {
    const ai = { complete: vi.fn() } as unknown as MikeDownAi;
    const before = document.createElement('mikedown-editor') as MikeDownElement;
    before.ai = ai;
    document.body.appendChild(before);
    expect(before.ai).toBe(ai);
    expect(before.getAttribute('ai')).toBeNull();
    before.handle!.command('openAiSettings');
    // The first editor with AI loads core's AI UI chunk; the modal opens once it is there.
    await vi.waitFor(() => expect(document.querySelector('.settings-panel--ai')).not.toBeNull());
    document.getElementById('mikedown-settings-overlay')?.remove();

    const later = editor();
    later.handle!.command('openAiSettings');
    expect(document.querySelector('.settings-panel--ai')).toBeNull();
    const first = later.handle;
    later.ai = ai;
    await flushMicrotasks();
    expect(later.handle).not.toBe(first);
    later.handle!.command('openAiSettings');
    expect(document.querySelector('.settings-panel--ai')).not.toBeNull();
    document.getElementById('mikedown-settings-overlay')?.remove();

    const viaHost = editor();
    viaHost.host = { ai };
    await flushMicrotasks();
    expect(viaHost.ai).toBe(ai);
    viaHost.handle!.command('openAiSettings');
    expect(document.querySelector('.settings-panel--ai')).not.toBeNull();
  });

  it('handle is read-only and null while disconnected', () => {
    const el = document.createElement('mikedown-editor') as MikeDownElement;
    expect(el.handle).toBeNull();
    expect(() => {
      (el as unknown as { handle: unknown }).handle = {};
    }).toThrow();
    document.body.appendChild(el);
    expect(el.handle).not.toBeNull();
  });

  it('properties set before the element was defined are not shadowed', () => {
    const el = document.createElement('md-late');
    (el as unknown as { value: string }).value = 'Early\n';
    (el as unknown as { theme: string }).theme = 'dark';
    document.body.appendChild(el);
    defineMikeDownElement('md-late');
    const up = el as MikeDownElement;
    expect(up.handle).not.toBeNull();
    expect(up.value).toBe('Early\n');
    expect(up.getAttribute('theme')).toBe('dark');
  });
});

describe('value', () => {
  it('starts from the value attribute', () => {
    const el = editor('value="# Title"');
    expect(el.value).toBe('# Title');
    expect(el.handle!.getMarkdown()).toContain('# Title');
  });

  it('setting the property loads the text without a change event', () => {
    const el = editor('value="One"');
    const onChange = vi.fn();
    el.addEventListener('change', onChange);
    el.value = 'Two\n';
    vi.advanceTimersByTime(1000);
    expect(el.value).toBe('Two\n');
    expect(el.handle!.getMarkdown()).toBe('Two\n');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a later value attribute replaces the content and becomes the reset value', () => {
    const el = editor('value="One"');
    el.setAttribute('value', 'Three\n');
    expect(el.value).toBe('Three\n');
    expect(el.defaultValue).toBe('Three\n');
  });

  it('value tracks keystrokes before the debounce fires', () => {
    const el = editor('value="Hi"');
    type(el, '!');
    expect(el.value).toContain('!');
  });
});

describe('events', () => {
  it('change fires debounced with detail.value, bubbling and composed', () => {
    const el = editor('value="Hello"');
    const seen: CustomEvent[] = [];
    document.addEventListener('change', (e) => seen.push(e as CustomEvent));
    type(el, 'A');
    type(el, 'B');
    expect(seen).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(seen).toHaveLength(1);
    expect(seen[0].bubbles).toBe(true);
    expect(seen[0].composed).toBe(true);
    expect(seen[0].target).toBe(el);
    expect(seen[0].detail.value).toContain('AB');
    expect(seen[0].detail.value).toBe(el.value);
  });

  it('the debounce attribute sets the quiet time', () => {
    const el = editor('value="Hello" debounce="0"');
    const onChange = vi.fn();
    el.addEventListener('change', onChange);
    type(el, 'Z');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('change fires at once on blur', () => {
    const el = editor('value="Hello"');
    const onChange = vi.fn();
    el.addEventListener('change', onChange);
    type(el, 'Y');
    const tiptap = el.handle!.tiptap;
    tiptap.emit('blur', { editor: tiptap, event: new FocusEvent('blur'), transaction: tiptap.state.tr });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('native change events from inputs inside the editor do not escape', () => {
    const el = editor();
    const outer = vi.fn();
    const own = vi.fn();
    document.addEventListener('change', outer);
    el.addEventListener('change', own);
    const input = document.createElement('input');
    el.querySelector('.mikedown-root')!.appendChild(input);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(outer).not.toHaveBeenCalled();
    expect(own).not.toHaveBeenCalled();
  });

  it('ready fires a microtask after connecting, with the handle, bubbling and composed', async () => {
    const el = document.createElement('mikedown-editor') as MikeDownElement;
    document.body.appendChild(el);
    const onReady = vi.fn();
    el.addEventListener('ready', onReady);
    await flushMicrotasks();
    expect(onReady).toHaveBeenCalledTimes(1);
    const event = onReady.mock.calls[0][0] as CustomEvent;
    expect(event.detail.handle).toBe(el.handle);
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });
});

describe('progressive enhancement', () => {
  it('reads a child <textarea>, hides and disables it, and adopts its name, required and placeholder', () => {
    const host = html(
      '<form><mikedown-editor><textarea name="body" required placeholder="Say something"># From the server\n\nText.</textarea></mikedown-editor></form>',
    );
    const el = host.querySelector('mikedown-editor') as MikeDownElement;
    const textarea = host.querySelector('textarea')!;
    expect(el.value).toBe('# From the server\n\nText.');
    expect(el.handle!.getMarkdown()).toContain('From the server');
    expect(textarea.hidden).toBe(true);
    expect(textarea.disabled).toBe(true);
    expect(el.name).toBe('body');
    expect(el.required).toBe(true);
    expect(el.placeholder).toBe('Say something');
    // Only the element's value is submitted, once.
    expect(new FormData(host.querySelector('form')!).getAll('body')).toEqual(['# From the server\n\nText.']);
  });

  it('reads a child <script type="text/markdown"> and strips its template indentation', () => {
    const host = html(`<mikedown-editor><script type="text/markdown">
      # Title

      - one
        - nested
    </script></mikedown-editor>`);
    const el = host.querySelector('mikedown-editor') as MikeDownElement;
    expect(el.value).toBe('# Title\n\n- one\n  - nested\n');
  });

  it('the value attribute wins over a child textarea', () => {
    const el = html('<mikedown-editor value="Attr"><textarea>Child</textarea></mikedown-editor>').querySelector(
      'mikedown-editor',
    ) as MikeDownElement;
    expect(el.value).toBe('Attr');
  });

  it('dedentScriptText keeps relative indentation', () => {
    expect(dedentScriptText('\n    a\n      b\n    ')).toBe('a\n  b\n');
    expect(dedentScriptText('')).toBe('');
  });
});

describe('form participation (hidden-input fallback, as in jsdom)', () => {
  function formWith(attrs: string): { form: HTMLFormElement; el: MikeDownElement } {
    const host = html(`<form><mikedown-editor ${attrs}></mikedown-editor><button>Save</button></form>`);
    return { form: host.querySelector('form')!, el: host.querySelector('mikedown-editor') as MikeDownElement };
  }

  it('submits the current value under its name', () => {
    const { form, el } = formWith('name="notes" value="Hello"');
    expect(new FormData(form).get('notes')).toBe('Hello');
    type(el, ' world');
    expect(new FormData(form).get('notes')).toContain('world');
    el.value = 'Set\n';
    expect(new FormData(form).get('notes')).toBe('Set\n');
  });

  it('a submit event sees the value in FormData', () => {
    const { form, el } = formWith('name="notes" value="Body"');
    let submitted: string | null = null;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submitted = new FormData(form).get('notes') as string;
    });
    type(el, '!');
    form.requestSubmit();
    expect(submitted).toContain('Body');
    expect(submitted).toContain('!');
  });

  it('a disabled element is left out of the submission', () => {
    const { form, el } = formWith('name="notes" value="Hello"');
    el.disabled = true;
    expect(new FormData(form).has('notes')).toBe(false);
    el.disabled = false;
    expect(new FormData(form).get('notes')).toBe('Hello');
  });

  it('form.reset() restores the initial value', () => {
    const { form, el } = formWith('name="notes" value="Original"');
    type(el, ' edited');
    vi.advanceTimersByTime(200);
    expect(el.value).toContain('edited');
    form.reset();
    expect(el.value).toBe('Original');
    expect(el.handle!.getMarkdown()).not.toContain('edited');
    expect(new FormData(form).get('notes')).toBe('Original');
  });

  it('required with an empty value is invalid; text makes it valid', () => {
    const { el } = formWith('name="notes" required');
    const onInvalid = vi.fn();
    el.addEventListener('invalid', onInvalid);
    expect(el.validity.valueMissing).toBe(true);
    expect(el.validationMessage).not.toBe('');
    expect(el.checkValidity()).toBe(false);
    expect(onInvalid).toHaveBeenCalledTimes(1);
    type(el, 'text');
    expect(el.validity.valueMissing).toBe(false);
    expect(el.validity.valid).toBe(true);
    expect(el.checkValidity()).toBe(true);
  });

  it('form returns the owning form', () => {
    const { form, el } = formWith('');
    expect(el.form).toBe(form);
  });
});

describe('ElementInternals (browser path)', () => {
  interface FakeInternals {
    setFormValue: ReturnType<typeof vi.fn>;
    setValidity: ReturnType<typeof vi.fn>;
    validity: { valueMissing: boolean; valid: boolean };
    validationMessage: string;
    willValidate: boolean;
    form: HTMLFormElement | null;
    labels: HTMLLabelElement[];
    checkValidity: () => boolean;
    reportValidity: () => boolean;
  }
  let fake: FakeInternals;

  beforeEach(() => {
    fake = {
      setFormValue: vi.fn(),
      setValidity: vi.fn((flags: { valueMissing?: boolean }, message?: string) => {
        fake.validity = { valueMissing: !!flags.valueMissing, valid: !flags.valueMissing };
        fake.validationMessage = message ?? '';
      }),
      validity: { valueMissing: false, valid: true },
      validationMessage: '',
      willValidate: true,
      form: null,
      labels: [],
      checkValidity: () => fake.validity.valid,
      reportValidity: () => fake.validity.valid,
    };
    vi.spyOn(HTMLElement.prototype, 'attachInternals').mockImplementation(() => fake as unknown as ElementInternals);
  });

  it('sets the form value on load and on every change, with no hidden input', () => {
    const el = editor('name="notes" value="Hi"');
    expect(el.querySelector('input[data-mikedown-form-value]')).toBeNull();
    expect(fake.setFormValue).toHaveBeenLastCalledWith('Hi', 'Hi');
    type(el, '!');
    expect(fake.setFormValue.mock.calls.at(-1)![0]).toContain('!');
  });

  it('required: valueMissing anchored on the editable surface, cleared by text', () => {
    const el = editor('required');
    const call = fake.setValidity.mock.calls.at(-1)!;
    expect(call[0]).toEqual({ valueMissing: true });
    expect(call[2]).toBe(surface(el));
    expect(el.validity.valueMissing).toBe(true);
    expect(el.checkValidity()).toBe(false);
    type(el, 'x');
    expect(fake.setValidity).toHaveBeenLastCalledWith({});
    expect(el.checkValidity()).toBe(true);
  });

  it('formResetCallback returns to the initial value', () => {
    const el = editor('value="Start"');
    type(el, ' more');
    el.formResetCallback();
    expect(el.value).toBe('Start');
    expect(fake.setFormValue).toHaveBeenLastCalledWith('Start', 'Start');
  });

  it('formDisabledCallback (a disabled fieldset) makes the editor read-only', () => {
    const el = editor();
    el.formDisabledCallback(true);
    expect(el.handle!.tiptap.isEditable).toBe(false);
    el.formDisabledCallback(false);
    expect(el.handle!.tiptap.isEditable).toBe(true);
  });

  it('formStateRestoreCallback restores the saved value', () => {
    const el = editor('value="Old"');
    el.formStateRestoreCallback('Restored\n');
    expect(el.value).toBe('Restored\n');
    expect(el.handle!.getMarkdown()).toBe('Restored\n');
  });
});

describe('labels and focus', () => {
  it('a <label for> names the editable surface', () => {
    const host = html('<label for="notes">Notes</label><mikedown-editor id="notes"></mikedown-editor>');
    const label = host.querySelector('label')!;
    const el = host.querySelector('mikedown-editor') as MikeDownElement;
    expect(label.id).toBe('notes-label');
    expect(surface(el).getAttribute('aria-labelledby')).toBe('notes-label');
    // The element keeps its id; the surface gets none of its own.
    expect(el.id).toBe('notes');
    expect(document.querySelectorAll('#notes')).toHaveLength(1);
  });

  it('aria-label and aria-labelledby are forwarded to the surface', async () => {
    const el = editor('aria-label="Body text"');
    expect(surface(el).getAttribute('aria-label')).toBe('Body text');
    el.setAttribute('aria-labelledby', 'heading-1');
    await flushMicrotasks();
    expect(surface(el).getAttribute('aria-labelledby')).toBe('heading-1');
  });

  it('the surface is not a page landmark', () => {
    const el = editor();
    expect(el.querySelector('[role="main"]')).toBeNull();
  });

  it('a click on the element itself (a label click) focuses the editor', () => {
    const host = html('<label for="n2">Notes</label><mikedown-editor id="n2"></mikedown-editor>');
    const el = host.querySelector('mikedown-editor') as MikeDownElement;
    const focus = vi.spyOn(el.handle!, 'focus');
    host.querySelector('label')!.click();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(focus).toHaveBeenCalled();
    focus.mockClear();
    surface(el).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(focus).not.toHaveBeenCalled();
  });

  it('focus() focuses the editor', () => {
    const el = editor();
    const focus = vi.spyOn(el.handle!, 'focus');
    el.focus();
    expect(focus).toHaveBeenCalled();
  });
});

describe('lifecycle', () => {
  it('removing the element destroys the editor', () => {
    const el = editor('value="Bye"');
    expect(el.querySelector('.mikedown-root')).not.toBeNull();
    el.remove();
    expect(el.handle).toBeNull();
    expect(el.querySelector('.mikedown-root')).toBeNull();
  });

  it('moving the element keeps the value, including keystrokes still in the debounce', () => {
    const host = html('<div id="a"><mikedown-editor value="Moving"></mikedown-editor></div><div id="b"></div>');
    const el = host.querySelector('mikedown-editor') as MikeDownElement;
    const first = el.handle;
    const onChange = vi.fn();
    el.addEventListener('change', onChange);
    type(el, ' along');
    host.querySelector('#b')!.appendChild(el);
    expect(el.handle).not.toBeNull();
    expect(el.handle).not.toBe(first);
    expect(el.querySelectorAll('.mikedown-root')).toHaveLength(1);
    expect(el.value).toContain('along');
    expect(el.handle!.getMarkdown()).toContain('Moving along');
    // The pending edit was reported once, on the way out.
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('reconnecting does not re-read a child textarea', () => {
    const host = html('<mikedown-editor><textarea>Server</textarea></mikedown-editor><div id="b"></div>');
    const el = host.querySelector('mikedown-editor') as MikeDownElement;
    el.value = 'Changed\n';
    host.querySelector('#b')!.appendChild(el);
    expect(el.value).toBe('Changed\n');
  });

  it('a rebuild scheduled before removal does nothing', async () => {
    const el = editor();
    el.placeholder = 'Later';
    el.remove();
    await flushMicrotasks();
    expect(el.handle).toBeNull();
    expect(el.querySelector('.mikedown-root')).toBeNull();
  });
});
