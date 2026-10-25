/**
 * <mikedown-editor>: the MikeDown editor as a form-associated custom element.
 *
 * Light DOM on purpose: core's menus and dialogs mount in a `.mikedown-portal`
 * on <body>, its stylesheet is scoped to `.mikedown-root` / `.mikedown-portal`
 * in the document, and ProseMirror's selection handling is unreliable inside a
 * shadow root. Value glue (debounce, blur flush, pristine loads, theme `auto`)
 * comes from core's `bindMikeDownValue`.
 */

import { bindMikeDownValue } from '@mikedown/core';
import type {
  BindingTheme,
  MikeDownBinding,
  MikeDownEditorHandle,
  MikeDownFeatures,
  MikeDownHost,
  MikeDownSettings,
} from '@mikedown/core';
import { ensureDisplayStyle, runConnectHook } from './hooks';

/** Detail of the `change` event. */
export interface MikeDownChangeEventDetail {
  value: string;
}

/** Detail of the `ready` event. */
export interface MikeDownReadyEventDetail {
  handle: MikeDownEditorHandle;
}

export type MikeDownElementTheme = BindingTheme;

/** Host methods the element accepts. `onChange` runs before the element's own handling. */
export type MikeDownElementHost = Partial<MikeDownHost>;

const OBSERVED = [
  'value',
  'theme',
  'readonly',
  'disabled',
  'placeholder',
  'name',
  'required',
  'min-height',
  'dark-selector',
  'spellcheck-dictionary-url',
  'features',
  'debounce',
  'aria-label',
  'aria-labelledby',
] as const;

/** Attributes read only when the editor is created: a change rebuilds it (the value is kept). */
const REBUILD_ON = new Set(['placeholder', 'spellcheck-dictionary-url', 'features', 'dark-selector', 'debounce', 'aria-label', 'aria-labelledby']);

/** Properties a framework may set before the element is upgraded. */
const UPGRADE_PROPS = [
  'value',
  'defaultValue',
  'theme',
  'readOnly',
  'disabled',
  'placeholder',
  'name',
  'required',
  'minHeight',
  'darkSelector',
  'spellcheckDictionaryUrl',
  'features',
  'settings',
  'host',
] as const;

const VALUE_MISSING_MESSAGE = 'Please fill out this field.';

/** SSR-safe base: importing the module on a server must not throw. */
const Base = (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;

/** Drop one leading newline and the common indentation of a server-rendered <script> body. */
export function dedentScriptText(text: string): string {
  const lines = text.replace(/^\r?\n/, '').replace(/\s+$/, '').split(/\r?\n/);
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(cut)).join('\n') + (lines.length && lines.some((l) => l.trim()) ? '\n' : '');
}

function parseTheme(value: string | null): BindingTheme {
  return value === 'light' || value === 'dark' ? value : 'auto';
}

export class MikeDownElement extends Base {
  static formAssociated = true;

  static get observedAttributes(): string[] {
    return [...OBSERVED];
  }

  readonly #internals: ElementInternals | null;
  #binding: MikeDownBinding | null = null;
  /** Current value: the last text the editor reported, or the last one set. */
  #value = '';
  /** Reset target: the `value` attribute, else the child source's text at first connect. */
  #defaultValue = '';
  #valueSetByProperty = false;
  #initialized = false;
  #featuresAttrCache: { raw: string | null; parsed: Partial<MikeDownFeatures> | null } = { raw: null, parsed: null };
  #settings: Partial<MikeDownSettings> = {};
  #host: MikeDownElementHost = {};
  #ai: MikeDownAiHost | undefined;
  #formDisabled = false;
  #rebuildQueued = false;
  #fallbackInput: HTMLInputElement | null = null;
  #fallbackForm: HTMLFormElement | null = null;

  constructor() {
    super();
    let internals: ElementInternals | null = null;
    try {
      internals = typeof this.attachInternals === 'function' ? this.attachInternals() : null;
    } catch {
      internals = null;
    }
    this.#internals = internals;

    // A click whose target is the element itself comes from a <label for> (or
    // the element's own padding): move focus into the editor.
    this.addEventListener('click', (event) => {
      if (event.target !== this) {return;}
      const active = this.ownerDocument.activeElement;
      if (active && this.contains(active)) {return;}
      this.focus();
    });

    // Native `change` events from inputs inside the editor (find bar, dialogs)
    // would bubble out looking like the element's own. Registered first, so it
    // runs before any listener a page adds to the element.
    this.addEventListener('change', (event) => {
      if (event.target !== this) {event.stopImmediatePropagation();}
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connectedCallback(): void {
    if (!this.#initialized) {
      this.#initialized = true;
      for (const prop of UPGRADE_PROPS) {this.#upgradeProperty(prop);}
      this.#readInitialValue();
    }
    ensureDisplayStyle(this.ownerDocument, this.localName);
    this.#applyMinHeight();
    this.#attachFallbackForm();
    runConnectHook(this as unknown as HTMLElement & { features: Record<string, unknown> });
    this.#create();
  }

  disconnectedCallback(): void {
    this.#destroy();
    this.#detachFallbackForm();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) {return;}
    switch (name) {
      case 'value':
        this.#defaultValue = newValue ?? '';
        if (this.#initialized) {this.#setValue(newValue ?? '');}
        break;
      case 'theme':
        this.#binding?.setTheme(parseTheme(newValue));
        break;
      case 'readonly':
        this.#binding?.setReadOnly(newValue !== null);
        break;
      case 'disabled':
        this.#applyDisabled();
        break;
      case 'required':
        this.#syncValidity();
        break;
      case 'name':
        if (this.#fallbackInput) {this.#fallbackInput.name = newValue ?? '';}
        break;
      case 'min-height':
        this.#applyMinHeight();
        break;
      default:
        if (REBUILD_ON.has(name)) {this.#scheduleRebuild();}
    }
  }

  // ── Form-associated callbacks ─────────────────────────────────────────────

  formResetCallback(): void {
    this.#setValue(this.#defaultValue);
    this.#valueSetByProperty = false;
  }

  formDisabledCallback(disabled: boolean): void {
    this.#formDisabled = disabled;
    this.#applyDisabled();
  }

  formStateRestoreCallback(state: unknown): void {
    if (typeof state === 'string') {this.#setValue(state);}
  }

  // ── Value ─────────────────────────────────────────────────────────────────

  /** The markdown. Setting it loads the text as the pristine baseline and fires no `change`. */
  get value(): string {
    return this.#value;
  }
  set value(markdown: string) {
    this.#valueSetByProperty = true;
    this.#setValue(markdown == null ? '' : String(markdown));
  }

  /** The `value` attribute: the initial value and the target of a form reset. */
  get defaultValue(): string {
    return this.getAttribute('value') ?? this.#defaultValue;
  }
  set defaultValue(markdown: string) {
    this.setAttribute('value', markdown == null ? '' : String(markdown));
  }

  // ── Reflected attributes ──────────────────────────────────────────────────

  get theme(): BindingTheme {
    return parseTheme(this.getAttribute('theme'));
  }
  set theme(theme: BindingTheme) {
    this.setAttribute('theme', parseTheme(theme));
  }

  get readOnly(): boolean {
    return this.hasAttribute('readonly');
  }
  set readOnly(on: boolean) {
    this.toggleAttribute('readonly', !!on);
  }

  get disabled(): boolean {
    return this.hasAttribute('disabled');
  }
  set disabled(on: boolean) {
    this.toggleAttribute('disabled', !!on);
  }

  get required(): boolean {
    return this.hasAttribute('required');
  }
  set required(on: boolean) {
    this.toggleAttribute('required', !!on);
  }

  get placeholder(): string {
    return this.getAttribute('placeholder') ?? '';
  }
  set placeholder(text: string) {
    this.#setOrRemove('placeholder', text);
  }

  get name(): string {
    return this.getAttribute('name') ?? '';
  }
  set name(name: string) {
    this.#setOrRemove('name', name);
  }

  /** CSS length for the editor's minimum height (`--mikedown-min-height`). Default 240px. */
  get minHeight(): string {
    return this.getAttribute('min-height') ?? '';
  }
  set minHeight(value: string) {
    this.#setOrRemove('min-height', value);
  }

  /** With `theme="auto"`: dark when `element.closest(selector)` matches, else light. */
  get darkSelector(): string {
    return this.getAttribute('dark-selector') ?? '';
  }
  set darkSelector(selector: string) {
    this.#setOrRemove('dark-selector', selector);
  }

  /** Folder base of the spell-check dictionaries (core appends `/en/` or `/en-GB/`). */
  get spellcheckDictionaryUrl(): string {
    return this.getAttribute('spellcheck-dictionary-url') ?? '';
  }
  set spellcheckDictionaryUrl(url: string) {
    this.#setOrRemove('spellcheck-dictionary-url', url);
  }

  /** Milliseconds of quiet before `change` fires. Default 150. */
  get debounce(): number {
    const n = Number(this.getAttribute('debounce'));
    return this.hasAttribute('debounce') && Number.isFinite(n) && n >= 0 ? n : 150;
  }
  set debounce(ms: number) {
    this.setAttribute('debounce', String(ms));
  }

  /** Feature switches. The `features` attribute takes the same object as JSON. Changing them rebuilds the editor. */
  get features(): Partial<MikeDownFeatures> {
    const raw = this.getAttribute('features');
    if (raw !== this.#featuresAttrCache.raw) {
      let parsed: Partial<MikeDownFeatures> | null = null;
      if (raw) {
        try {
          const json: unknown = JSON.parse(raw);
          if (json && typeof json === 'object' && !Array.isArray(json)) {parsed = json as Partial<MikeDownFeatures>;}
          else {console.warn('<mikedown-editor>: the features attribute must be a JSON object.');}
        } catch {
          console.warn('<mikedown-editor>: the features attribute is not valid JSON.');
        }
      }
      this.#featuresAttrCache = { raw, parsed };
    }
    return { ...(this.#featuresAttrCache.parsed ?? {}) };
  }
  set features(features: Partial<MikeDownFeatures> | null) {
    // Reflected as JSON (every flag is a boolean); the attribute change schedules the rebuild.
    if (features) {this.setAttribute('features', JSON.stringify(features));}
    else {this.removeAttribute('features');}
  }

  // ── Properties only ───────────────────────────────────────────────────────

  /** Core settings (fonts, content width, ...). Applied live through `handle.updateSettings`. */
  get settings(): Partial<MikeDownSettings> {
    return { ...this.#settings };
  }
  set settings(settings: Partial<MikeDownSettings> | null) {
    this.#settings = { ...(settings ?? {}) };
    this.#binding?.handle.updateSettings(this.#settings);
  }

  /**
   * Host methods (`uploadImage`, `openLink`, `resolveImageSrc`, ...). Core turns a
   * feature on only when its method is present, so a change rebuilds the editor.
   */
  get host(): MikeDownElementHost {
    return this.#host;
  }
  set host(host: MikeDownElementHost | null) {
    this.#host = host ?? {};
    this.#scheduleRebuild();
  }

  /**
   * The AI host group (`complete`, and for tier 2 `listEngines`, `testEngine`, ...). A property only: it holds
   * functions, so there is no attribute. Wins over `host.ai`. Core turns the AI features on when it is present,
   * so a change rebuilds the editor. Core ships no provider SDK; the page supplies the transport.
   */
  get ai(): MikeDownAiHost | undefined {
    return this.#ai ?? this.#host.ai;
  }
  set ai(ai: MikeDownAiHost | null | undefined) {
    this.#ai = ai ?? undefined;
    this.#scheduleRebuild();
  }

  /** The editor handle while connected, else null. */
  get handle(): MikeDownEditorHandle | null {
    return this.#binding?.handle ?? null;
  }

  // ── Form and validity ─────────────────────────────────────────────────────

  get form(): HTMLFormElement | null {
    return this.#internals && 'form' in this.#internals ? this.#internals.form : this.closest('form');
  }

  get labels(): NodeList | HTMLLabelElement[] {
    return this.#internals?.labels ?? [];
  }

  get type(): string {
    return this.localName;
  }

  get validity(): ValidityState {
    if (this.#hasFormInternals()) {return this.#internals!.validity;}
    const valueMissing = this.#valueMissing();
    return { valueMissing, valid: !valueMissing } as ValidityState;
  }

  get validationMessage(): string {
    if (this.#hasFormInternals()) {return this.#internals!.validationMessage;}
    return this.#valueMissing() ? VALUE_MISSING_MESSAGE : '';
  }

  get willValidate(): boolean {
    if (this.#hasFormInternals()) {return this.#internals!.willValidate;}
    return !this.#isDisabled() && !this.readOnly;
  }

  checkValidity(): boolean {
    if (this.#hasFormInternals()) {return this.#internals!.checkValidity();}
    if (!this.willValidate || !this.#valueMissing()) {return true;}
    this.dispatchEvent(new Event('invalid', { cancelable: true }));
    return false;
  }

  reportValidity(): boolean {
    if (this.#hasFormInternals()) {return this.#internals!.reportValidity();}
    const ok = this.checkValidity();
    if (!ok) {this.focus();}
    return ok;
  }

  /** Focus the editable surface. */
  override focus(options?: FocusOptions): void {
    if (this.#binding) {this.#binding.focus();}
    else {super.focus(options);}
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  #upgradeProperty(prop: (typeof UPGRADE_PROPS)[number]): void {
    if (Object.prototype.hasOwnProperty.call(this, prop)) {
      const value = (this as Record<string, unknown>)[prop];
      delete (this as Record<string, unknown>)[prop];
      (this as Record<string, unknown>)[prop] = value;
    }
  }

  /** `value` attribute, else a child <textarea> or <script type="text/markdown">, which is then hidden. */
  #readInitialValue(): void {
    const source = this.querySelector<HTMLTextAreaElement | HTMLScriptElement>(
      ':scope > textarea, :scope > script[type="text/markdown"]',
    );
    let sourceText: string | null = null;
    if (source && source.localName === 'textarea') {
      const textarea = source as HTMLTextAreaElement;
      sourceText = textarea.value;
      // Server-rendered pages put name/required/placeholder on the textarea.
      if (!this.hasAttribute('name') && textarea.name) {this.setAttribute('name', textarea.name);}
      if (!this.hasAttribute('required') && textarea.required) {this.setAttribute('required', '');}
      if (!this.hasAttribute('placeholder') && textarea.placeholder) {this.setAttribute('placeholder', textarea.placeholder);}
      // Hidden and disabled, so it neither shows nor submits a second value.
      textarea.hidden = true;
      textarea.style.display = 'none';
      textarea.disabled = true;
      textarea.setAttribute('aria-hidden', 'true');
    } else if (source) {
      sourceText = dedentScriptText(source.textContent ?? '');
    }

    const attr = this.getAttribute('value');
    this.#defaultValue = attr ?? sourceText ?? '';
    if (!this.#valueSetByProperty) {this.#value = this.#defaultValue;}
  }

  #create(): void {
    if (this.#binding || !this.isConnected) {return;}
    const { ariaLabel, ariaLabelledBy } = this.#accessibleName();
    const userHost = this.#host;
    const ai = this.#ai ?? userHost.ai;
    const binding = bindMikeDownValue(this, {
      initialValue: this.#value,
      debounceMs: this.debounce,
      theme: this.theme,
      darkSelector: this.darkSelector || undefined,
      readOnly: this.readOnly,
      disabled: this.#isDisabled(),
      placeholder: this.getAttribute('placeholder') ?? undefined,
      spellcheckDictionaryUrl: this.spellcheckDictionaryUrl || undefined,
      features: this.features,
      settings: this.#settings,
      ariaLabel,
      ariaLabelledBy,
      host: {
        ...userHost,
        ...(ai ? { ai } : {}),
        // Every keystroke keeps `value`, the form value and validity current;
        // the debounced `change` event comes from onValue below.
        onChange: (markdown: string, meta: { pristine: boolean }) => {
          userHost.onChange?.(markdown, meta);
          this.#value = markdown;
          this.#syncForm();
        },
      },
      onValue: (markdown: string) => {
        this.#value = markdown;
        this.#syncForm();
        this.dispatchEvent(
          new CustomEvent<MikeDownChangeEventDetail>('change', { detail: { value: markdown }, bubbles: true, composed: true }),
        );
      },
    });
    this.#binding = binding;
    this.#syncForm();
    // A microtask later, so a listener added right after appendChild (or
    // after the define script ran on parsed markup) still hears it.
    queueMicrotask(() => {
      if (this.#binding !== binding) {return;}
      this.dispatchEvent(
        new CustomEvent<MikeDownReadyEventDetail>('ready', { detail: { handle: binding.handle }, bubbles: true, composed: true }),
      );
    });
  }

  #destroy(): void {
    const binding = this.#binding;
    if (!binding) {return;}
    // destroy() flushes a pending change first (onValue keeps #value current).
    binding.destroy();
    this.#binding = null;
  }

  #scheduleRebuild(): void {
    if (!this.#binding || this.#rebuildQueued) {return;}
    this.#rebuildQueued = true;
    queueMicrotask(() => {
      this.#rebuildQueued = false;
      if (!this.#binding || !this.isConnected) {return;}
      const hadFocus = this.contains(this.ownerDocument.activeElement);
      this.#destroy();
      this.#create();
      if (hadFocus) {this.#binding?.focus();}
    });
  }

  #setValue(markdown: string): void {
    this.#value = markdown;
    this.#binding?.setValue(markdown);
    this.#syncForm();
  }

  #accessibleName(): { ariaLabel?: string; ariaLabelledBy?: string } {
    // ARIA precedence: aria-labelledby, then aria-label, then <label> elements.
    const labelledBy = this.getAttribute('aria-labelledby');
    if (labelledBy) {return { ariaLabelledBy: labelledBy };}
    const label = this.getAttribute('aria-label');
    if (label) {return { ariaLabel: label };}
    const labels = Array.from((this.#internals?.labels ?? []) as ArrayLike<HTMLElement>);
    if (!labels.length) {return {};}
    const ids = labels.map((el, i) => {
      if (!el.id) {el.id = `${this.id || 'mikedown-editor'}-label${labels.length > 1 ? `-${i + 1}` : ''}`;}
      return el.id;
    });
    return { ariaLabelledBy: ids.join(' ') };
  }

  #isDisabled(): boolean {
    return this.hasAttribute('disabled') || this.#formDisabled;
  }

  #applyDisabled(): void {
    this.#binding?.setDisabled(this.#isDisabled());
    if (this.#fallbackInput) {this.#fallbackInput.disabled = this.#isDisabled();}
    this.#syncValidity();
  }

  #applyMinHeight(): void {
    const value = this.getAttribute('min-height');
    if (value) {this.style.setProperty('--mikedown-min-height', /^\d+(\.\d+)?$/.test(value) ? `${value}px` : value);}
    else {this.style.removeProperty('--mikedown-min-height');}
  }

  #setOrRemove(attr: string, value: string | null | undefined): void {
    if (value == null || value === '') {this.removeAttribute(attr);}
    else {this.setAttribute(attr, String(value));}
  }

  #hasFormInternals(): boolean {
    return !!this.#internals && typeof this.#internals.setFormValue === 'function';
  }

  #valueMissing(): boolean {
    return this.required && !this.#isDisabled() && this.#value.trim() === '';
  }

  #syncForm(): void {
    if (this.#hasFormInternals()) {
      this.#internals!.setFormValue(this.#value, this.#value);
    } else if (this.#fallbackInput) {
      this.#fallbackInput.value = this.#value;
    }
    this.#syncValidity();
  }

  #syncValidity(): void {
    if (!this.#hasFormInternals() || typeof this.#internals!.setValidity !== 'function') {return;}
    if (this.#valueMissing()) {
      const anchor = this.querySelector<HTMLElement>('.ProseMirror') ?? undefined;
      this.#internals!.setValidity({ valueMissing: true }, VALUE_MISSING_MESSAGE, anchor);
    } else {
      this.#internals!.setValidity({});
    }
  }

  /**
   * Without ElementInternals form support (jsdom, very old browsers) a hidden
   * <input> carries the value, and the form's reset event resets it.
   */
  #attachFallbackForm(): void {
    if (this.#hasFormInternals()) {return;}
    if (!this.#fallbackInput) {
      const input = this.ownerDocument.createElement('input');
      input.type = 'hidden';
      input.setAttribute('data-mikedown-form-value', '');
      this.#fallbackInput = input;
    }
    this.#fallbackInput.name = this.name;
    this.#fallbackInput.disabled = this.#isDisabled();
    this.#fallbackInput.value = this.#value;
    if (this.#fallbackInput.parentNode !== this) {this.appendChild(this.#fallbackInput);}
    const form = this.closest('form');
    if (form !== this.#fallbackForm) {
      this.#fallbackForm?.removeEventListener('reset', this.#onFallbackReset);
      form?.addEventListener('reset', this.#onFallbackReset);
      this.#fallbackForm = form;
    }
  }

  #detachFallbackForm(): void {
    this.#fallbackForm?.removeEventListener('reset', this.#onFallbackReset);
    this.#fallbackForm = null;
  }

  #onFallbackReset = (): void => {
    this.formResetCallback();
  };
}
