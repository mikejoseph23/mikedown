import {
  createElement,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type ForwardedRef,
} from 'react';
import { bindMikeDownValue } from '@mikedown/core';
import type {
  BindingTheme,
  MikeDownBinding,
  MikeDownEditorHandle,
  MikeDownFeatures,
  MikeDownHost,
  MikeDownSettings,
} from '@mikedown/core';

export interface MikeDownEditorProps {
  /** Controlled markdown. Pair with `onChange`. Omit for an uncontrolled editor. */
  value?: string;
  /** Initial markdown of an uncontrolled editor. Read once, at mount. */
  defaultValue?: string;
  /** Called with the markdown after `debounceMs` of quiet, and at once on blur. */
  onChange?: (markdown: string) => void;
  /** Default 'auto': follows `darkSelector`, else `prefers-color-scheme`. */
  theme?: BindingTheme;
  readOnly?: boolean;
  /** Read-only, and the surrounding form field is disabled. */
  disabled?: boolean;
  /** Empty-document placeholder. Read at mount. */
  placeholder?: string;
  /** Feature switches (toolbar, sidebar, sourceMode, ...). Read at mount. */
  features?: Partial<MikeDownFeatures>;
  /** Core settings. Later changes are applied with `updateSettings`. */
  settings?: Partial<MikeDownSettings>;
  /**
   * Host methods (image upload, wikilinks, ...). Read through a ref, so a new object
   * never recreates the editor; the set of methods present is fixed at mount.
   * `host.ai` (the AI group) is handed to the core untouched, as read at mount.
   */
  host?: Partial<MikeDownHost>;
  /** CSS selector for theme 'auto': dark when the editor or an ancestor matches. Read at mount. */
  darkSelector?: string;
  /** Quiet time before `onChange` fires. Default 150. Read at mount. */
  debounceMs?: number;
  /** Base URL of the spell-check dictionaries. Read at mount. */
  spellcheckDictionaryUrl?: string;
  className?: string;
  style?: CSSProperties;
  /** Goes on the editable surface, not on the wrapper element. */
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** Called once the editor exists (again after a StrictMode remount, with the new handle). */
  onReady?: (handle: MikeDownEditorHandle) => void;
  /** Focus left the whole editor (editor and toolbar). Pending changes are flushed first. */
  onBlur?: () => void;
}

/**
 * The ref target. It exists from the first render, forwards to the live editor
 * once mounted, and does nothing before that or after unmount.
 */
function createHandleProxy(getHandle: () => MikeDownEditorHandle | null): MikeDownEditorHandle {
  return new Proxy({} as MikeDownEditorHandle, {
    get(_target, prop) {
      const handle = getHandle();
      if (prop === 'then') {return undefined;}
      if (!handle) {
        if (prop === 'getMarkdown' || prop === 'getHtml') {return () => '';}
        if (prop === 'on') {return () => () => undefined;}
        if (prop === 'isModalOpen') {return () => false;}
        if (prop === 'tiptap') {return undefined;}
        return () => undefined;
      }
      const value = (handle as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(handle) : value;
    },
  });
}

/** A host whose methods call through to the latest props, so `host` identity never matters. */
function stableHost(initial: Partial<MikeDownHost> | undefined, latest: () => Partial<MikeDownHost> | undefined): Partial<MikeDownHost> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(initial ?? {})) {
    const value = (initial as Record<string, unknown>)[key];
    // The `ai` group is an object of methods, not a method: core owns its shape, so it goes through as is.
    if (key === 'ai') {
      if (value) {out.ai = value;}
      continue;
    }
    if (typeof value !== 'function') {continue;}
    out[key] = (...args: unknown[]) => {
      const fn = (latest() as Record<string, unknown> | undefined)?.[key];
      return typeof fn === 'function' ? (fn as (...a: unknown[]) => unknown)(...args) : undefined;
    };
  }
  return out as Partial<MikeDownHost>;
}

function MikeDownEditorImpl(props: MikeDownEditorProps, ref: ForwardedRef<MikeDownEditorHandle>) {
  const {
    value,
    defaultValue,
    theme = 'auto',
    readOnly = false,
    disabled = false,
    settings,
    className,
    style,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const bindingRef = useRef<MikeDownBinding | null>(null);
  // Always the latest props, for callbacks the editor holds for its whole life.
  const latest = useRef(props);
  latest.current = props;

  const proxyRef = useRef<MikeDownEditorHandle | null>(null);
  if (!proxyRef.current) {
    proxyRef.current = createHandleProxy(() => bindingRef.current?.handle ?? null);
  }
  useImperativeHandle(ref, () => proxyRef.current as MikeDownEditorHandle, []);

  // Create on mount, destroy on unmount. StrictMode runs mount, cleanup, mount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {return;}
    const p = latest.current;
    const binding = bindMikeDownValue(container, {
      initialValue: p.value ?? p.defaultValue ?? '',
      debounceMs: p.debounceMs,
      onValue: (markdown) => latest.current.onChange?.(markdown),
      onTouched: () => latest.current.onBlur?.(),
      theme: p.theme ?? 'auto',
      darkSelector: p.darkSelector,
      readOnly: p.readOnly ?? false,
      disabled: p.disabled ?? false,
      placeholder: p.placeholder,
      features: p.features,
      settings: p.settings,
      spellcheckDictionaryUrl: p.spellcheckDictionaryUrl,
      id: p.id,
      ariaLabel: p['aria-label'],
      ariaLabelledBy: p['aria-labelledby'],
      host: stableHost(p.host, () => latest.current.host),
    });
    bindingRef.current = binding;
    latest.current.onReady?.(binding.handle);
    return () => {
      bindingRef.current = null;
      binding.destroy();
    };
  }, []);

  // Controlled value. setValue skips text the editor already shows, so echoing
  // our own onChange back never moves the caret.
  useEffect(() => {
    if (value !== undefined) {bindingRef.current?.setValue(value);}
  }, [value]);

  useEffect(() => {
    bindingRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    bindingRef.current?.setReadOnly(readOnly);
  }, [readOnly]);

  useEffect(() => {
    bindingRef.current?.setDisabled(disabled);
  }, [disabled]);

  // `settings` is usually an inline object: compare by content.
  const settingsKey = settings ? JSON.stringify(settings) : '';
  const appliedSettings = useRef(settingsKey);
  useEffect(() => {
    if (appliedSettings.current === settingsKey) {return;}
    appliedSettings.current = settingsKey;
    if (settings) {bindingRef.current?.handle.updateSettings(settings);}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey]);

  return createElement('div', { ref: containerRef, className, style });
}

export const MikeDownEditor = forwardRef<MikeDownEditorHandle, MikeDownEditorProps>(MikeDownEditorImpl);
MikeDownEditor.displayName = 'MikeDownEditor';
