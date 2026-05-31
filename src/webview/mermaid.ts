import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import mermaid from 'mermaid';

// Renders ```mermaid fenced code blocks as live diagrams in the WYSIWYG view.
//
// Implemented as a ProseMirror decoration plugin rather than a code-block
// NodeView so that:
//   • Non-mermaid code blocks keep their default CodeBlockLowlight rendering
//     (we never touch them).
//   • Language changes, edits, and the enable/disable toggle all reflect
//     immediately — decorations recompute on every transaction.
//
// For each ```mermaid block we add two decorations:
//   1. A node decoration that tags the <pre> so CSS can hide the source while
//      the cursor is elsewhere (the diagram stands in for it).
//   2. A widget decoration placed just after the block holding the rendered
//      SVG. The widget is keyed by the diagram source, so PM reuses its DOM
//      (no re-render) until the source actually changes.
//
// The block still serialises as a normal ```mermaid fenced block — no markdown
// round-trip changes are needed.

export const mermaidPluginKey = new PluginKey('mikedownMermaid');

// Module state shared across all editors in the webview (there is only one).
let enabled = true;
let idCounter = 0;
let initializedTheme: 'dark' | 'default' | null = null;

// Cache rendered output by diagram source so re-mounting a widget (e.g. when a
// block above shifts position) is instant and doesn't re-run mermaid.
const svgCache = new Map<string, string>();
const errorCache = new Map<string, string>();

export function isMermaidEnabled(): boolean {
  return enabled;
}

export function setMermaidEnabled(editor: Editor, value: boolean): void {
  if (enabled === value) return;
  enabled = value;
  forceRebuild(editor);
}

/**
 * Re-render every diagram. Call when the color theme changes — mermaid bakes
 * theme colors into the SVG at render time, so cached output goes stale.
 */
export function refreshMermaidTheme(editor: Editor): void {
  svgCache.clear();
  errorCache.clear();
  initializedTheme = null;
  forceRebuild(editor);
}

function forceRebuild(editor: Editor): void {
  if (!editor || editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(mermaidPluginKey, { force: true }));
}

function isDarkTheme(): boolean {
  const cls = document.body.classList;
  if (cls.contains('mikedown-force-dark')) return true;
  if (cls.contains('mikedown-force-light')) return false;
  // Fall back to the VS Code theme classes the webview host sets on <body>.
  return cls.contains('vscode-dark') || cls.contains('vscode-high-contrast');
}

function ensureInit(): void {
  const theme = isDarkTheme() ? 'dark' : 'default';
  if (initializedTheme === theme) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme,
    suppressErrorRendering: true,
  });
  initializedTheme = theme;
}

function cleanupOrphan(id: string): void {
  // mermaid.render appends a temporary measuring node to <body>; on parse
  // failure it can leave one behind. Remove both shapes it uses.
  document.getElementById(id)?.remove();
  document.getElementById('d' + id)?.remove();
}

function fillPreview(container: HTMLElement, code: string): void {
  const trimmed = code.trim();
  if (!trimmed) {
    container.classList.add('is-empty');
    container.textContent = 'Empty diagram — click to edit';
    return;
  }
  const cachedSvg = svgCache.get(code);
  if (cachedSvg !== undefined) {
    container.innerHTML = cachedSvg;
    return;
  }
  const cachedErr = errorCache.get(code);
  if (cachedErr !== undefined) {
    container.classList.add('has-error');
    container.textContent = cachedErr;
    return;
  }

  container.classList.add('is-loading');
  container.textContent = 'Rendering diagram…';
  const id = 'mikedown-mermaid-' + idCounter++;
  try {
    ensureInit();
  } catch {
    // initialize failures fall through to render() which will reject
  }
  mermaid
    .render(id, code)
    .then(({ svg }) => {
      svgCache.set(code, svg);
      container.classList.remove('is-loading');
      container.innerHTML = svg;
    })
    .catch((err: unknown) => {
      const msg =
        (err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err)) || 'Failed to render diagram';
      errorCache.set(code, msg);
      cleanupOrphan(id);
      container.classList.remove('is-loading');
      container.classList.add('has-error');
      container.textContent = msg;
    });
}

function createPreview(view: EditorView, getPos: () => number | undefined, code: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'mikedown-mermaid-preview';
  container.setAttribute('contenteditable', 'false');

  // Click the diagram to drop the cursor into the (now revealed) source.
  container.addEventListener('mousedown', (event) => {
    event.preventDefault();
    const wpos = getPos();
    if (wpos == null) return;
    // The widget sits just after the code block; (wpos - 1) lands inside it.
    const inside = Math.max(0, wpos - 1);
    const { state } = view;
    const sel = TextSelection.create(state.doc, Math.min(inside, state.doc.content.size));
    view.dispatch(state.tr.setSelection(sel).scrollIntoView());
    view.focus();
  });

  fillPreview(container, code);
  return container;
}

function buildDecorations(doc: PmNode, selection: { from: number; to: number }): DecorationSet {
  if (!enabled) return DecorationSet.empty;

  const decos: Decoration[] = [];
  // Disambiguate widgets for blocks that share identical source so PM keys
  // stay stable (and DOM gets reused) as positions shift above them.
  const occurrence = new Map<string, number>();

  doc.descendants((node: PmNode, pos: number) => {
    if (node.type.name !== 'codeBlock' || node.attrs.language !== 'mermaid') {
      return undefined;
    }
    const from = pos;
    const to = pos + node.nodeSize;
    const code = node.textContent;
    const editing = selection.from < to && selection.to > from;
    const hasError = errorCache.has(code);

    const classes = ['mikedown-mermaid-source'];
    if (editing) classes.push('is-editing');
    if (hasError) classes.push('has-error');
    decos.push(Decoration.node(from, to, { class: classes.join(' ') }));

    const n = occurrence.get(code) ?? 0;
    occurrence.set(code, n + 1);
    decos.push(
      Decoration.widget(
        to,
        (view: EditorView, getPos: () => number | undefined) => createPreview(view, getPos, code),
        {
          key: 'mermaid|' + n + '|' + code,
          side: 1,
          ignoreSelection: true,
        },
      ),
    );
    return false; // don't descend into the code block's text
  });

  return DecorationSet.create(doc, decos);
}

export const MermaidPreview = Extension.create({
  name: 'mikedownMermaid',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: mermaidPluginKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc, state.selection),
          apply: (tr, old, _oldState, newState) => {
            if (tr.docChanged || tr.selectionSet || tr.getMeta(mermaidPluginKey)) {
              return buildDecorations(newState.doc, newState.selection);
            }
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return mermaidPluginKey.getState(state);
          },
        },
      }),
    ];
  },
});
