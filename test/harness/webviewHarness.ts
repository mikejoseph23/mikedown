/**
 * Boots the REAL webview bundle (src/webview/editor-main.ts) inside jsdom so a
 * test can drive it the way the extension host does — post the same messages,
 * type into the same editors, and read back the `edit` messages it sends.
 *
 * The body markup is lifted out of `getWebviewContent` in
 * markdownEditorProvider.ts rather than duplicated here, so the harness can't
 * silently drift from the HTML the host actually serves.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { vi } from 'vitest';
import { EditorView as CmEditorView } from '@codemirror/view';

const PROVIDER = join(__dirname, '..', '..', 'src', 'markdownEditorProvider.ts');

/** The `<body>` markup the host serves, with the bundle's own <script> removed. */
export function webviewBodyHtml(): string {
  const src = readFileSync(PROVIDER, 'utf8');
  const match = src.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  if (!match) throw new Error('could not find the webview <body> in markdownEditorProvider.ts');
  return match[1]
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/\$\{[^}]*\}/g, ''); // template placeholders (script/css URIs)
}

export interface Harness {
  /** Every message the webview has posted to the host, oldest first. */
  posted: any[];
  /** Deliver a host → webview message. */
  send(message: any): void;
  /** Messages of one type, in order. */
  ofType(type: string): any[];
  /** The most recent message of a type, or undefined. */
  last(type: string): any | undefined;
  /** Drop everything recorded so far. */
  clear(): void;
  /** The live CodeMirror view backing source mode, once it has been opened. */
  sourceView(): CmEditorView;
  /** Replace the whole source buffer, as a user retyping it would. */
  typeInSource(text: string): void;
  /** Rendered text of the WYSIWYG surface. */
  wysiwygText(): string;
  /** Whether source mode is the visible surface. */
  inSourceMode(): boolean;
  /** Remove the listeners this boot installed so another boot can run clean. */
  dispose(): void;
}

/**
 * Install the `acquireVsCodeApi` stub and load the bundle. Must be awaited
 * before any interaction; the module wires its listeners as it evaluates.
 */
/**
 * jsdom has no layout engine, so CodeMirror's measuring phase throws. Neither
 * the geometry nor the exceptions matter here — the assertions are about
 * document content — so hand back empty rect lists.
 */
function stubLayoutMeasurement(): void {
  const emptyRects = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  const rect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => emptyRects;
    Range.prototype.getBoundingClientRect = rect as any;
  }
  if (!Element.prototype.getClientRects) {
    Element.prototype.getClientRects = () => emptyRects;
  }
}

export async function bootWebview(): Promise<Harness> {
  stubLayoutMeasurement();
  document.body.innerHTML = webviewBodyHtml();

  const posted: any[] = [];
  (globalThis as any).acquireVsCodeApi = () => ({
    postMessage: (m: any) => { posted.push(m); },
    getState: () => undefined,
    setState: () => undefined,
  });

  // jsdom's window outlives the module, so record what this boot registers and
  // tear it down afterwards — otherwise a second boot in the same file gets two
  // sets of handlers reacting to every message.
  const added: Array<[EventTarget, string, any, any]> = [];
  const targets: EventTarget[] = [window, document, document.body];
  const originals = targets.map(t => t.addEventListener);
  targets.forEach(t => {
    const original = t.addEventListener.bind(t);
    t.addEventListener = (type: string, listener: any, options?: any) => {
      added.push([t, type, listener, options]);
      original(type, listener, options);
    };
  });

  vi.resetModules();
  await import('../../src/webview/editor-main');

  targets.forEach((t, i) => { t.addEventListener = originals[i]; });

  const sourceContainer = () => document.getElementById('source-container') as HTMLElement;
  const editorContainer = () => document.getElementById('editor-container') as HTMLElement;

  return {
    posted,
    send(message: any) {
      window.dispatchEvent(new MessageEvent('message', { data: message }));
    },
    ofType(type: string) {
      return posted.filter(m => m && m.type === type);
    },
    last(type: string) {
      const all = posted.filter(m => m && m.type === type);
      return all[all.length - 1];
    },
    clear() {
      posted.length = 0;
    },
    sourceView() {
      const dom = sourceContainer().querySelector('.cm-editor') as HTMLElement | null;
      const view = dom && CmEditorView.findFromDOM(dom);
      if (!view) throw new Error('source mode has not been opened yet');
      return view;
    },
    typeInSource(text: string) {
      const view = this.sourceView();
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    wysiwygText() {
      return editorContainer().textContent ?? '';
    },
    inSourceMode() {
      return sourceContainer().style.display !== 'none' && editorContainer().style.display === 'none';
    },
    dispose() {
      added.forEach(([t, type, listener, options]) => t.removeEventListener(type, listener, options));
      added.length = 0;
    },
  };
}
