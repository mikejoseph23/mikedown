/**
 * Value binding for framework wrappers. Every wrapper (React, Vue, Angular,
 * the web component) needs the same glue around the editor: a debounced change
 * callback that reports at once on blur, external writes that load pristine and
 * skip when nothing changed, a theme that can follow the page, and an accessible
 * name for the editable surface. `bindMikeDownValue` holds it once.
 */

import { createMikeDownEditor } from './editor';
import type { MikeDownHost } from './host';
import type { MikeDownEditorHandle, MikeDownOptions } from './types';

export type BindingTheme = 'light' | 'dark' | 'auto';

export interface MikeDownBindingOptions extends Omit<MikeDownOptions, 'host' | 'initialMarkdown' | 'theme'> {
  /** Loaded as the pristine baseline. Default ''. */
  initialValue?: string;
  /** Quiet time after the last keystroke before `onValue` fires. Default 150. 0 reports at once. */
  debounceMs?: number;
  /** Called with the markdown after the debounce, and at once on blur. Not called when the text equals the last value. */
  onValue?: (markdown: string) => void;
  /**
   * Called when focus leaves the whole control (editor and toolbar), like a native input's blur. Moving into the
   * core's menus and dialogs (`.mikedown-portal`) does not count. A pending change is flushed first.
   */
  onTouched?: () => void;
  /** Start disabled. A disabled binding is read-only too. */
  disabled?: boolean;
  /** Default 'auto'. */
  theme?: BindingTheme;
  /**
   * CSS selector for 'auto': dark when the container, or an ancestor, matches
   * (`html[data-mode=dark]`, `.dark-theme`). Without it 'auto' follows
   * `prefers-color-scheme`.
   */
  darkSelector?: string;
  /** Maps the markdown on its way out (e.g. to preserve brackets). `setValue` compares against its output. */
  outputTransform?: (markdown: string) => string;
  /** Optional host methods (image upload, wikilinks, ...). `onChange` is run before the binding's own. */
  host?: Partial<MikeDownHost>;
}

export interface MikeDownBinding {
  /** The underlying editor handle. */
  readonly handle: MikeDownEditorHandle;
  /** Load an external value as the pristine baseline. Skipped when it equals the current value. */
  setValue(markdown: string): void;
  /** Report a pending change now. */
  flush(): void;
  setTheme(theme: BindingTheme): void;
  /** Read-only is `readOnly || disabled`. */
  setReadOnly(readOnly: boolean): void;
  setDisabled(disabled: boolean): void;
  focus(): void;
  destroy(): void;
}

/** Attribute names a selector depends on, for the MutationObserver filter. */
export function selectorAttributes(selector: string): string[] | undefined {
  const names = new Set<string>();
  if (/\.[\w-]+/.test(selector)) {names.add('class');}
  if (/#[\w-]+/.test(selector)) {names.add('id');}
  for (const m of selector.matchAll(/\[\s*([\w:-]+)/g)) {
    if (m[1]) {names.add(m[1]);}
  }
  return names.size ? [...names] : undefined;
}

export function bindMikeDownValue(container: HTMLElement, options: MikeDownBindingOptions = {}): MikeDownBinding {
  const {
    initialValue = '',
    debounceMs = 150,
    onValue,
    onTouched,
    disabled: initialDisabled = false,
    theme: initialTheme = 'auto',
    darkSelector,
    outputTransform,
    host: hostOverrides,
    ...editorOptions
  } = options;

  const out = (md: string): string => (outputTransform ? outputTransform(md) : md);
  let destroyed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: string | null = null;
  /** The value the outside world last saw: loaded or reported. */
  let lastValue = out(initialValue);
  let theme: BindingTheme = initialTheme;
  let readOnly = editorOptions.readOnly === true;
  let disabled = initialDisabled;

  const flush = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (pending === null) {return;}
    const value = out(pending);
    pending = null;
    // Typing and undoing back to the loaded text reports nothing.
    if (value === lastValue) {return;}
    lastValue = value;
    onValue?.(value);
  };

  // ── Accessible name: look up <label for> when only an id was given ───────
  let labelEl: HTMLElement | null = null;
  let ariaLabelledBy = editorOptions.ariaLabelledBy;
  if (editorOptions.id && !ariaLabelledBy) {
    const root = container.getRootNode() as Document | ShadowRoot;
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(editorOptions.id) : editorOptions.id;
    labelEl = root.querySelector?.<HTMLElement>(`label[for="${escaped}"]`) ?? null;
    if (labelEl) {
      if (!labelEl.id) {labelEl.id = `${editorOptions.id}-label`;}
      ariaLabelledBy = labelEl.id;
    }
  }

  // ── Theme ────────────────────────────────────────────────────────────────
  const isDarkNow = (): boolean => {
    if (darkSelector) {
      try {
        return !!container.closest(darkSelector);
      } catch {
        return false;
      }
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  };
  const resolve = (t: BindingTheme): 'light' | 'dark' => (t === 'auto' ? (isDarkNow() ? 'dark' : 'light') : t);

  const handle = createMikeDownEditor(container, {
    ...editorOptions,
    ariaLabelledBy,
    landmark: editorOptions.landmark ?? false,
    readOnly: readOnly || disabled,
    initialMarkdown: initialValue,
    theme: resolve(theme),
    host: {
      ...hostOverrides,
      onChange: (md: string, meta: { pristine: boolean }) => {
        hostOverrides?.onChange?.(md, meta);
        if (destroyed) {return;}
        pending = md;
        if (debounceMs <= 0) {
          flush();
          return;
        }
        if (timer !== undefined) {clearTimeout(timer);}
        timer = setTimeout(flush, debounceMs);
      },
    },
  });

  const unBlur = handle.on('blur', flush);

  let observer: MutationObserver | null = null;
  let mql: MediaQueryList | null = null;
  let applied = resolve(theme);
  // Only on a real change: setTheme re-renders (toolbar icon, a PM
  // transaction), and those class writes inside the document would wake the
  // subtree observer again, looping forever.
  const applyTheme = (): void => {
    if (destroyed) {return;}
    const next = resolve(theme);
    if (next === applied) {return;}
    applied = next;
    handle.setTheme(next);
  };
  const stopFollowing = (): void => {
    observer?.disconnect();
    observer = null;
    mql?.removeEventListener?.('change', applyTheme);
    mql = null;
  };
  const startFollowing = (): void => {
    stopFollowing();
    if (theme !== 'auto') {return;}
    if (darkSelector) {
      if (typeof MutationObserver === 'undefined') {return;}
      const attributeFilter = selectorAttributes(darkSelector);
      observer = new MutationObserver(applyTheme);
      observer.observe(container.ownerDocument.documentElement, {
        attributes: true,
        subtree: true,
        ...(attributeFilter ? { attributeFilter } : {}),
      });
    } else if (window.matchMedia) {
      mql = window.matchMedia('(prefers-color-scheme: dark)');
      mql.addEventListener?.('change', applyTheme);
    }
  };
  startFollowing();

  const onFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget as Node | null;
    if (next && container.contains(next)) {return;}
    if (next instanceof Element && next.closest('.mikedown-portal')) {return;}
    flush();
    onTouched?.();
  };
  container.addEventListener('focusout', onFocusOut);

  const onLabelClick = (): void => handle.focus();
  labelEl?.addEventListener('click', onLabelClick);

  return {
    handle,
    setValue(markdown: string): void {
      if (destroyed) {return;}
      // An external write wins over keystrokes still waiting in the debounce.
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      pending = null;
      lastValue = markdown;
      // Reloading the text the editor already shows would reset the caret.
      if (markdown === out(handle.getMarkdown())) {return;}
      handle.setMarkdown(markdown, { pristine: true });
    },
    flush,
    setTheme(next: BindingTheme): void {
      theme = next;
      // An explicit call always applies (the user may have flipped the theme in the editor).
      if (!destroyed) {
        applied = resolve(theme);
        handle.setTheme(applied);
      }
      startFollowing();
    },
    setReadOnly(next: boolean): void {
      readOnly = next;
      if (!destroyed) {handle.setReadOnly(readOnly || disabled);}
    },
    setDisabled(next: boolean): void {
      disabled = next;
      if (!destroyed) {handle.setReadOnly(readOnly || disabled);}
    },
    focus: () => handle.focus(),
    destroy(): void {
      if (destroyed) {return;}
      flush();
      destroyed = true;
      stopFollowing();
      unBlur();
      container.removeEventListener('focusout', onFocusOut);
      labelEl?.removeEventListener('click', onLabelClick);
      handle.destroy();
    },
  };
}
