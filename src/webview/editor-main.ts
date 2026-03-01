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

// ── TipTap Initialisation ──────────────────────────────────────────────────────

const editorContainer = document.getElementById('editor-container');

if (!editorContainer) {
  console.error('MikeDown: #editor-container element not found.');
} else {
  const editor = new Editor({
    element: editorContainer,
    extensions: [
      StarterKit.configure({
        // Disable the built-in codeBlock — tiptap-markdown provides its own code
        // fenced-block handling and conflicts with StarterKit's codeBlock node.
        codeBlock: false,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Link.configure({ openOnClick: false }),
      Image,
      Placeholder.configure({ placeholder: 'Start writing…' }),
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
    onUpdate: ({ editor: updatedEditor }) => {
      // Guard: do not send an edit event while we are loading content from the
      // extension host — that would incorrectly mark the document as modified.
      if (isLoading) {
        return;
      }

      const markdown = updatedEditor.storage.markdown.getMarkdown() as string;
      vscode.postMessage({ type: 'edit', content: markdown });
    },
  });

  // ── Message Handling — Extension → Webview ─────────────────────────────────

  window.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as { type: string; content?: string };

    if (message.type === 'update') {
      // Parse the incoming markdown and load it into the editor.
      // Set isLoading so onUpdate does not fire an 'edit' message back.
      isLoading = true;
      editor.commands.setContent(message.content ?? '');
      isLoading = false;
    }
  });

  // ── Signal readiness to the extension host ─────────────────────────────────

  // The provider listens for this message and responds with the current
  // document content via an 'update' message.
  vscode.postMessage({ type: 'ready' });
}
