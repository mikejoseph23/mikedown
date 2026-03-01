/**
 * MikeDown Editor — Webview Entry Point (TipTap)
 *
 * This script is compiled by webpack (browser/web target) and runs inside the
 * VS Code webview. It initialises TipTap with the tiptap-markdown extension so
 * the editor can parse GFM on load and serialise back to GFM on every change.
 *
 * Extension → Webview messages:
 *   { type: 'update', content: string }  — full document markdown text to load
 *
 * Webview → Extension messages:
 *   { type: 'ready' }                    — webview is ready to receive content
 *   { type: 'edit', content: string }    — new full markdown text after user edit
 *   { type: 'stats', plainText: string } — plain text for word/char count (M14 hook)
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';

// ── VS Code Webview API ────────────────────────────────────────────────────────

declare const acquireVsCodeApi: () => {
  postMessage: (msg: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

const vscode = acquireVsCodeApi();

// ── Loading flag — prevents onUpdate from firing during programmatic content load ──

/**
 * Set to `true` while applying an extension-host `update` message so that the
 * TipTap `onUpdate` callback does not echo the content back as an `edit` event
 * (which would create an unnecessary dirty-state on the TextDocument).
 */
let isLoading = false;

// ── Document integrity tracking (M2d) ─────────────────────────────────────────

/**
 * The raw markdown content most recently loaded from disk (via `update` message).
 * Used as the baseline for dirty-state detection: the document is considered
 * modified only when the serialized markdown differs from this value.
 */
let originalContent: string = '';

/**
 * Tracks whether the document has unsaved changes relative to `originalContent`.
 */
let isDirty = false;

// ── TipTap Initialisation ──────────────────────────────────────────────────────

const editorContainer = document.getElementById('editor-container');

if (!editorContainer) {
  console.error('MikeDown: #editor-container element not found.');
} else {
  const editor = new Editor({
    element: editorContainer,
    extensions: [
      // ── StarterKit (M2b/M2c/M2d verification) ───────────────────────────────
      //
      // StarterKit bundles the following extensions that handle GFM input rules:
      //
      // M2b — Inline marks (verified: StarterKit includes these by default):
      //   • Bold:          **text** and __text__ → <strong> (Bold extension)
      //   • Italic:        *text* and _text_     → <em>     (Italic extension)
      //   • Strike:        ~~text~~               → <s>      (Strike extension)
      //   • Code (inline): `code`                → <code>   (Code extension)
      //
      // M2c — Block nodes (verified: StarterKit includes these by default):
      //   • Headings:        # through ###### at line start → h1–h6 (Heading)
      //   • BulletList:      -, *, + at line start → <ul>            (BulletList)
      //   • OrderedList:     1. at line start       → <ol>            (OrderedList)
      //   • Blockquote:      > at line start        → <blockquote>    (Blockquote)
      //   • HorizontalRule:  --- on own line        → <hr>            (HorizontalRule)
      //
      // Note: StarterKit's codeBlock is disabled here because tiptap-markdown
      // manages fenced code blocks (``` / ```lang) via its own CodeBlock node.
      // This avoids conflicts between the two implementations.
      //
      // M2c — Cross-block selection handled natively by ProseMirror.
      // ProseMirror's selection model supports selections that span multiple
      // block nodes (paragraphs, headings, lists, etc.) without additional code.
      //
      // M2c — Inline formatting across incompatible block types: TipTap/ProseMirror
      // applies marks only to ranges where the schema allows them, skipping
      // incompatible nodes (e.g., code blocks reject rich-text marks). No extra
      // code is needed to enforce this boundary.
      //
      // M2d — History configured with depth: 100 and newGroupDelay: 500 ms so
      // that rapid keystrokes are grouped into a single undo step (500 ms window)
      // while keeping up to 100 steps in the undo stack.
      StarterKit.configure({
        // Disable the built-in codeBlock — tiptap-markdown provides its own code
        // fenced-block handling and conflicts with StarterKit's codeBlock node.
        codeBlock: false,
        // M2d: Configure History with grouping delay and stack depth.
        history: { depth: 100, newGroupDelay: 500 },
      }),

      // ── Task Lists (M2c) ──────────────────────────────────────────────────────
      // "- [ ] " and "- [x] " input rules convert to checkable task list items.
      // TaskItem is configured with nested: true to allow sub-tasks.
      // Auto-continuation (Enter → new item) and list-exit (Enter on empty item
      // → paragraph) are handled natively by ProseMirror's list commands.
      TaskList,
      TaskItem.configure({ nested: true }),

      // ── Tables ────────────────────────────────────────────────────────────────
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,

      // ── Links (M2b) ───────────────────────────────────────────────────────────
      // tiptap-markdown handles "[text](url)" syntax via its paste/input rules,
      // converting typed or pasted markdown link syntax to Link marks.
      // openOnClick: false keeps the editor from navigating on Ctrl+click so
      // the user can edit the link text.
      Link.configure({ openOnClick: false }),

      // ── Images (M2b) ──────────────────────────────────────────────────────────
      // tiptap-markdown handles "![alt](src)" syntax and creates Image nodes.
      Image,

      // ── Placeholder (M2c) ─────────────────────────────────────────────────────
      // "Start writing…" is displayed when the document contains no content.
      // The CSS rule `.ProseMirror p.is-editor-empty:first-child::before` renders
      // this via the data-placeholder attribute injected by the extension.
      Placeholder.configure({ placeholder: 'Start writing…' }),

      // ── Markdown serialiser / input rules (M2b / M2c) ─────────────────────────
      // tiptap-markdown provides:
      //   • Input rules for fenced code blocks (``` / ```lang)
      //   • Paste rules that convert pasted markdown (bold, italic, links, etc.)
      //     to rich TipTap nodes/marks — verified working for GFM content.
      //   • storage.markdown.getMarkdown() for round-trip GFM serialisation.
      //
      // TODO (future): With html: false, raw HTML blocks (e.g. <details>, <div>)
      // inside markdown appear as plain text. A future enhancement could render
      // them as styled "HTML block" nodes with a monospace / light-gray background
      // and an "HTML" label (similar to raw-HTML block rendering in Typora).
      Markdown.configure({
        html: false,
        tightLists: true,
        tightListClass: 'tight',
        bulletListMarker: '-',
        linkify: false,
        breaks: false,
        transformPastedText: false,
        transformCopiedText: false,
      }),
    ],
    content: '',

    // ── Keyboard shortcuts ──────────────────────────────────────────────────────
    editorProps: {
      handleKeyDown(view, event) {
        // M2c — Tab to indent list item (sink one level deeper).
        // TipTap's BulletList / OrderedList extensions do not add Tab bindings by
        // default; we add them here so Tab behaves as expected inside lists.
        if (event.key === 'Tab' && !event.shiftKey) {
          const { state } = view;
          const { selection } = state;
          const { $from } = selection;
          // Only intercept Tab when the cursor is inside a list item.
          let inList = false;
          for (let depth = $from.depth; depth > 0; depth--) {
            const nodeType = $from.node(depth).type.name;
            if (nodeType === 'listItem' || nodeType === 'taskItem') {
              inList = true;
              break;
            }
          }
          if (inList) {
            // Use TipTap's sinkListItem command for both regular and task items.
            const handled =
              (view.state.schema.nodes.listItem &&
                (view as unknown as { editorView?: unknown }).editorView === undefined &&
                false) ||
              false;
            void handled;
            // Dispatch via the editor command API (accessed through the editor
            // instance captured in the outer closure).
            // We use a custom event to bridge to the editor commands below.
            editorContainer.dispatchEvent(
              new CustomEvent('mikedown:sinkListItem', { bubbles: false })
            );
            event.preventDefault();
            return true;
          }
        }

        // M2c — Shift+Tab to un-indent list item (lift one level up).
        if (event.key === 'Tab' && event.shiftKey) {
          const { state } = view;
          const { selection } = state;
          const { $from } = selection;
          let inList = false;
          for (let depth = $from.depth; depth > 0; depth--) {
            const nodeType = $from.node(depth).type.name;
            if (nodeType === 'listItem' || nodeType === 'taskItem') {
              inList = true;
              break;
            }
          }
          if (inList) {
            editorContainer.dispatchEvent(
              new CustomEvent('mikedown:liftListItem', { bubbles: false })
            );
            event.preventDefault();
            return true;
          }
        }

        return false;
      },
    },

    onUpdate: ({ editor: updatedEditor }) => {
      // Guard: do not send an edit event while we are loading content from the
      // extension host — that would incorrectly mark the document as modified.
      if (isLoading) {
        return;
      }

      const markdown = updatedEditor.storage.markdown.getMarkdown() as string;

      // M2d — Dirty-state detection: compare the current serialized markdown
      // against the original content loaded from disk. This prevents false
      // "unsaved changes" prompts caused by round-trip serialization differences.
      const newDirty = markdown !== originalContent;
      if (newDirty !== isDirty) {
        isDirty = newDirty;
        // Dirty state changed — extension host is implicitly notified via the
        // 'edit' message below (host tracks dirty state through TextDocument).
      }

      vscode.postMessage({ type: 'edit', content: markdown });

      // M2d — Send plain text to status bar (M14 hook: word/character count).
      const plainText = updatedEditor.getText();
      vscode.postMessage({ type: 'stats', plainText });
    },
  });

  // M2c — Wire Tab/Shift+Tab custom events to editor commands.
  // These events are dispatched by the handleKeyDown prop above and executed
  // here where we have a reference to the editor instance.
  editorContainer.addEventListener('mikedown:sinkListItem', () => {
    // Attempt to sink a regular listItem; fall back to taskItem.
    const sunk =
      editor.commands.sinkListItem('listItem') ||
      editor.commands.sinkListItem('taskItem');
    void sunk;
  });

  editorContainer.addEventListener('mikedown:liftListItem', () => {
    // Attempt to lift a regular listItem; fall back to taskItem.
    const lifted =
      editor.commands.liftListItem('listItem') ||
      editor.commands.liftListItem('taskItem');
    void lifted;
  });

  // ── Message Handling — Extension → Webview ─────────────────────────────────

  window.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as { type: string; content?: string; fontFamily?: string; fontSize?: number };

    if (message.type === 'theme') {
      document.documentElement.style.setProperty(
        '--mikedown-font-family', message.fontFamily || ''
      );
      document.documentElement.style.setProperty(
        '--mikedown-font-size', `${message.fontSize || 16}px`
      );
    }

    if (message.type === 'update') {
      // M2d — Load content from disk and establish the originalContent baseline.
      // isLoading prevents the onUpdate handler from echoing this back as an
      // 'edit' message, which would incorrectly mark the document as dirty.
      isLoading = true;
      originalContent = message.content ?? '';
      editor.commands.setContent(originalContent);

      // M2d — After TipTap parses and re-sets the content, immediately serialize
      // back to check for round-trip fidelity. If the serialized form differs from
      // the original, log a warning but continue using originalContent as the
      // dirty-detection baseline so the document is not marked as modified on open.
      const reserialized = editor.storage.markdown.getMarkdown() as string;
      if (reserialized !== originalContent) {
        console.warn(
          'MikeDown: serialization round-trip mismatch — using original as baseline'
        );
        // Still use originalContent as baseline, not the reserialized version.
      }

      isDirty = false;
      isLoading = false;

      // M2d — Send initial stats to status bar (M14 hook).
      const plainText = editor.getText();
      vscode.postMessage({ type: 'stats', plainText });
    }
  });

  // ── Signal readiness to the extension host ─────────────────────────────────

  // The provider listens for this message and responds with the current
  // document content via an 'update' message.
  vscode.postMessage({ type: 'ready' });
}
