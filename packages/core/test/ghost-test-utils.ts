/**
 * Shared setup for the inline suggestion tests that run against a real editor:
 * mounting, real dispatched key events, a controller whose requests the test
 * answers by hand, and the jsdom stubs `scrollIntoView` needs.
 */
import { vi } from 'vitest';
import { Selection, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/core';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle, type MikeDownHost, type MikeDownSettings } from '../src/index';
import { makeAiError, type AiGhostTextOptions, type AiRouteOk } from '../src/ai';
import { createGhostController, type GhostController } from '../src/ai-ghost';
import { createGhostPlugin, setGhostSuggestion, triggerGhostNow } from '../src/ai-ghost-plugin';
import type { AiRunEvents, AiRunOutcome, AiRunRequest } from '../src/ai-request';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

export const ROUTE: AiRouteOk = { engineId: 'omlx', modelId: 'small', viaFallback: false, task: 'continue', isLocal: true, needsConsent: false };

export interface Mounted {
  handle: MikeDownEditorHandle;
  el: HTMLElement;
  editor: Editor;
  view: EditorView;
}

const mounted: Mounted[] = [];

export function mountEditor(opts: { host?: MikeDownHost; markdown?: string; settings?: Partial<MikeDownSettings> } = {}): Mounted {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host: opts.host ?? new NoopHost(), ...(opts.settings ? { settings: opts.settings } : {}) });
  if (opts.markdown !== undefined) {handle.setMarkdown(opts.markdown);}
  const m: Mounted = { handle, el, editor: handle.tiptap, view: handle.tiptap.view };
  mounted.push(m);
  return m;
}

export function unmountAll(): void {
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
}

/**
 * Caret at the end of the last text block that has text. (`Selection.atEnd`
 * would land in the empty paragraph `TrailingNode` adds after a list, a
 * heading or a table.)
 */
export function caretAtEnd(view: EditorView): void {
  let end = -1;
  view.state.doc.descendants((node, pos) => {
    if (node.isTextblock && node.content.size > 0) {end = pos + 1 + node.content.size;}
    return true;
  });
  view.dispatch(view.state.tr.setSelection(end < 0 ? Selection.atEnd(view.state.doc) : TextSelection.create(view.state.doc, end)));
}

/** Caret in the empty paragraph at the very end (after a heading, say). */
export function caretInTrailingBlock(view: EditorView): void {
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
}

/** Caret at the end of the first text block whose text matches. */
export function caretAfterText(view: EditorView, text: string): void {
  let found = -1;
  view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isTextblock && node.textContent.includes(text)) {found = pos + 1 + node.content.size;}
    return found < 0;
  });
  if (found < 0) {throw new Error(`no block holds "${text}"`);}
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found)));
}

/** A real keydown on the editor's DOM, as the browser would send it. Returns the event (see `defaultPrevented`). */
export function press(view: EditorView, key: string, mods: Partial<Pick<KeyboardEventInit, 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>> = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods });
  view.dom.dispatchEvent(event);
  return event;
}

/** A keystroke that edits: the keydown (which marks the change as typing), then the text going in. */
export function typeKey(view: EditorView, ch: string): void {
  const event = press(view, ch);
  if (event.defaultPrevented) {return;}
  view.dispatch(view.state.tr.insertText(ch));
}

export function typeText(view: EditorView, text: string): void {
  for (const ch of text) {typeKey(view, ch);}
}

export const ghostSpans = (view: EditorView): HTMLElement[] => Array.from(view.dom.querySelectorAll<HTMLElement>('.mikedown-ghost'));
export const ghostText = (view: EditorView): string | null => ghostSpans(view).map((s) => s.textContent).join('') || null;

export interface RunCall {
  req: AiRunRequest;
  signal: AbortSignal;
  /** Stream the text so far, as the engine would (accumulated). */
  token(text: string): void;
  resolve(text: string): void;
  reject(err: unknown): void;
}

/** A `run` the test answers by hand. */
export function fakeRun() {
  const calls: RunCall[] = [];
  const run = vi.fn((req: AiRunRequest, events: AiRunEvents, signal: AbortSignal) =>
    new Promise<AiRunOutcome>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(makeAiError('cancelled')));
      events.onRoute?.(ROUTE, null);
      calls.push({
        req,
        signal,
        token: (text) => events.onToken?.(text.slice(-1), text),
        resolve: (text) => resolve({
          result: { text, served: { engineId: 'omlx', engineName: 'oMLX', modelId: 'small', isLocal: true } },
          route: ROUTE, viaFallback: false, thinking: null, requestId: 'req-1',
        }),
        reject,
      });
    }));
  return { run, calls, last: () => calls[calls.length - 1] };
}

export interface PluginRig extends Mounted {
  controller: GhostController;
  calls: RunCall[];
  /** Ask for a continuation now and stream `text` into the widget. */
  show(text: string): void;
  /** Set the widget directly, the way `onSuggestion` does. */
  set(text: string | null): void;
}

/** A plain editor with only the ghost plugin and a real controller on it (no AI host). */
export function pluginRig(markdown: string, options: Partial<AiGhostTextOptions> = {}, plugin: { popupOpen?: () => boolean; enabled?: () => boolean } = {}): PluginRig {
  const m = mountEditor({ markdown });
  const opts: AiGhostTextOptions = { delayMs: 400, maxTokens: 48, trigger: 'auto', localOnly: true, ...options };
  const { run, calls } = fakeRun();
  const controller = createGhostController({
    run,
    options: () => opts,
    contextTokens: () => 8192,
    onSuggestion: (t) => setGhostSuggestion(m.view, t),
  });
  const serializer = (m.editor.storage as any).markdown.serializer;
  m.editor.registerPlugin(createGhostPlugin({ controller, serialize: (doc) => serializer.serialize(doc), ...plugin }));
  caretAtEnd(m.view);
  return {
    ...m,
    controller,
    calls,
    show(text) {
      triggerGhostNow(m.view);
      const call = calls[calls.length - 1];
      if (!call) {throw new Error('the manual trigger sent nothing (not eligible here?)');}
      call.token(text);
    },
    set: (text) => setGhostSuggestion(m.view, text),
  };
}
